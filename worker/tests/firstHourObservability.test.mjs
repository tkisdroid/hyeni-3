import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildTelemetryQuery,
  evaluateFirstHourWindow,
  extractTelemetryCount,
  FIRST_HOUR_5XX_SCHEMA,
  runFirstHourCheck,
  writeFirstHour5xxEvidence,
} from "../scripts/check-first-hour-5xx.mjs";

const VERSION_ID = "86d56186-c527-4564-a154-72f805073205";
const DEPLOYMENT_ID = "918bd5e5-6e1a-4fe4-a799-aa6d9a6ab26e";
const DEPLOYMENT_CREATED_AT = "2026-08-02T00:00:00.000Z";
const FROM_MS = Date.UTC(2026, 7, 2, 1, 0, 0);
const TO_MS = FROM_MS + 5 * 60 * 1000;

function deploymentResponse(versionId = VERSION_ID) {
  return {
    success: true,
    result: {
      deployments: [{
        id: DEPLOYMENT_ID,
        created_on: DEPLOYMENT_CREATED_AT,
        strategy: "percentage",
        versions: [{ percentage: 100, version_id: versionId }],
      }],
    },
  };
}

function telemetryResponse(value) {
  return {
    success: true,
    errors: [],
    messages: [{ message: "Successful request" }],
    result: {
      calculations: [{
        alias: "request_count",
        calculation: "count",
        aggregates: [{ count: value, interval: 1, sampleInterval: 1, value }],
        series: [],
      }],
    },
  };
}

test("Telemetry Query API 요청은 5분·서비스·마커·배포 버전을 정확히 제한한다", () => {
  const total = buildTelemetryQuery({
    queryId: "hyeni-first-hour-total-v1",
    versionId: VERSION_ID,
    fromMs: FROM_MS,
    toMs: TO_MS,
    statusClass: null,
  });
  const errors = buildTelemetryQuery({
    queryId: "hyeni-first-hour-5xx-v1",
    versionId: VERSION_ID,
    fromMs: FROM_MS,
    toMs: TO_MS,
    statusClass: "5xx",
  });

  assert.deepEqual(total.timeframe, { from: FROM_MS, to: TO_MS });
  assert.equal(total.view, "calculations");
  assert.equal(total.dry, true);
  assert.equal(total.ignoreSeries, true);
  assert.deepEqual(total.parameters.calculations, [{ operator: "count", alias: "request_count" }]);
  assert.deepEqual(total.parameters.datasets, ["cloudflare-workers"]);
  assert.ok(total.parameters.filters.some((filter) =>
    filter.key === "$metadata.service" && filter.operation === "eq" && filter.value === "hyeni-calendar-api"
  ));
  assert.ok(total.parameters.filters.some((filter) =>
    filter.key === "event" && filter.operation === "eq"
      && filter.value === "hyeni_request_outcome_v1"
  ));
  assert.ok(total.parameters.filters.some((filter) =>
    filter.key === "versionId" && filter.operation === "eq"
      && filter.value === VERSION_ID
  ));
  assert.equal(total.parameters.filters.length, 3);
  assert.ok(errors.parameters.filters.some((filter) =>
    filter.key === "statusClass" && filter.operation === "eq"
      && filter.value === "5xx"
  ));
  assert.equal(errors.parameters.filters.length, 4);
  assert.throws(
    () => buildTelemetryQuery({
      queryId: "hyeni-first-hour-total-v1",
      versionId: "secret/value-not-allowed",
      fromMs: FROM_MS,
      toMs: TO_MS,
      statusClass: null,
    }),
    /telemetry_version_id_invalid/,
  );
});

test("공식 calculations 응답에서 count aggregate를 방어적으로 읽는다", () => {
  assert.equal(extractTelemetryCount(telemetryResponse(37)), 37);
  assert.equal(extractTelemetryCount({
    success: true,
    result: {
      calculations: [{
        alias: "request_count",
        calculation: "count",
        aggregates: [],
        series: [],
      }],
    },
  }), 0);
  assert.throws(() => extractTelemetryCount({ success: true, result: {} }), /telemetry_response_invalid/);
  assert.throws(() => extractTelemetryCount(telemetryResponse(-1)), /telemetry_response_invalid/);
});

test("기존 롤백 기준은 5xx 5건 이상이면서 비율이 1%를 초과할 때만 발동한다", () => {
  assert.deepEqual(evaluateFirstHourWindow(100, 5), {
    totalRequests: 100,
    serverErrors: 5,
    errorRate: 0.05,
    verdict: "rollback_required",
  });
  assert.equal(evaluateFirstHourWindow(500, 5).verdict, "healthy");
  assert.equal(evaluateFirstHourWindow(100, 4).verdict, "healthy");
  assert.equal(evaluateFirstHourWindow(0, 0).verdict, "inconclusive");
  assert.throws(() => evaluateFirstHourWindow(4, 5), /telemetry_counts_invalid/);
});

test("read-only 실행은 현재 100% deployment와 total·5xx 집계를 확인하고 자격정보를 노출하지 않는다", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (init.method === "GET") {
      return new Response(JSON.stringify(deploymentResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    const body = JSON.parse(init.body);
    const is5xx = body.parameters.filters.some((filter) =>
      filter.key === "statusClass" && filter.value === "5xx"
    );
    return new Response(JSON.stringify(telemetryResponse(is5xx ? 6 : 600)), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const result = await runFirstHourCheck({
    accountId: "0123456789abcdef0123456789abcdef",
    apiToken: "observability-secret-token",
    versionId: VERSION_ID,
    checkpoint: "T+05",
    fromMs: FROM_MS,
    toMs: TO_MS,
    nowMs: TO_MS + 1000,
    fetchImpl,
  });

  assert.equal(calls.length, 3);
  assert.equal(
    calls[0].url,
    "https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/workers/scripts/hyeni-calendar-api/deployments",
  );
  assert.equal(calls[0].init.method, "GET");
  assert.ok(calls.slice(1).every(({ url, init }) =>
    url === "https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/workers/observability/telemetry/query"
      && init.method === "POST"
      && init.headers.Authorization === "Bearer observability-secret-token"
  ));
  assert.equal(result.verdict, "healthy");
  assert.equal(result.schema, FIRST_HOUR_5XX_SCHEMA);
  assert.equal(result.workerService, "hyeni-calendar-api");
  assert.equal(result.workerDeploymentId, DEPLOYMENT_ID);
  assert.equal(result.workerVersionId, VERSION_ID);
  assert.equal(result.checkpoint, "T+05");
  assert.doesNotMatch(JSON.stringify(result), /observability-secret-token|0123456789abcdef0123456789abcdef/);
});

test("환경 version과 현재 deployment가 다르면 telemetry를 조회하지 않고 fail-closed한다", async () => {
  let calls = 0;
  await assert.rejects(
    runFirstHourCheck({
      accountId: "0123456789abcdef0123456789abcdef",
      apiToken: "observability-secret-token",
      versionId: VERSION_ID,
      checkpoint: "T+05",
      fromMs: FROM_MS,
      toMs: TO_MS,
      nowMs: TO_MS + 1000,
      fetchImpl: async () => {
        calls += 1;
        return new Response(JSON.stringify(deploymentResponse(
          "182bd5e5-6e1a-4fe4-a799-aa6d9a6ab26e",
        )), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    }),
    /worker_deployment_version_mismatch/,
  );
  assert.equal(calls, 1);
});

test("5xx v2 JSON 증거는 create-only이고 배포 출처만 남긴다", async () => {
  const directory = mkdtempSync(join(tmpdir(), "hyeni-first-hour-5xx-"));
  const outputPath = join(directory, "t-plus-05.json");
  const result = {
    schema: FIRST_HOUR_5XX_SCHEMA,
    workerService: "hyeni-calendar-api",
    workerDeploymentId: DEPLOYMENT_ID,
    workerDeploymentCreatedAt: DEPLOYMENT_CREATED_AT,
    workerVersionId: VERSION_ID,
    deploymentVerifiedAt: new Date(TO_MS + 1000).toISOString(),
    checkpoint: "T+05",
    totalRequests: 600,
    serverErrors: 6,
    errorRate: 0.01,
    verdict: "healthy",
    fromMs: FROM_MS,
    toMs: TO_MS,
  };
  try {
    writeFirstHour5xxEvidence(result, outputPath);
    assert.throws(() => writeFirstHour5xxEvidence(result, outputPath), /EEXIST/);
    const storedText = readFileSync(outputPath, "utf8");
    assert.deepEqual(JSON.parse(storedText), result);
    assert.doesNotMatch(storedText, /observability-secret-token|0123456789abcdef0123456789abcdef/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("API 실패 오류는 응답 본문·토큰·계정 ID를 복제하지 않는다", async () => {
  const accountId = "0123456789abcdef0123456789abcdef";
  const apiToken = "observability-secret-token";
  await assert.rejects(
    runFirstHourCheck({
      accountId,
      apiToken,
      versionId: VERSION_ID,
      checkpoint: "T+05",
      fromMs: FROM_MS,
      toMs: TO_MS,
      nowMs: TO_MS + 1000,
      fetchImpl: async (_url, init) => init.method === "GET"
        ? new Response(JSON.stringify(deploymentResponse()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
        : new Response(JSON.stringify({
          errors: [{ message: `do-not-copy ${accountId} ${apiToken}` }],
        }), { status: 403 }),
    }),
    (error) => {
      assert.equal(error?.message, "telemetry_query_http_403");
      assert.doesNotMatch(String(error), new RegExp(accountId));
      assert.doesNotMatch(String(error), new RegExp(apiToken));
      return true;
    },
  );
});

test("network 예외도 URL 속 계정 ID와 자격정보를 복제하지 않는다", async () => {
  const accountId = "0123456789abcdef0123456789abcdef";
  const apiToken = "observability-secret-token";
  await assert.rejects(
    runFirstHourCheck({
      accountId,
      apiToken,
      versionId: VERSION_ID,
      checkpoint: "T+05",
      fromMs: FROM_MS,
      toMs: TO_MS,
      nowMs: TO_MS + 1000,
      fetchImpl: async (url, init) => {
        if (init.method === "GET") {
          return new Response(JSON.stringify(deploymentResponse()), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        throw new Error(`network detail ${url} ${init.headers.Authorization}`);
      },
    }),
    (error) => {
      assert.equal(error?.message, "telemetry_query_network_failed");
      assert.doesNotMatch(String(error), new RegExp(accountId));
      assert.doesNotMatch(String(error), new RegExp(apiToken));
      return true;
    },
  );
});

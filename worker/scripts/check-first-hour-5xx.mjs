import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import {
  WORKER_SERVICE,
  WORKER_VERSION_ID_PATTERN,
  verifyActiveWorkerDeployment,
} from "./worker-deployment-provenance.mjs";

const TELEMETRY_QUERY_URL_PREFIX = "https://api.cloudflare.com/client/v4/accounts";
const DATASET = "cloudflare-workers";
const WINDOW_MS = 5 * 60 * 1000;
export const FIRST_HOUR_5XX_SCHEMA = "hyeni-first-hour-5xx-v2";
export const FIRST_HOUR_5XX_CHECKPOINTS = Object.freeze(
  Array.from({ length: 12 }, (_, index) => `T+${String((index + 1) * 5).padStart(2, "0")}`),
);

function filter(key, operation, value) {
  return { kind: "filter", key, operation, type: "string", value };
}

function assertTimeframe(fromMs, toMs) {
  if (
    !Number.isSafeInteger(fromMs)
    || !Number.isSafeInteger(toMs)
    || toMs - fromMs !== WINDOW_MS
  ) {
    throw new Error("telemetry_timeframe_invalid");
  }
}

function assertVersionId(versionId) {
  if (typeof versionId !== "string" || !WORKER_VERSION_ID_PATTERN.test(versionId)) {
    throw new Error("telemetry_version_id_invalid");
  }
  return versionId.toLowerCase();
}

export function buildTelemetryQuery({ queryId, versionId, fromMs, toMs, statusClass }) {
  assertTimeframe(fromMs, toMs);
  const normalizedVersionId = assertVersionId(versionId);
  if (statusClass !== null && statusClass !== "5xx") {
    throw new Error("telemetry_status_class_invalid");
  }

  const filters = [
    filter("$metadata.service", "eq", WORKER_SERVICE),
    filter("event", "eq", "hyeni_request_outcome_v1"),
    filter("versionId", "eq", normalizedVersionId),
  ];
  if (statusClass === "5xx") {
    filters.push(filter("statusClass", "eq", "5xx"));
  }

  return {
    queryId,
    timeframe: { from: fromMs, to: toMs },
    dry: true,
    ignoreSeries: true,
    view: "calculations",
    parameters: {
      calculations: [{ operator: "count", alias: "request_count" }],
      datasets: [DATASET],
      filterCombination: "and",
      filters,
    },
  };
}

export function extractTelemetryCount(payload) {
  if (payload?.success === false) throw new Error("telemetry_response_invalid");
  const calculations = payload?.result?.calculations;
  if (!Array.isArray(calculations)) throw new Error("telemetry_response_invalid");
  const calculation = calculations.find((item) =>
    item?.alias === "request_count" && item?.calculation === "count"
  );
  if (!calculation || !Array.isArray(calculation.aggregates)) {
    throw new Error("telemetry_response_invalid");
  }
  if (calculation.aggregates.length === 0) return 0;
  if (calculation.aggregates.length !== 1) throw new Error("telemetry_response_invalid");
  const value = calculation.aggregates[0]?.value;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error("telemetry_response_invalid");
  }
  return value;
}

export function evaluateFirstHourWindow(totalRequests, serverErrors) {
  if (
    typeof totalRequests !== "number"
    || typeof serverErrors !== "number"
    || !Number.isFinite(totalRequests)
    || !Number.isFinite(serverErrors)
    || totalRequests < 0
    || serverErrors < 0
    || serverErrors > totalRequests
  ) {
    throw new Error("telemetry_counts_invalid");
  }
  if (totalRequests === 0) {
    return { totalRequests, serverErrors, errorRate: null, verdict: "inconclusive" };
  }
  const errorRate = serverErrors / totalRequests;
  return {
    totalRequests,
    serverErrors,
    errorRate,
    verdict: serverErrors >= 5 && errorRate > 0.01 ? "rollback_required" : "healthy",
  };
}

async function queryCount({ accountId, apiToken, body, fetchImpl }) {
  let response;
  try {
    response = await fetchImpl(
      `${TELEMETRY_QUERY_URL_PREFIX}/${accountId}/workers/observability/telemetry/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
  } catch {
    throw new Error("telemetry_query_network_failed");
  }
  if (!response.ok) throw new Error(`telemetry_query_http_${response.status}`);

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("telemetry_response_invalid");
  }
  return extractTelemetryCount(payload);
}

export async function runFirstHourCheck({
  accountId,
  apiToken,
  versionId,
  checkpoint,
  fromMs,
  toMs,
  nowMs = Date.now(),
  fetchImpl = globalThis.fetch,
}) {
  if (typeof accountId !== "string" || !/^[a-f0-9]{32}$/i.test(accountId)) {
    throw new Error("cloudflare_account_id_invalid");
  }
  if (typeof apiToken !== "string" || apiToken.trim().length === 0) {
    throw new Error("cloudflare_api_token_missing");
  }
  if (typeof fetchImpl !== "function") throw new Error("fetch_unavailable");
  assertTimeframe(fromMs, toMs);
  if (!Number.isSafeInteger(nowMs) || toMs > nowMs) {
    throw new Error("telemetry_verification_clock_invalid");
  }
  if (!FIRST_HOUR_5XX_CHECKPOINTS.includes(checkpoint)) {
    throw new Error("telemetry_checkpoint_invalid");
  }
  const workerVersionId = assertVersionId(versionId);
  const provenance = await verifyActiveWorkerDeployment({
    accountId,
    apiToken,
    expectedVersionId: workerVersionId,
    // 해당 deployment가 5분 창 전체에 걸쳐 활성 상태였음을 요구한다.
    observedAtMs: fromMs,
    nowMs,
    fetchImpl,
  });

  const totalQuery = buildTelemetryQuery({
    queryId: "hyeni-first-hour-total-v1",
    versionId: workerVersionId,
    fromMs,
    toMs,
    statusClass: null,
  });
  const errorQuery = buildTelemetryQuery({
    queryId: "hyeni-first-hour-5xx-v1",
    versionId: workerVersionId,
    fromMs,
    toMs,
    statusClass: "5xx",
  });
  const [totalRequests, serverErrors] = await Promise.all([
    queryCount({ accountId, apiToken, body: totalQuery, fetchImpl }),
    queryCount({ accountId, apiToken, body: errorQuery, fetchImpl }),
  ]);

  return {
    schema: FIRST_HOUR_5XX_SCHEMA,
    ...provenance,
    checkpoint,
    ...evaluateFirstHourWindow(totalRequests, serverErrors),
    fromMs,
    toMs,
  };
}

function parseArgs(argv) {
  const values = new Map();
  for (const arg of argv) {
    const match = /^--([a-z-]+)=(.+)$/.exec(arg);
    if (!match || values.has(match[1])) throw new Error("telemetry_arguments_invalid");
    values.set(match[1], match[2]);
  }
  if (![...values.keys()].every((key) => key === "checkpoint" || key === "out")) {
    throw new Error("telemetry_arguments_invalid");
  }
  const checkpoint = values.get("checkpoint");
  const outputPath = values.get("out");
  if (!checkpoint || !outputPath || !FIRST_HOUR_5XX_CHECKPOINTS.includes(checkpoint)) {
    throw new Error("telemetry_arguments_invalid");
  }
  return { checkpoint, outputPath };
}

export function writeFirstHour5xxEvidence(result, outputPath) {
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

function readWindowEndMs(value, nowMs) {
  if (value === undefined || value === "") return Math.floor(nowMs / 1000) * 1000;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("telemetry_window_end_invalid");
  }
  return parsed;
}

function formatReport(result) {
  const rate = result.errorRate === null ? "계산 불가" : `${(result.errorRate * 100).toFixed(2)}%`;
  const verdict = result.verdict === "rollback_required"
    ? "ROLLBACK_REQUIRED"
    : result.verdict === "healthy"
      ? "HEALTHY"
      : "INCONCLUSIVE";
  return [
    `증거 스키마: ${result.schema}`,
    `Worker 서비스: ${result.workerService}`,
    `Worker deployment ID: ${result.workerDeploymentId}`,
    `Worker 버전 ID: ${result.workerVersionId}`,
    `Deployment 확인 시각: ${result.deploymentVerifiedAt}`,
    `체크포인트: ${result.checkpoint}`,
    `관측 창: ${new Date(result.fromMs).toISOString()} ~ ${new Date(result.toMs).toISOString()}`,
    `전체 요청: ${result.totalRequests}`,
    `5xx 요청: ${result.serverErrors}`,
    `5xx 비율: ${rate}`,
    `판정: ${verdict}`,
  ].join("\n");
}

function safeFailureCode(error) {
  const message = error instanceof Error ? error.message : "";
  return /^(?:telemetry|worker_deployment|worker_version|cloudflare|fetch)_[a-z0-9_]+$/.test(message)
    ? message
    : "telemetry_check_failed";
}

export async function main(argv = process.argv.slice(2), env = process.env, nowMs = Date.now()) {
  try {
    const { checkpoint, outputPath } = parseArgs(argv);
    const toMs = readWindowEndMs(env.HYENI_OBSERVABILITY_WINDOW_END_MS, nowMs);
    const result = await runFirstHourCheck({
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      apiToken: env.CLOUDFLARE_API_TOKEN,
      versionId: env.HYENI_WORKER_VERSION_ID,
      checkpoint,
      fromMs: toMs - WINDOW_MS,
      toMs,
      nowMs,
    });
    writeFirstHour5xxEvidence(result, outputPath);
    console.log(formatReport(result));
    return result.verdict === "rollback_required" ? 1 : result.verdict === "inconclusive" ? 2 : 0;
  } catch (error) {
    console.error(`관측 판정 실패: ${safeFailureCode(error)}`);
    return 2;
  }
}

const isDirectRun = process.argv[1]
  && fileURLToPath(import.meta.url).toLowerCase() === resolve(process.argv[1]).toLowerCase();
if (isDirectRun) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch(() => {
      console.error("관측 판정 실패: telemetry_check_failed");
      process.exitCode = 2;
    });
}

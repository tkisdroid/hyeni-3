import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/tsModuleResolve.mjs";
const observability = await import("../lib/launchObservability.ts");
const worker = await import("../index.ts");
test("요청 결과 마커는 이벤트·버전 ID·상태 클래스만 포함한다", () => {
  assert.deepEqual(
    observability.buildRequestOutcomeLog({ id: "86d56186-c527-4564-a154-72f805073205" }, 503),
    {
      event: "hyeni_request_outcome_v1",
      versionId: "86d56186-c527-4564-a154-72f805073205",
      statusClass: "5xx",
    },
  );
  assert.equal(observability.resolveStatusClass(204), "2xx");
  assert.equal(observability.resolveStatusClass(399), "3xx");
  assert.equal(observability.resolveStatusClass(0), "other");
  assert.equal(
    observability.buildRequestOutcomeLog(undefined, 404).versionId,
    "unavailable",
  );
});

test("cron heartbeat는 작업 결과와 예외 원문을 저장하지 않는다", () => {
  const marker = observability.buildCronHeartbeatLog(
    { id: "86d56186-c527-4564-a154-72f805073205" },
    "*/5 * * * *",
    "location-staleness-check",
    "failure",
  );
  const serialized = JSON.stringify(marker);

  assert.deepEqual(marker, {
    event: "hyeni_cron_heartbeat_v1",
    versionId: "86d56186-c527-4564-a154-72f805073205",
    cron: "*/5 * * * *",
    handler: "location-staleness-check",
    status: "failure",
  });
  assert.doesNotMatch(serialized, /result|error|token|url|header|body|user|family/i);
});

test("실제 Worker 응답은 URL 없이 2xx·5xx request outcome을 각각 한 번 기록한다", async () => {
  const originalLog = console.log;
  const originalError = console.error;
  const logEntries = [];
  console.log = (...args) => logEntries.push(args);
  console.error = () => {};
  const version = { id: "86d56186-c527-4564-a154-72f805073205", tag: "", timestamp: "" };

  try {
    const ok = await worker.default.fetch(
      new Request("https://hyeni-calendar-api.example/favicon.ico?capability=do-not-log"),
      { CF_VERSION_METADATA: version },
    );
    const unavailable = await worker.default.fetch(
      new Request("https://hyeni-calendar-api.example/api/health?token=do-not-log"),
      {
        CF_VERSION_METADATA: version,
        DB: { prepare: () => { throw new Error("database-detail-do-not-log"); } },
      },
    );

    assert.equal(ok.status, 200);
    assert.equal(unavailable.status, 503);
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }

  assert.ok(logEntries.every((args) => args.length === 1));
  assert.deepEqual(logEntries.map((args) => args[0].statusClass), ["2xx", "5xx"]);
  assert.ok(logEntries.every((args) => args[0].event === "hyeni_request_outcome_v1"));
  assert.doesNotMatch(JSON.stringify(logEntries), /capability|token|example|favicon|health|database-detail/);
});

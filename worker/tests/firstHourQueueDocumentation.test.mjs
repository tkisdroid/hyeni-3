import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  operations,
  snapshotSql,
  captureScript,
  trendScript,
  observabilityOperations,
  fiveXxScript,
  fiveXxSeriesScript,
  deploymentProvenanceScript,
] = await Promise.all([
  readFile(new URL("../ops/first-hour-queue-trend.md", import.meta.url), "utf8"),
  readFile(new URL("../ops/first-hour-queue-snapshot.sql", import.meta.url), "utf8"),
  readFile(new URL("../scripts/capture-first-hour-queue-snapshot.mjs", import.meta.url), "utf8"),
  readFile(new URL("../scripts/check-first-hour-queue-trend.mjs", import.meta.url), "utf8"),
  readFile(new URL("../ops/first-hour-observability.md", import.meta.url), "utf8"),
  readFile(new URL("../scripts/check-first-hour-5xx.mjs", import.meta.url), "utf8"),
  readFile(new URL("../scripts/check-first-hour-5xx-series.mjs", import.meta.url), "utf8"),
  readFile(new URL("../scripts/worker-deployment-provenance.mjs", import.meta.url), "utf8"),
]);

test("운영 문서는 T-10·T+30·T+45·T+60 create-only 스냅샷과 자동 판정을 명시한다", () => {
  for (const checkpoint of ["T-10", "T+30", "T+45", "T+60"]) {
    assert.match(operations, new RegExp(checkpoint.replace("+", "\\+")));
  }
  assert.match(operations, /first-hour-queue-snapshot\.sql/);
  assert.match(operations, /capture-first-hour-queue-snapshot\.mjs/);
  assert.match(operations, /check-first-hour-queue-trend\.mjs/);
  assert.match(operations, /--remote --yes --json --file=ops\/first-hour-queue-snapshot\.sql/);
  assert.match(operations, /create-only/);
  assert.match(operations, /ROLLBACK_REQUIRED[\s\S]*두 구간 연속 엄격히 증가/);
  assert.match(operations, /HEALTHY[\s\S]*두 구간 연속 증가한 큐가 없다/);
  assert.match(operations, /INCONCLUSIVE[\s\S]*정상으로 간주하지 않는다/);
  assert.match(operations, /마지막 스냅샷[\s\S]*20분 이내/);
  assert.match(operations, /미래 허용 오차는 2분/);
  assert.match(operations, /전체 관측 폭은 90분 이하/);
  assert.match(operations, /HYENI_WORKER_VERSION_ID/);
  assert.match(operations, /snapshot_version_mismatch/);
  assert.match(operations, /snapshot_deployment_mismatch/);
  assert.match(operations, /Worker version/);
  assert.match(operations, /Workers Scripts Read/);
  assert.match(operations, /List Deployments API/);
  assert.match(operations, /fail-closed/);
  assert.doesNotMatch(operations, /Bearer\s+[A-Za-z0-9._-]+/);
  assert.doesNotMatch(operations, /SELECT\s+\*/i);
});

test("집계·캡처·판정 소스는 고정 schema와 개인정보 비저장 계약을 공유한다", () => {
  assert.match(snapshotSql, /고정된 집계 건수와 DB 시각/);
  assert.match(snapshotSql, /urgent_over_2m/);
  assert.match(snapshotSql, /memo_outbox_due/);
  assert.match(snapshotSql, /rtdn_retryable/);
  assert.match(snapshotSql, /web_billing_refund_reconciliation_due/);
  assert.match(snapshotSql, /web_ai_credit_refund_due/);
  assert.doesNotMatch(snapshotSql, /SELECT\s+\*/i);

  assert.match(captureScript, /hyeni-first-hour-queue-snapshot-v2/);
  assert.match(captureScript, /flag:\s*"wx"/);
  assert.match(captureScript, /queue_snapshot_columns_invalid/);
  assert.match(captureScript, /verifyActiveWorkerDeployment/);
  assert.match(captureScript, /workerDeploymentId/);
  assert.match(trendScript, /hyeni-first-hour-queue-trend-v2/);
  assert.match(trendScript, /ROLLBACK_REQUIRED/);
  assert.match(trendScript, /snapshot_version_mismatch/);
  assert.match(trendScript, /snapshot_deployment_mismatch/);
  assert.match(trendScript, /snapshot_checkpoint_sequence_invalid/);
  assert.match(trendScript, /snapshot_order_invalid/);
  assert.match(trendScript, /snapshot_clock_invalid/);
  assert.match(trendScript, /snapshot_stale/);
  assert.match(trendScript, /flag:\s*"wx"/);
});

test("5xx와 큐 결과는 실제 active deployment를 대조하는 같은 비민감 출처 계약을 가진다", () => {
  assert.match(observabilityOperations, /hyeni-first-hour-5xx-v2/);
  assert.match(observabilityOperations, /hyeni-first-hour-5xx-series-v2/);
  assert.match(observabilityOperations, /workerService=hyeni-calendar-api/);
  assert.match(observabilityOperations, /workerVersionId/);
  assert.match(observabilityOperations, /workerDeploymentId/);
  assert.match(observabilityOperations, /evidence_version_mismatch/);
  assert.match(observabilityOperations, /evidence_deployment_mismatch/);
  assert.match(observabilityOperations, /Workers Scripts Read/);
  assert.match(observabilityOperations, /check-first-hour-5xx-series\.mjs/);
  assert.match(observabilityOperations, /하이픈이 있는 UUID/);
  assert.match(fiveXxScript, /hyeni-first-hour-5xx-v2/);
  assert.match(fiveXxScript, /verifyActiveWorkerDeployment/);
  assert.match(fiveXxScript, /flag:\s*"wx"/);
  assert.match(fiveXxScript, /workerVersionId/);
  assert.match(fiveXxSeriesScript, /hyeni-first-hour-5xx-series-v2/);
  assert.match(fiveXxSeriesScript, /evidence_version_mismatch/);
  assert.match(fiveXxSeriesScript, /evidence_deployment_mismatch/);
  assert.match(fiveXxSeriesScript, /flag:\s*"wx"/);
  assert.match(deploymentProvenanceScript, /\/deployments/);
  assert.match(deploymentProvenanceScript, /percentage !== 100/);
  assert.match(deploymentProvenanceScript, /worker_deployment_version_mismatch/);
  assert.doesNotMatch(observabilityOperations, /Bearer\s+[A-Za-z0-9._-]+/);
});

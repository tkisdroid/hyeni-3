import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  buildQueueSnapshot,
  captureQueueSnapshot,
  parseWranglerQueueAggregate,
  QUEUE_METRIC_NAMES,
  QUEUE_SNAPSHOT_SCHEMA,
  WORKER_SERVICE,
} from "../scripts/capture-first-hour-queue-snapshot.mjs";
import {
  evaluateQueueTrend,
  main as runQueueTrendCli,
  parseQueueSnapshot,
  QUEUE_TREND_MAX_FUTURE_MS,
  QUEUE_TREND_MAX_NEWEST_AGE_MS,
  QUEUE_TREND_MAX_SPAN_MS,
} from "../scripts/check-first-hour-queue-trend.mjs";

const canonicalSchema = readFileSync(
  new URL("../../cloudflare/schema_d1.sql", import.meta.url),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../ops/first-hour-queue-snapshot.sql", import.meta.url),
  "utf8",
);

const NOW_MS = Date.UTC(2026, 7, 2, 10, 0, 0);
const VERSION_ID = "86d56186-c527-4564-a154-72f805073205";
const OTHER_VERSION_ID = "182bd5e5-6e1a-4fe4-a799-aa6d9a6ab26e";
const DEPLOYMENT_ID = "918bd5e5-6e1a-4fe4-a799-aa6d9a6ab26e";
const OTHER_DEPLOYMENT_ID = "a18bd5e5-6e1a-4fe4-a799-aa6d9a6ab26e";
const DEPLOYMENT_CREATED_AT = "2026-08-02T08:00:00.000Z";

function provenance(workerVersionId = VERSION_ID, workerDeploymentId = DEPLOYMENT_ID) {
  return {
    workerService: WORKER_SERVICE,
    workerDeploymentId,
    workerDeploymentCreatedAt: DEPLOYMENT_CREATED_AT,
    workerVersionId,
    deploymentVerifiedAt: new Date(NOW_MS).toISOString(),
  };
}

function activeDeploymentResponse(
  workerVersionId = VERSION_ID,
  workerDeploymentId = DEPLOYMENT_ID,
) {
  return new Response(JSON.stringify({
    success: true,
    result: {
      deployments: [{
        id: workerDeploymentId,
        created_on: DEPLOYMENT_CREATED_AT,
        strategy: "percentage",
        versions: [{ percentage: 100, version_id: workerVersionId }],
      }],
    },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function metrics(overrides = {}) {
  return Object.fromEntries(
    QUEUE_METRIC_NAMES.map((name) => [name, overrides[name] ?? 0]),
  );
}

function snapshot(
  checkpoint,
  capturedAtMs,
  overrides = {},
  workerVersionId = VERSION_ID,
  workerDeploymentId = DEPLOYMENT_ID,
) {
  return {
    schema: QUEUE_SNAPSHOT_SCHEMA,
    workerService: WORKER_SERVICE,
    workerDeploymentId,
    workerDeploymentCreatedAt: DEPLOYMENT_CREATED_AT,
    workerVersionId,
    deploymentVerifiedAt: new Date(NOW_MS).toISOString(),
    checkpoint,
    capturedAt: new Date(capturedAtMs).toISOString(),
    metrics: metrics(overrides),
  };
}

function wranglerPayload(row) {
  return JSON.stringify([{ success: true, results: [row], meta: { rows_read: 1 } }]);
}

test("집계 SQL은 정본 빈 D1에서 한 행·고정 컬럼·0건으로 실행된다", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(canonicalSchema);
    const row = db.prepare(snapshotSql).get();
    assert.deepEqual(
      Object.keys(row).sort(),
      ["captured_at", ...QUEUE_METRIC_NAMES].sort(),
    );
    assert.match(String(row.captured_at), /^\d{4}-\d{2}-\d{2}T/);
    for (const name of QUEUE_METRIC_NAMES) assert.equal(row[name], 0, name);
    assert.doesNotMatch(snapshotSql, /SELECT\s+\*/i);
    assert.doesNotMatch(
      snapshotSql.slice(snapshotSql.lastIndexOf("SELECT")),
      /(?:user|family|parent|child|order|token|message|reply)_id|customer_key|payment_key/i,
    );
  } finally {
    db.close();
  }
});

test("집계 SQL은 실제 due 행만 11개 고정 큐에 포함한다", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(canonicalSchema);
    db.exec(`
      INSERT INTO pending_notifications
        (id,family_id,title,body,created_at,delivered,data,expires_at)
      VALUES
        ('urgent-due','family-a','title','body',datetime('now','-3 minutes'),0,'{"urgent":true}',datetime('now','+1 hour')),
        ('urgent-recent','family-a','title','body',datetime('now','-1 minute'),0,'{"urgent":true}',datetime('now','+1 hour')),
        ('urgent-delivered','family-a','title','body',datetime('now','-3 minutes'),1,'{"urgent":true}',datetime('now','+1 hour')),
        ('urgent-expired','family-a','title','body',datetime('now','-3 minutes'),0,'{"urgent":true}',datetime('now','-1 minute'));

      INSERT INTO memo_notification_outbox
        (reply_id,family_id,next_attempt_at,lease_token,lease_expires_at,created_at,updated_at)
      VALUES
        ('memo-due','family-a',datetime('now','-1 minute'),NULL,NULL,datetime('now','-2 minutes'),datetime('now')),
        ('memo-future','family-a',datetime('now','+1 hour'),NULL,NULL,datetime('now'),datetime('now')),
        ('memo-leased','family-a',datetime('now','-1 minute'),'lease',datetime('now','+1 hour'),datetime('now'),datetime('now'));

      INSERT INTO google_play_rtdn_events
        (message_id,package_name,event_kind,status,attempts,claim_token,event_time_ms)
      VALUES
        ('rtdn-due','com.hyeni.calendar','test','retryable',1,'claim-a',1),
        ('rtdn-processing','com.hyeni.calendar','test','processing',1,'claim-b',2);

      INSERT INTO google_play_voided_purchase_events
        (message_id,package_name,purchase_token_hash,product_type,refund_type,status,attempts,claim_token,event_time_ms)
      VALUES
        ('voided-due','com.hyeni.calendar','hash-a',1,1,'retryable',1,'claim-c',3),
        ('voided-processed','com.hyeni.calendar','hash-b',1,1,'processed',1,'claim-d',4);

      INSERT INTO web_billing_customers
        (family_id,parent_id,customer_key,billing_key_ciphertext,billing_key_iv,billing_key_version,
         billing_key_revocation_status,plan,status,trial_ends_at)
      VALUES
        ('family-trial','parent-trial','customer-trial','cipher','iv','v1','pending','month','pending_charge',datetime('now','+7 days'));

      INSERT INTO web_billing_checkout_sessions
        (id,family_id,parent_id,customer_key,plan,amount,trial_eligible,trial_days,status,expires_at)
      VALUES
        ('session-trial','family-trial','parent-trial','customer-trial','month',4900,1,7,'pending',datetime('now','+15 minutes'));

      INSERT INTO web_billing_charge_attempts
        (order_id,family_id,checkout_session_id,plan,amount,kind,customer_key,period_start,period_end,status)
      VALUES
        ('order-initial','family-trial','session-trial','month',4900,'initial','customer-trial',datetime('now'),datetime('now','+1 month'),'pending');

      INSERT INTO web_billing_customers
        (family_id,parent_id,customer_key,billing_key_ciphertext,billing_key_iv,billing_key_version,
         plan,status,current_period_end,next_charge_at)
      VALUES
        ('family-renewal','parent-renewal','customer-renewal','cipher','iv','v1',
         'month','active',datetime('now'),datetime('now','-1 minute'));

      INSERT INTO billing_provider_reservations
        (family_id,provider,state,reservation_ref)
      VALUES ('family-renewal','toss_web','active','reservation-renewal');

      INSERT INTO web_billing_charge_attempts
        (order_id,family_id,plan,amount,kind,period_start,period_end,status,completed_at)
      VALUES
        ('order-refund-reconcile','family-refund','month',4900,'renewal',datetime('now','-1 month'),datetime('now'),'done',datetime('now'));

      INSERT INTO web_billing_charge_attempts
        (order_id,family_id,plan,amount,kind,period_start,period_end,status,refund_status,
         refunded_amount,refund_state_hash,refund_committed_at,refund_funnel_status,completed_at)
      VALUES
        ('order-refund-funnel','family-funnel','month',4900,'renewal',datetime('now','-1 month'),datetime('now'),
         'done','full',4900,lower(hex(zeroblob(32))),datetime('now'),'pending',datetime('now'));

      INSERT INTO web_ai_credit_orders
        (order_id,family_id,parent_id,child_user_id,customer_key,product_code,credits,amount,status,
         expires_at,idempotency_key)
      VALUES
        ('ai-recovery','family-ai','parent-ai','child-ai','ai-customer-recovery','ai-credit-30',30,1000,
         'unknown',datetime('now','+1 hour'),'ai-idempotency-recovery'),
        ('ai-refund','family-ai','parent-ai','child-ai','ai-customer-refund','ai-credit-30',30,1000,
         'refund_unknown',datetime('now','+1 hour'),'ai-idempotency-refund');
    `);

    const row = db.prepare(snapshotSql).get();
    assert.deepEqual({ ...row }, {
      captured_at: row.captured_at,
      urgent_over_2m: 1,
      memo_outbox_due: 1,
      rtdn_retryable: 2,
      web_billing_trial_activation_due: 1,
      web_billing_initial_reconciliation_due: 1,
      web_billing_renewal_due: 1,
      web_billing_key_revocation_due: 1,
      web_billing_refund_reconciliation_due: 1,
      web_billing_refund_funnel_pending: 1,
      web_ai_credit_recovery_due: 1,
      web_ai_credit_refund_due: 1,
    });
  } finally {
    db.close();
  }
});

test("Wrangler 결과는 예상 집계 컬럼만 엄격히 받아 스냅샷으로 변환한다", () => {
  const row = {
    captured_at: "2026-08-02T10:00:00.000Z",
    ...metrics({ urgent_over_2m: 2, memo_outbox_due: 3 }),
  };
  const aggregate = parseWranglerQueueAggregate(wranglerPayload(row));
  assert.equal(aggregate.capturedAt, "2026-08-02T10:00:00.000Z");
  assert.equal(aggregate.metrics.urgent_over_2m, 2);
  assert.equal(aggregate.metrics.memo_outbox_due, 3);

  const built = buildQueueSnapshot(aggregate, "T-10", {
    ...provenance(),
    deploymentVerifiedAt: "2026-08-02T10:01:00.000Z",
  });
  assert.deepEqual(parseQueueSnapshot(built).metrics, aggregate.metrics);
  assert.equal(parseQueueSnapshot(built).workerVersionId, VERSION_ID);
  assert.throws(
    () => buildQueueSnapshot(aggregate, "T-10", {
      ...provenance(),
      workerVersionId: "not-a-worker-version",
    }),
    /worker_version_id_invalid/,
  );
  assert.throws(
    () => parseWranglerQueueAggregate(wranglerPayload({ ...row, family_id: "must-reject" })),
    /queue_snapshot_columns_invalid/,
  );
  assert.throws(
    () => parseWranglerQueueAggregate(wranglerPayload({ ...row, memo_outbox_due: -1 })),
    /queue_snapshot_count_invalid/,
  );
  assert.throws(
    () => parseWranglerQueueAggregate(wranglerPayload({
      ...row,
      captured_at: "2026-02-31T10:00:00.000Z",
    })),
    /queue_snapshot_captured_at_invalid/,
  );
  assert.throws(() => parseWranglerQueueAggregate("not-json"), /queue_snapshot_json_invalid/);
});

test("스냅샷 증거 파일은 현재 100% deployment를 검증한 뒤 create-only로 남긴다", async () => {
  const directory = mkdtempSync(join(tmpdir(), "hyeni-queue-snapshot-"));
  const outputPath = join(directory, "snapshot.json");
  const row = {
    captured_at: "2026-08-02T10:00:00.000Z",
    ...metrics(),
  };
  try {
    await captureQueueSnapshot({
      input: wranglerPayload(row),
      checkpoint: "T-10",
      outputPath,
      workerVersionId: VERSION_ID,
      accountId: "0123456789abcdef0123456789abcdef",
      apiToken: "worker-read-token",
      fetchImpl: async () => activeDeploymentResponse(),
      nowMs: NOW_MS,
    });
    await assert.rejects(
      captureQueueSnapshot({
        input: wranglerPayload(row),
        checkpoint: "T-10",
        outputPath,
        workerVersionId: VERSION_ID,
        accountId: "0123456789abcdef0123456789abcdef",
        apiToken: "worker-read-token",
        fetchImpl: async () => activeDeploymentResponse(),
        nowMs: NOW_MS,
      }),
      /EEXIST/,
    );
    const stored = JSON.parse(readFileSync(outputPath, "utf8"));
    assert.equal(stored.schema, QUEUE_SNAPSHOT_SCHEMA);
    assert.deepEqual(
      Object.keys(stored).sort(),
      [
        "capturedAt",
        "checkpoint",
        "deploymentVerifiedAt",
        "metrics",
        "schema",
        "workerDeploymentCreatedAt",
        "workerDeploymentId",
        "workerService",
        "workerVersionId",
      ],
    );
    assert.equal(stored.workerService, WORKER_SERVICE);
    assert.equal(stored.workerDeploymentId, DEPLOYMENT_ID);
    assert.equal(stored.workerVersionId, VERSION_ID);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("환경 version이 실제 deployment와 다르면 스냅샷 파일을 만들지 않는다", async () => {
  const directory = mkdtempSync(join(tmpdir(), "hyeni-queue-provenance-"));
  const outputPath = join(directory, "snapshot.json");
  const row = {
    captured_at: "2026-08-02T10:00:00.000Z",
    ...metrics(),
  };
  try {
    await assert.rejects(
      captureQueueSnapshot({
        input: wranglerPayload(row),
        checkpoint: "T-10",
        outputPath,
        workerVersionId: VERSION_ID,
        accountId: "0123456789abcdef0123456789abcdef",
        apiToken: "worker-read-token",
        fetchImpl: async () => activeDeploymentResponse(OTHER_VERSION_ID),
        nowMs: NOW_MS,
      }),
      /worker_deployment_version_mismatch/,
    );
    assert.equal(existsSync(outputPath), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("스냅샷 3개 미만과 형식 위반은 INCONCLUSIVE다", () => {
  assert.deepEqual(
    evaluateQueueTrend([
      snapshot("T-10", NOW_MS - 50 * 60_000),
      snapshot("T+30", NOW_MS - 10 * 60_000),
    ], NOW_MS).verdict,
    "INCONCLUSIVE",
  );
  const malformed = snapshot("T+45", NOW_MS - 5 * 60_000);
  malformed.userId = "must-reject";
  const result = evaluateQueueTrend([
    snapshot("T-10", NOW_MS - 50 * 60_000),
    snapshot("T+30", NOW_MS - 10 * 60_000),
    malformed,
  ], NOW_MS);
  assert.equal(result.verdict, "INCONCLUSIVE");
  assert.equal(result.reason, "snapshot_invalid");
});

test("Worker provenance 형식 위반과 스냅샷 간 version/deployment 불일치는 fail-closed한다", () => {
  const invalid = snapshot("T+45", NOW_MS - 5 * 60_000);
  invalid.workerVersionId = "secret/value-must-not-copy";
  const invalidResult = evaluateQueueTrend([
    snapshot("T-10", NOW_MS - 50 * 60_000),
    snapshot("T+30", NOW_MS - 10 * 60_000),
    invalid,
  ], NOW_MS);
  assert.equal(invalidResult.verdict, "INCONCLUSIVE");
  assert.equal(invalidResult.reason, "snapshot_invalid");
  assert.equal(invalidResult.workerVersionId, null);
  assert.doesNotMatch(JSON.stringify(invalidResult), /secret\/value-must-not-copy/);

  const mismatch = evaluateQueueTrend([
    snapshot("T-10", NOW_MS - 50 * 60_000),
    snapshot("T+30", NOW_MS - 10 * 60_000),
    snapshot("T+45", NOW_MS - 5 * 60_000, {}, OTHER_VERSION_ID),
  ], NOW_MS);
  assert.equal(mismatch.verdict, "INCONCLUSIVE");
  assert.equal(mismatch.reason, "snapshot_version_mismatch");
  assert.equal(mismatch.workerVersionId, null);

  const deploymentMismatch = evaluateQueueTrend([
    snapshot("T-10", NOW_MS - 50 * 60_000),
    snapshot("T+30", NOW_MS - 10 * 60_000),
    snapshot("T+45", NOW_MS - 5 * 60_000, {}, VERSION_ID, OTHER_DEPLOYMENT_ID),
  ], NOW_MS);
  assert.equal(deploymentMismatch.verdict, "INCONCLUSIVE");
  assert.equal(deploymentMismatch.reason, "snapshot_deployment_mismatch");
  assert.equal(deploymentMismatch.workerVersionId, VERSION_ID);
  assert.equal(deploymentMismatch.workerDeploymentId, null);
});

test("입력 파일 누락은 개인정보나 경로를 복제하지 않는 INCONCLUSIVE 증거를 남긴다", () => {
  const directory = mkdtempSync(join(tmpdir(), "hyeni-queue-trend-"));
  const outputPath = join(directory, "trend.json");
  try {
    const exitCode = runQueueTrendCli([
      join(directory, "missing-t-minus-10.json"),
      join(directory, "missing-t-plus-30.json"),
      join(directory, "missing-t-plus-45.json"),
      `--out=${outputPath}`,
    ], NOW_MS);
    assert.equal(exitCode, 2);
    const reportText = readFileSync(outputPath, "utf8");
    const report = JSON.parse(reportText);
    assert.equal(report.verdict, "INCONCLUSIVE");
    assert.equal(report.reason, "snapshot_read_failed");
    assert.doesNotMatch(reportText, /missing-t-minus|hyeni-queue-trend-/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("오래된 최신 스냅샷과 미래 시각은 INCONCLUSIVE다", () => {
  const stale = evaluateQueueTrend([
    snapshot("T-10", NOW_MS - 70 * 60_000),
    snapshot("T+30", NOW_MS - 40 * 60_000),
    snapshot("T+45", NOW_MS - QUEUE_TREND_MAX_NEWEST_AGE_MS - 1),
  ], NOW_MS);
  assert.equal(stale.verdict, "INCONCLUSIVE");
  assert.equal(stale.reason, "snapshot_stale");

  const futureSnapshot = snapshot(
    "T+45",
    NOW_MS + QUEUE_TREND_MAX_FUTURE_MS + 1,
  );
  futureSnapshot.deploymentVerifiedAt = new Date(
    NOW_MS + QUEUE_TREND_MAX_FUTURE_MS + 1,
  ).toISOString();
  const future = evaluateQueueTrend([
    snapshot("T-10", NOW_MS - 10 * 60_000),
    snapshot("T+30", NOW_MS),
    futureSnapshot,
  ], NOW_MS);
  assert.equal(future.verdict, "INCONCLUSIVE");
  assert.equal(future.reason, "snapshot_clock_invalid");

  const invalidCalendar = snapshot("T+45", NOW_MS - 5 * 60_000);
  invalidCalendar.capturedAt = "2026-08-02T24:00:00.000Z";
  assert.throws(() => parseQueueSnapshot(invalidCalendar), /queue_snapshot_clock_invalid/);

  const excessiveSpan = evaluateQueueTrend([
    snapshot("T-10", NOW_MS - QUEUE_TREND_MAX_SPAN_MS - 5 * 60_000 - 1),
    snapshot("T+30", NOW_MS - 10 * 60_000),
    snapshot("T+45", NOW_MS - 5 * 60_000),
  ], NOW_MS);
  assert.equal(excessiveSpan.verdict, "INCONCLUSIVE");
  assert.equal(excessiveSpan.reason, "snapshot_span_invalid");
});

test("checkpoint 또는 측정 시각 순서가 역전되면 INCONCLUSIVE다", () => {
  const checkpointOrder = evaluateQueueTrend([
    snapshot("T+30", NOW_MS - 15 * 60_000),
    snapshot("T-10", NOW_MS - 10 * 60_000),
    snapshot("T+45", NOW_MS - 5 * 60_000),
  ], NOW_MS);
  assert.equal(checkpointOrder.reason, "snapshot_checkpoint_sequence_invalid");

  const missingCheckpoint = evaluateQueueTrend([
    snapshot("T-10", NOW_MS - 50 * 60_000),
    snapshot("T+45", NOW_MS - 10 * 60_000),
    snapshot("T+60", NOW_MS - 5 * 60_000),
  ], NOW_MS);
  assert.equal(missingCheckpoint.verdict, "INCONCLUSIVE");
  assert.equal(missingCheckpoint.reason, "snapshot_checkpoint_sequence_invalid");

  const clockOrder = evaluateQueueTrend([
    snapshot("T-10", NOW_MS - 15 * 60_000),
    snapshot("T+30", NOW_MS - 5 * 60_000),
    snapshot("T+45", NOW_MS - 10 * 60_000),
  ], NOW_MS);
  assert.equal(clockOrder.reason, "snapshot_order_invalid");
});

test("같은 큐가 두 구간 연속 증가할 때만 ROLLBACK_REQUIRED다", () => {
  const result = evaluateQueueTrend([
    snapshot("T-10", NOW_MS - 50 * 60_000, { memo_outbox_due: 1 }),
    snapshot("T+30", NOW_MS - 10 * 60_000, { memo_outbox_due: 2 }),
    snapshot("T+45", NOW_MS - 5 * 60_000, { memo_outbox_due: 3 }),
  ], NOW_MS);
  assert.equal(result.verdict, "ROLLBACK_REQUIRED");
  assert.equal(result.workerService, WORKER_SERVICE);
  assert.equal(result.workerDeploymentId, DEPLOYMENT_ID);
  assert.equal(result.workerVersionId, VERSION_ID);
  assert.deepEqual(result.increasingMetrics, ["memo_outbox_due"]);
  assert.equal(result.reason, "two_consecutive_increases");
});

test("한 구간만 증가하거나 감소·정체하면 HEALTHY다", () => {
  const singleIncrease = evaluateQueueTrend([
    snapshot("T-10", NOW_MS - 50 * 60_000, { rtdn_retryable: 1 }),
    snapshot("T+30", NOW_MS - 10 * 60_000, { rtdn_retryable: 3 }),
    snapshot("T+45", NOW_MS - 5 * 60_000, { rtdn_retryable: 2 }),
  ], NOW_MS);
  assert.equal(singleIncrease.verdict, "HEALTHY");

  const decreasing = evaluateQueueTrend([
    snapshot("T-10", NOW_MS - 50 * 60_000, { web_billing_refund_reconciliation_due: 4 }),
    snapshot("T+30", NOW_MS - 10 * 60_000, { web_billing_refund_reconciliation_due: 3 }),
    snapshot("T+45", NOW_MS - 5 * 60_000, { web_billing_refund_reconciliation_due: 3 }),
  ], NOW_MS);
  assert.equal(decreasing.verdict, "HEALTHY");
  assert.deepEqual(decreasing.increasingMetrics, []);
});

test("T+60 최종 판정은 정확히 네 checkpoint 전체만 허용한다", () => {
  const complete = evaluateQueueTrend([
    snapshot("T-10", NOW_MS - 70 * 60_000),
    snapshot("T+30", NOW_MS - 30 * 60_000),
    snapshot("T+45", NOW_MS - 15 * 60_000),
    snapshot("T+60", NOW_MS),
  ], NOW_MS);
  assert.equal(complete.verdict, "HEALTHY");
  assert.equal(complete.snapshotCount, 4);

  const extra = evaluateQueueTrend([
    snapshot("T-10", NOW_MS - 70 * 60_000),
    snapshot("T+30", NOW_MS - 30 * 60_000),
    snapshot("T+45", NOW_MS - 15 * 60_000),
    snapshot("T+60", NOW_MS),
    snapshot("T+60", NOW_MS + 1000),
  ], NOW_MS + 1000);
  assert.equal(extra.verdict, "INCONCLUSIVE");
  assert.equal(extra.reason, "unexpected_snapshot_count");
});

test("CLI는 HEALTHY와 ROLLBACK_REQUIRED를 각각 exit 0과 1로 반환한다", () => {
  const directory = mkdtempSync(join(tmpdir(), "hyeni-queue-trend-exit-"));
  const paths = ["t-minus-10.json", "t-plus-30.json", "t-plus-45.json"]
    .map((name) => join(directory, name));
  try {
    const writeSnapshots = (values) => {
      values.forEach((value, index) => {
        writeFileSync(paths[index], `${JSON.stringify(value)}\n`, "utf8");
      });
    };

    writeSnapshots([
      snapshot("T-10", NOW_MS - 50 * 60_000, { memo_outbox_due: 3 }),
      snapshot("T+30", NOW_MS - 10 * 60_000, { memo_outbox_due: 2 }),
      snapshot("T+45", NOW_MS - 5 * 60_000, { memo_outbox_due: 2 }),
    ]);
    const healthyOutput = join(directory, "healthy.json");
    assert.equal(runQueueTrendCli([...paths, `--out=${healthyOutput}`], NOW_MS), 0);
    assert.equal(JSON.parse(readFileSync(healthyOutput, "utf8")).verdict, "HEALTHY");

    writeSnapshots([
      snapshot("T-10", NOW_MS - 50 * 60_000, { memo_outbox_due: 1 }),
      snapshot("T+30", NOW_MS - 10 * 60_000, { memo_outbox_due: 2 }),
      snapshot("T+45", NOW_MS - 5 * 60_000, { memo_outbox_due: 3 }),
    ]);
    const rollbackOutput = join(directory, "rollback.json");
    assert.equal(runQueueTrendCli([...paths, `--out=${rollbackOutput}`], NOW_MS), 1);
    assert.equal(JSON.parse(readFileSync(rollbackOutput, "utf8")).verdict, "ROLLBACK_REQUIRED");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

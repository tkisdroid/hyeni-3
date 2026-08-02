import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  WORKER_SERVICE,
  WORKER_VERSION_ID_PATTERN,
  parseDeploymentTimestamp,
  parseWorkerDeploymentId,
  parseWorkerVersionId,
  verifyActiveWorkerDeployment,
} from "./worker-deployment-provenance.mjs";

export {
  WORKER_SERVICE,
  WORKER_VERSION_ID_PATTERN,
  parseWorkerDeploymentId,
  parseWorkerVersionId,
};

export const QUEUE_SNAPSHOT_SCHEMA = "hyeni-first-hour-queue-snapshot-v2";
export const QUEUE_CHECKPOINTS = Object.freeze(["T-10", "T+30", "T+45", "T+60"]);
export const QUEUE_METRIC_NAMES = Object.freeze([
  "urgent_over_2m",
  "memo_outbox_due",
  "rtdn_retryable",
  "web_billing_trial_activation_due",
  "web_billing_initial_reconciliation_due",
  "web_billing_renewal_due",
  "web_billing_key_revocation_due",
  "web_billing_refund_reconciliation_due",
  "web_billing_refund_funnel_pending",
  "web_ai_credit_recovery_due",
  "web_ai_credit_refund_due",
]);

const ROW_KEYS = Object.freeze(["captured_at", ...QUEUE_METRIC_NAMES]);

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function parseCapturedAt(value) {
  if (typeof value !== "string") {
    throw new Error("queue_snapshot_captured_at_invalid");
  }
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
  if (!match) throw new Error("queue_snapshot_captured_at_invalid");
  const canonical = `${match[1]}.${(match[2] ?? "").padEnd(3, "0")}Z`;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== canonical) {
    throw new Error("queue_snapshot_captured_at_invalid");
  }
  return canonical;
}

function parseCount(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("queue_snapshot_count_invalid");
  }
  return value;
}

export function parseWranglerQueueAggregate(input) {
  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    throw new Error("queue_snapshot_json_invalid");
  }
  if (!Array.isArray(payload) || payload.length !== 1) {
    throw new Error("queue_snapshot_result_invalid");
  }
  const statement = payload[0];
  if (
    !statement
    || typeof statement !== "object"
    || statement.success !== true
    || !Array.isArray(statement.results)
    || statement.results.length !== 1
  ) {
    throw new Error("queue_snapshot_result_invalid");
  }
  const row = statement.results[0];
  if (!exactKeys(row, ROW_KEYS)) {
    throw new Error("queue_snapshot_columns_invalid");
  }
  return {
    capturedAt: parseCapturedAt(row.captured_at),
    metrics: Object.fromEntries(
      QUEUE_METRIC_NAMES.map((name) => [name, parseCount(row[name])]),
    ),
  };
}

export function buildQueueSnapshot(input, checkpoint, provenance) {
  if (!QUEUE_CHECKPOINTS.includes(checkpoint)) {
    throw new Error("queue_snapshot_checkpoint_invalid");
  }
  const workerService = provenance?.workerService;
  if (workerService !== WORKER_SERVICE) throw new Error("queue_snapshot_worker_service_invalid");
  const workerVersionId = parseWorkerVersionId(provenance?.workerVersionId);
  const workerDeploymentId = parseWorkerDeploymentId(provenance?.workerDeploymentId);
  const workerDeploymentCreatedAt = parseDeploymentTimestamp(
    provenance?.workerDeploymentCreatedAt,
  );
  const deploymentVerifiedAt = parseDeploymentTimestamp(provenance?.deploymentVerifiedAt);
  const capturedAtMs = Date.parse(input.capturedAt);
  if (
    Date.parse(workerDeploymentCreatedAt) > capturedAtMs
    || capturedAtMs > Date.parse(deploymentVerifiedAt)
  ) {
    throw new Error("queue_snapshot_provenance_clock_invalid");
  }
  return {
    schema: QUEUE_SNAPSHOT_SCHEMA,
    workerService,
    workerDeploymentId,
    workerDeploymentCreatedAt,
    workerVersionId,
    deploymentVerifiedAt,
    checkpoint,
    capturedAt: input.capturedAt,
    metrics: input.metrics,
  };
}

function parseArgs(argv) {
  const values = new Map();
  for (const arg of argv) {
    const match = /^--([a-z-]+)=(.+)$/.exec(arg);
    if (!match || values.has(match[1])) throw new Error("queue_snapshot_arguments_invalid");
    values.set(match[1], match[2]);
  }
  if (![...values.keys()].every((key) => key === "checkpoint" || key === "out")) {
    throw new Error("queue_snapshot_arguments_invalid");
  }
  const checkpoint = values.get("checkpoint");
  const outputPath = values.get("out");
  if (!checkpoint || !outputPath) throw new Error("queue_snapshot_arguments_invalid");
  return { checkpoint, outputPath };
}

export async function captureQueueSnapshot({
  input,
  checkpoint,
  outputPath,
  workerVersionId,
  accountId,
  apiToken,
  fetchImpl = globalThis.fetch,
  nowMs = Date.now(),
}) {
  const aggregate = parseWranglerQueueAggregate(input);
  const provenance = await verifyActiveWorkerDeployment({
    accountId,
    apiToken,
    expectedVersionId: workerVersionId,
    observedAtMs: Date.parse(aggregate.capturedAt),
    fetchImpl,
    nowMs,
  });
  const snapshot = buildQueueSnapshot(aggregate, checkpoint, provenance);
  writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  return snapshot;
}

function safeFailureCode(error) {
  const message = error instanceof Error ? error.message : "";
  return /^(?:queue_snapshot|worker_deployment|worker_version|cloudflare|fetch)_[a-z0-9_]+$/.test(message)
    ? message
    : "queue_snapshot_capture_failed";
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  try {
    const { checkpoint, outputPath } = parseArgs(argv);
    const input = readFileSync(0, "utf8");
    const snapshot = await captureQueueSnapshot({
      input,
      checkpoint,
      outputPath,
      workerVersionId: env.HYENI_WORKER_VERSION_ID,
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      apiToken: env.CLOUDFLARE_API_TOKEN,
    });
    console.log(`운영 큐 스냅샷 저장 완료: ${snapshot.checkpoint}`);
    return 0;
  } catch (error) {
    const code = safeFailureCode(error);
    console.error(`운영 큐 스냅샷 저장 실패: ${code}`);
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
      console.error("운영 큐 스냅샷 저장 실패: queue_snapshot_capture_failed");
      process.exitCode = 2;
    });
}

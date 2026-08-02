import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  QUEUE_CHECKPOINTS,
  QUEUE_METRIC_NAMES,
  QUEUE_SNAPSHOT_SCHEMA,
  WORKER_SERVICE,
  parseWorkerDeploymentId,
  parseWorkerVersionId,
} from "./capture-first-hour-queue-snapshot.mjs";
import { parseDeploymentTimestamp } from "./worker-deployment-provenance.mjs";

export const QUEUE_TREND_SCHEMA = "hyeni-first-hour-queue-trend-v2";
export const QUEUE_TREND_MAX_FUTURE_MS = 2 * 60 * 1000;
export const QUEUE_TREND_MAX_NEWEST_AGE_MS = 20 * 60 * 1000;
export const QUEUE_TREND_MAX_SPAN_MS = 90 * 60 * 1000;

const SNAPSHOT_KEYS = Object.freeze([
  "schema",
  "workerService",
  "workerDeploymentId",
  "workerDeploymentCreatedAt",
  "workerVersionId",
  "deploymentVerifiedAt",
  "checkpoint",
  "capturedAt",
  "metrics",
]);

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

export function parseQueueSnapshot(value) {
  if (!exactKeys(value, SNAPSHOT_KEYS)) throw new Error("queue_snapshot_schema_invalid");
  if (value.schema !== QUEUE_SNAPSHOT_SCHEMA) throw new Error("queue_snapshot_schema_invalid");
  if (value.workerService !== WORKER_SERVICE) {
    throw new Error("queue_snapshot_worker_service_invalid");
  }
  const workerVersionId = parseWorkerVersionId(value.workerVersionId);
  const workerDeploymentId = parseWorkerDeploymentId(value.workerDeploymentId);
  const workerDeploymentCreatedAt = parseDeploymentTimestamp(value.workerDeploymentCreatedAt);
  const deploymentVerifiedAt = parseDeploymentTimestamp(value.deploymentVerifiedAt);
  if (!QUEUE_CHECKPOINTS.includes(value.checkpoint)) {
    throw new Error("queue_snapshot_checkpoint_invalid");
  }
  if (
    typeof value.capturedAt !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.capturedAt)
  ) {
    throw new Error("queue_snapshot_clock_invalid");
  }
  const capturedAtDate = new Date(value.capturedAt);
  if (
    !Number.isFinite(capturedAtDate.getTime())
    || capturedAtDate.toISOString() !== value.capturedAt
  ) {
    throw new Error("queue_snapshot_clock_invalid");
  }
  if (
    Date.parse(workerDeploymentCreatedAt) > capturedAtDate.getTime()
    || capturedAtDate.getTime() > Date.parse(deploymentVerifiedAt)
  ) {
    throw new Error("queue_snapshot_provenance_clock_invalid");
  }
  if (!exactKeys(value.metrics, QUEUE_METRIC_NAMES)) {
    throw new Error("queue_snapshot_metrics_invalid");
  }
  const metrics = {};
  for (const name of QUEUE_METRIC_NAMES) {
    const count = value.metrics[name];
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error("queue_snapshot_metrics_invalid");
    }
    metrics[name] = count;
  }
  return {
    schema: value.schema,
    workerService: value.workerService,
    workerDeploymentId,
    workerDeploymentCreatedAt,
    workerVersionId,
    deploymentVerifiedAt,
    checkpoint: value.checkpoint,
    capturedAt: value.capturedAt,
    capturedAtMs: capturedAtDate.getTime(),
    metrics,
  };
}

function inconclusive(
  snapshotCount,
  reason,
  evaluatedAt,
  {
    workerDeploymentId = null,
    workerDeploymentCreatedAt = null,
    workerVersionId = null,
  } = {},
) {
  return {
    schema: QUEUE_TREND_SCHEMA,
    workerService: WORKER_SERVICE,
    workerDeploymentId,
    workerDeploymentCreatedAt,
    workerVersionId,
    evaluatedAt,
    verdict: "INCONCLUSIVE",
    reason,
    snapshotCount,
    increasingMetrics: [],
  };
}

export function evaluateQueueTrend(rawSnapshots, nowMs = Date.now()) {
  const evaluatedAt = Number.isSafeInteger(nowMs) && nowMs > 0
    ? new Date(nowMs).toISOString()
    : null;
  if (!evaluatedAt) return inconclusive(0, "evaluation_clock_invalid", new Date(0).toISOString());
  if (!Array.isArray(rawSnapshots) || rawSnapshots.length < 3) {
    return inconclusive(Array.isArray(rawSnapshots) ? rawSnapshots.length : 0, "insufficient_snapshots", evaluatedAt);
  }
  if (rawSnapshots.length > QUEUE_CHECKPOINTS.length) {
    return inconclusive(rawSnapshots.length, "unexpected_snapshot_count", evaluatedAt);
  }

  let snapshots;
  try {
    snapshots = rawSnapshots.map(parseQueueSnapshot);
  } catch {
    return inconclusive(rawSnapshots.length, "snapshot_invalid", evaluatedAt);
  }

  const workerVersionIds = new Set(snapshots.map((snapshot) => snapshot.workerVersionId));
  if (workerVersionIds.size !== 1) {
    return inconclusive(snapshots.length, "snapshot_version_mismatch", evaluatedAt);
  }
  const [workerVersionId] = workerVersionIds;
  const workerDeploymentIds = new Set(snapshots.map((snapshot) => snapshot.workerDeploymentId));
  const workerDeploymentCreatedAts = new Set(
    snapshots.map((snapshot) => snapshot.workerDeploymentCreatedAt),
  );
  if (workerDeploymentIds.size !== 1 || workerDeploymentCreatedAts.size !== 1) {
    return inconclusive(snapshots.length, "snapshot_deployment_mismatch", evaluatedAt, {
      workerVersionId,
    });
  }
  const [workerDeploymentId] = workerDeploymentIds;
  const [workerDeploymentCreatedAt] = workerDeploymentCreatedAts;
  const provenance = { workerDeploymentId, workerDeploymentCreatedAt, workerVersionId };
  const expectedCheckpoints = QUEUE_CHECKPOINTS.slice(0, snapshots.length);

  for (let index = 0; index < snapshots.length; index += 1) {
    const current = snapshots[index];
    if (current.checkpoint !== expectedCheckpoints[index]) {
      return inconclusive(
        snapshots.length,
        "snapshot_checkpoint_sequence_invalid",
        evaluatedAt,
        provenance,
      );
    }
    if (index === 0) continue;
    const previous = snapshots[index - 1];
    if (
      current.capturedAtMs <= previous.capturedAtMs
    ) {
      return inconclusive(snapshots.length, "snapshot_order_invalid", evaluatedAt, provenance);
    }
  }

  if (snapshots.some((snapshot) => snapshot.capturedAtMs > nowMs + QUEUE_TREND_MAX_FUTURE_MS)) {
    return inconclusive(snapshots.length, "snapshot_clock_invalid", evaluatedAt, provenance);
  }
  const newest = snapshots[snapshots.length - 1];
  if (nowMs - newest.capturedAtMs > QUEUE_TREND_MAX_NEWEST_AGE_MS) {
    return inconclusive(snapshots.length, "snapshot_stale", evaluatedAt, provenance);
  }
  if (newest.capturedAtMs - snapshots[0].capturedAtMs > QUEUE_TREND_MAX_SPAN_MS) {
    return inconclusive(snapshots.length, "snapshot_span_invalid", evaluatedAt, provenance);
  }

  const increasingMetrics = QUEUE_METRIC_NAMES.filter((name) => {
    for (let index = 2; index < snapshots.length; index += 1) {
      if (
        snapshots[index - 2].metrics[name] < snapshots[index - 1].metrics[name]
        && snapshots[index - 1].metrics[name] < snapshots[index].metrics[name]
      ) {
        return true;
      }
    }
    return false;
  });

  return {
    schema: QUEUE_TREND_SCHEMA,
    workerService: WORKER_SERVICE,
    workerDeploymentId,
    workerDeploymentCreatedAt,
    workerVersionId,
    evaluatedAt,
    verdict: increasingMetrics.length > 0 ? "ROLLBACK_REQUIRED" : "HEALTHY",
    reason: increasingMetrics.length > 0
      ? "two_consecutive_increases"
      : "no_two_consecutive_increases",
    snapshotCount: snapshots.length,
    increasingMetrics,
  };
}

function parseArgs(argv) {
  const snapshotPaths = [];
  let outputPath = null;
  for (const arg of argv) {
    if (arg.startsWith("--out=")) {
      if (outputPath !== null || arg.length <= "--out=".length) {
        throw new Error("queue_trend_arguments_invalid");
      }
      outputPath = arg.slice("--out=".length);
    } else if (arg.startsWith("--")) {
      throw new Error("queue_trend_arguments_invalid");
    } else {
      snapshotPaths.push(arg);
    }
  }
  if (snapshotPaths.length < 3 || !outputPath) throw new Error("queue_trend_arguments_invalid");
  return { snapshotPaths, outputPath };
}

function loadSnapshots(paths) {
  const snapshots = [];
  for (const path of paths) {
    let text;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      return { snapshots: null, reason: "snapshot_read_failed" };
    }
    try {
      snapshots.push(JSON.parse(text));
    } catch {
      return { snapshots: null, reason: "snapshot_invalid" };
    }
  }
  return { snapshots, reason: null };
}

function safeFailureCode(error) {
  const message = error instanceof Error ? error.message : "";
  return /^queue_trend_[a-z_]+$/.test(message)
    ? message
    : "queue_trend_check_failed";
}

export function main(argv = process.argv.slice(2), nowMs = Date.now()) {
  let outputPath;
  let report;
  try {
    const parsed = parseArgs(argv);
    outputPath = parsed.outputPath;
    const loaded = loadSnapshots(parsed.snapshotPaths);
    report = loaded.snapshots
      ? evaluateQueueTrend(loaded.snapshots, nowMs)
      : inconclusive(parsed.snapshotPaths.length, loaded.reason, new Date(nowMs).toISOString());
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error) {
    const code = safeFailureCode(error);
    console.error(`운영 큐 추세 판정 실패: ${code}`);
    return 2;
  }

  console.log(`운영 큐 추세 판정: ${report.verdict}`);
  if (report.increasingMetrics.length > 0) {
    console.log(`두 구간 연속 증가: ${report.increasingMetrics.join(", ")}`);
  }
  return report.verdict === "ROLLBACK_REQUIRED" ? 1 : report.verdict === "HEALTHY" ? 0 : 2;
}

const isDirectRun = process.argv[1]
  && fileURLToPath(import.meta.url).toLowerCase() === resolve(process.argv[1]).toLowerCase();
if (isDirectRun) process.exitCode = main();

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  FIRST_HOUR_5XX_CHECKPOINTS,
  FIRST_HOUR_5XX_SCHEMA,
} from "./check-first-hour-5xx.mjs";
import {
  WORKER_SERVICE,
  parseDeploymentTimestamp,
  parseWorkerDeploymentId,
  parseWorkerVersionId,
} from "./worker-deployment-provenance.mjs";

export const FIRST_HOUR_5XX_SERIES_SCHEMA = "hyeni-first-hour-5xx-series-v2";
const WINDOW_MS = 5 * 60 * 1000;
const RESULT_KEYS = Object.freeze([
  "schema",
  "workerService",
  "workerDeploymentId",
  "workerDeploymentCreatedAt",
  "workerVersionId",
  "deploymentVerifiedAt",
  "checkpoint",
  "totalRequests",
  "serverErrors",
  "errorRate",
  "verdict",
  "fromMs",
  "toMs",
]);

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

export function parseFirstHour5xxEvidence(value) {
  if (!exactKeys(value, RESULT_KEYS) || value.schema !== FIRST_HOUR_5XX_SCHEMA) {
    throw new Error("telemetry_series_evidence_invalid");
  }
  if (value.workerService !== WORKER_SERVICE) {
    throw new Error("telemetry_series_service_invalid");
  }
  const workerDeploymentId = parseWorkerDeploymentId(value.workerDeploymentId);
  const workerDeploymentCreatedAt = parseDeploymentTimestamp(value.workerDeploymentCreatedAt);
  const workerVersionId = parseWorkerVersionId(value.workerVersionId);
  const deploymentVerifiedAt = parseDeploymentTimestamp(value.deploymentVerifiedAt);
  if (!FIRST_HOUR_5XX_CHECKPOINTS.includes(value.checkpoint)) {
    throw new Error("telemetry_series_checkpoint_invalid");
  }
  if (
    !Number.isSafeInteger(value.fromMs)
    || !Number.isSafeInteger(value.toMs)
    || value.toMs - value.fromMs !== WINDOW_MS
    || Date.parse(workerDeploymentCreatedAt) > value.fromMs
    || value.toMs > Date.parse(deploymentVerifiedAt)
  ) {
    throw new Error("telemetry_series_window_invalid");
  }
  if (
    typeof value.totalRequests !== "number"
    || typeof value.serverErrors !== "number"
    || !Number.isFinite(value.totalRequests)
    || !Number.isFinite(value.serverErrors)
    || value.totalRequests < 0
    || value.serverErrors < 0
    || value.serverErrors > value.totalRequests
  ) {
    throw new Error("telemetry_series_counts_invalid");
  }
  const expectedRate = value.totalRequests === 0
    ? null
    : value.serverErrors / value.totalRequests;
  if (
    value.errorRate !== expectedRate
    || !["healthy", "rollback_required", "inconclusive"].includes(value.verdict)
    || (value.totalRequests === 0) !== (value.verdict === "inconclusive")
    || (value.verdict === "rollback_required")
      !== (value.serverErrors >= 5 && expectedRate !== null && expectedRate > 0.01)
  ) {
    throw new Error("telemetry_series_verdict_invalid");
  }
  return {
    ...value,
    workerDeploymentId,
    workerDeploymentCreatedAt,
    workerVersionId,
    deploymentVerifiedAt,
  };
}

function inconclusive(reason, evaluatedAt, windowCount = 0, provenance = {}) {
  return {
    schema: FIRST_HOUR_5XX_SERIES_SCHEMA,
    workerService: WORKER_SERVICE,
    workerDeploymentId: provenance.workerDeploymentId ?? null,
    workerDeploymentCreatedAt: provenance.workerDeploymentCreatedAt ?? null,
    workerVersionId: provenance.workerVersionId ?? null,
    evaluatedAt,
    verdict: "INCONCLUSIVE",
    reason,
    windowCount,
    rollbackCheckpoints: [],
    inconclusiveCheckpoints: [],
  };
}

export function evaluateFirstHour5xxSeries(rawEvidence, nowMs = Date.now()) {
  const evaluatedAt = Number.isSafeInteger(nowMs) && nowMs > 0
    ? new Date(nowMs).toISOString()
    : new Date(0).toISOString();
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0) {
    return inconclusive("evaluation_clock_invalid", evaluatedAt);
  }
  if (!Array.isArray(rawEvidence) || rawEvidence.length !== FIRST_HOUR_5XX_CHECKPOINTS.length) {
    return inconclusive(
      "incomplete_first_hour",
      evaluatedAt,
      Array.isArray(rawEvidence) ? rawEvidence.length : 0,
    );
  }

  let evidence;
  try {
    evidence = rawEvidence.map(parseFirstHour5xxEvidence);
  } catch {
    return inconclusive("evidence_invalid", evaluatedAt, rawEvidence.length);
  }

  const versionIds = new Set(evidence.map((item) => item.workerVersionId));
  if (versionIds.size !== 1) {
    return inconclusive("evidence_version_mismatch", evaluatedAt, evidence.length);
  }
  const [workerVersionId] = versionIds;
  const deploymentIds = new Set(evidence.map((item) => item.workerDeploymentId));
  const deploymentCreatedAts = new Set(evidence.map((item) => item.workerDeploymentCreatedAt));
  if (deploymentIds.size !== 1 || deploymentCreatedAts.size !== 1) {
    return inconclusive("evidence_deployment_mismatch", evaluatedAt, evidence.length, {
      workerVersionId,
    });
  }
  const [workerDeploymentId] = deploymentIds;
  const [workerDeploymentCreatedAt] = deploymentCreatedAts;
  const provenance = { workerDeploymentId, workerDeploymentCreatedAt, workerVersionId };

  for (let index = 0; index < evidence.length; index += 1) {
    const current = evidence[index];
    if (
      current.checkpoint !== FIRST_HOUR_5XX_CHECKPOINTS[index]
      || (index > 0 && current.fromMs !== evidence[index - 1].toMs)
      || current.toMs > nowMs
    ) {
      return inconclusive("evidence_window_sequence_invalid", evaluatedAt, evidence.length, provenance);
    }
  }

  const rollbackCheckpoints = evidence
    .filter((item) => item.verdict === "rollback_required")
    .map((item) => item.checkpoint);
  const inconclusiveCheckpoints = evidence
    .filter((item) => item.verdict === "inconclusive")
    .map((item) => item.checkpoint);
  const verdict = rollbackCheckpoints.length > 0
    ? "ROLLBACK_REQUIRED"
    : inconclusiveCheckpoints.length > 0
      ? "INCONCLUSIVE"
      : "HEALTHY";
  return {
    schema: FIRST_HOUR_5XX_SERIES_SCHEMA,
    workerService: WORKER_SERVICE,
    ...provenance,
    evaluatedAt,
    verdict,
    reason: rollbackCheckpoints.length > 0
      ? "rollback_window_present"
      : inconclusiveCheckpoints.length > 0
        ? "inconclusive_window_present"
        : "all_windows_healthy",
    windowCount: evidence.length,
    rollbackCheckpoints,
    inconclusiveCheckpoints,
  };
}

function parseArgs(argv) {
  const evidencePaths = [];
  let outputPath = null;
  for (const arg of argv) {
    if (arg.startsWith("--out=")) {
      if (outputPath !== null || arg.length <= "--out=".length) {
        throw new Error("telemetry_series_arguments_invalid");
      }
      outputPath = arg.slice("--out=".length);
    } else if (arg.startsWith("--")) {
      throw new Error("telemetry_series_arguments_invalid");
    } else {
      evidencePaths.push(arg);
    }
  }
  if (evidencePaths.length !== FIRST_HOUR_5XX_CHECKPOINTS.length || !outputPath) {
    throw new Error("telemetry_series_arguments_invalid");
  }
  return { evidencePaths, outputPath };
}

export function main(argv = process.argv.slice(2), nowMs = Date.now()) {
  let report;
  let outputPath;
  try {
    const parsed = parseArgs(argv);
    outputPath = parsed.outputPath;
    const evidence = parsed.evidencePaths.map((path) => JSON.parse(readFileSync(path, "utf8")));
    report = evaluateFirstHour5xxSeries(evidence, nowMs);
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
  } catch {
    console.error("첫 60분 5xx 판정 실패: telemetry_series_check_failed");
    return 2;
  }
  console.log(`첫 60분 5xx 판정: ${report.verdict}`);
  return report.verdict === "HEALTHY" ? 0 : report.verdict === "ROLLBACK_REQUIRED" ? 1 : 2;
}

const isDirectRun = process.argv[1]
  && fileURLToPath(import.meta.url).toLowerCase() === resolve(process.argv[1]).toLowerCase();
if (isDirectRun) process.exitCode = main();

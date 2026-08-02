import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  FIRST_HOUR_5XX_CHECKPOINTS,
  FIRST_HOUR_5XX_SCHEMA,
} from "../scripts/check-first-hour-5xx.mjs";
import {
  evaluateFirstHour5xxSeries,
  main as runFirstHour5xxSeriesCli,
} from "../scripts/check-first-hour-5xx-series.mjs";

const VERSION_ID = "86d56186-c527-4564-a154-72f805073205";
const OTHER_VERSION_ID = "182bd5e5-6e1a-4fe4-a799-aa6d9a6ab26e";
const DEPLOYMENT_ID = "918bd5e5-6e1a-4fe4-a799-aa6d9a6ab26e";
const OTHER_DEPLOYMENT_ID = "a18bd5e5-6e1a-4fe4-a799-aa6d9a6ab26e";
const DEPLOYMENT_CREATED_AT = "2026-08-02T00:00:00.000Z";
const LAUNCH_MS = Date.UTC(2026, 7, 2, 1, 0, 0);
const NOW_MS = LAUNCH_MS + 61 * 60 * 1000;

function series() {
  return FIRST_HOUR_5XX_CHECKPOINTS.map((checkpoint, index) => {
    const fromMs = LAUNCH_MS + index * 5 * 60 * 1000;
    const toMs = fromMs + 5 * 60 * 1000;
    return {
      schema: FIRST_HOUR_5XX_SCHEMA,
      workerService: "hyeni-calendar-api",
      workerDeploymentId: DEPLOYMENT_ID,
      workerDeploymentCreatedAt: DEPLOYMENT_CREATED_AT,
      workerVersionId: VERSION_ID,
      deploymentVerifiedAt: new Date(toMs + 1000).toISOString(),
      checkpoint,
      totalRequests: 100,
      serverErrors: 0,
      errorRate: 0,
      verdict: "healthy",
      fromMs,
      toMs,
    };
  });
}

test("정확히 이어진 12개 5분 창만 첫 60분 HEALTHY로 판정한다", () => {
  const report = evaluateFirstHour5xxSeries(series(), NOW_MS);
  assert.equal(report.verdict, "HEALTHY");
  assert.equal(report.reason, "all_windows_healthy");
  assert.equal(report.windowCount, 12);
  assert.equal(report.workerDeploymentId, DEPLOYMENT_ID);
  assert.equal(report.workerVersionId, VERSION_ID);
});

test("중간 version 또는 deployment 변경은 INCONCLUSIVE로 fail-closed한다", () => {
  const versionChanged = series();
  versionChanged[7].workerVersionId = OTHER_VERSION_ID;
  const versionReport = evaluateFirstHour5xxSeries(versionChanged, NOW_MS);
  assert.equal(versionReport.verdict, "INCONCLUSIVE");
  assert.equal(versionReport.reason, "evidence_version_mismatch");
  assert.equal(versionReport.workerVersionId, null);

  const deploymentChanged = series();
  deploymentChanged[7].workerDeploymentId = OTHER_DEPLOYMENT_ID;
  const deploymentReport = evaluateFirstHour5xxSeries(deploymentChanged, NOW_MS);
  assert.equal(deploymentReport.verdict, "INCONCLUSIVE");
  assert.equal(deploymentReport.reason, "evidence_deployment_mismatch");
  assert.equal(deploymentReport.workerVersionId, VERSION_ID);
  assert.equal(deploymentReport.workerDeploymentId, null);
});

test("창 누락·겹침·위변조 판정은 정상으로 간주하지 않는다", () => {
  assert.equal(evaluateFirstHour5xxSeries(series().slice(0, 11), NOW_MS).reason, "incomplete_first_hour");

  const gap = series();
  gap[4].fromMs += 1000;
  gap[4].toMs += 1000;
  gap[4].deploymentVerifiedAt = new Date(gap[4].toMs + 1000).toISOString();
  assert.equal(
    evaluateFirstHour5xxSeries(gap, NOW_MS).reason,
    "evidence_window_sequence_invalid",
  );

  const forged = series();
  forged[2].serverErrors = 6;
  assert.equal(evaluateFirstHour5xxSeries(forged, NOW_MS).reason, "evidence_invalid");
});

test("ROLLBACK_REQUIRED 창과 INCONCLUSIVE 창을 첫 60분 최종 판정에 전파한다", () => {
  const rollback = series();
  rollback[3].serverErrors = 5;
  rollback[3].errorRate = 0.05;
  rollback[3].verdict = "rollback_required";
  const rollbackReport = evaluateFirstHour5xxSeries(rollback, NOW_MS);
  assert.equal(rollbackReport.verdict, "ROLLBACK_REQUIRED");
  assert.deepEqual(rollbackReport.rollbackCheckpoints, ["T+20"]);

  const inconclusive = series();
  inconclusive[4].totalRequests = 0;
  inconclusive[4].errorRate = null;
  inconclusive[4].verdict = "inconclusive";
  const inconclusiveReport = evaluateFirstHour5xxSeries(inconclusive, NOW_MS);
  assert.equal(inconclusiveReport.verdict, "INCONCLUSIVE");
  assert.deepEqual(inconclusiveReport.inconclusiveCheckpoints, ["T+25"]);
});

test("첫 60분 최종 JSON도 create-only이며 입력 경로·자격정보를 복제하지 않는다", () => {
  const directory = mkdtempSync(join(tmpdir(), "hyeni-first-hour-5xx-series-"));
  const paths = FIRST_HOUR_5XX_CHECKPOINTS.map((checkpoint, index) => {
    const path = join(directory, `${checkpoint.toLowerCase().replace("+", "-plus-")}.json`);
    writeFileSync(path, `${JSON.stringify(series()[index])}\n`, "utf8");
    return path;
  });
  const outputPath = join(directory, "series.json");
  try {
    assert.equal(runFirstHour5xxSeriesCli([...paths, `--out=${outputPath}`], NOW_MS), 0);
    const reportText = readFileSync(outputPath, "utf8");
    assert.equal(JSON.parse(reportText).verdict, "HEALTHY");
    assert.equal(reportText.includes(directory), false);
    assert.doesNotMatch(reportText, /secret-token/);
    assert.equal(runFirstHour5xxSeriesCli([...paths, `--out=${outputPath}`], NOW_MS), 2);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

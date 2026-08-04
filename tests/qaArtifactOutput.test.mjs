import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  createQaRunId,
  prepareFreshQaOutputDir,
  resolveQaOutputDir,
} from "../scripts/lib/qaArtifactOutput.mjs";

test("QA 증거 경로는 실행별로 분리되고 기존 디렉터리를 덮어쓰지 않는다", async (context) => {
  const fixtureRoot = await mkdtemp(resolve(tmpdir(), "hyeni-qa-output-test-"));
  context.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  const outputRoot = resolve(fixtureRoot, "artifacts/release-evidence/browser-qa");
  const runId = createQaRunId(
    new Date("2026-08-02T00:00:00.000Z"),
    1234,
    "12345678-1234-1234-1234-123456789abc",
  );
  assert.equal(runId, "20260802T000000Z-p1234-12345678");

  const generated = resolveQaOutputDir([], { rootDir: fixtureRoot, outputRoot, runId });
  assert.equal(generated, resolve(outputRoot, runId));
  await prepareFreshQaOutputDir(generated);
  assert.equal(existsSync(generated), true);
  await assert.rejects(
    prepareFreshQaOutputDir(generated),
    /기존 증거를 덮어쓰지 않습니다/,
  );

  const explicit = resolveQaOutputDir(
    ["--out-dir", "artifacts/release-evidence/browser-qa/ci-1"],
    { rootDir: fixtureRoot, outputRoot, runId },
  );
  assert.equal(explicit, resolve(fixtureRoot, "artifacts/release-evidence/browser-qa/ci-1"));
  assert.throws(
    () => resolveQaOutputDir(["--unknown"], { rootDir: fixtureRoot, outputRoot, runId }),
    /지원하지 않는 QA 인자/,
  );
  assert.throws(
    () => resolveQaOutputDir(["--out-dir"], { rootDir: fixtureRoot, outputRoot, runId }),
    /출력 디렉터리/,
  );
});

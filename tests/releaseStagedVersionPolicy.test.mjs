import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildAabEvidence } from "../scripts/create-aab-evidence.mjs";
import { buildPagesProvenance } from "../scripts/create-pages-provenance.mjs";
import { buildReleaseRecord } from "../scripts/create-release-record.mjs";
import {
  isReleaseVersionPolicySafe,
} from "../scripts/release-evidence.mjs";

function write(path, value) {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, value);
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function createStagedReleaseFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "hyeni-staged-release-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(resolve(root, "package.json"), '{"version":"1.4.1"}\n');
  write(resolve(root, "package-lock.json"), '{"lockfileVersion":3}\n');
  write(resolve(root, "public", "app-version.json"), JSON.stringify({
    minimumSupportedVersion: "1.4.0",
    latestVersion: "1.4.0",
  }));
  write(resolve(root, "android", "app", "build.gradle"), `
def hyeniPackageVersion = "1.4.1"
android {
  defaultConfig {
    applicationId "com.hyeni.calendar"
    versionCode 13
    versionName hyeniPackageVersion
  }
}
`);
  git(root, ["init"]);
  git(root, ["config", "user.email", "release-test@invalid.local"]);
  git(root, ["config", "user.name", "Release Test"]);
  git(root, ["config", "core.autocrlf", "false"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "단계 배포 fixture"]);
  return root;
}

test("Play 제공 전 새 앱이 원격 업데이트 정책보다 앞선 단계 배포를 허용한다", () => {
  assert.equal(isReleaseVersionPolicySafe({
    packageVersion: "1.4.1",
    minimumSupportedVersion: "1.4.0",
    latestVersion: "1.4.0",
  }), true);
  assert.equal(isReleaseVersionPolicySafe({
    packageVersion: "1.4.1",
    minimumSupportedVersion: "1.4.1",
    latestVersion: "1.4.1",
  }), true);
});

test("원격 업데이트 정책이 앱보다 앞서거나 순서가 뒤집히면 출시를 거부한다", () => {
  for (const policy of [
    {
      packageVersion: "1.4.1",
      minimumSupportedVersion: "1.4.0",
      latestVersion: "1.4.2",
    },
    {
      packageVersion: "1.4.1",
      minimumSupportedVersion: "1.4.1",
      latestVersion: "1.4.0",
    },
    {
      packageVersion: "1.4.1-beta",
      minimumSupportedVersion: "1.4.0",
      latestVersion: "1.4.0",
    },
    {
      packageVersion: "1.4.1.0.0",
      minimumSupportedVersion: "1.4.0.0.0",
      latestVersion: "1.4.0.0.0",
    },
  ]) {
    assert.equal(isReleaseVersionPolicySafe(policy), false);
  }
});

test("AAB·Pages·출시 기록은 Play 제공 전 단계 배포 정책을 같은 순서로 수용한다", (t) => {
  const root = createStagedReleaseFixture(t);
  const firstHead = git(root, ["rev-parse", "HEAD"]);
  const missingToolPath = resolve(root, "missing-tool.exe");

  assert.throws(() => buildAabEvidence({
    appRoot: root,
    aabPath: resolve(root, "missing.aab"),
    bundletoolJarPath: resolve(root, "missing-bundletool.jar"),
    javaPath: missingToolPath,
    jarToolPath: missingToolPath,
    jarsignerPath: missingToolPath,
    keytoolPath: missingToolPath,
    zipalignPath: missingToolPath,
    readelfPath: missingToolPath,
    buildType: "release",
    expectedSourceCommit: firstHead,
    expectedCertificateSha256: "c".repeat(64),
  }), /현재 dist가 없거나 디렉터리가 아닙니다/);

  const distPath = resolve(root, "dist");
  write(resolve(distPath, "index.html"), "<!doctype html><title>staged</title>\n");
  git(root, ["add", "dist"]);
  git(root, ["commit", "-m", "Pages fixture"]);
  const sourceCommit = git(root, ["rev-parse", "HEAD"]);
  const pages = buildPagesProvenance({
    appRoot: root,
    distPath,
    expectedSourceCommit: sourceCommit,
    ciRunId: "staged-release-test",
    ciRunAttempt: "1",
    generatedAt: "2026-08-24T00:00:00.000Z",
  });
  assert.equal(pages.app.packageVersion, "1.4.1");
  assert.equal(pages.app.minimumSupportedVersion, "1.4.0");
  assert.equal(pages.app.latestVersion, "1.4.0");

  const record = buildReleaseRecord({
    appRoot: root,
    workerRoot: root,
    env: {},
    generatedAt: "2026-08-24T00:00:00.000Z",
  });
  assert.equal(
    record.assessment.blockers.includes("package/public/Gradle versionName 정책이 일치하지 않습니다."),
    false,
  );
});

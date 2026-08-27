import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return readFileSync(resolve(rootDir, relativePath), "utf8");
}

test("1.4.4 정책 수정 빌드는 Android와 iOS 빌드 번호를 16으로 맞춘다", () => {
  const packageJson = JSON.parse(read("package.json"));
  const androidGradle = read("android/app/build.gradle");
  const iosProject = read("ios/App/App.xcodeproj/project.pbxproj");

  assert.equal(packageJson.version, "1.4.4");
  assert.match(androidGradle, /^\s*versionCode 16$/m);
  assert.equal((iosProject.match(/CURRENT_PROJECT_VERSION = 16;/g) ?? []).length, 2);
  assert.equal((iosProject.match(/MARKETING_VERSION = 1\.4\.4;/g) ?? []).length, 2);
});

test("1.4.4 Play 문서는 제한된 microphone FGS 부팅 경로 제거와 미완료 출시 단계를 구분한다", () => {
  const releaseNotes = read("docs/store/play-release-notes-v1.4.4.md");
  const submission = read("docs/store/play-console-submission-v1.4.4.md");

  assert.match(releaseNotes, /Android 15/);
  assert.match(releaseNotes, /기기 재시작/);
  assert.match(submission, /BOOT_COMPLETED/);
  assert.match(submission, /AmbientListenService/);
  assert.match(submission, /versionCode 16/);
  assert.match(submission, /서명 AAB·Play 교체 전/);
});

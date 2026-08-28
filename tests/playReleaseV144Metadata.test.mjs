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

test("1.4.4 Play 문서는 이전 AAB를 폐기하고 최신 인증·QR·FGS 수정본 재빌드를 요구한다", () => {
  const releaseNotes = read("docs/store/play-release-notes-v1.4.4.md");
  const submission = read("docs/store/play-console-submission-v1.4.4.md");

  assert.match(releaseNotes, /Android 15/);
  assert.match(releaseNotes, /기기 재시작/);
  assert.match(releaseNotes, /카카오·Google 로그인/);
  assert.match(releaseNotes, /소셜 계정 없이 QR 또는 연결 코드/);
  assert.match(releaseNotes, /온보딩 제목 줄바꿈/);
  assert.match(submission, /BOOT_COMPLETED/);
  assert.match(submission, /AmbientListenService/);
  assert.match(submission, /versionCode 16/);
  assert.match(submission, /이전 후보 폐기/);
  assert.match(submission, /최종 커밋에서 새 서명 AAB 생성 필요/);
  assert.match(submission, /eda3907d96e0046804c2d39eb4c2c310f4b1dfeb/);
  assert.match(submission, /45e66db8d6a60cae1a9a4c33105f285c85886d92b4aea588425d0010a5343a91/);
  assert.match(submission, /폐기된 이전 후보/);
  assert.match(submission, /oauth-exchange-recovery\.sql/);
  assert.match(submission, /D1.*Worker/s);
  assert.match(submission, /A17.*아이/s);
  assert.match(submission, /S25.*부모/s);
  assert.match(submission, /target SDK 36/);
  assert.match(submission, /viewport-fit=cover/);
  assert.match(submission, /Capacitor 8\.4\.1 `SystemBars`/);
  assert.match(submission, /제스처·3버튼 내비게이션/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return readFileSync(resolve(rootDir, relativePath), "utf8");
}

test("1.4.5 Play 문서는 code 17 제출 당시 상태를 역사 기록으로 보존한다", () => {
  const notesPath = resolve(rootDir, "docs/store/play-release-notes-v1.4.5.md");
  const submissionPath = resolve(rootDir, "docs/store/play-console-submission-v1.4.5.md");

  assert.ok(existsSync(notesPath), "1.4.5 출시 노트가 필요합니다");
  assert.ok(existsSync(submissionPath), "1.4.5 제출 기록이 필요합니다");

  const releaseNotes = read("docs/store/play-release-notes-v1.4.5.md");
  const submission = read("docs/store/play-console-submission-v1.4.5.md");
  assert.match(releaseNotes, /아이 정보/);
  assert.match(releaseNotes, /사건 시각/);
  assert.match(releaseNotes, /학습 화면/);
  assert.match(
    releaseNotes,
    /혜니스터디 미니앱이 출시되어 이제 학습도 함께 할 수 있어요\./,
  );
  assert.match(submission, /versionName 1\.4\.5/);
  assert.match(submission, /versionCode 17/);
  assert.match(submission, /production 1\.4\.5 \(17\) 제출 완료/);
  assert.match(submission, /Google Play 검토 진행 중, 게시 전/);
  assert.match(submission, /기존 code 16 심사를 취소하고 최신 code 17로 검토를 다시 시작/);
  assert.match(submission, /\- \[ \] Google Play 검토 통과와 실제 production 게시 확인/);
  assert.match(submission, /6a80f8f9209c90d380e6723ee40d359180ad957566539063d9ff87b1ac9c20c0/);
  assert.match(submission, /32f729e8cc1df82d94eacd0d264439fcd7102b15fcdc269660254a87f25a81db/);
  assert.match(submission, /D1.*migration.*없/s);
});

test("1.4.6 Google 지도 출시 후보는 code 18과 10개 locale 출시 노트를 쓴다", () => {
  const packageJson = JSON.parse(read("package.json"));
  const androidGradle = read("android/app/build.gradle");
  const iosProject = read("ios/App/App.xcodeproj/project.pbxproj");
  const notesPath = resolve(rootDir, "docs/store/play-release-notes-v1.4.6.md");

  assert.equal(packageJson.version, "1.4.6");
  assert.match(androidGradle, /^\s*versionCode 18$/m);
  assert.equal((iosProject.match(/CURRENT_PROJECT_VERSION = 18;/g) ?? []).length, 2);
  assert.equal((iosProject.match(/MARKETING_VERSION = 1\.4\.6;/g) ?? []).length, 2);
  assert.ok(existsSync(notesPath), "1.4.6 출시 노트가 필요합니다");

  const releaseNotes = read("docs/store/play-release-notes-v1.4.6.md");
  for (const locale of ["ko-KR", "en-US", "ja-JP", "zh-CN", "zh-TW", "vi", "th", "id", "ms-MY", "fil"]) {
    assert.match(releaseNotes, new RegExp(`<${locale.replace("-", "\\-")}>[\\s\\S]+</${locale.replace("-", "\\-")}>`));
  }
  assert.match(releaseNotes, /Google 지도/);
  assert.match(releaseNotes, /지원 지역/);
});

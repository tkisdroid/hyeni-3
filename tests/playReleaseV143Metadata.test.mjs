import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return readFileSync(resolve(rootDir, relativePath), "utf8");
}

test("1.4.3 Play 문서는 code 15 자동완성 수정본의 심사 제출 증거를 보존한다", () => {
  const releaseNotes = read("docs/store/play-release-notes-v1.4.3.md");
  const submission = read("docs/store/play-console-submission-v1.4.3.md");

  assert.match(releaseNotes, /자동완성/);
  assert.match(releaseNotes, /아이 모드 시작 카드/);
  assert.match(submission, /versionName 1\.4\.3/);
  assert.match(submission, /versionCode 15/);
  assert.match(submission, /production 심사 제출 완료 \(`IN_REVIEW`\)/);
  assert.match(submission, /hyeni-calendar-v1\.4\.3-vc15-ef2933a\.aab/);
  assert.match(submission, /b2f78392f311781ac697b8107bdc4b43bf1ac75af1e3bc9b484cbe4538ed5ad3/);
});

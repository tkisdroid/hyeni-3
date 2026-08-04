import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const gitignore = readFileSync(new URL("../.gitignore", import.meta.url), "utf8");

test("브라우저 검증 프로필과 로컬 배포 상태는 커밋 대상에서 제외한다", () => {
  for (const pattern of [
    ".lighthouse-profile*/",
    ".playwright-mcp/",
    ".wrangler/",
    "tmp-verify-*/",
    "artifacts/**/lighthouse-profile-*/",
    "artifacts/release-evidence/",
    "artifacts/release-records/",
  ]) {
    assert.ok(gitignore.includes(pattern), `${pattern} 누락`);
  }
});

test("output에서는 개인정보 없는 생성 스토어 자산만 새 파일 추적을 허용한다", () => {
  assert.match(gitignore, /^output\/\*$/m);
  assert.doesNotMatch(gitignore, /^!output\/store-screenshots(?:\/|\/\*\*)?$/m);
  assert.match(gitignore, /^!output\/store-safe-assets-v1\/$/m);
  assert.match(gitignore, /^!output\/store-safe-assets-v1\/\*\*$/m);
  assert.match(gitignore, /^!output\/store-ui-candidates-v1\/$/m);
  assert.match(gitignore, /^!output\/store-ui-candidates-v1\/\*\*$/m);
  assert.match(gitignore, /^!output\/store-listing-assets-v1\/$/m);
  assert.match(gitignore, /^!output\/store-listing-assets-v1\/\*\*$/m);
  assert.doesNotMatch(gitignore, /^output\/$/m);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/screens/onboarding/Onboarding.tsx", import.meta.url), "utf8");
const accountSource = await readFile(new URL("../src/lib/api/endpoints/account.ts", import.meta.url), "utf8");

test("가입 전 이용약관과 개인정보 처리방침을 실제 공개 문서 링크로 제공한다", () => {
  assert.match(accountSource, /TERMS_OF_SERVICE_URL\s*=\s*`\$\{API_BASE\}\/terms`/);
  assert.match(accountSource, /PRIVACY_POLICY_URL\s*=\s*`\$\{API_BASE\}\/privacy`/);
  assert.match(source, /href=\{TERMS_OF_SERVICE_URL\}/);
  assert.match(source, /href=\{PRIVACY_POLICY_URL\}/);
  assert.match(source, /rel="noopener noreferrer"/);
  assert.doesNotMatch(source, /<span>이용약관<\/span>/);
});

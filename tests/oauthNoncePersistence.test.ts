import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/lib/api/endpoints/auth.ts", import.meta.url), "utf8");

test("OAuth state·별도 secret·mode를 두 저장소에 동일하게 저장하고 readback한다", () => {
  assert.match(src, /function writeOAuthContext/);
  assert.match(src, /for \(const store of \[window\.sessionStorage, window\.localStorage\]\)[\s\S]{0,200}setItem\(OAUTH_CONTEXT_KEY/);
  assert.match(src, /store\.getItem\(OAUTH_CONTEXT_KEY\) !== serialized/);
  assert.match(src, /writeOAuthContext\(\{[\s\S]{0,200}transactionSecret/);
});

test("OAuth context는 읽는 즉시 두 저장소에서 폐기된다(재사용 금지)", () => {
  assert.match(src, /function takeOAuthContext[\s\S]{0,160}clearOAuthContext\(\)/);
  assert.match(src, /const context = takeOAuthContext\(\)/);
});

test("context가 없거나 state·provider·mode가 다르면 네트워크 전에 중단한다", () => {
  assert.match(src, /if \(!context[\s\S]{0,240}context\.state !== input\.state\)[\s\S]{0,120}throw new Error/);
  // 교환 POST 는 대조 이후에만 일어나야 한다.
  assert.ok(
    src.indexOf("context.state !== input.state") < src.indexOf("oauthExchangePath(input.provider)"),
    "context 대조가 code 교환보다 앞서야 한다",
  );
});

test("sessionStorage 를 직접 읽고 쓰는 잔여 경로가 없다(단일 출처)", () => {
  const direct = src.match(/window\.sessionStorage\.(getItem|setItem|removeItem)/g) ?? [];
  const inHelpers = src.match(/for \(const store of \[window\.sessionStorage, window\.localStorage\]\)/g) ?? [];
  assert.equal(direct.length, 0, `sessionStorage 직접 접근이 남아 있다: ${direct.join(", ")}`);
  assert.ok(inHelpers.length >= 3, "context 헬퍼가 두 저장소를 함께 다뤄야 한다");
});

test("start 응답은 state·secret 타입/길이와 미래 만료시각을 검증한 뒤에만 저장한다", () => {
  assert.match(src, /function validateOAuthStartResponse/);
  assert.match(src, /typeof response\.state !== "string"/);
  assert.match(src, /response\.state\.length < 40/);
  assert.match(src, /typeof response\.transactionSecret !== "string"/);
  assert.match(src, /expiresAt <= Date\.now\(\)/);
  assert.ok(
    src.indexOf("validateOAuthStartResponse(response)") < src.indexOf("writeOAuthContext({"),
    "검증이 context 저장보다 먼저여야 한다",
  );
});

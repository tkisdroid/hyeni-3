import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/lib/api/endpoints/auth.ts", import.meta.url), "utf8");

test("OAuth nonce 는 localStorage 에도 저장한다(네이티브 프로세스 재생성 대비)", () => {
  assert.match(src, /function writeOAuthNonce/);
  assert.match(src, /for \(const store of \[window\.sessionStorage, window\.localStorage\]\)[\s\S]{0,200}setItem\(OAUTH_STATE_KEY/);
  assert.match(src, /writeOAuthNonce\(nonce, provider\)/);
});

test("nonce 는 읽는 즉시 두 저장소에서 폐기된다(재사용 금지)", () => {
  assert.match(src, /function takeOAuthNonce[\s\S]{0,400}removeItem\(OAUTH_STATE_KEY\)[\s\S]{0,120}removeItem\(OAUTH_PROVIDER_KEY\)/);
  assert.match(src, /const savedNonce = takeOAuthNonce\(\)/);
});

test("CSRF 대조는 그대로 유지된다(state 불일치 시 교환 중단)", () => {
  assert.match(src, /if \(savedNonce && input\.state && savedNonce !== input\.state\)[\s\S]{0,120}throw new Error/);
  // 교환 POST 는 대조 이후에만 일어나야 한다.
  assert.ok(
    src.indexOf("savedNonce !== input.state") < src.indexOf("oauthExchangePath(input.provider)"),
    "nonce 대조가 code 교환보다 앞서야 한다",
  );
});

test("sessionStorage 를 직접 읽고 쓰는 잔여 경로가 없다(단일 출처)", () => {
  const direct = src.match(/window\.sessionStorage\.(getItem|setItem|removeItem)/g) ?? [];
  const inHelpers = src.match(/for \(const store of \[window\.sessionStorage, window\.localStorage\]\)/g) ?? [];
  assert.equal(direct.length, 0, `sessionStorage 직접 접근이 남아 있다: ${direct.join(", ")}`);
  assert.ok(inHelpers.length >= 3, "헬퍼 3종(write/take/readHint)이 두 저장소를 함께 다뤄야 한다");
});

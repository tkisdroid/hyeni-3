import test from "node:test";
import assert from "node:assert/strict";

import { parseOAuthDeepLinkUrl } from "../src/transform/oauthDeepLinkParse.ts";

// 아래 URL 은 Worker 콜백이 실제로 만들어 낸 문자열(2026-07-10 라이브 확인).
const GOOGLE_NATIVE = "hyenicalendar://auth-callback?provider=google&code=CODE123&state=nonce-abc";
const NAVER_NATIVE = "hyenicalendar://auth-callback?provider=naver&code=TESTCODE&state=n1";
const KAKAO_NATIVE = "hyenicalendar://auth-callback?provider=kakao&code=CODE123&state=nonce-abc";
const GOOGLE_CANCEL = "hyenicalendar://auth-callback?provider=google&state=nonce-abc&error=access_denied";

test("구글 딥링크 콜백을 파싱한다(Worker 실제 출력)", () => {
  assert.deepEqual(parseOAuthDeepLinkUrl(GOOGLE_NATIVE), {
    provider: "google",
    code: "CODE123",
    state: "nonce-abc",
  });
});

test("카카오·네이버 딥링크 콜백도 같은 파서로 처리된다", () => {
  assert.equal(parseOAuthDeepLinkUrl(KAKAO_NATIVE)?.provider, "kakao");
  assert.equal(parseOAuthDeepLinkUrl(NAVER_NATIVE)?.provider, "naver");
  assert.equal(parseOAuthDeepLinkUrl(NAVER_NATIVE)?.code, "TESTCODE");
});

test("사용자가 동의를 취소하면(code 없이 error) 로그인 시도로 취급하지 않는다", () => {
  assert.equal(parseOAuthDeepLinkUrl(GOOGLE_CANCEL), null);
});

test("fragment(#) 형태도 커버한다(hyeni-1 계약 보존)", () => {
  const frag = "hyenicalendar://auth-callback#provider=google&code=C&state=S";
  assert.deepEqual(parseOAuthDeepLinkUrl(frag), { provider: "google", code: "C", state: "S" });
});

test("다른 스킴·미지원 provider·코드 누락은 무시한다", () => {
  assert.equal(parseOAuthDeepLinkUrl("https://evil.example.com?provider=google&code=C"), null);
  assert.equal(parseOAuthDeepLinkUrl("hyenicalendar://auth-callback?provider=apple&code=C"), null);
  assert.equal(parseOAuthDeepLinkUrl("hyenicalendar://auth-callback?provider=google"), null);
  assert.equal(parseOAuthDeepLinkUrl(""), null);
});

test("state 가 없어도 code·provider 만 있으면 파싱된다(빈 문자열)", () => {
  const r = parseOAuthDeepLinkUrl("hyenicalendar://auth-callback?provider=google&code=C");
  assert.deepEqual(r, { provider: "google", code: "C", state: "" });
});

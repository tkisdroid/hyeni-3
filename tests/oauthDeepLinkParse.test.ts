import test from "node:test";
import assert from "node:assert/strict";

import {
  parseOAuthCancellationUrl,
  parseOAuthDeepLinkUrl,
} from "../src/transform/oauthDeepLinkParse.ts";

// 아래 URL 은 Worker 콜백이 실제로 만들어 낸 문자열(2026-07-10 라이브 확인).
const CALLBACK = "https://hyeni-calendar.pages.dev/oauth/callback";
const GOOGLE_NATIVE = `${CALLBACK}?provider=google&code=CODE123&state=nonce-abc`;
const NAVER_NATIVE = `${CALLBACK}?provider=naver&code=TESTCODE&state=n1`;
const KAKAO_NATIVE = `${CALLBACK}?provider=kakao&code=CODE123&state=nonce-abc`;
const GOOGLE_CANCEL = `${CALLBACK}?provider=google&state=nonce-abc&error=oauth_cancelled`;

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

test("사용자 취소는 로그인 시도가 아니라 별도 취소 결과로 파싱한다", () => {
  assert.equal(parseOAuthDeepLinkUrl(GOOGLE_CANCEL), null);
  assert.deepEqual(parseOAuthCancellationUrl(GOOGLE_CANCEL), {
    provider: "google",
    state: "nonce-abc",
  });
});

test("서버가 정규화한 oauth_cancelled 외 오류와 callback 유사 호스트는 거부한다", () => {
  assert.equal(
    parseOAuthCancellationUrl(`${CALLBACK}?provider=google&state=S&error=access_denied`),
    null,
  );
  assert.equal(
    parseOAuthCancellationUrl("https://hyeni-calendar.pages.dev.evil/oauth/callback?provider=google&state=S&error=oauth_cancelled"),
    null,
  );
  assert.equal(
    parseOAuthDeepLinkUrl("https://hyeni-calendar.pages.dev.evil/oauth/callback?provider=google&code=C&state=S"),
    null,
  );
  assert.equal(
    parseOAuthDeepLinkUrl("hyenicalendar://auth-callback?provider=google&code=C&state=S"),
    null,
  );
});

test("fragment(#) 형태도 커버한다(hyeni-1 계약 보존)", () => {
  const frag = `${CALLBACK}#provider=google&code=C&state=S`;
  assert.deepEqual(parseOAuthDeepLinkUrl(frag), { provider: "google", code: "C", state: "S" });
});

test("다른 스킴·미지원 provider·코드 또는 state 누락은 무시한다", () => {
  assert.equal(parseOAuthDeepLinkUrl("https://evil.example.com?provider=google&code=C"), null);
  assert.equal(parseOAuthDeepLinkUrl(`${CALLBACK}?provider=apple&code=C`), null);
  assert.equal(parseOAuthDeepLinkUrl(`${CALLBACK}?provider=google`), null);
  assert.equal(parseOAuthDeepLinkUrl(""), null);
});

test("state가 없으면 서버 transaction을 검증할 수 없어 거부한다", () => {
  const r = parseOAuthDeepLinkUrl(`${CALLBACK}?provider=google&code=C`);
  assert.equal(r, null);
});

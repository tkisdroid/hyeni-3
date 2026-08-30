import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  OAUTH_PROVIDERS,
  isOAuthProvider,
  oauthExchangePath,
} from "../src/transform/oauthProvider.ts";
import { socialProvidersForAccessCountry } from "../src/transform/accessCountry.ts";

test("콜백 호환 provider는 카카오·구글·네이버 3종이다", () => {
  assert.deepEqual([...OAUTH_PROVIDERS], ["kakao", "google", "naver"]);
  for (const p of OAUTH_PROVIDERS) assert.ok(isOAuthProvider(p));
  for (const bad of ["apple", "", null, undefined, 1, {}]) assert.equal(isOAuthProvider(bad), false);
});

test("교환 경로는 네이버만 별도 라우트다", () => {
  assert.equal(oauthExchangePath("kakao"), "/api/auth/oauth/kakao");
  assert.equal(oauthExchangePath("google"), "/api/auth/oauth/google");
  assert.equal(oauthExchangePath("naver"), "/api/auth/naver");
});

test("네이버도 client redirect_uri 없이 state와 별도 secret으로 교환한다", () => {
  const src = readFileSync(new URL("../src/lib/api/endpoints/auth.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /redirect_uri/);
  assert.match(src, /transactionSecret: context\.transactionSecret/);
});

test("네이버 인가 URL도 클라이언트가 조립하지 않고 서버 응답만 사용한다", () => {
  const src = readFileSync(new URL("../src/lib/api/endpoints/auth.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /nid\.naver\.com\/oauth2\.0\/authorize/);
  assert.match(src, /validateAuthorizationUrl\(provider, response\.authorizationUrl\)/);
});

test("신규 로그인 선택지는 카카오·Google만 노출하고 Naver 콜백 호환 판별은 보존한다", () => {
  assert.deepEqual(socialProvidersForAccessCountry("KR"), ["kakao", "google"]);
  assert.equal(isOAuthProvider("naver"), true);
});

test("딥링크 파서는 단일 출처 판별을 쓴다(하드코딩 목록 금지)", () => {
  // 파싱 로직은 transform/oauthDeepLinkParse 로 분리돼 실제 동작 테스트를 받는다
  // (tests/oauthDeepLinkParse.test.ts — Worker 가 실제로 만든 콜백 URL 로 검증).
  const parse = readFileSync(new URL("../src/transform/oauthDeepLinkParse.ts", import.meta.url), "utf8");
  assert.match(parse, /isOAuthProvider\(provider\)/);
  assert.ok(!parse.includes('provider !== "kakao" && provider !== "google"'));

  // 네이티브 모듈은 그 파서를 그대로 위임한다(중복 구현 금지).
  const native = readFileSync(new URL("../src/lib/native/oauthDeepLink.ts", import.meta.url), "utf8");
  assert.match(native, /return parseOAuthDeepLinkUrl\(url\)/);
});

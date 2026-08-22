import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  OAUTH_PROVIDERS,
  isOAuthProvider,
  oauthExchangePath,
  usesWorkerStartRedirect,
} from "../src/transform/oauthProvider.ts";

test("지원 provider 는 카카오·구글·네이버 3종이다", () => {
  assert.deepEqual([...OAUTH_PROVIDERS], ["kakao", "google", "naver"]);
  for (const p of OAUTH_PROVIDERS) assert.ok(isOAuthProvider(p));
  for (const bad of ["apple", "", null, undefined, 1, {}]) assert.equal(isOAuthProvider(bad), false);
});

test("세 provider 모두 Worker의 서버 발급 start transaction을 거친다", () => {
  assert.equal(usesWorkerStartRedirect("kakao"), true);
  assert.equal(usesWorkerStartRedirect("google"), true);
  assert.equal(usesWorkerStartRedirect("naver"), true);
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

test("온보딩 네이버 버튼은 키가 있을 때만 렌더된다", () => {
  const src = readFileSync(new URL("../src/screens/onboarding/Onboarding.tsx", import.meta.url), "utf8");
  const koCatalog = JSON.parse(readFileSync(
    new URL("../locales/ko/onboarding.json", import.meta.url),
    "utf8",
  ));
  // 2026-08-22 병합: socialProvidersForAccessCountry + naverAvailable 로 provider 판정.
  assert.match(src, /socialProvidersForAccessCountry\(accessCountry,\s*\{[\s\S]{0,100}naverAvailable:\s*hasNaverClientId/);
  assert.match(src, /socialProviders\.includes\("naver"\) && \([\s\S]{0,200}social\("naver"\)/);
  // 소셜 버튼은 탭에 따라 로그인/가입 라벨을 갈아끼운다 — 조건부 id 계약을 고정한다.
  assert.match(src, /signingUp \? "onboarding\.signup\.naver" : "onboarding\.login\.naver"/);
  assert.equal(koCatalog["onboarding.login.naver"], "네이버로 계속하기");
  assert.equal(koCatalog["onboarding.signup.naver"], "네이버로 가입하기");
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

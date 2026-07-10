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

test("네이버만 Worker /start 를 거치지 않는다(클라가 인가 URL 직접 조립)", () => {
  assert.equal(usesWorkerStartRedirect("kakao"), true);
  assert.equal(usesWorkerStartRedirect("google"), true);
  assert.equal(usesWorkerStartRedirect("naver"), false);
});

test("교환 경로는 네이버만 별도 라우트다", () => {
  assert.equal(oauthExchangePath("kakao"), "/api/auth/oauth/kakao");
  assert.equal(oauthExchangePath("google"), "/api/auth/oauth/google");
  assert.equal(oauthExchangePath("naver"), "/api/auth/naver");
});

test("네이버 교환은 redirect_uri 를 함께 보낸다(서버 필수 파라미터)", () => {
  const src = readFileSync(new URL("../src/lib/api/endpoints/auth.ts", import.meta.url), "utf8");
  assert.match(src, /if \(input\.provider === "naver"\) body\.redirect_uri = NAVER_CALLBACK_URL/);
  // 콜백 URL 은 네이버 개발자센터 등록값과 같아야 한다.
  assert.match(src, /NAVER_CALLBACK_URL = `\$\{API_BASE\}\/api\/auth\/naver`/);
});

test("키 미설정 시 네이버 로그인을 시작하지 않고 명시적으로 알린다(가짜 성공 금지)", () => {
  const src = readFileSync(new URL("../src/lib/api/endpoints/auth.ts", import.meta.url), "utf8");
  assert.match(src, /provider === "naver" && !NAVER_CLIENT_ID[\s\S]{0,120}throw new Error/);
});

test("온보딩 네이버 버튼은 키가 있을 때만 렌더된다", () => {
  const src = readFileSync(new URL("../src/screens/onboarding/Onboarding.tsx", import.meta.url), "utf8");
  assert.match(src, /\{hasNaverClientId && \([\s\S]{0,200}social\("naver"\)/);
  assert.match(src, /네이버로 계속하기/);
});

test("딥링크 파서는 provider=naver 콜백을 수용한다(Worker GET 콜백 계약)", () => {
  const src = readFileSync(new URL("../src/lib/native/oauthDeepLink.ts", import.meta.url), "utf8");
  // 하드코딩 목록 대신 단일 출처 판별을 쓴다(새 provider 추가 시 누락 방지).
  assert.match(src, /isOAuthProvider\(provider\)/);
  assert.ok(!src.includes('provider !== "kakao" && provider !== "google"'));
});

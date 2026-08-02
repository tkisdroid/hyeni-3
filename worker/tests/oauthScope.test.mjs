// 카카오 OAuth scope override 계약 — node --test worker/tests/oauthScope.test.mjs
// 콘솔 동의항목에 없는 scope 를 요청하면 카카오가 KOE205 로 거부하므로,
// 코드 배포 없이 secret 으로 scope 를 줄일 수 있어야 한다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../routes/oauth.ts", import.meta.url), "utf8");

test("kakao 기본 scope 는 닉네임·이메일·프로필사진이다", () => {
  assert.match(src, /scope:\s*"profile_nickname account_email profile_image"/);
});

test("start 라우트는 고정 cfg.scope 대신 resolveScope 를 쓴다", () => {
  assert.match(src, /scope:\s*resolveScope\(c\.env, provider, cfg\)/);
  assert.doesNotMatch(src, /params = new URLSearchParams\(\{[\s\S]{0,200}scope:\s*cfg\.scope/);
});

test("resolveScope 는 kakao 에서만 override 를 적용하고, 미설정이면 기본값을 쓴다", () => {
  const fn = src.slice(src.indexOf("function resolveScope"));
  const body = fn.slice(0, fn.indexOf("\n}"));
  assert.match(body, /provider === "kakao"/);
  assert.match(body, /env\.KAKAO_OAUTH_SCOPE/);
  assert.match(body, /return override \|\| cfg\.scope/);
  // 다른 provider(google) 는 override 대상이 아니다.
  assert.match(body, /provider === "kakao" \? \(env\.KAKAO_OAUTH_SCOPE \|\| ""\)\.trim\(\) : ""/);
});

test("이메일 미제공 시 폴백 이메일을 만든다(동의항목 없이도 로그인 가능)", () => {
  assert.match(src, /profile\.email \|\| `\$\{provider\}-\$\{providerId\}@hyeni\.local`/);
});

test("kakao 는 client_secret 이 선택이다(콘솔 보안 활성 시에만 전송)", () => {
  assert.match(src, /requireClientSecret:\s*false/);
  assert.match(src, /if \(clientSecret\) tokenForm\.set\("client_secret", clientSecret\)/);
});

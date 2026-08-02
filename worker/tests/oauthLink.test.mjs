import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// TS 를 그대로 못 읽으니 소스에서 로직을 검증하는 대신, 판정 규칙을 그대로 옮긴 참조 구현과
// 실제 소스의 분기 순서를 함께 확인한다(worker 는 node 로 TS 실행 불가).
const SRC = readFileSync(new URL("../lib/oauthLink.ts", import.meta.url), "utf8");

// lib/oauthLink.ts 의 decideOAuthLink 와 동일한 규칙(순서 포함).
function decide({ owner, emailVerified, emailIsFallback }) {
  if (!owner) return { kind: "create" };
  if (emailIsFallback) return { kind: "conflict", reason: "email_placeholder" };
  if (owner.isAnonymous) return { kind: "conflict", reason: "anonymous_owner" };
  if (!emailVerified) return { kind: "conflict", reason: "email_unverified" };
  return { kind: "link", userId: owner.id };
}

const OWNER = { id: "u-1", isAnonymous: false };

test("이메일 소유자가 없으면 새 계정을 만든다", () => {
  assert.deepEqual(decide({ owner: null, emailVerified: true, emailIsFallback: false }), { kind: "create" });
});

test("검증된 이메일이면 기존 계정에 연결한다(구글 로그인 영구 실패 수정)", () => {
  assert.deepEqual(decide({ owner: OWNER, emailVerified: true, emailIsFallback: false }), {
    kind: "link",
    userId: "u-1",
  });
});

test("검증되지 않은 이메일로는 남의 계정에 붙지 않는다(탈취 방지)", () => {
  assert.deepEqual(decide({ owner: OWNER, emailVerified: false, emailIsFallback: false }), {
    kind: "conflict",
    reason: "email_unverified",
  });
});

test("익명 계정(아이 기기 세션)은 OAuth 로 접수하지 않는다", () => {
  assert.deepEqual(
    decide({ owner: { id: "anon", isAnonymous: true }, emailVerified: true, emailIsFallback: false }),
    { kind: "conflict", reason: "anonymous_owner" },
  );
});

test("폴백 이메일(@hyeni.local)은 연결 근거가 될 수 없다", () => {
  assert.deepEqual(decide({ owner: OWNER, emailVerified: true, emailIsFallback: true }), {
    kind: "conflict",
    reason: "email_placeholder",
  });
});

test("판정 순서가 소스와 같다 — 폴백 → 익명 → 미검증 → 연결", () => {
  // 타입 선언·메시지 스위치가 아니라 decideOAuthLink 본문만 본다.
  const start = SRC.indexOf("export function decideOAuthLink");
  const end = SRC.indexOf("export type OAuthConflictReason");
  assert.ok(start > 0 && end > start, "decideOAuthLink 본문을 찾지 못했다");
  const body = SRC.slice(start, end);

  const iFallback = body.indexOf("email_placeholder");
  const iAnon = body.indexOf("anonymous_owner");
  const iUnverified = body.indexOf("email_unverified");
  const iLink = body.indexOf('kind: "link"');
  assert.ok(iFallback > 0, "폴백 검사 없음");
  assert.ok(iAnon > iFallback, "익명 검사는 폴백 뒤");
  assert.ok(iUnverified > iAnon, "미검증 검사는 익명 뒤");
  assert.ok(iLink > iUnverified, "연결은 모든 거부 검사 뒤");
});

test("email_verified 는 boolean 과 문자열 'true' 를 모두 받는다", () => {
  assert.match(SRC, /export function readEmailVerified/);
  assert.match(SRC, /value\.toLowerCase\(\) === "true"/);
});

test("oauth 라우트가 판정 함수를 실제로 쓴다(무조건 409 금지)", () => {
  const route = readFileSync(new URL("../routes/oauth.ts", import.meta.url), "utf8");
  assert.match(route, /decideOAuthLink/);
  assert.ok(
    !/const emailOwner = [\s\S]{0,120}if \(emailOwner\) \{\s*return c\.json\(\{ error: "email_conflict_other_account" \}, 409\);/.test(route),
    "무조건 409 로 거부하는 옛 분기가 남아 있다",
  );
  assert.match(route, /INSERT INTO auth_identities[\s\S]{0,400}link/i);
});

test("google/kakao profile 이 emailVerified 를 채운다", () => {
  const route = readFileSync(new URL("../routes/oauth.ts", import.meta.url), "utf8");
  assert.match(route, /emailVerified: readEmailVerified\(json\.email_verified\)/);
  assert.match(route, /emailVerified: readEmailVerified\(account\.is_email_verified\)/);
});

test("계정 연결 라우트는 인증을 요구하고 남의 identity 를 뺏지 않는다", () => {
  const route = readFileSync(new URL("../routes/oauth.ts", import.meta.url), "utf8");
  assert.match(route, /oauth\.post\("\/oauth\/:provider\/link", requireAuth/);
  assert.match(route, /error: "identity_taken"[\s\S]{0,120}409/);
  // 이미 내 계정에 붙어 있으면 멱등 성공.
  assert.match(route, /already: true/);
  // 연결 목록 조회도 인증 필요.
  assert.match(route, /oauth\.get\("\/oauth\/links", requireAuth/);
});

test("로그인·연결이 같은 교환 헬퍼를 공유한다(중복 구현 금지)", () => {
  const route = readFileSync(new URL("../routes/oauth.ts", import.meta.url), "utf8");
  const calls = route.match(/await exchangeProfile\(c, provider, cfg,/g) ?? [];
  assert.equal(calls.length, 2, "로그인 POST 와 link POST 두 곳에서만 호출되어야 한다");
  assert.equal((route.match(/grant_type: "authorization_code"/g) ?? []).length, 1, "토큰 교환 구현은 한 곳");
});

// lib/oauthLink.ts 의 decideOAuthUnlink 와 동일한 규칙.
function decideUnlink({ hasPasswordLogin, remainingSocialCount }) {
  const methods = (hasPasswordLogin ? 1 : 0) + Math.max(0, remainingSocialCount);
  return methods < 1 ? { kind: "deny", reason: "last_login_method" } : { kind: "allow" };
}

test("비밀번호 로그인이 있으면 소셜을 모두 해제할 수 있다", () => {
  assert.deepEqual(decideUnlink({ hasPasswordLogin: true, remainingSocialCount: 0 }), { kind: "allow" });
});

test("소셜이 둘이면 하나는 해제할 수 있다", () => {
  assert.deepEqual(decideUnlink({ hasPasswordLogin: false, remainingSocialCount: 1 }), { kind: "allow" });
});

test("마지막 로그인 수단은 해제할 수 없다(계정 영구 잠김 방지)", () => {
  assert.deepEqual(decideUnlink({ hasPasswordLogin: false, remainingSocialCount: 0 }), {
    kind: "deny",
    reason: "last_login_method",
  });
});

test("해제 라우트는 인증을 요구하고 내 identity 만 지운다", () => {
  const route = readFileSync(new URL("../routes/oauth.ts", import.meta.url), "utf8");
  assert.match(route, /oauth\.post\("\/oauth\/:provider\/unlink", requireAuth/);
  assert.match(route, /DELETE FROM auth_identities WHERE user_id=\? AND provider=\? AND provider_id=\?/);
  assert.match(route, /decideOAuthUnlink/);
  assert.match(route, /error: decision\.reason, message: oauthUnlinkDenyMessage\(decision\.reason\)/);
});

test("연결 목록은 provider_id 와 비밀번호 로그인 가능 여부를 함께 준다", () => {
  const route = readFileSync(new URL("../routes/oauth.ts", import.meta.url), "utf8");
  assert.match(route, /hasPasswordLogin/);
  assert.match(route, /providerId: r\.provider_id/);
});

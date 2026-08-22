// 온보딩 세션 보호 가드 — 소스 계약 회귀 검사(2026-07-10 세션 파괴 사고).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("온보딩 라우트는 RequireGuest 로 감싸 인증 세션의 마운트를 막는다", () => {
  const app = read("src/app/App.tsx");
  assert.match(app, /import \{ RequireGuest \} from "@\/auth\/RequireGuest"/);
  assert.match(app, /path: "onboarding"[\s\S]{0,200}<RequireGuest>[\s\S]{0,80}<Onboarding \/>/);
});

test("RequireGuest 는 가족에 연결된 세션을 역할 홈으로 되돌린다", () => {
  const guard = read("src/auth/RequireGuest.tsx");
  assert.match(guard, /auth\.status === "authenticated" && auth\.familyId/);
  assert.match(guard, /Navigate to=\{homePathForRole\(auth\.role\)\} replace/);
});

test("pair 딥링크 핸들러는 인증 세션에서 anonymousLogin 을 호출하지 않는다", () => {
  const ob = read("src/screens/onboarding/Onboarding.tsx");
  // 딥링크 effect: deriveAuthState 로 조기 이탈하는 방어가 anonymousLogin 앞에 있어야 한다.
  const effectStart = ob.indexOf("const invite = readPairInvite()");
  assert.ok(effectStart >= 0, "pair 딥링크 effect 시작점을 찾을 수 없습니다");
  const effect = ob.slice(effectStart, ob.indexOf("const back ="));
  const guardAt = effect.indexOf("current.status === \"authenticated\"");
  const anonAt = effect.indexOf("anonymousLogin()");
  assert.ok(guardAt > -1, "딥링크 effect 에 인증 세션 가드가 없다");
  assert.ok(anonAt > -1, "딥링크 effect 에 anonymousLogin 호출이 없다");
  assert.ok(guardAt < anonAt, "가드가 anonymousLogin 보다 뒤에 있다");
});

test("startChildMode 는 인증 세션에서 anonymousLogin 을 호출하지 않는다", () => {
  const ob = read("src/screens/onboarding/Onboarding.tsx");
  const fn = ob.slice(ob.indexOf("const startChildMode = async"));
  const guardAt = fn.indexOf("current.status === \"authenticated\"");
  const anonAt = fn.indexOf("anonymousLogin()");
  assert.ok(guardAt > -1 && anonAt > -1 && guardAt < anonAt);
});

import test from "node:test";
import assert from "node:assert/strict";

import { resolveAuthenticatedOnboardingRedirect } from "../src/transform/onboardingRedirect.ts";

test("기존 child 세션이 가족에 연결되어 있으면 온보딩 대신 아이 홈으로 보낸다", () => {
  assert.equal(
    resolveAuthenticatedOnboardingRedirect({
      role: "child",
      familyId: "family-1",
      hasOAuthCallback: false,
      hasPairParam: false,
    }),
    "/child/home",
  );
});

test("★QR 페어링 딥링크로 재진입해도 인증된 세션은 홈으로 되돌린다(세션 파괴 방지)", () => {
  // 2026-07-10 실사고: pair 파라미터가 있으면 온보딩에 머물렀고, 그 자리에서 딥링크
  // 핸들러의 anonymousLogin 이 기존 세션을 익명으로 덮어써 로그아웃됐다.
  assert.equal(
    resolveAuthenticatedOnboardingRedirect({
      role: "child",
      familyId: "family-1",
      hasOAuthCallback: false,
      hasPairParam: true,
    }),
    "/child/home",
  );
  assert.equal(
    resolveAuthenticatedOnboardingRedirect({
      role: "parent",
      familyId: "family-1",
      hasOAuthCallback: false,
      hasPairParam: true,
    }),
    "/parent/home",
  );
});

test("OAuth 콜백 처리 중에는 리다이렉트가 끼어들지 않는다(콜백이 세션을 완성해야 함)", () => {
  assert.equal(
    resolveAuthenticatedOnboardingRedirect({
      role: "parent",
      familyId: "family-1",
      hasOAuthCallback: true,
      hasPairParam: false,
    }),
    null,
  );
});

test("가족 미연결(페어링·가족설정 대기) 상태는 온보딩에 머문다", () => {
  assert.equal(
    resolveAuthenticatedOnboardingRedirect({
      role: null,
      familyId: null,
      hasOAuthCallback: false,
      hasPairParam: true,
    }),
    null,
  );
  // 부모가 로그인했지만 아직 가족을 만들지 않은 단계.
  assert.equal(
    resolveAuthenticatedOnboardingRedirect({
      role: "parent",
      familyId: null,
      hasOAuthCallback: false,
      hasPairParam: false,
    }),
    null,
  );
});

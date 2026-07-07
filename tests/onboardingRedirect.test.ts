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

test("QR 페어링이나 OAuth 콜백 처리 중이면 기존 세션 리다이렉트가 끼어들지 않는다", () => {
  assert.equal(
    resolveAuthenticatedOnboardingRedirect({
      role: "child",
      familyId: "family-1",
      hasOAuthCallback: false,
      hasPairParam: true,
    }),
    null,
  );
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

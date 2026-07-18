import test from "node:test";
import assert from "node:assert/strict";

import {
  beginOnboardingAuthTransition,
  endOnboardingAuthTransition,
  getOnboardingAuthTransitionSnapshot,
  subscribeOnboardingAuthTransition,
} from "../src/auth/onboardingAuthTransition.ts";
import { resolveAuthenticatedOnboardingRedirect } from "../src/transform/onboardingRedirect.ts";

const authenticatedParent = {
  role: "parent" as const,
  familyId: "family-1",
  hasOAuthCallback: false,
  hasPairParam: false,
};

test("인증 전환 중에는 가족 claim이 생겨도 온보딩에서 즉시 이동하지 않고 종료 뒤 복구한다", () => {
  endOnboardingAuthTransition();
  beginOnboardingAuthTransition();

  assert.equal(getOnboardingAuthTransitionSnapshot(), true);
  assert.equal(
    resolveAuthenticatedOnboardingRedirect({
      ...authenticatedParent,
      authTransitionActive: getOnboardingAuthTransitionSnapshot(),
    }),
    null,
  );

  endOnboardingAuthTransition();
  assert.equal(getOnboardingAuthTransitionSnapshot(), false);
  assert.equal(
    resolveAuthenticatedOnboardingRedirect({
      ...authenticatedParent,
      authTransitionActive: getOnboardingAuthTransitionSnapshot(),
    }),
    "/parent/home",
  );
});

test("외부 store는 실제 begin/end 전환만 구독자에게 알린다", () => {
  endOnboardingAuthTransition();
  let notifications = 0;
  const unsubscribe = subscribeOnboardingAuthTransition(() => {
    notifications += 1;
  });

  beginOnboardingAuthTransition();
  beginOnboardingAuthTransition();
  endOnboardingAuthTransition();
  endOnboardingAuthTransition();
  unsubscribe();

  assert.equal(notifications, 2);
});

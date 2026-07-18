import test from "node:test";
import assert from "node:assert/strict";

import * as authTransition from "../src/auth/onboardingAuthTransition.ts";
import { resolveAuthenticatedOnboardingRedirect } from "../src/transform/onboardingRedirect.ts";

const authenticatedParent = {
  role: "parent" as const,
  familyId: "family-1",
  hasOAuthCallback: false,
  hasPairParam: false,
};

function resetTransitions(): void {
  authTransition.cancelOnboardingAuthTransitions();
}

test("B 전환만 끝나면 먼저 시작한 A 전환 gate는 유지된다", () => {
  resetTransitions();
  try {
    const transitionA = authTransition.beginOnboardingAuthTransition();
    const transitionB = authTransition.beginOnboardingAuthTransition();

    assert.notEqual(transitionA, transitionB);
    authTransition.endOnboardingAuthTransition(transitionB);
    assert.equal(authTransition.getOnboardingAuthTransitionSnapshot(), true);

    authTransition.endOnboardingAuthTransition(transitionA);
    assert.equal(authTransition.getOnboardingAuthTransitionSnapshot(), false);
  } finally {
    resetTransitions();
  }
});

test("A 가족 조회 실패 유지 중 B의 세션 채택 전 실패가 A gate를 닫지 않는다", () => {
  resetTransitions();
  try {
    const familyLookupFailureToken = authTransition.beginOnboardingAuthTransition();
    const preAdoptionFailureToken = authTransition.beginOnboardingAuthTransition();

    authTransition.endOnboardingAuthTransition(preAdoptionFailureToken);

    assert.equal(authTransition.getOnboardingAuthTransitionSnapshot(), true);
    assert.equal(
      resolveAuthenticatedOnboardingRedirect({
        ...authenticatedParent,
        authTransitionActive: authTransition.getOnboardingAuthTransitionSnapshot(),
      }),
      null,
    );

    authTransition.endOnboardingAuthTransition(familyLookupFailureToken);
  } finally {
    resetTransitions();
  }
});

test("가족 판정 완료는 남아 있는 모든 인증 전환 token을 끝낸다", () => {
  resetTransitions();
  try {
    authTransition.beginOnboardingAuthTransition();
    authTransition.beginOnboardingAuthTransition();

    assert.equal(typeof authTransition.completeOnboardingAuthTransitions, "function");
    authTransition.completeOnboardingAuthTransitions();
    assert.equal(authTransition.getOnboardingAuthTransitionSnapshot(), false);
  } finally {
    resetTransitions();
  }
});

test("명시적 이탈 취소는 남아 있는 모든 인증 전환 token을 끝낸다", () => {
  resetTransitions();
  try {
    authTransition.beginOnboardingAuthTransition();
    authTransition.beginOnboardingAuthTransition();

    assert.equal(typeof authTransition.cancelOnboardingAuthTransitions, "function");
    authTransition.cancelOnboardingAuthTransitions();
    assert.equal(authTransition.getOnboardingAuthTransitionSnapshot(), false);
  } finally {
    resetTransitions();
  }
});

test("StrictMode 유사 중복 effect의 첫 cleanup은 replay 전환을 닫지 않는다", () => {
  resetTransitions();
  try {
    const firstEffectToken = authTransition.beginOnboardingAuthTransition();
    const replayEffectToken = authTransition.beginOnboardingAuthTransition();

    authTransition.endOnboardingAuthTransition(firstEffectToken);
    assert.equal(authTransition.getOnboardingAuthTransitionSnapshot(), true);

    authTransition.endOnboardingAuthTransition(replayEffectToken);
    assert.equal(authTransition.getOnboardingAuthTransitionSnapshot(), false);
  } finally {
    resetTransitions();
  }
});

test("전체 완료 뒤 늦게 도착한 이전 token 종료는 새 전환을 닫지 않는다", () => {
  resetTransitions();
  try {
    const staleToken = authTransition.beginOnboardingAuthTransition();
    authTransition.completeOnboardingAuthTransitions();
    const currentToken = authTransition.beginOnboardingAuthTransition();

    authTransition.endOnboardingAuthTransition(staleToken);
    assert.equal(authTransition.getOnboardingAuthTransitionSnapshot(), true);

    authTransition.endOnboardingAuthTransition(currentToken);
    assert.equal(authTransition.getOnboardingAuthTransitionSnapshot(), false);
  } finally {
    resetTransitions();
  }
});

test("boolean snapshot 구독자는 첫 시작과 마지막 종료에만 알림을 받는다", () => {
  resetTransitions();
  let notifications = 0;
  const unsubscribe = authTransition.subscribeOnboardingAuthTransition(() => {
    notifications += 1;
  });

  try {
    const transitionA = authTransition.beginOnboardingAuthTransition();
    const transitionB = authTransition.beginOnboardingAuthTransition();
    authTransition.endOnboardingAuthTransition(transitionB);
    authTransition.endOnboardingAuthTransition(transitionA);

    assert.equal(notifications, 2);
  } finally {
    unsubscribe();
    resetTransitions();
  }
});

test("마지막 token 종료 뒤에는 인증된 가족의 역할 홈 redirect가 복구된다", () => {
  resetTransitions();
  try {
    const transitionToken = authTransition.beginOnboardingAuthTransition();
    assert.equal(
      resolveAuthenticatedOnboardingRedirect({
        ...authenticatedParent,
        authTransitionActive: authTransition.getOnboardingAuthTransitionSnapshot(),
      }),
      null,
    );

    authTransition.endOnboardingAuthTransition(transitionToken);
    assert.equal(
      resolveAuthenticatedOnboardingRedirect({
        ...authenticatedParent,
        authTransitionActive: authTransition.getOnboardingAuthTransitionSnapshot(),
      }),
      "/parent/home",
    );
  } finally {
    resetTransitions();
  }
});

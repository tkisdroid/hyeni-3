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

test("A 가족 조회 실패 뒤 B 성공은 B 세대까지 남은 전환을 모두 끝낸다", () => {
  resetTransitions();
  try {
    const transitionA = authTransition.beginOnboardingAuthTransition();
    const transitionB = authTransition.beginOnboardingAuthTransition();

    assert.equal(typeof authTransition.completeOnboardingAuthTransitionsThrough, "function");
    let routeApplied = false;
    const completed = authTransition.completeOnboardingAuthTransitionsThrough(transitionB);
    if (completed) routeApplied = true;

    assert.equal(completed, true);
    assert.equal(routeApplied, true);
    assert.equal(authTransition.getOnboardingAuthTransitionSnapshot(), false);

    authTransition.endOnboardingAuthTransition(transitionA);
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

test("StrictMode 첫 effect가 stale이면 늦은 catch와 finally가 replay UI를 바꾸지 않는다", () => {
  resetTransitions();
  try {
    const staleEffectToken = authTransition.beginOnboardingAuthTransition();
    authTransition.endOnboardingAuthTransition(staleEffectToken);
    const replayEffectToken = authTransition.beginOnboardingAuthTransition();
    const ui = { busy: true, step: "login", toasts: 0 };

    if (authTransition.isOnboardingAuthTransitionActive(staleEffectToken)) {
      ui.toasts += 1;
      ui.step = "role";
    }
    if (authTransition.isOnboardingAuthTransitionActive(staleEffectToken)) {
      ui.busy = false;
    }

    assert.deepEqual(ui, { busy: true, step: "login", toasts: 0 });
    assert.equal(authTransition.isOnboardingAuthTransitionActive(replayEffectToken), true);
    authTransition.endOnboardingAuthTransition(replayEffectToken);
  } finally {
    resetTransitions();
  }
});

test("A 시작 후 cancel하고 B를 시작하면 늦은 A 완료가 B를 닫지 않는다", () => {
  resetTransitions();
  try {
    const staleToken = authTransition.beginOnboardingAuthTransition();
    authTransition.cancelOnboardingAuthTransitions();
    const currentToken = authTransition.beginOnboardingAuthTransition();
    let connectTransitions = 0;
    let navigations = 0;

    const completed = authTransition.completeOnboardingAuthTransitionsThrough(staleToken);
    if (completed) {
      connectTransitions += 1;
      navigations += 1;
    }

    assert.equal(completed, false);
    assert.equal(connectTransitions, 0);
    assert.equal(navigations, 0);
    assert.equal(authTransition.getOnboardingAuthTransitionSnapshot(), true);
    assert.equal(authTransition.isOnboardingAuthTransitionActive(currentToken), true);

    authTransition.endOnboardingAuthTransition(currentToken);
    assert.equal(authTransition.getOnboardingAuthTransitionSnapshot(), false);
  } finally {
    resetTransitions();
  }
});

test("A와 B가 동시에 진행 중일 때 먼저 끝난 A 성공은 더 최신 B를 닫지 않는다", () => {
  resetTransitions();
  try {
    const transitionA = authTransition.beginOnboardingAuthTransition();
    const transitionB = authTransition.beginOnboardingAuthTransition();

    const completed = authTransition.completeOnboardingAuthTransitionsThrough(transitionA);
    assert.equal(completed, true);
    assert.equal(authTransition.getOnboardingAuthTransitionSnapshot(), true);
    assert.equal(authTransition.isOnboardingAuthTransitionActive(transitionB), true);

    authTransition.endOnboardingAuthTransition(transitionB);
    assert.equal(authTransition.getOnboardingAuthTransitionSnapshot(), false);
  } finally {
    resetTransitions();
  }
});

test("cancel은 active token만 비우고 다음 token의 단조 증가 세대를 초기화하지 않는다", () => {
  resetTransitions();
  try {
    const beforeCancel = authTransition.beginOnboardingAuthTransition();
    authTransition.cancelOnboardingAuthTransitions();
    const afterCancel = authTransition.beginOnboardingAuthTransition();

    assert.ok(afterCancel > beforeCancel);
    authTransition.endOnboardingAuthTransition(afterCancel);
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

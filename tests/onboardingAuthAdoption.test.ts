import test from "node:test";
import assert from "node:assert/strict";

import * as authTransition from "../src/auth/onboardingAuthTransition.ts";

type AuthResult = {
  user: { id: string; familyId?: string | null };
  session: { access_token: string };
};

type AdoptionModule = {
  createIdempotentAuthResultAdopter: <T extends object>(effects: {
    applySession: (result: T) => void;
    applyUser: (result: T) => void;
    notify: () => void;
  }) => (result: T) => boolean;
  returnAuthResultWithAdoption: <T extends object>(
    result: T,
    options: { sessionAdoption?: "immediate" | "deferred" } | undefined,
    adopt: (result: T) => boolean,
  ) => T;
};

type SessionOwnershipModule = {
  requestWithSessionOwnership: <T>(
    request: () => Promise<T>,
    readOwner: () => { sessionInstanceId: string | null; userId: string | null },
    applyOwnedResponse: (result: T) => void,
  ) => Promise<T>;
};

const adoptionModule = await import("../src/auth/authResultAdoption.ts")
  .catch(() => null) as AdoptionModule | null;
const sessionOwnershipModule = await import("../src/auth/sessionRequestOwnership.ts")
  .catch(() => null) as SessionOwnershipModule | null;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createAuthHarness() {
  assert.ok(adoptionModule, "인증 결과 채택 정책 모듈이 필요합니다");
  const state = {
    accessToken: null as string | null,
    userId: null as string | null,
    familyId: null as string | null,
    sessionInstanceId: null as string | null,
    applySessionCount: 0,
    applyUserCount: 0,
    notifyCount: 0,
  };
  const adopt = adoptionModule.createIdempotentAuthResultAdopter<AuthResult>({
    applySession: (result) => {
      state.accessToken = result.session.access_token;
      state.sessionInstanceId = `session-${result.user.id}`;
      state.applySessionCount += 1;
    },
    applyUser: (result) => {
      state.userId = result.user.id;
      state.applyUserCount += 1;
    },
    notify: () => {
      state.notifyCount += 1;
    },
  });
  return { state, adopt };
}

function resetTransitions(): void {
  authTransition.cancelOnboardingAuthTransitions();
}

test("deferred 인증 응답은 명시적 채택 전 세션·사용자·알림을 바꾸지 않는다", () => {
  assert.ok(adoptionModule, "인증 결과 채택 정책 모듈이 필요합니다");
  const { state, adopt } = createAuthHarness();
  const result: AuthResult = {
    user: { id: "user-a" },
    session: { access_token: "access-a" },
  };

  const returned = adoptionModule.returnAuthResultWithAdoption(
    result,
    { sessionAdoption: "deferred" },
    adopt,
  );

  assert.equal(returned, result);
  assert.deepEqual(state, {
    accessToken: null,
    userId: null,
    familyId: null,
    sessionInstanceId: null,
    applySessionCount: 0,
    applyUserCount: 0,
    notifyCount: 0,
  });
});

test("명시적 인증 결과 채택은 같은 응답 객체에 정확히 한 번만 적용된다", () => {
  const { state, adopt } = createAuthHarness();
  const result: AuthResult = {
    user: { id: "user-a" },
    session: { access_token: "access-a" },
  };

  assert.equal(adopt(result), true);
  assert.equal(adopt(result), false);
  assert.equal(state.applySessionCount, 1);
  assert.equal(state.applyUserCount, 1);
  assert.equal(state.notifyCount, 1);
  assert.equal(state.accessToken, "access-a");
  assert.equal(state.userId, "user-a");
});

test("토큰 알림 중 같은 응답을 동기 재진입해도 채택 효과는 한 번뿐이다", () => {
  assert.ok(adoptionModule, "인증 결과 채택 정책 모듈이 필요합니다");
  const result: AuthResult = {
    user: { id: "user-a" },
    session: { access_token: "access-a" },
  };
  const effects: string[] = [];
  let reentrantResult: boolean | null = null;
  let adopt!: (value: AuthResult) => boolean;
  adopt = adoptionModule.createIdempotentAuthResultAdopter<AuthResult>({
    applySession: () => effects.push("session"),
    applyUser: () => effects.push("user"),
    notify: () => {
      effects.push("notify");
      reentrantResult = adopt(result);
    },
  });

  assert.equal(adopt(result), true);
  assert.equal(reentrantResult, false);
  assert.deepEqual(effects, ["session", "user", "notify"]);
});

test("옵션을 생략한 기존 인증 호출은 즉시 세션을 채택한다", () => {
  assert.ok(adoptionModule, "인증 결과 채택 정책 모듈이 필요합니다");
  const { state, adopt } = createAuthHarness();
  const result: AuthResult = {
    user: { id: "legacy-user" },
    session: { access_token: "legacy-access" },
  };

  adoptionModule.returnAuthResultWithAdoption(result, undefined, adopt);

  assert.equal(state.accessToken, "legacy-access");
  assert.equal(state.userId, "legacy-user");
  assert.equal(state.applySessionCount, 1);
  assert.equal(state.applyUserCount, 1);
  assert.equal(state.notifyCount, 1);
});

test("A를 취소하고 B를 시작한 뒤 늦은 A 성공은 세션을 채택하지 않는다", async () => {
  resetTransitions();
  try {
    assert.equal(
      typeof authTransition.commitOnboardingAuthResult,
      "function",
      "활성 token과 인증 결과를 동기 커밋하는 경계가 필요합니다",
    );
    const { state, adopt } = createAuthHarness();
    const pendingA = deferred<AuthResult>();
    const tokenA = authTransition.beginOnboardingAuthTransition();
    const continuationA = pendingA.promise.then((result) =>
      authTransition.commitOnboardingAuthResult(tokenA, result, adopt));

    authTransition.cancelOnboardingAuthTransitions();
    const tokenB = authTransition.beginOnboardingAuthTransition();
    pendingA.resolve({
      user: { id: "user-a" },
      session: { access_token: "access-a" },
    });

    assert.equal(await continuationA, "stale");
    assert.equal(state.applySessionCount, 0);
    assert.equal(state.applyUserCount, 0);
    assert.equal(state.notifyCount, 0);
    assert.equal(authTransition.isOnboardingAuthTransitionActive(tokenB), true);
  } finally {
    resetTransitions();
  }
});

test("A 취소 뒤 B 세션·가족 확정 후 늦은 A가 B 상태를 덮지 않는다", async () => {
  resetTransitions();
  try {
    assert.ok(sessionOwnershipModule, "세션 소유 응답 가드 모듈이 필요합니다");
    const { state, adopt } = createAuthHarness();
    const pendingA = deferred<AuthResult>();
    const pendingFamilyB = deferred<{ familyId: string }>();
    const tokenA = authTransition.beginOnboardingAuthTransition();
    const continuationA = pendingA.promise.then((result) =>
      authTransition.commitOnboardingAuthResult(tokenA, result, adopt));

    authTransition.cancelOnboardingAuthTransitions();
    const tokenB = authTransition.beginOnboardingAuthTransition();
    const resultB: AuthResult = {
      user: { id: "user-b" },
      session: { access_token: "access-b" },
    };
    assert.equal(authTransition.commitOnboardingAuthResult(tokenB, resultB, adopt), "adopted");

    const familyB = sessionOwnershipModule.requestWithSessionOwnership(
      () => pendingFamilyB.promise,
      () => ({ sessionInstanceId: state.sessionInstanceId, userId: state.userId }),
      (result) => {
        state.familyId = result.familyId;
      },
    );
    pendingFamilyB.resolve({ familyId: "family-b" });
    await familyB;

    pendingA.resolve({
      user: { id: "user-a" },
      session: { access_token: "access-a" },
    });
    assert.equal(await continuationA, "stale");
    assert.equal(state.accessToken, "access-b");
    assert.equal(state.userId, "user-b");
    assert.equal(state.familyId, "family-b");
    assert.equal(state.applySessionCount, 1);
    assert.equal(state.applyUserCount, 1);
    authTransition.completeOnboardingAuthTransitionsThrough(tokenB);
  } finally {
    resetTransitions();
  }
});

test("StrictMode 공유 응답은 stale A 0회, active replay B 1회만 채택한다", async () => {
  resetTransitions();
  try {
    const { state, adopt } = createAuthHarness();
    const shared = deferred<AuthResult>();
    const tokenA = authTransition.beginOnboardingAuthTransition();
    const continuationA = shared.promise.then((result) =>
      authTransition.commitOnboardingAuthResult(tokenA, result, adopt));

    authTransition.endOnboardingAuthTransition(tokenA);
    const tokenB = authTransition.beginOnboardingAuthTransition();
    const continuationB = shared.promise.then((result) =>
      authTransition.commitOnboardingAuthResult(tokenB, result, adopt));

    shared.resolve({
      user: { id: "user-b" },
      session: { access_token: "access-b" },
    });

    assert.equal(await continuationA, "stale");
    assert.equal(await continuationB, "adopted");
    assert.equal(state.applySessionCount, 1);
    assert.equal(state.applyUserCount, 1);
    assert.equal(state.notifyCount, 1);
    authTransition.completeOnboardingAuthTransitionsThrough(tokenB);
  } finally {
    resetTransitions();
  }
});

test("세션이 바뀐 뒤 도착한 가족 응답은 현재 사용자·가족을 보정하지 않는다", async () => {
  assert.ok(sessionOwnershipModule, "세션 소유 응답 가드 모듈이 필요합니다");
  const pending = deferred<{ familyId: string }>();
  const state = {
    sessionInstanceId: "session-a" as string | null,
    userId: "user-a" as string | null,
    familyId: null as string | null,
    mutations: 0,
  };
  const request = sessionOwnershipModule.requestWithSessionOwnership(
    () => pending.promise,
    () => ({ sessionInstanceId: state.sessionInstanceId, userId: state.userId }),
    (result) => {
      state.familyId = result.familyId;
      state.mutations += 1;
    },
  );

  state.sessionInstanceId = "session-b";
  state.userId = "user-b";
  state.familyId = "family-b";
  pending.resolve({ familyId: "family-a" });

  assert.deepEqual(await request, { familyId: "family-a" });
  assert.equal(state.familyId, "family-b");
  assert.equal(state.mutations, 0);
});

test("같은 세션·사용자의 가족 응답은 기존 계약대로 보정하고 반환한다", async () => {
  assert.ok(sessionOwnershipModule, "세션 소유 응답 가드 모듈이 필요합니다");
  const state = {
    sessionInstanceId: "session-a" as string | null,
    userId: "user-a" as string | null,
    familyId: null as string | null,
    mutations: 0,
  };
  const response = { familyId: "family-a" };

  const returned = await sessionOwnershipModule.requestWithSessionOwnership(
    async () => response,
    () => ({ sessionInstanceId: state.sessionInstanceId, userId: state.userId }),
    (result) => {
      state.familyId = result.familyId;
      state.mutations += 1;
    },
  );

  assert.equal(returned, response);
  assert.equal(state.familyId, "family-a");
  assert.equal(state.mutations, 1);
});

test("세션 커밋 뒤 일반 cancel·cleanup은 gate를 풀지 않고 완료만 해제한다", () => {
  resetTransitions();
  try {
    const { adopt } = createAuthHarness();
    const token = authTransition.beginOnboardingAuthTransition();
    const result: AuthResult = {
      user: { id: "user-a" },
      session: { access_token: "access-a" },
    };

    assert.equal(authTransition.commitOnboardingAuthResult(token, result, adopt), "adopted");
    assert.equal(authTransition.getOnboardingAuthCommitSnapshot(), true);
    authTransition.cancelOnboardingAuthTransitions();
    authTransition.endOnboardingAuthTransition(token);

    assert.equal(authTransition.isOnboardingAuthTransitionActive(token), true);
    assert.equal(authTransition.getOnboardingAuthTransitionSnapshot(), true);
    assert.equal(authTransition.getOnboardingAuthCommitSnapshot(), true);
    assert.equal(authTransition.completeOnboardingAuthTransitionsThrough(token), true);
    assert.equal(authTransition.getOnboardingAuthTransitionSnapshot(), false);
    assert.equal(authTransition.getOnboardingAuthCommitSnapshot(), false);
  } finally {
    resetTransitions();
  }
});

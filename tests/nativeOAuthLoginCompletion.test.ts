import "./helpers/appModuleResolve.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const {
  clearNativeOAuthLoginCompletion,
  clearNativeOAuthPendingExchange,
  bindNativeOAuthLoginCompletion,
  readNativeOAuthLoginCompletion,
  readNativeOAuthLoginCompletionForSession,
  readNativeOAuthPendingExchange,
  stageNativeOAuthLoginCompletion,
  stageNativeOAuthPendingExchange,
} = await import("../src/transform/nativeOAuthLoginCompletion.ts");

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

test("네이티브 OAuth 완료 표식은 process 재시작 후 복원되고 채택 세션에만 bind된다", async () => {
  const previousWindow = globalThis.window;
  const sessionStorage = new MemoryStorage();
  const localStorage = new MemoryStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: { sessionStorage, localStorage },
  });

  try {
    const completion = stageNativeOAuthLoginCompletion({
      provider: "google",
      accountStatus: "created",
      expectedUserId: "parent-google",
      expectedAccessTokenJti: "oauth-jti-google",
      expectedLoginGenerationId: "login-generation-google",
      pairInvite: {
        code: "KID-QA1234",
        role: "parent",
        roleExplicit: true,
      },
    }, 1_000);
    assert.equal(completion.phase, "staged");
    assert.equal(completion.sessionInstanceId, null);
    assert.equal(completion.expectedLoginGenerationId, "login-generation-google");
    assert.deepEqual(readNativeOAuthLoginCompletion(1_001), completion);
    assert.ok(sessionStorage.values.size > 0);
    assert.deepEqual([...sessionStorage.values], [...localStorage.values]);
    const restartedModule = await import("../src/transform/nativeOAuthLoginCompletion.ts?process-restart=1");
    assert.deepEqual(
      restartedModule.readNativeOAuthLoginCompletion(1_001),
      completion,
      "새 모듈 인스턴스도 저장소에서 staged 완료를 복원해야 합니다",
    );

    assert.equal(
      readNativeOAuthLoginCompletionForSession(
        "different-user", "session-google", "oauth-jti-google", "login-generation-google", 1_001,
      ),
      null,
      "다른 계정 세션은 staged 완료를 소비하면 안 됩니다",
    );
    assert.equal(
      readNativeOAuthLoginCompletionForSession(
        "parent-google", "session-old", "old-session-jti", "old-login-generation", 1_001,
      ),
      null,
      "같은 사용자라도 OAuth 응답 세션이 아직 채택되지 않았으면 staged 완료를 소비하면 안 됩니다",
    );
    assert.deepEqual(
      readNativeOAuthLoginCompletionForSession(
        "parent-google", "session-google", "oauth-jti-google", "login-generation-google", 1_001,
      ),
      completion,
      "OAuth 응답의 jti가 현재 세션에 반영된 뒤에만 staged 완료를 복구해야 합니다",
    );
    const bound = bindNativeOAuthLoginCompletion(completion.id, "session-google", 1_002);
    assert.equal(bound?.phase, "session-bound");
    assert.equal(bound?.sessionInstanceId, "session-google");
    assert.deepEqual(
      readNativeOAuthLoginCompletionForSession(
        "parent-google", "session-google", "oauth-jti-google", "login-generation-google", 1_003,
      ),
      bound,
    );
    assert.deepEqual(
      readNativeOAuthLoginCompletionForSession(
        "parent-google", "session-google", "refreshed-access-jti", "login-generation-google", 1_003,
      ),
      bound,
      "정상 refresh로 access JTI가 바뀌어도 같은 로그인 세대의 continuation은 이어야 합니다",
    );
    assert.equal(
      readNativeOAuthLoginCompletionForSession(
        "parent-google", "session-google", "new-explicit-login-jti", "new-login-generation", 1_003,
      ),
      null,
      "같은 사용자·session identity여도 새 명시적 로그인 세대는 과거 완료를 소비하면 안 됩니다",
    );
  } finally {
    if (previousWindow === undefined) Reflect.deleteProperty(globalThis, "window");
    else Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: previousWindow });
  }
});

test("과거 완료 handler가 더 새로운 완료 표식을 지우지 못하고 만료 표식은 복원되지 않는다", () => {
  const previousWindow = globalThis.window;
  const sessionStorage = new MemoryStorage();
  const localStorage = new MemoryStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: { sessionStorage, localStorage },
  });

  try {
    const now = Date.now();
    const oldCompletion = stageNativeOAuthLoginCompletion({
      provider: "kakao",
      accountStatus: "existing",
      expectedUserId: "parent-a",
      expectedAccessTokenJti: "oauth-jti-a",
      expectedLoginGenerationId: "login-generation-a",
      pairInvite: null,
    }, now);
    const newCompletion = stageNativeOAuthLoginCompletion({
      provider: "google",
      accountStatus: "linked",
      expectedUserId: "parent-b",
      expectedAccessTokenJti: "oauth-jti-b",
      expectedLoginGenerationId: "login-generation-b",
      pairInvite: null,
    }, now + 100);
    clearNativeOAuthLoginCompletion(oldCompletion.id);
    assert.deepEqual(readNativeOAuthLoginCompletion(now + 101), newCompletion);

    assert.equal(readNativeOAuthLoginCompletion(newCompletion.expiresAtMs + 1), null);
    assert.equal(sessionStorage.values.size, 0);
    assert.equal(localStorage.values.size, 0);
  } finally {
    if (previousWindow === undefined) Reflect.deleteProperty(globalThis, "window");
    else Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: previousWindow });
  }
});

test("배포 전 완료 표식은 exact JTI 확인 뒤 stable 로그인 세대로 승격된다", async () => {
  const previousWindow = globalThis.window;
  const sessionStorage = new MemoryStorage();
  const localStorage = new MemoryStorage();
  localStorage.setItem("hyeni-native-oauth-login-completion-v1", JSON.stringify({
    version: 1,
    id: "legacy-completion-id",
    phase: "session-bound",
    provider: "google",
    accountStatus: "existing",
    expectedUserId: "legacy-parent",
    expectedAccessTokenJti: "legacy-oauth-jti",
    expectedLoginGenerationId: null,
    sessionInstanceId: "legacy-session",
    pairInvite: null,
    completedAtMs: 1_000,
    expiresAtMs: 2_000,
  }));
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: { sessionStorage, localStorage },
  });

  try {
    const legacyModule = await import("../src/transform/nativeOAuthLoginCompletion.ts?legacy-generation-upgrade=1");
    const upgraded = legacyModule.readNativeOAuthLoginCompletionForSession(
      "legacy-parent",
      "legacy-session",
      "legacy-oauth-jti",
      "stable-login-generation",
      3_000,
    );
    assert.equal(upgraded?.expectedLoginGenerationId, "stable-login-generation");
    assert.deepEqual(
      legacyModule.readNativeOAuthLoginCompletionForSession(
        "legacy-parent",
        "family-transition-session",
        "refreshed-access-jti",
        "stable-login-generation",
        4_000,
      ),
      upgraded,
      "한 번 안전하게 승격한 legacy continuation은 refresh·family 재발급 뒤에도 이어져야 합니다",
    );
  } finally {
    if (previousWindow === undefined) Reflect.deleteProperty(globalThis, "window");
    else Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: previousWindow });
  }
});

test("세션에 결합된 완료 표식은 오프라인 종료가 길어져도 성공 또는 명시 포기 전까지 유지된다", () => {
  const previousWindow = globalThis.window;
  const sessionStorage = new MemoryStorage();
  const localStorage = new MemoryStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: { sessionStorage, localStorage },
  });

  try {
    const completion = stageNativeOAuthLoginCompletion({
      provider: "kakao",
      accountStatus: "created",
      expectedUserId: "parent-offline",
      expectedAccessTokenJti: "oauth-jti-offline",
      expectedLoginGenerationId: "login-generation-offline",
      pairInvite: {
        code: "KID-OFFLINE1",
        role: "parent",
        roleExplicit: true,
      },
    }, 10_000);
    const bound = bindNativeOAuthLoginCompletion(completion.id, "session-offline", 10_001);
    const afterStagedTtl = completion.expiresAtMs + 24 * 60 * 60 * 1000;

    assert.deepEqual(
      readNativeOAuthLoginCompletionForSession(
        "parent-offline",
        "session-offline",
        "oauth-jti-offline",
        "login-generation-offline",
        afterStagedTtl,
      ),
      bound,
      "가족 조회 실패·오프라인 종료가 10분을 넘어도 초대와 후속 분기를 잃으면 안 됩니다",
    );
    assert.equal(
      readNativeOAuthLoginCompletionForSession(
        "parent-offline",
        "session-offline",
        "refreshed-access-jti",
        "login-generation-offline",
        afterStagedTtl,
      ),
      bound,
      "오래 보존된 표식도 정상 access refresh 뒤에는 이어져야 합니다",
    );
    assert.equal(
      readNativeOAuthLoginCompletionForSession(
        "parent-offline",
        "session-offline",
        "new-login-jti",
        "new-login-generation",
        afterStagedTtl,
      ),
      null,
      "오래 보존된 표식은 같은 사용자의 새 명시적 로그인에는 열리지 않아야 합니다",
    );
    clearNativeOAuthLoginCompletion(completion.id);
    assert.equal(readNativeOAuthLoginCompletion(afterStagedTtl), null);
  } finally {
    clearNativeOAuthLoginCompletion();
    if (previousWindow === undefined) Reflect.deleteProperty(globalThis, "window");
    else Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: previousWindow });
  }
});

test("완료 저장값에는 OAuth code·token·state·transaction secret이 들어가지 않는다", () => {
  const previousWindow = globalThis.window;
  const sessionStorage = new MemoryStorage();
  const localStorage = new MemoryStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: { sessionStorage, localStorage },
  });

  try {
    clearNativeOAuthLoginCompletion();
    stageNativeOAuthLoginCompletion({
      provider: "kakao",
      accountStatus: "existing",
      expectedUserId: "parent-safe",
      expectedAccessTokenJti: "oauth-jti-safe",
      expectedLoginGenerationId: "login-generation-safe",
      pairInvite: null,
    }, 5_000);
    const serialized = [...localStorage.values.values()][0] ?? "";
    assert.notEqual(serialized, "");
    assert.doesNotMatch(serialized, /access_token|refresh_token|transactionSecret|\"code\"|\"state\"/i);
  } finally {
    clearNativeOAuthLoginCompletion();
    if (previousWindow === undefined) Reflect.deleteProperty(globalThis, "window");
    else Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: previousWindow });
  }
});

test("네이티브 OAuth pending exchange는 process 재시작용 식별자만 짧게 보존한다", async () => {
  assert.equal(typeof stageNativeOAuthPendingExchange, "function");
  assert.equal(typeof readNativeOAuthPendingExchange, "function");
  assert.equal(typeof clearNativeOAuthPendingExchange, "function");

  const previousWindow = globalThis.window;
  const sessionStorage = new MemoryStorage();
  const localStorage = new MemoryStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: { sessionStorage, localStorage },
  });

  try {
    const now = Date.now();
    const pending = stageNativeOAuthPendingExchange("google", now);
    assert.match(pending.id, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(pending.provider, "google");
    assert.ok(pending.expiresAtMs > now);
    assert.deepEqual(readNativeOAuthPendingExchange(now + 1), pending);

    const restartedModule = await import("../src/transform/nativeOAuthLoginCompletion.ts?pending-process-restart=1");
    assert.deepEqual(restartedModule.readNativeOAuthPendingExchange(now + 1), pending);

    const serialized = [...localStorage.values.values()].find((value) => value.includes(pending.id)) ?? "";
    assert.notEqual(serialized, "");
    assert.doesNotMatch(serialized, /access_token|refresh_token|transactionSecret|"code"|"state"/i);
    assert.equal(
      [...sessionStorage.values.values()].some((value) => value.includes(pending.id)),
      false,
      "process recovery 식별자는 sessionStorage에 불필요하게 복제하지 않습니다",
    );

    clearNativeOAuthPendingExchange("different-id");
    assert.deepEqual(readNativeOAuthPendingExchange(now + 2), pending, "과거 handler가 새 pending을 지우면 안 됩니다");
    clearNativeOAuthPendingExchange(pending.id);
    assert.equal(readNativeOAuthPendingExchange(now + 3), null);
  } finally {
    clearNativeOAuthPendingExchange?.();
    if (previousWindow === undefined) Reflect.deleteProperty(globalThis, "window");
    else Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: previousWindow });
  }
});

test("만료된 pending exchange는 복원·재발급 시도에 사용되지 않는다", () => {
  assert.equal(typeof stageNativeOAuthPendingExchange, "function");
  const previousWindow = globalThis.window;
  const localStorage = new MemoryStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: { sessionStorage: new MemoryStorage(), localStorage },
  });

  try {
    const pending = stageNativeOAuthPendingExchange("kakao", 30_000);
    assert.equal(readNativeOAuthPendingExchange(pending.expiresAtMs + 1), null);
    assert.equal(localStorage.values.size, 0);
  } finally {
    clearNativeOAuthPendingExchange?.();
    if (previousWindow === undefined) Reflect.deleteProperty(globalThis, "window");
    else Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: previousWindow });
  }
});

test("조작된 장기 pending exchange는 서버 TTL 밖 복구 bearer로 사용되지 않는다", async () => {
  const previousWindow = globalThis.window;
  const localStorage = new MemoryStorage();
  const createdAtMs = Date.now();
  localStorage.setItem("hyeni-native-oauth-pending-exchange-v1", JSON.stringify({
    version: 1,
    id: "F".repeat(43),
    provider: "google",
    createdAtMs,
    expiresAtMs: createdAtMs + 60 * 60 * 1000,
  }));
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: { sessionStorage: new MemoryStorage(), localStorage },
  });
  try {
    const restartedModule = await import("../src/transform/nativeOAuthLoginCompletion.ts?forged-long-pending=1");
    assert.equal(restartedModule.readNativeOAuthPendingExchange(createdAtMs + 1), null);
    assert.equal(localStorage.getItem("hyeni-native-oauth-pending-exchange-v1"), null);
  } finally {
    clearNativeOAuthPendingExchange?.();
    if (previousWindow === undefined) Reflect.deleteProperty(globalThis, "window");
    else Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: previousWindow });
  }
});

test("pending recovery ID를 영속화할 수 없으면 code 소비 전에 fail-closed한다", () => {
  const previousWindow = globalThis.window;
  const blockedStorage = {
    getItem() { return null; },
    setItem() { throw new Error("blocked"); },
    removeItem() {},
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: { sessionStorage: new MemoryStorage(), localStorage: blockedStorage },
  });
  try {
    assert.throws(
      () => stageNativeOAuthPendingExchange("google"),
      /oauth_recovery_storage_unavailable/,
    );
    assert.equal(readNativeOAuthPendingExchange(), null);
  } finally {
    if (previousWindow === undefined) Reflect.deleteProperty(globalThis, "window");
    else Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: previousWindow });
  }
});

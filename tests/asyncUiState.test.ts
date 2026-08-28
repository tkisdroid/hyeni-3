import assert from "node:assert/strict";
import test from "node:test";

type ActionToken<Action extends string> = Readonly<{
  generation: number;
  action: Action;
}>;

type ActionController<Action extends string> = {
  begin: (action: Action) => ActionToken<Action>;
  isOwner: (token: ActionToken<Action>) => boolean;
  complete: (token: ActionToken<Action>) => boolean;
  current: () => ActionToken<Action> | null;
};

type AsyncUiStateModule = {
  OAUTH_CALLBACK_DELIVERY_GRACE_MS: number;
  createAsyncActionController: <Action extends string>() => ActionController<Action>;
  runOwnedAsyncAction: <Action extends string, Result>(input: {
    controller: ActionController<Action>;
    token: ActionToken<Action>;
    request: () => Promise<Result>;
    onSuccess: (result: Result) => void;
    onError: (error: unknown) => void;
    onFinally: () => void;
  }) => Promise<void>;
  shouldReleaseOAuthBusyOnResume: (input: {
    documentVisible: boolean;
    oauthExternalPending: boolean;
    oauthContextPending: boolean;
  }) => boolean;
};

async function loadModule(): Promise<AsyncUiStateModule> {
  const module = await import("../src/transform/asyncUiState.ts");
  assert.equal(typeof module.createAsyncActionController, "function");
  assert.equal(typeof module.runOwnedAsyncAction, "function");
  assert.equal(typeof module.shouldReleaseOAuthBusyOnResume, "function");
  assert.ok(module.OAUTH_CALLBACK_DELIVERY_GRACE_MS > 15_000);
  return module as unknown as AsyncUiStateModule;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("같은 이름의 가입 요청도 고유 generation token으로 구분한다", async () => {
  const { createAsyncActionController } = await loadModule();
  const controller = createAsyncActionController<"request-code">();
  const tokenA = controller.begin("request-code");
  const tokenB = controller.begin("request-code");

  assert.notEqual(tokenA, tokenB);
  assert.notEqual(tokenA.generation, tokenB.generation);
  assert.equal(controller.isOwner(tokenA), false);
  assert.equal(controller.isOwner(tokenB), true);
});

test("같은 request-code A/B가 역전돼도 늦은 A의 성공·finally는 UI를 바꾸지 않는다", async () => {
  const { createAsyncActionController, runOwnedAsyncAction } = await loadModule();
  const controller = createAsyncActionController<"request-code">();
  const pendingA = deferred<string>();
  const pendingB = deferred<string>();
  const effects: string[] = [];

  const tokenA = controller.begin("request-code");
  const runA = runOwnedAsyncAction({
    controller,
    token: tokenA,
    request: () => pendingA.promise,
    onSuccess: (value) => effects.push(`A:success:${value}`),
    onError: () => effects.push("A:error"),
    onFinally: () => effects.push("A:finally"),
  });
  const tokenB = controller.begin("request-code");
  const runB = runOwnedAsyncAction({
    controller,
    token: tokenB,
    request: () => pendingB.promise,
    onSuccess: (value) => effects.push(`B:success:${value}`),
    onError: () => effects.push("B:error"),
    onFinally: () => effects.push("B:finally"),
  });

  pendingA.resolve("old");
  await runA;
  assert.deepEqual(effects, []);
  assert.equal(controller.isOwner(tokenB), true);

  pendingB.resolve("current");
  await runB;
  assert.deepEqual(effects, ["B:success:current", "B:finally"]);
  assert.equal(controller.current(), null);
});

test("같은 request-code A/B의 늦은 A 오류도 toast·busy를 바꾸지 않는다", async () => {
  const { createAsyncActionController, runOwnedAsyncAction } = await loadModule();
  const controller = createAsyncActionController<"request-code">();
  const pendingA = deferred<string>();
  const pendingB = deferred<string>();
  const effects: string[] = [];

  const tokenA = controller.begin("request-code");
  const runA = runOwnedAsyncAction({
    controller,
    token: tokenA,
    request: () => pendingA.promise,
    onSuccess: () => effects.push("A:success"),
    onError: () => effects.push("A:error"),
    onFinally: () => effects.push("A:finally"),
  });
  const tokenB = controller.begin("request-code");
  const runB = runOwnedAsyncAction({
    controller,
    token: tokenB,
    request: () => pendingB.promise,
    onSuccess: () => effects.push("B:success"),
    onError: () => effects.push("B:error"),
    onFinally: () => effects.push("B:finally"),
  });

  pendingA.reject(new Error("old failure"));
  await runA;
  assert.deepEqual(effects, []);
  assert.equal(controller.isOwner(tokenB), true);

  pendingB.reject(new Error("current failure"));
  await runB;
  assert.deepEqual(effects, ["B:error", "B:finally"]);
});

test("같은 verify A/B 역전에서는 stale 세션 0회, current 세션 1회만 채택한다", async () => {
  const { createAsyncActionController, runOwnedAsyncAction } = await loadModule();
  const controller = createAsyncActionController<"verify">();
  const pendingA = deferred<string>();
  const pendingB = deferred<string>();
  const adopted: string[] = [];
  const effects: string[] = [];

  const tokenA = controller.begin("verify");
  const runA = runOwnedAsyncAction({
    controller,
    token: tokenA,
    request: () => pendingA.promise,
    onSuccess: (session) => {
      adopted.push(session);
      effects.push("A:success");
    },
    onError: () => effects.push("A:error"),
    onFinally: () => effects.push("A:finally"),
  });
  const tokenB = controller.begin("verify");
  const runB = runOwnedAsyncAction({
    controller,
    token: tokenB,
    request: () => pendingB.promise,
    onSuccess: (session) => {
      adopted.push(session);
      effects.push("B:success");
    },
    onError: () => effects.push("B:error"),
    onFinally: () => effects.push("B:finally"),
  });

  pendingA.resolve("stale-session");
  await runA;
  assert.deepEqual(adopted, []);
  assert.deepEqual(effects, []);
  assert.equal(controller.isOwner(tokenB), true);

  pendingB.resolve("current-session");
  await runB;
  assert.deepEqual(adopted, ["current-session"]);
  assert.deepEqual(effects, ["B:success", "B:finally"]);
});

test("visibility와 pageshow 복귀는 OAuth 외부 브라우저 busy만 해제한다", async () => {
  const { shouldReleaseOAuthBusyOnResume } = await loadModule();

  assert.equal(
    shouldReleaseOAuthBusyOnResume({
      documentVisible: true,
      oauthExternalPending: true,
      oauthContextPending: true,
    }),
    true,
  );
  assert.equal(
    shouldReleaseOAuthBusyOnResume({
      documentVisible: true,
      oauthExternalPending: false,
      oauthContextPending: true,
    }),
    false,
    "가입·ID API busy는 유지해야 합니다",
  );
  assert.equal(
    shouldReleaseOAuthBusyOnResume({
      documentVisible: false,
      oauthExternalPending: true,
      oauthContextPending: true,
    }),
    false,
  );
  assert.equal(
    shouldReleaseOAuthBusyOnResume({
      documentVisible: true,
      oauthExternalPending: true,
      oauthContextPending: false,
    }),
    false,
    "딥링크가 context를 소비해 교환 중이면 다른 연결·로그인 동작을 열면 안 됩니다",
  );
});

test("operation deadline은 끝나지 않는 작업을 중단하고 cleanup을 정확히 한 번 실행한다", async () => {
  const { withOperationDeadline } = await loadModule();
  assert.equal(typeof withOperationDeadline, "function");
  let timeoutCount = 0;
  const never = new Promise<never>(() => {});

  await assert.rejects(
    withOperationDeadline(never, {
      timeoutMs: 5,
      errorCode: "oauth_exchange_timeout",
      onTimeout: () => { timeoutCount += 1; },
    }),
    (error: unknown) => (
      error instanceof Error
      && error.name === "OperationTimeoutError"
      && error.message === "oauth_exchange_timeout"
    ),
  );
  assert.equal(timeoutCount, 1);
});

test("operation deadline은 먼저 완료된 정상 결과를 바꾸지 않고 timeout side effect를 취소한다", async () => {
  const { withOperationDeadline } = await loadModule();
  assert.equal(typeof withOperationDeadline, "function");
  let timeoutCount = 0;

  assert.equal(
    await withOperationDeadline(Promise.resolve("ok"), {
      timeoutMs: 20,
      errorCode: "should_not_fire",
      onTimeout: () => { timeoutCount += 1; },
    }),
    "ok",
  );
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(timeoutCount, 0);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  activatePwaUpdateAndWaitForControllerChange,
  beginPwaCriticalSection,
  observePwaControllerChanges,
  pwaUpdateCoordinatorState,
  queuePwaUpdateAction,
  resetPwaUpdateCoordinatorForTest,
  retryPendingPwaUpdate,
} from "../src/lib/pwaUpdateCoordinator.ts";

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function createControllerTarget(initialController: object | null) {
  const listeners = new Set<EventListener>();
  const target = {
    controller: initialController,
    addEventListener(type: "controllerchange", listener: EventListener) {
      if (type === "controllerchange") listeners.add(listener);
    },
    removeEventListener(type: "controllerchange", listener: EventListener) {
      if (type === "controllerchange") listeners.delete(listener);
    },
    changeController(controller: object | null) {
      target.controller = controller;
      target.dispatchControllerChange();
    },
    dispatchControllerChange() {
      for (const listener of listeners) listener(new Event("controllerchange"));
    },
    listenerCount() {
      return listeners.size;
    },
  };
  return target;
}

test.beforeEach(() => {
  resetPwaUpdateCoordinatorForTest();
});

test.afterEach(() => {
  resetPwaUpdateCoordinatorForTest();
});

test("중요 작업 중에는 PWA 업데이트를 실행하지 않고 마지막 보호가 끝난 뒤 실행한다", async () => {
  const calls: string[] = [];
  const releaseFirst = beginPwaCriticalSection();
  const releaseSecond = beginPwaCriticalSection();

  queuePwaUpdateAction("activate", () => {
    calls.push("activate");
  });
  await settle();
  assert.deepEqual(calls, []);
  assert.equal(pwaUpdateCoordinatorState().criticalSectionCount, 2);

  releaseFirst();
  await settle();
  assert.deepEqual(calls, []);

  releaseSecond();
  await settle();
  assert.deepEqual(calls, ["activate"]);
  assert.deepEqual(pwaUpdateCoordinatorState().pendingActionKeys, []);
});

test("같은 종류의 대기 작업은 최신 함수 하나만 실행하고 release는 멱등이다", async () => {
  const calls: string[] = [];
  const release = beginPwaCriticalSection();
  queuePwaUpdateAction("reload", () => calls.push("old"));
  queuePwaUpdateAction("reload", () => calls.push("latest"));

  release();
  release();
  await settle();

  assert.deepEqual(calls, ["latest"]);
  assert.equal(pwaUpdateCoordinatorState().criticalSectionCount, 0);
});

test("업데이트 적용 실패는 앱 오류로 전파하지 않고 다음 명시적 재시도에서 복구한다", async () => {
  let attempts = 0;
  queuePwaUpdateAction("activate", () => {
    attempts += 1;
    if (attempts === 1) throw new Error("temporary update failure");
  });
  await settle();

  assert.equal(attempts, 1);
  assert.deepEqual(pwaUpdateCoordinatorState().pendingActionKeys, ["activate"]);

  retryPendingPwaUpdate();
  await settle();
  assert.equal(attempts, 2);
  assert.deepEqual(pwaUpdateCoordinatorState().pendingActionKeys, []);
});

test("실행 중인 작업이 실패해도 그 사이 들어온 같은 key의 최신 작업을 덮어쓰지 않는다", async () => {
  const calls: string[] = [];
  let rejectFirst: ((reason?: unknown) => void) | null = null;
  queuePwaUpdateAction("activate", () => new Promise<void>((_resolve, reject) => {
    calls.push("first");
    rejectFirst = reject;
  }));
  await settle();

  queuePwaUpdateAction("activate", () => {
    calls.push("latest");
  });
  rejectFirst?.(new Error("first failed"));
  await settle();

  assert.deepEqual(calls, ["first"]);
  retryPendingPwaUpdate();
  await settle();
  assert.deepEqual(calls, ["first", "latest"]);
});

test("실행 중인 작업이 성공하면 그 사이 들어온 같은 key를 중복 실행하지 않는다", async () => {
  const calls: string[] = [];
  let resolveFirst: (() => void) | null = null;
  queuePwaUpdateAction("reload", () => new Promise<void>((resolve) => {
    calls.push("first");
    resolveFirst = resolve;
  }));
  await settle();

  queuePwaUpdateAction("reload", () => {
    calls.push("duplicate");
  });
  resolveFirst?.();
  await settle();

  assert.deepEqual(calls, ["first"]);
  assert.deepEqual(pwaUpdateCoordinatorState().pendingActionKeys, []);
});

test("같은 실행 턴에서 시작된 중요 작업은 아직 시작하지 않은 업데이트를 먼저 막는다", async () => {
  const calls: string[] = [];
  queuePwaUpdateAction("activate", () => {
    calls.push("activate");
  });
  const release = beginPwaCriticalSection();
  await settle();

  assert.deepEqual(calls, []);
  release();
  await settle();
  assert.deepEqual(calls, ["activate"]);
});

test("이미 제어 중인 다른 탭의 controllerchange는 reload를 요청하고 최초 제어 획득은 무시한다", () => {
  const initiallyUncontrolled = createControllerTarget(null);
  let firstInstallReloads = 0;
  const stopFirstInstallObserver = observePwaControllerChanges(
    initiallyUncontrolled,
    () => { firstInstallReloads += 1; },
  );
  initiallyUncontrolled.changeController({ version: "first" });
  assert.equal(firstInstallReloads, 0);
  initiallyUncontrolled.changeController({ version: "update" });
  assert.equal(firstInstallReloads, 1);
  stopFirstInstallObserver();
  assert.equal(initiallyUncontrolled.listenerCount(), 0);

  const controlledTab = createControllerTarget({ version: "old" });
  let updateReloads = 0;
  const stopControlledObserver = observePwaControllerChanges(
    controlledTab,
    () => { updateReloads += 1; },
  );
  controlledTab.changeController({ version: "new" });
  assert.equal(updateReloads, 1);
  stopControlledObserver();
});

test("Worker 활성화는 실제 controllerchange를 확인한 뒤에만 성공한다", async () => {
  const target = createControllerTarget({ version: "old" });
  let activationCalls = 0;
  const activation = activatePwaUpdateAndWaitForControllerChange(
    target,
    () => { activationCalls += 1; },
    100,
  );

  assert.equal(activationCalls, 1);
  assert.equal(target.listenerCount(), 1);
  target.changeController({ version: "new" });
  await activation;
  assert.equal(target.listenerCount(), 0);
});

test("다른 탭이 controller를 먼저 바꾼 뒤 전달된 controllerchange도 활성화 완료로 인정한다", async () => {
  const target = createControllerTarget({ version: "old" });
  target.controller = { version: "new" };
  const activation = activatePwaUpdateAndWaitForControllerChange(
    target,
    () => undefined,
    100,
  );

  target.dispatchControllerChange();
  await activation;
  assert.equal(target.listenerCount(), 0);
});

test("Worker 활성화 신호 뒤 controllerchange가 없으면 실패로 닫고 listener를 정리한다", async () => {
  const target = createControllerTarget({ version: "old" });
  await assert.rejects(
    activatePwaUpdateAndWaitForControllerChange(target, () => undefined, 5),
    /controllerchange/,
  );
  assert.equal(target.listenerCount(), 0);
});

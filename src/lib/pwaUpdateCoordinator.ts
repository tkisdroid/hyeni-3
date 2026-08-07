export type PwaUpdateAction = () => void | Promise<void>;

export interface PwaControllerChangeTarget {
  readonly controller: object | null;
  addEventListener(type: "controllerchange", listener: EventListener): void;
  removeEventListener(type: "controllerchange", listener: EventListener): void;
}

export const PWA_CONTROLLER_CHANGE_TIMEOUT_MS = 15_000;

const pendingActions = new Map<string, PwaUpdateAction>();
let criticalSectionCount = 0;
let draining = false;
let drainScheduled = false;
let coordinatorGeneration = 0;

function schedulePendingActionDrain(): void {
  if (drainScheduled) return;
  drainScheduled = true;
  const generation = coordinatorGeneration;
  queueMicrotask(() => {
    if (generation !== coordinatorGeneration) return;
    drainScheduled = false;
    void drainPendingActions();
  });
}

async function drainPendingActions(): Promise<void> {
  if (draining || criticalSectionCount > 0 || pendingActions.size === 0) return;

  const next = pendingActions.entries().next().value as
    | [string, PwaUpdateAction]
    | undefined;
  if (!next) return;

  const [key, action] = next;
  pendingActions.delete(key);
  draining = true;
  const generation = coordinatorGeneration;
  let succeeded = false;
  try {
    await action();
    succeeded = true;
  } catch {
    // 업데이트 실패가 앱 기능을 막지 않도록 조용히 보류하고,
    // online/visibilitychange 또는 다음 요청 때 같은 작업을 재시도한다.
    if (generation === coordinatorGeneration && !pendingActions.has(key)) {
      pendingActions.set(key, action);
    }
  } finally {
    if (generation === coordinatorGeneration) draining = false;
  }

  if (generation !== coordinatorGeneration) return;
  // 실행 중 같은 신호가 다시 들어왔더라도 성공한 활성화·reload는 한 번만 수행한다.
  if (succeeded) pendingActions.delete(key);
  if (succeeded && criticalSectionCount === 0 && pendingActions.size > 0) {
    schedulePendingActionDrain();
  }
}

/** 같은 key의 Service Worker 작업은 하나만 보류해 중복 reload를 막는다. */
export function queuePwaUpdateAction(key: string, action: PwaUpdateAction): void {
  if (!key.trim()) return;
  pendingActions.set(key, action);
  schedulePendingActionDrain();
}

/** 결제·원격청취·미저장 편집처럼 reload하면 안 되는 구간을 보호한다. */
export function beginPwaCriticalSection(): () => void {
  criticalSectionCount += 1;
  const generation = coordinatorGeneration;
  let released = false;
  return () => {
    if (released || generation !== coordinatorGeneration) return;
    released = true;
    criticalSectionCount = Math.max(0, criticalSectionCount - 1);
    if (criticalSectionCount === 0) schedulePendingActionDrain();
  };
}

export function retryPendingPwaUpdate(): void {
  schedulePendingActionDrain();
}

/** 다른 탭이 새 Worker를 활성화한 경우에도 현재 탭의 reload를 놓치지 않는다. */
export function observePwaControllerChanges(
  target: PwaControllerChangeTarget,
  onUpdate: () => void,
): () => void {
  let lastController = target.controller;
  let hasControlledDocument = lastController !== null;
  const handleControllerChange: EventListener = () => {
    const nextController = target.controller;
    const isUpdate = hasControlledDocument && nextController !== lastController;
    if (nextController !== null) hasControlledDocument = true;
    lastController = nextController;
    if (isUpdate) onUpdate();
  };
  target.addEventListener("controllerchange", handleControllerChange);
  return () => target.removeEventListener("controllerchange", handleControllerChange);
}

/** SKIP_WAITING 전송 완료가 아니라 실제 controller 교체까지 확인한다. */
export function activatePwaUpdateAndWaitForControllerChange(
  target: PwaControllerChangeTarget,
  activate: PwaUpdateAction,
  timeoutMs = PWA_CONTROLLER_CHANGE_TIMEOUT_MS,
): Promise<void> {
  const effectiveTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : PWA_CONTROLLER_CHANGE_TIMEOUT_MS;

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const cleanup = () => {
      target.removeEventListener("controllerchange", handleControllerChange);
      if (timeout !== null) clearTimeout(timeout);
    };
    const succeed = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    // controllerchange는 controller 속성 갱신 뒤 전달된다. 다른 탭이 먼저
    // 활성화해 이벤트만 대기 중인 경쟁에서도 객체 비교 없이 이 신호를 인정한다.
    const handleControllerChange: EventListener = succeed;

    target.addEventListener("controllerchange", handleControllerChange);
    timeout = setTimeout(
      () => fail(new Error("PWA controllerchange 시간 초과")),
      effectiveTimeoutMs,
    );
    try {
      const activationResult = activate();
      void Promise.resolve(activationResult).catch(fail);
    } catch (error) {
      fail(error);
    }
  });
}

export function pwaUpdateCoordinatorState(): Readonly<{
  criticalSectionCount: number;
  pendingActionKeys: string[];
  draining: boolean;
}> {
  return {
    criticalSectionCount,
    pendingActionKeys: Array.from(pendingActions.keys()),
    draining,
  };
}

/** Node 단위 테스트 전용. 앱 코드에서는 호출하지 않는다. */
export function resetPwaUpdateCoordinatorForTest(): void {
  coordinatorGeneration += 1;
  pendingActions.clear();
  criticalSectionCount = 0;
  draining = false;
  drainScheduled = false;
}

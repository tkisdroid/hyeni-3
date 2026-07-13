interface RegistrationEntry {
  controller: AbortController;
  released: Promise<void>;
  resolveReleased: () => void;
}

interface CleanupEntry {
  controller: AbortController;
  finished: Promise<void>;
  resolveFinished: () => void;
}

export interface PushRegistrationPermit {
  signal: AbortSignal;
  release: () => void;
}

export interface PushSessionCleanup {
  signal: AbortSignal;
  waitForRegistrations: () => Promise<void>;
  abort: () => void;
  finish: () => void;
}

const registrations = new Set<RegistrationEntry>();
const cleanups = new Set<CleanupEntry>();

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** 로그아웃 정리가 모두 끝난 뒤에만 새 push 등록을 시작할 수 있는 허가를 발급한다. */
export async function acquirePushRegistrationPermit(): Promise<PushRegistrationPermit> {
  for (;;) {
    const pendingCleanups = [...cleanups].map((entry) => entry.finished);
    if (pendingCleanups.length > 0) {
      await Promise.all(pendingCleanups);
      continue;
    }

    const controller = new AbortController();
    const released = deferred();
    const entry: RegistrationEntry = {
      controller,
      released: released.promise,
      resolveReleased: released.resolve,
    };
    registrations.add(entry);

    // 확인과 등록 사이에 정리가 시작된 경우 이 허가는 사용하지 않고 다시 기다린다.
    if (cleanups.size > 0) {
      registrations.delete(entry);
      controller.abort();
      released.resolve();
      continue;
    }

    let active = true;
    return {
      signal: controller.signal,
      release: () => {
        if (!active) return;
        active = false;
        registrations.delete(entry);
        released.resolve();
      },
    };
  }
}

/** 진행 중 등록을 취소하고, 해당 등록이 멈춘 뒤 정리하도록 세션 전환 장벽을 연다. */
export function beginPushSessionCleanup(): PushSessionCleanup {
  const controller = new AbortController();
  const finished = deferred();
  const entry: CleanupEntry = {
    controller,
    finished: finished.promise,
    resolveFinished: finished.resolve,
  };
  cleanups.add(entry);

  const registrationsAtStart = [...registrations];
  for (const registration of registrationsAtStart) {
    registration.controller.abort();
  }

  let active = true;
  return {
    signal: controller.signal,
    waitForRegistrations: () => Promise.all(
      registrationsAtStart.map((registration) => registration.released),
    ).then(() => undefined),
    abort: () => controller.abort(),
    finish: () => {
      if (!active) return;
      active = false;
      cleanups.delete(entry);
      finished.resolve();
    },
  };
}

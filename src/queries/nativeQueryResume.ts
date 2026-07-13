interface NativeQueryResumeCoordinatorOptions {
  resume: () => Promise<void>;
  onError: (error: unknown) => void;
}

export interface NativeQueryResumeCoordinator {
  initialize: (isActive: boolean) => void;
  handleAppState: (isActive: boolean) => void;
  dispose: () => void;
}

export interface NativeQueryResumeDependencies {
  adoptSession: () => Promise<boolean>;
  syncSession: () => void;
  waitForAuthRender: () => Promise<void>;
  isDisposed: () => boolean;
  refetchActiveQueries: () => Promise<void>;
}

/** 네이티브는 Capacitor appStateChange가 조회를 담당하므로 웹 포커스 갱신을 겹치지 않는다. */
export function shouldRefetchOnWindowFocus(isNative: boolean): boolean {
  return !isNative;
}

export function createNativeQueryResumeCoordinator(
  { resume, onError }: NativeQueryResumeCoordinatorOptions,
): NativeQueryResumeCoordinator {
  let initialized = false;
  let lastIsActive = false;
  let running = false;
  let queued = false;
  let disposed = false;

  const startResume = () => {
    if (disposed) return;
    if (running) {
      queued = true;
      return;
    }
    running = true;
    void Promise.resolve()
      .then(resume)
      .catch((error: unknown) => {
        if (!disposed) onError(error);
      })
      .finally(() => {
        running = false;
        if (disposed) {
          queued = false;
          return;
        }
        if (!queued) return;
        queued = false;
        startResume();
      });
  };

  return {
    initialize(isActive) {
      if (disposed || initialized) return;
      initialized = true;
      lastIsActive = isActive;
    },
    handleAppState(isActive) {
      if (disposed) return;
      if (!initialized) {
        initialized = true;
        lastIsActive = isActive;
        return;
      }
      const shouldResume = !lastIsActive && isActive;
      lastIsActive = isActive;
      if (shouldResume) startResume();
    },
    dispose() {
      disposed = true;
      queued = false;
    },
  };
}

export async function resumeActiveQueriesAfterNativeForeground(
  dependencies: NativeQueryResumeDependencies,
): Promise<void> {
  const adopted = await dependencies.adoptSession();
  if (dependencies.isDisposed()) return;

  if (adopted) {
    dependencies.syncSession();
    await dependencies.waitForAuthRender();
  }
  if (dependencies.isDisposed()) return;

  await dependencies.refetchActiveQueries();
}

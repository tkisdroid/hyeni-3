import { catalogLoaders } from "./generated/catalogLoaders.ts";
import type {
  CatalogMessages,
  MessageNamespace,
} from "./generated/messageIds";
import { localeFallbackChain, type SupportedLocale } from "./locale.ts";
import type { LocaleStoragePort } from "./localeStorage.ts";

export interface LoadedNamespace {
  namespace: MessageNamespace;
  resolvedLocale: SupportedLocale;
  messages: CatalogMessages;
}

export type NamespaceLoader = (
  locale: SupportedLocale,
  namespace: MessageNamespace,
) => Promise<CatalogMessages>;

export type LocaleRuntimeLoader = (
  locale: SupportedLocale,
  namespace: MessageNamespace,
) => Promise<LoadedNamespace>;

export interface LocaleRuntimeSnapshot {
  locale: SupportedLocale;
  messages: CatalogMessages;
  readyNamespaces: ReadonlySet<MessageNamespace>;
  loading: boolean;
  error: boolean;
}

export interface LocaleDocumentPort {
  update(locale: SupportedLocale, coreMessages: CatalogMessages): void;
}

export interface NamespaceLease {
  ready: Promise<void>;
  release(): void;
}

export interface LocaleRuntimeCoordinator {
  getSnapshot(): LocaleRuntimeSnapshot;
  subscribe(listener: (snapshot: LocaleRuntimeSnapshot) => void): () => void;
  setLocale(locale: SupportedLocale): Promise<void>;
  ensureNamespaces(namespaces: readonly MessageNamespace[]): Promise<void>;
  acquireNamespaceLease(namespaces: readonly MessageNamespace[]): NamespaceLease;
  retry(): Promise<void>;
}

async function loadGeneratedNamespace(
  locale: SupportedLocale,
  namespace: MessageNamespace,
): Promise<CatalogMessages> {
  const module = await catalogLoaders[locale][namespace]();
  return module.default;
}

export async function loadNamespaceAtomically(args: {
  locale: SupportedLocale;
  namespace: MessageNamespace;
  load?: NamespaceLoader;
}): Promise<LoadedNamespace> {
  const load = args.load ?? loadGeneratedNamespace;
  let lastError: unknown;

  for (const candidate of localeFallbackChain(args.locale)) {
    try {
      const messages = await load(candidate, args.namespace);
      return {
        namespace: args.namespace,
        resolvedLocale: candidate,
        messages,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`${args.locale}/${args.namespace} 카탈로그를 불러오지 못했습니다.`);
}

export function createLocaleRuntimeCoordinator(args: {
  initialLocale: SupportedLocale;
  load: LocaleRuntimeLoader;
  storage: LocaleStoragePort;
  document: LocaleDocumentPort;
}): LocaleRuntimeCoordinator {
  let requestedLocale = args.initialLocale;
  let snapshot: LocaleRuntimeSnapshot = {
    locale: args.initialLocale,
    messages: {},
    readyNamespaces: new Set(),
    loading: false,
    error: false,
  };
  const listeners = new Set<(next: LocaleRuntimeSnapshot) => void>();
  interface NamespaceLeaseToken {
    namespaces: ReadonlySet<MessageNamespace>;
    released: boolean;
  }
  const waiters = new Set<{
    namespaces: ReadonlySet<MessageNamespace>;
    owner: NamespaceLeaseToken | null;
    resolve(): void;
    reject(error: unknown): void;
  }>();
  const leaseCounts = new Map<MessageNamespace, number>();
  const namespaceJobs = new Map<MessageNamespace, {
    generation: number;
    locale: SupportedLocale;
  }>();
  let generation = 0;
  let activeTransition: {
    generation: number;
    locale: SupportedLocale;
    commitExternal: boolean;
    cancelLoads: Map<MessageNamespace, () => void>;
    promise: Promise<void>;
  } | null = null;
  const transitionLoadCancelled = Symbol("transitionLoadCancelled");

  const activeNamespaces = (): ReadonlySet<MessageNamespace> => new Set([
    "core",
    ...[...leaseCounts]
      .filter(([, count]) => count > 0)
      .map(([namespace]) => namespace),
  ]);

  const hasActiveWork = () => activeTransition !== null || namespaceJobs.size > 0;

  const emit = (next: LocaleRuntimeSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener(next);
  };

  const resolveReadyWaiters = () => {
    if (activeTransition !== null && activeTransition.locale !== snapshot.locale) return;
    for (const waiter of waiters) {
      if ([...waiter.namespaces].every((namespace) => snapshot.readyNamespaces.has(namespace))) {
        waiters.delete(waiter);
        waiter.resolve();
      }
    }
  };

  let cancelUnusedNamespaces: (namespaces: Iterable<MessageNamespace>) => void =
    () => undefined;

  const rejectWaitersFor = (namespace: MessageNamespace, error: unknown) => {
    const affectedNamespaces = new Set<MessageNamespace>();
    for (const waiter of waiters) {
      if (waiter.namespaces.has(namespace)) {
        waiters.delete(waiter);
        for (const affectedNamespace of waiter.namespaces) {
          affectedNamespaces.add(affectedNamespace);
        }
        waiter.reject(error);
      }
    }
    cancelUnusedNamespaces(affectedNamespaces);
  };

  const commitExternalState = (
    locale: SupportedLocale,
    messages: CatalogMessages,
  ) => {
    try {
      args.storage.write(locale);
    } catch {
      // 저장 실패가 현재 탭의 언어 전환을 실패시키지 않는다.
    }
    try {
      args.document.update(locale, messages);
    } catch {
      // document 갱신 실패가 locale/messages 원자 커밋을 막지 않는다.
    }
  };

  let schedulePendingWaiters: () => void = () => undefined;

  const namespaceIsDemanded = (namespace: MessageNamespace) =>
    activeNamespaces().has(namespace)
    || [...waiters].some((waiter) => waiter.namespaces.has(namespace));

  cancelUnusedNamespaces = (namespaces) => {
    for (const namespace of namespaces) {
      if (namespaceIsDemanded(namespace)) continue;
      namespaceJobs.delete(namespace);
      activeTransition?.cancelLoads.get(namespace)?.();
    }
    const loading = hasActiveWork();
    if (snapshot.loading !== loading) {
      emit({ ...snapshot, loading });
    }
  };

  const startNamespaceJob = (namespace: MessageNamespace) => {
    if (snapshot.readyNamespaces.has(namespace)) return;
    const locale = snapshot.locale;
    const job = { generation, locale };
    const current = namespaceJobs.get(namespace);
    if (current?.generation === generation && current.locale === locale) return;

    namespaceJobs.set(namespace, job);
    emit({ ...snapshot, loading: true });
    void (async () => {
      try {
        const result = await args.load(locale, namespace);
        if (
          job.generation !== generation
          || activeTransition !== null
          || snapshot.locale !== locale
          || namespaceJobs.get(namespace) !== job
        ) {
          return;
        }
        namespaceJobs.delete(namespace);
        const nextReady = new Set([...snapshot.readyNamespaces, result.namespace]);
        const allActiveReady = [...activeNamespaces()]
          .every((activeNamespace) => nextReady.has(activeNamespace));
        emit({
          ...snapshot,
          messages: { ...snapshot.messages, ...result.messages },
          readyNamespaces: nextReady,
          loading: hasActiveWork(),
          error: allActiveReady ? false : snapshot.error,
        });
        resolveReadyWaiters();
      } catch (error) {
        if (
          job.generation !== generation
          || activeTransition !== null
          || snapshot.locale !== locale
          || namespaceJobs.get(namespace) !== job
        ) {
          return;
        }
        namespaceJobs.delete(namespace);
        rejectWaitersFor(namespace, error);
        emit({
          ...snapshot,
          loading: hasActiveWork(),
          error: activeNamespaces().has(namespace) ? true : snapshot.error,
        });
      } finally {
        if (namespaceJobs.get(namespace) === job) {
          namespaceJobs.delete(namespace);
          if (!hasActiveWork() && snapshot.loading) {
            emit({ ...snapshot, loading: false });
          }
        }
        schedulePendingWaiters();
      }
    })();
  };

  schedulePendingWaiters = () => {
    resolveReadyWaiters();
    if (activeTransition !== null) return;
    for (const waiter of waiters) {
      for (const namespace of waiter.namespaces) {
        startNamespaceJob(namespace);
      }
    }
  };

  const startTransition = (
    locale: SupportedLocale,
    commitExternal: boolean,
  ): Promise<void> => {
    for (const cancel of activeTransition?.cancelLoads.values() ?? []) cancel();
    generation += 1;
    namespaceJobs.clear();
    const transition = {
      generation,
      locale,
      commitExternal,
      cancelLoads: new Map<MessageNamespace, () => void>(),
      promise: Promise.resolve(),
    };
    activeTransition = transition;
    emit({ ...snapshot, loading: true, error: false });

    const run = async () => {
      try {
        const canReuseCommitted = snapshot.locale === locale
          && snapshot.readyNamespaces.has("core");
        const nextMessages: Record<string, string> = canReuseCommitted
          ? { ...snapshot.messages }
          : {};
        const nextReady = canReuseCommitted
          ? new Set(snapshot.readyNamespaces)
          : new Set<MessageNamespace>();

        while (transition.generation === generation) {
          const required = activeNamespaces();
          const missing = [...required]
            .filter((namespace) => !nextReady.has(namespace));
          if (missing.length === 0) break;

          const loaded = await Promise.allSettled(missing.map((namespace) => {
            let cancel: () => void = () => undefined;
            const cancelled = new Promise<typeof transitionLoadCancelled>((resolve) => {
              cancel = () => resolve(transitionLoadCancelled);
            });
            transition.cancelLoads.set(namespace, cancel);
            return Promise.race([args.load(locale, namespace), cancelled]).finally(() => {
              if (transition.cancelLoads.get(namespace) === cancel) {
                transition.cancelLoads.delete(namespace);
              }
            });
          }));
          if (transition.generation !== generation) return;
          const stillRequired = activeNamespaces();
          const failures: unknown[] = [];
          for (const [index, result] of loaded.entries()) {
            const namespace = missing[index];
            if (!namespace) continue;
            if (result.status === "rejected") {
              if (namespaceIsDemanded(namespace)) {
                rejectWaitersFor(namespace, result.reason);
              }
              if (stillRequired.has(namespace)) {
                failures.push(result.reason);
              }
              continue;
            }
            if (result.value === transitionLoadCancelled) continue;
            Object.assign(nextMessages, result.value.messages);
            nextReady.add(result.value.namespace);
          }
          if (failures.length > 0) throw failures[0];
        }

        if (transition.generation !== generation) return;
        if (transition.commitExternal) {
          commitExternalState(locale, nextMessages);
        }
        emit({
          locale,
          messages: nextMessages,
          readyNamespaces: nextReady,
          loading: false,
          error: false,
        });
        resolveReadyWaiters();
      } catch (error) {
        if (transition.generation === generation) {
          emit({ ...snapshot, loading: false, error: true });
          resolveReadyWaiters();
        }
        throw error;
      } finally {
        if (activeTransition === transition) {
          activeTransition = null;
        }
        schedulePendingWaiters();
      }
    };

    transition.promise = run();
    return transition.promise;
  };

  const setLocale = (locale: SupportedLocale): Promise<void> => {
    requestedLocale = locale;
    const currentTransition = activeTransition;
    if (currentTransition?.locale === locale) {
      currentTransition.commitExternal = true;
      return currentTransition.promise;
    }

    const allRequiredReady = [...activeNamespaces()]
      .every((namespace) => snapshot.readyNamespaces.has(namespace));
    if (
      currentTransition === null
      && snapshot.locale === locale
      && allRequiredReady
      && !snapshot.error
    ) {
      return Promise.resolve();
    }
    return startTransition(locale, true);
  };

  const requestNamespaces = (
    namespaces: readonly MessageNamespace[],
    owner: NamespaceLeaseToken | null,
  ): Promise<void> => {
    if (owner?.released) return Promise.resolve();
    const requestedNamespaces = new Set<MessageNamespace>(["core", ...namespaces]);
    if (
      (activeTransition === null || activeTransition.locale === snapshot.locale)
      && [...requestedNamespaces]
        .every((namespace) => snapshot.readyNamespaces.has(namespace))
    ) {
      return Promise.resolve();
    }

    const readyPromise = new Promise<void>((resolve, reject) => {
      waiters.add({ namespaces: requestedNamespaces, owner, resolve, reject });
    });
    schedulePendingWaiters();
    return readyPromise;
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setLocale,
    ensureNamespaces: (namespaces) => requestNamespaces(namespaces, null),
    acquireNamespaceLease(namespaces) {
      const leasedNamespaces = [...new Set(namespaces)]
        .filter((namespace) => namespace !== "core");
      const token: NamespaceLeaseToken = {
        namespaces: new Set(leasedNamespaces),
        released: false,
      };
      for (const namespace of leasedNamespaces) {
        leaseCounts.set(namespace, (leaseCounts.get(namespace) ?? 0) + 1);
      }
      const ready = requestNamespaces(namespaces, token);
      return {
        ready,
        release() {
          if (token.released) return;
          token.released = true;
          for (const waiter of waiters) {
            if (waiter.owner !== token) continue;
            waiters.delete(waiter);
            waiter.resolve();
          }
          for (const namespace of leasedNamespaces) {
            const nextCount = (leaseCounts.get(namespace) ?? 0) - 1;
            if (nextCount > 0) leaseCounts.set(namespace, nextCount);
            else leaseCounts.delete(namespace);
          }
          cancelUnusedNamespaces(token.namespaces);
          schedulePendingWaiters();
        },
      };
    },
    retry: () => setLocale(requestedLocale),
  };
}

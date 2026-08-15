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

export interface LocaleRuntimeCoordinator {
  getSnapshot(): LocaleRuntimeSnapshot;
  subscribe(listener: (snapshot: LocaleRuntimeSnapshot) => void): () => void;
  setLocale(locale: SupportedLocale): Promise<void>;
  ensureNamespaces(namespaces: readonly MessageNamespace[]): Promise<void>;
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
  const requiredNamespaces = new Set<MessageNamespace>(["core"]);
  let snapshot: LocaleRuntimeSnapshot = {
    locale: args.initialLocale,
    messages: {},
    readyNamespaces: new Set(),
    loading: false,
    error: false,
  };
  const listeners = new Set<(next: LocaleRuntimeSnapshot) => void>();
  const waiters = new Set<{
    namespaces: ReadonlySet<MessageNamespace>;
    resolve(): void;
    reject(error: unknown): void;
  }>();
  let generation = 0;
  let activeTransition: {
    generation: number;
    locale: SupportedLocale;
    commitExternal: boolean;
    promise: Promise<void>;
  } | null = null;

  const emit = (next: LocaleRuntimeSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener(next);
  };

  const resolveReadyWaiters = () => {
    for (const waiter of waiters) {
      if ([...waiter.namespaces].every((namespace) => snapshot.readyNamespaces.has(namespace))) {
        waiters.delete(waiter);
        waiter.resolve();
      }
    }
  };

  const rejectWaiters = (error: unknown) => {
    for (const waiter of waiters) {
      waiters.delete(waiter);
      waiter.reject(error);
    }
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

  const startTransition = (
    locale: SupportedLocale,
    commitExternal: boolean,
    deferStart: boolean,
  ): Promise<void> => {
    generation += 1;
    const transition = {
      generation,
      locale,
      commitExternal,
      promise: Promise.resolve(),
    };
    activeTransition = transition;
    emit({ ...snapshot, loading: true, error: false });

    const run = async () => {
      try {
        if (deferStart) await Promise.resolve();

        const canReuseCommitted = snapshot.locale === locale
          && snapshot.readyNamespaces.has("core");
        const nextMessages: Record<string, string> = canReuseCommitted
          ? { ...snapshot.messages }
          : {};
        const nextReady = canReuseCommitted
          ? new Set(snapshot.readyNamespaces)
          : new Set<MessageNamespace>();

        while (transition.generation === generation) {
          const missing = [...requiredNamespaces]
            .filter((namespace) => !nextReady.has(namespace));
          if (missing.length === 0) break;

          const loaded = await Promise.all(missing.map((namespace) =>
            args.load(locale, namespace)
          ));
          if (transition.generation !== generation) return;
          for (const result of loaded) {
            Object.assign(nextMessages, result.messages);
            nextReady.add(result.namespace);
          }
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
          rejectWaiters(error);
        }
        throw error;
      } finally {
        if (activeTransition === transition) {
          activeTransition = null;
        }
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

    const allRequiredReady = [...requiredNamespaces]
      .every((namespace) => snapshot.readyNamespaces.has(namespace));
    if (
      currentTransition === null
      && snapshot.locale === locale
      && allRequiredReady
      && !snapshot.error
    ) {
      return Promise.resolve();
    }
    return startTransition(locale, true, false);
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
    ensureNamespaces(namespaces) {
      const requestedNamespaces = new Set<MessageNamespace>(["core", ...namespaces]);
      for (const namespace of requestedNamespaces) {
        requiredNamespaces.add(namespace);
      }

      if (
        activeTransition === null
        && [...requestedNamespaces]
          .every((namespace) => snapshot.readyNamespaces.has(namespace))
      ) {
        return Promise.resolve();
      }

      const readyPromise = new Promise<void>((resolve, reject) => {
        waiters.add({ namespaces: requestedNamespaces, resolve, reject });
      });
      if (activeTransition === null) {
        void startTransition(snapshot.locale, false, true).catch(() => undefined);
      }
      return readyPromise;
    },
    retry: () => setLocale(requestedLocale),
  };
}

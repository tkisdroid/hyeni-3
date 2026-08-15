import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { IntlProvider } from "react-intl";
import {
  createLocaleRuntimeCoordinator,
  loadNamespaceAtomically,
  type LocaleRuntimeCoordinator,
} from "./catalog";
import type {
  CatalogMessages,
  MessageNamespace,
} from "./generated/messageIds";
import {
  localeDirection,
  localizedBrandName,
  type SupportedLocale,
} from "./locale";
import {
  LOCALE_STORAGE_KEY,
  resolveWebLocale,
  type LocaleStoragePort,
} from "./localeStorage";

export interface LocaleContextValue {
  locale: SupportedLocale;
  setLocale(locale: SupportedLocale): Promise<void>;
  ensureNamespaces(namespaces: readonly MessageNamespace[]): Promise<void>;
  readyNamespaces: ReadonlySet<MessageNamespace>;
  loading: boolean;
}

export const LocaleContext = createContext<LocaleContextValue | null>(null);

type LocaleBoundaryLeaseContextValue = (
  namespaces: readonly MessageNamespace[],
) => () => void;

const LocaleBoundaryLeaseContext =
  createContext<LocaleBoundaryLeaseContextValue | null>(null);

export function useLocaleBoundaryLease(): LocaleBoundaryLeaseContextValue {
  const acquireNamespaceLease = useContext(LocaleBoundaryLeaseContext);
  if (!acquireNamespaceLease) {
    throw new Error("useLocaleBoundaryLease는 LocaleProvider 안에서만 사용할 수 있습니다.");
  }
  return acquireNamespaceLease;
}

const browserLocaleStorage: LocaleStoragePort = {
  read() {
    try {
      return window.localStorage.getItem(LOCALE_STORAGE_KEY);
    } catch {
      return null;
    }
  },
  write(locale) {
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // 저장소가 차단되어도 현재 탭의 언어 전환은 계속한다.
    }
  },
};

function detectInitialLocale(): SupportedLocale {
  const navigatorLanguages = typeof navigator === "undefined"
    ? []
    : navigator.languages.length > 0
      ? navigator.languages
      : [navigator.language];
  return resolveWebLocale({
    storedLocale: typeof window === "undefined" ? null : browserLocaleStorage.read(),
    navigatorLanguages,
  });
}

function updateInitialDocument(
  locale: SupportedLocale,
  coreMessages: CatalogMessages,
): void {
  if (typeof document === "undefined") return;
  const brand = coreMessages["core.brand.name"] ?? localizedBrandName(locale);
  document.documentElement.lang = locale;
  document.documentElement.dir = localeDirection(locale);
  document.title = brand;
  document.querySelector('meta[name="apple-mobile-web-app-title"]')
    ?.setAttribute("content", brand);
}

function createBrowserCoordinator(): LocaleRuntimeCoordinator {
  return createLocaleRuntimeCoordinator({
    initialLocale: detectInitialLocale(),
    load: (locale, namespace) => loadNamespaceAtomically({ locale, namespace }),
    storage: browserLocaleStorage,
    document: { update: updateInitialDocument },
  });
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const coordinatorRef = useRef<LocaleRuntimeCoordinator | null>(null);
  if (coordinatorRef.current === null) {
    coordinatorRef.current = createBrowserCoordinator();
  }
  const coordinator = coordinatorRef.current;
  const [runtime, setRuntime] = useState(() => coordinator.getSnapshot());

  useEffect(() => {
    const unsubscribe = coordinator.subscribe(setRuntime);
    void coordinator.setLocale(coordinator.getSnapshot().locale).catch(() => undefined);
    return unsubscribe;
  }, [coordinator]);

  const setLocale = useCallback(
    (locale: SupportedLocale) => coordinator.setLocale(locale),
    [coordinator],
  );
  const ensureNamespaces = useCallback(
    (namespaces: readonly MessageNamespace[]) => coordinator.ensureNamespaces(namespaces),
    [coordinator],
  );
  const acquireNamespaceLease = useCallback(
    (namespaces: readonly MessageNamespace[]) => coordinator.acquireNamespaceLease(namespaces),
    [coordinator],
  );
  const value = useMemo<LocaleContextValue>(() => ({
    locale: runtime.locale,
    setLocale,
    ensureNamespaces,
    readyNamespaces: runtime.readyNamespaces,
    loading: runtime.loading,
  }), [ensureNamespaces, runtime.locale, runtime.loading, runtime.readyNamespaces, setLocale]);

  if (!runtime.readyNamespaces.has("core")) {
    if (!runtime.error) return null;
    return (
      <main className="hy-content">
        <section className="hy-card" role="alert" aria-live="assertive">
          <h1>언어 정보를 불러오지 못했어요</h1>
          <p>연결을 확인한 뒤 다시 시도해 주세요.</p>
          <button
            type="button"
            className="hy-press"
            onClick={() => void coordinator.retry().catch(() => undefined)}
          >
            다시 시도
          </button>
        </section>
      </main>
    );
  }

  return (
    <LocaleBoundaryLeaseContext.Provider value={acquireNamespaceLease}>
      <LocaleContext.Provider value={value}>
        <IntlProvider locale={runtime.locale} defaultLocale="ko" messages={runtime.messages}>
          {children}
        </IntlProvider>
      </LocaleContext.Provider>
    </LocaleBoundaryLeaseContext.Provider>
  );
}

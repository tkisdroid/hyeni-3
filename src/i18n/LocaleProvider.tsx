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
  type NamespaceLease,
} from "./catalog";
import type {
  CatalogMessages,
  MessageNamespace,
} from "./generated/messageIds";
import {
  isSupportedLocale,
  localeDirection,
  localizedBrandName,
  type SupportedLocale,
} from "./locale";
import {
  LOCALE_STORAGE_KEY,
  resolveWebLocale,
  type LocaleStoragePort,
} from "./localeStorage";
import {
  applyBootstrapDocumentLocale,
  localeBootstrapCopy,
} from "./bootstrapCopy";
import { fetchAccessCountry } from "@/lib/api/endpoints/accessRegion";
import {
  accessCountryFromClientHints,
  localeForAccessCountry,
} from "@/transform/accessCountry";

export interface LocaleContextValue {
  locale: SupportedLocale;
  accessCountry: string;
  setLocale(locale: SupportedLocale): Promise<void>;
  ensureNamespaces(namespaces: readonly MessageNamespace[]): Promise<void>;
  readyNamespaces: ReadonlySet<MessageNamespace>;
  loading: boolean;
}

export const LocaleContext = createContext<LocaleContextValue | null>(null);

type LocaleBoundaryLeaseContextValue = (
  namespaces: readonly MessageNamespace[],
) => NamespaceLease;

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

function readBrowserLocaleHints(): {
  storedLocale: string | null;
  navigatorLanguages: readonly string[];
  timeZone: string | null;
} {
  const navigatorLanguages = typeof navigator === "undefined"
    ? []
    : navigator.languages.length > 0
      ? navigator.languages
      : [navigator.language];
  return {
    storedLocale: typeof window === "undefined" ? null : browserLocaleStorage.read(),
    navigatorLanguages,
    timeZone: typeof Intl === "undefined"
      ? null
      : Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
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

function createBrowserCoordinator(): {
  coordinator: LocaleRuntimeCoordinator;
  initialAccessCountry: string;
  hadStoredLocale: boolean;
} {
  const hints = readBrowserLocaleHints();
  const initialLocale = resolveWebLocale(hints);
  const initialAccessCountry = accessCountryFromClientHints(hints);
  applyBootstrapDocumentLocale(initialLocale);
  return {
    coordinator: createLocaleRuntimeCoordinator({
      initialLocale,
      load: (locale, namespace) => loadNamespaceAtomically({ locale, namespace }),
      storage: browserLocaleStorage,
      document: { update: updateInitialDocument },
    }),
    initialAccessCountry,
    hadStoredLocale: hints.storedLocale !== null && isSupportedLocale(hints.storedLocale),
  };
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const browserRuntimeRef = useRef<ReturnType<typeof createBrowserCoordinator> | null>(null);
  if (browserRuntimeRef.current === null) {
    browserRuntimeRef.current = createBrowserCoordinator();
  }
  const browserRuntime = browserRuntimeRef.current;
  const coordinator = browserRuntime.coordinator;
  const userLocaleLockedRef = useRef(browserRuntime.hadStoredLocale);
  const [runtime, setRuntime] = useState(() => coordinator.getSnapshot());
  const [accessCountry, setAccessCountry] = useState(browserRuntime.initialAccessCountry);

  useEffect(() => {
    const unsubscribe = coordinator.subscribe(setRuntime);
    void coordinator.setLocale(coordinator.getSnapshot().locale).catch(() => undefined);
    return unsubscribe;
  }, [coordinator]);

  useEffect(() => {
    let active = true;
    void fetchAccessCountry().then((country) => {
      if (!active || !country) return;
      setAccessCountry(country);
      if (userLocaleLockedRef.current) return;
      void coordinator.setLocale(localeForAccessCountry(country)).catch(() => undefined);
    });
    return () => {
      active = false;
    };
  }, [coordinator]);

  const setLocale = useCallback(
    (locale: SupportedLocale) => {
      userLocaleLockedRef.current = true;
      return coordinator.setLocale(locale);
    },
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
    accessCountry,
    setLocale,
    ensureNamespaces,
    readyNamespaces: runtime.readyNamespaces,
    loading: runtime.loading,
  }), [accessCountry, ensureNamespaces, runtime.locale, runtime.loading, runtime.readyNamespaces, setLocale]);

  if (!runtime.readyNamespaces.has("core")) {
    if (!runtime.error) return null;
    const bootstrap = localeBootstrapCopy(runtime.locale);
    return (
      <main
        className="hy-content"
        lang={runtime.locale}
        dir={localeDirection(runtime.locale)}
      >
        <section className="hy-card" role="alert" aria-live="assertive">
          <h1>{bootstrap.title}</h1>
          <p>{bootstrap.body}</p>
          <button
            type="button"
            className="hy-press"
            onClick={() => void coordinator.retry().catch(() => undefined)}
          >
            {bootstrap.retry}
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

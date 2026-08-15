import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { IntlProvider } from "react-intl";
import { loadNamespaceAtomically } from "./catalog";
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

interface LocaleRuntimeState {
  locale: SupportedLocale;
  messages: CatalogMessages;
  readyNamespaces: ReadonlySet<MessageNamespace>;
  loading: boolean;
}

export const LocaleContext = createContext<LocaleContextValue | null>(null);

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

async function loadNamespaceSet(
  locale: SupportedLocale,
  namespaces: readonly MessageNamespace[],
): Promise<{ messages: CatalogMessages; readyNamespaces: ReadonlySet<MessageNamespace> }> {
  const uniqueNamespaces = [...new Set(namespaces)];
  const loaded = await Promise.all(uniqueNamespaces.map((namespace) =>
    loadNamespaceAtomically({ locale, namespace })
  ));
  return {
    messages: Object.assign({}, ...loaded.map((result) => result.messages)),
    readyNamespaces: new Set(uniqueNamespaces),
  };
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const initialLocaleRef = useRef<SupportedLocale | null>(null);
  if (initialLocaleRef.current === null) {
    initialLocaleRef.current = detectInitialLocale();
  }

  const [runtime, setRuntime] = useState<LocaleRuntimeState>(() => ({
    locale: initialLocaleRef.current ?? "en",
    messages: {},
    readyNamespaces: new Set<MessageNamespace>(),
    loading: false,
  }));
  const runtimeRef = useRef(runtime);
  const currentNamespacesRef = useRef<ReadonlySet<MessageNamespace>>(new Set(["core"]));
  const generationRef = useRef(0);
  const pendingCountRef = useRef(0);
  const activeSwitchRef = useRef<Promise<void> | null>(null);

  const commitRuntime = useCallback((next: LocaleRuntimeState) => {
    runtimeRef.current = next;
    setRuntime(next);
  }, []);

  const beginLoading = useCallback(() => {
    pendingCountRef.current += 1;
    if (pendingCountRef.current === 1) {
      commitRuntime({ ...runtimeRef.current, loading: true });
    }
  }, [commitRuntime]);

  const endLoading = useCallback(() => {
    pendingCountRef.current = Math.max(0, pendingCountRef.current - 1);
    if (pendingCountRef.current === 0 && runtimeRef.current.loading) {
      commitRuntime({ ...runtimeRef.current, loading: false });
    }
  }, [commitRuntime]);

  const setLocale = useCallback(async (locale: SupportedLocale): Promise<void> => {
    if (
      runtimeRef.current.locale === locale
      && runtimeRef.current.readyNamespaces.has("core")
      && activeSwitchRef.current === null
    ) {
      return;
    }

    const generation = generationRef.current + 1;
    generationRef.current = generation;
    beginLoading();

    const switchPromise = (async () => {
      const core = await loadNamespaceAtomically({ locale, namespace: "core" });
      if (generation !== generationRef.current) return;

      browserLocaleStorage.write(locale);
      updateInitialDocument(locale, core.messages);

      const requiredNamespaces = [...currentNamespacesRef.current];
      const remainingNamespaces = requiredNamespaces.filter((namespace) => namespace !== "core");
      const remaining = await loadNamespaceSet(locale, remainingNamespaces);
      if (generation !== generationRef.current) return;

      commitRuntime({
        locale,
        messages: { ...core.messages, ...remaining.messages },
        readyNamespaces: new Set(["core", ...remaining.readyNamespaces]),
        loading: true,
      });
    })();
    activeSwitchRef.current = switchPromise;

    try {
      await switchPromise;
    } finally {
      if (activeSwitchRef.current === switchPromise) {
        activeSwitchRef.current = null;
      }
      endLoading();
    }
  }, [beginLoading, commitRuntime, endLoading]);

  const ensureNamespaces = useCallback(async (
    namespaces: readonly MessageNamespace[],
  ): Promise<void> => {
    const requestedNamespaces = new Set<MessageNamespace>(["core", ...namespaces]);
    currentNamespacesRef.current = requestedNamespaces;

    const activeSwitch = activeSwitchRef.current;
    if (activeSwitch) {
      await activeSwitch;
      return ensureNamespaces(namespaces);
    }

    const snapshot = runtimeRef.current;
    const missingNamespaces = [...requestedNamespaces].filter(
      (namespace) => !snapshot.readyNamespaces.has(namespace),
    );
    if (missingNamespaces.length === 0) return;

    const generation = generationRef.current;
    beginLoading();
    try {
      const loaded = await loadNamespaceSet(snapshot.locale, missingNamespaces);
      if (generation !== generationRef.current) return;

      const current = runtimeRef.current;
      commitRuntime({
        ...current,
        messages: { ...current.messages, ...loaded.messages },
        readyNamespaces: new Set([...current.readyNamespaces, ...loaded.readyNamespaces]),
        loading: true,
      });
    } finally {
      endLoading();
    }
  }, [beginLoading, commitRuntime, endLoading]);

  useEffect(() => {
    void setLocale(initialLocaleRef.current ?? "en");
  }, [setLocale]);

  const value = useMemo<LocaleContextValue>(() => ({
    locale: runtime.locale,
    setLocale,
    ensureNamespaces,
    readyNamespaces: runtime.readyNamespaces,
    loading: runtime.loading,
  }), [ensureNamespaces, runtime.locale, runtime.loading, runtime.readyNamespaces, setLocale]);

  return (
    <LocaleContext.Provider value={value}>
      <IntlProvider locale={runtime.locale} defaultLocale="ko" messages={runtime.messages}>
        {runtime.readyNamespaces.has("core") ? children : null}
      </IntlProvider>
    </LocaleContext.Provider>
  );
}

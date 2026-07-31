import { APP_VERSION } from "@/config/version";
import { getPlatform, isNativePlatform } from "@/lib/native/plugins";
import {
  appendFeedbackDiagnosticEvent,
  FEEDBACK_DIAGNOSTIC_EVENT_LIMIT,
  FEEDBACK_DIAGNOSTIC_MAX_AGE_MS,
  normalizeFeedbackDiagnosticCode,
  normalizeFeedbackDiagnosticMethod,
  normalizeFeedbackDiagnosticPath,
  normalizeFeedbackDiagnosticScreen,
  normalizeFeedbackDiagnosticSource,
  type FeedbackDiagnosticEvent,
  type FeedbackDiagnosticKind,
} from "@/transform/feedbackDiagnostics";

const DIAGNOSTIC_STORAGE_KEY = "hyeni-feedback-diagnostics-v1";
const LAST_SCREEN_STORAGE_KEY = "hyeni-feedback-last-screen-v1";

export type FeedbackRuntime =
  | "android-native"
  | "ios-browser"
  | "ios-pwa"
  | "web"
  | "web-pwa";

export interface FeedbackDeviceInfo {
  appVersion: string;
  runtime: FeedbackRuntime;
  platform: "android" | "ios" | "web";
  userAgent: string;
  language: string;
  timezone: string;
  viewport: { width: number; height: number; pixelRatio: number };
  online: boolean;
  pwaStandalone: boolean;
  serviceWorker: "activated" | "installing" | "none" | "unsupported" | "waiting";
  notificationPermission: "default" | "denied" | "granted" | "unsupported";
  networkType: "2g" | "3g" | "4g" | "slow-2g" | "unknown";
}

export interface FeedbackDiagnostics {
  schemaVersion: 1;
  currentScreen: string;
  deviceInfo: FeedbackDeviceInfo;
  errorLogs: FeedbackDiagnosticEvent[];
}

interface RecordFeedbackDiagnosticInput {
  kind: FeedbackDiagnosticKind;
  error: unknown;
  status?: number;
  method?: string;
  path?: string;
  sourceFile?: string;
  sourceLine?: number;
  sourceColumn?: number;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function currentRoute(): string {
  if (typeof window === "undefined") return "/unknown";
  return normalizeFeedbackDiagnosticScreen(window.location.hash || window.location.pathname);
}

function readStoredEvents(): FeedbackDiagnosticEvent[] {
  const store = storage();
  if (!store) return [];
  const nowMs = Date.now();
  try {
    const parsed = JSON.parse(store.getItem(DIAGNOSTIC_STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((value): value is Record<string, unknown> => (
        Boolean(value) && typeof value === "object" && !Array.isArray(value)
      ))
      .map((value) => {
        const method = normalizeFeedbackDiagnosticMethod(value.method);
        return {
          at: typeof value.at === "string" ? value.at : "",
          kind: value.kind as FeedbackDiagnosticKind,
          code: normalizeFeedbackDiagnosticCode(value.code),
          screen: normalizeFeedbackDiagnosticScreen(value.screen),
          ...(typeof value.count === "number" && Number.isInteger(value.count)
            ? { count: Math.min(999, Math.max(1, value.count)) }
            : {}),
          ...(typeof value.status === "number"
            && Number.isInteger(value.status)
            && value.status >= 0
            && value.status <= 599
            ? { status: value.status }
            : {}),
          ...(method ? { method } : {}),
          ...(typeof value.path === "string"
            ? { path: normalizeFeedbackDiagnosticPath(value.path) }
            : {}),
          ...(typeof value.source === "string"
            && /^[A-Za-z0-9._-]{1,92}\.(?:css|js|jsx|mjs|ts|tsx)(?::\d{1,8}){0,2}$/i.test(value.source)
            ? { source: value.source }
            : {}),
        };
      })
      .filter((event) => (
        ["api", "mutation", "rejection", "render", "runtime"].includes(event.kind)
        && Number.isFinite(Date.parse(event.at))
        && Date.parse(event.at) >= nowMs - FEEDBACK_DIAGNOSTIC_MAX_AGE_MS
        && Date.parse(event.at) <= nowMs + 60_000
      ))
      .slice(-FEEDBACK_DIAGNOSTIC_EVENT_LIMIT);
  } catch {
    return [];
  }
}

export function recordFeedbackDiagnostic(input: RecordFeedbackDiagnosticInput): void {
  const store = storage();
  if (!store) return;
  const status = typeof input.status === "number"
    && Number.isInteger(input.status)
    && input.status >= 0
    && input.status <= 599
    ? input.status
    : undefined;
  const method = normalizeFeedbackDiagnosticMethod(input.method);
  const source = normalizeFeedbackDiagnosticSource(
    input.sourceFile,
    input.sourceLine,
    input.sourceColumn,
  );
  const event: FeedbackDiagnosticEvent = {
    at: new Date().toISOString(),
    kind: input.kind,
    code: normalizeFeedbackDiagnosticCode(input.error),
    screen: currentRoute(),
    ...(status === undefined ? {} : { status }),
    ...(method ? { method } : {}),
    ...(input.path ? { path: normalizeFeedbackDiagnosticPath(input.path) } : {}),
    ...(source ? { source } : {}),
  };
  try {
    store.setItem(
      DIAGNOSTIC_STORAGE_KEY,
      JSON.stringify(appendFeedbackDiagnosticEvent(readStoredEvents(), event)),
    );
  } catch {
    // 진단 저장 실패가 실제 사용자 동작을 방해하면 안 된다.
  }
}

export function clearFeedbackDiagnostics(): void {
  try {
    storage()?.removeItem(DIAGNOSTIC_STORAGE_KEY);
  } catch {
    // 접수는 완료됐으므로 로컬 정리 실패를 사용자 오류로 확대하지 않는다.
  }
}

export function startFeedbackScreenTracking(): () => void {
  if (typeof window === "undefined") return () => {};
  const remember = () => {
    const screen = currentRoute();
    if (screen === "/unknown" || screen === "/feedback") return;
    try {
      storage()?.setItem(LAST_SCREEN_STORAGE_KEY, screen);
    } catch {
      // 라우트 힌트가 없어도 피드백 접수는 가능하다.
    }
  };
  remember();
  window.addEventListener("hashchange", remember);
  window.addEventListener("popstate", remember);
  return () => {
    window.removeEventListener("hashchange", remember);
    window.removeEventListener("popstate", remember);
  };
}

function feedbackScreen(): string {
  const current = currentRoute();
  if (current !== "/feedback") return current;
  try {
    return normalizeFeedbackDiagnosticScreen(storage()?.getItem(LAST_SCREEN_STORAGE_KEY));
  } catch {
    return "/unknown";
  }
}

function runtimeInfo(): {
  platform: "android" | "ios" | "web";
  standalone: boolean;
  runtime: FeedbackRuntime;
} {
  const nativePlatform = isNativePlatform();
  const rawPlatform = getPlatform();
  const standalone = typeof window !== "undefined" && (
    window.matchMedia?.("(display-mode: standalone)").matches === true
    || (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
  const iosBrowser = !nativePlatform
    && typeof navigator !== "undefined"
    && (
      /iPad|iPhone|iPod/i.test(navigator.userAgent)
      || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
    );
  const platform = rawPlatform === "android" || rawPlatform === "ios"
    ? rawPlatform
    : iosBrowser
      ? "ios"
      : "web";
  const runtime: FeedbackRuntime = nativePlatform && platform === "android"
    ? "android-native"
    : iosBrowser
      ? standalone ? "ios-pwa" : "ios-browser"
      : standalone
        ? "web-pwa"
        : "web";
  return { platform, standalone, runtime };
}

async function serviceWorkerState(): Promise<FeedbackDeviceInfo["serviceWorker"]> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return "unsupported";
  let timeoutId: number | undefined;
  try {
    const registration = await Promise.race([
      navigator.serviceWorker.getRegistration(),
      new Promise<null>((resolve) => {
        timeoutId = window.setTimeout(() => resolve(null), 1_000);
      }),
    ]);
    if (!registration) return "none";
    if (registration.active?.state === "activated") return "activated";
    if (registration.waiting) return "waiting";
    if (registration.installing) return "installing";
    return "none";
  } catch {
    return "none";
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
}

function networkType(): FeedbackDeviceInfo["networkType"] {
  const connection = typeof navigator === "undefined"
    ? null
    : (navigator as Navigator & { connection?: { effectiveType?: unknown } }).connection;
  const value = connection?.effectiveType;
  return value === "slow-2g" || value === "2g" || value === "3g" || value === "4g"
    ? value
    : "unknown";
}

export async function collectFeedbackDiagnostics(): Promise<FeedbackDiagnostics> {
  const runtime = runtimeInfo();
  const notificationPermission = typeof Notification === "undefined"
    ? "unsupported"
    : Notification.permission;
  const resolvedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return {
    schemaVersion: 1,
    currentScreen: feedbackScreen(),
    deviceInfo: {
      appVersion: APP_VERSION,
      runtime: runtime.runtime,
      platform: runtime.platform,
      userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent.slice(0, 320),
      language: typeof navigator === "undefined"
        ? "und"
        : (navigator.language || "und").slice(0, 35),
      timezone: (resolvedTimezone || "Etc/UTC").slice(0, 64),
      viewport: {
        width: typeof window === "undefined" ? 0 : Math.round(window.innerWidth),
        height: typeof window === "undefined" ? 0 : Math.round(window.innerHeight),
        pixelRatio: typeof window === "undefined" ? 1 : Number(window.devicePixelRatio.toFixed(2)),
      },
      online: typeof navigator === "undefined" ? true : navigator.onLine,
      pwaStandalone: runtime.standalone,
      serviceWorker: await serviceWorkerState(),
      notificationPermission,
      networkType: networkType(),
    },
    errorLogs: readStoredEvents(),
  };
}

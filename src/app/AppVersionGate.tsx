import { useEffect, useRef } from "react";
import { useLocation } from "react-router";
import { APP_VERSION } from "@/config/version";
import { isNativePlatform } from "@/lib/native/plugins";
import {
  forcedUpdateHash,
  resolveAppUpdateDecision,
  shouldEnforceForcedUpdate,
  shouldReleaseForcedUpdate,
  type AppVersionPolicy,
  type AppUpdateDecision,
} from "@/transform/appVersionPolicy";

export const APP_VERSION_POLICY_URL = "https://hyeni-calendar.pages.dev/app-version.json";
const VERSION_CHECK_TIMEOUT_MS = 5_000;
const VERSION_CHECK_MIN_INTERVAL_MS = 30_000;
const OPTIONAL_PROMPT_KEY_PREFIX = "hy_update_prompted_";
const VERSION_POLICY_CACHE_KEY = "hy_app_version_policy_v1";

function isVersionPolicy(value: unknown): value is AppVersionPolicy {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AppVersionPolicy>;
  return typeof candidate.minimumSupportedVersion === "string"
    && typeof candidate.latestVersion === "string";
}

function optionalPromptSeen(version: string): boolean {
  try {
    return sessionStorage.getItem(`${OPTIONAL_PROMPT_KEY_PREFIX}${version}`) === "1";
  } catch {
    return false;
  }
}

function rememberOptionalPrompt(version: string): void {
  try {
    sessionStorage.setItem(`${OPTIONAL_PROMPT_KEY_PREFIX}${version}`, "1");
  } catch {
    // 저장소를 사용할 수 없어도 업데이트 확인 자체는 계속한다.
  }
}

function readCachedPolicy(): AppVersionPolicy | null {
  try {
    const cached: unknown = JSON.parse(localStorage.getItem(VERSION_POLICY_CACHE_KEY) ?? "null");
    return isVersionPolicy(cached) ? cached : null;
  } catch {
    return null;
  }
}

function cachePolicy(policy: AppVersionPolicy): void {
  try {
    localStorage.setItem(VERSION_POLICY_CACHE_KEY, JSON.stringify(policy));
  } catch {
    // 저장소를 사용할 수 없어도 현재 실행의 정책은 그대로 적용한다.
  }
}

function openUpdateScreen(kind: "forced" | "optional", targetVersion: string): void {
  const hash = kind === "forced"
    ? forcedUpdateHash(targetVersion)
    : `#/app-update?target=${encodeURIComponent(targetVersion)}`;
  if (kind === "forced") {
    window.location.replace(`${window.location.pathname}${window.location.search}${hash}`);
    return;
  }
  window.location.hash = hash;
}

/** Android 네이티브 앱만 원격 최소 버전 정책을 확인한다. 웹 PWA는 서비스 워커가 갱신한다. */
export function AppVersionGate() {
  const location = useLocation();
  const forcedTargetVersionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isNativePlatform()) return;
    let disposed = false;
    let lastCheckAt = 0;
    let checkInFlight = false;
    let activeController: AbortController | null = null;
    let appStateListener: { remove: () => Promise<void> } | null = null;

    const enforceForcedUpdate = () => {
      if (
        !forcedTargetVersionRef.current
        || !shouldEnforceForcedUpdate(window.location.hash, forcedTargetVersionRef.current)
      ) return;
      openUpdateScreen("forced", forcedTargetVersionRef.current);
    };

    const leaveStaleForcedScreen = () => {
      window.location.replace(`${window.location.pathname}${window.location.search}#/`);
    };

    const applyDecision = (decision: AppUpdateDecision | null) => {
      const releaseForcedScreen = shouldReleaseForcedUpdate(window.location.hash, decision);
      if (!decision) {
        forcedTargetVersionRef.current = null;
        if (releaseForcedScreen) leaveStaleForcedScreen();
        return;
      }
      if (decision.kind === "forced") {
        forcedTargetVersionRef.current = decision.targetVersion;
        enforceForcedUpdate();
        return;
      }
      forcedTargetVersionRef.current = null;
      if (optionalPromptSeen(decision.targetVersion)) {
        if (releaseForcedScreen) leaveStaleForcedScreen();
        return;
      }
      if (releaseForcedScreen) leaveStaleForcedScreen();
      rememberOptionalPrompt(decision.targetVersion);
      openUpdateScreen("optional", decision.targetVersion);
    };

    const refreshPolicy = (force = false) => {
      const now = Date.now();
      if (
        disposed
        || checkInFlight
        || (!force && now - lastCheckAt < VERSION_CHECK_MIN_INTERVAL_MS)
      ) return;

      lastCheckAt = now;
      checkInFlight = true;
      const controller = new AbortController();
      activeController = controller;
      const timeout = window.setTimeout(() => controller.abort(), VERSION_CHECK_TIMEOUT_MS);

      void (async () => {
        try {
          const response = await fetch(APP_VERSION_POLICY_URL, {
            cache: "no-store",
            signal: controller.signal,
          });
          if (!response.ok) throw new Error("app_version_policy_http_error");
          const payload: unknown = await response.json();
          if (!isVersionPolicy(payload)) throw new Error("app_version_policy_invalid");
          cachePolicy(payload);
          if (!disposed) applyDecision(resolveAppUpdateDecision(APP_VERSION, payload));
        } catch (error: unknown) {
          if (error instanceof DOMException && error.name === "AbortError") return;
          console.error("[app-version] 업데이트 정책을 확인하지 못했어요");
        } finally {
          window.clearTimeout(timeout);
          if (activeController === controller) activeController = null;
          checkInFlight = false;
        }
      })();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshPolicy();
    };

    window.addEventListener("hashchange", enforceForcedUpdate);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    const cachedPolicy = readCachedPolicy();
    if (cachedPolicy) applyDecision(resolveAppUpdateDecision(APP_VERSION, cachedPolicy));
    refreshPolicy(true);

    void import("@capacitor/app")
      .then(({ App }) => App.addListener("appStateChange", (next) => {
        if (next.isActive) refreshPolicy();
      }))
      .then((listener) => {
        if (disposed) {
          void listener.remove();
          return;
        }
        appStateListener = listener;
      })
      .catch(() => {
        // Capacitor App 플러그인 초기화 실패는 다음 앱 실행 때 다시 확인한다.
      })

    return () => {
      disposed = true;
      window.removeEventListener("hashchange", enforceForcedUpdate);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      activeController?.abort();
      if (appStateListener) void appStateListener.remove();
      forcedTargetVersionRef.current = null;
    };
  }, []);

  // HashRouter의 pushState 기반 navigate()도 빠짐없이 강제 화면으로 되돌린다.
  useEffect(() => {
    const targetVersion = forcedTargetVersionRef.current;
    if (
      !isNativePlatform()
      || !targetVersion
      || !shouldEnforceForcedUpdate(window.location.hash, targetVersion)
    ) return;
    openUpdateScreen("forced", targetVersion);
  }, [location.key]);

  return null;
}

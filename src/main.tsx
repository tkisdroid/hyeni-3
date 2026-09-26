import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import "./styles/tokens.css";
import "./styles/global.css";
import "./styles/components.css";
import "./styles/glass.css";
import { App } from "./app/App";
import { LocaleProvider } from "./i18n/LocaleProvider";
import { isNativePlatform } from "./lib/native/plugins";
import { rememberReferralFromCurrentLocation } from "./transform/referralLink";
import {
  activatePwaUpdateAndWaitForControllerChange,
  observePwaControllerChanges,
  pwaUpdateCoordinatorState,
  queuePwaUpdateAction,
  retryPendingPwaUpdate,
} from "./lib/pwaUpdateCoordinator";
import { canReloadForPwaUpdateNow } from "./lib/pwaReloadTiming";

const nativePlatform = isNativePlatform();

document.documentElement.toggleAttribute("data-hy-native", isNativePlatform());
rememberReferralFromCurrentLocation();

const browserServiceWorkerContainer = "serviceWorker" in navigator
  ? navigator.serviceWorker
  : null;
// Capacitor는 APK 안의 정적 파일을 직접 읽으므로 PWA Service Worker가 필요하지 않다.
// 네이티브에서 등록을 남기면 `adb install -r`/스토어 업데이트 직후 이전 index.html을
// 한 번 더 제공해 새 오류 문구·보안 흐름이 늦게 적용될 수 있다. 웹/PWA만 등록하고,
// 새 번들을 한 번 읽은 네이티브 설치에서는 과거 등록도 제거해 다음 업데이트를 보호한다.
const serviceWorkerContainer = nativePlatform ? null : browserServiceWorkerContainer;

if (nativePlatform && browserServiceWorkerContainer) {
  void browserServiceWorkerContainer.getRegistrations()
    .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
    .catch(() => undefined);
}

/**
 * 새 버전 적용 새로고침. 네이티브 앱에서 보고 있는 화면을 스스로 새로고침하면
 * 앱이 튕긴 것처럼 보이므로(2026-08-18 TK 제보) 백그라운드로 갈 때까지 미룬다.
 * 실패로 돌려주면 coordinator 가 보류했다가 다음 신호에 다시 시도한다.
 */
function reloadForPwaUpdate(): void {
  if (!canReloadForPwaUpdateNow({
    native: isNativePlatform(),
    visibility: document.visibilityState,
  })) {
    throw new Error("앱 사용 중 — 백그라운드에서 적용");
  }
  window.location.reload();
}

if (serviceWorkerContainer) {
  observePwaControllerChanges(serviceWorkerContainer, () => {
    queuePwaUpdateAction("reload", reloadForPwaUpdate);
  });
}

let applyWaitingServiceWorker: (reloadPage?: boolean) => Promise<void> = async () => undefined;

async function activateWaitingServiceWorker(): Promise<void> {
  if (!serviceWorkerContainer) return;
  const registration = await serviceWorkerContainer.getRegistration();
  if (!registration?.waiting) return;
  // getRegistration()을 기다리는 사이 결제 등이 시작됐으면 활성화를 다시 보류한다.
  if (pwaUpdateCoordinatorState().criticalSectionCount > 0) {
    throw new Error("PWA 업데이트 중요 작업 시작");
  }
  await activatePwaUpdateAndWaitForControllerChange(
    serviceWorkerContainer,
    () => applyWaitingServiceWorker(false),
  );
}

/** 오래 열어 둔 브라우저 탭이 옛 번들에 머물지 않도록 주기적으로 새 버전을 확인한다. */
const PWA_UPDATE_CHECK_INTERVAL_MS = 30 * 60_000;

if (serviceWorkerContainer) {
  applyWaitingServiceWorker = registerSW({
    immediate: true,
    onRegisteredSW: (_url, registration) => {
      if (!registration) return;
      const check = () => {
        void registration.update().catch(() => undefined);
      };
      setInterval(check, PWA_UPDATE_CHECK_INTERVAL_MS);
      // 다시 화면을 볼 때도 한 번 확인한다 — 배포 직후 탭으로 돌아온 경우를 덮는다.
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") check();
      });
    },
    onNeedRefresh: () => {
      queuePwaUpdateAction("activate", activateWaitingServiceWorker);
    },
    onNeedReload: () => {
      queuePwaUpdateAction("reload", reloadForPwaUpdate);
    },
  });

  window.addEventListener("online", retryPendingPwaUpdate);
  document.addEventListener("visibilitychange", retryPendingPwaUpdate);
}

const root = document.getElementById("root");
if (!root) throw new Error("#root 엘리먼트를 찾을 수 없습니다.");

createRoot(root).render(
  <StrictMode>
    <LocaleProvider>
      <App />
    </LocaleProvider>
  </StrictMode>,
);

// 앱 글꼴(Hyeni Sans = Pretendard 조각)은 선언만 47KB 라 진입 CSS 예산에 넣지 않는다.
// 첫 화면을 그린 뒤 따로 받아 오고(font-display: swap), 글자 조각은 화면에 쓰인 구간만 내려받는다.
void import("./styles/pretendard.css");

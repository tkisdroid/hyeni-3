import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import "./styles/tokens.css";
import "./styles/global.css";
import "./styles/components.css";
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

document.documentElement.toggleAttribute("data-hy-native", isNativePlatform());
rememberReferralFromCurrentLocation();

const serviceWorkerContainer = "serviceWorker" in navigator
  ? navigator.serviceWorker
  : null;

if (serviceWorkerContainer) {
  observePwaControllerChanges(serviceWorkerContainer, () => {
    queuePwaUpdateAction("reload", () => window.location.reload());
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

applyWaitingServiceWorker = registerSW({
  immediate: true,
  onNeedRefresh: () => {
    queuePwaUpdateAction("activate", activateWaitingServiceWorker);
  },
  onNeedReload: () => {
    queuePwaUpdateAction("reload", () => window.location.reload());
  },
});

window.addEventListener("online", retryPendingPwaUpdate);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") retryPendingPwaUpdate();
});

const root = document.getElementById("root");
if (!root) throw new Error("#root 엘리먼트를 찾을 수 없습니다.");

createRoot(root).render(
  <StrictMode>
    <LocaleProvider>
      <App />
    </LocaleProvider>
  </StrictMode>,
);

/**
 * 네이티브 실행 인텐트·App Link에서 친구 초대 코드를 건져 영속한다.
 * OAuth 콜백과 섞지 않는다(인가코드 1회 소비 경로를 건드리면 안 된다).
 */
import type { PluginListenerHandle } from "@capacitor/core";
import { isNativePlatform, getNativePlugin } from "./plugins";
import { extractReferralCodeFromInput, persistReferralCode, rememberReferralFromHref } from "@/transform/referralLink";

interface InstallReferrerPlugin {
  readOnce(): Promise<{ referrer?: string }>;
}

let listenerRefs = 0;
let sharedHandle: PluginListenerHandle | null = null;
let pendingInit: Promise<void> | null = null;

function captureUrl(url: string): void {
  rememberReferralFromHref(url);
}

export function initReferralDeepLink(): () => void {
  if (!isNativePlatform()) return () => {};

  listenerRefs += 1;
  if (listenerRefs === 1) {
    pendingInit = (async () => {
      const { App: CapApp } = await import("@capacitor/app");
      sharedHandle = await CapApp.addListener("appUrlOpen", (event) => {
        if (event.url) captureUrl(event.url);
      });
      try {
        const launch = await CapApp.getLaunchUrl();
        if (launch?.url) captureUrl(launch.url);
      } catch {
        /* 실행 인텐트 조회 실패는 무시 */
      }
      const referrerPlugin = getNativePlugin<InstallReferrerPlugin>("InstallReferrer");
      if (referrerPlugin) {
        try {
          const result = await referrerPlugin.readOnce();
          const code = extractReferralCodeFromInput(result.referrer ?? "");
          if (code) persistReferralCode(code);
        } catch {
          /* Play 설치 추천은 없어도 웹 링크·수동 입력으로 이어진다. */
        }
      }
    })().catch(() => {
      /* 리스너 등록 실패는 온보딩 수동 입력으로 강등 */
    });
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    listenerRefs = Math.max(0, listenerRefs - 1);
    if (listenerRefs > 0) return;
    void Promise.resolve(pendingInit).then(async () => {
      if (listenerRefs > 0) return;
      const handle = sharedHandle;
      sharedHandle = null;
      if (handle) await handle.remove();
    });
  };
}

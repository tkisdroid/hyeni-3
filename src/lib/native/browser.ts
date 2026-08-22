/**
 * 외부(시스템) 브라우저 열기 브리지 — hyeni-1 nativeBrowser.js 이관.
 *
 * OAuth authorize 페이지는 앱 WebView 가 아니라 시스템 브라우저에서 열어야 한다
 * (카카오/구글 정책 + 딥링크로 앱 복귀). Android는 커스텀 ExternalBrowser 플러그인의
 * ACTION_VIEW, iOS는 공식 Capacitor Browser를 사용한다. 웹(PWA)은 현재 창을 해당 URL로
 * 이동시켜(window.location.href) 기존 웹 OAuth 리다이렉트 동작을 그대로 보존한다.
 */
import { getNativePlugin, getPlatform, isNativePlatform } from "./plugins";

interface ExternalBrowserPlugin {
  open(options: { url: string }): Promise<void>;
  close(): Promise<void>;
}

const PLUGIN_NAME = "ExternalBrowser";

/**
 * 외부 브라우저로 URL 열기.
 * - Android: ExternalBrowser 플러그인으로 기본 브라우저를 연다.
 * - iOS: Capacitor Browser로 SFSafariViewController를 연다.
 * - 웹(폴백): 현재 창을 이동(window.location.href) — 기존 웹 흐름 보존.
 */
export async function openExternal(url: string): Promise<void> {
  if (!url) throw new Error("URL이 필요해요");

  if (isNativePlatform() && getPlatform() === "ios") {
    try {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url });
      return;
    } catch (error) {
      console.error("iOS 시스템 브라우저 열기 실패:", error);
      throw new Error("외부 브라우저를 열 수 없어요. Safari 설정을 확인해 주세요.");
    }
  }

  const browser = getNativePlugin<ExternalBrowserPlugin>(PLUGIN_NAME);
  if (!browser) {
    // 웹(PWA) 폴백 — 앱이 웹에서도 깨지지 않도록 현재 창 이동으로 대체한다.
    if (typeof window !== "undefined") window.location.href = url;
    return;
  }

  try {
    await browser.open({ url });
  } catch (error) {
    console.error("외부 브라우저 열기 실패:", error);
    throw new Error("외부 브라우저를 열 수 없어요. 기본 브라우저 앱을 확인해 주세요.");
  }
}

/**
 * 외부 브라우저 닫기 시도. 네이티브 아니면 no-op.
 * (Android ACTION_VIEW 로 띄운 외부 브라우저는 프로그램적으로 닫히지 않는 경우가 많아
 *  best-effort 이며 실패해도 무시한다.)
 */
export async function closeExternal(): Promise<void> {
  if (!isNativePlatform()) return;
  try {
    if (getPlatform() === "ios") {
      const { Browser } = await import("@capacitor/browser");
      await Browser.close();
      return;
    }
    const browser = getNativePlugin<ExternalBrowserPlugin>(PLUGIN_NAME);
    await browser?.close?.();
  } catch {
    // 외부 브라우저는 닫기 불가일 수 있음 — 무시.
  }
}

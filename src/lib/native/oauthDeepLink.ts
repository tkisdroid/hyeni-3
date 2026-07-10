/**
 * OAuth 네이티브 복귀(딥링크) 배선 — hyeni-1 App.jsx handleNativeAuthCallback 이관.
 *
 * 흐름(네이티브):
 *   1. startWorkerOAuth 가 시스템 브라우저로 Worker /start 를 연다(target=딥링크 스킴).
 *   2. provider 로그인 완료 → Worker /callback 이 hyenicalendar://auth-callback?provider&code&state 로 재리다이렉트.
 *   3. OS 가 앱을 열고 @capacitor/app 의 appUrlOpen(또는 콜드스타트 launchUrl)이 그 URL 을 전달.
 *   4. 여기서 파싱 → finishOAuthLogin(code 교환 + 세션 적용) → AuthProvider 가 토큰변경으로 상태 재동기화.
 *
 * 웹(PWA)은 이 경로를 쓰지 않는다(웹은 window.location 리다이렉트 + Onboarding 의 readOAuthCallback).
 * → 네이티브가 아니면 즉시 no-op 해제 함수를 반환한다.
 *
 * ★ App(오케스트레이터)에서 마운트 시 initOAuthDeepLink() 를 1회 호출해야 한다. 반환값은 리스너 해제 함수.
 */
import type { PluginListenerHandle } from "@capacitor/core";
import type { URLOpenListenerEvent } from "@capacitor/app";
import { isNativePlatform } from "./plugins";
import { closeExternal } from "./browser";
import { finishOAuthLogin } from "@/lib/api/endpoints/auth";
import type { OAuthProvider } from "@/transform/oauthProvider";
import { parseOAuthDeepLinkUrl, type OAuthDeepLinkCallback } from "@/transform/oauthDeepLinkParse";
import { deriveAuthState } from "@/auth/AuthContext";
import { homePathForRole } from "@/auth/guards";

type DeepLinkCallback = OAuthDeepLinkCallback;

export interface OAuthDeepLinkResult {
  ok: boolean;
  provider: OAuthProvider;
  error?: Error;
}

export type OAuthResultHandler = (result: OAuthDeepLinkResult) => void;

/**
 * 딥링크 URL(hyenicalendar://auth-callback?provider&code&state) → {provider, code, state} 파싱.
 * 스킴/코드/지원 provider 가 아니면 null. 파라미터는 fragment(#) 우선, 없으면 query(?) 에서 읽는다
 * (Worker 는 query 로 보내지만 fragment 형태도 안전하게 커버 — hyeni-1 계약).
 */
export function parseOAuthDeepLink(url: string): DeepLinkCallback | null {
  return parseOAuthDeepLinkUrl(url);
}

/**
 * 로그인 성공 후 파생 role 홈으로 이동(HashRouter). finishOAuthLogin 의 notifyTokens 로
 * AuthProvider 상태는 이미 갱신되지만, 딥링크 복귀 시엔 온보딩 화면에 머무를 수 있어
 * 여기서 홈 라우팅만 보조한다. OAuth 는 부모 전용이라 role 미확정이면 부모 홈으로 수렴한다.
 */
function routeToHomeAfterLogin(): void {
  if (typeof window === "undefined") return;
  const { role } = deriveAuthState();
  window.location.hash = homePathForRole(role);
}

// 딥링크 URL 1건 처리. 유효한 OAuth 콜백이면 세션 교환 후 true, 아니면 false.
async function handleUrl(url: string, onResult?: OAuthResultHandler): Promise<boolean> {
  const cb = parseOAuthDeepLink(url);
  if (!cb) return false;

  try {
    await finishOAuthLogin(cb);
    routeToHomeAfterLogin();
    onResult?.({ ok: true, provider: cb.provider });
    return true;
  } catch (error) {
    console.error("네이티브 OAuth 콜백 처리 실패:", error);
    const err = error instanceof Error ? error : new Error(String(error));
    onResult?.({ ok: false, provider: cb.provider, error: err });
    return false;
  } finally {
    // OAuth 를 끝낸 시스템 브라우저 닫기 시도(대개 no-op).
    void closeExternal();
  }
}

/**
 * 딥링크 리스너 등록 + 콜드스타트 launch URL 확인. 반환값 = 해제 함수.
 * 웹/비네이티브면 no-op(빈 해제 함수만 반환).
 *
 * @param onResult 로그인 성공/실패 알림(선택) — 토스트 등 UI 피드백용.
 */
export function initOAuthDeepLink(onResult?: OAuthResultHandler): () => void {
  if (!isNativePlatform()) return () => {};

  let handle: PluginListenerHandle | null = null;
  let disposed = false;

  void (async () => {
    try {
      const { App: CapApp } = await import("@capacitor/app");

      // 콜드스타트: 앱이 딥링크로 실행됐다면 launch URL 을 선처리.
      try {
        const launch = await CapApp.getLaunchUrl();
        if (launch?.url) await handleUrl(launch.url, onResult);
      } catch {
        /* getLaunchUrl 미지원/실패 무시 */
      }

      if (disposed) return;
      handle = await CapApp.addListener("appUrlOpen", (event: URLOpenListenerEvent) => {
        void handleUrl(event.url, onResult);
      });
      // 등록 완료 이전에 해제됐다면 즉시 정리.
      if (disposed) {
        void handle.remove();
        handle = null;
      }
    } catch (error) {
      console.error("OAuth 딥링크 리스너 등록 실패:", error);
    }
  })();

  return () => {
    disposed = true;
    if (handle) {
      void handle.remove();
      handle = null;
    }
  };
}

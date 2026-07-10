/**
 * OAuth 네이티브 복귀(딥링크) 배선 — hyeni-1 App.jsx handleNativeAuthCallback 이관.
 *
 * 흐름(네이티브):
 *   1. startWorkerOAuth 가 시스템 브라우저로 Worker /start 를 연다(target=딥링크 스킴).
 *   2. provider 로그인 완료 → Worker /callback 이 hyenicalendar://auth-callback?provider&code&state 로 재리다이렉트.
 *   3. OS 가 앱을 열고 @capacitor/app 의 appUrlOpen(또는 콜드스타트 실행 인텐트)이 그 URL 을 전달.
 *   4. 여기서 파싱 → finishOAuthLogin(code 교환 + 세션 적용) → AuthProvider 가 토큰변경으로 상태 재동기화.
 *
 * ★ 인가코드는 1회용이다(2026-07-10 실기기 실측).
 *   콜드 스타트에선 같은 딥링크가 실행 인텐트와 appUrlOpen 두 경로로 들어와 code 가 2~3회 교환됐다.
 *   구글은 코드 재사용을 감지하면 그 코드로 발급된 토큰을 전부 무효화하므로 로그인이 통째로 실패한다
 *   (카카오는 먼저 도착한 요청만 성공해 증상이 가려졌다). → oauthCodeOnce 가드로 provider:code 당 1회만 교환한다.
 *   리스너도 참조 카운트(listenerRefs)로 단 하나만 유지해 중복 호출을 막는다.
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
import {
  createOAuthCodeOnce,
  localStorageOAuthOnceStore,
  oauthCodeKey,
  type OAuthCodeOnce,
} from "@/transform/oauthCodeOnce";
import { deriveAuthState } from "@/auth/AuthContext";
import { homePathForRole } from "@/auth/guards";

type DeepLinkCallback = OAuthDeepLinkCallback;

const OAUTH_ONCE_STORAGE_KEY = "hyeni-oauth-consumed-v1";

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

let codeOnce: OAuthCodeOnce | null = null;
function getCodeOnce(): OAuthCodeOnce {
  if (!codeOnce) codeOnce = createOAuthCodeOnce(localStorageOAuthOnceStore(OAUTH_ONCE_STORAGE_KEY));
  return codeOnce;
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

// 인가코드 1건 교환(실제 네트워크). 실패는 여기서 흡수해 호출자에게 false 로 알린다.
async function exchange(cb: DeepLinkCallback, onResult?: OAuthResultHandler): Promise<boolean> {
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

/** 딥링크 URL 1건 처리. 같은 provider:code 는 앱을 재시작해도 다시 교환하지 않는다. */
async function handleUrl(url: string, onResult?: OAuthResultHandler): Promise<boolean> {
  const cb = parseOAuthDeepLink(url);
  if (!cb) return false;
  return getCodeOnce().run(oauthCodeKey(cb.provider, cb.code), () => exchange(cb, onResult));
}

// 리스너는 앱 전체에서 하나만 유지한다(중복 등록 = 인가코드 중복 교환).
let listenerRefs = 0;
let sharedHandle: PluginListenerHandle | null = null;
let pendingInit: Promise<void> | null = null;
let resultHandler: OAuthResultHandler | undefined;

function notifyResult(result: OAuthDeepLinkResult): void {
  resultHandler?.(result);
}

// 함수로 읽는다 — 비동기 클로저 안에서 TS 가 카운터를 상수로 좁히지 않도록.
function hasListenerRefs(): boolean {
  return listenerRefs > 0;
}

async function removeSharedHandle(): Promise<void> {
  const handle = sharedHandle;
  sharedHandle = null;
  if (handle) await handle.remove();
}

/**
 * 딥링크 리스너 등록(참조 카운트) + 콜드스타트 실행 인텐트 확인. 반환값 = 해제 함수.
 * 웹/비네이티브면 no-op(빈 해제 함수만 반환).
 *
 * 순서가 중요하다: 먼저 appUrlOpen 을 구독한 뒤 실행 인텐트를 확인해야 그 사이 도착한 인텐트를 놓치지 않는다.
 * 두 경로가 같은 URL 을 줘도 1회 소비 가드가 중복 교환을 흡수한다.
 *
 * @param onResult 로그인 성공/실패 알림(선택) — 토스트 등 UI 피드백용.
 */
export function initOAuthDeepLink(onResult?: OAuthResultHandler): () => void {
  if (!isNativePlatform()) return () => {};

  resultHandler = onResult;
  listenerRefs += 1;

  if (listenerRefs === 1) {
    pendingInit = (async () => {
      const { App: CapApp } = await import("@capacitor/app");

      sharedHandle = await CapApp.addListener("appUrlOpen", (event: URLOpenListenerEvent) => {
        void handleUrl(event.url, notifyResult);
      });
      if (!hasListenerRefs()) {
        await removeSharedHandle();
        return;
      }

      // 콜드스타트 보강: 앱이 딥링크로 실행됐다면 그 URL 도 확인한다.
      // 이 값은 이후에도 같은 URL 을 계속 돌려주므로(휘발되지 않음) 1회 소비 가드가 필수다.
      try {
        const launch = await CapApp.getLaunchUrl();
        if (launch?.url) await handleUrl(launch.url, notifyResult);
      } catch {
        /* 실행 인텐트 조회 미지원/실패 무시 */
      }
    })().catch((error) => {
      console.error("OAuth 딥링크 리스너 등록 실패:", error);
    });
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    listenerRefs = Math.max(0, listenerRefs - 1);
    if (listenerRefs > 0) return;
    resultHandler = undefined;
    void Promise.resolve(pendingInit).then(() => {
      if (!hasListenerRefs()) void removeSharedHandle();
    });
  };
}

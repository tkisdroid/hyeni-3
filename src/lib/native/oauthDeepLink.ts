/**
 * OAuth 네이티브 복귀(딥링크) 배선 — hyeni-1 App.jsx handleNativeAuthCallback 이관.
 *
 * 흐름(네이티브):
 *   1. startWorkerOAuth 가 시스템 브라우저로 Worker /start 를 연다.
 *   2. provider 로그인 완료 → Worker가 플랫폼별로 고정된 callback에 code/state를 반환한다.
 *   3. Android는 검증된 HTTPS App Link, iOS는 등록된 전용 URL scheme으로 앱을 열어 URL을 전달한다.
 *   4. 여기서 파싱 → finishOAuthLogin(code 교환 + 세션 적용) → 온보딩이 가족 생성/초대 후속 단계를 재개한다.
 *
 * ★ 인가코드는 1회용이다(2026-07-10 실기기 실측).
 *   콜드 스타트에선 같은 딥링크가 실행 인텐트와 appUrlOpen 두 경로로 들어와 code 가 2~3회 교환됐다.
 *   구글은 코드 재사용을 감지하면 그 코드로 발급된 토큰을 전부 무효화하므로 로그인이 통째로 실패한다
 *   (카카오는 먼저 도착한 요청만 성공해 증상이 가려졌다). → oauthCodeOnce 가드로 provider:state 당 1회만 교환한다.
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
import {
  adoptAuthResult,
  acknowledgeOAuthLoginRecovery,
  clearRecoveredOAuthLoginContext,
  finishOAuthCancellation,
  finishOAuthLogin,
  getBoundedOAuthDeviceDescriptor,
  linkOAuthAccount,
  peekMatchingOAuthFlowMode,
  recoverOAuthLogin,
  type AuthResult,
} from "@/lib/api/endpoints/auth";
import { isApiError } from "@/lib/api/errors";
import { withOperationDeadline } from "@/transform/asyncUiState";
import type { AuthDeviceDescriptor } from "@/lib/native/deviceIdentity";
import {
  accessTokenJti,
  createApiLoginGenerationId,
  getApiAccessToken,
  getApiLoginGenerationId,
  getApiSessionInstanceId,
  userFromAccessToken,
} from "@/lib/api/session";
import type { OAuthProvider } from "@/transform/oauthProvider";
import {
  parseOAuthCancellationUrl,
  parseOAuthDeepLinkUrl,
  type OAuthCancellationCallback,
  type OAuthDeepLinkCallback,
} from "@/transform/oauthDeepLinkParse";
import {
  createOAuthCodeOnce,
  localStorageOAuthOnceStore,
  oauthStateKey,
  type OAuthCodeOnce,
} from "@/transform/oauthCodeOnce";
import { readOnboardingDraft } from "@/transform/onboardingDraft";
import {
  bindNativeOAuthLoginCompletion,
  clearNativeOAuthPendingExchange,
  publishNativeOAuthLoginCompletion,
  readNativeOAuthPendingExchange,
  stageNativeOAuthPendingExchange,
  stageNativeOAuthLoginCompletion,
  type NativeOAuthPendingExchange,
} from "@/transform/nativeOAuthLoginCompletion";

type DeepLinkCallback = OAuthDeepLinkCallback;

const OAUTH_ONCE_STORAGE_KEY = "hyeni-oauth-consumed-v2";
const LEGACY_OAUTH_ONCE_STORAGE_KEY = "hyeni-oauth-consumed-v1";

export interface OAuthDeepLinkResult {
  ok: boolean;
  provider: OAuthProvider;
  /** 로그인인지 계정 연결인지 — 화면이 다른 피드백을 줄 수 있게. */
  mode: "login" | "link";
  /** 이미 연결돼 있었는가(link 모드 전용). */
  already?: boolean;
  errorCode?: "oauth_exchange_failed" | "oauth_cancelled" | "oauth_cancellation_failed";
}

/** 연결 결과를 화면(설정 등)이 받을 수 있게 알린다. 딥링크 복귀 시점엔 어떤 화면인지 모른다. */
export const OAUTH_LINK_EVENT = "hyeni:oauth-link";
/** 현재 transaction과 정확히 일치하는 App Link를 수신해 처리에 들어간 순간. */
export const OAUTH_DEEP_LINK_ACTIVITY_EVENT = "hyeni:oauth-deep-link-activity";
/** 로그인/연결 callback의 최종 결과. 외부 브라우저 resume gate가 API 중간에 풀리지 않게 한다. */
export const OAUTH_DEEP_LINK_RESULT_EVENT = "hyeni:oauth-deep-link-result";

export type OAuthResultHandler = (result: OAuthDeepLinkResult) => void;

/**
 * 플랫폼별 고정 callback URL → {provider, code, state} 파싱.
 * 스킴/코드/지원 provider 가 아니면 null. 파라미터는 fragment(#) 우선, 없으면 query(?) 에서 읽는다
 * (Worker 는 query 로 보내지만 fragment 형태도 안전하게 커버 — hyeni-1 계약).
 */
export function parseOAuthDeepLink(url: string): DeepLinkCallback | null {
  return parseOAuthDeepLinkUrl(url);
}

let codeOnce: OAuthCodeOnce | null = null;
function getCodeOnce(): OAuthCodeOnce {
  if (!codeOnce) {
    try { window.localStorage.removeItem(LEGACY_OAUTH_ONCE_STORAGE_KEY); } catch { /* 접근 불가 */ }
    codeOnce = createOAuthCodeOnce(localStorageOAuthOnceStore(OAUTH_ONCE_STORAGE_KEY));
  }
  return codeOnce;
}

function dispatchActivity(provider: OAuthProvider, mode: "login" | "link"): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(OAUTH_DEEP_LINK_ACTIVITY_EVENT, {
      detail: { provider, mode },
    }));
  }
}

async function acknowledgeCompletion(pending: NativeOAuthPendingExchange): Promise<void> {
  try {
    await acknowledgeOAuthLoginRecovery(pending);
    clearNativeOAuthPendingExchange(pending.id);
  } catch {
    // 이미 채택한 세션은 유지한다. TTL 안 다음 init에서 같은 generation으로 ACK를 재시도한다.
  }
}

function finalizeLogin(
  result: AuthResult,
  provider: OAuthProvider,
  pending: NativeOAuthPendingExchange,
): void {
  const callbackDraft = readOnboardingDraft();
  const expectedUserId = result.user?.id
    ?? result.session.user?.id
    ?? userFromAccessToken(result.session.access_token)?.id
    ?? "";
  const adoptedLoginGenerationId = getApiAccessToken() === result.session.access_token
    ? getApiLoginGenerationId()
    : null;
  const loginGenerationId = adoptedLoginGenerationId ?? createApiLoginGenerationId();
  const completion = stageNativeOAuthLoginCompletion({
    provider,
    accountStatus: result.account_status ?? null,
    expectedUserId,
    expectedAccessTokenJti: accessTokenJti(result.session.access_token) ?? "",
    expectedLoginGenerationId: loginGenerationId,
    pairInvite: callbackDraft?.pairInvite ?? null,
  });
  if (!adoptedLoginGenerationId) {
    adoptAuthResult(result, { loginGenerationId });
  }
  const sessionInstanceId = getApiSessionInstanceId();
  if (
    !sessionInstanceId
    || getApiLoginGenerationId() !== loginGenerationId
    || !bindNativeOAuthLoginCompletion(completion.id, sessionInstanceId)
  ) {
    throw new Error("native_oauth_completion_bind_failed");
  }
  // 전역 리스너가 홈으로 단정하지 않는다. 신규 부모의 가족 생성과 공동 보호자
  // 초대는 Onboarding의 공통 post-auth resolver가 이어서 처리한다.
  if (typeof window !== "undefined") window.location.hash = "#/onboarding";
  publishNativeOAuthLoginCompletion(completion.id);
  void acknowledgeCompletion(pending);
}

async function attemptPendingRecovery(
  pending: NativeOAuthPendingExchange,
  device: AuthDeviceDescriptor,
  deadlineMs: number,
): Promise<AuthResult | "pending" | "unavailable"> {
  let unavailable = false;
  let delayMs = 0;
  while (Date.now() < deadlineMs) {
    if (delayMs > 0) {
      const remainingBeforeDelay = deadlineMs - Date.now();
      if (remainingBeforeDelay <= 0) break;
      await new Promise((resolve) => setTimeout(resolve, Math.min(delayMs, remainingBeforeDelay)));
    }
    const remainingMs = deadlineMs - Date.now();
    if (remainingMs <= 0) break;
    try {
      const recovered = await recoverOAuthLogin(pending, { timeoutMs: remainingMs, device });
      if ("status" in recovered) {
        delayMs = delayMs === 0 ? 250 : Math.min(delayMs * 2, 4_000);
        continue;
      }
      return recovered;
    } catch (error) {
      if (isApiError(error) && error.status === 404) {
        unavailable = true;
        break;
      }
      // timeout/네트워크 오류는 bounded 다음 시도에서만 재확인한다.
    }
    delayMs = delayMs === 0 ? 250 : Math.min(delayMs * 2, 4_000);
  }
  return unavailable ? "unavailable" : "pending";
}

async function finishLoginWithRecovery(
  cb: DeepLinkCallback,
  pending: NativeOAuthPendingExchange,
): Promise<AuthResult> {
  const callbackDraft = readOnboardingDraft();
  return finishOAuthLogin({ ...cb, recoveryId: pending.id }, {
    sessionAdoption: "deferred",
    onboardingInterests: callbackDraft?.signupMethod?.kind === "oauth"
      && callbackDraft?.signupMethod?.provider === cb.provider
      ? callbackDraft.surveyChoices
      : undefined,
  });
}

async function recoverOrRetryUnclaimed(
  pending: NativeOAuthPendingExchange,
  cb?: DeepLinkCallback,
): Promise<AuthResult | null> {
  const deadlineMs = Date.now() + 20_000;
  let device: AuthDeviceDescriptor;
  try {
    device = await getBoundedOAuthDeviceDescriptor(Math.min(4_000, deadlineMs - Date.now()));
  } catch {
    return null;
  }
  const recovered = await attemptPendingRecovery(pending, device, deadlineMs);
  if (recovered !== "pending" && recovered !== "unavailable") return recovered;
  if (recovered !== "unavailable" || !cb || peekMatchingOAuthFlowMode(cb) !== "login") return null;
  // recovery 404 + 정확히 일치하는 launch callback/context는 요청이 Worker에 도달하기 전
  // process가 끝난 경우다. raw code를 저장하지 않고 launch URL에서만 다시 읽으며,
  // 서버 transaction claim이 provider 교환을 여전히 정확히 한 번으로 제한한다.
  try {
    return await finishLoginWithRecovery(cb, pending);
  } catch {
    const raced = await attemptPendingRecovery(pending, device, deadlineMs);
    return raced !== "pending" && raced !== "unavailable" ? raced : null;
  }
}

// 인가코드 1건 교환(실제 네트워크). 실패는 bounded reconciliation 뒤 호출자에게 false 로 알린다.
async function exchange(
  cb: DeepLinkCallback,
  onResult?: OAuthResultHandler,
  pending: NativeOAuthPendingExchange | null = null,
): Promise<boolean> {
  const mode = peekMatchingOAuthFlowMode(cb);
  if (!mode) return false;
  try {
    if (mode === "link") {
      // 이미 로그인한 계정에 소셜을 붙이는 흐름 — 세션을 바꾸지 않고 화면도 유지한다.
      const result = await linkOAuthAccount(cb);
      onResult?.({ ok: true, provider: cb.provider, mode, already: !!result.already });
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent(OAUTH_LINK_EVENT, { detail: { provider: cb.provider, already: !!result.already } }),
        );
      }
      return true;
    }
    if (!pending) throw new Error("native_oauth_recovery_missing");
    const result = await finishLoginWithRecovery(cb, pending);
    if (readNativeOAuthPendingExchange()?.id !== pending.id) return false;
    finalizeLogin(result, cb.provider, pending);
    onResult?.({ ok: true, provider: cb.provider, mode });
    return true;
  } catch (error) {
    if (pending) {
      if (readNativeOAuthPendingExchange()?.id !== pending.id) return false;
      const recovered = await recoverOrRetryUnclaimed(pending, cb);
      if (recovered) {
        try {
          if (readNativeOAuthPendingExchange()?.id !== pending.id) return false;
          clearRecoveredOAuthLoginContext(cb.provider);
          finalizeLogin(recovered, cb.provider, pending);
          onResult?.({ ok: true, provider: cb.provider, mode });
          return true;
        } catch (recoveryError) {
          console.error("네이티브 OAuth 복구 결과 적용 실패:", recoveryError);
        }
      }
    }
    console.error("네이티브 OAuth 콜백 처리 실패:", error);
    onResult?.({ ok: false, provider: cb.provider, mode, errorCode: "oauth_exchange_failed" });
    if (mode === "link" && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(OAUTH_LINK_EVENT, { detail: { provider: cb.provider, failed: true } }));
    }
    return false;
  } finally {
    // OAuth 를 끝낸 시스템 브라우저 닫기 시도(대개 no-op).
    void closeExternal();
  }
}

async function cancel(
  cb: OAuthCancellationCallback,
  onResult?: OAuthResultHandler,
): Promise<boolean> {
  const matchedMode = peekMatchingOAuthFlowMode(cb);
  if (!matchedMode) return false;
  let mode = matchedMode;
  try {
    mode = finishOAuthCancellation(cb);
    onResult?.({ ok: false, provider: cb.provider, mode, errorCode: "oauth_cancelled" });
    if (mode === "link" && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(OAUTH_LINK_EVENT, {
        detail: { provider: cb.provider, cancelled: true },
      }));
    }
    return true;
  } catch (error) {
    console.error("OAuth 취소 콜백 처리 실패:", error);
    onResult?.({ ok: false, provider: cb.provider, mode, errorCode: "oauth_cancellation_failed" });
    if (mode === "link" && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(OAUTH_LINK_EVENT, {
        detail: { provider: cb.provider, failed: true },
      }));
    }
    return false;
  } finally {
    void closeExternal();
  }
}

/** 딥링크 URL 1건 처리. 같은 provider:state 는 앱을 재시작해도 다시 교환하지 않는다. */
async function handleUrl(url: string, onResult?: OAuthResultHandler): Promise<boolean> {
  const cancellation = parseOAuthCancellationUrl(url);
  if (cancellation) {
    const mode = peekMatchingOAuthFlowMode(cancellation);
    if (!mode) return false;
    return getCodeOnce().run(
      oauthStateKey(cancellation.provider, cancellation.state),
      () => {
        dispatchActivity(cancellation.provider, mode);
        return cancel(cancellation, onResult);
      },
    );
  }
  const cb = parseOAuthDeepLink(url);
  if (!cb) return false;
  const mode = peekMatchingOAuthFlowMode(cb);
  if (!mode) return false;
  const once = getCodeOnce();
  const key = oauthStateKey(cb.provider, cb.state);
  // once.run은 exec 전에 consumed를 영속화한다. 그 사이 process가 끝나도 복구 ID가
  // 먼저 남아 있어야 하므로, 신규 login callback만 stage한 뒤 run에 전달한다.
  let pending: NativeOAuthPendingExchange | null = null;
  if (mode === "login" && !once.consumed(key)) {
    try {
      pending = stageNativeOAuthPendingExchange(cb.provider);
    } catch (error) {
      dispatchActivity(cb.provider, mode);
      console.error("OAuth 복구 표식 저장 실패:", error);
      onResult?.({ ok: false, provider: cb.provider, mode, errorCode: "oauth_exchange_failed" });
      void closeExternal();
      return false;
    }
  }
  return once.run(key, () => {
    dispatchActivity(cb.provider, mode);
    return exchange(cb, onResult, pending);
  });
}

// 리스너는 앱 전체에서 하나만 유지한다(중복 등록 = 인가코드 중복 교환).
let listenerRefs = 0;
let sharedHandle: PluginListenerHandle | null = null;
let pendingInit: Promise<void> | null = null;
let resultHandler: OAuthResultHandler | undefined;
let pendingRecoveryInFlight: Promise<boolean> | null = null;

function notifyResult(result: OAuthDeepLinkResult): void {
  resultHandler?.(result);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(OAUTH_DEEP_LINK_RESULT_EVENT, { detail: result }));
  }
}

// 함수로 읽는다 — 비동기 클로저 안에서 TS 가 카운터를 상수로 좁히지 않도록.
function hasListenerRefs(): boolean {
  return listenerRefs > 0;
}

function resumePendingExchange(
  launchUrl: string | null,
  onResult?: OAuthResultHandler,
): Promise<boolean> {
  if (pendingRecoveryInFlight) return pendingRecoveryInFlight;
  const pending = readNativeOAuthPendingExchange();
  if (!pending) return Promise.resolve(false);
  const launchCallback = launchUrl ? parseOAuthDeepLink(launchUrl) : null;
  const matchingLaunch = launchCallback?.provider === pending.provider ? launchCallback : undefined;
  dispatchActivity(pending.provider, "login");
  pendingRecoveryInFlight = (async () => {
    try {
      const recovered = await recoverOrRetryUnclaimed(pending, matchingLaunch);
      // 사용자가 복구 중 새 인증 intent를 시작했다면 과거 결과로 세션을 덮지 않는다.
      if (readNativeOAuthPendingExchange()?.id !== pending.id) return false;
      if (!recovered) {
        onResult?.({
          ok: false,
          provider: pending.provider,
          mode: "login",
          errorCode: "oauth_exchange_failed",
        });
        return true;
      }
      clearRecoveredOAuthLoginContext(pending.provider);
      finalizeLogin(recovered, pending.provider, pending);
      onResult?.({ ok: true, provider: pending.provider, mode: "login" });
      return true;
    } catch (error) {
      console.error("네이티브 OAuth process 복구 실패:", error);
      if (readNativeOAuthPendingExchange()?.id === pending.id) {
        onResult?.({
          ok: false,
          provider: pending.provider,
          mode: "login",
          errorCode: "oauth_exchange_failed",
        });
      }
      return true;
    } finally {
      void closeExternal();
    }
  })().finally(() => {
    pendingRecoveryInFlight = null;
  });
  return pendingRecoveryInFlight;
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
      let launchUrl: string | null = null;
      try {
        launchUrl = (await withOperationDeadline(
          CapApp.getLaunchUrl(),
          { timeoutMs: 2_000, errorCode: "oauth_launch_url_timeout" },
        ))?.url ?? null;
      } catch {
        // 실행 인텐트를 못 읽어도 local pending reconciliation은 반드시 수행한다.
      }
      const recovered = await resumePendingExchange(launchUrl, notifyResult);
      if (!recovered && launchUrl) await handleUrl(launchUrl, notifyResult);
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

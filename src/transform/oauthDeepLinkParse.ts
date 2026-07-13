/**
 * OAuth 딥링크 URL 파싱(순수) — 네이티브 의존 없이 테스트 가능하게 분리.
 *
 * Worker 콜백이 만드는 실제 형태(라이브 확인):
 *   https://hyeni-calendar.pages.dev/oauth/callback?provider=google&code=CODE&state=NONCE
 *   https://hyeni-calendar.pages.dev/oauth/callback?provider=naver&code=CODE&state=NONCE
 *   https://hyeni-calendar.pages.dev/oauth/callback?provider=google&state=NONCE&error=oauth_cancelled
 *
 * fragment(#) 우선, 없으면 query(?) 에서 읽는다(hyeni-1 계약 보존).
 */
import { isOAuthProvider, type OAuthProvider } from "./oauthProvider.ts";

export const OAUTH_CALLBACK_URL = "https://hyeni-calendar.pages.dev/oauth/callback";

export interface OAuthDeepLinkCallback {
  provider: OAuthProvider;
  code: string;
  state: string;
}

export interface OAuthCancellationCallback {
  provider: OAuthProvider;
  state: string;
}

function readCallbackParams(url: string): URLSearchParams | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (`${parsed.origin}${parsed.pathname}` !== OAUTH_CALLBACK_URL) return null;
    const raw = parsed.hash ? parsed.hash.slice(1) : parsed.search.slice(1);
    return new URLSearchParams(raw);
  } catch {
    return null;
  }
}

export function parseOAuthDeepLinkUrl(url: string): OAuthDeepLinkCallback | null {
  const params = readCallbackParams(url);
  if (!params) return null;
  const code = params.get("code");
  const state = params.get("state") || "";
  // 사용자가 동의를 취소하면 code 없이 error 만 온다 → 별도 취소 파서가 처리한다.
  if (!code || !state) return null;
  const provider = params.get("provider");
  if (!isOAuthProvider(provider)) return null;

  return { provider, code, state };
}

/** Worker가 검증·소비한 사용자 취소만 별도 결과로 받는다. provider 원문 오류는 노출하지 않는다. */
export function parseOAuthCancellationUrl(url: string): OAuthCancellationCallback | null {
  const params = readCallbackParams(url);
  if (!params || params.get("error") !== "oauth_cancelled" || params.get("code")) return null;
  const state = params.get("state") || "";
  const provider = params.get("provider");
  if (!state || !isOAuthProvider(provider)) return null;
  return { provider, state };
}

/**
 * OAuth 딥링크 URL 파싱(순수) — 네이티브 의존 없이 테스트 가능하게 분리.
 *
 * Worker 콜백이 만드는 실제 형태(라이브 확인):
 *   hyenicalendar://auth-callback?provider=google&code=CODE&state=NONCE
 *   hyenicalendar://auth-callback?provider=naver&code=CODE&state=NONCE
 *   hyenicalendar://auth-callback?provider=google&state=NONCE&error=access_denied  ← 사용자 취소
 *
 * fragment(#) 우선, 없으면 query(?) 에서 읽는다(hyeni-1 계약 보존).
 */
import { isOAuthProvider, type OAuthProvider } from "./oauthProvider.ts";

export const OAUTH_CALLBACK_SCHEME = "hyenicalendar://auth-callback";

export interface OAuthDeepLinkCallback {
  provider: OAuthProvider;
  code: string;
  state: string;
}

export function parseOAuthDeepLinkUrl(url: string): OAuthDeepLinkCallback | null {
  if (!url || !url.startsWith(OAUTH_CALLBACK_SCHEME)) return null;

  const raw = url.includes("#") ? url.split("#")[1] : url.split("?")[1] || "";
  const params = new URLSearchParams(raw);
  const code = params.get("code");
  // 사용자가 동의를 취소하면 code 없이 error 만 온다 → 로그인 시도로 취급하지 않는다.
  if (!code) return null;
  const provider = params.get("provider");
  if (!isOAuthProvider(provider)) return null;

  return { provider, code, state: params.get("state") || "" };
}

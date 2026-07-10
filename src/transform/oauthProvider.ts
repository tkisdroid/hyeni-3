/**
 * 지원 OAuth provider 단일 출처.
 *
 * provider 판별이 여러 곳(딥링크 파서·콜백 파서·교환)에 흩어져 있으면 새 provider 추가 시
 * 한 곳을 빠뜨려 "로그인은 시작되는데 복귀가 안 되는" 침묵 실패가 난다.
 *
 * ⚠️ provider 별 계약 차이(worker 라우트 기준):
 *  - kakao/google: Worker 가 인가 URL 을 만든다 → GET  {API_BASE}/api/auth/oauth/{provider}/start
 *                  교환                        → POST {API_BASE}/api/auth/oauth/{provider}
 *  - naver:        클라가 직접 인가 URL 로 이동 → https://nid.naver.com/oauth2.0/authorize
 *                  교환                        → POST {API_BASE}/api/auth/naver
 *                  (code·state·redirect_uri 를 모두 보내야 한다 — worker/routes/naver-auth.ts)
 */
export const OAUTH_PROVIDERS = ["kakao", "google", "naver"] as const;

export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export function isOAuthProvider(value: unknown): value is OAuthProvider {
  return typeof value === "string" && (OAUTH_PROVIDERS as readonly string[]).includes(value);
}

/** 네이버는 Worker /start 를 거치지 않고 클라가 직접 인가 URL 을 조립한다. */
export function usesWorkerStartRedirect(provider: OAuthProvider): boolean {
  return provider !== "naver";
}

/** 코드 교환 경로. 네이버만 별도 라우트. */
export function oauthExchangePath(provider: OAuthProvider): string {
  return provider === "naver" ? "/api/auth/naver" : `/api/auth/oauth/${provider}`;
}

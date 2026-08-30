/**
 * 지원 OAuth provider 단일 출처.
 *
 * provider 판별이 여러 곳(딥링크 파서·콜백 파서·교환)에 흩어져 있으면 새 provider 추가 시
 * 한 곳을 빠뜨려 "로그인은 시작되는데 복귀가 안 되는" 침묵 실패가 난다.
 *
 * ⚠️ provider 별 계약 차이(worker 라우트 기준):
 *  - 신규 로그인은 kakao/google만 Worker가 일회성 state+별도 transaction secret을 발급한다.
 *  - naver는 배포 전 생성된 transaction의 callback·계정 복구 호환을 위해서만 판별한다.
 *  - 교환은 kakao/google=/oauth/{provider}, naver=/naver이며 code·state·secret이 모두 필요하다.
 */
export const OAUTH_PROVIDERS = ["kakao", "google", "naver"] as const;

export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export function isOAuthProvider(value: unknown): value is OAuthProvider {
  return typeof value === "string" && (OAUTH_PROVIDERS as readonly string[]).includes(value);
}

/** 코드 교환 경로. 네이버만 별도 라우트. */
export function oauthExchangePath(provider: OAuthProvider): string {
  return provider === "naver" ? "/api/auth/naver" : `/api/auth/oauth/${provider}`;
}

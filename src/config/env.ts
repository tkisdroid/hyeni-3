/**
 * 환경변수 단일 진입점.
 * 컴포넌트/모듈은 import.meta.env 를 직접 읽지 말고 여기서 파생된 상수를 쓴다.
 * (오타·미설정 처리·검증을 한 곳에 모은다.)
 */

// 미설정 시에도 항상 prod Worker 로 동작하도록 기본값을 잡는다(hyeni-1 client.js 계약).
const DEFAULT_API_BASE = "https://hyeni-calendar-api.tkisdroid.workers.dev";
// 배포된 웹앱(PWA) 공개 주소. 페어링 QR 딥링크에 쓴다(네이티브 origin=localhost 대체).
const DEFAULT_WEB_BASE = "https://hyeni-calendar.pages.dev";

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Cloudflare Worker API base. 끝 슬래시 제거(경로 조립 시 이중 슬래시 방지). */
export const API_BASE = trimTrailingSlash(import.meta.env.VITE_API_BASE || DEFAULT_API_BASE);

/** 공개 웹앱 base(QR 딥링크용). 네이티브에서 origin 이 localhost 라 QR 이 무용지물이 되는 걸 막는다. */
export const PUBLIC_WEB_BASE = trimTrailingSlash(import.meta.env.VITE_PUBLIC_WEB_BASE || DEFAULT_WEB_BASE);

/** Kakao Maps JS 앱키(클라 SDK 용). REST 키는 Worker secret — 절대 VITE_ 금지. */
export const KAKAO_APP_KEY = (import.meta.env.VITE_KAKAO_APP_KEY || "").trim();

/** Naver 소셜 로그인 Client ID. 미설정 시 네이버 버튼은 "설정 필요" 상태로 표시. */
export const NAVER_CLIENT_ID = (import.meta.env.VITE_NAVER_CLIENT_ID || "").trim();

/** Kakao 지도 SDK 사용 가능 여부(키 존재). */
export const hasKakaoKey = KAKAO_APP_KEY.length > 0;

/** 네이버 소셜 로그인 사용 가능 여부(Client ID 존재). */
export const hasNaverClientId = NAVER_CLIENT_ID.length > 0;

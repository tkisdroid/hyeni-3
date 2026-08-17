/**
 * Kakao Maps JS SDK 로더(싱글턴).
 * 최초 1회 스크립트 주입 + kakao.maps.load 후 resolve. 이후엔 즉시 resolve.
 * 키(VITE_KAKAO_APP_KEY)는 config/env 경유. 미설정/미인증이면 reject → 화면이 폴백.
 */
import { KAKAO_APP_KEY, hasKakaoKey } from "@/config/env";
import { retryKakaoMapLoad } from "@/transform/kakaoMapRetry";

// SDK 는 window.kakao 에 주입(외부 untyped 전역).
/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    kakao?: any;
  }
}
export type KakaoMaps = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

let loadPromise: Promise<KakaoMaps> | null = null;
const KAKAO_RETRY_DELAY_MS = 300;

/**
 * SDK 를 미리 받아 둔다(앱이 한가할 때).
 * 지도 화면에 처음 들어가는 순간 스크립트를 받기 시작하면 그 왕복만큼 흰 화면이 길어진다.
 * 실패는 무시 — 실제로 지도가 필요할 때 loadKakaoMaps 가 다시 시도한다.
 */
export function warmKakaoMaps(): void {
  if (!hasKakaoKey || typeof window === "undefined") return;
  if (window.kakao?.maps || loadPromise) return;
  const start = () => void loadKakaoMaps().catch(() => {});
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void })
    .requestIdleCallback;
  if (ric) ric(start, { timeout: 3000 });
  else window.setTimeout(start, 1200);
}

function loadKakaoMapsOnce(): Promise<KakaoMaps> {
  if (window.kakao?.maps) return Promise.resolve(window.kakao.maps);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<KakaoMaps>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_APP_KEY}&autoload=false&libraries=services`;
    script.async = true;
    script.onload = () => {
      try {
        window.kakao.maps.load(() => resolve(window.kakao.maps));
      } catch (e) {
        script.remove();
        reject(e instanceof Error ? e : new Error("Kakao 지도 초기화 실패"));
      }
    };
    script.onerror = () => {
      script.remove();
      loadPromise = null; // 재시도 허용
      reject(new Error("Kakao 지도를 불러오지 못했어요"));
    };
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    // script.onerror뿐 아니라 SDK 초기화 예외도 singleton에 고착되지 않게 한다.
    // 실패한 Promise가 남으면 화면의 "다시 불러오기"도 영구히 같은 실패만 받는다.
    loadPromise = null;
    throw error;
  });
  return loadPromise;
}

export function loadKakaoMaps(): Promise<KakaoMaps> {
  if (!hasKakaoKey) return Promise.reject(new Error("Kakao 지도 키가 설정되지 않았어요"));
  if (typeof window === "undefined") return Promise.reject(new Error("브라우저 환경이 아니에요"));

  return retryKakaoMapLoad(
    loadKakaoMapsOnce,
    () => new Promise<void>((resolve) => window.setTimeout(resolve, KAKAO_RETRY_DELAY_MS)),
  );
}

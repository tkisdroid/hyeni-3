/**
 * Kakao Maps JS SDK 로더(싱글턴).
 * 최초 1회 스크립트 주입 + kakao.maps.load 후 resolve. 이후엔 즉시 resolve.
 * 키(VITE_KAKAO_APP_KEY)는 config/env 경유. 미설정/미인증이면 reject → 화면이 폴백.
 */
import { KAKAO_APP_KEY, hasKakaoKey } from "@/config/env";

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

export function loadKakaoMaps(): Promise<KakaoMaps> {
  if (!hasKakaoKey) return Promise.reject(new Error("Kakao 지도 키가 설정되지 않았어요"));
  if (typeof window === "undefined") return Promise.reject(new Error("브라우저 환경이 아니에요"));
  if (window.kakao?.maps) return Promise.resolve(window.kakao.maps);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_APP_KEY}&autoload=false&libraries=services`;
    script.async = true;
    script.onload = () => {
      try {
        window.kakao.maps.load(() => resolve(window.kakao.maps));
      } catch (e) {
        reject(e instanceof Error ? e : new Error("Kakao 지도 초기화 실패"));
      }
    };
    script.onerror = () => {
      loadPromise = null; // 재시도 허용
      reject(new Error("Kakao 지도를 불러오지 못했어요"));
    };
    document.head.appendChild(script);
  });
  return loadPromise;
}

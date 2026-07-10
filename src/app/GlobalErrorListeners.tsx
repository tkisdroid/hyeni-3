/**
 * uncaught 예외·unhandled rejection → 사용자에게 보이는 반응(전역 폴백 토스트).
 *
 * React 이벤트 핸들러 안에서 던져진 에러는 ErrorBoundary 가 잡지 못하고
 * window 'error' 로만 온다 — 여기가 그 구멍을 막는다. 잡음(AbortError 등)은 거르고,
 * 화면이 이미 구체적 토스트를 띄웠으면 announceFallbackToast 가 스스로 포기한다.
 */
import { useEffect } from "react";
import { announceFallbackToast, isNoiseError } from "@/lib/globalToast";

const FALLBACK_TEXT = "앗, 문제가 생겼어요. 다시 한번 시도해 주세요";

export function GlobalErrorListeners() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      if (isNoiseError(e.error ?? e.message)) return;
      announceFallbackToast(FALLBACK_TEXT, "⚠️");
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      if (isNoiseError(e.reason)) return;
      announceFallbackToast(FALLBACK_TEXT, "⚠️");
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}

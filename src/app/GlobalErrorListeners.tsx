/**
 * uncaught 예외·unhandled rejection → 사용자에게 보이는 반응(전역 폴백 토스트).
 *
 * React 이벤트 핸들러 안에서 던져진 에러는 ErrorBoundary 가 잡지 못하고
 * window 'error' 로만 온다 — 여기가 그 구멍을 막는다. 잡음(AbortError 등)은 거르고,
 * 화면이 이미 구체적 토스트를 띄웠으면 announceFallbackToast 가 스스로 포기한다.
 */
import { useEffect } from "react";
import { announceFallbackToast, isNoiseError } from "@/lib/globalToast";
import { useAuth } from "@/auth/AuthContext";
import {
  recordFeedbackDiagnostic,
  startFeedbackScreenTracking,
} from "@/lib/feedbackDiagnostics";
import { useIntl } from "react-intl";

export function GlobalErrorListeners() {
  const { role } = useAuth();
  const intl = useIntl();
  useEffect(() => startFeedbackScreenTracking(), []);
  useEffect(() => {
    const fallbackText = intl.formatMessage({
      id: role === "child" ? "core.error.runtime.child" : "core.error.runtime.formal",
    });
    const onError = (e: ErrorEvent) => {
      if (isNoiseError(e.error ?? e.message)) return;
      recordFeedbackDiagnostic({
        kind: "runtime",
        error: e.error ?? e.message,
        sourceFile: e.filename,
        sourceLine: e.lineno,
        sourceColumn: e.colno,
      });
      announceFallbackToast(fallbackText, "⚠️");
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      if (isNoiseError(e.reason)) return;
      recordFeedbackDiagnostic({ kind: "rejection", error: e.reason });
      announceFallbackToast(fallbackText, "⚠️");
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [intl, role]);
  return null;
}

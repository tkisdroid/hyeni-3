/**
 * React 컨텍스트 밖(전역 에러 핸들러·Query mutation 캐시)에서 토스트를 띄우는 브릿지.
 *
 * 원칙: 조용한 에러 금지 — 어떤 실패든 사용자에게 보이는 반응이 하나는 있어야 한다.
 * 다만 화면별 onError 가 이미 구체적 피드백을 줬다면 전역 폴백이 겹쳐 깜빡이면 안 되므로,
 * ToastProvider 가 "마지막 토스트 시각"을 여기 기록하고 폴백은 짧게 기다렸다가
 * 그 사이 아무 토스트도 없었을 때만 뜬다.
 */

export const GLOBAL_TOAST_EVENT = "hy-global-toast";

export type GlobalToastDetail = { text: string; emoji?: string };

let lastToastShownAtMs = 0;

/** ToastProvider.show() 가 호출 — 전역 폴백 취소 판단의 단일 근거. */
export function markToastShown(): void {
  lastToastShownAtMs = Date.now();
}

let lastAnnounceAtMs = 0;
const ANNOUNCE_THROTTLE_MS = 6_000;

/** 즉시 전역 토스트(스로틀 6s — 에러 폭주가 토스트 폭주가 되지 않게). */
export function announceGlobalToast(text: string, emoji?: string): boolean {
  if (typeof window === "undefined") return false;
  const now = Date.now();
  if (now - lastAnnounceAtMs < ANNOUNCE_THROTTLE_MS) return false;
  lastAnnounceAtMs = now;
  const detail: GlobalToastDetail = { text, emoji };
  window.dispatchEvent(new CustomEvent(GLOBAL_TOAST_EVENT, { detail }));
  return true;
}

/**
 * 지연 폴백 토스트 — delayMs 안에 다른 토스트(=화면의 구체적 피드백)가 떴으면 포기한다.
 * mutation 캐시의 전역 onError 는 mutate() 콜사이트 onError 를 알 수 없어서 이 방식이 필요하다.
 */
export function announceFallbackToast(text: string, emoji?: string, delayMs = 450): void {
  if (typeof window === "undefined") return;
  const errAtMs = Date.now();
  window.setTimeout(() => {
    if (lastToastShownAtMs > errAtMs) return;
    announceGlobalToast(text, emoji);
  }, delayMs);
}

/** 폴백을 띄울 가치가 없는 잡음인지(화면 전환 abort·관측 루프 경고 등). */
export function isNoiseError(reason: unknown): boolean {
  const name = (reason as { name?: unknown } | null)?.name;
  if (name === "AbortError") return true;
  const msg = String((reason as { message?: unknown } | null)?.message ?? reason ?? "").trim();
  if (!msg || msg === "null" || msg === "undefined") return true;
  if (/ResizeObserver loop/i.test(msg)) return true;
  if (/(signal is aborted|The user aborted a request|fetch is aborted)/i.test(msg)) return true;
  // 교차 출처 스크립트의 익명 에러 — 사용자가 할 수 있는 일이 없다.
  if (msg === "Script error.") return true;
  return false;
}

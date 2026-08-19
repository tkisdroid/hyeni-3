/**
 * 움직임 줄이기 설정 확인 — 화면마다 따로 두면 한쪽만 고쳐져 어긋난다.
 * matchMedia 가 없는 환경(구형 WebView·테스트)에서는 "줄이지 않음"으로 본다.
 */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * 새 버전을 적용하는 새로고침을 "언제" 실행할지 정하는 순수 판정(2026-08-18 TK 제보).
 *
 * 웹/PWA 는 브라우저 탭이라 새로고침이 익숙한 동작이지만, 네이티브 앱에서 화면이 스스로
 * 리프레시되면 앱이 튕긴 것처럼 보인다(실제 제보: 대화·설정 화면을 보는 중에 한 번씩 새로고침).
 * 그래서 네이티브에서는 사용자가 보고 있지 않을 때(백그라운드) 조용히 적용한다.
 * 적용하지 못한 새로고침은 coordinator 가 보류했다가 다음 신호에 다시 시도하고,
 * 그 전에 앱을 다시 켜면 이미 활성화된 Service Worker 로 새 버전이 뜬다.
 */
export interface PwaReloadTimingContext {
  /** Capacitor 네이티브 앱인지. */
  native: boolean;
  /** 현재 문서 가시성. */
  visibility: DocumentVisibilityState;
}

export function canReloadForPwaUpdateNow(context: PwaReloadTimingContext): boolean {
  if (!context.native) return true;
  return context.visibility === "hidden";
}

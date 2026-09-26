/**
 * 가벼운 촉각 피드백 — 탭 전환·아이 전환처럼 "선택이 바뀌었다"를 손끝으로 알리는 자리에만 쓴다.
 * 진동 API 가 없거나(데스크톱·iOS 웹) 막혀 있으면 조용히 아무것도 하지 않는다.
 * Android 앱은 매니페스트의 VIBRATE 권한으로 WebView 진동이 허용된다.
 */
export function selectionHaptic(): void {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(8);
  } catch {
    // 진동 실패는 사용 흐름에 영향이 없다.
  }
}

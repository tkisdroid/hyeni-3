/**
 * 오늘 화면잠금 해제 횟수 라벨.
 *
 * 네이티브가 KEYGUARD_HIDDEN(잠금 실제 해제)만 세서 보낸다 — 알림으로 화면이
 * 켜지기만 한 것은 포함되지 않는다("아이가 직접 열어 본 횟수", TK 2026-07-11).
 * 권한 없음/미보고(null·undefined)나 방어적으로 음수가 오면 가짜 숫자 대신 "—".
 */
export function unlockCountLabel(count: number | null | undefined): string {
  if (typeof count !== "number" || !Number.isInteger(count) || count < 0) return "—";
  return `${count}회`;
}

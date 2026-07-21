/**
 * 원격청취(주변 소리 듣기) 세션 상태의 epoch(ms) 필드 파서.
 *
 * 서버 계약(RemoteListenSessionStatusRow)은 이 값들을 `number | null` 로 준다.
 * 아직 동의/종료되지 않은 정상 세션은 consented_at_ms·capture_expires_at_ms·ended_at_ms 가 JSON null 이다.
 *
 * ⚠️ 함정(2026-07-22 실사고): `Number(null) === 0` 이므로 null 을 숫자로 강제하면
 *    미동의 세션의 endedAtMs 가 0(=유한값)으로 둔갑한다. 그러면 타이밍 resolver 의
 *    `finite(endedAtMs)` 가 true 가 되어 곧바로 phase="ended" 로 판정하고, 부모 화면이
 *    시작 몇 초 만에 "1분이 지나 듣기를 종료했어요" 로 세션을 닫는다(요청 시각 기준 조기 종료).
 *    따라서 null·undefined·비숫자는 반드시 null 로 남긴다(0 으로 강제 금지).
 */
export function parseRemoteListenMs(value: unknown): number | null {
  if (typeof value !== "number") return null;
  return Number.isFinite(value) && value >= 0 ? value : null;
}

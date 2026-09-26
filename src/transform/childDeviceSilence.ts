import { parseServerTimestamp } from "./locationView.ts";

/** 서버 "위치가 N분째 갱신되지 않아요" 알림(location_stale)과 같은 20분 기준. */
export const CHILD_DEVICE_SILENT_MS = 20 * 60 * 1000;

/**
 * 아이 폰이 위치도 기기 상태 보고도 보내지 않은 지 20분이 넘었으면 마지막 연락 시각을 돌려준다.
 *
 * 2026-09-26 실사례(razr): 성당 도착(18:55) 뒤 폰이 응답하지 않았고, 부모 Safari 화면은 "마지막 확인 · 2시간 전"만
 * 보여 줘서 "실시간이 안 된다"로 읽혔다. 서버·푸시는 정상 발송 중이었다 — 폰이 연결되지 않은 상태를 그대로 말한다.
 * 둘 중 하나라도 최근이면(위치만 멈춘 경우 등) 폰 연결 문제로 단정하지 않는다.
 */
export function childDeviceSilentSince(input: {
  locationUpdatedAt?: string | null;
  deviceReportedAt?: string | null;
  now: Date;
}): Date | null {
  const times = [input.locationUpdatedAt, input.deviceReportedAt]
    .map((value) => parseServerTimestamp(value ?? null))
    .filter((value): value is Date => value !== null);
  if (times.length === 0) return null;
  const latest = new Date(Math.max(...times.map((value) => value.getTime())));
  return input.now.getTime() - latest.getTime() >= CHILD_DEVICE_SILENT_MS ? latest : null;
}

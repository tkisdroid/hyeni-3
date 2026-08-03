export interface ChildSafetyNotificationCopy {
  title: string;
  message: string;
  urgent: boolean;
  ttlMs: number;
}

/**
 * 아이에게는 위험 상황만 알린다(2026-08-03 보호자 결정).
 *
 * 예전에는 도착·출발 같은 일상 이동도 아이 기기에 알렸다. 그런데 아이가 하루에도
 * 여러 번 울리는 알림 때문에 오히려 휴대폰을 더 자주 들여다보게 됐다. 아이의 일상
 * 움직임을 아이 본인에게 되돌려 알릴 실익이 없으므로 보내지 않는다.
 *
 * 부모 알림은 이 정책과 무관하게 그대로 간다 — 여기서 null을 돌려줘도
 * `sendChildSafetyNotification`이 성공으로 끝나고 부모 발송 경로는 건드리지 않는다.
 *
 * ⚠️ 도착·출발 유형을 다시 추가하지 말 것. 위험 구역과 SOS만 아이에게 남긴다.
 */
const DANGER_ENTRY_TYPES = new Set(["danger_zone", "danger_enter", "danger_entry"]);

export function childSafetyNotificationForAlert(
  alertType: string,
): ChildSafetyNotificationCopy | null {
  if (DANGER_ENTRY_TYPES.has(alertType)) {
    return {
      title: "위험 구역이야",
      message: "안전한 곳으로 이동하고 부모님께 연락해.",
      urgent: true,
      ttlMs: 15 * 60_000,
    };
  }
  if (alertType === "danger_exit") {
    return {
      title: "위험 구역에서 벗어났어",
      message: "지금 위치를 부모님께도 알려드렸어.",
      urgent: false,
      ttlMs: 2 * 60 * 60_000,
    };
  }
  return null;
}

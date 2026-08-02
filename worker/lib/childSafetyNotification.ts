export interface ChildSafetyNotificationCopy {
  title: string;
  message: string;
  urgent: boolean;
  ttlMs: number;
}

const ARRIVAL_TYPES = new Set(["arrived", "late_arrived", "place_arrived"]);
const REGISTERED_DEPARTURE_TYPES = new Set(["place_left"]);
const UNREGISTERED_DEPARTURE_TYPES = new Set(["unregistered_stay_left"]);
const DANGER_ENTRY_TYPES = new Set(["danger_zone", "danger_enter", "danger_entry"]);

export function childSafetyNotificationForAlert(
  alertType: string,
): ChildSafetyNotificationCopy | null {
  if (ARRIVAL_TYPES.has(alertType)) {
    return {
      title: "도착했어!",
      message: "도착이 확인됐어.",
      urgent: false,
      ttlMs: 2 * 60 * 60_000,
    };
  }
  if (REGISTERED_DEPARTURE_TYPES.has(alertType)) {
    return {
      title: "출발했어!",
      message: "등록한 장소에서 출발한 것이 확인됐어.",
      urgent: false,
      ttlMs: 2 * 60 * 60_000,
    };
  }
  if (UNREGISTERED_DEPARTURE_TYPES.has(alertType)) {
    return {
      title: "머물던 곳에서 출발했어",
      message: "위치 기록에서 출발한 것이 확인됐어.",
      urgent: false,
      ttlMs: 2 * 60 * 60_000,
    };
  }
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

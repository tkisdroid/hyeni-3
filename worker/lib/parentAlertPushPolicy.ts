const PARENT_PUSH_ALERT_TYPES = new Set([
  "sos", "emergency", "sos_followup",
  "not_arrived", "missed_arrival", "arrived", "late_arrived",
  "place_arrived", "place_left",
  "low_battery",
  "danger_zone", "danger_enter", "danger_entry", "danger_exit",
  // 아이가 AI 대화 횟수를 다 써서 부모에게 직접 부탁한 요청.
  // 앱을 열어 두지 않은 부모에게도 닿아야 아이가 기다리지 않는다.
  "ai_credit_request",
  // 프리미엄 보호자에게 하루 한 번 가는 아이 하루 대시보드.
  "child_daily_digest",
]);

const DANGER_ENTRY_ALERT_TYPES = new Set([
  "danger_zone",
  "danger_enter",
  "danger_entry",
]);

export function resolveParentAlertPushType(
  alertType: string,
  severity: string,
): {
  type: "sos" | "parent_alert";
  urgent: boolean;
  route: "/sos-receive" | "/notifications" | "/ai-credit" | "/child-digest";
} | null {
  if (!PARENT_PUSH_ALERT_TYPES.has(alertType)) return null;
  const normalizedSeverity = severity.trim().toLowerCase();
  // 크레딧 요청은 알림함을 거치지 않고 충전·한도 화면으로 바로 보낸다.
  // 부모가 알림을 탭한 순간이 아이를 다시 이야기하게 해 줄 수 있는 시점이다.
  if (alertType === "ai_credit_request") {
    return { type: "parent_alert", urgent: false, route: "/ai-credit" };
  }
  // 하루 대시보드는 알림함이 아니라 그 아이의 대시보드 화면을 연다.
  if (alertType === "child_daily_digest") {
    return { type: "parent_alert", urgent: false, route: "/child-digest" };
  }
  const isSos = alertType === "sos" || alertType === "emergency" || alertType === "sos_followup";
  const urgent = alertType === "danger_exit"
    ? false
    : isSos
      || DANGER_ENTRY_ALERT_TYPES.has(alertType)
      || ["emergency", "critical", "urgent"].includes(normalizedSeverity);
  return {
    type: isSos ? "sos" : "parent_alert",
    urgent,
    route: isSos ? "/sos-receive" : "/notifications",
  };
}

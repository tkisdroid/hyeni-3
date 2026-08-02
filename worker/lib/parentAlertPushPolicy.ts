const PARENT_PUSH_ALERT_TYPES = new Set([
  "sos", "emergency", "sos_followup",
  "not_arrived", "missed_arrival", "arrived", "late_arrived",
  "place_arrived", "place_left",
  "low_battery",
  "danger_zone", "danger_enter", "danger_entry", "danger_exit",
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
  route: "/sos-receive" | "/notifications";
} | null {
  if (!PARENT_PUSH_ALERT_TYPES.has(alertType)) return null;
  const normalizedSeverity = severity.trim().toLowerCase();
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

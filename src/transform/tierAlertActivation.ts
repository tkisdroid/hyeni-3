export type TierAlertActivationState = "active" | "premium_required" | "unknown";

interface TierAlertActivationPayload {
  tier_alert_active?: unknown;
  tier_alert_inactive_reason?: unknown;
}

/** 서버가 함께 내려준 활성 여부와 사유가 서로 일치할 때만 확정 상태로 사용한다. */
export function parseTierAlertActivation(value: unknown): TierAlertActivationState {
  if (!value || typeof value !== "object") return "unknown";
  const payload = value as TierAlertActivationPayload;

  if (payload.tier_alert_active === true && payload.tier_alert_inactive_reason === null) {
    return "active";
  }
  if (
    payload.tier_alert_active === false
    && payload.tier_alert_inactive_reason === "premium_required"
  ) {
    return "premium_required";
  }
  return "unknown";
}

export function tierAlertActivationLabel(state: TierAlertActivationState): string {
  switch (state) {
    case "active":
      return "플랜 한도 안 · 알림 설정 가능";
    case "premium_required":
      return "저장됨 · 프리미엄에서 알림 대상";
    default:
      return "플랜 알림 대상 확인 필요";
  }
}

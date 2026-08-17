import type { IntlShape } from "react-intl";
import { withDefaultIntl } from "../i18n/defaultIntl.ts";

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

export function tierAlertActivationLabel(
  state: TierAlertActivationState,
  providedIntl?: IntlShape,
): string {
  const intl = withDefaultIntl(providedIntl);
  switch (state) {
    case "active":
      return intl.formatMessage({ id: "notifications.place.alert.active" });
    case "premium_required":
      return intl.formatMessage({ id: "notifications.place.alert.premiumRequired" });
    default:
      return intl.formatMessage({ id: "notifications.place.alert.unknown" });
  }
}

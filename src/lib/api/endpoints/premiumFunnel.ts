import { apiRequest } from "../client";
import type { PremiumFunnelTransportEvent } from "../../premiumFunnel";

interface PremiumFunnelResponse {
  ok: boolean;
  accepted: number;
  duplicates: number;
}

/** 인증 회전 없이 보내는 분석 전용 요청. 실패는 호출부의 메모리 큐에서만 처리한다. */
export async function submitPremiumFunnelEvents(
  events: readonly PremiumFunnelTransportEvent[],
): Promise<void> {
  const response = await apiRequest<PremiumFunnelResponse>(
    "/api/premium-funnel/events",
    { method: "POST", body: JSON.stringify({ events }) },
    false,
  );
  if (response.ok !== true) throw new Error("premium_funnel_not_accepted");
}

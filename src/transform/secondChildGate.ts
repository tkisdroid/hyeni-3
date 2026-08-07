import { maxChildrenFor, TIERS, type Tier } from "./tierPolicy.ts";

export type ChildAddGateStatus =
  | "unavailable"
  | "allowed"
  | "premium_required"
  | "limit_reached";

export interface ChildAddGateInput {
  ready: boolean;
  isError: boolean;
  tier: Tier;
  activeChildCount: number;
  requestedChildCount: number;
}

export interface ChildAddGateDecision {
  status: ChildAddGateStatus;
  maxChildren: number;
  remainingSlots: number;
  projectedChildCount: number;
}

/**
 * 활성 자녀 수와 확정 티어를 기준으로 서버 변경 전에 추가 가능 여부를 판정한다.
 * 미확정·오류·잘못된 수는 모두 unavailable로 닫는다.
 */
export function resolveChildAddGate(input: ChildAddGateInput): ChildAddGateDecision {
  const validCounts = Number.isInteger(input.activeChildCount)
    && input.activeChildCount >= 0
    && Number.isInteger(input.requestedChildCount)
    && input.requestedChildCount > 0;
  if (!input.ready || input.isError || input.tier === TIERS.UNKNOWN || !validCounts) {
    return {
      status: "unavailable",
      maxChildren: 0,
      remainingSlots: 0,
      projectedChildCount: input.activeChildCount,
    };
  }

  const maxChildren = maxChildrenFor(input.tier);
  const premiumMaxChildren = maxChildrenFor(TIERS.PREMIUM);
  const projectedChildCount = input.activeChildCount + input.requestedChildCount;
  const remainingSlots = Math.max(0, maxChildren - input.activeChildCount);

  if (projectedChildCount <= maxChildren) {
    return { status: "allowed", maxChildren, remainingSlots, projectedChildCount };
  }

  if (input.tier !== TIERS.PREMIUM && projectedChildCount <= premiumMaxChildren) {
    return { status: "premium_required", maxChildren, remainingSlots, projectedChildCount };
  }

  return { status: "limit_reached", maxChildren, remainingSlots, projectedChildCount };
}

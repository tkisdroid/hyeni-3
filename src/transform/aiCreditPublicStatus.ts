/**
 * 부모와 아이가 함께 읽는 AI 대화 가능 횟수의 공개 계약.
 * 구매 크레딧은 잔액을 노출하지 않고 보유 여부만 전달한다.
 */
export interface AiCreditPublicStatus {
  isPremium: boolean;
  dailyIncludedLimit: number;
  dailyIncludedUsed: number;
  dailyResetDate: string;
  hasPurchasedCredits: boolean;
  parentDailyUsed: number;
  parentDailyLimit: number;
  availableRemaining: number;
}

export const FREE_AI_DAILY_INCLUDED_LIMIT = 5;
export const PREMIUM_AI_DAILY_INCLUDED_LIMIT = 20;

export type AiLimitExhaustionReason =
  | "parent_safety_limit"
  | "free_included_limit"
  | "premium_allowance_limit"
  | "unknown";

/** 서버가 한도 소진을 확정했을 때 상업 포함량과 부모 안전 상한을 구분한다. */
export function resolveAiLimitExhaustionReason(
  status: Pick<AiCreditPublicStatus, "isPremium" | "dailyIncludedLimit" | "parentDailyLimit"> | null | undefined,
): AiLimitExhaustionReason {
  if (!status) return "unknown";
  if (status.parentDailyLimit < status.dailyIncludedLimit) return "parent_safety_limit";
  return status.isPremium ? "premium_allowance_limit" : "free_included_limit";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** 티어 확인 자체가 실패한 상태에서는 Free 숫자도 임의로 만들지 않는다. */
export function aiIncludedDailyLimitForExplicitTier(
  isPremium: boolean | null | undefined,
): number | null {
  if (typeof isPremium !== "boolean") return null;
  return isPremium ? PREMIUM_AI_DAILY_INCLUDED_LIMIT : FREE_AI_DAILY_INCLUDED_LIMIT;
}

/**
 * Worker snake_case 응답을 화면용 타입으로 바꾼다.
 * 문자열 숫자나 일부 필드 누락을 허용하면 잘못된 잔여 횟수가 결제·대화 화면에 남으므로
 * 모든 필드와 서버가 보장하는 산술 불변식을 확인한 경우에만 값을 반환한다.
 */
export function normalizeAiCreditPublicStatusPayload(
  value: unknown,
): AiCreditPublicStatus | null {
  if (!isRecord(value) || typeof value.is_premium !== "boolean") return null;

  const dailyIncludedLimit = value.daily_included_limit;
  const dailyIncludedUsed = value.daily_included_used;
  const purchasedCredits = value.purchased_credits;
  const parentDailyUsed = value.parent_daily_used;
  const parentDailyLimit = value.parent_daily_limit;
  const availableRemaining = value.available_remaining;

  if (
    !isNonNegativeSafeInteger(dailyIncludedLimit)
    || dailyIncludedLimit === 0
    || !isNonNegativeSafeInteger(dailyIncludedUsed)
    || dailyIncludedUsed > dailyIncludedLimit
    || !isDateKey(value.daily_reset_date)
    || (purchasedCredits !== 0 && purchasedCredits !== 1)
    || !isNonNegativeSafeInteger(parentDailyUsed)
    || !isNonNegativeSafeInteger(parentDailyLimit)
    || !isNonNegativeSafeInteger(availableRemaining)
  ) {
    return null;
  }

  const parentDailyRemaining = Math.max(0, parentDailyLimit - parentDailyUsed);
  const dailyIncludedRemaining = dailyIncludedLimit - dailyIncludedUsed;
  if (availableRemaining > parentDailyRemaining) return null;
  if (purchasedCredits === 0 && availableRemaining > dailyIncludedRemaining) return null;

  return {
    isPremium: value.is_premium,
    dailyIncludedLimit,
    dailyIncludedUsed,
    dailyResetDate: value.daily_reset_date,
    hasPurchasedCredits: purchasedCredits === 1,
    parentDailyUsed,
    parentDailyLimit,
    availableRemaining,
  };
}

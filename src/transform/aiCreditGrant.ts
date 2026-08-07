export type AiCreditGrantImpact = {
  debtApplied: number;
  availableCreditsAdded: number;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** 결제 서버가 확정한 상계량과 실제 사용 가능 증가량이 팩 총량과 정확히 맞을 때만 받는다. */
export function validateAiCreditGrantImpact(
  value: unknown,
  expectedCredits: number,
): AiCreditGrantImpact {
  const row = record(value);
  if (
    !Number.isSafeInteger(expectedCredits)
    || expectedCredits <= 0
    || !row
    || !Number.isSafeInteger(row.debtApplied)
    || Number(row.debtApplied) < 0
    || !Number.isSafeInteger(row.availableCreditsAdded)
    || Number(row.availableCreditsAdded) < 0
    || Number(row.debtApplied) + Number(row.availableCreditsAdded) !== expectedCredits
  ) throw new Error("invalid_ai_credit_grant_impact");
  return {
    debtApplied: Number(row.debtApplied),
    availableCreditsAdded: Number(row.availableCreditsAdded),
  };
}

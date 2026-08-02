export const MAX_DAILY_SUPPLY_ITEMS_PER_KIND = 8;

/**
 * 최신 앱의 compact JSON 체크리스트만 항목 수를 검사한다.
 * 과거 버전의 쉼표 평문은 기존 호환을 위해 그대로 허용한다.
 */
export function exceedsDailySupplyItemLimit(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const raw = value.trim();
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) && parsed.length > MAX_DAILY_SUPPLY_ITEMS_PER_KIND;
  } catch {
    return false;
  }
}

/** 여러 원본을 함께 표시할 때 모두 확인된 가장 오래된 시각을 사용한다. */
export function confirmedDataTimestamp(...timestamps: number[]): Date | null {
  if (!timestamps.length || timestamps.some((value) => !Number.isFinite(value) || value <= 0)) return null;
  return new Date(Math.min(...timestamps));
}

export type DaySummaryScope = readonly [familyId: string, childUserId: string, date: string];
export interface ScopedDaySummary<T> { scope: DaySummaryScope; value: T }

/** 늦게 도착한 응답도 현재 화면의 가족·아이·날짜와 맞을 때만 표시한다. */
export function scopedDaySummary<T>(result: ScopedDaySummary<T> | null, scope: DaySummaryScope): T | null {
  return result && result.scope.every((value, index) => value === scope[index]) ? result.value : null;
}

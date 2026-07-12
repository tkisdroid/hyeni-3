import { addDaysToDateKey, dateToDateKey, parseAppDateKey } from "./dateKey";

export type WeekdayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type RepeatMode = "없음" | "매일" | "매주" | "매월" | "요일";
export interface EventLocationValue {
  lat?: number;
  lng?: number;
  address?: string;
}

export const WEEKDAY_OPTIONS: ReadonlyArray<{ value: WeekdayIndex; label: string }> = [
  { value: 1, label: "월" },
  { value: 2, label: "화" },
  { value: 3, label: "수" },
  { value: 4, label: "목" },
  { value: 5, label: "금" },
  { value: 6, label: "토" },
  { value: 0, label: "일" },
];

const WEEKDAY_REPEAT_DAYS = 8 * 7;

function isWeekdayIndex(value: number): value is WeekdayIndex {
  return Number.isInteger(value) && value >= 0 && value <= 6;
}

function normalizedWeekdays(weekdays: readonly WeekdayIndex[]): Set<WeekdayIndex> {
  const out = new Set<WeekdayIndex>();
  for (const day of weekdays) {
    if (isWeekdayIndex(day)) out.add(day);
  }
  return out;
}

/** 반복 설정을 서버 저장용 개별 date_key 목록으로 확장한다. */
export function buildOccurrenceDateKeys(
  baseDateKey: string,
  repeat: RepeatMode,
  weekdays: readonly WeekdayIndex[] = [],
): string[] {
  if (repeat === "매일") return Array.from({ length: 14 }, (_, i) => addDaysToDateKey(baseDateKey, i));
  if (repeat === "매주") return Array.from({ length: 8 }, (_, i) => addDaysToDateKey(baseDateKey, i * 7));
  if (repeat === "매월") {
    const base = parseAppDateKey(baseDateKey);
    if (!base) return [baseDateKey];
    const baseDay = base.getDate();
    return Array.from({ length: 6 }, (_, i) => {
      const targetYear = base.getFullYear();
      const targetMonth = base.getMonth() + i;
      const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate();
      return dateToDateKey(new Date(targetYear, targetMonth, Math.min(baseDay, lastDay)));
    });
  }
  if (repeat === "요일") {
    const base = parseAppDateKey(baseDateKey);
    const selected = normalizedWeekdays(weekdays);
    if (!base || selected.size === 0) return [baseDateKey];
    const keys: string[] = [];
    for (let i = 0; i < WEEKDAY_REPEAT_DAYS; i += 1) {
      const date = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
      if (selected.has(date.getDay() as WeekdayIndex)) keys.push(dateToDateKey(date));
    }
    return keys.length > 0 ? keys : [baseDateKey];
  }
  return [baseDateKey];
}

export function buildEventLocation(
  place: string,
  coord: { lat: number; lng: number } | null,
): EventLocationValue | null {
  const address = place.trim();
  const hasCoord =
    coord !== null && Number.isFinite(coord.lat) && Number.isFinite(coord.lng);
  if (!address && !hasCoord) return null;
  return {
    address: address || "지도에서 선택한 위치",
    ...(hasCoord ? { lat: coord.lat, lng: coord.lng } : {}),
  };
}

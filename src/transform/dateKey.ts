/**
 * 일정 date_key 처리(hyeni-1 scheduleDateRange.js 정확 이관).
 *
 * ⚠️ 함정: date_key = `${year}-${monthIndex}-${day}` 에서 **monthIndex 는 0-indexed**,
 * 비패딩이다. 즉 "2026-7-5" = getMonth()===7 = **8월** 5일(7월 아님).
 * 직접 문자열 조립 금지 — 반드시 이 모듈 경유.
 */

/** "YYYY-monthIndex0-D"(0-indexed 월) → Date. 무효 시 null. */
export function parseAppDateKey(dateKey: string): Date | null {
  if (typeof dateKey !== "string") return null;
  const parts = dateKey.split("-").map(Number);
  if (parts.length !== 3 || parts.some((p) => !Number.isFinite(p))) return null;
  const [year, monthIndex, day] = parts;
  const date = new Date(year, monthIndex, day);
  if (date.getFullYear() !== year || date.getMonth() !== monthIndex || date.getDate() !== day) {
    return null;
  }
  return date;
}

/** Date → "YYYY-monthIndex0-D"(0-indexed 월, 비패딩). */
export function dateToDateKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** (year, month1based, day) → date_key. 컴포넌트의 1-indexed 월을 0-indexed 로 변환. */
export function ymdToDateKey(year: number, month1based: number, day: number): string {
  return `${year}-${month1based - 1}-${day}`;
}

/** date_key → <input type=date> 값 "YYYY-MM-DD"(1-indexed 패딩). */
export function dateKeyToDateInputValue(dateKey: string): string {
  const date = parseAppDateKey(dateKey);
  if (!date) return "";
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

/** <input type=date> 값 "YYYY-MM-DD" → date_key(0-indexed 월). 무효 시 null. */
export function dateInputValueToDateKey(value: string): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return dateToDateKey(date);
}

/** date_key 에 days 를 더한 새 date_key. */
export function addDaysToDateKey(dateKey: string, days: number): string {
  const date = parseAppDateKey(dateKey);
  const offset = Number(days);
  if (!date || !Number.isFinite(offset)) return dateKey;
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset);
  return dateToDateKey(next);
}

/** 오늘의 date_key. */
export function todayDateKey(now: Date = new Date()): string {
  return dateToDateKey(now);
}

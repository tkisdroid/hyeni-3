/** 서버와 화면이 공유하는 IANA 시간대 계산. 저장 timestamp는 UTC를 유지한다. */
export const LEGACY_TIME_ZONE = "Asia/Seoul";
const formatters = new Map<string, Intl.DateTimeFormat>();
const wallTimeCache = new Map<string, number>();

export function normalizeTimeZone(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 100) return null;
  const zone = value.trim();
  if (zone !== "UTC" && !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)+$/.test(zone)) return null;
  try { return new Intl.DateTimeFormat("en", { timeZone: zone }).resolvedOptions().timeZone; }
  catch { return null; }
}

export function localDateTimeParts(atMs: number, timeZone: string) {
  if (!Number.isFinite(atMs)) throw new Error("invalid_timestamp");
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    if (!normalizeTimeZone(timeZone)) throw new Error("invalid_time_zone");
    formatter = new Intl.DateTimeFormat("en-CA-u-ca-gregory-nu-latn", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    });
    if (formatters.size >= 512) formatters.clear();
    formatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(new Date(atMs));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

export function appDateKeyAt(atMs: number, timeZone: string): string {
  const p = localDateTimeParts(atMs, timeZone);
  return `${p.year}-${p.month - 1}-${p.day}`;
}

export function isoDateAt(atMs: number, timeZone: string): string {
  const p = localDateTimeParts(atMs, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function minuteOfDayInTimeZone(atMs: number, timeZone: string): number {
  const p = localDateTimeParts(atMs, timeZone);
  return p.hour * 60 + p.minute;
}

function calendarEpoch(dateKey: string): number {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(dateKey);
  if (!match) throw new Error("invalid_date_key");
  const [year, month, day] = match.slice(1).map(Number);
  const value = Date.UTC(year, month, day);
  const check = new Date(value);
  if (year < 1000 || check.getUTCFullYear() !== year || check.getUTCMonth() !== month || check.getUTCDate() !== day) throw new Error("invalid_date_key");
  return value;
}

export function addCalendarDays(dateKey: string, days: number): string {
  const d = new Date(calendarEpoch(dateKey) + days * 86_400_000);
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

/** DST 중복 시각은 첫 발생, 존재하지 않는 시각은 전환 간격만큼 뒤로 옮긴다(compatible). */
export function wallTimeToEpoch(dateKey: string, minute: number, timeZone: string): number {
  if (!Number.isInteger(minute)) throw new Error("invalid_wall_time");
  const key = `${timeZone}|${dateKey}|${minute}`;
  const cached = wallTimeCache.get(key);
  if (cached !== undefined) return cached;
  const remember = (epoch: number) => {
    if (wallTimeCache.size >= 4096) wallTimeCache.clear();
    wallTimeCache.set(key, epoch);
    return epoch;
  };
  const desired = calendarEpoch(dateKey) + minute * 60_000;
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    const sample = desired + hours * 3_600_000;
    const p = localDateTimeParts(sample, timeZone);
    offsets.add(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - sample);
  }
  const candidates = [...offsets].map(offset => {
    const epoch = desired - offset;
    const p = localDateTimeParts(epoch, timeZone);
    return { epoch, difference: Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - desired };
  });
  const exact = candidates.filter(c => c.difference === 0).sort((a, b) => a.epoch - b.epoch);
  if (exact.length) return remember(exact[0].epoch);
  const later = candidates.filter(c => c.difference > 0).sort((a, b) => a.difference - b.difference);
  if (!later.length) throw new Error("invalid_wall_time");
  return remember(later[0].epoch);
}

export function dayWindowAt(atMs: number, timeZone: string, boundaryMinute = 0) {
  let dateKey = appDateKeyAt(atMs, timeZone);
  if (wallTimeToEpoch(dateKey, boundaryMinute, timeZone) > atMs) dateKey = addCalendarDays(dateKey, -1);
  return {
    dateKey,
    startMs: wallTimeToEpoch(dateKey, boundaryMinute, timeZone),
    endMs: wallTimeToEpoch(addCalendarDays(dateKey, 1), boundaryMinute, timeZone),
  };
}

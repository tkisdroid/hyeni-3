export type LocationIntervalMode = "live" | "balanced" | "saver";

const VALID_INTERVALS = new Set<LocationIntervalMode>(["live", "balanced", "saver"]);

export function normalizeLocationIntervalMode(raw: unknown): LocationIntervalMode {
  const value = typeof raw === "string" ? raw.trim() : "";
  return VALID_INTERVALS.has(value as LocationIntervalMode)
    ? (value as LocationIntervalMode)
    : "balanced";
}

/** Free·reviewed는 최고 빈도 전송을 쓰지 않고, Premium만 live를 유지한다. */
export function effectiveLocationIntervalMode(
  raw: unknown,
  isPremium: boolean,
): LocationIntervalMode {
  const normalized = normalizeLocationIntervalMode(raw);
  return normalized === "live" && !isPremium ? "balanced" : normalized;
}

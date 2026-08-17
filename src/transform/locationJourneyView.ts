export interface JourneyRecordedRange {
  startMs: number;
  endMs: number;
}

export type JourneyContentState = "loading" | "error" | "empty" | "moving_only" | "ready";

export function getJourneyRecordedRange(
  points: readonly { ms: number }[],
): JourneyRecordedRange | null {
  const times = points.map((point) => point.ms).filter(Number.isFinite).sort((a, b) => a - b);
  const startMs = times.at(0);
  const endMs = times.at(-1);
  return startMs == null || endMs == null ? null : { startMs, endMs };
}

/** 사용자가 고른 시각을 실제 위치 기록이 존재하는 구간 안으로 제한한다. */
export function clampJourneyScrubMs(
  value: number,
  range: JourneyRecordedRange,
): number {
  if (!Number.isFinite(value)) return range.endMs;
  return Math.min(range.endMs, Math.max(range.startMs, value));
}

export function resolveJourneyContentState(input: {
  isFetching: boolean;
  isError: boolean;
  pointCount: number;
  stayCount: number;
}): JourneyContentState {
  if (input.isError) return "error";
  if (input.isFetching && input.pointCount === 0) return "loading";
  if (input.pointCount === 0) return "empty";
  if (input.stayCount === 0) return "moving_only";
  return "ready";
}

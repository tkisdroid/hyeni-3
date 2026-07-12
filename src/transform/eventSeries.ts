import { parseAppDateKey } from "./dateKey";

export interface SeriesEvent {
  id: string;
  series_id?: string | null;
  date_key: string;
  title?: string | null;
  time?: string | null;
  end_time?: string | null;
  category?: string | null;
  emoji?: string | null;
  memo?: string | null;
  location?: unknown;
  notif_override?: unknown;
  is_family_event?: boolean;
  events_children?: ReadonlyArray<{ child_id?: string }>;
}

export type SeriesEditScope = "single" | "future";

function dateKeyMs(dateKey: string): number {
  return parseAppDateKey(dateKey)?.getTime() ?? Number.NaN;
}

export function findFutureSeriesEvents<T extends SeriesEvent>(
  events: readonly T[],
  seed: T,
): T[] {
  const anchorMs = dateKeyMs(seed.date_key);
  const seriesId = typeof seed.series_id === "string" ? seed.series_id.trim() : "";
  if (!seriesId) {
    const existing = events.find((event) => event.id === seed.id);
    return [existing ?? seed];
  }
  return events
    .filter((event) => {
      const eventMs = dateKeyMs(event.date_key);
      if (!Number.isFinite(anchorMs) || !Number.isFinite(eventMs) || eventMs < anchorMs) return false;
      return event.series_id === seriesId;
    })
    .sort((a, b) => (dateKeyMs(a.date_key) || 0) - (dateKeyMs(b.date_key) || 0));
}

export function resolveSeriesEditTargets<T extends SeriesEvent>(
  events: readonly T[],
  seed: T,
  scope: SeriesEditScope,
): T[] {
  if (scope === "future") return findFutureSeriesEvents(events, seed);
  const existing = events.find((event) => event.id === seed.id);
  return [existing ?? seed];
}

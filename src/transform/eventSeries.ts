import { parseAppDateKey } from "./dateKey";

export interface SeriesEvent {
  id: string;
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

function stableString(value: unknown): string {
  if (value == null) return "";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableString).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableString(record[key])}`)
    .join(",")}}`;
}

function childKey(event: SeriesEvent): string {
  return (event.events_children ?? [])
    .map((row) => (typeof row.child_id === "string" ? row.child_id.trim() : ""))
    .filter(Boolean)
    .sort()
    .join("|");
}

function seriesSignature(event: SeriesEvent): string {
  return [
    event.title ?? "",
    event.time ?? "",
    event.end_time ?? "",
    event.category ?? "",
    event.emoji ?? "",
    event.memo ?? "",
    stableString(event.location),
    stableString(event.notif_override),
    event.is_family_event === true ? "family" : "child",
    childKey(event),
  ].join("\u001f");
}

function dateKeyMs(dateKey: string): number {
  return parseAppDateKey(dateKey)?.getTime() ?? Number.NaN;
}

export function findFutureSeriesEvents<T extends SeriesEvent>(
  events: readonly T[],
  seed: SeriesEvent,
): T[] {
  const anchorMs = dateKeyMs(seed.date_key);
  const signature = seriesSignature(seed);
  return events
    .filter((event) => {
      if (event.id === seed.id) return true;
      const eventMs = dateKeyMs(event.date_key);
      if (!Number.isFinite(anchorMs) || !Number.isFinite(eventMs) || eventMs < anchorMs) return false;
      return seriesSignature(event) === signature;
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

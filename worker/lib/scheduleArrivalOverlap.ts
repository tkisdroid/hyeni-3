import { appDateKeyAt, wallTimeToEpoch } from "./timeZone.ts";
export const SCHEDULE_ARRIVAL_OVERLAP_RADIUS_M = 80;
export const SCHEDULE_ARRIVAL_OVERLAP_WINDOW_MS = 60 * 60_000;
export const SCHEDULE_ARRIVAL_EARLY_WINDOW_MS = 15 * 60_000;
const EARTH_RADIUS_M = 6_371_000;

export interface ScheduleArrivalCandidate {
  eventId: string;
  dateKey?: string;
  startAtMs: number;
  lat: number;
  lng: number;
  occurrenceId?: string;
  title?: string;
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

export function hasScheduleArrivalOverlap(
  place: { lat: number; lng: number },
  atMs: number,
  events: readonly ScheduleArrivalCandidate[],
  radiusM = SCHEDULE_ARRIVAL_OVERLAP_RADIUS_M,
  windowMs = SCHEDULE_ARRIVAL_OVERLAP_WINDOW_MS,
): boolean {
  return findScheduleArrivalOverlap(place, atMs, events, radiusM, windowMs) != null;
}

export function findScheduleArrivalOverlap(
  place: { lat: number; lng: number },
  atMs: number,
  events: readonly ScheduleArrivalCandidate[],
  radiusM = SCHEDULE_ARRIVAL_OVERLAP_RADIUS_M,
  windowMs = SCHEDULE_ARRIVAL_OVERLAP_WINDOW_MS,
): ScheduleArrivalCandidate | null {
  if (![place.lat, place.lng, atMs, radiusM, windowMs].every(Number.isFinite)) return null;
  if (radiusM < 0 || windowMs < 0) return null;
  const earlyWindowMs = Math.min(SCHEDULE_ARRIVAL_EARLY_WINDOW_MS, windowMs);
  return nearestCandidate(place, atMs, events, radiusM, (event) => {
    const minutesFromStartMs = atMs - event.startAtMs;
    return minutesFromStartMs >= -earlyWindowMs && minutesFromStartMs <= windowMs;
  });
}

/**
 * 너무 이른 도착을 일정 도착으로 단정하지 않으면서도 같은 장소의 occurrence를
 * 연결하기 위한 보조 조회다. 연결된 일반 장소 도착은 이후 일정 도착과 같은 멱등키를 쓴다.
 */
export function findNearbyScheduleAtPlace(
  place: { lat: number; lng: number },
  atMs: number,
  events: readonly ScheduleArrivalCandidate[],
  radiusM = SCHEDULE_ARRIVAL_OVERLAP_RADIUS_M,
  windowMs = SCHEDULE_ARRIVAL_OVERLAP_WINDOW_MS,
): ScheduleArrivalCandidate | null {
  if (![place.lat, place.lng, atMs, radiusM, windowMs].every(Number.isFinite)) return null;
  if (radiusM < 0 || windowMs < 0) return null;
  return nearestCandidate(
    place,
    atMs,
    events,
    radiusM,
    (event) => Math.abs(event.startAtMs - atMs) <= windowMs,
  );
}

function nearestCandidate(
  place: { lat: number; lng: number },
  atMs: number,
  events: readonly ScheduleArrivalCandidate[],
  radiusM: number,
  inTimeWindow: (event: ScheduleArrivalCandidate) => boolean,
): ScheduleArrivalCandidate | null {
  const candidates = events.filter((event) =>
    [event.startAtMs, event.lat, event.lng].every(Number.isFinite)
      && inTimeWindow(event)
      && haversineM(place.lat, place.lng, event.lat, event.lng) <= radiusM,
  );
  candidates.sort((a, b) => {
    const distanceA = Math.abs(a.startAtMs - atMs);
    const distanceB = Math.abs(b.startAtMs - atMs);
    if (distanceA !== distanceB) return distanceA - distanceB;
    if (a.startAtMs !== b.startAtMs) return a.startAtMs - b.startAtMs;
    return a.eventId.localeCompare(b.eventId);
  });
  return candidates[0] ?? null;
}

export function buildScheduledArrivalAlert(
  childName: string,
  event: ScheduleArrivalCandidate,
): { alertType: "arrived"; severity: "info"; title: string; message: string } {
  const eventTitle = event.title?.trim() || "일정";
  return {
    alertType: "arrived",
    severity: "info",
    title: `✅ ${eventTitle} 도착`,
    message: `${childName}님이 ${eventTitle} 장소에 도착했어요.`,
  };
}

export function scheduleWindowDateKeys(
  atMs: number,
  windowMs = SCHEDULE_ARRIVAL_OVERLAP_WINDOW_MS,
  timeZone = "Asia/Seoul",
): string[] {
  return [...new Set([atMs - windowMs, atMs, atMs + windowMs].map(ms => appDateKeyAt(ms, timeZone)))];
}

export function eventStartAtMs(dateKey: string, time: string, timeZone = "Asia/Seoul"): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
  try { return wallTimeToEpoch(dateKey, Number(match[1]) * 60 + Number(match[2]), timeZone); }
  catch { return null; }
}

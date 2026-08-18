/**
 * 지난 일정 "다녀옴" 위치 검증(순수).
 * 이벤트 좌표와 아이 위치 이력을 대조해, 일정 시간대에 실제로 그 장소 근처에
 * 있었을 때만 "다녀옴"으로 확정한다. 확인되지 않으면 "확인 필요"로 정직하게 표시
 * (시간만 지났다고 다녀옴 처리하지 않음 — TK 제보 2026-07-06).
 *
 * 좌표가 없지만 장소명/주소가 있는 일정은 방문 확인이 불가능하므로 "확인 필요"로 둔다.
 * 장소가 아예 없는 일정은 위치 검증 대상이 아니어서 기존 시간 기반 표시를 유지한다.
 */
import type { CalendarEvent } from "@/lib/api/endpoints/schedule";
import type { LocationHistoryPoint } from "@/lib/api/endpoints/location";
import { parseAppDateKey } from "./dateKey.ts";
import { eventChildMemberIds, eventIsFamilyShared } from "./eventScope.ts";
import { isReliableLocationEvidence } from "./locationAccuracy.ts";

export type VisitVerdict = "visited" | "unverified";
export type VisitChildScope = string | null | ReadonlyMap<string, string>;

/** 도착 인정 반경(m) — GPS 오차·시설 규모 고려해 서버 미도착(50m)보다 관대하게. */
export const VISIT_RADIUS_M = 200;
/** 일정 장소 체류 인정 비율. 시작~종료 구간의 80% 이상 머물러야 "다녀옴". */
export const VISIT_REQUIRED_COVERAGE = 0.8;
/** 위치 샘플 간격이 이보다 길면 중간 체류를 보수적으로 인정하지 않는다. */
const VISIT_MAX_SAMPLE_GAP_MS = 12 * 60_000;

interface NormalizedPoint {
  user_id: string;
  lat: number;
  lng: number;
  t: number;
}

function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function timeToMinutes(time: string | null | undefined): number | null {
  if (!time || !/^\d{1,2}:\d{2}$/.test(time)) return null;
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** 이벤트의 실제 [시작, 종료] epoch ms. 종료가 없으면 60분으로 둔다. */
function eventWindow(event: CalendarEvent): { startMs: number; endMs: number; durationMs: number } | null {
  const date = parseAppDateKey(event.date_key);
  const startMin = timeToMinutes(event.time);
  if (!date || startMin == null) return null;
  const endMinRaw = timeToMinutes(event.end_time);
  const endMin = endMinRaw == null ? startMin + 60 : endMinRaw <= startMin ? endMinRaw + 24 * 60 : endMinRaw;
  const base = date.getTime();
  const startMs = base + startMin * 60_000;
  const endMs = base + endMin * 60_000;
  return {
    startMs,
    endMs,
    durationMs: Math.max(0, endMs - startMs),
  };
}

// D1 recorded_at '2026-07-06 02:43:46.956739+00' 또는 ISO — 둘 다 UTC 로 파싱.
function recordedAtMs(raw: string): number {
  const t = new Date(raw.includes("T") ? raw : raw.replace(" ", "T").replace("+00", "Z")).getTime();
  return Number.isFinite(t) ? t : NaN;
}

function hasLocationLabel(event: CalendarEvent): boolean {
  return typeof event.location?.address === "string" && event.location.address.trim().length > 0;
}

function scopeForEvent(event: CalendarEvent, childScope: VisitChildScope): Set<string> | null {
  if (typeof childScope === "string") return childScope.trim() ? new Set([childScope]) : null;
  if (!childScope) return null;

  const assignedMemberIds = eventChildMemberIds(event);
  if (!eventIsFamilyShared(event) && assignedMemberIds.length === 0) return new Set();
  const source = eventIsFamilyShared(event)
    ? Array.from(childScope.values())
    : assignedMemberIds.map((id) => childScope.get(id));
  const userIds = source.filter((id): id is string => typeof id === "string" && id.length > 0);
  return userIds.length > 0 ? new Set(userIds) : new Set();
}

export function estimateVisitCoverage(
  event: CalendarEvent,
  points: NormalizedPoint[],
): { dwellMs: number; durationMs: number; coverage: number } | null {
  const lat = Number(event.location?.lat);
  const lng = Number(event.location?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const win = eventWindow(event);
  if (!win || win.durationMs <= 0) return null;

  const scoped = points
    .filter((p) => p.t >= win.startMs && p.t <= win.endMs)
    .sort((a, b) => a.t - b.t);

  let dwellMs = 0;
  for (let i = 0; i < scoped.length - 1; i += 1) {
    const cur = scoped[i];
    const next = scoped[i + 1];
    const gap = next.t - cur.t;
    if (gap <= 0 || gap > VISIT_MAX_SAMPLE_GAP_MS) continue;
    const curInside = haversineMeters(cur.lat, cur.lng, lat, lng) <= VISIT_RADIUS_M;
    const nextInside = haversineMeters(next.lat, next.lng, lat, lng) <= VISIT_RADIUS_M;
    if (!curInside || !nextInside) continue;
    dwellMs += Math.min(gap, win.endMs - win.startMs);
  }

  const cappedDwellMs = Math.min(dwellMs, win.durationMs);
  return {
    dwellMs: cappedDwellMs,
    durationMs: win.durationMs,
    coverage: cappedDwellMs / win.durationMs,
  };
}

/**
 * 이벤트별 방문 판정 맵. 장소가 있는 지난 일정만 포함:
 * - visited    = 일정 지속시간의 80% 이상 장소 반경 안에 머문 것으로 확인
 * - unverified = 시간창 내 반경 이내 포인트 없음(이력 부재 포함 — "확인 필요")
 * childScope 를 주면 해당 아이 이력만 대조한다. Map 은 member id → user id 로,
 * 캘린더처럼 여러 아이 일정이 섞인 화면에서 이벤트 배정 아이만 정확히 대조한다.
 */
export function verifyVisits(
  events: CalendarEvent[],
  history: LocationHistoryPoint[],
  childScope: VisitChildScope,
): Map<string, VisitVerdict> {
  const out = new Map<string, VisitVerdict>();
  const points: NormalizedPoint[] = (history ?? [])
    .filter(
      (p) => p.is_estimated !== true && p.is_estimated !== 1
        && isReliableLocationEvidence(p),
    )
    .map((p) => ({
      user_id: p.user_id,
      lat: Number(p.lat),
      lng: Number(p.lng),
      t: recordedAtMs(p.recorded_at),
    }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Number.isFinite(p.t));

  for (const ev of events ?? []) {
    const lat = Number(ev.location?.lat);
    const lng = Number(ev.location?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      if (hasLocationLabel(ev)) out.set(ev.id, "unverified");
      continue;
    }
    const win = eventWindow(ev);
    if (!win) continue;
    const userScope = scopeForEvent(ev, childScope);
    if (userScope && userScope.size === 0) {
      out.set(ev.id, "unverified");
      continue;
    }
    const scopedPoints = userScope ? points.filter((p) => userScope.has(p.user_id)) : points;
    const coverage = estimateVisitCoverage(ev, scopedPoints);
    out.set(ev.id, coverage && coverage.coverage >= VISIT_REQUIRED_COVERAGE ? "visited" : "unverified");
  }
  return out;
}

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
import { parseAppDateKey } from "./dateKey";
import { eventChildMemberIds, eventIsFamilyShared } from "./eventScope";

export type VisitVerdict = "visited" | "unverified";
export type VisitChildScope = string | null | ReadonlyMap<string, string>;

/** 도착 인정 반경(m) — GPS 오차·시설 규모 고려해 서버 미도착(50m)보다 관대하게. */
export const VISIT_RADIUS_M = 200;
/** 검증 시간창: 시작 N분 전부터. */
const WINDOW_BEFORE_MIN = 15;
/** 검증 시간창: 종료(없으면 시작+60분) N분 후까지. */
const WINDOW_AFTER_MIN = 15;

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

/** 이벤트의 [검증 시작, 검증 끝] epoch ms. 시간·날짜가 무효면 null. */
function eventWindow(event: CalendarEvent): { startMs: number; endMs: number } | null {
  const date = parseAppDateKey(event.date_key);
  const startMin = timeToMinutes(event.time);
  if (!date || startMin == null) return null;
  const endMin = timeToMinutes(event.end_time) ?? startMin + 60;
  const base = date.getTime();
  return {
    startMs: base + (startMin - WINDOW_BEFORE_MIN) * 60_000,
    endMs: base + (endMin + WINDOW_AFTER_MIN) * 60_000,
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

/**
 * 이벤트별 방문 판정 맵. 장소가 있는 지난 일정만 포함:
 * - visited    = 시간창 내 이력 중 반경 이내 포인트 존재(위치로 확인된 다녀옴)
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
  const points = (history ?? [])
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
    const visited = points.some(
      (p) =>
        (!userScope || userScope.has(p.user_id)) &&
        p.t >= win.startMs &&
        p.t <= win.endMs &&
        haversineMeters(p.lat, p.lng, lat, lng) <= VISIT_RADIUS_M,
    );
    out.set(ev.id, visited ? "visited" : "unverified");
  }
  return out;
}

/**
 * 도보 경로 도메인 엔드포인트.
 * legacy Kakao 응답 parser. 신규 조회는 queries/useRoute가 `/api/maps/directions`와
 * 가족 소유 object ref만 사용한다.
 *
 * 응답 파싱은 hyeni-1 routeParsers.parseKakaoWalkingRoute 규칙을 그대로 이관:
 *   routes[0].sections[].roads[].vertexes = [lng, lat, lng, lat, ...] 평면 배열.
 */

export interface RoutePoint {
  lat: number;
  lng: number;
}

export interface WalkingRoute {
  /** 경로 폴리라인 좌표(출발→도착 순서). */
  points: RoutePoint[];
  /** 총 거리(m). */
  distanceM: number;
  /** 총 소요시간(초). 서버 미제공 시 null. */
  durationSec: number | null;
  /** 턴바이턴 안내(도로명/안내문 + 구간 거리). 서버 미제공 시 빈 배열. */
  guides: RouteGuide[];
}

/** 도보 안내 한 구간 — 아이가 따라갈 수 있는 문장 + 거리. */
export interface RouteGuide {
  text: string;
  distanceM: number | null;
}

// ── Kakao 응답 형태(부분) ──
interface KakaoRoad {
  vertexes?: number[];
  name?: string;
  distance?: number;
}
interface KakaoGuide {
  name?: string;
  guidance?: string;
  distance?: number;
}
interface KakaoSection {
  distance?: number;
  duration?: number;
  roads?: KakaoRoad[];
  guides?: KakaoGuide[];
}
interface KakaoRoute {
  result_code?: number;
  result_message?: string;
  summary?: { distance?: number; duration?: number };
  sections?: KakaoSection[];
}
interface KakaoDirectionsResponse {
  routes?: KakaoRoute[];
}

function finiteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// 인접한 중복 좌표(GPS 잡음/직선 보간) 제거로 폴리라인을 압축한다.
function compactPoints(points: RoutePoint[]): RoutePoint[] {
  const out: RoutePoint[] = [];
  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.lat - p.lat) < 1e-7 && Math.abs(prev.lng - p.lng) < 1e-7) continue;
    out.push(p);
  }
  return out;
}

const EARTH_R = 6371000;
function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
function haversineM(a: RoutePoint, b: RoutePoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}
/** 두 좌표 직선거리(m) — 경로 API 불가 시 "예상" 거리 표기에 사용(직선임을 반드시 명시할 것). */
export function straightDistanceM(a: RoutePoint, b: RoutePoint): number {
  return haversineM(a, b);
}

function sumDistance(points: RoutePoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += haversineM(points[i - 1], points[i]);
  return total;
}

/** Kakao 도보 응답 → {points, distanceM, durationSec}(순수). 실패 시 throw. */
export function parseWalkingDirections(data: KakaoDirectionsResponse): WalkingRoute {
  const route = data?.routes?.[0];
  if (!route || route.result_code !== 0) {
    throw new Error(route?.result_message || "도보 경로를 찾지 못했어요");
  }

  const raw: RoutePoint[] = [];
  const guides: RouteGuide[] = [];
  const sections = Array.isArray(route.sections) ? route.sections : [];
  for (const section of sections) {
    const roads = Array.isArray(section?.roads) ? section.roads : [];
    for (const road of roads) {
      const vx = Array.isArray(road?.vertexes) ? road.vertexes : [];
      for (let i = 0; i + 1 < vx.length; i += 2) raw.push({ lng: vx[i], lat: vx[i + 1] });
    }
    // 턴바이턴 안내 — guides(안내문) 우선, 없으면 도로명 구간(name+distance)으로 구성.
    const gs = Array.isArray(section?.guides) ? section.guides : [];
    for (const g of gs) {
      const text = String(g?.guidance || g?.name || "").trim();
      if (text) guides.push({ text, distanceM: finiteNumber(g?.distance) });
    }
    if (gs.length === 0) {
      for (const road of roads) {
        const name = String(road?.name || "").trim();
        if (name) guides.push({ text: `${name} 따라 걷기`, distanceM: finiteNumber(road?.distance) });
      }
    }
  }

  const points = compactPoints(raw);
  if (points.length < 2) throw new Error("도보 경로 좌표가 없어요");

  const distanceM = finiteNumber(route.summary?.distance) ?? sumDistance(points);
  const durationSec = finiteNumber(route.summary?.duration);

  return { points, distanceM, durationSec, guides };
}

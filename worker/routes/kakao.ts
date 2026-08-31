// kakao-proxy Edge Function 직역 — 도보 길찾기 프록시.
//   POST /api/kakao/walking-directions  ← walkingRoute.js fetchKakaoWalkingRoute
//
// KAKAO_REST_KEY 를 번들/네이티브에 노출하지 않기 위한 서버 프록시(원본 동작 보존).
//
// ── 도보 폴백(2026-07-06) ──
// Kakao affiliate walking API 는 모빌리티 제휴사 전용 — 현 키가 403(permission denied)이라
// 인앱 도보 경로가 죽는다. 제휴 인증 실패 시 OSRM foot(공개 OSM 라우팅, FOSSGIS 운영)으로
// 폴백해 경로 폴리라인+턴바이턴을 Kakao 응답 형태로 합성한다(클라 파서 무변경, 제휴가
// 살아나면 자동으로 Kakao 우선). 최종 실패에만 503 kakao_auth(클라 쿨다운 래치 유지).
import { Hono } from "hono";
import type { Env, Vars } from "../types";
import { requireAuth } from "../middleware/auth";
import { cacheGet, cachePut, coordKey } from "../lib/edgeCache";
import { writeOperationalLog } from "../lib/safeOperationalLog";

const kakao = new Hono<{ Bindings: Env; Variables: Vars }>();

const KAKAO_WALKING_URL =
  "https://apis-navi.kakaomobility.com/affiliate/walking/v1/directions";

// FOSSGIS 공개 OSRM(도보 프로필). 키 불필요.
// ⚠️ 2026-08-17 실사고: 이 데모 서버가 Cloudflare Workers 대역을 **403 으로 차단**한다.
// 같은 URL·헤더가 로컬 호스트에서는 200 인데 Worker 에서만 403 이라 IP 차단이 확실하다
// (FOSSGIS 이용 정책상 데모 서버의 상용 트래픽은 허용되지 않는다). User-Agent 로는 안 풀린다.
// 그래서 아래 ORS 를 1순위 폴백으로 두고, OSRM 은 언젠가 풀릴 때를 위한 최후 시도로만 남긴다.
const OSRM_FOOT_URL = "https://routing.openstreetmap.de/routed-foot/route/v1/foot";
// OpenRouteService 도보 프로필 — 무료 키(하루 2,000건)로 API 사용이 허용된 서비스다.
// ORS_API_KEY 가 없으면 호출 자체를 건너뛴다(설정 누락이 오류가 되지 않게).
const ORS_FOOT_URL = "https://api.openrouteservice.org/v2/directions/foot-walking/geojson";
const KAKAO_COORD2ADDRESS_URL = "https://dapi.kakao.com/v2/local/geo/coord2address.json";

// ── 상류 응답 캐시 ────────────────────────────────────────────────────────
// 도보 경로·역지오코딩은 같은 좌표에 늘 같은 답이 나오고(도로는 하루 만에 안 바뀐다),
// 아이 한 명이 같은 학원을 매일 오간다. 상류 왕복(카카오 + OSRM 독일)이 2초를 먹으므로 캐시한다.
// ⚠️ Cloudflare `caches.default` 는 *.workers.dev 에서 no-op 이라 lib/edgeCache(D1+메모리)를 쓴다.
const WALK_CACHE_TTL_SEC = 60 * 60 * 24 * 7; // 7일
// 공개 OSRM(FOSSGIS)은 가끔 수 초씩 늦는다. 무한정 기다리면 아이 화면이 멈추므로 끊는다.
const KAKAO_TIMEOUT_MS = 2500;
const OSRM_TIMEOUT_MS = 4000;
const ORS_TIMEOUT_MS = 4000;
const GEOCODE_CACHE_TTL_SEC = 60 * 60 * 24 * 30; // 30일

/** 카카오 도보(제휴 전용) 호출. 실패·비제휴면 null. */
export async function fetchKakaoWalkingRoute(
  key: string,
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
): Promise<Record<string, unknown> | null> {
  const params = new URLSearchParams({
    origin: `${origin.lng},${origin.lat}`,
    destination: `${destination.lng},${destination.lat}`,
    waypoints: "",
    radius: "5000",
    priority: "MAIN_STREET",
    summary: "false",
  });
  try {
    const resp = await fetch(`${KAKAO_WALKING_URL}?${params.toString()}`, {
      method: "GET",
      headers: {
        accept: "application/json",
        service: "hyeni-calendar",
        Authorization: `KakaoAK ${key}`,
      },
      // 상류가 매달리면 사용자 화면이 통째로 멈춘다 — 짧게 끊고 폴백에 맡긴다.
      signal: AbortSignal.timeout(KAKAO_TIMEOUT_MS),
    });
    if (!resp.ok) {
      // 제휴 미승인은 403 이 정상이다. 그 외 코드는 키·쿼터 문제일 수 있어 구분해 남긴다.
      writeOperationalLog("error", "walking_route_kakao_failed", { provider: "kakao", status: resp.status });
      return null;
    }
    return (await resp.json()) as Record<string, unknown>;
  } catch {
    writeOperationalLog("error", "walking_route_kakao_network_failed", { provider: "kakao" });
    return null;
  }
}

// ── OSRM step → 아이 눈높이 한국어 안내문 ──
const OSRM_DIR_KO: Record<string, string> = {
  left: "왼쪽으로 꺾어",
  right: "오른쪽으로 꺾어",
  "slight left": "왼쪽 방향으로 가",
  "slight right": "오른쪽 방향으로 가",
  "sharp left": "왼쪽으로 크게 꺾어",
  "sharp right": "오른쪽으로 크게 꺾어",
  straight: "쭉 직진해",
  uturn: "뒤로 돌아서 가",
};

interface OsrmStep {
  name?: string;
  distance?: number;
  maneuver?: { type?: string; modifier?: string };
}

function osrmGuideText(step: OsrmStep): string {
  const name = (step.name ?? "").trim();
  const type = step.maneuver?.type ?? "";
  const dir = OSRM_DIR_KO[step.maneuver?.modifier ?? ""] ?? null;
  if (type === "depart") return name ? `${name}에서 출발` : "출발";
  if (type === "arrive") return "도착 지점이야";
  if (type === "new name" || type === "continue") {
    return name ? `${name} 따라 쭉 가` : dir ?? "계속 가";
  }
  const turn = dir ?? "계속 가";
  return name ? `${name}에서 ${turn}` : turn;
}

// OSRM foot 응답 → Kakao walking 응답 형태 합성(클라 parseWalkingDirections 가 그대로 파싱).
function osrmToKakaoShape(osrm: {
  routes?: Array<{
    distance?: number;
    duration?: number;
    geometry?: { coordinates?: [number, number][] };
    legs?: Array<{ steps?: OsrmStep[] }>;
  }>;
}): Record<string, unknown> | null {
  const r = osrm.routes?.[0];
  const coords = r?.geometry?.coordinates ?? [];
  if (!r || coords.length < 2) return null;
  const vertexes: number[] = [];
  for (const [lng, lat] of coords) {
    vertexes.push(lng, lat);
  }
  const steps = r.legs?.[0]?.steps ?? [];
  const guides = steps
    .map((s) => ({ guidance: osrmGuideText(s), distance: Math.round(s.distance ?? 0) }))
    .filter((g) => g.guidance);
  return {
    routes: [
      {
        result_code: 0,
        result_message: "ok(osrm-foot)",
        summary: {
          distance: Math.round(r.distance ?? 0),
          duration: Math.round(r.duration ?? 0),
        },
        sections: [{ roads: [{ vertexes }], guides }],
      },
    ],
  };
}

// OSRM foot 도보 경로 조회. 실패 시 null(호출부가 최종 실패 처리).
export async function fetchOsrmFootRoute(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
): Promise<Record<string, unknown> | null> {
  try {
    const url =
      `${OSRM_FOOT_URL}/${origin.lng},${origin.lat};${destination.lng},${destination.lat}` +
      `?overview=full&geometries=geojson&steps=true`;
    // 공개 OSRM 이 늦으면(관측: 6.8초) 화면이 통째로 멈춘다 — 끊고 정직하게 실패시킨다.
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(OSRM_TIMEOUT_MS),
    });
    if (!res.ok) {
      // 상태 코드를 남기지 않으면 "왜 길을 못 찾는지"를 영영 모른다(2026-08-17 실사고).
      // 좌표·응답 본문은 남기지 않는다(아이 위치가 로그로 새면 안 된다).
      writeOperationalLog("error", "walking_route_osrm_failed", { status: res.status });
      return null;
    }
    const data = (await res.json()) as Parameters<typeof osrmToKakaoShape>[0] & { code?: string };
    if (data.code !== "Ok") {
      writeOperationalLog("error", "walking_route_osrm_no_route");
      return null;
    }
    return osrmToKakaoShape(data);
  } catch {
    writeOperationalLog("error", "walking_route_osrm_network_failed");
    return null;
  }
}

// ── OpenRouteService(도보) ───────────────────────────────────────────────
// FOSSGIS OSRM 이 Workers 대역을 막아 인앱 길 안내가 통째로 죽었다(2026-08-17).
// ORS 는 무료 키로 API 사용이 허용된 서비스라 Workers 에서도 정상 응답한다.
//
// ORS instruction type(정수) → 아이 눈높이 한국어. OSRM 어휘와 같은 톤을 쓴다.
const ORS_TYPE_KO: Record<number, string> = {
  0: "왼쪽으로 꺾어",
  1: "오른쪽으로 꺾어",
  2: "왼쪽으로 크게 꺾어",
  3: "오른쪽으로 크게 꺾어",
  4: "왼쪽 방향으로 가",
  5: "오른쪽 방향으로 가",
  6: "쭉 직진해",
  7: "회전교차로로 들어가",
  8: "회전교차로에서 나와",
  9: "뒤로 돌아서 가",
  10: "도착 지점이야",
  11: "출발",
  12: "왼쪽 길로 가",
  13: "오른쪽 길로 가",
};

interface OrsStep {
  distance?: number;
  type?: number;
  name?: string;
}

function orsGuideText(step: OrsStep): string {
  const rawName = (step.name ?? "").trim();
  // ORS 는 이름 없는 길을 "-" 로 준다 — 그대로 읽으면 "-에서 왼쪽으로 꺾어"가 된다.
  const name = rawName === "-" ? "" : rawName;
  const type = typeof step.type === "number" ? step.type : -1;
  if (type === 11) return name ? `${name}에서 출발` : "출발";
  if (type === 10) return "도착 지점이야";
  const turn = ORS_TYPE_KO[type] ?? "계속 가";
  if (type === 6) return name ? `${name} 따라 쭉 가` : turn;
  return name ? `${name}에서 ${turn}` : turn;
}

/** ORS GeoJSON 응답 → Kakao walking 응답 형태(클라 parseWalkingDirections 가 그대로 파싱). */
function orsToKakaoShape(ors: {
  features?: Array<{
    geometry?: { coordinates?: [number, number][] };
    properties?: {
      summary?: { distance?: number; duration?: number };
      segments?: Array<{ steps?: OrsStep[] }>;
    };
  }>;
}): Record<string, unknown> | null {
  const feature = ors.features?.[0];
  const coords = feature?.geometry?.coordinates ?? [];
  if (!feature || coords.length < 2) return null;
  const vertexes: number[] = [];
  for (const [lng, lat] of coords) vertexes.push(lng, lat);
  const steps = feature.properties?.segments?.[0]?.steps ?? [];
  const guides = steps
    .map((s) => ({ guidance: orsGuideText(s), distance: Math.round(s.distance ?? 0) }))
    .filter((g) => g.guidance);
  const summary = feature.properties?.summary ?? {};
  return {
    routes: [
      {
        result_code: 0,
        result_message: "ok(ors-foot)",
        summary: {
          distance: Math.round(summary.distance ?? 0),
          duration: Math.round(summary.duration ?? 0),
        },
        sections: [{ roads: [{ vertexes }], guides }],
      },
    ],
  };
}

/** ORS 도보 경로 조회. 키가 없거나 실패하면 null(호출부가 다음 폴백으로 넘어간다). */
export async function fetchOrsFootRoute(
  apiKey: string,
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
): Promise<Record<string, unknown> | null> {
  if (!apiKey) return null;
  try {
    const res = await fetch(ORS_FOOT_URL, {
      method: "POST",
      headers: {
        authorization: apiKey,
        "content-type": "application/json",
        accept: "application/geo+json",
      },
      body: JSON.stringify({
        coordinates: [
          [origin.lng, origin.lat],
          [destination.lng, destination.lat],
        ],
        instructions: true,
        language: "ko",
      }),
      signal: AbortSignal.timeout(ORS_TIMEOUT_MS),
    });
    if (!res.ok) {
      // 좌표·응답 본문은 남기지 않는다(아이 위치가 로그로 새면 안 된다).
      writeOperationalLog("error", "walking_route_ors_failed", { status: res.status });
      return null;
    }
    return orsToKakaoShape(await res.json() as Parameters<typeof orsToKakaoShape>[0]);
  } catch {
    writeOperationalLog("error", "walking_route_ors_network_failed");
    return null;
  }
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function validateLatLng(
  p: { lat?: unknown; lng?: unknown } | undefined,
): { lat: number; lng: number } | null {
  if (!p || typeof p !== "object") return null;
  const { lat, lng } = p;
  if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) return null;
  if (lat < -90 || lat > 90) return null;
  if (lng < -180 || lng > 180) return null;
  return { lat, lng };
}

interface KakaoAddressDoc {
  road_address?: {
    address_name?: string | null;
    region_3depth_name?: string | null;
    road_name?: string | null;
    main_building_no?: string | null;
    sub_building_no?: string | null;
    building_name?: string | null;
  } | null;
  address?: {
    address_name?: string | null;
    region_3depth_name?: string | null;
    mountain_yn?: string | null;
    main_address_no?: string | null;
    sub_address_no?: string | null;
  } | null;
}

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

function joinNo(main: unknown, sub: unknown): string {
  const a = cleanText(main);
  const b = cleanText(sub);
  if (!a) return "";
  return b ? `${a}-${b}` : a;
}

function compactLotAddress(doc: KakaoAddressDoc): string {
  const addr = doc.address;
  const dong = cleanText(addr?.region_3depth_name);
  const mainNo = cleanText(addr?.main_address_no);
  if (!dong || !mainNo) return "";
  const prefix = addr?.mountain_yn === "Y" ? "산 " : "";
  return `${dong} ${prefix}${joinNo(mainNo, addr?.sub_address_no)}`.trim();
}

function compactRoadAddress(doc: KakaoAddressDoc): string {
  const road = doc.road_address;
  const roadName = cleanText(road?.road_name);
  const no = joinNo(road?.main_building_no, road?.sub_building_no);
  if (!roadName || !no) return "";
  const dong = cleanText(road?.region_3depth_name) || cleanText(doc.address?.region_3depth_name);
  return `${dong ? `${dong} ` : ""}${roadName} ${no}`.trim();
}

function stripToNeighborhood(addressName: string): string {
  const words = addressName.split(/\s+/).filter(Boolean);
  const idx = words.findIndex((w) => /(?:동|읍|면|리)$/.test(w));
  return idx >= 0 ? words.slice(idx).join(" ") : addressName;
}

export function readableAddress(doc: KakaoAddressDoc | undefined): {
  label: string;
  address: string;
  buildingName: string | null;
} | null {
  if (!doc) return null;
  const building = cleanText(doc.road_address?.building_name);
  const compactLot = compactLotAddress(doc);
  const compactRoad = compactRoadAddress(doc);
  const road = cleanText(doc.road_address?.address_name);
  const lot = cleanText(doc.address?.address_name);
  const address = compactLot || compactRoad || stripToNeighborhood(lot || road);
  if (!address && !building) return null;
  return {
    label: building && address ? `${building} · ${address}` : building || address,
    address,
    buildingName: building || null,
  };
}

// JWT 검증 필수(requireAuth) — 익명/미인증 호출 거부.
kakao.post("/walking-directions", requireAuth, async (c) => {
  const key = c.env.KAKAO_REST_KEY || c.env.KAKAO_REST_API_KEY || "";
  if (!key) return c.json({ ok: false, error: "server_misconfigured" }, 500);

  let parsed: { origin?: { lat?: unknown; lng?: unknown }; destination?: { lat?: unknown; lng?: unknown } };
  try {
    parsed = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid_json" }, 400);
  }
  const origin = validateLatLng(parsed?.origin);
  const destination = validateLatLng(parsed?.destination);
  if (!origin || !destination) {
    return c.json({ ok: false, error: "invalid_coordinates" }, 400);
  }

  // 같은 구간을 다시 물으면 캐시에서 즉시 돌려준다(2초 → 수십 ms).
  const cacheKey = `walk/${coordKey(origin)}/${coordKey(destination)}`;
  const hit = await cacheGet<Record<string, unknown>>(c.env.DB, cacheKey);
  if (hit) return c.json(hit, 200);

  // 카카오(제휴 전용, 현재 403)와 OSRM 폴백을 **동시에** 부른다.
  // 순차로 부르면 카카오가 실패할 걸 알면서도 그 왕복을 다 기다린 뒤 OSRM 을 시작해 2초가 넘었다.
  // 제휴가 승인되면 카카오 응답이 이기므로 코드를 되돌릴 필요가 없다.
  const [kakaoRoute, orsRoute, osrmRoute] = await Promise.all([
    fetchKakaoWalkingRoute(key, origin, destination),
    fetchOrsFootRoute(c.env.ORS_API_KEY || "", origin, destination),
    fetchOsrmFootRoute(origin, destination),
  ]);

  // 우선순위: 카카오(제휴 승인 시) → ORS(무료 키) → OSRM(공개 데모, 현재 Workers 차단).
  const payload = kakaoRoute ?? orsRoute ?? osrmRoute;
  if (payload) {
    cachePut(c.executionCtx, c.env.DB, cacheKey, payload, WALK_CACHE_TTL_SEC);
    return c.json(payload, 200);
  }

  // 둘 다 실패 — 클라이언트가 카카오맵 앱으로 강등할 수 있게 사유를 그대로 알린다.
  return c.json({ ok: false, error: "upstream_unreachable" }, 502);
});

// 좌표 → 사용자 표시용 장소명/주소. 클라이언트에 REST 키를 노출하지 않고, 저장장소 밖
// 위치도 "위치 확인됨"이나 좌표 대신 건물명/도로명주소로 보여주기 위한 프록시.
kakao.post("/reverse-geocode", requireAuth, async (c) => {
  const key = c.env.KAKAO_REST_KEY || c.env.KAKAO_REST_API_KEY || "";
  if (!key) return c.json({ ok: false, error: "server_misconfigured" }, 500);

  let parsed: { lat?: unknown; lng?: unknown };
  try {
    parsed = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid_json" }, 400);
  }
  const point = validateLatLng(parsed);
  if (!point) return c.json({ ok: false, error: "invalid_coordinates" }, 400);

  // 주소는 좌표당 사실상 불변 → 30일 캐시. 도착 감지·메모 위치공유가 자주 부른다.
  const geoKey = `geo/${coordKey(point)}`;
  const geoHit = await cacheGet<Record<string, unknown>>(c.env.DB, geoKey);
  if (geoHit) return c.json(geoHit, 200);

  const params = new URLSearchParams({ x: String(point.lng), y: String(point.lat) });
  let resp: Response;
  try {
    resp = await fetch(`${KAKAO_COORD2ADDRESS_URL}?${params.toString()}`, {
      headers: { Authorization: `KakaoAK ${key}`, accept: "application/json" },
    });
  } catch {
    return c.json({ ok: false, error: "upstream_unreachable" }, 502);
  }
  if (!resp.ok) return c.json({ ok: false, error: `kakao_http_${resp.status}` }, 502);

  const data = (await resp.json()) as { documents?: KakaoAddressDoc[] };
  const found = readableAddress(data.documents?.[0]);
  if (!found) return c.json({ ok: false, error: "address_not_found" }, 404);
  const payload = { ok: true, ...found };
  cachePut(c.executionCtx, c.env.DB, geoKey, payload, GEOCODE_CACHE_TTL_SEC);
  return c.json(payload);
});

export default kakao;

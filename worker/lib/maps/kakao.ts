import {
  fetchKakaoWalkingRoute,
  fetchOrsFootRoute,
  fetchOsrmFootRoute,
  readableAddress,
} from "../../routes/kakao.ts";
import type {
  LatLngPoint,
  MapProviderAdapter,
  MapSearchCandidate,
  MapSearchResponse,
  WalkingRouteResponse,
} from "./types.ts";

const KAKAO_SEARCH_URL = "https://dapi.kakao.com/v2/local/search/keyword.json";
const KAKAO_REVERSE_URL = "https://dapi.kakao.com/v2/local/geo/coord2address.json";
const REVERSE_PLACE_RADIUS_M = 35;

interface KakaoPlaceDocument {
  id?: string;
  place_name?: string;
  address_name?: string;
  road_address_name?: string;
  x?: string;
  y?: string;
}

function pointFromDocument(document: KakaoPlaceDocument): LatLngPoint | null {
  const lat = Number(document.y);
  const lng = Number(document.x);
  return Number.isFinite(lat) && lat >= -90 && lat <= 90 && Number.isFinite(lng) && lng >= -180 && lng <= 180
    ? { lat, lng }
    : null;
}

function normalizeAddress(value: unknown): string {
  return typeof value === "string" ? value.normalize("NFKC").replace(/\s+/gu, "").trim() : "";
}

function distanceMeters(a: LatLngPoint, b: LatLngPoint): number {
  const radians = Math.PI / 180;
  const dLat = (b.lat - a.lat) * radians;
  const dLng = (b.lng - a.lng) * radians;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 같은 주소의 가까운 상호가 하나로 확인될 때만 사용한다. 복수 입점·옆 건물은 주소로 남긴다. */
async function exactBusinessName(key: string, point: LatLngPoint, addresses: string[]): Promise<string | null> {
  const knownAddresses = new Set(addresses.map(normalizeAddress).filter(Boolean));
  if (!knownAddresses.size) return null;
  const params = new URLSearchParams({
    query: addresses[0], x: String(point.lng), y: String(point.lat),
    radius: String(REVERSE_PLACE_RADIUS_M), sort: "distance", size: "15",
  });
  try {
    const response = await fetch(`${KAKAO_SEARCH_URL}?${params}`, {
      headers: { Authorization: `KakaoAK ${key}`, accept: "application/json" },
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return null;
    const data = await response.json() as { documents?: KakaoPlaceDocument[]; meta?: { is_end?: boolean } };
    if (!Array.isArray(data.documents) || data.meta?.is_end === false) return null;
    const matches = new Map<string, string>();
    for (const document of data.documents) {
      const candidate = pointFromDocument(document);
      const name = document.place_name?.trim();
      if (!candidate || !name || !document.id || distanceMeters(point, candidate) > REVERSE_PLACE_RADIUS_M) continue;
      if (![document.road_address_name, document.address_name].some(address => knownAddresses.has(normalizeAddress(address)))) continue;
      matches.set(document.id, name);
    }
    return matches.size === 1 ? [...matches.values()][0] : null;
  } catch {
    return null;
  }
}

async function searchDocuments(
  key: string,
  query: string,
  bias: LatLngPoint | null = null,
): Promise<KakaoPlaceDocument[]> {
  const params = new URLSearchParams({ query, size: "15" });
  if (bias) {
    params.set("x", String(bias.lng));
    params.set("y", String(bias.lat));
    params.set("sort", "distance");
  }
  const response = await fetch(`${KAKAO_SEARCH_URL}?${params}`, {
    headers: { Authorization: `KakaoAK ${key}`, accept: "application/json" },
    signal: AbortSignal.timeout(3_000),
  });
  if (!response.ok) throw new Error("kakao_search_failed");
  const data = await response.json() as { documents?: KakaoPlaceDocument[] };
  return Array.isArray(data.documents) ? data.documents : [];
}

function routeFromKakaoShape(
  payload: Record<string, unknown>,
  policyProvider: "kakao",
  routeSource: "kakao" | "ors" | "osrm",
): WalkingRouteResponse | null {
  const route = (payload.routes as Array<Record<string, unknown>> | undefined)?.[0];
  const summary = route?.summary as Record<string, unknown> | undefined;
  const distance = Number(summary?.distance);
  if (!route || !Number.isFinite(distance)) return null;
  const points: LatLngPoint[] = [];
  for (const section of (route.sections as Array<Record<string, unknown>> | undefined) ?? []) {
    for (const road of (section.roads as Array<Record<string, unknown>> | undefined) ?? []) {
      const vertexes = road.vertexes as number[] | undefined;
      if (!Array.isArray(vertexes)) continue;
      for (let index = 0; index + 1 < vertexes.length; index += 2) {
        const lng = Number(vertexes[index]);
        const lat = Number(vertexes[index + 1]);
        if (Number.isFinite(lat) && Number.isFinite(lng)) points.push({ lat, lng });
      }
    }
  }
  if (points.length < 2) return null;
  const duration = Number(summary?.duration);
  return {
    policyProvider,
    routeSource,
    distanceMeters: Math.round(distance),
    durationSeconds: Number.isFinite(duration) ? Math.round(duration) : null,
    points,
    quality: "provider_route",
    warnings: [],
  };
}

export function createKakaoMapAdapter(env: {
  KAKAO_REST_KEY?: string;
  KAKAO_REST_API_KEY?: string;
  ORS_API_KEY?: string;
}): MapProviderAdapter {
  const key = env.KAKAO_REST_KEY || env.KAKAO_REST_API_KEY || "";
  if (!key) throw new Error("map_provider_not_configured");
  return {
    provider: "kakao",
    async search(query, _locale, bias) {
      const documents = await searchDocuments(key, query, bias);
      return documents.flatMap<MapSearchCandidate>((document) => {
        if (!document.id || !pointFromDocument(document)) return [];
        return [{
          provider: "kakao",
          providerPlaceId: document.id,
          primaryText: String(document.place_name ?? "").trim(),
          secondaryText: String(document.road_address_name || document.address_name || "").trim() || null,
        }];
      });
    },
    async select(providerPlaceId, _providerSessionToken) {
      const documents = await searchDocuments(key, providerPlaceId);
      const document = documents.find((candidate) => candidate.id === providerPlaceId) ?? documents[0];
      const point = document ? pointFromDocument(document) : null;
      if (!document || !point) throw new Error("kakao_place_not_found");
      return {
        action: "select",
        provider: "kakao",
        point,
        primaryText: String(document.place_name ?? "").trim(),
        secondaryText: String(document.road_address_name || document.address_name || "").trim() || null,
      } satisfies Extract<MapSearchResponse, { action: "select" }>;
    },
    async reverse(point, _locale) {
      const params = new URLSearchParams({ x: String(point.lng), y: String(point.lat) });
      const response = await fetch(`${KAKAO_REVERSE_URL}?${params}`, {
        headers: { Authorization: `KakaoAK ${key}`, accept: "application/json" },
        signal: AbortSignal.timeout(3_000),
      });
      if (!response.ok) throw new Error("kakao_reverse_failed");
      const data = await response.json() as { documents?: Parameters<typeof readableAddress>[0][] };
      const document = data.documents?.[0];
      const buildingName = document?.road_address?.building_name?.trim();
      if (buildingName) return buildingName;
      const addresses = [document?.road_address?.address_name, document?.address?.address_name]
        .filter((address): address is string => typeof address === "string" && Boolean(address.trim()));
      return await exactBusinessName(key, point, addresses) ?? readableAddress(document)?.label ?? null;
    },
    async directions(origin, destination, _locale) {
      const [kakao, ors, osrm] = await Promise.all([
        fetchKakaoWalkingRoute(key, origin, destination),
        fetchOrsFootRoute(env.ORS_API_KEY || "", origin, destination),
        fetchOsrmFootRoute(origin, destination),
      ]);
      const result = kakao
        ? routeFromKakaoShape(kakao, "kakao", "kakao")
        : ors
          ? routeFromKakaoShape(ors, "kakao", "ors")
          : osrm
            ? routeFromKakaoShape(osrm, "kakao", "osrm")
            : null;
      return result ?? {
        policyProvider: "kakao",
        routeSource: "none",
        distanceMeters: null,
        durationSeconds: null,
        points: [],
        quality: "unavailable",
        warnings: ["walking_data_incomplete"],
      };
    },
  };
}

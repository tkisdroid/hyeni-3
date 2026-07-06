export interface PlaceLike {
  name: string;
  location?: {
    lat?: number;
    lng?: number;
    address?: string;
  } | null;
}

export interface EventLocationLike {
  lat?: number;
  lng?: number;
  address?: string;
}

const PLACE_MATCH_RADIUS_M = 220;
const EARTH_RADIUS_M = 6_371_000;

function cleanText(value: string | null | undefined): string {
  return String(value ?? "").replace(/\s+/g, "").trim();
}

function isFiniteCoord(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function addressMatches(eventAddress: string, placeAddress: string): boolean {
  const eventClean = cleanText(eventAddress);
  const placeClean = cleanText(placeAddress);
  if (!eventClean || !placeClean) return false;
  return eventClean.includes(placeClean) || placeClean.includes(eventClean);
}

export function resolveEventPlaceLabel(
  location: EventLocationLike | null | undefined,
  places: readonly PlaceLike[] | null | undefined,
): string {
  const fallback = String(location?.address ?? "").trim();
  if (!location) return "";

  const lat = location.lat;
  const lng = location.lng;
  if (isFiniteCoord(lat) && isFiniteCoord(lng)) {
    let best: { name: string; dist: number } | null = null;
    for (const place of places ?? []) {
      const pLat = place.location?.lat;
      const pLng = place.location?.lng;
      if (!isFiniteCoord(pLat) || !isFiniteCoord(pLng)) continue;
      const dist = distanceMeters(lat, lng, pLat, pLng);
      if (dist <= PLACE_MATCH_RADIUS_M && (!best || dist < best.dist)) {
        best = { name: place.name, dist };
      }
    }
    if (best) return best.name;
  }

  for (const place of places ?? []) {
    if (addressMatches(fallback, place.location?.address ?? "")) return place.name;
  }

  return fallback;
}

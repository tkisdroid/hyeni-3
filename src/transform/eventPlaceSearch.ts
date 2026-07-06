import type { SavedPlace } from "@/lib/api/endpoints/location";

function normalizeSearchText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, "")
    .toLocaleLowerCase("ko-KR");
}

function hasUsableLocation(place: SavedPlace): boolean {
  return Number.isFinite(place.location?.lat) && Number.isFinite(place.location?.lng);
}

function matchScore(place: SavedPlace, query: string): number | null {
  const name = normalizeSearchText(place.name);
  const address = normalizeSearchText(place.location?.address);

  if (name.startsWith(query)) return 0;
  if (name.includes(query)) return 1;
  if (address.includes(query)) return 2;
  return null;
}

export function searchSavedPlacesForSchedule(
  places: readonly SavedPlace[],
  query: string,
  limit = 6,
): SavedPlace[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];

  return places
    .map((place, index) => ({ place, index, score: hasUsableLocation(place) ? matchScore(place, normalizedQuery) : null }))
    .filter((item): item is { place: SavedPlace; index: number; score: number } => item.score !== null)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, limit)
    .map((item) => item.place);
}

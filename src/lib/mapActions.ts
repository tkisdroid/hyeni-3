import {
  mapsApi,
  type EphemeralMapSearchCandidate,
  type MapSelectedPlace,
  type MapSearchSession,
} from "@/lib/api/endpoints/maps";

export async function findMapPlaces(familyId: string, query: string, locale: string): Promise<{
  session: MapSearchSession;
  candidates: EphemeralMapSearchCandidate[];
}> {
  const session = await mapsApi.startSearch(familyId);
  const candidates = await mapsApi.search({ familyId, sessionHandle: session.sessionHandle, query, locale });
  return { session, candidates };
}

export function selectMapPlace(familyId: string, sessionHandle: string, candidate: EphemeralMapSearchCandidate): Promise<MapSelectedPlace> {
  return mapsApi.select({ familyId, sessionHandle, providerPlaceId: candidate.providerPlaceId });
}

export async function searchMapPlace(familyId: string, query: string, locale: string): Promise<MapSelectedPlace | null> {
  const { session, candidates } = await findMapPlaces(familyId, query, locale);
  const first = candidates[0];
  if (!first) return null;
  return selectMapPlace(familyId, session.sessionHandle, first);
}

export async function reverseRawMapLabel(
  familyId: string,
  point: { lat: number; lng: number },
  locale: string,
  kind: "picker_pin" | "memo_share",
): Promise<string> {
  const result = await mapsApi.reverse({ familyId, locale, source: { kind, ...point } });
  return result.label ?? "";
}

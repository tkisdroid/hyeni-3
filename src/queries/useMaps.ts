import { useMutation, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthContext";
import { mapsApi, type MapBiasRef, type MapDirectionsRequest, type ReverseSource } from "@/lib/api/endpoints/maps";
import { qk } from "./keys";

export function useStartMapSearch() {
  const { familyId } = useAuth();
  return useMutation({ mutationFn: () => {
    if (!familyId) throw new Error("family_required");
    return mapsApi.startSearch(familyId);
  } });
}
export function useMapSearch() {
  const { familyId } = useAuth();
  return useMutation({ mutationFn: (input: { sessionHandle: string; query: string; locale: string; bias?: MapBiasRef }) => {
    if (!familyId) throw new Error("family_required");
    return mapsApi.search({ familyId, ...input });
  } });
}

export function useSelectMapPlace() {
  const { familyId } = useAuth();
  return useMutation({ mutationFn: (input: { sessionHandle: string; providerPlaceId: string }) => {
    if (!familyId) throw new Error("family_required");
    return mapsApi.select({ familyId, ...input });
  } });
}

export function useMapReverse(input: { source: ReverseSource; locale: string; provider: string; enabled?: boolean }) {
  const { familyId } = useAuth();
  return useQuery({
    queryKey: qk.mapReverse(familyId, input.provider, input.source),
    queryFn: () => mapsApi.reverse({ familyId: familyId!, source: input.source, locale: input.locale }),
    enabled: Boolean(familyId) && input.enabled !== false,
    staleTime: 5 * 60_000,
  });
}

export function useMapDirections(input: { request: MapDirectionsRequest; locale: string; provider: string; enabled?: boolean }) {
  const { familyId } = useAuth();
  return useQuery({
    queryKey: qk.mapDirections(familyId, input.provider, input.request),
    queryFn: () => mapsApi.directions({ familyId: familyId!, locale: input.locale, ...input.request }),
    enabled: Boolean(familyId) && input.enabled !== false,
    staleTime: 60_000,
  });
}

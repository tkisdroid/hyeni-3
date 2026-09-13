/**
 * 좌표를 화면 표시용 위치명으로 변환한다.
 * 우선순위: 가까운 저장장소 → 해당 실측 시각의 지도 건물명·상호명 → 주소.
 */
import { useCallback, useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { useIntl } from "react-intl";
import { qk } from "./keys";
import type { ChildLocation, SavedPlace } from "@/lib/api/endpoints/location";
import { mapsApi } from "@/lib/api/endpoints/maps";
import { useAuth } from "@/auth/AuthContext";
import { useMyFamily } from "./useFamily";
import { exactSavedPlaceLabel } from "@/transform/locationView";
import { labelForMeasuredLocation, locationLabelReferenceKey } from "@/transform/locationLabelReference";

function savedPlaceLabel(loc: ChildLocation, places: SavedPlace[] | undefined): string | null {
  if (!places) return null;
  return exactSavedPlaceLabel(loc, places);
}

export function useLocationLabels(
  locations: readonly ChildLocation[] | undefined,
  places: SavedPlace[] | undefined,
  options?: { fallback?: string },
): (loc: ChildLocation) => string {
  const intl = useIntl();
  const { familyId } = useAuth();
  const family = useMyFamily();
  const provider = family.data?.mapPolicy.provider ?? "unsupported";
  const candidates = useMemo(() => {
    const out = new Map<string, ChildLocation>();
    for (const loc of locations ?? []) {
      if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) continue;
      if (savedPlaceLabel(loc, places)) continue;
      const key = locationLabelReferenceKey(loc);
      if (!out.has(key)) out.set(key, loc);
    }
    return [...out.entries()].map(([key, loc]) => ({ key, loc }));
  }, [locations, places]);

  const queries = useQueries({
    queries: candidates.map(({ loc }) => ({
      queryKey: qk.mapReverse(familyId, provider, { kind: "child_location", childUserId: loc.user_id, recordedAt: loc.updated_at, locale: intl.locale }),
      queryFn: () => mapsApi.reverse({
        familyId: familyId!,
        locale: intl.locale,
        source: { kind: "child_location", childUserId: loc.user_id, recordedAt: loc.updated_at },
      }),
      enabled: Boolean(familyId) && provider !== "unsupported",
      staleTime: 24 * 60 * 60_000,
      gcTime: 7 * 24 * 60 * 60_000,
      retry: 1,
    })),
  });

  const addressByKey = useMemo(() => {
    const map = new Map<string, string>();
    candidates.forEach(({ key, loc }, index) => {
      const label = labelForMeasuredLocation(loc, queries[index]?.data);
      if (label) map.set(key, label);
      else if (queries[index]?.isError || queries[index]?.isSuccess || provider === "unsupported") {
        map.set(key, options?.fallback ?? intl.formatMessage({ id: "parent.location.unverifiedPlace" }));
      }
    });
    return map;
  }, [candidates, queries, provider, intl, options?.fallback]);

  return useCallback(
    (loc: ChildLocation) =>
      savedPlaceLabel(loc, places)
      ?? addressByKey.get(locationLabelReferenceKey(loc))
      ?? options?.fallback
      ?? intl.formatMessage({ id: "parent.location.addressLoading" }),
    [addressByKey, intl, places, options?.fallback],
  );
}

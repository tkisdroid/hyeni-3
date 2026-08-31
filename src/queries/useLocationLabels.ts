/**
 * 좌표를 화면 표시용 위치명으로 변환한다.
 * 우선순위: 저장장소(200m 이내) → 가족 국가 정책의 공통 역지오코딩 → "주소 확인 중".
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

function coordKey(loc: Pick<ChildLocation, "lat" | "lng">): string {
  return `${loc.lat.toFixed(5)},${loc.lng.toFixed(5)}`;
}

function savedPlaceLabel(loc: ChildLocation, places: SavedPlace[] | undefined): string | null {
  if (!places) return null;
  return exactSavedPlaceLabel(loc, places);
}

export function useLocationLabels(
  locations: readonly ChildLocation[] | undefined,
  places: SavedPlace[] | undefined,
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
      const key = coordKey(loc);
      if (!out.has(key)) out.set(key, loc);
    }
    return [...out.entries()].map(([key, loc]) => ({ key, loc }));
  }, [locations, places]);

  const queries = useQueries({
    queries: candidates.map(({ loc }) => ({
      queryKey: qk.mapReverse(familyId, provider, { kind: "child_location", childUserId: loc.user_id, measuredAt: loc.updated_at }),
      queryFn: () => mapsApi.reverse({
        familyId: familyId!,
        locale: intl.locale,
        source: { kind: "child_location", childUserId: loc.user_id },
      }),
      enabled: Boolean(familyId) && provider !== "unsupported",
      staleTime: 24 * 60 * 60_000,
      gcTime: 7 * 24 * 60 * 60_000,
      retry: 1,
    })),
  });

  const addressByKey = useMemo(() => {
    const map = new Map<string, string>();
    candidates.forEach(({ key }, index) => {
      const label = queries[index]?.data?.label?.trim();
      if (label) map.set(key, label);
    });
    return map;
  }, [candidates, queries]);

  return useCallback(
    (loc: ChildLocation) =>
      savedPlaceLabel(loc, places)
      ?? addressByKey.get(coordKey(loc))
      ?? intl.formatMessage({ id: "parent.location.addressLoading" }),
    [addressByKey, intl, places],
  );
}

/**
 * 도보 경로 도메인 TanStack Query 훅.
 * 출발/도착 좌표가 모두 있을 때만 조회(enabled 가드). 경로 조회는 읽기 성격이라
 * 화면 진입 시 자동 실행해도 무방하다(서버 상태 변경 없음).
 */
import { useQuery } from "@tanstack/react-query";
import { qk } from "./keys";
import { useAuth } from "@/auth/AuthContext";
import type { RoutePoint, WalkingRoute } from "@/lib/api/endpoints/route";
import { mapsApi, type MapDirectionsRequest } from "@/lib/api/endpoints/maps";

// 좌표를 쿼리키 문자열로.
// ⚠️ 소수 5자리(≈1m)는 GPS 지터를 그대로 통과시킨다 — 실측(2026-08-17)에서 출발 좌표가
// 37.33228 → 37.33224 로 흔들리며 **매번 새 쿼리**가 생겼고, 각 쿼리가 따로 실패해
// 화면이 계속 처음 상태로 되돌아갔다. 도보 경로는 10m 차이로 달라지지 않으므로
// 4자리(≈11m)로 묶어 같은 구간을 한 쿼리로 본다(서버 캐시 키와도 결이 같다).
function coordKey(p: RoutePoint | null): string {
  return p ? `${p.lat.toFixed(4)},${p.lng.toFixed(4)}` : "";
}

/** 출발→도착 도보 경로. 좌표 중 하나라도 없으면 비활성. */
export function useWalkingRoute(
  origin: RoutePoint | null,
  destination: RoutePoint | null,
  refs?: MapDirectionsRequest | null,
) {
  const { status, familyId } = useAuth();
  const enabled = status === "authenticated" && !!familyId && !!origin && !!destination && !!refs;
  return useQuery<WalkingRoute>({
    queryKey: [...qk.walkingRoute(coordKey(origin), coordKey(destination)), JSON.stringify(refs)] as const,
    queryFn: async () => {
      const result = await mapsApi.directions({ familyId: familyId!, locale: navigator.language, ...(refs as MapDirectionsRequest) });
      if (result.routeSource === "none" || result.points.length < 2 || result.distanceMeters == null) throw new Error("map_directions_failed");
      return {
        points: result.points,
        distanceM: result.distanceMeters,
        durationSec: result.durationSeconds,
        guides: [],
      };
    },
    enabled,
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

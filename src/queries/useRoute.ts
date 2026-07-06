/**
 * 도보 경로 도메인 TanStack Query 훅.
 * 출발/도착 좌표가 모두 있을 때만 조회(enabled 가드). 경로 조회는 읽기 성격이라
 * 화면 진입 시 자동 실행해도 무방하다(서버 상태 변경 없음).
 */
import { useQuery } from "@tanstack/react-query";
import { qk } from "./keys";
import { useAuth } from "@/auth/AuthContext";
import {
  fetchWalkingDirections,
  type RoutePoint,
  type WalkingRoute,
} from "@/lib/api/endpoints/route";

// 좌표를 쿼리키 문자열로(소수 5자리 ≈ 1m 해상도 — 잦은 미세 변화로 캐시가 깨지지 않게).
function coordKey(p: RoutePoint | null): string {
  return p ? `${p.lat.toFixed(5)},${p.lng.toFixed(5)}` : "";
}

/** 출발→도착 도보 경로. 좌표 중 하나라도 없으면 비활성. */
export function useWalkingRoute(origin: RoutePoint | null, destination: RoutePoint | null) {
  const { status } = useAuth();
  const enabled = status === "authenticated" && !!origin && !!destination;
  return useQuery<WalkingRoute>({
    queryKey: qk.walkingRoute(coordKey(origin), coordKey(destination)),
    queryFn: () =>
      fetchWalkingDirections({ origin: origin as RoutePoint, destination: destination as RoutePoint }),
    enabled,
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

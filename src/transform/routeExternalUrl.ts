import type { RoutePoint } from "@/lib/api/endpoints/route";

export function buildKakaoToUrl(
  name: string,
  fallbackName: string,
  destination: RoutePoint,
): string {
  const displayName = name.trim() || fallbackName;
  return `https://map.kakao.com/link/to/${encodeURIComponent(displayName)},${destination.lat},${destination.lng}`;
}

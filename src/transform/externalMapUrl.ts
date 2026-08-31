import type { LatLngPoint } from "@/maps/contracts";

export function buildExternalMapUrl(
  provider: "kakao" | "google" | "unsupported",
  kind: "place" | "directions",
  point: LatLngPoint,
  label = "",
): string | null {
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng) || provider === "unsupported") return null;
  if (provider === "kakao") {
    const suffix = `${encodeURIComponent(label || "location")},${point.lat},${point.lng}`;
    return kind === "directions" ? `https://map.kakao.com/link/to/${suffix}` : `https://map.kakao.com/link/map/${suffix}`;
  }
  const params = new URLSearchParams({ api: "1" });
  if (kind === "directions") {
    params.set("destination", `${point.lat},${point.lng}`);
    params.set("travelmode", "walking");
  } else {
    params.set("query", `${point.lat},${point.lng}`);
  }
  return `https://www.google.com/maps/${kind === "directions" ? "dir/" : "search/"}?${params}`;
}

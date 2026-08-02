import { normalizeCurrentLocationFixTime } from "./currentLocation.js";

export function parseShutdownLocationPayload(payload, nowMs = Date.now()) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;

  const userId = typeof payload.user_id === "string" ? payload.user_id.trim() : "";
  const lat = typeof payload.latitude === "number" ? payload.latitude : Number.NaN;
  const lng = typeof payload.longitude === "number" ? payload.longitude : Number.NaN;
  const accuracyRaw = payload.accuracy ?? payload.accuracy_m;
  const accuracyM = accuracyRaw == null
    ? null
    : typeof accuracyRaw === "number" ? accuracyRaw : Number.NaN;
  const fixTime = normalizeCurrentLocationFixTime(payload.captured_at, nowMs);

  if (!userId
    || !Number.isFinite(lat) || lat < -90 || lat > 90
    || !Number.isFinite(lng) || lng < -180 || lng > 180
    || !fixTime
    || (accuracyM != null && (!Number.isFinite(accuracyM) || accuracyM < 0))) return null;

  return { userId, lat, lng, accuracyM, fixTime };
}

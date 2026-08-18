export type LocationPermissionStage =
  | "closed"
  | "disclosure"
  | "backgroundEducation"
  | "foregroundDenied"
  | "backgroundDenied"
  // 사용 정보 접근(특별 접근) — 부모가 보는 "오늘 많이 쓴 앱"을 처음 설정에서 함께 켠다(2026-08-18).
  | "usageAccess";

export type LocationPermissionEvent =
  | { type: "open" }
  | { type: "foregroundResult"; granted: boolean; supported: boolean }
  | { type: "backgroundResult"; granted: boolean; supported: boolean; usageAccessGranted?: boolean }
  | { type: "usageAccessResult"; granted: boolean }
  | { type: "retry" };

export function advanceLocationPermissionStage(
  stage: LocationPermissionStage,
  event: LocationPermissionEvent,
): LocationPermissionStage {
  if (event.type === "open") return "disclosure";
  if (event.type === "foregroundResult") {
    return event.granted ? "backgroundEducation" : "foregroundDenied";
  }
  if (event.type === "backgroundResult") {
    if (!event.granted) return "backgroundDenied";
    // 이미 켜져 있거나 확인할 수 없는 기기에서는 굳이 한 단계를 더 보여 주지 않는다.
    return event.usageAccessGranted === false ? "usageAccess" : "closed";
  }
  if (event.type === "usageAccessResult") {
    return event.granted ? "closed" : "usageAccess";
  }
  if (event.type === "retry") {
    if (stage === "foregroundDenied") return "disclosure";
    if (stage === "backgroundDenied") return "backgroundEducation";
  }
  return stage;
}

export type ChildLocationStatusKind = "sending" | "off" | "permission";

export function resolveChildLocationStatusKind({
  freshEnough,
  permission,
}: {
  freshEnough: boolean;
  permission: "granted" | "denied" | "unknown";
}): ChildLocationStatusKind {
  if (permission === "denied") return "permission";
  if (permission !== "granted") return "off";
  return freshEnough ? "sending" : "off";
}

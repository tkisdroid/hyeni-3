export type LocationPermissionStage =
  | "closed"
  | "disclosure"
  | "backgroundEducation"
  | "foregroundDenied"
  | "backgroundDenied";

export type LocationPermissionEvent =
  | { type: "open" }
  | { type: "foregroundResult"; granted: boolean; supported: boolean }
  | { type: "backgroundResult"; granted: boolean; supported: boolean }
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
    return event.granted ? "closed" : "backgroundDenied";
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

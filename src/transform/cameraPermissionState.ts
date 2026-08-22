export type CameraPermissionSource = "native" | "browser";
export type CameraPermissionRecovery = "none" | "retry" | "settings";

export interface CameraPermissionState {
  granted: boolean;
  source: CameraPermissionSource;
  recovery: CameraPermissionRecovery;
}

export interface NativeCameraPermissionSnapshot {
  granted?: boolean;
  requested?: boolean;
  shouldShowRationale?: boolean;
}

/** Android 권한 콜백을 사용자가 실제로 복구할 수 있는 UI 상태로 정규화한다. */
export function normalizeNativeCameraPermission(
  snapshot: NativeCameraPermissionSnapshot,
): CameraPermissionState {
  if (snapshot.granted === true) {
    return { granted: true, source: "native", recovery: "none" };
  }
  const permanentlyBlocked = snapshot.requested === true && snapshot.shouldShowRationale !== true;
  return {
    granted: false,
    source: "native",
    recovery: permanentlyBlocked ? "settings" : "retry",
  };
}

/** 웹은 앱 설정 딥링크가 없으므로 거부 상태에서도 브라우저 재시도만 제안한다. */
export function normalizeBrowserCameraPermission(
  state: PermissionState | null | undefined,
): CameraPermissionState {
  return state === "denied"
    ? { granted: false, source: "browser", recovery: "retry" }
    : { granted: true, source: "browser", recovery: "none" };
}

/** 브리지 자체 오류를 영구 거부로 오인해 설정 화면으로 보내지 않는다. */
export function cameraPermissionFailure(source: CameraPermissionSource): CameraPermissionState {
  return { granted: false, source, recovery: "retry" };
}

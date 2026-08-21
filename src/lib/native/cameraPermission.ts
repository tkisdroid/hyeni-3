/**
 * QR 스캔용 카메라 권한(hyeni-1 ChildPairInput.ensureQrCameraPermission 이관).
 * 네이티브(Android)는 커스텀 CameraPermissionPlugin(check/request/openAppSettings)으로
 * 런타임 권한을 처리하고, 웹은 permissions API 로 거부 여부만 조회한다
 * (웹은 getUserMedia 호출 자체가 실제 프롬프트를 띄우므로 기본 통과).
 */
import { getNativePlugin } from "./plugins";
import {
  cameraPermissionFailure,
  normalizeBrowserCameraPermission,
  normalizeNativeCameraPermission,
  type CameraPermissionState,
  type NativeCameraPermissionSnapshot,
} from "@/transform/cameraPermissionState";

interface CameraPermissionPlugin {
  checkPermission: () => Promise<NativeCameraPermissionSnapshot>;
  requestPermission: () => Promise<NativeCameraPermissionSnapshot>;
  openAppSettings: () => Promise<void>;
}

export type CameraPermissionResult = CameraPermissionState;

function plugin(): CameraPermissionPlugin | null {
  return getNativePlugin<CameraPermissionPlugin>("CameraPermission");
}

/** 스캔 시작 전 카메라 권한 확보. 네이티브면 실제 요청까지 수행. */
export async function ensureQrCameraPermission(): Promise<CameraPermissionResult> {
  const native = plugin();
  if (native?.checkPermission && native?.requestPermission) {
    try {
      const checked = await native.checkPermission();
      if (checked?.granted) return normalizeNativeCameraPermission(checked);
      const requested = await native.requestPermission();
      return normalizeNativeCameraPermission(requested);
    } catch (error) {
      console.warn("카메라 권한 요청 실패:", error);
      return cameraPermissionFailure("native");
    }
  }

  try {
    const status = await navigator.permissions?.query?.({ name: "camera" as PermissionName });
    return normalizeBrowserCameraPermission(status?.state);
  } catch {
    // permissions API 미지원 — getUserMedia 가 실제 프롬프트/오류를 낸다
  }
  return normalizeBrowserCameraPermission(null);
}

/** 권한이 영구 거부됐을 때 앱 설정 화면 열기(네이티브 전용, 웹은 no-op). */
export async function openCameraPermissionSettings(): Promise<void> {
  const native = plugin();
  if (native?.openAppSettings) await native.openAppSettings();
}

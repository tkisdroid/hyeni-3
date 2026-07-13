import { getNativePlugin, isNativePlatform } from "./plugins";

export type PermissionKind = "loc" | "noti" | "battery" | "mic";

export interface PermissionState {
  supported: boolean;
  granted: boolean;
}

interface NativeDeliveryHealth {
  notificationsEnabled?: boolean;
  postPermissionGranted?: boolean;
  channelsEnabled?: boolean;
  fullScreenIntentAllowed?: boolean;
  remoteListenChannelEnabled?: boolean;
  batteryOptimizationsIgnored?: boolean;
  recordAudioGranted?: boolean;
}

interface NativeNotificationPermissionPlugin {
  getDeliveryHealth?(): Promise<NativeDeliveryHealth>;
  openSettings?(): Promise<void>;
  openFullScreenIntentSettings?(): Promise<void>;
  openBatteryOptimizationSettings?(): Promise<void>;
  openAppDetailsSettings?(): Promise<void>;
  requestRecordAudio?(): Promise<{ granted?: boolean; requested?: boolean }>;
}

interface NativeLocationPermissionPlugin {
  checkBackgroundLocationPermission?(): Promise<{
    fineLocation?: boolean;
    backgroundLocation?: boolean;
    locationServicesEnabled?: boolean;
  }>;
  requestAlwaysOnLocation?(): Promise<{ granted?: boolean; step?: string }>;
  requestForegroundLocation?(): Promise<{ granted?: boolean; step?: string }>;
  requestBackgroundLocation?(): Promise<{ granted?: boolean; step?: string }>;
  openAppLocationSettings?(): Promise<{ status?: string }>;
  openLocationSettings?(): Promise<{ status?: string }>;
}

export interface StagedLocationPermissionResult {
  supported: boolean;
  granted: boolean;
  step: string;
}

export interface NotificationDeliveryState extends PermissionState {
  notificationsEnabled: boolean | null;
  postPermissionGranted: boolean | null;
  channelsEnabled: boolean | null;
  fullScreenIntentAllowed: boolean | null;
  remoteListenChannelEnabled: boolean | null;
}

const NOTIFICATION_PLUGIN = "NativeNotification";
const LOCATION_PLUGIN = "BackgroundLocation";

function unsupportedNotificationDeliveryState(): NotificationDeliveryState {
  return {
    supported: false,
    granted: false,
    notificationsEnabled: null,
    postPermissionGranted: null,
    channelsEnabled: null,
    fullScreenIntentAllowed: null,
    remoteListenChannelEnabled: null,
  };
}

function normalizeNotificationDeliveryState(
  health: NativeDeliveryHealth,
): NotificationDeliveryState {
  const notificationsEnabled = health.notificationsEnabled === true;
  const postPermissionGranted = health.postPermissionGranted === true;
  const channelsEnabled = health.channelsEnabled === true;
  return {
    supported: true,
    granted: notificationsEnabled && postPermissionGranted && channelsEnabled,
    notificationsEnabled,
    postPermissionGranted,
    channelsEnabled,
    fullScreenIntentAllowed:
      typeof health.fullScreenIntentAllowed === "boolean"
        ? health.fullScreenIntentAllowed
        : null,
    remoteListenChannelEnabled:
      typeof health.remoteListenChannelEnabled === "boolean"
        ? health.remoteListenChannelEnabled
        : null,
  };
}

/** 일반 알림과 Android 14+ 전체화면 특별 접근을 섞지 않고 각각 보고한다. */
export async function readNotificationDeliveryState(): Promise<NotificationDeliveryState> {
  if (!isNativePlatform()) return unsupportedNotificationDeliveryState();
  const plugin = getNativePlugin<NativeNotificationPermissionPlugin>(NOTIFICATION_PLUGIN);
  if (!plugin?.getDeliveryHealth) return unsupportedNotificationDeliveryState();
  try {
    return normalizeNotificationDeliveryState(await plugin.getDeliveryHealth());
  } catch (error) {
    console.error("[permission] 네이티브 알림 상태 확인 실패:", error);
    return unsupportedNotificationDeliveryState();
  }
}

/** 설명 화면의 사용자 버튼에서만 Android 전체화면 특별 접근 설정을 연다. */
export async function openFullScreenIntentSettings(): Promise<boolean> {
  if (!isNativePlatform()) return false;
  const plugin = getNativePlugin<NativeNotificationPermissionPlugin>(NOTIFICATION_PLUGIN);
  if (!plugin?.openFullScreenIntentSettings) return false;
  try {
    await plugin.openFullScreenIntentSettings?.();
    return true;
  } catch (error) {
    console.error("[permission] 잠금화면 전체 표시 설정 열기 실패:", error);
    return false;
  }
}

async function readNativePermissionState(kind: PermissionKind): Promise<PermissionState> {
  if (kind === "loc") {
    const plugin = getNativePlugin<NativeLocationPermissionPlugin>(LOCATION_PLUGIN);
    if (!plugin?.checkBackgroundLocationPermission) return { supported: false, granted: false };
    const state = await plugin.checkBackgroundLocationPermission();
    return {
      supported: true,
      granted:
        state.fineLocation === true &&
        state.backgroundLocation === true &&
        state.locationServicesEnabled === true,
    };
  }

  const plugin = getNativePlugin<NativeNotificationPermissionPlugin>(NOTIFICATION_PLUGIN);
  if (!plugin?.getDeliveryHealth) return { supported: false, granted: false };
  if (kind === "noti") {
    return readNotificationDeliveryState();
  }
  const health = await plugin.getDeliveryHealth();
  if (kind === "battery") {
    return { supported: true, granted: health.batteryOptimizationsIgnored === true };
  }
  return { supported: true, granted: health.recordAudioGranted === true };
}

async function queryWebPermission(name: PermissionName): Promise<PermissionState> {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) {
    return { supported: false, granted: false };
  }
  try {
    const status = await navigator.permissions.query({ name });
    return { supported: true, granted: status.state === "granted" };
  } catch {
    return { supported: false, granted: false };
  }
}

async function readWebPermissionState(kind: PermissionKind): Promise<PermissionState> {
  if (kind === "noti") {
    if (typeof Notification === "undefined") return { supported: false, granted: false };
    return { supported: true, granted: Notification.permission === "granted" };
  }
  if (kind === "loc") return queryWebPermission("geolocation");
  if (kind === "mic") return queryWebPermission("microphone");
  return { supported: false, granted: false };
}

/** OS·브라우저가 현재 보고하는 실제 권한 상태를 읽는다. 조회 실패는 granted로 추정하지 않는다. */
export async function readPermissionState(kind: PermissionKind): Promise<PermissionState> {
  try {
    return isNativePlatform()
      ? await readNativePermissionState(kind)
      : await readWebPermissionState(kind);
  } catch (error) {
    console.error(`[permission] ${kind} 상태 확인 실패:`, error);
    return { supported: false, granted: false };
  }
}

async function requestStagedNativeLocationPermission(
  stage: "foreground" | "background",
): Promise<StagedLocationPermissionResult> {
  const plugin = getNativePlugin<NativeLocationPermissionPlugin>(LOCATION_PLUGIN);
  const request = stage === "foreground"
    ? plugin?.requestForegroundLocation
    : plugin?.requestBackgroundLocation;
  if (!plugin || typeof request !== "function") {
    return { supported: false, granted: false, step: "unsupported" };
  }
  try {
    const result = await request.call(plugin);
    return {
      supported: true,
      granted: result?.granted === true,
      step: typeof result?.step === "string" ? result.step : "unknown",
    };
  } catch (error) {
    console.error(`[permission] ${stage} 위치 권한 요청 실패:`, error);
    return { supported: true, granted: false, step: "error" };
  }
}

/** prominent disclosure 확인 직후 전경 위치만 요청한다. */
export async function requestForegroundLocationPermission(): Promise<StagedLocationPermissionResult> {
  if (!isNativePlatform()) {
    await requestGeolocation();
    const state = await readWebPermissionState("loc");
    return { ...state, step: state.granted ? "foregroundComplete" : "foregroundDenied" };
  }
  return requestStagedNativeLocationPermission("foreground");
}

/** 전경 권한 완료 뒤 별도 교육 화면의 사용자 버튼에서 백그라운드 위치만 요청한다. */
export async function requestBackgroundLocationPermission(): Promise<StagedLocationPermissionResult> {
  if (!isNativePlatform()) return { supported: false, granted: false, step: "unsupported" };
  return requestStagedNativeLocationPermission("background");
}

async function requestNativePermission(kind: PermissionKind): Promise<void> {
  if (kind === "loc") {
    const plugin = getNativePlugin<NativeLocationPermissionPlugin>(LOCATION_PLUGIN);
    if (!plugin) return;
    const before = await plugin.checkBackgroundLocationPermission?.();
    if (before?.locationServicesEnabled === false) {
      await plugin.openLocationSettings?.();
      return;
    }
    const requested = await plugin.requestAlwaysOnLocation?.();
    if (requested?.granted !== true && requested?.step !== "fallbackAppDetails") {
      await plugin.openAppLocationSettings?.();
    }
    return;
  }

  const plugin = getNativePlugin<NativeNotificationPermissionPlugin>(NOTIFICATION_PLUGIN);
  if (!plugin) return;
  if (kind === "noti") {
    await plugin.openSettings?.();
    return;
  }
  if (kind === "battery") {
    await plugin.openBatteryOptimizationSettings?.();
    return;
  }
  const requested = await plugin.requestRecordAudio?.();
  if (requested?.granted !== true) await plugin.openAppDetailsSettings?.();
}

function requestGeolocation(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve();
      return;
    }
    navigator.geolocation.getCurrentPosition(
      () => resolve(),
      () => resolve(),
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 10_000 },
    );
  });
}

async function requestWebPermission(kind: PermissionKind): Promise<void> {
  if (kind === "noti") {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      await Notification.requestPermission();
    }
    return;
  }
  if (kind === "loc") {
    await requestGeolocation();
    return;
  }
  if (kind === "mic" && typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of stream.getTracks()) track.stop();
    } catch {
      // 거부 상태는 아래 readPermissionState 결과로 판정한다.
    }
  }
}

/** 사용자 버튼에서 OS 설정을 열거나 브라우저 권한을 요청한 뒤, 확인된 상태만 반환한다. */
export async function requestOrOpenPermission(kind: PermissionKind): Promise<PermissionState> {
  try {
    if (isNativePlatform()) await requestNativePermission(kind);
    else await requestWebPermission(kind);
  } catch (error) {
    console.error(`[permission] ${kind} 권한 요청 실패:`, error);
  }
  return readPermissionState(kind);
}

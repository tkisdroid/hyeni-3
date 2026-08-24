import { detectDeviceLabel } from "@/lib/native/deviceName";
import { getNativePlugin, getPlatform, isNativePlatform } from "@/lib/native/plugins";

const DEVICE_INSTALL_ID_KEY = "hyeni-device-install-id-v1";
const LOCATION_PLUGIN = "BackgroundLocation";

interface NativePushContext {
  userId?: string;
  familyId?: string;
  role?: string;
  deviceInstallId?: string;
}

interface BackgroundLocationIdentity {
  getPushContext?(): Promise<NativePushContext>;
}

export interface ChildDeviceIdentityHint {
  deviceLabel: string | null;
  deviceInstallId: string;
  previousUserId: string | null;
  previousFamilyId: string | null;
}

export interface AuthDeviceDescriptor {
  device_install_id: string;
  device_label: string | null;
  device_platform: "android" | "ios" | "web";
}

function randomDeviceId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function getOrCreateDeviceInstallId(): string {
  try {
    const existing = window.localStorage.getItem(DEVICE_INSTALL_ID_KEY)?.trim();
    if (existing) return existing;
    const next = randomDeviceId();
    window.localStorage.setItem(DEVICE_INSTALL_ID_KEY, next);
    return next;
  } catch {
    return randomDeviceId();
  }
}

function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// 인증(refresh 회전·로그인)에 싣는 기기 id — refresh 체인 기기 바인딩용.
// Android는 위치·푸시 서비스와 같은 deviceInstallId를 써야 하므로(불일치 시 회전 거부)
// 플러그인 값을 기다린다. iOS 부모 앱에는 해당 Android 서비스가 없으므로 WebView 설치 저장소의
// UUID를 사용한다. 첫 성공 값을 별도 키에 고정해 로그인·refresh·로그아웃이 같은 설치를 가리킨다.
const AUTH_DEVICE_ID_KEY = "hyeni-auth-device-id-v1";
let authDeviceIdMemo: string | null = null;

export async function getAuthDeviceInstallId(): Promise<string | null> {
  if (authDeviceIdMemo) return authDeviceIdMemo;
  try {
    const cached = window.localStorage.getItem(AUTH_DEVICE_ID_KEY)?.trim();
    if (cached) {
      authDeviceIdMemo = cached;
      return cached;
    }
  } catch {
    /* localStorage 접근 불가 → 아래 경로로 */
  }
  let resolved: string | null = null;
  if (isNativePlatform() && getPlatform() === "android") {
    resolved = await resolveAndroidDeviceInstallId();
    if (!resolved) return null; // Android 서비스 id 확보 전엔 다른 id로 체인을 스탬핑하지 않는다.
  } else {
    resolved = getOrCreateDeviceInstallId();
  }
  authDeviceIdMemo = resolved;
  try {
    window.localStorage.setItem(AUTH_DEVICE_ID_KEY, resolved);
  } catch {
    /* 메모리 캐시만 유지 */
  }
  return resolved;
}

/** 로그인·갱신·페어링에 공통으로 싣는 최소 기기 정보. */
export async function getAuthDeviceDescriptor(): Promise<AuthDeviceDescriptor | null> {
  const deviceInstallId = await getAuthDeviceInstallId();
  if (!deviceInstallId) return null;
  const platform = getPlatform();
  return {
    device_install_id: deviceInstallId,
    device_label: detectDeviceLabel(),
    device_platform: platform === "android" || platform === "ios" ? platform : "web",
  };
}

/**
 * 콜드 스타트 직후 Capacitor 브리지가 아직 뜨기 전에 getPushContext 가 실패하면
 * device_install_id 없이 로그인·refresh가 나가 서버가 거부한다(device_identity_required).
 * 짧게 몇 번 재시도해 브리지 기동 경합을 흡수한다(실패는 여전히 null로 fail-closed).
 */
async function resolveAndroidDeviceInstallId(): Promise<string | null> {
  for (const delayMs of [0, 150, 400] as const) {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const native = await readNativePushContext();
    const id = clean(native?.deviceInstallId);
    if (id) return id;
  }
  return null;
}

async function readNativePushContext(): Promise<NativePushContext | null> {
  if (!isNativePlatform()) return null;
  const plugin = getNativePlugin<BackgroundLocationIdentity>(LOCATION_PLUGIN);
  if (!plugin || typeof plugin.getPushContext !== "function") return null;
  try {
    return await plugin.getPushContext();
  } catch (error) {
    console.error("[deviceIdentity] 네이티브 기기 컨텍스트 조회 실패:", error);
    return null;
  }
}

export async function readChildDeviceIdentityHint(): Promise<ChildDeviceIdentityHint> {
  const native = await readNativePushContext();
  const nativeRole = clean(native?.role);
  const nativeDeviceInstallId = clean(native?.deviceInstallId);
  const previousUserId = nativeRole === "child" ? clean(native?.userId) : null;
  const previousFamilyId = nativeRole === "child" ? clean(native?.familyId) : null;
  return {
    deviceLabel: detectDeviceLabel(),
    deviceInstallId: nativeDeviceInstallId ?? getOrCreateDeviceInstallId(),
    previousUserId,
    previousFamilyId,
  };
}

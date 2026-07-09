import { detectDeviceLabel } from "@/lib/native/deviceName";
import { getNativePlugin, isNativePlatform } from "@/lib/native/plugins";

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
// 네이티브에선 반드시 네이티브 서비스와 같은 deviceInstallId 를 써야 하므로(불일치 시 회전 거부),
// 첫 성공 조회를 localStorage 에 고정 캐시하고 이후엔 플러그인 왕복 없이 재사용한다.
// 네이티브 플러그인 조회가 실패한 시점엔 웹 폴백 id 를 캐시하지 않고 null 을 반환한다
// (스탬핑된 체인에 다른 id 를 제시해 세션이 풀리는 것 방지 — id 없인 레거시 체인만 회전 가능).
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
  if (isNativePlatform()) {
    const native = await readNativePushContext();
    resolved = clean(native?.deviceInstallId);
    if (!resolved) return null; // 네이티브 id 확보 전엔 캐시/폴백 금지
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

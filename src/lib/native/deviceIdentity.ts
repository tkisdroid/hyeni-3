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

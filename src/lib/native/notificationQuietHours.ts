import { getNativePlugin, isNativePlatform } from "./plugins";

export interface NativeQuietHoursInput {
  userId: string;
  enabled: boolean;
  startMinute: number;
  endMinute: number;
  timeZoneId: "Asia/Seoul";
  updatedAtMs: number;
}

interface NativeQuietHoursResult {
  saved?: boolean;
  reason?: string;
}

interface NativeNotificationQuietHoursPlugin {
  setQuietHours(input: NativeQuietHoursInput): Promise<NativeQuietHoursResult>;
}

/** 웹에서는 성공 no-op, Android에서는 현재 세션에 저장된 경우에만 true를 반환한다. */
export async function syncNativeNotificationQuietHours(
  input: NativeQuietHoursInput,
): Promise<boolean> {
  if (!isNativePlatform()) return true;
  const plugin = getNativePlugin<NativeNotificationQuietHoursPlugin>("NativeNotification");
  if (!plugin) return false;
  try {
    const result = await plugin.setQuietHours(input);
    return result.saved === true;
  } catch {
    return false;
  }
}

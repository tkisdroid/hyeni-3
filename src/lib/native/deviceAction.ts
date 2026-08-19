/**
 * 기기 동작 화면 열기 브리지(2026-08-18 TK 지시).
 *
 * 앱이 소리·진동·무음을 대신 바꾸거나 전화·문자를 대신 보내지 않는다.
 * AI 친구가 부탁을 받으면 **알맞은 화면만** 열고 마지막 한 번은 아이가 누른다.
 * 무음 전환을 앱이 대신 하면 부모의 SOS·소리 울리기까지 조용해지므로 의도적인 선택이다.
 */
import { getNativePlugin, isNativePlatform } from "./plugins.ts";

export const DEVICE_ACTION_TARGETS = [
  "alarm",
  "sound",
  "wifi",
  "battery",
  "notifications",
  "location",
  "dial",
  "sms",
] as const;

export type DeviceActionTarget = (typeof DEVICE_ACTION_TARGETS)[number];

export function isDeviceActionTarget(value: unknown): value is DeviceActionTarget {
  return typeof value === "string" && (DEVICE_ACTION_TARGETS as readonly string[]).includes(value);
}

interface NativeDeviceActionPlugin {
  open(options: { target: string; phone?: string; body?: string; hour?: number; minute?: number }): Promise<{
    opened?: boolean;
    reason?: string;
    fallback?: boolean;
  }>;
}

export interface DeviceActionResult {
  /** 화면이 실제로 열렸는지. */
  opened: boolean;
  /** 열지 못한 이유(웹이거나 그 화면이 없는 기기). */
  reason?: "unsupported_platform" | "unsupported_target" | "no_activity" | "failed";
}

/** tel:/sms: 에 안전한 문자만 남긴다(서버가 준 값도 다시 좁힌다). */
function sanitizePhone(raw: string | null | undefined): string {
  return typeof raw === "string" ? raw.replace(/[^0-9+]/g, "") : "";
}

/**
 * 웹에서는 설정 화면을 열 수 없다. 전화·문자만 브라우저 기본 동작으로 넘기고,
 * 나머지는 열지 못했다고 정직하게 알린다(연 척하지 않는다).
 */
function openOnWeb(target: DeviceActionTarget, phone: string): DeviceActionResult {
  if (typeof window === "undefined") return { opened: false, reason: "unsupported_platform" };
  if (target === "dial") {
    window.location.href = `tel:${phone}`;
    return { opened: true };
  }
  if (target === "sms") {
    window.location.href = `sms:${phone}`;
    return { opened: true };
  }
  return { opened: false, reason: "unsupported_platform" };
}

export async function openDeviceAction(input: {
  target: DeviceActionTarget;
  phone?: string | null;
  body?: string | null;
  hour?: number | null;
  minute?: number | null;
}): Promise<DeviceActionResult> {
  if (!isDeviceActionTarget(input.target)) return { opened: false, reason: "unsupported_target" };
  const phone = sanitizePhone(input.phone);
  const alarmTime = Number.isInteger(input.hour) && Number.isInteger(input.minute)
    && Number(input.hour) >= 0 && Number(input.hour) <= 23
    && Number(input.minute) >= 0 && Number(input.minute) <= 59
    ? { hour: Number(input.hour), minute: Number(input.minute) }
    : null;
  if (!isNativePlatform()) return openOnWeb(input.target, phone);

  const plugin = getNativePlugin<NativeDeviceActionPlugin>("DeviceAction");
  if (!plugin?.open) return openOnWeb(input.target, phone);
  try {
    const result = await plugin.open({
      target: input.target,
      ...(phone ? { phone } : {}),
      ...(input.body ? { body: input.body } : {}),
      ...(input.target === "alarm" && alarmTime ? alarmTime : {}),
    });
    if (result?.opened === true) return { opened: true };
    return { opened: false, reason: result?.reason === "no_activity" ? "no_activity" : "failed" };
  } catch (error) {
    console.error("[deviceAction] 기기 화면 열기 실패:", error);
    return { opened: false, reason: "failed" };
  }
}

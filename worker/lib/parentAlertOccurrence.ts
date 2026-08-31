import { parentAlertPendingTtlMs } from "./notificationRouting";

const REGISTERED_PLACE_ALERT_TYPES = new Set(["place_arrived", "place_left"]);
const MAX_FUTURE_SKEW_MS = 10 * 60_000;
const KST_OFFSET_MS = 9 * 60 * 60_000;

export interface PreparedRegisteredPlaceAlertOccurrence {
  message: string;
  occurredAt: string | null;
  expiresAt: string | null;
  expired: boolean;
}

export type RegisteredPlaceAlertOccurrenceTiming = Omit<
  PreparedRegisteredPlaceAlertOccurrence,
  "message"
>;

function normalizedNowMs(value: number): number {
  return Number.isFinite(value) ? value : Date.now();
}

function parseOccurredAtMs(value: unknown, nowMs: number): number {
  const parsed = typeof value === "number" ? value : Date.parse(String(value ?? ""));
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > nowMs + MAX_FUTURE_SKEW_MS) return nowMs;
  return parsed;
}

function formatKoreanClock(ms: number): string {
  const kst = new Date(ms + KST_OFFSET_MS);
  const hour24 = kst.getUTCHours();
  const period = hour24 < 12 ? "오전" : "오후";
  const hour12 = hour24 % 12 || 12;
  const minute = String(kst.getUTCMinutes()).padStart(2, "0");
  return `${period} ${hour12}:${minute}`;
}

/** 등록장소 출입의 실제 사건 시각과 표시 만료 시각을 모든 전달 채널이 공유한다. */
export function resolveRegisteredPlaceAlertOccurrenceTiming(input: {
  alertType: string;
  occurredAt: unknown;
  nowMs: number;
}): RegisteredPlaceAlertOccurrenceTiming {
  const alertType = String(input.alertType ?? "").trim().toLowerCase();
  if (!REGISTERED_PLACE_ALERT_TYPES.has(alertType)) {
    return { occurredAt: null, expiresAt: null, expired: false };
  }

  const nowMs = normalizedNowMs(input.nowMs);
  const occurredAtMs = parseOccurredAtMs(input.occurredAt, nowMs);
  const expiresAtMs = occurredAtMs + parentAlertPendingTtlMs(alertType);
  return {
    occurredAt: new Date(occurredAtMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    expired: expiresAtMs <= nowMs,
  };
}

/** 등록장소 출입만 실제 episode 시각을 문구와 pending 만료의 공통 기준으로 쓴다. */
export function prepareRegisteredPlaceAlertOccurrence(input: {
  alertType: string;
  message: string;
  occurredAt: unknown;
  nowMs: number;
}): PreparedRegisteredPlaceAlertOccurrence {
  const alertType = String(input.alertType ?? "").trim().toLowerCase();
  const message = String(input.message ?? "");
  const timing = resolveRegisteredPlaceAlertOccurrenceTiming(input);
  if (!timing.occurredAt) return { message, ...timing };
  const occurredAtMs = Date.parse(timing.occurredAt);
  return {
    message: `${formatKoreanClock(occurredAtMs)}에 ${message}`,
    ...timing,
  };
}

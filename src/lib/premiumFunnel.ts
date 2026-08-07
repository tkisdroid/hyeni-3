import { APP_VERSION } from "../config/version.ts";
import type { PremiumUpsellSource } from "@/transform/premiumUpsell";

export type PremiumFunnelTier = "free" | "premium" | "unknown";
export type PremiumPlan = "month" | "year";
export type PremiumPaymentProvider = "google_play" | "toss_payments";
export type PremiumSubscriptionSource = PremiumUpsellSource | "direct";
export type PremiumCheckoutErrorCode =
  | "purchase_canceled"
  | "purchase_pending"
  | "product_unavailable"
  | "product_offer_unavailable"
  | "billing_unavailable"
  | "verification_failed"
  | "network_error"
  | "unknown";

type PaywallEventName =
  | "paywall_impression"
  | "paywall_continue_free"
  | "paywall_cta";

export type PremiumFunnelEvent =
  | {
      event: PaywallEventName;
      source: PremiumUpsellSource;
      tier: PremiumFunnelTier;
    }
  | {
      event: "subscription_view";
      source: PremiumSubscriptionSource;
    }
  | {
      event: "product_query_result";
      provider: PremiumPaymentProvider;
      result: "success" | "fail";
    }
  | {
      event: "checkout_start";
      plan: PremiumPlan;
      provider: PremiumPaymentProvider;
    }
  | {
      event: "checkout_result";
      result: "success" | "fail" | "cancel";
      provider: PremiumPaymentProvider;
      error_code: PremiumCheckoutErrorCode | null;
    }
  | {
      event: "subscription_cancel_requested";
      provider: PremiumPaymentProvider;
    };

export type PremiumFunnelTransportEvent = PremiumFunnelEvent & {
  event_id: string;
  app_version: string;
  occurred_at: string;
};

type PremiumFunnelTransport = (
  events: readonly PremiumFunnelTransportEvent[],
) => Promise<void>;

const PAYWALL_SOURCES = new Set<PremiumUpsellSource>([
  "second_child",
  "saved_place",
  "danger_zone",
  "location_request",
  "location_history",
  "location_live_interval",
  "remote_ring",
  "remote_audio",
  "ai_friend_limit",
  "ai_schedule_limit",
  "ai_daily_summary",
  "weekly_report",
  "academy_schedule",
  "first_location",
  "first_arrival",
]);
const SUBSCRIPTION_SOURCES = new Set<PremiumSubscriptionSource>([
  ...PAYWALL_SOURCES,
  "direct",
]);
const FUNNEL_TIERS = new Set<PremiumFunnelTier>(["free", "premium", "unknown"]);
const PROVIDERS = new Set<PremiumPaymentProvider>(["google_play", "toss_payments"]);
const PLANS = new Set<PremiumPlan>(["month", "year"]);
const CHECKOUT_ERROR_CODES = new Set<PremiumCheckoutErrorCode>([
  "purchase_canceled",
  "purchase_pending",
  "product_unavailable",
  "product_offer_unavailable",
  "billing_unavailable",
  "verification_failed",
  "network_error",
  "unknown",
]);
const PAYWALL_EVENTS = new Set<PaywallEventName>([
  "paywall_impression",
  "paywall_continue_free",
  "paywall_cta",
]);
const APP_VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,31}$/;

export const MAX_BUFFERED_EVENTS = 100;
export const MAX_TRANSPORT_BATCH_SIZE = 20;
const bufferedEvents: PremiumFunnelTransportEvent[] = [];
let flushInFlight: Promise<void> | null = null;
let flushRequested = false;

async function defaultTransport(events: readonly PremiumFunnelTransportEvent[]): Promise<void> {
  const { submitPremiumFunnelEvents } = await import("@/lib/api/endpoints/premiumFunnel");
  await submitPremiumFunnelEvents(events);
}

let transport: PremiumFunnelTransport = defaultTransport;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return keys.length === sortedExpected.length
    && keys.every((key, index) => key === sortedExpected[index]);
}

function isPremiumFunnelEvent(value: unknown): value is PremiumFunnelEvent {
  if (!isRecord(value) || typeof value.event !== "string") return false;

  if (PAYWALL_EVENTS.has(value.event as PaywallEventName)) {
    return hasExactKeys(value, ["event", "source", "tier"])
      && PAYWALL_SOURCES.has(value.source as PremiumUpsellSource)
      && FUNNEL_TIERS.has(value.tier as PremiumFunnelTier);
  }
  if (value.event === "subscription_view") {
    return hasExactKeys(value, ["event", "source"])
      && SUBSCRIPTION_SOURCES.has(value.source as PremiumSubscriptionSource);
  }
  if (value.event === "product_query_result") {
    return hasExactKeys(value, ["event", "provider", "result"])
      && PROVIDERS.has(value.provider as PremiumPaymentProvider)
      && (value.result === "success" || value.result === "fail");
  }
  if (value.event === "checkout_start") {
    return hasExactKeys(value, ["event", "plan", "provider"])
      && PLANS.has(value.plan as PremiumPlan)
      && PROVIDERS.has(value.provider as PremiumPaymentProvider);
  }
  if (value.event === "checkout_result") {
    if (!hasExactKeys(value, ["event", "result", "provider", "error_code"])) return false;
    if (!PROVIDERS.has(value.provider as PremiumPaymentProvider)) return false;
    if (value.result === "success") return value.error_code === null;
    if (value.result === "cancel") return value.error_code === "purchase_canceled";
    return value.result === "fail"
      && CHECKOUT_ERROR_CODES.has(value.error_code as PremiumCheckoutErrorCode)
      && value.error_code !== "purchase_canceled";
  }
  if (value.event === "subscription_cancel_requested") {
    return hasExactKeys(value, ["event", "provider"])
      && PROVIDERS.has(value.provider as PremiumPaymentProvider);
  }
  return false;
}

function createEventId(): string | null {
  try {
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  } catch {
    return null;
  }
}

function removeDelivered(delivered: readonly PremiumFunnelTransportEvent[]): void {
  const ids = new Set(delivered.map((event) => event.event_id));
  const pending = bufferedEvents.filter((event) => !ids.has(event.event_id));
  bufferedEvents.splice(0, bufferedEvents.length, ...pending);
}

async function runFlushLoop(): Promise<void> {
  while (bufferedEvents.length > 0) {
    flushRequested = false;
    const batch = bufferedEvents
      .slice(0, MAX_TRANSPORT_BATCH_SIZE)
      .map((event) => ({ ...event }));
    try {
      await transport(batch);
      removeDelivered(batch);
    } catch {
      // 별도 타이머를 만들지 않는다. 실패 중 새 기록이 들어온 경우에만 즉시 한 번 더 시도한다.
      if (!flushRequested) return;
    }
  }
}

function requestFlush(): Promise<void> {
  flushRequested = true;
  if (!flushInFlight) {
    flushInFlight = runFlushLoop().finally(() => {
      flushInFlight = null;
      if (flushRequested && bufferedEvents.length > 0) void requestFlush();
    });
  }
  return flushInFlight;
}

/**
 * 입력을 작은 고정 이벤트로 검증하고 메모리 큐에 넣는다.
 * 분석 전송은 비동기로 분리되어 호출한 기능의 성공·실패를 바꾸지 않는다.
 */
export function recordPremiumFunnelEvent(value: unknown): boolean {
  if (!isPremiumFunnelEvent(value) || !APP_VERSION_PATTERN.test(APP_VERSION)) return false;
  const eventId = createEventId();
  if (!eventId) return false;
  bufferedEvents.push({
    ...value,
    event_id: eventId,
    app_version: APP_VERSION,
    occurred_at: new Date().toISOString(),
  });
  if (bufferedEvents.length > MAX_BUFFERED_EVENTS) {
    bufferedEvents.splice(0, bufferedEvents.length - MAX_BUFFERED_EVENTS);
  }
  void requestFlush();
  return true;
}

/** 현재 런타임에서 아직 전달되지 않은 사본. 호출자가 바꿔도 내부 큐에는 영향이 없다. */
export function readPremiumFunnelEvents(): PremiumFunnelTransportEvent[] {
  return bufferedEvents.map((entry) => ({ ...entry }));
}

/** 단위 테스트 간 메모리 큐를 격리한다. */
export function clearPremiumFunnelEventsForTests(): void {
  bufferedEvents.splice(0, bufferedEvents.length);
  flushRequested = false;
  transport = defaultTransport;
}

/** 테스트에서 네트워크 경계를 결정적으로 대체한다. */
export function setPremiumFunnelTransportForTests(next: PremiumFunnelTransport): void {
  transport = next;
}

/** 현재 진행 중인 전송이 끝날 때까지만 기다린다. 새 재시도 타이머는 만들지 않는다. */
export async function flushPremiumFunnelEventsForTests(): Promise<void> {
  if (flushInFlight) {
    await flushInFlight;
    return;
  }
  if (bufferedEvents.length > 0) await requestFlush();
}

type ErrorLike = {
  code?: unknown;
  error?: unknown;
  message?: unknown;
  status?: unknown;
  data?: { code?: unknown };
};

export interface PremiumCheckoutFailure {
  result: "fail" | "cancel";
  error_code: PremiumCheckoutErrorCode;
}

const KNOWN_MESSAGE_CODES = new Map<string, PremiumCheckoutErrorCode>([
  ["구매가 취소되었어요.", "purchase_canceled"],
  ["결제 승인이 대기 중입니다. 승인 완료 후 다시 확인해 주세요.", "purchase_pending"],
  ["Google Play 상품 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.", "product_unavailable"],
  ["이 기기에서 Google Play 결제를 사용할 수 없어요.", "billing_unavailable"],
]);

/** 결제 예외의 자유문구를 버리고 작은 고정 코드만 반환한다. */
export function classifyPremiumCheckoutFailure(error: unknown): PremiumCheckoutFailure {
  const candidate = isRecord(error) ? error as ErrorLike : null;
  const rawCode = candidate?.data?.code ?? candidate?.code ?? candidate?.error;
  let errorCode = typeof rawCode === "string" && CHECKOUT_ERROR_CODES.has(rawCode as PremiumCheckoutErrorCode)
    ? rawCode as PremiumCheckoutErrorCode
    : null;

  if (!errorCode && typeof candidate?.message === "string") {
    errorCode = KNOWN_MESSAGE_CODES.get(candidate.message) ?? null;
  }
  if (!errorCode && error instanceof TypeError) errorCode = "network_error";
  if (!errorCode && typeof candidate?.status === "number") errorCode = "verification_failed";
  if (!errorCode) errorCode = "unknown";

  return errorCode === "purchase_canceled"
    ? { result: "cancel", error_code: errorCode }
    : { result: "fail", error_code: errorCode };
}

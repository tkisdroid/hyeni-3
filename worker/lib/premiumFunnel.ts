import type { Env } from "../types";

export const MAX_PREMIUM_FUNNEL_PAYLOAD_BYTES = 16_384;
export const MAX_PREMIUM_FUNNEL_BATCH_SIZE = 20;
export const MAX_PREMIUM_FUNNEL_EVENTS_PER_HOUR = 600;
export const PREMIUM_FUNNEL_PAST_SKEW_MS = 7 * 24 * 60 * 60_000;
export const PREMIUM_FUNNEL_FUTURE_SKEW_MS = 10 * 60_000;

const CLIENT_EVENT_NAMES = new Set([
  "paywall_impression",
  "paywall_continue_free",
  "paywall_cta",
  "subscription_view",
  "product_query_result",
  "checkout_start",
  "checkout_result",
  "subscription_cancel_requested",
]);
const SERVER_EVENT_NAMES = new Set([
  "entitlement_activated",
  "trial_start",
  "renewal",
  "refund",
]);
const PAYWALL_EVENT_NAMES = new Set([
  "paywall_impression",
  "paywall_continue_free",
  "paywall_cta",
]);
const PAYWALL_SOURCES = new Set([
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
const SUBSCRIPTION_SOURCES = new Set([...PAYWALL_SOURCES, "direct"]);
const TIERS = new Set(["free", "premium", "unknown"]);
const PROVIDERS = new Set(["google_play", "toss_payments"]);
const PLANS = new Set(["month", "year"]);
const CHECKOUT_RESULTS = new Set(["success", "fail", "cancel"]);
const PRODUCT_QUERY_RESULTS = new Set(["success", "fail"]);
const CHECKOUT_ERROR_CODES = new Set([
  "purchase_canceled",
  "purchase_pending",
  "product_unavailable",
  "product_offer_unavailable",
  "billing_unavailable",
  "verification_failed",
  "network_error",
  "unknown",
]);
const CLIENT_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SERVER_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[45][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APP_VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,31}$/;
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const HMAC_FAMILY_DOMAIN = "hyeni:premium-funnel:v1:family";
const HMAC_EVENT_DOMAIN = "hyeni:premium-funnel:v1:event";

export interface NormalizedPremiumFunnelEvent {
  event_id: string;
  event: string;
  source: string | null;
  tier: string | null;
  provider: string | null;
  plan: string | null;
  result: string | null;
  error_code: string | null;
  app_version: string | null;
  occurred_at: string;
}

export type PremiumFunnelPayloadResult =
  | { ok: true; events: NormalizedPremiumFunnelEvent[] }
  | { ok: false; error: "invalid_premium_funnel_batch" | "invalid_premium_funnel_event" };

export type PremiumFunnelJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; error: "payload_too_large" | "invalid_json" };

export interface ServerPremiumFunnelEventInput {
  event_id: string;
  family_id: string;
  event: "entitlement_activated" | "trial_start" | "renewal" | "refund";
  provider: "google_play" | "toss_payments";
  plan: "month" | "year";
  occurred_at: string;
}

export type ServerPremiumFunnelRecordResult =
  | { stored: true; duplicate: boolean }
  | { stored: false; reason: "not_configured" | "invalid_input" | "storage_unavailable" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return keys.length === sortedExpected.length
    && keys.every((key, index) => key === sortedExpected[index]);
}

function isAllowedInstant(value: unknown, nowMs: number): value is string {
  if (typeof value !== "string" || !ISO_INSTANT_PATTERN.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed)
    && new Date(parsed).toISOString() === value
    && parsed >= nowMs - PREMIUM_FUNNEL_PAST_SKEW_MS
    && parsed <= nowMs + PREMIUM_FUNNEL_FUTURE_SKEW_MS;
}

function normalizeClientEvent(
  value: unknown,
  nowMs: number,
): NormalizedPremiumFunnelEvent | null {
  if (!isRecord(value) || typeof value.event !== "string" || !CLIENT_EVENT_NAMES.has(value.event)) {
    return null;
  }
  if (
    typeof value.event_id !== "string"
    || !CLIENT_UUID_PATTERN.test(value.event_id)
    || typeof value.app_version !== "string"
    || !APP_VERSION_PATTERN.test(value.app_version)
    || !isAllowedInstant(value.occurred_at, nowMs)
  ) {
    return null;
  }

  const base = ["event_id", "event", "app_version", "occurred_at"];
  let source: string | null = null;
  let tier: string | null = null;
  let provider: string | null = null;
  let plan: string | null = null;
  let result: string | null = null;
  let errorCode: string | null = null;

  if (PAYWALL_EVENT_NAMES.has(value.event)) {
    if (
      !hasExactKeys(value, [...base, "source", "tier"])
      || typeof value.source !== "string"
      || !PAYWALL_SOURCES.has(value.source)
      || typeof value.tier !== "string"
      || !TIERS.has(value.tier)
    ) return null;
    source = value.source;
    tier = value.tier;
  } else if (value.event === "subscription_view") {
    if (
      !hasExactKeys(value, [...base, "source"])
      || typeof value.source !== "string"
      || !SUBSCRIPTION_SOURCES.has(value.source)
    ) return null;
    source = value.source;
  } else if (value.event === "product_query_result") {
    if (
      !hasExactKeys(value, [...base, "provider", "result"])
      || typeof value.provider !== "string"
      || !PROVIDERS.has(value.provider)
      || typeof value.result !== "string"
      || !PRODUCT_QUERY_RESULTS.has(value.result)
    ) return null;
    provider = value.provider;
    result = value.result;
  } else if (value.event === "checkout_start") {
    if (
      !hasExactKeys(value, [...base, "provider", "plan"])
      || typeof value.provider !== "string"
      || !PROVIDERS.has(value.provider)
      || typeof value.plan !== "string"
      || !PLANS.has(value.plan)
    ) return null;
    provider = value.provider;
    plan = value.plan;
  } else if (value.event === "checkout_result") {
    if (
      !hasExactKeys(value, [...base, "provider", "result", "error_code"])
      || typeof value.provider !== "string"
      || !PROVIDERS.has(value.provider)
      || typeof value.result !== "string"
      || !CHECKOUT_RESULTS.has(value.result)
    ) return null;
    const validError = value.result === "success"
      ? value.error_code === null
      : value.result === "cancel"
        ? value.error_code === "purchase_canceled"
        : typeof value.error_code === "string"
          && CHECKOUT_ERROR_CODES.has(value.error_code)
          && value.error_code !== "purchase_canceled";
    if (!validError) return null;
    provider = value.provider;
    result = value.result;
    errorCode = typeof value.error_code === "string" ? value.error_code : null;
  } else if (value.event === "subscription_cancel_requested") {
    if (
      !hasExactKeys(value, [...base, "provider"])
      || typeof value.provider !== "string"
      || !PROVIDERS.has(value.provider)
    ) return null;
    provider = value.provider;
  } else {
    return null;
  }

  return {
    event_id: value.event_id,
    event: value.event,
    source,
    tier,
    provider,
    plan,
    result,
    error_code: errorCode,
    app_version: value.app_version,
    occurred_at: value.occurred_at,
  };
}

export function normalizePremiumFunnelPayload(
  value: unknown,
  now = new Date(),
): PremiumFunnelPayloadResult {
  if (!isRecord(value) || !hasExactKeys(value, ["events"]) || !Array.isArray(value.events)) {
    return { ok: false, error: "invalid_premium_funnel_batch" };
  }
  if (value.events.length < 1 || value.events.length > MAX_PREMIUM_FUNNEL_BATCH_SIZE) {
    return { ok: false, error: "invalid_premium_funnel_batch" };
  }
  const normalized = value.events.map((event) => normalizeClientEvent(event, now.getTime()));
  if (normalized.some((event) => event === null)) {
    return { ok: false, error: "invalid_premium_funnel_event" };
  }
  const events = normalized as NormalizedPremiumFunnelEvent[];
  if (new Set(events.map((event) => event.event_id)).size !== events.length) {
    return { ok: false, error: "invalid_premium_funnel_batch" };
  }
  return { ok: true, events };
}

export async function readBoundedPremiumFunnelJson(
  request: Request,
): Promise<PremiumFunnelJsonResult> {
  const declaredLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PREMIUM_FUNNEL_PAYLOAD_BYTES) {
    return { ok: false, error: "payload_too_large" };
  }
  const reader = request.body?.getReader();
  if (!reader) return { ok: false, error: "invalid_json" };
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
  let total = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > MAX_PREMIUM_FUNNEL_PAYLOAD_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // 본문 크기 초과 판정이 스트림 취소 실패로 400으로 바뀌면 안 된다.
        }
        return { ok: false, error: "payload_too_large" };
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, error: "invalid_json" };
  }
}

export function isPremiumFunnelConfigured(secret: string | undefined): boolean {
  if (typeof secret !== "string") return false;
  return new TextEncoder().encode(secret.trim()).byteLength >= 32;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret.trim()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function hmac(secret: string, domain: string, value: string): Promise<Uint8Array> {
  if (!isPremiumFunnelConfigured(secret)) throw new Error("premium_funnel_not_configured");
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${domain}\0${value}`),
  );
  return new Uint8Array(signature);
}

export async function hashPremiumFunnelFamily(secret: string, familyId: string): Promise<string> {
  const signature = await hmac(secret, HMAC_FAMILY_DOMAIN, familyId);
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createServerPremiumFunnelEventId(
  secret: string,
  stableKey: string,
): Promise<string> {
  if (!stableKey || stableKey.length > 4_096) throw new Error("invalid_premium_funnel_stable_key");
  const signature = await hmac(secret, HMAC_EVENT_DOMAIN, stableKey);
  const bytes = signature.slice(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function premiumFunnelRateWindow(now: Date): string {
  return now.toISOString().slice(0, 13);
}

async function claimPremiumFunnelRateLimit(
  db: D1Database,
  familyKey: string,
  increment: number,
  now: Date,
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO premium_funnel_rate_limits
         (family_key, window_key, event_count, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(family_key, window_key) DO UPDATE SET
         event_count = premium_funnel_rate_limits.event_count + excluded.event_count,
         updated_at = excluded.updated_at
       WHERE premium_funnel_rate_limits.event_count + excluded.event_count <= ?`,
    )
    .bind(
      familyKey,
      premiumFunnelRateWindow(now),
      increment,
      now.toISOString(),
      MAX_PREMIUM_FUNNEL_EVENTS_PER_HOUR,
    )
    .run();
  return Number(result.meta?.changes ?? 0) === 1;
}

function insertStatement(
  db: D1Database,
  familyKey: string,
  event: NormalizedPremiumFunnelEvent,
  receivedAt: string,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT OR IGNORE INTO premium_funnel_events
         (event_id, family_key, event, source, tier, provider, plan, result,
          error_code, app_version, occurred_at, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      event.event_id,
      familyKey,
      event.event,
      event.source,
      event.tier,
      event.provider,
      event.plan,
      event.result,
      event.error_code,
      event.app_version,
      event.occurred_at,
      receivedAt,
    );
}

export type StoreClientPremiumFunnelResult =
  | { rateLimited: true }
  | { rateLimited: false; accepted: number; duplicates: number };

export async function storeClientPremiumFunnelEvents(
  db: D1Database,
  familyKey: string,
  events: readonly NormalizedPremiumFunnelEvent[],
  now = new Date(),
): Promise<StoreClientPremiumFunnelResult> {
  const placeholders = events.map(() => "?").join(",");
  const existingRows = await db
    .prepare(`SELECT event_id FROM premium_funnel_events WHERE event_id IN (${placeholders})`)
    .bind(...events.map((event) => event.event_id))
    .all<{ event_id: string }>();
  const existing = new Set((existingRows.results ?? []).map((row) => row.event_id));
  const fresh = events.filter((event) => !existing.has(event.event_id));
  if (fresh.length === 0) {
    return { rateLimited: false, accepted: 0, duplicates: events.length };
  }
  if (!(await claimPremiumFunnelRateLimit(db, familyKey, fresh.length, now))) {
    return { rateLimited: true };
  }
  const results = await db.batch(
    fresh.map((event) => insertStatement(db, familyKey, event, now.toISOString())),
  );
  const accepted = results.reduce(
    (sum, result) => sum + Number(result.meta?.changes ?? 0),
    0,
  );
  return {
    rateLimited: false,
    accepted,
    duplicates: events.length - accepted,
  };
}

function normalizeServerInput(
  value: unknown,
  now: Date,
): { familyId: string; event: NormalizedPremiumFunnelEvent } | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    "event_id",
    "family_id",
    "event",
    "provider",
    "plan",
    "occurred_at",
  ])) return null;
  if (
    typeof value.event_id !== "string"
    || !SERVER_UUID_PATTERN.test(value.event_id)
    || typeof value.family_id !== "string"
    || value.family_id.length < 1
    || value.family_id.length > 128
    || typeof value.event !== "string"
    || !SERVER_EVENT_NAMES.has(value.event)
    || typeof value.provider !== "string"
    || !PROVIDERS.has(value.provider)
    || typeof value.plan !== "string"
    || !PLANS.has(value.plan)
    || !isAllowedInstant(value.occurred_at, now.getTime())
  ) return null;
  return {
    familyId: value.family_id,
    event: {
      event_id: value.event_id,
      event: value.event,
      source: null,
      tier: null,
      provider: value.provider,
      plan: value.plan,
      result: null,
      error_code: null,
      app_version: null,
      occurred_at: value.occurred_at,
    },
  };
}

/** 결제 정본 경로가 호출하는 fail-soft 기록 API. 반환값과 무관하게 결제를 계속한다. */
export async function recordServerPremiumFunnelEvent(
  env: Pick<Env, "DB" | "PREMIUM_FUNNEL_HASH_SECRET"> | { DB: D1Database; PREMIUM_FUNNEL_HASH_SECRET?: string },
  input: ServerPremiumFunnelEventInput,
  now = new Date(),
): Promise<ServerPremiumFunnelRecordResult> {
  if (!isPremiumFunnelConfigured(env.PREMIUM_FUNNEL_HASH_SECRET)) {
    return { stored: false, reason: "not_configured" };
  }
  const normalized = normalizeServerInput(input, now);
  if (!normalized) return { stored: false, reason: "invalid_input" };
  try {
    const familyKey = await hashPremiumFunnelFamily(
      env.PREMIUM_FUNNEL_HASH_SECRET as string,
      normalized.familyId,
    );
    const result = await insertStatement(
      env.DB,
      familyKey,
      normalized.event,
      now.toISOString(),
    ).run();
    return {
      stored: true,
      duplicate: Number(result.meta?.changes ?? 0) !== 1,
    };
  } catch {
    return { stored: false, reason: "storage_unavailable" };
  }
}

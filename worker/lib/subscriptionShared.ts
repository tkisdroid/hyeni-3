// 구독 webhook/reconcile 공유 헬퍼 — supabase/functions/qonversion-webhook/shared.ts 직역.
// Deno 전용 import(edge-runtime.d.ts)만 제거. 나머지는 Web Crypto·표준 JS 라 Worker 호환.
// subscription-reconcile.ts·qonversion-webhook.ts 가 공유한다.
import { isPremiumSubscriptionState } from "../shared/subscriptionEntitlement.js";

export type SubscriptionStatus = "trial" | "active" | "grace" | "cancelled" | "expired";
export type SubscriptionTier = "free" | "premium";

export function statusToTier(
  status: string | null | undefined,
  trialEndsAt: string | null | undefined = null,
  currentPeriodEnd: string | null | undefined = null,
): SubscriptionTier {
  return isPremiumSubscriptionState(status, trialEndsAt, currentPeriodEnd) ? "premium" : "free";
}

export function normalizeProductId(value: string | null | undefined): "premium_monthly" | "premium_yearly" {
  return value === "premium_yearly" ? "premium_yearly" : "premium_monthly";
}

export function normalizeStatus(value: string | null | undefined): SubscriptionStatus | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "trial_started" || normalized === "trial") return "trial";
  if (
    normalized === "trial_converted" ||
    normalized === "subscription_activated" ||
    normalized === "subscription_started" ||
    normalized === "entitlement_activated" ||
    normalized === "renewed" ||
    normalized === "subscription_renewed"
  ) return "active";
  if (normalized === "grace" || normalized === "grace_period_started" || normalized === "billing_retry") return "grace";
  if (normalized === "subscription_canceled" || normalized === "subscription_cancelled" || normalized === "trial_canceled" || normalized === "trial_cancelled") return "cancelled";
  if (normalized === "subscription_refunded" || normalized === "refunded" || normalized === "trial_expired" || normalized === "subscription_expired") return "expired";
  return null;
}

export function readPath(input: Record<string, unknown>, path: string): unknown {
  let current: unknown = input;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function extractString(input: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = readPath(input, key);
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

export function extractDate(input: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = readPath(input, key);
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    }
  }
  return null;
}

export function extractFamilyId(input: Record<string, unknown>): string | null {
  return extractString(input, [
    "family_id", "familyId", "user_id", "userId", "app_user_id", "appUserId",
    "customer_user_id", "customerUserId", "external_user_id", "externalUserId",
    "original_app_user_id", "originalAppUserId", "qonversion_user_id", "qonversionUserId",
  ]);
}

export function extractEventId(input: Record<string, unknown>, fallback: string): string {
  return extractString(input, [
    "event_id", "eventId", "id", "webhook_id", "webhookId", "notification_id", "notificationId",
  ]) || fallback;
}

export function extractEventType(input: Record<string, unknown>): string | null {
  return extractString(input, [
    "event_type", "eventType", "type", "name", "event", "event_name", "eventName",
  ]);
}

export function mapRemoteStatus(input: Record<string, unknown>): SubscriptionStatus | null {
  const direct = normalizeStatus(extractEventType(input));
  if (direct) return direct;
  const nested = readPath(input, "data") && typeof readPath(input, "data") === "object"
    ? (readPath(input, "data") as Record<string, unknown>)
    : readPath(input, "payload") && typeof readPath(input, "payload") === "object"
      ? (readPath(input, "payload") as Record<string, unknown>)
      : null;
  if (nested) {
    const nestedStatus = extractString(nested, [
      "status", "subscription_status", "subscriptionStatus", "event_type", "eventType", "type",
    ]);
    return normalizeStatus(nestedStatus);
  }
  return normalizeStatus(extractString(input, ["status", "subscription_status", "subscriptionStatus"]));
}

export function mapProductId(input: Record<string, unknown>): "premium_monthly" | "premium_yearly" {
  const value = extractString(input, [
    "product_id", "productId", "sku", "base_plan_id", "basePlanId",
    "offer_id", "offerId", "plan_id", "planId",
  ]);
  return normalizeProductId(value);
}

export async function hashHex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyHmacSignature(rawBody: string, signatureHex: string, secret: string): Promise<boolean> {
  if (!secret || !signatureHex) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expectedHex = Array.from(new Uint8Array(signed)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return timingSafeEqual(signatureHex.toLowerCase(), expectedHex.toLowerCase());
}

export function getDefaultTrialEndsAt(now = new Date()): string {
  return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
}

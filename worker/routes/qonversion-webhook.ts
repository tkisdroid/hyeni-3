// POST /api/billing/qonversion-webhook  ← supabase/functions/qonversion-webhook (직역).
// Qonversion 결제 이벤트 webhook → family_subscription 상태 갱신.
//
// 인증: HMAC-SHA256 서명 검증(QONVERSION_WEBHOOK_SECRET, raw body).
//   시크릿이 없거나 서명이 틀리면 예외 없이 fail-closed한다.
//
// D1 변환: subscription_webhook_events PK=event_id → 복합/단일 unique 미이관 대체로
//   select-then-insert(중복=duplicate). family_subscription PK=family_id → select-then-write
//   (존재=UPDATE / 부재=INSERT, NOT NULL 컬럼은 DEFAULT 의존). 정본 결제 provider 행은
//   덮어쓰지 않는다(billing-2). payload/raw_event jsonb → JSON.stringify.
import { Hono } from "hono";
import type { Env, Vars } from "../types";
import { pgNow } from "../lib/time";
import { notifyPg } from "../lib/realtime";
import {
  extractDate,
  extractEventId,
  extractEventType,
  extractFamilyId,
  hashHex,
  mapProductId,
  mapRemoteStatus,
  statusToTier,
} from "../lib/subscriptionShared";
import { authorizeQonversionWebhook } from "../shared/qonversionWebhookAuth.js";

// 추가 Secret(메인이 types.ts 로 승격).
type QonversionEnv = Env & {
  QONVERSION_WEBHOOK_SECRET?: string;
  QONVERSION_WEBHOOK_SIGNING_SECRET?: string;
  QONVERSION_WEBHOOK_SIGNATURE_HEADER?: string;
};

const qonversion = new Hono<{ Bindings: Env; Variables: Vars }>();
const CANONICAL_BILLING_PROVIDERS = new Set(["google_play", "toss_web"]);

qonversion.onError((_error, c) => c.json({
  error: "qonversion_webhook_processing_failed",
}, 500));

function canonicalProviderReason(provider: string | null | undefined): string | null {
  return provider && CANONICAL_BILLING_PROVIDERS.has(provider)
    ? `${provider}_owned`
    : null;
}

function readConfig(env: QonversionEnv) {
  return {
    webhookSecret: env.QONVERSION_WEBHOOK_SECRET || env.QONVERSION_WEBHOOK_SIGNING_SECRET || "",
    signatureHeader: env.QONVERSION_WEBHOOK_SIGNATURE_HEADER || "x-qonversion-signature",
  };
}

function parseBody(rawBody: string): Record<string, unknown> {
  try {
    const value = JSON.parse(rawBody);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function unwrapPayload(body: Record<string, unknown>): Record<string, unknown> {
  for (const key of ["data", "payload", "event", "subscription", "entitlement", "webhook"]) {
    const value = body[key];
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  }
  return body;
}

// 원본 buildPatch 직역 — null 도 명시 patch 라 Map 으로 구성(undefined=미설정 구분).
function buildPatch(familyId: string, payload: Record<string, unknown>): Map<string, unknown> {
  const status = mapRemoteStatus(payload);
  const productId = mapProductId(payload);
  const patch = new Map<string, unknown>();
  patch.set("family_id", familyId);
  patch.set("provider", "qonversion");
  patch.set("qonversion_user_id", familyId);
  patch.set("product_id", productId);
  patch.set("raw_event", payload);
  patch.set("last_event_at", new Date().toISOString());

  if (status) {
    patch.set("status", status);
    if (status === "trial") {
      patch.set("trial_ends_at", extractDate(payload, ["trial_ends_at", "trialEndsAt", "trial_end", "trialEnd"]));
      const currentPeriodEnd = extractDate(payload, ["current_period_end", "currentPeriodEnd", "period_ends_at", "periodEndsAt", "expires_at", "expiresAt"]);
      if (currentPeriodEnd) patch.set("current_period_end", currentPeriodEnd);
    } else if (status === "active" || status === "grace") {
      patch.set("trial_ends_at", null);
      const currentPeriodEnd = extractDate(payload, ["current_period_end", "currentPeriodEnd", "period_ends_at", "periodEndsAt", "expires_at", "expiresAt"]);
      if (currentPeriodEnd) patch.set("current_period_end", currentPeriodEnd);
      patch.set("cancelled_at", null);
    } else if (status === "cancelled" || status === "expired") {
      patch.set("trial_ends_at", null);
      const currentPeriodEnd = extractDate(payload, ["current_period_end", "currentPeriodEnd", "period_ends_at", "periodEndsAt", "expires_at", "expiresAt"]);
      if (currentPeriodEnd) patch.set("current_period_end", currentPeriodEnd);
      patch.set("cancelled_at", new Date().toISOString());
    }
  }
  return patch;
}

// GET — 헬스.
qonversion.get("/qonversion-webhook", (c) => {
  const config = readConfig(c.env as QonversionEnv);
  const configured = Boolean(config.webhookSecret);
  return c.json({
    ok: true,
    service: "qonversion-webhook",
    configured,
    accepting: configured,
    primaryProvider: false,
  });
});

qonversion.post("/qonversion-webhook", async (c) => {
  const db = c.env.DB;
  const config = readConfig(c.env as QonversionEnv);

  const rawBody = await c.req.text();
  const payload = unwrapPayload(parseBody(rawBody));

  const signature = c.req.header(config.signatureHeader)
    || c.req.header(config.signatureHeader.toLowerCase())
    || c.req.header("x-qonversion-signature")
    || "";

  const authorization = await authorizeQonversionWebhook({
    rawBody,
    signature,
    secret: config.webhookSecret,
  });
  if (!authorization.ok) {
    return c.json({
      error: authorization.status === 503
        ? "qonversion_webhook_not_configured"
        : "qonversion_webhook_signature_invalid",
    }, authorization.status as 401 | 503);
  }

  const familyId = extractFamilyId(payload);
  if (!familyId) {
    return c.json({ error: "qonversion_family_id_missing" }, 400);
  }

  const eventId = extractEventId(payload, await hashHex(rawBody));
  const eventType = extractEventType(payload) || "unknown";

  // subscription_webhook_events PK=event_id 멱등 — select-then-insert(중복=duplicate).
  const existingEvent = await db
    .prepare("SELECT event_id FROM subscription_webhook_events WHERE event_id = ? LIMIT 1")
    .bind(eventId)
    .first<{ event_id: string }>();
  if (existingEvent) {
    return c.json({ ok: true, duplicate: true, eventId });
  }
  try {
    await db
      .prepare("INSERT INTO subscription_webhook_events (event_id, family_id, event_type, status, payload, received_at) VALUES (?,?,?,?,?,?)")
      .bind(eventId, familyId, eventType, mapRemoteStatus(payload), JSON.stringify(payload), pgNow())
      .run();
  } catch (e) {
    // 동시 삽입 충돌(PK)은 duplicate 로 간주(원본 23505 분기 대응).
    const msg = String(e);
    if (/UNIQUE|constraint/i.test(msg)) {
      return c.json({ ok: true, duplicate: true, eventId });
    }
    return c.json({ error: "qonversion_event_persist_failed" }, 500);
  }

  const patch = buildPatch(familyId, payload);
  if (!patch.has("status")) {
    return c.json({ ok: true, eventId, ignored: true });
  }

  // Google Play·Toss Web 정본 행은 비정본 Qonversion webhook으로 덮어쓰지 않는다.
  const existingSub = await db
    .prepare("SELECT provider FROM family_subscription WHERE family_id = ? LIMIT 1")
    .bind(familyId)
    .first<{ provider: string }>();
  const existingCanonicalReason = canonicalProviderReason(existingSub?.provider);
  if (existingCanonicalReason) {
    return c.json({
      ok: true,
      eventId,
      ignored: true,
      reason: existingCanonicalReason,
    });
  }

  patch.set("last_event_id", eventId);

  try {
    if (existingSub) {
      // UPDATE — patch 키만 갱신(provider 등 미포함 컬럼은 보존, upsert-update 미러).
      const sets: string[] = [];
      const binds: unknown[] = [];
      for (const [k, v] of patch) {
        if (k === "family_id") continue;
        sets.push(`${k} = ?`);
        binds.push(k === "raw_event" ? JSON.stringify(v) : v);
      }
      sets.push("updated_at = ?");
      binds.push(pgNow());
      binds.push(familyId);
      const result = await db.prepare(
        `UPDATE family_subscription SET ${sets.join(", ")}
          WHERE family_id = ? AND provider NOT IN ('google_play','toss_web')`,
      ).bind(...binds).run();
      if (Number(result.meta?.changes ?? 0) !== 1) {
        const current = await db
          .prepare("SELECT provider FROM family_subscription WHERE family_id = ? LIMIT 1")
          .bind(familyId)
          .first<{ provider: string }>();
        const racedCanonicalReason = canonicalProviderReason(current?.provider);
        if (racedCanonicalReason) {
          return c.json({
            ok: true,
            eventId,
            ignored: true,
            reason: racedCanonicalReason,
          });
        }
        throw new Error("family_subscription_update_lost");
      }
    } else {
      // INSERT — Qonversion 소유권(provider)을 명시해 google_play 기본값으로 오염되지 않게 한다.
      const cols: string[] = [];
      const binds: unknown[] = [];
      for (const [k, v] of patch) {
        cols.push(k);
        binds.push(k === "raw_event" ? JSON.stringify(v) : v);
      }
      cols.push("created_at", "updated_at");
      binds.push(pgNow(), pgNow());
      const ph = cols.map(() => "?").join(",");
      await db.prepare(`INSERT INTO family_subscription (${cols.join(",")}) VALUES (${ph})`).bind(...binds).run();
    }
  } catch {
    const current = await db
      .prepare("SELECT provider FROM family_subscription WHERE family_id = ? LIMIT 1")
      .bind(familyId)
      .first<{ provider: string }>()
      .catch(() => null);
    const racedCanonicalReason = canonicalProviderReason(current?.provider);
    if (racedCanonicalReason) {
      return c.json({
        ok: true,
        eventId,
        ignored: true,
        reason: racedCanonicalReason,
      });
    }
    return c.json({ error: "qonversion_subscription_update_failed" }, 500);
  }

  // 부모/자녀 화면 구독 상태 실시간 반영 — onFamilySubscriptionChange 통지(쓰기 성공 후).
  await notifyPg(c.env, familyId, "family_subscription", existingSub ? "UPDATE" : "INSERT",
    { family_id: familyId, status: patch.get("status") }, null);

  return c.json({
    ok: true,
    eventId,
    familyId,
    status: patch.get("status"),
    tier: statusToTier(
      patch.get("status") as string,
      patch.get("trial_ends_at") as string | null | undefined,
      patch.get("current_period_end") as string | null | undefined,
    ),
  });
});

export default qonversion;

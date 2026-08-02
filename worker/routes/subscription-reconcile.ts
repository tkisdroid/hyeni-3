// /api/subscription/reconcile  ← supabase/functions/subscription-reconcile (직역).
// stale 한 family_subscription 행을 Qonversion API 진실원으로 재동기화하는 cron성 잡.
//
// 인증: POST 는 internal-secret(x-internal-secret == PUSH_INTERNAL_SECRET, 상수시간 비교).
//   (원본은 GoTrue verify_jwt 뒤 cron 자가호출. Worker 엔 공유 시크릿으로만 인증 —
//    push-notify 의 내부호출 패턴 재사용.) GET 은 헬스(설정 상태)만 반환, 시크릿 불요.
//
// 외부키 graceful: QONVERSION_API_KEY 없으면 mock 응답(원본 보존). 키 있으면 Qonversion
//   /v3/users/{id}/entitlements 조회.
//
// D1 변환: family_subscription PK=family_id. 원본 upsert(onConflict family_id)는 select 로
//   읽은 행이므로 UPDATE. timestamp 범위비교는 substr(updated_at,1,19) 과 tsNorm 정합.
//   raw_event jsonb → JSON.stringify. provider='google_play' 행은 skip(billing-1).
import { Hono } from "hono";
import type { Env, Vars } from "../types";
import { pgNow, tsNorm } from "../lib/time";
import { notifyPg } from "../lib/realtime";
import { hashHex, mapProductId, mapRemoteStatus, statusToTier } from "../lib/subscriptionShared";

// 추가 Secret(메인이 types.ts 로 승격). 현재 Env 미포함이라 로컬 확장으로 tsc 유지.
type ReconcileEnv = Env & {
  QONVERSION_API_KEY?: string;
  QONVERSION_API_BASE_URL?: string;
  QONVERSION_API_KEY_HEADER?: string;
  QONVERSION_API_KEY_PREFIX?: string;
  QONVERSION_RECONCILE_LOOKBACK_HOURS?: string;
  QONVERSION_RECONCILE_DRY_RUN?: string;
};

const reconcile = new Hono<{ Bindings: Env; Variables: Vars }>();
const CANONICAL_BILLING_PROVIDERS = new Set(["google_play", "toss_web"]);

reconcile.onError((_error, c) => c.json({
  error: "subscription_reconcile_processing_failed",
}, 500));

function readConfig(env: ReconcileEnv) {
  return {
    qonversionApiKey: env.QONVERSION_API_KEY || "",
    qonversionApiBaseUrl: env.QONVERSION_API_BASE_URL || "https://api.qonversion.io",
    qonversionApiKeyHeader: env.QONVERSION_API_KEY_HEADER || "Authorization",
    qonversionApiKeyPrefix: env.QONVERSION_API_KEY_PREFIX || "Bearer",
    lookbackHours: Number(env.QONVERSION_RECONCILE_LOOKBACK_HOURS || "24"),
    dryRun: env.QONVERSION_RECONCILE_DRY_RUN === "1",
  };
}

type Config = ReturnType<typeof readConfig>;

function buildAuthHeader(config: Config): string | null {
  if (!config.qonversionApiKey) return null;
  if (config.qonversionApiKeyHeader.toLowerCase() === "authorization") {
    return config.qonversionApiKeyPrefix + " " + config.qonversionApiKey;
  }
  return config.qonversionApiKey;
}

function unwrapRemote(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const record = input as Record<string, unknown>;
  for (const key of ["data", "entitlements", "active_entitlements", "items", "subscription"]) {
    const value = record[key];
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
    if (Array.isArray(value) && value.length > 0 && value[0] && typeof value[0] === "object") return value[0] as Record<string, unknown>;
  }
  return record;
}

function readIsoDate(input: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    }
  }
  return null;
}

function extractRemoteState(remote: Record<string, unknown>) {
  const status = mapRemoteStatus(remote);
  return {
    status,
    productId: mapProductId(remote),
    trialEndsAt: readIsoDate(remote, ["trial_ends_at", "trialEndsAt", "trial_end", "trialEnd", "expires_at", "expiresAt"]),
    currentPeriodEnd: readIsoDate(remote, ["current_period_end", "currentPeriodEnd", "period_ends_at", "periodEndsAt", "expires_at", "expiresAt", "renewal_date", "renewalDate"]),
  };
}

async function fetchRemoteEntitlement(config: Config, familyId: string) {
  if (!config.qonversionApiKey) {
    return { mock: true, familyId, raw: {} as Record<string, unknown>, ...extractRemoteState({ status: "free" }) };
  }
  const headers: Record<string, string> = { Accept: "application/json" };
  const authHeader = buildAuthHeader(config);
  if (authHeader) headers[config.qonversionApiKeyHeader] = authHeader;

  const response = await fetch(
    config.qonversionApiBaseUrl.replace(/\/$/, "") + "/v3/users/" + encodeURIComponent(familyId) + "/entitlements",
    { headers },
  );
  if (!response.ok) {
    throw new Error("Qonversion API error " + response.status + ": " + await response.text());
  }
  const raw = await response.json();
  const remote = unwrapRemote(raw);
  return { mock: false, familyId, raw: (raw ?? {}) as Record<string, unknown>, ...extractRemoteState(remote) };
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length === 0 || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

// GET — 헬스. configured = QONVERSION_API_KEY 유무.
reconcile.get("/reconcile", (c) => {
  const config = readConfig(c.env as ReconcileEnv);
  return c.json({
    ok: true,
    service: "subscription-reconcile",
    configured: Boolean(config.qonversionApiKey),
    mock: !config.qonversionApiKey,
  });
});

reconcile.post("/reconcile", async (c) => {
  const internalSecret = c.env.PUSH_INTERNAL_SECRET || "";
  const provided = c.req.header("x-internal-secret") || "";
  if (!internalSecret || !timingSafeEqualStr(provided, internalSecret)) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const db = c.env.DB;
  const config = readConfig(c.env as ReconcileEnv);

  // 외부키 graceful — 원본 보존.
  if (!config.qonversionApiKey) {
    return c.json({ ok: true, mock: true, reason: "Missing QONVERSION_API_KEY", checked: 0, reconciled: 0 });
  }

  const staleBeforeIso = new Date(Date.now() - Math.max(1, config.lookbackHours) * 60 * 60 * 1000).toISOString();
  const staleBefore = tsNorm(staleBeforeIso);

  let staleRows: Array<Record<string, any>> = [];
  try {
    const { results } = await db
      .prepare(
        `SELECT family_id, qonversion_user_id, status, product_id, provider, updated_at
           FROM family_subscription
          WHERE substr(updated_at,1,19) < ?
          ORDER BY substr(updated_at,1,19) ASC
          LIMIT 100`,
      )
      .bind(staleBefore)
      .all<Record<string, any>>();
    staleRows = results ?? [];
  } catch {
    return c.json({ error: "subscription_reconcile_load_failed" }, 500);
  }

  if (!staleRows.length) {
    return c.json({ ok: true, checked: 0, reconciled: 0, mock: false });
  }

  let checked = 0;
  let reconciled = 0;
  const results: Array<Record<string, unknown>> = [];

  for (const row of staleRows) {
    // Google Play·Toss Web 정본 행은 비정본 Qonversion 조회 결과로 덮어쓰지 않는다.
    if (CANONICAL_BILLING_PROVIDERS.has(String(row.provider ?? ""))) {
      results.push({ familyId: row.family_id, skipped: `${row.provider}_provider` });
      continue;
    }
    checked += 1;
    const familyId = (row.qonversion_user_id as string) || (row.family_id as string);

    try {
      const remote = await fetchRemoteEntitlement(config, familyId);
      const nextStatus = (remote.status as string) || (row.status as string) || "expired";
      const nextProductId = (remote.productId as string) || (row.product_id as string) || "premium_monthly";

      if (config.dryRun) {
        results.push({
          familyId,
          status: nextStatus,
          tier: statusToTier(nextStatus, remote.trialEndsAt, remote.currentPeriodEnd),
          mock: remote.mock,
          dryRun: true,
        });
        continue;
      }

      const rawEvent = remote.raw || {};
      const lastEventId = "reconcile:" + await hashHex(familyId + ":" + JSON.stringify(rawEvent));
      const now = pgNow();

      // family_id PK 행은 select 로 읽은 것이므로 UPDATE(upsert update 경로).
      const sets: string[] = ["status = ?", "product_id = ?", "qonversion_user_id = ?", "raw_event = ?", "last_event_id = ?", "last_event_at = ?", "updated_at = ?"];
      const binds: unknown[] = [nextStatus, nextProductId, familyId, JSON.stringify(rawEvent), lastEventId, now, now];

      if (nextStatus === "trial") {
        sets.push("trial_ends_at = ?", "current_period_end = ?");
        binds.push(remote.trialEndsAt, remote.currentPeriodEnd);
      } else if (nextStatus === "active" || nextStatus === "grace") {
        sets.push("trial_ends_at = ?", "current_period_end = ?", "cancelled_at = ?");
        binds.push(null, remote.currentPeriodEnd, null);
      } else if (nextStatus === "cancelled") {
        sets.push("trial_ends_at = ?", "current_period_end = ?", "cancelled_at = ?");
        binds.push(null, remote.currentPeriodEnd, now);
      } else if (nextStatus === "expired") {
        sets.push("trial_ends_at = ?", "current_period_end = ?", "cancelled_at = ?");
        binds.push(null, remote.currentPeriodEnd, now);
      }
      binds.push(row.family_id);

      try {
        const result = await db.prepare(
          `UPDATE family_subscription SET ${sets.join(", ")}
            WHERE family_id = ? AND provider NOT IN ('google_play','toss_web')`,
        ).bind(...binds).run();
        if (Number(result.meta?.changes ?? 0) !== 1) {
          const current = await db
            .prepare("SELECT provider FROM family_subscription WHERE family_id = ? LIMIT 1")
            .bind(row.family_id)
            .first<{ provider: string }>();
          if (CANONICAL_BILLING_PROVIDERS.has(String(current?.provider ?? ""))) {
            results.push({
              familyId: row.family_id,
              skipped: `${current?.provider}_provider`,
            });
            continue;
          }
          throw new Error("family_subscription_update_lost");
        }
      } catch {
        results.push({ familyId, error: "subscription_reconcile_update_failed" });
        continue;
      }

      // 구독 상태 실시간 반영 — onFamilySubscriptionChange 통지(PK=row.family_id 룸).
      await notifyPg(c.env, String(row.family_id), "family_subscription", "UPDATE",
        { family_id: row.family_id, status: nextStatus }, null);

      reconciled += 1;
      results.push({
        familyId,
        status: nextStatus,
        tier: statusToTier(nextStatus, remote.trialEndsAt, remote.currentPeriodEnd),
        mock: remote.mock,
      });
    } catch {
      results.push({ familyId, error: "subscription_reconcile_provider_failed" });
    }
  }

  return c.json({ ok: true, checked, reconciled, mock: false, results });
});

export default reconcile;

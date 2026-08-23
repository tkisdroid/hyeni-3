// AI 채팅 surface 데이터 API — Edge Function/PostgREST/RPC → Worker (/api/ai/*).
// src/lib/aiChat.js 의 supabase 직접 호출 17종을 직역한다(설정·크레딧·메모리·기록·안전 read/write).
// 기존 ai 라우트(/voice-parse·/day-summary·/child-monitor·/proactive·/child-chat)와
// 경로가 겹치지 않게 하위 경로(/settings·/credits·/memory·/safety-events·/messages·/usage)로 분리.
//
// 직역 원칙:
//  · RLS 2축(family 격리·parent/child role) → 명시적 멤버십 검증으로 대체.
//  · D1 0/1 boolean → toBool. forbidden_topics/forbidden_phrases/allowed_topics 는 PG text[]
//    array literal('{}' / '{a,b}')로 이관됐다 → 읽기 pgArray, 쓰기 toPgArray(supabase text[]
//    round-trip 과 동일하게 JS 배열↔PG literal). 응답은 supabase 형태(true/false·JS배열)로 되돌린다.
//  · ai_parent_settings 는 (family_id,child_user_id) UNIQUE를 정본으로 사용해 최초 저장도 원자 upsert.
//  · 크레딧 멱등은 google-play-verify.ts 와 동일 패턴(transaction_id select-then-insert).
//  · ai_chat_settings.credit_balance 컬럼은 읽기만(구 APK select) — write 에서 절대 건드리지 않음.
//  · timestamp 는 pgNow()(이관 데이터와 동일 '공백 +00' 형식)로 기록한다.
import { Hono } from "hono";
import type { Env, Vars } from "../types";
import { requireAuth } from "../middleware/auth";
import { pgNow } from "../lib/time";
import { pgArray, toPgArray, toBool } from "../lib/serialize";
import { notifyPg } from "../lib/realtime";
import { insertContentReport, normalizeContentReportInput } from "../lib/contentSafety";
import { resolveCanonicalFamilyMembership, resolveVerifiedFamilyMembership } from "../db/authz";
import { resolveFamilyEntitlement } from "../shared/subscriptionEntitlement.js";
import { resolveIncludedDailyLimit } from "../shared/aiCredits.js";
import { isAiUnlimitedFamily } from "../lib/aiUnlimitedAccess";

const aiData = new Hono<{ Bindings: Env; Variables: Vars }>();

// ── 공통 헬퍼 ──────────────────────────────────────────────────────────────

// KST 오늘(YYYY-MM-DD). purchase_ai_credits 의 (now AT TIME ZONE 'Asia/Seoul')::date 직역.
function kstDateKey(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// KST 자정 경계. day-summary 와 동일 — datetime(?) 이 '+09:00' 을 UTC 로 변환하므로
// substr(created_at,1,19)(UTC) 비교가 정합한다.
function kstDayBoundary(dateKey: string): string {
  return `${dateKey}T00:00:00+09:00`;
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!m) return dateKey;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return d.toISOString().slice(0, 10);
}

function clampDailyLimit(value: unknown): number {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

/** 신규 부모 설정의 안전 상한은 현재 상업 티어 기본 포함량과 맞춘다. */
async function defaultFriendDailyLimit(db: D1Database, familyId: string): Promise<number> {
  const entitlement = await resolveFamilyEntitlement(db, familyId);
  return resolveIncludedDailyLimit({ isPremium: entitlement.isPremium });
}

// 호출자가 해당 가족의 parent 멤버인지(RLS *_select_parent / *_update_parent 직역).
async function isFamilyParent(db: D1Database, uid: string, familyId: string): Promise<boolean> {
  if (!familyId) return false;
  const membership = await resolveVerifiedFamilyMembership(db, uid, familyId);
  return membership?.role === "parent";
}

// 호출자가 parent 이거나 자기 자신(child)인지(get_ai_*_public / ai_chat_*_select_parent_or_self 직역).
async function isParentOrSelf(
  db: D1Database,
  uid: string,
  familyId: string,
  childUserId: string,
): Promise<boolean> {
  if (!familyId) return false;
  const membership = await resolveVerifiedFamilyMembership(db, uid, familyId);
  return membership?.role === "parent" || (membership?.role === "child" && uid === childUserId);
}

// 자녀(child role) 멤버 id 조회(없으면 null = child_not_found).
async function childMemberId(db: D1Database, familyId: string, childUserId: string): Promise<string | null> {
  const row = await db
    .prepare(
      "SELECT id FROM family_members WHERE family_id=? AND user_id=? AND role='child' AND is_active=1 LIMIT 1",
    )
    .bind(familyId, childUserId)
    .first<{ id: string }>();
  return row?.id ?? null;
}

// ── 설정: ai_chat_settings (가족 단위) ─────────────────────────────────────

// GET /api/ai/settings/chat?familyId=  ← loadChatSettings
aiData.get("/settings/chat", requireAuth, async (c) => {
  const db = c.env.DB;
  const familyId = c.req.query("familyId") ?? "";
  const uid = c.get("user").sub;
  if (!familyId) return c.json({ error: "invalid_request" }, 400);
  // RLS select 는 가족 멤버 누구나 — parent 보다 넓지만 read 전용이라 family 멤버십으로 충분.
  if (!(await isParentOrSelf(db, uid, familyId, uid))) {
    return c.json({ error: "forbidden" }, 403);
  }
  const row = await db
    .prepare("SELECT enabled, daily_limit, updated_at FROM ai_chat_settings WHERE family_id=? LIMIT 1")
    .bind(familyId)
    .first<{ enabled: number; daily_limit: number; updated_at: string }>();
  if (!row) return c.json(null);
  return c.json({ enabled: toBool(row.enabled), daily_limit: row.daily_limit, updated_at: row.updated_at });
});

// PATCH /api/ai/settings/chat  ← saveChatSettings (family_id PK, select-then-write)
// body: { family_id, enabled, daily_limit }  (credit_balance 는 건드리지 않음)
aiData.patch("/settings/chat", requireAuth, async (c) => {
  const db = c.env.DB;
  const uid = c.get("user").sub;
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const familyId = String(body.family_id ?? body.familyId ?? "");
  if (!familyId) return c.json({ error: "invalid_request" }, 400);
  if (!(await isFamilyParent(db, uid, familyId))) return c.json({ error: "forbidden" }, 403);

  const enabled = body.enabled ? 1 : 0;
  const dailyLimit = clampDailyLimit(body.daily_limit);
  const now = pgNow();
  const existing = await db
    .prepare("SELECT family_id FROM ai_chat_settings WHERE family_id=? LIMIT 1")
    .bind(familyId)
    .first<{ family_id: string }>();
  if (existing) {
    await db
      .prepare("UPDATE ai_chat_settings SET enabled=?, daily_limit=?, updated_by=?, updated_at=? WHERE family_id=?")
      .bind(enabled, dailyLimit, uid, now, familyId)
      .run();
  } else {
    await db
      .prepare("INSERT INTO ai_chat_settings (family_id, enabled, daily_limit, updated_by, updated_at) VALUES (?,?,?,?,?)")
      .bind(familyId, enabled, dailyLimit, uid, now)
      .run();
  }
  return c.json({ ok: true });
});

// ── 설정: ai_parent_settings (자녀별 AI 친구 설정) ────────────────────────

const FRIEND_BOOL_COLS = new Set([
  "ai_enabled",
  "proactive_enabled",
  "memory_enabled",
  "long_term_memory_enabled",
  "allow_schedule_actions",
  "allow_contact_actions",
  "buddy_attention_enabled",
]);
// PG text[] 컬럼 — array literal('{}' / '{a,b}')로 이관됨(JSON 아님).
const FRIEND_ARRAY_COLS = new Set(["forbidden_topics", "forbidden_phrases", "allowed_topics"]);
const FRIEND_INT_COLS = new Set(["daily_limit"]);
const FRIEND_TEXT_COLS = new Set([
  "ai_friend_name",
  "parent_instructions",
  "child_traits",
  "sensitive_triggers",
  "education_style",
  "proactive_start_time",
  "proactive_end_time",
  "quiet_hours_start",
  "quiet_hours_end",
  "safety_notification_level",
]);

function isFriendCol(col: string): boolean {
  return FRIEND_BOOL_COLS.has(col) || FRIEND_ARRAY_COLS.has(col) || FRIEND_INT_COLS.has(col) || FRIEND_TEXT_COLS.has(col);
}

// 클라가 보낸 정규화 patch 값 → D1 저장형(boolean 0/1, 배열 PG literal, 정수 clamp, 문자열).
function coerceFriendValue(col: string, val: unknown): number | string {
  if (FRIEND_BOOL_COLS.has(col)) return val ? 1 : 0;
  if (FRIEND_ARRAY_COLS.has(col)) return toPgArray(Array.isArray(val) ? val.map((v) => String(v)) : []);
  if (FRIEND_INT_COLS.has(col)) return clampDailyLimit(val);
  return val == null ? "" : String(val);
}

// D1 row → supabase 형태(boolean·JS배열). 클라 mapAiFriendSettingsRow 가 그대로 처리.
function deserializeFriendRow(row: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!row) return null;
  const out: Record<string, unknown> = { ...row };
  for (const col of FRIEND_BOOL_COLS) {
    if (col in out) out[col] = toBool(out[col]);
  }
  for (const col of FRIEND_ARRAY_COLS) {
    if (col in out) out[col] = pgArray(out[col]);
  }
  return out;
}

const FRIEND_SELECT_COLS =
  "ai_enabled, ai_friend_name, daily_limit, parent_instructions, forbidden_topics, forbidden_phrases, allowed_topics, child_traits, sensitive_triggers, education_style, proactive_enabled, proactive_start_time, proactive_end_time, quiet_hours_start, quiet_hours_end, memory_enabled, long_term_memory_enabled, allow_schedule_actions, allow_contact_actions, buddy_attention_enabled, safety_notification_level";

// GET /api/ai/settings/friend?familyId=&childUserId=  ← loadAiFriendSettings (parent 전용)
aiData.get("/settings/friend", requireAuth, async (c) => {
  const db = c.env.DB;
  const uid = c.get("user").sub;
  const familyId = c.req.query("familyId") ?? "";
  const childUserId = c.req.query("childUserId") ?? "";
  if (!familyId || !childUserId) return c.json({ error: "invalid_request" }, 400);
  if (!(await isFamilyParent(db, uid, familyId))) return c.json({ error: "forbidden" }, 403);
  const row = await db
    .prepare(`SELECT ${FRIEND_SELECT_COLS} FROM ai_parent_settings WHERE family_id=? AND child_user_id=? LIMIT 1`)
    .bind(familyId, childUserId)
    .first<Record<string, unknown>>();
  return c.json(deserializeFriendRow(row));
});

const FRIEND_PUBLIC_COLS =
  "ai_enabled, ai_friend_name, daily_limit, proactive_enabled, proactive_start_time, proactive_end_time, quiet_hours_start, quiet_hours_end, buddy_attention_enabled";

// GET /api/ai/settings/friend-public?familyId=&childUserId=  ← get_ai_friend_public_settings (parent or self)
aiData.get("/settings/friend-public", requireAuth, async (c) => {
  const db = c.env.DB;
  const uid = c.get("user").sub;
  const familyId = c.req.query("familyId") ?? "";
  const childUserId = c.req.query("childUserId") ?? "";
  if (!familyId || !childUserId) return c.json({ error: "invalid_request" }, 400);
  if (!(await isParentOrSelf(db, uid, familyId, childUserId))) return c.json({ error: "not_allowed" }, 403);
  if (!(await childMemberId(db, familyId, childUserId))) return c.json({ error: "child_not_found" }, 404);
  const row = await db
    .prepare(`SELECT ${FRIEND_PUBLIC_COLS} FROM ai_parent_settings WHERE family_id=? AND child_user_id=? LIMIT 1`)
    .bind(familyId, childUserId)
    .first<Record<string, unknown>>();
  return c.json(deserializeFriendRow(row));
});

// PATCH /api/ai/settings/friend  ← saveAiFriendSettings (복합 unique 원자 upsert)
// body: 정규화된 snake_case patch(부분 가능) + family_id + child_user_id.
aiData.patch("/settings/friend", requireAuth, async (c) => {
  const db = c.env.DB;
  const uid = c.get("user").sub;
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const familyId = String(body.family_id ?? body.familyId ?? "");
  const childUserId = String(body.child_user_id ?? body.childUserId ?? "");
  if (!familyId || !childUserId) return c.json({ error: "invalid_request" }, 400);
  if (!(await isFamilyParent(db, uid, familyId))) return c.json({ error: "forbidden" }, 403);
  // RLS WITH CHECK: 대상이 가족의 child 멤버여야.
  if (!(await childMemberId(db, familyId, childUserId))) return c.json({ error: "child_not_found" }, 404);

  const cols = Object.keys(body).filter(isFriendCol);
  const now = pgNow();
  const insertColsFromPatch = [...cols];
  const insertValuesFromPatch = cols.map((col) => coerceFriendValue(col, body[col]));
  if (!insertColsFromPatch.includes("daily_limit")) {
    try {
      insertColsFromPatch.push("daily_limit");
      insertValuesFromPatch.push(await defaultFriendDailyLimit(db, familyId));
    } catch {
      return c.json({ error: "family_entitlement_unavailable" }, 503);
    }
  }
  // 운영 DB의 과거 column default에 기대지 않는다. 부모가 토글부터 저장해도 신규 친구 이름은 혜니다.
  if (!insertColsFromPatch.includes("ai_friend_name")) {
    insertColsFromPatch.push("ai_friend_name");
    insertValuesFromPatch.push("혜니");
  }
  const insertCols = ["id", "family_id", "child_user_id", ...insertColsFromPatch, "updated_by", "created_at", "updated_at"];
  const placeholders = insertCols.map(() => "?").join(",");
  const updateAssignments = [
    ...cols.map((col) => `${col}=excluded.${col}`),
    "updated_by=excluded.updated_by",
    "updated_at=excluded.updated_at",
  ];
  const binds = [
    crypto.randomUUID(),
    familyId,
    childUserId,
    ...insertValuesFromPatch,
    uid,
    now,
    now,
  ];
  await db
    .prepare(
      `INSERT INTO ai_parent_settings (${insertCols.join(",")}) VALUES (${placeholders})
       ON CONFLICT(family_id,child_user_id) DO UPDATE SET ${updateAssignments.join(", ")}`,
    )
    .bind(...binds)
    .run();
  return c.json({ ok: true });
});

// POST /api/ai/settings/friend-name  ← set_ai_friend_name (child 가 자기 이름 설정, SECURITY DEFINER)
// body: { familyId, name }
aiData.post("/settings/friend-name", requireAuth, async (c) => {
  const db = c.env.DB;
  const uid = c.get("user").sub;
  const body = (await c.req.json().catch(() => ({}))) as { familyId?: string; name?: string };
  const familyId = String(body.familyId ?? "");
  if (!familyId) return c.json({ error: "invalid_request" }, 400);
  // 호출자는 이 가족의 child 멤버여야 하며, 자기 자신의 이름만 설정한다.
  if (!(await childMemberId(db, familyId, uid))) return c.json({ error: "not_allowed" }, 403);

  const trimmed = String(body.name ?? "").trim();
  const finalName = trimmed ? trimmed.slice(0, 30) : "혜니";
  const now = pgNow();
  let dailyLimit: number;
  try {
    dailyLimit = await defaultFriendDailyLimit(db, familyId);
  } catch {
    return c.json({ error: "family_entitlement_unavailable" }, 503);
  }
  await db
    .prepare(
      `INSERT INTO ai_parent_settings
         (id, family_id, child_user_id, ai_friend_name, daily_limit, updated_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(family_id,child_user_id) DO UPDATE SET
         ai_friend_name=excluded.ai_friend_name,
         updated_by=excluded.updated_by,
         updated_at=excluded.updated_at`,
    )
    .bind(crypto.randomUUID(), familyId, uid, finalName, dailyLimit, uid, now, now)
    .run();
  return c.json({ name: finalName });
});

// ── 크레딧: ai_credit_balances / ai_credit_ledger ─────────────────────────

// GET /api/ai/credits/balance?familyId=&childUserId=  ← loadAiCreditStatus (parent 전용)
// 반환: { balance: row|null, totalPurchased }. 클라가 normalizeAiCreditStatusRow + totalPurchased 합성.
aiData.get("/credits/balance", requireAuth, async (c) => {
  const db = c.env.DB;
  const uid = c.get("user").sub;
  const familyId = c.req.query("familyId") ?? "";
  const childUserId = c.req.query("childUserId") ?? "";
  if (!familyId || !childUserId) return c.json({ error: "invalid_request" }, 400);
  if (!(await isFamilyParent(db, uid, familyId))) return c.json({ error: "forbidden" }, 403);

  const row = await db
    .prepare(
      "SELECT is_premium, daily_included_limit, daily_included_used, daily_reset_date, purchased_credits FROM ai_credit_balances WHERE family_id=? AND child_user_id=? LIMIT 1",
    )
    .bind(familyId, childUserId)
    .first<Record<string, unknown>>();
  const sum = await db
    .prepare("SELECT COALESCE(SUM(delta),0) AS total FROM ai_credit_ledger WHERE family_id=? AND child_user_id=? AND delta>0")
    .bind(familyId, childUserId)
    .first<{ total: number }>();
  const rawPurchasedNumber = Number(row?.purchased_credits ?? 0);
  const rawPurchased = Number.isSafeInteger(rawPurchasedNumber) ? rawPurchasedNumber : 0;
  const balance = row ? {
    ...row,
    is_premium: toBool(row.is_premium),
    purchased_credits: Math.max(0, rawPurchased),
    purchased_credit_debt: Math.max(0, -rawPurchased),
  } : null;
  return c.json({ balance, totalPurchased: Math.max(0, Number(sum?.total ?? 0)) });
});

// GET /api/ai/credits/ledger-sum?familyId=&childUserId=  ← loadTotalPurchasedAiCredits
aiData.get("/credits/ledger-sum", requireAuth, async (c) => {
  const db = c.env.DB;
  const uid = c.get("user").sub;
  const familyId = c.req.query("familyId") ?? "";
  const childUserId = c.req.query("childUserId") ?? "";
  if (!familyId || !childUserId) return c.json({ error: "invalid_request" }, 400);
  if (!(await isFamilyParent(db, uid, familyId))) return c.json({ error: "forbidden" }, 403);
  const sum = await db
    .prepare("SELECT COALESCE(SUM(delta),0) AS total FROM ai_credit_ledger WHERE family_id=? AND child_user_id=? AND delta>0")
    .bind(familyId, childUserId)
    .first<{ total: number }>();
  return c.json({ total: Math.max(0, Number(sum?.total ?? 0)) });
});

// GET /api/ai/credits/ledger?familyId=&childUserId=&limit=  ← loadAiCreditLedger (parent 전용)
aiData.get("/credits/ledger", requireAuth, async (c) => {
  const db = c.env.DB;
  const uid = c.get("user").sub;
  const familyId = c.req.query("familyId") ?? "";
  const childUserId = c.req.query("childUserId") ?? "";
  const limit = Math.max(1, Math.min(100, Number(c.req.query("limit")) || 20));
  if (!familyId || !childUserId) return c.json({ error: "invalid_request" }, 400);
  if (!(await isFamilyParent(db, uid, familyId))) return c.json({ error: "forbidden" }, 403);
  const { results } = await db
    .prepare(
      "SELECT id, delta, reason, source, transaction_id, message_id, created_at FROM ai_credit_ledger WHERE family_id=? AND child_user_id=? ORDER BY created_at DESC LIMIT ?",
    )
    .bind(familyId, childUserId, limit)
    .all<Record<string, unknown>>();
  return c.json(results ?? []);
});

// GET /api/ai/credits/public-status?familyId=&childUserId=  ← get_ai_credit_public_status (parent or self)
// 상업 포함량은 Free 5회/Premium 20회이고 부모 설정은 별도의 더 낮은 안전 상한이다.
// purchased 는 아이 화면에 정확한 잔액 대신 0/1로 마스킹한다.
aiData.get("/credits/public-status", requireAuth, async (c) => {
  const db = c.env.DB;
  const uid = c.get("user").sub;
  const familyId = c.req.query("familyId") ?? "";
  const childUserId = c.req.query("childUserId") ?? "";
  if (!familyId || !childUserId) return c.json({ error: "invalid_request" }, 400);
  if (!(await isParentOrSelf(db, uid, familyId, childUserId))) return c.json({ error: "not_allowed" }, 403);
  const childId = await childMemberId(db, familyId, childUserId);
  if (!childId) return c.json({ error: "child_not_found" }, 404);

  const today = kstDateKey();

  let isPremium = false;
  try {
    isPremium = (await resolveFamilyEntitlement(db, familyId)).isPremium;
  } catch (error) {
    console.warn("[ai-chat-data] entitlement failed:");
    return c.json({ error: "family_entitlement_unavailable" }, 503);
  }

  const cb = await db
    .prepare(
      "SELECT daily_included_used, daily_reset_date, purchased_credits FROM ai_credit_balances WHERE family_id=? AND child_user_id=? LIMIT 1",
    )
    .bind(familyId, childUserId)
    .first<{ daily_included_used: number; daily_reset_date: string; purchased_credits: number }>();
  const aps = await db
    .prepare("SELECT daily_limit FROM ai_parent_settings WHERE family_id=? AND child_user_id=? LIMIT 1")
    .bind(familyId, childUserId)
    .first<{ daily_limit: number }>();
  const acs = await db
    .prepare("SELECT daily_limit FROM ai_chat_settings WHERE family_id=? LIMIT 1")
    .bind(familyId)
    .first<{ daily_limit: number }>();

  // 오늘 부모-상한 차감 대상(chat_response/proactive_message) 카운트(KST 경계).
  const usage = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM ai_credit_ledger
        WHERE family_id=? AND child_user_id=?
          AND reason IN ('chat_response','proactive_message')
          AND substr(created_at,1,19) >= datetime(?) AND substr(created_at,1,19) < datetime(?)`,
    )
    .bind(familyId, childUserId, kstDayBoundary(today), kstDayBoundary(addDaysToDateKey(today, 1)))
    .first<{ n: number }>();
  const parentDailyUsed = Math.max(0, Number(usage?.n ?? 0));

  const dailyIncludedLimit = (resolveIncludedDailyLimit as (options: { isPremium: boolean }) => number)({ isPremium });
  const parentLimitSource = aps?.daily_limit ?? acs?.daily_limit ?? dailyIncludedLimit;
  const parentDailyLimit = clampDailyLimit(parentLimitSource);

  const sameDay = cb != null && String(cb.daily_reset_date).slice(0, 10) === today;
  const dailyIncludedUsedRaw = sameDay ? Math.max(0, Number(cb.daily_included_used) || 0) : 0;
  const dailyResetDate = sameDay ? String(cb.daily_reset_date).slice(0, 10) : today;
  const purchasedCredits = cb ? Math.max(0, Number(cb.purchased_credits) || 0) : 0;

  const dailyIncludedUsed = Math.min(dailyIncludedUsedRaw, dailyIncludedLimit);
  const parentDailyRemaining = Math.max(0, parentDailyLimit - parentDailyUsed);
  const dailyIncludedRemaining = Math.max(0, dailyIncludedLimit - dailyIncludedUsed);
  const availableRemaining = Math.min(parentDailyRemaining, dailyIncludedRemaining + purchasedCredits);

  // 운영자 본인 가족은 한도가 적용되지 않는다 — 화면이 남은 횟수 대신 무제한을 표시한다.
  const unlimited = await isAiUnlimitedFamily(c.env, c.env.DB, familyId);

  return c.json({
    is_premium: isPremium,
    daily_included_limit: dailyIncludedLimit,
    daily_included_used: dailyIncludedUsed,
    daily_reset_date: dailyResetDate,
    purchased_credits: purchasedCredits > 0 ? 1 : 0,
    parent_daily_used: parentDailyUsed,
    parent_daily_limit: parentDailyLimit,
    available_remaining: availableRemaining,
    unlimited,
  });
});

// 클라이언트 JWT에는 결제 증빙이 없으므로 직접 grant 경로를 닫는다.
// 실제 지급은 Google Play 서버 검증을 통과한 /api/billing/google-play-verify만 수행한다.
aiData.post("/credits/purchase", requireAuth, (c) => {
  return c.json({ ok: false, error: "ai_credit_purchase_write_disabled" }, 405);
});

// ── 메모리: ai_long_term_memories (parent 전용) ───────────────────────────

const MEMORY_SELECT_COLS = "id, type, key, value, confidence, updated_at";

// GET /api/ai/memory?familyId=&childUserId=&limit=  ← loadAiMemories (parent_visible 만)
aiData.get("/memory", requireAuth, async (c) => {
  const db = c.env.DB;
  const uid = c.get("user").sub;
  const familyId = c.req.query("familyId") ?? "";
  const childUserId = c.req.query("childUserId") ?? "";
  const limit = Math.max(1, Math.min(100, Number(c.req.query("limit")) || 30));
  if (!familyId || !childUserId) return c.json({ error: "invalid_request" }, 400);
  if (!(await isFamilyParent(db, uid, familyId))) return c.json({ error: "forbidden" }, 403);
  const { results } = await db
    .prepare(
      `SELECT ${MEMORY_SELECT_COLS} FROM ai_long_term_memories WHERE family_id=? AND child_user_id=? AND parent_visible=1 ORDER BY updated_at DESC LIMIT ?`,
    )
    .bind(familyId, childUserId, limit)
    .all<Record<string, unknown>>();
  return c.json(results ?? []);
});

// DELETE /api/ai/memory/:id  ← deleteAiMemory (소유 가족 parent 검증)
aiData.delete("/memory/:id", requireAuth, async (c) => {
  const db = c.env.DB;
  const uid = c.get("user").sub;
  const memoryId = c.req.param("id");
  const owner = await db
    .prepare("SELECT family_id FROM ai_long_term_memories WHERE id=? LIMIT 1")
    .bind(memoryId)
    .first<{ family_id: string }>();
  // 없으면 멱등 성공(supabase delete of nonexistent = no error). 존재 시에만 parent 게이트.
  if (!owner) return c.json({ ok: true });
  if (!(await isFamilyParent(db, uid, owner.family_id))) return c.json({ error: "forbidden" }, 403);
  await db.prepare("DELETE FROM ai_long_term_memories WHERE id=?").bind(memoryId).run();
  return c.json({ ok: true });
});

// PATCH /api/ai/memory/:id  ← updateAiMemory (value/key/type, 소유 가족 parent 검증)
aiData.patch("/memory/:id", requireAuth, async (c) => {
  const db = c.env.DB;
  const uid = c.get("user").sub;
  const memoryId = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

  // 경계 재검증(클라 검증과 동일 한도).
  const set: Record<string, string> = {};
  if (typeof body.value === "string") {
    const v = body.value.trim();
    if (!v) return c.json({ error: "memory_value_required" }, 400);
    set.value = v.slice(0, 500);
  }
  if (typeof body.key === "string") {
    const k = body.key.trim();
    if (k) set.key = k.slice(0, 80);
  }
  if (typeof body.type === "string") {
    const t = body.type.trim();
    if (t) set.type = t.slice(0, 40);
  }
  const cols = Object.keys(set);
  if (cols.length === 0) return c.json({ error: "memory_patch_required" }, 400);

  const owner = await db
    .prepare("SELECT family_id FROM ai_long_term_memories WHERE id=? LIMIT 1")
    .bind(memoryId)
    .first<{ family_id: string }>();
  if (!owner) return c.json({ error: "not_found" }, 404);
  if (!(await isFamilyParent(db, uid, owner.family_id))) return c.json({ error: "forbidden" }, 403);

  const setClause = cols.map((col) => `${col}=?`).join(", ");
  const binds = [...cols.map((col) => set[col]), pgNow(), memoryId];
  await db
    .prepare(`UPDATE ai_long_term_memories SET ${setClause}, updated_at=? WHERE id=?`)
    .bind(...binds)
    .run();
  const row = await db
    .prepare(`SELECT ${MEMORY_SELECT_COLS} FROM ai_long_term_memories WHERE id=? LIMIT 1`)
    .bind(memoryId)
    .first<Record<string, unknown>>();
  return c.json(row ?? null);
});

// ── 기록/안전: ai_safety_events / ai_chat_usage / ai_chat_messages ─────────

// GET /api/ai/safety-events?familyId=&childUserId=&limit=  ← loadAiSafetyEvents (parent 전용)
aiData.get("/safety-events", requireAuth, async (c) => {
  const db = c.env.DB;
  const uid = c.get("user").sub;
  const familyId = c.req.query("familyId") ?? "";
  const childUserId = c.req.query("childUserId") ?? "";
  const limit = Math.max(1, Math.min(100, Number(c.req.query("limit")) || 20));
  if (!familyId || !childUserId) return c.json({ error: "invalid_request" }, 400);
  if (!(await isFamilyParent(db, uid, familyId))) return c.json({ error: "forbidden" }, 403);
  const { results } = await db
    .prepare(
      "SELECT id, severity, event_type, summary, parent_notified, created_at FROM ai_safety_events WHERE family_id=? AND child_user_id=? ORDER BY created_at DESC LIMIT ?",
    )
    .bind(familyId, childUserId, limit)
    .all<Record<string, unknown>>();
  const out = (results ?? []).map((r) => ({ ...r, parent_notified: toBool(r.parent_notified) }));
  return c.json(out);
});

// GET /api/ai/usage/today?familyId=&childUserId=&dateKey=  ← loadTodayUsage (parent or self)
aiData.get("/usage/today", requireAuth, async (c) => {
  const db = c.env.DB;
  const uid = c.get("user").sub;
  const familyId = c.req.query("familyId") ?? "";
  const childUserId = c.req.query("childUserId") ?? "";
  const dateKey = c.req.query("dateKey") ?? kstDateKey();
  if (!familyId || !childUserId) return c.json({ error: "invalid_request" }, 400);
  if (!(await isParentOrSelf(db, uid, familyId, childUserId))) return c.json({ error: "forbidden" }, 403);
  const row = await db
    .prepare("SELECT count, usage_date FROM ai_chat_usage WHERE family_id=? AND child_user_id=? AND usage_date=? LIMIT 1")
    .bind(familyId, childUserId, dateKey)
    .first<{ count: number; usage_date: string }>();
  return c.json(row ?? null);
});

// GET /api/ai/messages?familyId=&childUserId=&limit=  ← loadRecentMessages (parent or self, system 제외)
aiData.get("/messages", requireAuth, async (c) => {
  const db = c.env.DB;
  const uid = c.get("user").sub;
  const familyId = c.req.query("familyId") ?? "";
  const childUserId = c.req.query("childUserId") ?? "";
  const limit = Math.max(1, Math.min(100, Number(c.req.query("limit")) || 20));
  if (!familyId || !childUserId) return c.json({ error: "invalid_request" }, 400);
  if (!(await isParentOrSelf(db, uid, familyId, childUserId))) return c.json({ error: "forbidden" }, 403);
  const { results } = await db
    .prepare(
      "SELECT id, role, content, animal_character, flagged, created_at FROM ai_chat_messages WHERE family_id=? AND child_user_id=? AND role<>'system' ORDER BY created_at DESC LIMIT ?",
    )
    .bind(familyId, childUserId, limit)
    .all<Record<string, unknown>>();
  const out = (results ?? []).map((r) => ({ ...r, flagged: toBool(r.flagged) }));
  return c.json(out);
});

// POST /api/ai/messages/:id/report — 아이가 본인 대화의 저장된 AI 답변을 앱 안에서 신고한다.
// 모델 안전 판정(flagged)과 사용자 신고 운영 큐(user_feedback)는 의미가 달라 분리한다.
aiData.post("/messages/:id/report", requireAuth, async (c) => {
  const db = c.env.DB;
  const authUser = c.get("user");
  const uid = authUser.sub;
  const messageId = c.req.param("id").trim();
  if (!messageId) return c.json({ error: "invalid_request" }, 400);
  if (authUser.role !== "child") return c.json({ error: "forbidden" }, 403);
  const canonical = await resolveCanonicalFamilyMembership(db, uid, authUser.family_id ?? null);
  if (!canonical || canonical.role !== "child") return c.json({ error: "forbidden" }, 403);

  const body = await c.req.json<{ reason?: unknown; detail?: unknown }>().catch(() => null);
  const report = normalizeContentReportInput("ai", body);
  if (!report) return c.json({ error: "invalid_report" }, 400);

  const message = await db
    .prepare(
      `SELECT m.family_id, m.child_user_id
         FROM ai_chat_messages m
         JOIN family_members child
           ON child.family_id = m.family_id
          AND child.user_id = m.child_user_id
          AND child.role = 'child'
          AND child.is_active = 1
        WHERE m.id = ?
          AND m.role = 'assistant'
          AND m.child_user_id = ?
          AND m.family_id = ?
        LIMIT 1`,
    )
    .bind(messageId, uid, canonical.familyId)
    .first<{ family_id: string; child_user_id: string }>();
  if (!message) return c.json({ error: "message_not_found" }, 404);

  const saved = await insertContentReport(db, {
    kind: "ai",
    familyId: message.family_id,
    reporterUserId: uid,
    contentId: messageId,
    reportedUserId: null,
    reason: report.reason,
    detail: report.detail,
    currentScreen: "/child/ai-friend",
  });
  return c.json({ ok: true, duplicate: saved.duplicate });
});

export default aiData;

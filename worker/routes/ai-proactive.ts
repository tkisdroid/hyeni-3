// POST /api/ai/proactive  ← supabase/functions/ai-proactive-generate (직역).
// 보수적인 AI 친구 선제 메시지를 생성해 pending_notifications 폴백 경로로 큐잉한다.
//
// 인증: requireAuth(JWT) = callerUserId. 원본의 service_role 자기호출(cron 스캔) 경로와
// getClaims/decodeJwtRole 은 제거 — 클라는 항상 단일 childUserId 로 호출한다. 스캔 경로
// (loadScheduledCandidates) = cron 이므로 M4-B 에서 별도 처리.
//
// abuse 게이트: caller 가 candidate 가족의 부모이거나, candidate 본인(자녀)일 때만 허용
// (원본 verifyCallerAccess 직역 — assertFamilyAccess 보다 엄격하게 보존).
//
// 크레딧 멱등성(CRITICAL): pending id에서 만든 transaction_id로 잔액 UPDATE와 원장 INSERT를
// D1 batch에서 함께 확정해 cron·도착 트리거 중복 차감을 막는다.
//
// D1 변환: ai_credit_balances seed는 복합 UNIQUE 기반 conflict-safe insert 뒤 정본 재조회.
// jsonb(pending data/delivery_status)는 JSON.stringify. timestamp 범위비교는 substr(col,1,19) 와
// datetime(?)(KST 경계 +09:00 변환) 정합. write timestamp 는 pgNow() 형식으로 통일.
import { Hono } from "hono";
import type { Env, Vars } from "../types";
import { requireAuth } from "../middleware/auth";
import { pgNow } from "../lib/time";
import { toBool } from "../lib/serialize";
import { notifyPg } from "../lib/realtime";
import {
  acquireAiCreditExecutionLease,
  AiCreditConsumptionUnavailableError,
  consumeAiCreditAtomic,
  releaseAiCreditExecutionLease,
  type AiCreditExecutionLease,
} from "../lib/aiCreditConsumption";
import {
  acquireAccountMutationLease,
  releaseAccountMutationLease,
} from "../lib/accountMutationLease";
import {
  buildProactiveAiMessage,
  canGenerateProactiveAiMessage,
} from "../shared/aiProactivePolicy.js";
import {
  applyParentDailyChatLimit,
  buildAiCreditBalanceRow,
  buildAiCreditBalanceSubscriptionSyncPatch,
  getAiCreditStatus,
  PREMIUM_AI_DAILY_INCLUDED_CREDITS,
  resolveIncludedDailyLimit,
} from "../shared/aiCredits.js";
import { resolveFamilyEntitlement } from "../shared/subscriptionEntitlement.js";
import { toAppDateKey } from "../shared/aiScheduleTools.js";
import { partitionNotificationRecipients } from "../lib/notificationQuietHours";

const proactive = new Hono<{ Bindings: Env; Variables: Vars }>();

interface ProactiveBody {
  familyId?: string;
  childUserId?: string;
  dryRun?: boolean;
  nowHHMM?: string;
  usageDate?: string;
  minIntervalMinutes?: number;
  limit?: number;
  // 집 도착 geofence 트리거 — trigger="place_arrival" + placeName 을 함께 보낸다.
  trigger?: string;
  placeName?: string;
}

interface ChildCandidate {
  id: string;
  family_id: string;
  user_id: string;
  name?: string | null;
  birthdate?: string | null;
}

// ── 헬퍼(원본 직역) ──
function kstNowParts(now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const date = kst.toISOString().slice(0, 10);
  const hh = String(kst.getUTCHours()).padStart(2, "0");
  const mm = String(kst.getUTCMinutes()).padStart(2, "0");
  return { date, hhmm: `${hh}:${mm}` };
}

export function resolveAiProactiveDates(
  requestedUsageDate: unknown,
  serverNow = new Date(),
): { contextDate: string; quotaDate: string } {
  const quotaDate = kstNowParts(serverNow).date;
  const contextDate = typeof requestedUsageDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(requestedUsageDate)
    ? requestedUsageDate
    : quotaDate;
  return { contextDate, quotaDate };
}

function isValidUuidLike(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ""));
  if (!match) return kstNowParts().date;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return date.toISOString().slice(0, 10);
}

// KST 자정 경계. SQLite datetime() 이 '+09:00'(타임존 포함)을 UTC 로 변환하므로
// substr(created_at,1,19)(UTC) 와 datetime(?) 비교가 정합한다.
function kstDateBoundary(dateKey: string): string {
  return `${dateKey}T00:00:00+09:00`;
}

// D1 boolean 바인딩 미지원 → INTEGER 0/1.
function b(v: unknown): number {
  return v ? 1 : 0;
}

// epoch ms → D1 호환 pg 형식('YYYY-MM-DD HH:MM:SS.sss+00').
function pgFromMs(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").replace("Z", "+00");
}

// ── 단일 자녀 candidate 조회(클라 경로) ──
async function loadSingleCandidate(
  db: D1Database,
  childUserId: string,
  familyId?: string,
): Promise<{ error: string | null; candidate: ChildCandidate | null }> {
  try {
    const sql = familyId
      ? "SELECT id, family_id, user_id, name, birthdate FROM family_members WHERE user_id=? AND role='child' AND is_active=1 AND family_id=? LIMIT 1"
      : "SELECT id, family_id, user_id, name, birthdate FROM family_members WHERE user_id=? AND role='child' AND is_active=1 LIMIT 1";
    const stmt = familyId
      ? db.prepare(sql).bind(childUserId, familyId)
      : db.prepare(sql).bind(childUserId);
    const row = await stmt.first<ChildCandidate>();
    if (!row) return { error: "child_not_found", candidate: null };
    return { error: null, candidate: row };
  } catch (e) {
    console.error("[ai-proactive] child lookup failed");
    return { error: "child_lookup_failed", candidate: null };
  }
}

async function loadScheduledCandidates(
  db: D1Database,
  limit: number,
): Promise<{ error: string | null; candidates: ChildCandidate[] }> {
  const cappedLimit = Math.max(1, Math.min(100, Number(limit) || 50));
  try {
    const { results: settingsRows } = await db
      .prepare(
        `SELECT family_id, child_user_id
           FROM ai_parent_settings
          WHERE ai_enabled = 1 AND proactive_enabled = 1
          ORDER BY substr(updated_at, 1, 19) ASC
          LIMIT ?`,
      )
      .bind(cappedLimit)
      .all<{ family_id: string; child_user_id: string | null }>();

    const childUserIds = Array.from(
      new Set((settingsRows ?? []).map((row) => row.child_user_id).filter((id): id is string => typeof id === "string" && id.length > 0)),
    );
    if (childUserIds.length === 0) return { error: null, candidates: [] };

    const ph = childUserIds.map(() => "?").join(",");
    const { results: members } = await db
      .prepare(
        `SELECT id, family_id, user_id, name, birthdate
           FROM family_members
          WHERE role = 'child' AND is_active = 1 AND user_id IN (${ph})`,
      )
      .bind(...childUserIds)
      .all<ChildCandidate>();

    return { error: null, candidates: members ?? [] };
  } catch (e) {
    console.error("[ai-proactive] scheduled scan failed");
    return { error: "settings_lookup_failed", candidates: [] };
  }
}

// caller 가 candidate 가족의 부모이거나 candidate 본인(자녀)인지 검증.
async function verifyCallerAccess(
  db: D1Database,
  callerUserId: string,
  candidate: ChildCandidate,
): Promise<boolean> {
  const row = await db
    .prepare(
      "SELECT role, user_id FROM family_members WHERE family_id=? AND user_id=? AND is_active=1 LIMIT 1",
    )
    .bind(candidate.family_id, callerUserId)
    .first<{ role: string; user_id: string }>();
  if (!row) return false;
  if (row.role === "parent") return true;
  return row.role === "child" && row.user_id === candidate.user_id;
}

async function hasChildNotificationTarget(
  db: D1Database,
  familyId: string,
  childUserId: string,
): Promise<boolean> {
  const [fcm, web] = await Promise.all([
    db.prepare("SELECT id FROM fcm_tokens WHERE family_id=? AND user_id=? AND disabled_at IS NULL LIMIT 1").bind(familyId, childUserId).first(),
    db.prepare("SELECT id FROM push_subscriptions WHERE family_id=? AND user_id=? AND disabled_at IS NULL LIMIT 1").bind(familyId, childUserId).first(),
  ]);
  return Boolean(fcm || web);
}

// 크레딧 row 조회 + 구독 동기화(seed/sync). 원본 loadCreditRow 직역.
// D1 엔 RLS/누락테이블 에러가 없으므로 isRecoverableOptionalAiTableError 분기는 항상 진입.
async function loadCreditRow(
  db: D1Database,
  familyId: string,
  childUserId: string,
  childMemberId: string,
  quotaDate: string,
): Promise<{ error: string | null; row: Record<string, unknown> | null }> {
  let aiCreditRow: Record<string, unknown> | null = null;
  try {
    aiCreditRow = await db
      .prepare(
        "SELECT id, family_id, child_user_id, parent_id, is_premium, daily_included_limit, daily_included_used, daily_reset_date, purchased_credits FROM ai_credit_balances WHERE family_id=? AND child_user_id=? LIMIT 1",
      )
      .bind(familyId, childUserId)
      .first<Record<string, unknown>>();
  } catch (e) {
    console.error("[ai-proactive] credit lookup failed");
    return { error: "credit_lookup_failed", row: null };
  }

  let subscriptionIsPremium = false;
  try {
    subscriptionIsPremium = (await resolveFamilyEntitlement(db, familyId)).isPremium;
  } catch (error) {
    throw error;
  }
  const subscriptionStatusKnown = true;

  // 프리미엄 무료 한도 = 부모 상한. seed/sync 가 daily_included_limit 을 5로 되돌리지 않도록
  // parentDailyLimit 직접 조회.
  let creditSeedParentDailyLimit: number | null = null;
  if (subscriptionStatusKnown) {
    const apsLimitRow = await db
      .prepare("SELECT daily_limit FROM ai_parent_settings WHERE family_id=? AND child_user_id=? LIMIT 1")
      .bind(familyId, childUserId)
      .first<{ daily_limit: number }>();
    const acsLimitRow = await db
      .prepare("SELECT daily_limit FROM ai_chat_settings WHERE family_id=? LIMIT 1")
      .bind(familyId)
      .first<{ daily_limit: number }>();
    creditSeedParentDailyLimit = Math.max(0, Math.min(100, Math.round(
      Number(apsLimitRow?.daily_limit ?? acsLimitRow?.daily_limit ?? PREMIUM_AI_DAILY_INCLUDED_CREDITS) || 0,
    )));
  }

  if (subscriptionStatusKnown && !aiCreditRow) {
    // seed — 동시 요청은 복합 UNIQUE가 한 행만 만들고, 양쪽 모두 DB 정본을 재조회한다.
    const seed = (buildAiCreditBalanceRow as (x: unknown) => Record<string, unknown>)({
      familyId,
      childUserId,
      today: quotaDate,
      isPremium: subscriptionIsPremium,
      parentDailyLimit: creditSeedParentDailyLimit,
    });
    try {
      const id = crypto.randomUUID();
      await db
        .prepare(
          `INSERT INTO ai_credit_balances
             (id, family_id, child_user_id, parent_id, is_premium, daily_included_limit,
              daily_included_used, daily_reset_date, purchased_credits, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(family_id, child_user_id) DO NOTHING`,
        )
        .bind(
          id,
          seed.family_id ?? null,
          seed.child_user_id ?? null,
          seed.parent_id ?? null,
          b(seed.is_premium),
          Number(seed.daily_included_limit ?? PREMIUM_AI_DAILY_INCLUDED_CREDITS),
          Number(seed.daily_included_used ?? 0),
          String(seed.daily_reset_date ?? quotaDate),
          Number(seed.purchased_credits ?? 0),
          pgNow(),
        )
        .run();
      aiCreditRow = await db
        .prepare(
          "SELECT id, family_id, child_user_id, parent_id, is_premium, daily_included_limit, daily_included_used, daily_reset_date, purchased_credits FROM ai_credit_balances WHERE family_id=? AND child_user_id=? LIMIT 1",
        )
        .bind(familyId, childUserId)
        .first<Record<string, unknown>>();
      if (!aiCreditRow) return { error: "credit_seed_failed", row: null };
    } catch (e) {
      console.error("[ai-proactive] credit seed failed");
      return { error: "credit_seed_failed", row: null };
    }
  } else if (
    subscriptionStatusKnown &&
    aiCreditRow &&
    (
      !!aiCreditRow.is_premium !== subscriptionIsPremium ||
      Number(aiCreditRow.daily_included_limit ?? 0) !== (resolveIncludedDailyLimit as (x: unknown) => number)({ isPremium: subscriptionIsPremium, parentDailyLimit: creditSeedParentDailyLimit }) ||
      aiCreditRow.daily_reset_date !== quotaDate
    )
  ) {
    // sync — 재조회한 정본 id까지 조건으로 고정한다.
    const patch = (buildAiCreditBalanceSubscriptionSyncPatch as (row: unknown, opts: unknown) => Record<string, unknown>)(aiCreditRow, {
      today: quotaDate,
      isPremium: subscriptionIsPremium,
      parentDailyLimit: creditSeedParentDailyLimit,
    });
    try {
      const syncResult = await db
        .prepare(
          "UPDATE ai_credit_balances SET is_premium=?, daily_included_limit=?, daily_included_used=?, daily_reset_date=?, updated_at=? WHERE id=? AND family_id=? AND child_user_id=?",
        )
        .bind(
          b(patch.is_premium),
          Number(patch.daily_included_limit ?? 0),
          Number(patch.daily_included_used ?? 0),
          String(patch.daily_reset_date ?? quotaDate),
          String(patch.updated_at ?? pgNow()),
          String(aiCreditRow.id),
          familyId,
          childUserId,
        )
        .run();
      if (Number(syncResult.meta?.changes ?? 0) !== 1) {
        throw new Error("ai_credit_subscription_sync_not_applied");
      }
      aiCreditRow = { ...aiCreditRow, ...patch, is_premium: b(patch.is_premium) };
    } catch (e) {
      console.error("[ai-proactive] subscription credit sync failed");
      return { error: "credit_sync_failed", row: null };
    }
  }

  return { error: null, row: aiCreditRow };
}

// 마지막 선제 프롬프트 시각(ai_chat_messages + pending_notifications 중 최신).
// D1 timestamp 는 공백구분 형식이라 Date.parse 대신 SQLite strftime 으로 epoch 산출.
// 문구 → 짧은 결정적 해시(djb2, base36). 같은 날 같은 문구의 멱등 발급 id 구성에 쓴다.
function proactiveDedupeHash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h * 33) ^ input.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

async function loadLastPromptedAt(
  db: D1Database,
  familyId: string,
  childUserId: string,
): Promise<string | null> {
  const [chat, pending] = await Promise.all([
    db
      .prepare(
        `SELECT strftime('%s', substr(created_at,1,19)) AS epoch FROM ai_chat_messages
          WHERE family_id=? AND child_user_id=? AND role='assistant' AND content LIKE '[선제 대화]%'
          ORDER BY substr(created_at,1,19) DESC LIMIT 1`,
      )
      .bind(familyId, childUserId)
      .first<{ epoch: string }>(),
    db
      .prepare(
        `SELECT strftime('%s', substr(created_at,1,19)) AS epoch FROM pending_notifications
          WHERE family_id=? AND json_extract(data,'$.type')='ai_proactive' AND json_extract(data,'$.targetUserId')=?
          ORDER BY substr(created_at,1,19) DESC LIMIT 1`,
      )
      .bind(familyId, childUserId)
      .first<{ epoch: string }>(),
  ]);
  const chatSec = Number(chat?.epoch);
  const pendingSec = Number(pending?.epoch);
  const latestSec = Math.max(
    Number.isFinite(chatSec) ? chatSec : 0,
    Number.isFinite(pendingSec) ? pendingSec : 0,
  );
  return latestSec > 0 ? new Date(latestSec * 1000).toISOString() : null;
}

// 오늘 KST 범위의 chat_response/proactive_message 차감 건수.
async function loadDailyAiCreditLedgerCount(
  db: D1Database,
  familyId: string,
  childUserId: string,
  quotaDate: string,
): Promise<number | null> {
  try {
    const row = await db
      .prepare(
        `SELECT COUNT(id) AS cnt FROM ai_credit_ledger
          WHERE family_id=? AND child_user_id=? AND reason IN ('chat_response','proactive_message')
            AND substr(created_at,1,19) >= datetime(?) AND substr(created_at,1,19) < datetime(?)`,
      )
      .bind(familyId, childUserId, kstDateBoundary(quotaDate), kstDateBoundary(addDaysToDateKey(quotaDate, 1)))
      .first<{ cnt: number }>();
    return Number.isFinite(Number(row?.cnt)) ? Number(row?.cnt) : 0;
  } catch (e) {
    console.error("[ai-proactive] AI credit ledger count failed");
    return null;
  }
}

// 오늘 일정(자녀 가시성: 가족일정 또는 events_children 링크).
async function loadTodaySchedule(
  db: D1Database,
  familyId: string,
  childMemberId: string,
  contextDate: string,
): Promise<Array<{ id: unknown; title: unknown; time: unknown; endTime: unknown }>> {
  const dateKey = toAppDateKey(contextDate);
  try {
    const { results } = await db
      .prepare(
        `SELECT e.id AS id, e.title AS title, e.time AS time, e.end_time AS end_time FROM events e
          WHERE e.family_id=? AND e.date_key=?
            AND (e.is_family_event=1 OR EXISTS (
              SELECT 1 FROM events_children ec WHERE ec.event_id=e.id AND ec.child_id=?
            ))
          ORDER BY e.time ASC`,
      )
      .bind(familyId, dateKey, childMemberId)
      .all<{ id: unknown; title: unknown; time: unknown; end_time: unknown }>();
    return (results ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      time: row.time,
      endTime: row.end_time || null,
    }));
  } catch (e) {
    console.error("[ai-proactive] schedule lookup failed");
    return [];
  }
}

async function loadRecentSummary(
  db: D1Database,
  familyId: string,
  childUserId: string,
): Promise<string> {
  const row = await db
    .prepare(
      "SELECT summary FROM ai_memory_summaries WHERE family_id=? AND child_user_id=? ORDER BY substr(updated_at,1,19) DESC LIMIT 1",
    )
    .bind(familyId, childUserId)
    .first<{ summary: string }>();
  return String(row?.summary || "");
}

interface ProcessResult {
  childUserId: string;
  queued: boolean;
  reason: string;
  message?: string;
  policy?: unknown;
  remaining?: unknown;
  pushId?: string;
  lastPromptedAt?: string | null;
  suppressedQuietHours?: string[];
  webSent?: number;
  fcmSent?: number;
  total?: number;
}

async function processCandidate(
  env: Env,
  db: D1Database,
  {
    candidate,
    contextDate,
    quotaDate,
    nowHHMM,
    nowMs,
    minIntervalMinutes,
    dryRun,
    arrivalPlaceName = "",
  }: {
    candidate: ChildCandidate;
    contextDate: string;
    quotaDate: string;
    nowHHMM: string;
    nowMs: number;
    minIntervalMinutes: number;
    dryRun: boolean;
    arrivalPlaceName?: string;
  },
): Promise<ProcessResult> {
  const familyId = candidate.family_id;
  const childUserId = candidate.user_id;

  let executionLease: AiCreditExecutionLease | null = null;
  if (!dryRun) {
    try {
      const acquired = await acquireAiCreditExecutionLease(db, { familyId, childUserId });
      if (acquired.status === "busy") {
        return { childUserId, queued: false, reason: "ai_request_in_progress" };
      }
      executionLease = acquired.lease;
    } catch (error) {
      console.error("[ai-proactive] execution lease unavailable");
      return { childUserId, queued: false, reason: "ai_credit_consumption_unavailable" };
    }
  }

  try {

  const settingsRow = await db
    .prepare(
      "SELECT ai_enabled, ai_friend_name, proactive_enabled, proactive_start_time, proactive_end_time, quiet_hours_start, quiet_hours_end, daily_limit FROM ai_parent_settings WHERE family_id=? AND child_user_id=? LIMIT 1",
    )
    .bind(familyId, childUserId)
    .first<Record<string, unknown>>();
  if (!settingsRow) {
    return { childUserId, queued: false, reason: "ai_disabled" };
  }
  // D1 boolean(0/1) → JS boolean. 정책의 normalizeBoolean 은 true/"true" 만 인정하므로
  // 0/1 을 그대로 넘기면 항상 false 로 오판한다(함정).
  const parentSettings: Record<string, unknown> = {
    ...settingsRow,
    ai_enabled: toBool(settingsRow.ai_enabled),
    proactive_enabled: toBool(settingsRow.proactive_enabled),
  };
  if (!parentSettings.ai_enabled) {
    return { childUserId, queued: false, reason: "ai_disabled" };
  }

  const notificationAllowed = await hasChildNotificationTarget(db, familyId, childUserId);
  const creditLookup = await loadCreditRow(db, familyId, childUserId, candidate.id, quotaDate);
  if (creditLookup.error) {
    return { childUserId, queued: false, reason: creditLookup.error };
  }
  const baseCreditStatus: any = creditLookup.row
    ? (getAiCreditStatus as (row: unknown, today: unknown) => any)(creditLookup.row, quotaDate)
    : { dailyIncludedRemaining: 0, purchasedCredits: 0 };
  const parentDailyLimit = Math.max(0, Math.min(100, Math.round(
    Number(parentSettings.daily_limit ?? baseCreditStatus.dailyIncludedLimit ?? PREMIUM_AI_DAILY_INCLUDED_CREDITS) || 0,
  )));
  const dailyCreditLedgerCount = creditLookup.row
    ? await loadDailyAiCreditLedgerCount(db, familyId, childUserId, quotaDate)
    : null;
  const creditStatus: any = creditLookup.row
    ? (applyParentDailyChatLimit as (s: unknown, l: unknown, c: unknown) => any)(
        baseCreditStatus,
        parentDailyLimit,
        Math.max(Number(baseCreditStatus.dailyIncludedUsed ?? 0), Number(dailyCreditLedgerCount ?? baseCreditStatus.dailyIncludedUsed ?? 0)),
      )
    : baseCreditStatus;
  const lastPromptedAt = await loadLastPromptedAt(db, familyId, childUserId);
  const policy = (canGenerateProactiveAiMessage as (x: unknown) => { ok: boolean; reason: string })({
    parentSettings,
    notificationPermission: notificationAllowed,
    creditStatus,
    nowHHMM,
    nowMs,
    lastPromptedAt,
    minIntervalMinutes,
  });
  if (!policy.ok) {
    return { childUserId, queued: false, reason: policy.reason };
  }

  const [todaySchedule, recentSummary] = await Promise.all([
    loadTodaySchedule(db, familyId, candidate.id, contextDate),
    loadRecentSummary(db, familyId, childUserId),
  ]);
  const message = (buildProactiveAiMessage as (x: unknown) => string)({
    childName: candidate.name || "",
    todaySchedule,
    recentSummary,
    childBirthday: candidate.birthdate || "",
    referenceDate: contextDate,
    nowHHMM,
    arrivalPlaceName,
  });
  if (!message) {
    return { childUserId, queued: false, reason: "no_useful_context" };
  }

  if (dryRun) {
    return { childUserId, queued: false, reason: "dry_run", message, policy, lastPromptedAt };
  }

  if (!creditLookup.row) {
    return { childUserId, queued: false, reason: "credit_unavailable" };
  }

  let quietPartition;
  try {
    quietPartition = await partitionNotificationRecipients(db, {
      userIds: [childUserId],
      identity: { action: "ai_proactive" },
      atMs: nowMs,
    });
  } catch (error) {
    console.error("[ai-proactive] quiet-hours routing failed");
    return {
      childUserId,
      queued: false,
      reason: "quiet_hours_routing_failed",
      webSent: 0,
      fcmSent: 0,
      total: 0,
    };
  }
  if (!quietPartition.allowed.has(childUserId)) {
    return {
      childUserId,
      queued: false,
      reason: "quiet_hours_suppressed",
      suppressedQuietHours: [...quietPartition.suppressed].sort(),
      webSent: 0,
      fcmSent: 0,
      total: 0,
    };
  }

  // 멱등 발급 id — 같은 아이·같은 날·같은 문구는 한 번만 발송/기록한다.
  // 도착 트리거와 정기 cron 이 같은 분에 겹치면 둘 다 간격 게이트를 통과하는 레이스가 있어
  // (실사고: "집에 왔네"·"성당 있어" 가 2번씩 쌓임) pending_notifications.id PK 충돌로
  // 두 번째 시도를 원자적으로 걸러낸다. 크레딧 차감은 insert 성공 후에만 적용된다.
  const pushId = `aiproact-${childUserId.slice(0, 8)}-${quotaDate}-${proactiveDedupeHash(message)}`;
  // 1) pending_notifications insert(먼저) — jsonb 컬럼은 JSON.stringify.
  const data = {
    type: "ai_proactive",
    action: "ai_proactive",
    familyId,
    childUserId,
    targetRole: "child",
    targetUserId: childUserId,
    pushId,
  };
  const deliveryStatus = { source: "ai-proactive-generate", targetUserId: childUserId };
  try {
    await db
      .prepare(
        "INSERT INTO pending_notifications (id, family_id, title, body, data, delivery_status, expires_at, created_at) VALUES (?,?,?,?,?,?,?,?)",
      )
      .bind(
        pushId,
        familyId,
        String(parentSettings.ai_friend_name || "AI 친구"),
        message,
        JSON.stringify(data),
        JSON.stringify(deliveryStatus),
        pgFromMs(Date.now() + 6 * 60 * 60 * 1000),
        pgNow(),
      )
      .run();
  } catch (e) {
    // PK(UNIQUE) 충돌 = 같은 문구가 이미 발급됨(레이스의 진 쪽) — 크레딧 차감 없이 조용히 종료.
    if (/UNIQUE|PRIMARY/i.test(String(e))) {
      return { childUserId, queued: false, reason: "duplicate_suppressed" };
    }
    console.error("[ai-proactive] pending notification insert failed");
    return { childUserId, queued: false, reason: "notification_queue_failed" };
  }

  // 2) 잔액·원장 원자 차감. pending PK로 먼저 중복을 막은 뒤 같은 transactionId로
  // D1 batch를 확정하므로 cron과 도착 트리거가 겹쳐도 한 번만 차감한다.
  let creditConsumption: Awaited<ReturnType<typeof consumeAiCreditAtomic>>;
  try {
    creditConsumption = await consumeAiCreditAtomic(db, {
      familyId,
      childUserId,
      parentDailyLimit,
      usageDate: quotaDate,
      reason: "proactive_message",
      transactionId: `ai-proactive-${pushId}`,
      messageId: `${pushId}-chat`,
    });
    if (creditConsumption.status === "exhausted") {
      await db.prepare("DELETE FROM pending_notifications WHERE id=? AND family_id=?").bind(pushId, familyId).run();
      return { childUserId, queued: false, reason: "credit_unavailable" };
    }
  } catch (error) {
    console.error("[ai-proactive] atomic credit consumption failed");
    try {
      await db.prepare("DELETE FROM pending_notifications WHERE id=? AND family_id=?").bind(pushId, familyId).run();
    } catch (rollbackErr) {
      console.error("[ai-proactive] pending notification rollback failed");
    }
    return {
      childUserId,
      queued: false,
      reason: error instanceof AiCreditConsumptionUnavailableError
        ? error.code
        : "credit_update_failed",
    };
  }
  try {
    await notifyPg(env, familyId, "ai_credit_balances", "UPDATE", {
      family_id: familyId,
      child_user_id: childUserId,
    });
  } catch (error) {
    console.error("[ai-proactive] credit realtime notify failed");
  }

  // 3) ai_chat_messages insert(선제 대화 로그). flagged boolean → 0/1.
  try {
    await db
      .prepare(
        "INSERT INTO ai_chat_messages (id, family_id, child_user_id, role, content, animal_character, flagged, created_at) VALUES (?,?,?,?,?,?,?,?)",
      )
      .bind(
        `${pushId}-chat`,
        familyId,
        childUserId,
        "assistant",
        `[선제 대화] ${message}`,
        null,
        0,
        pgNow(),
      )
      .run();
  } catch (e) {
    console.error("[ai-proactive] AI prompt log insert failed");
  }

  return {
    childUserId,
    queued: true,
    reason: "queued",
    message,
    remaining: creditConsumption,
    pushId,
    lastPromptedAt,
  };
  } finally {
    if (executionLease) {
      try {
        await releaseAiCreditExecutionLease(db, executionLease);
      } catch (error) {
        console.error("[ai-proactive] execution lease release failed");
      }
    }
  }
}

export async function runScheduledProactive(
  env: Env,
  db: D1Database,
  body: Pick<ProactiveBody, "dryRun" | "limit" | "minIntervalMinutes" | "nowHHMM" | "usageDate"> = {},
): Promise<Record<string, unknown>> {
  const serverNow = new Date();
  const nowParts = kstNowParts(serverNow);
  const { contextDate, quotaDate } = resolveAiProactiveDates(body.usageDate, serverNow);
  const nowHHMM = body.nowHHMM && /^\d{2}:\d{2}$/.test(body.nowHHMM)
    ? body.nowHHMM
    : nowParts.hhmm;
  const minIntervalMinutes = Number.isFinite(Number(body.minIntervalMinutes))
    ? Math.max(30, Number(body.minIntervalMinutes))
    : 360;
  const dryRun = body.dryRun === true;

  const loaded = await loadScheduledCandidates(db, Number(body.limit || 50));
  if (loaded.error) {
    return { error: loaded.error, generated: 0, checked: 0, usageDate: contextDate, nowHHMM, dryRun };
  }

  const nowMs = serverNow.getTime();
  const results: ProcessResult[] = [];
  for (const candidate of loaded.candidates) {
    const proactiveMutationLease = await acquireAccountMutationLease(db, {
      userId: candidate.user_id,
      familyId: candidate.family_id,
    });
    if (proactiveMutationLease.status !== "acquired") {
      results.push({
        childUserId: candidate.user_id,
        queued: false,
        reason: proactiveMutationLease.status === "blocked"
          ? "account_deletion_in_progress"
          : "mutation_lease_unavailable",
      });
      continue;
    }
    try {
      results.push(await processCandidate(env, db, {
        candidate,
        contextDate,
        quotaDate,
        nowHHMM,
        nowMs,
        minIntervalMinutes,
        dryRun,
      }));
    } finally {
      await releaseAccountMutationLease(db, proactiveMutationLease.lease.id);
    }
  }

  return {
    generated: results.filter((result) => result.queued).length,
    checked: results.length,
    usageDate: contextDate,
    nowHHMM,
    dryRun,
    results,
  };
}

export async function runSingleProactive(
  env: Env,
  db: D1Database,
  body: Pick<ProactiveBody, "childUserId" | "familyId" | "dryRun" | "minIntervalMinutes" | "nowHHMM" | "placeName" | "trigger" | "usageDate">,
): Promise<Record<string, unknown>> {
  if (!body.childUserId || !isValidUuidLike(body.childUserId)) {
    return { error: "invalid_child_user_id", generated: 0, checked: 0 };
  }

  const serverNow = new Date();
  const nowParts = kstNowParts(serverNow);
  const { contextDate, quotaDate } = resolveAiProactiveDates(body.usageDate, serverNow);
  const nowHHMM = body.nowHHMM && /^\d{2}:\d{2}$/.test(body.nowHHMM)
    ? body.nowHHMM
    : nowParts.hhmm;
  const minIntervalMinutes = Number.isFinite(Number(body.minIntervalMinutes))
    ? Math.max(30, Number(body.minIntervalMinutes))
    : 360;
  const dryRun = body.dryRun === true;
  const arrivalPlaceName = body.trigger === "place_arrival"
    ? String(body.placeName || "").trim().slice(0, 40)
    : "";

  const loaded = await loadSingleCandidate(db, body.childUserId, body.familyId);
  if (loaded.error || !loaded.candidate) {
    return { error: loaded.error, generated: 0, checked: 0, usageDate: contextDate, nowHHMM, dryRun };
  }

  const result = await processCandidate(env, db, {
    candidate: loaded.candidate,
    contextDate,
    quotaDate,
    nowHHMM,
    nowMs: serverNow.getTime(),
    minIntervalMinutes,
    dryRun,
    arrivalPlaceName,
  });

  return {
    generated: result.queued ? 1 : 0,
    checked: 1,
    usageDate: contextDate,
    nowHHMM,
    dryRun,
    results: [result],
  };
}

proactive.post("/proactive", requireAuth, async (c) => {
  const db = c.env.DB;
  const callerUserId = c.get("user").sub;

  let body: ProactiveBody = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const serverNow = new Date();
  const nowParts = kstNowParts(serverNow);
  const { contextDate, quotaDate } = resolveAiProactiveDates(body.usageDate, serverNow);
  const nowHHMM = body.nowHHMM && /^\d{2}:\d{2}$/.test(body.nowHHMM)
    ? body.nowHHMM
    : nowParts.hhmm;
  const minIntervalMinutes = Number.isFinite(Number(body.minIntervalMinutes))
    ? Math.max(30, Number(body.minIntervalMinutes))
    : 360;
  const dryRun = body.dryRun === true;
  // 집 도착 트리거는 단일 자녀 호출에서만 의미가 있다.
  const arrivalPlaceName = body.trigger === "place_arrival" && body.childUserId
    ? String(body.placeName || "").trim().slice(0, 40)
    : "";

  // 클라 경로 = 단일 childUserId 필수(원본 service_role 스캔 경로는 제거, cron=M4-B).
  if (!body.childUserId) {
    return c.json({ error: "child_user_id_required" }, 400);
  }
  if (!isValidUuidLike(body.childUserId)) {
    return c.json({ error: "invalid_child_user_id" }, 400);
  }
  const loaded = await loadSingleCandidate(db, body.childUserId, body.familyId);
  if (loaded.error || !loaded.candidate) {
    return c.json({ error: loaded.error }, loaded.error === "child_not_found" ? 404 : 500);
  }
  const allowed = await verifyCallerAccess(db, callerUserId, loaded.candidate);
  if (!allowed) return c.json({ error: "forbidden" }, 403);

  const nowMs = serverNow.getTime();
  const results: ProcessResult[] = [];
  for (const candidate of [loaded.candidate]) {
    results.push(await processCandidate(c.env, db, {
      candidate,
      contextDate,
      quotaDate,
      nowHHMM,
      nowMs,
      minIntervalMinutes,
      dryRun,
      arrivalPlaceName,
    }));
  }

  return c.json({
    generated: results.filter((result) => result.queued).length,
    checked: results.length,
    usageDate: contextDate,
    nowHHMM,
    dryRun,
    results,
  });
});

export default proactive;

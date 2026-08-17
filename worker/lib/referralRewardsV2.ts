import type { Env } from "../types";
import { notifyPg } from "./realtime";
import { resolveFamilyEntitlement } from "../shared/subscriptionEntitlement.js";
import {
  acquireAccountMutationLeases,
  releaseAccountMutationLeases,
  type AccountMutationScope,
} from "./accountMutationScope";

// 친구 추천은 새 가족을 데려오는 일이라 유료 팩(30/80/200) 사이에서 체감이 큰 값으로 준다(2026-08-17 TK 지시).
export const REFERRAL_REWARD_CREDITS = 50;
// 초대 가족 수 상한은 두지 않는다 — 예전 3가족 제한은 추천을 그만할 이유가 됐다.
export const REFERRAL_QUALIFICATION_HOURS = 72;
export const REFERRAL_LOCATION_RETENTION_HOURS = 48;

const CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const REFERRAL_CODE_PATTERN = /^HYENI-[0-9A-HJKMNP-TV-Z]{16}$/;
const HOUR_MS = 60 * 60 * 1000;

function pgTs(value: Date): string {
  return value.toISOString().replace("T", " ").replace("Z", "+00");
}

function kstDateKey(value: Date): string {
  return new Date(value.getTime() + 9 * HOUR_MS).toISOString().slice(0, 10);
}

function timestampMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const iso = (value.includes("T") ? value : value.replace(" ", "T"))
    .replace(/([+-]\d{2})$/, "$1:00");
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

export class ReferralAttributionError extends Error {
  readonly status: 400 | 409 | 503;

  constructor(code: string, status: 400 | 409 | 503) {
    super(code);
    this.name = "ReferralAttributionError";
    this.status = status;
  }
}

export function normalizeReferralCode(value: unknown): string | null {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  return REFERRAL_CODE_PATTERN.test(code) ? code : null;
}

/** 10 random bytes를 16자리 Crockford Base32로 바꿔 약 80비트 공개 초대 코드를 만든다. */
export function createReferralCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let bits = 0;
  let value = 0;
  let encoded = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      encoded += CROCKFORD_BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
      value &= (1 << bits) - 1;
    }
  }
  return `HYENI-${encoded}`;
}

interface ReferralCodeRow {
  id: string;
  family_id: string;
  owner_parent_id: string;
  reward_child_user_id: string;
  code: string;
  status: "active" | "revoked";
  successful_referrals: number;
}

export interface PreparedReferralAttribution {
  completionId: string;
  codeId: string;
  code: string;
  referrerFamilyId: string;
  referrerParentId: string;
  referrerChildUserId: string;
  refereeFamilyId: string;
  refereeParentId: string;
  createdAt: string;
}

async function activeParentFamily(
  db: D1Database,
  parentId: string,
): Promise<{ family_id: string; primary_parent_id: string } | null> {
  return db.prepare(
    `SELECT fm.family_id, f.parent_id AS primary_parent_id
       FROM family_members fm
       JOIN families f ON f.id=fm.family_id
      WHERE fm.user_id=? AND fm.role='parent' AND fm.is_active=1
      ORDER BY CASE WHEN f.parent_id=fm.user_id THEN 0 ELSE 1 END, fm.family_id
      LIMIT 1`,
  ).bind(parentId).first<{ family_id: string; primary_parent_id: string }>();
}

/**
 * family/setup 이전의 사용자 친화적 검증. 동일 조건은 반환한 batch guard가 다시 읽어
 * 실제 가족 INSERT와 추천 귀속 사이의 경합도 원자적으로 닫는다.
 */
export async function prepareReferralAttribution(
  db: D1Database,
  input: { code: unknown; refereeFamilyId: string; refereeParentId: string; now?: Date },
): Promise<PreparedReferralAttribution> {
  const code = normalizeReferralCode(input.code);
  if (!code) throw new ReferralAttributionError("referral_code_invalid", 400);

  let row: ReferralCodeRow | null;
  try {
    row = await db.prepare(
      `SELECT rc.id,rc.family_id,rc.owner_parent_id,rc.reward_child_user_id,rc.code,
              rc.status,rc.successful_referrals
         FROM referral_codes_v2 rc
         JOIN families f ON f.id=rc.family_id AND f.parent_id=rc.owner_parent_id
         JOIN family_members pm
           ON pm.family_id=rc.family_id AND pm.user_id=rc.owner_parent_id
          AND pm.role='parent' AND pm.is_active=1
         JOIN family_members cm
           ON cm.family_id=rc.family_id AND cm.user_id=rc.reward_child_user_id
          AND cm.role='child' AND cm.is_active=1
        WHERE rc.code=? COLLATE NOCASE AND rc.status='active'
        LIMIT 1`,
    ).bind(code).first<ReferralCodeRow>();
  } catch (error) {
    if (/no such table/i.test(String(error))) {
      throw new ReferralAttributionError("referral_program_unavailable", 503);
    }
    throw error;
  }
  if (!row) throw new ReferralAttributionError("referral_code_invalid", 400);
  if (row.owner_parent_id === input.refereeParentId) {
    throw new ReferralAttributionError("referral_self_forbidden", 409);
  }

  const membership = await activeParentFamily(db, input.refereeParentId);
  if (membership) {
    if (membership.family_id === row.family_id) {
      throw new ReferralAttributionError("referral_co_parent_forbidden", 409);
    }
    throw new ReferralAttributionError("referral_existing_family_forbidden", 409);
  }
  const attributed = await db.prepare(
    `SELECT 1 AS attributed FROM referral_completions_v2
      WHERE referee_parent_id=? OR referee_family_id=? LIMIT 1`,
  ).bind(input.refereeParentId, input.refereeFamilyId).first<{ attributed: number }>();
  if (attributed) throw new ReferralAttributionError("referral_already_attributed", 409);

  const now = input.now ?? new Date();
  return {
    completionId: crypto.randomUUID(),
    codeId: row.id,
    code: row.code,
    referrerFamilyId: row.family_id,
    referrerParentId: row.owner_parent_id,
    referrerChildUserId: row.reward_child_user_id,
    refereeFamilyId: input.refereeFamilyId,
    refereeParentId: input.refereeParentId,
    createdAt: pgTs(now),
  };
}

export function buildReferralAttributionStatements(
  db: D1Database,
  prepared: PreparedReferralAttribution,
): D1PreparedStatement[] {
  return [
    db.prepare(
      `SELECT CASE WHEN EXISTS(
         SELECT 1
           FROM referral_codes_v2 rc
           JOIN families f ON f.id=rc.family_id AND f.parent_id=rc.owner_parent_id
          WHERE rc.id=? AND rc.code=? COLLATE NOCASE AND rc.status='active'
            AND rc.family_id=? AND rc.owner_parent_id=? AND rc.reward_child_user_id=?
            AND EXISTS(
              SELECT 1 FROM family_members pm
               WHERE pm.family_id=rc.family_id AND pm.user_id=rc.owner_parent_id
                 AND pm.role='parent' AND pm.is_active=1
            )
            AND EXISTS(
              SELECT 1 FROM family_members cm
               WHERE cm.family_id=rc.family_id AND cm.user_id=rc.reward_child_user_id
                 AND cm.role='child' AND cm.is_active=1
            )
            AND rc.owner_parent_id<>?
            AND NOT EXISTS(SELECT 1 FROM families own WHERE own.parent_id=?)
            AND NOT EXISTS(
              SELECT 1 FROM family_members existing
               WHERE existing.user_id=? AND existing.role='parent' AND existing.is_active=1
            )
            AND NOT EXISTS(
              SELECT 1 FROM referral_completions_v2 used
               WHERE used.referee_parent_id=? OR used.referee_family_id=?
            )
       ) THEN 1 ELSE json_extract('referral_attribution_invalid','$') END AS ok`,
    ).bind(
      prepared.codeId,
      prepared.code,
      prepared.referrerFamilyId,
      prepared.referrerParentId,
      prepared.referrerChildUserId,
      prepared.refereeParentId,
      prepared.refereeParentId,
      prepared.refereeParentId,
      prepared.refereeParentId,
      prepared.refereeFamilyId,
    ),
    db.prepare(
      `INSERT INTO referral_completions_v2
         (id,referral_code_id,referrer_family_id,referrer_parent_id,referrer_child_user_id,
          referee_family_id,referee_parent_id,status,reward_credits,created_at,updated_at)
       SELECT ?,?,?,?,?,?,?,'pending',?,?,?
        WHERE EXISTS(SELECT 1 FROM families WHERE id=? AND parent_id=?)`,
    ).bind(
      prepared.completionId,
      prepared.codeId,
      prepared.referrerFamilyId,
      prepared.referrerParentId,
      prepared.referrerChildUserId,
      prepared.refereeFamilyId,
      prepared.refereeParentId,
      REFERRAL_REWARD_CREDITS,
      prepared.createdAt,
      prepared.createdAt,
      prepared.refereeFamilyId,
      prepared.refereeParentId,
    ),
  ];
}

export interface ReferralStatus {
  code: string | null;
  rewardChildUserId: string | null;
  rewardCredits: number;
  qualificationHours: number;
  locationRetentionHours: number;
  /** 지급까지 끝난 초대 가족 수(상한 없음). */
  successfulCount: number;
  pendingCount: number;
}

export async function readReferralStatus(
  db: D1Database,
  familyId: string,
  parentId: string,
): Promise<ReferralStatus> {
  const code = await db.prepare(
    `SELECT id,family_id,owner_parent_id,reward_child_user_id,code,status,successful_referrals
       FROM referral_codes_v2
      WHERE family_id=? AND owner_parent_id=? LIMIT 1`,
  ).bind(familyId, parentId).first<ReferralCodeRow>();
  const counts = await db.prepare(
    `SELECT
       SUM(CASE WHEN status='rewarded' THEN 1 ELSE 0 END) AS successful_count,
       SUM(CASE WHEN status IN ('pending','qualified') THEN 1 ELSE 0 END) AS pending_count
       FROM referral_completions_v2 WHERE referrer_family_id=?`,
  ).bind(familyId).first<{ successful_count: number | null; pending_count: number | null }>();
  const successfulCount = Math.max(
    Number(code?.successful_referrals ?? 0),
    Number(counts?.successful_count ?? 0),
  );
  const pendingCount = Math.max(0, Number(counts?.pending_count ?? 0));
  return {
    code: code?.status === "active" ? code.code : null,
    rewardChildUserId: code?.reward_child_user_id ?? null,
    rewardCredits: REFERRAL_REWARD_CREDITS,
    qualificationHours: REFERRAL_QUALIFICATION_HOURS,
    locationRetentionHours: REFERRAL_LOCATION_RETENTION_HOURS,
    successfulCount,
    pendingCount,
  };
}

export async function upsertReferralCode(
  db: D1Database,
  input: { familyId: string; parentId: string; rewardChildUserId: string },
): Promise<ReferralStatus> {
  const child = await db.prepare(
    `SELECT 1 AS ok FROM family_members
      WHERE family_id=? AND user_id=? AND role='child' AND is_active=1 LIMIT 1`,
  ).bind(input.familyId, input.rewardChildUserId).first<{ ok: number }>();
  if (!child) throw new ReferralAttributionError("referral_reward_child_invalid", 400);

  const existing = await db.prepare(
    "SELECT id FROM referral_codes_v2 WHERE family_id=? LIMIT 1",
  ).bind(input.familyId).first<{ id: string }>();
  const now = pgTs(new Date());
  if (existing) {
    await db.batch([
      db.prepare(
        `UPDATE referral_codes_v2
            SET reward_child_user_id=?,status='active',revoked_at=NULL,updated_at=?
          WHERE id=? AND family_id=? AND owner_parent_id=?
            AND EXISTS(
              SELECT 1 FROM family_members
               WHERE family_id=? AND user_id=? AND role='child' AND is_active=1
            )`,
      ).bind(
        input.rewardChildUserId,
        now,
        existing.id,
        input.familyId,
        input.parentId,
        input.familyId,
        input.rewardChildUserId,
      ),
      db.prepare(
        `UPDATE referral_completions_v2 SET referrer_child_user_id=?,updated_at=?
          WHERE referral_code_id=? AND referrer_family_id=? AND status IN ('pending','qualified')`,
      ).bind(input.rewardChildUserId, now, existing.id, input.familyId),
    ]);
    return readReferralStatus(db, input.familyId, input.parentId);
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = createReferralCode();
    try {
      const result = await db.prepare(
        `INSERT INTO referral_codes_v2
           (id,family_id,owner_parent_id,reward_child_user_id,code,status,created_at,updated_at)
         SELECT ?,?,?,?,?,'active',?,?
          WHERE EXISTS(SELECT 1 FROM families WHERE id=? AND parent_id=?)
            AND EXISTS(
              SELECT 1 FROM family_members
               WHERE family_id=? AND user_id=? AND role='child' AND is_active=1
            )
            AND NOT EXISTS(SELECT 1 FROM referral_codes_v2 WHERE family_id=?)`,
      ).bind(
        crypto.randomUUID(),
        input.familyId,
        input.parentId,
        input.rewardChildUserId,
        code,
        now,
        now,
        input.familyId,
        input.parentId,
        input.familyId,
        input.rewardChildUserId,
        input.familyId,
      ).run();
      if (Number(result.meta?.changes ?? 0) === 1) {
        return readReferralStatus(db, input.familyId, input.parentId);
      }
      const raced = await db.prepare(
        "SELECT id FROM referral_codes_v2 WHERE family_id=? LIMIT 1",
      ).bind(input.familyId).first<{ id: string }>();
      if (raced) return upsertReferralCode(db, input);
    } catch (error) {
      if (!/unique constraint|constraint failed/i.test(String(error))) throw error;
      const raced = await db.prepare(
        "SELECT id FROM referral_codes_v2 WHERE family_id=? LIMIT 1",
      ).bind(input.familyId).first<{ id: string }>();
      if (raced) return upsertReferralCode(db, input);
    }
  }
  throw new ReferralAttributionError("referral_code_generation_unavailable", 503);
}

interface PendingReferralRow {
  id: string;
  referral_code_id: string;
  referrer_family_id: string;
  referrer_parent_id: string;
  referrer_child_user_id: string;
  referee_family_id: string;
  referee_parent_id: string;
  referee_child_user_id: string | null;
  reward_credits: number;
  first_location_at: string | null;
  latest_location_at: string | null;
  created_at: string;
}

interface LocationEvidence {
  child_user_id: string;
  first_location_at: string;
  latest_location_at: string;
}

function locationEvidenceFromSummary(row: PendingReferralRow): LocationEvidence | null {
  if (row.referee_child_user_id && row.first_location_at && row.latest_location_at) {
    return {
      child_user_id: row.referee_child_user_id,
      first_location_at: row.first_location_at,
      latest_location_at: row.latest_location_at,
    };
  }
  return null;
}

async function markRejected(
  db: D1Database,
  completionId: string,
  reason: "success_cap_reached" | "referrer_unavailable" | "referee_unavailable" | "reward_child_unavailable",
  now: Date,
): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE referral_completions_v2
        SET status='rejected',rejection_reason=?,updated_at=?
      WHERE id=? AND status IN ('pending','qualified')`,
  ).bind(reason, pgTs(now), completionId).run();
  return Number(result.meta?.changes ?? 0) === 1;
}

async function referralPartyState(
  db: D1Database,
  row: PendingReferralRow,
  evidence: LocationEvidence,
): Promise<"ready" | "referrer_unavailable" | "referee_unavailable" | "reward_child_unavailable"> {
  const state = await db.prepare(
    `SELECT
       EXISTS(SELECT 1 FROM families WHERE id=? AND parent_id=?) AS referrer_family,
       EXISTS(SELECT 1 FROM family_members
               WHERE family_id=? AND user_id=? AND role='parent' AND is_active=1) AS referrer_parent,
       EXISTS(SELECT 1 FROM family_members
               WHERE family_id=? AND user_id=? AND role='child' AND is_active=1) AS referrer_child,
       EXISTS(SELECT 1 FROM families WHERE id=? AND parent_id=?) AS referee_family,
       EXISTS(SELECT 1 FROM family_members
               WHERE family_id=? AND user_id=? AND role='parent' AND is_active=1) AS referee_parent,
       EXISTS(SELECT 1 FROM family_members
               WHERE family_id=? AND user_id=? AND role='child' AND is_active=1) AS referee_child`,
  ).bind(
    row.referrer_family_id,
    row.referrer_parent_id,
    row.referrer_family_id,
    row.referrer_parent_id,
    row.referrer_family_id,
    row.referrer_child_user_id,
    row.referee_family_id,
    row.referee_parent_id,
    row.referee_family_id,
    row.referee_parent_id,
    row.referee_family_id,
    evidence.child_user_id,
  ).first<Record<string, number>>();
  if (!state?.referrer_family || !state.referrer_parent) return "referrer_unavailable";
  if (!state.referee_family || !state.referee_parent) return "referee_unavailable";
  if (!state.referrer_child || !state.referee_child) return "reward_child_unavailable";
  return "ready";
}

function balanceUpsert(
  db: D1Database,
  input: {
    balanceId: string;
    familyId: string;
    childUserId: string;
    parentId: string;
    isPremium: boolean;
    now: Date;
  },
): D1PreparedStatement {
  const dailyLimit = input.isPremium ? 20 : 5;
  const today = kstDateKey(input.now);
  const nowPg = pgTs(input.now);
  return db.prepare(
    `INSERT INTO ai_credit_balances
       (id,family_id,child_user_id,parent_id,is_premium,daily_included_limit,
        daily_included_used,daily_reset_date,purchased_credits,updated_at)
     VALUES (?,?,?,?,?,?,0,?,?,?)
     ON CONFLICT(family_id,child_user_id) DO UPDATE SET
       parent_id=excluded.parent_id,
       is_premium=excluded.is_premium,
       daily_included_limit=excluded.daily_included_limit,
       daily_included_used=CASE
         WHEN substr(ai_credit_balances.daily_reset_date,1,10)=excluded.daily_reset_date
         THEN ai_credit_balances.daily_included_used ELSE 0 END,
       daily_reset_date=excluded.daily_reset_date,
       purchased_credits=COALESCE(ai_credit_balances.purchased_credits,0)+excluded.purchased_credits,
       updated_at=excluded.updated_at`,
  ).bind(
    input.balanceId,
    input.familyId,
    input.childUserId,
    input.parentId,
    input.isPremium ? 1 : 0,
    dailyLimit,
    today,
    REFERRAL_REWARD_CREDITS,
    nowPg,
  );
}

async function grantReferralReward(
  env: Env,
  row: PendingReferralRow,
  evidence: LocationEvidence,
  now: Date,
): Promise<"rewarded" | "duplicate" | "failed"> {
  const mutationScopes: AccountMutationScope[] = [
    { familyId: row.referrer_family_id, userId: row.referrer_parent_id },
    { familyId: row.referrer_family_id, userId: row.referrer_child_user_id },
    { familyId: row.referee_family_id, userId: row.referee_parent_id },
    { familyId: row.referee_family_id, userId: evidence.child_user_id },
  ].sort((left, right) => (
    String(left.familyId).localeCompare(String(right.familyId))
    || left.userId.localeCompare(right.userId)
  ));
  const mutationLeases = await acquireAccountMutationLeases(env.DB, mutationScopes);
  if (mutationLeases.status !== "acquired") return "failed";
  try {
    let referrerPremium: boolean;
    let refereePremium: boolean;
    try {
      [referrerPremium, refereePremium] = await Promise.all([
        resolveFamilyEntitlement(env.DB, row.referrer_family_id, now).then((value) => value.isPremium),
        resolveFamilyEntitlement(env.DB, row.referee_family_id, now).then((value) => value.isPremium),
      ]);
    } catch {
      return "failed";
    }

    const nowPg = pgTs(now);
    // 보상액은 귀속 시점에 완료 행에 기록한 값이다 — 정책이 바뀌어도 약속한 만큼만 지급한다.
    const rewardCredits = Number(row.reward_credits);
    if (!Number.isSafeInteger(rewardCredits) || rewardCredits <= 0) return "failed";
    const referrerLedgerId = `referral:${row.id}:referrer`;
    const refereeLedgerId = `referral:${row.id}:referee`;
    try {
      await env.DB.batch([
        env.DB.prepare(
          `SELECT CASE WHEN EXISTS(
             SELECT 1 FROM referral_completions_v2 completion
             JOIN referral_codes_v2 code ON code.id=completion.referral_code_id
            WHERE completion.id=? AND completion.status IN ('pending','qualified')
              AND completion.referrer_family_id=? AND completion.referee_family_id=?
              AND completion.referrer_child_user_id=? AND completion.referee_child_user_id=?
              AND completion.reward_credits=?
              AND code.family_id=completion.referrer_family_id
              AND datetime(substr(completion.created_at,1,19), '+' || ? || ' hours')
                  <=datetime(substr(?,1,19))
              AND completion.first_location_at IS NOT NULL
              AND completion.latest_location_at IS NOT NULL
              AND datetime(substr(completion.first_location_at,1,19))
                  >=datetime(substr(completion.created_at,1,19))
              AND datetime(substr(completion.latest_location_at,1,19))
                  >=datetime(substr(completion.first_location_at,1,19), '+' || ? || ' hours')
              AND EXISTS(SELECT 1 FROM families WHERE id=completion.referrer_family_id AND parent_id=completion.referrer_parent_id)
              AND EXISTS(SELECT 1 FROM families WHERE id=completion.referee_family_id AND parent_id=completion.referee_parent_id)
              AND EXISTS(SELECT 1 FROM family_members WHERE family_id=completion.referrer_family_id
                           AND user_id=completion.referrer_parent_id AND role='parent' AND is_active=1)
              AND EXISTS(SELECT 1 FROM family_members WHERE family_id=completion.referrer_family_id
                           AND user_id=completion.referrer_child_user_id AND role='child' AND is_active=1)
              AND EXISTS(SELECT 1 FROM family_members WHERE family_id=completion.referee_family_id
                           AND user_id=completion.referee_parent_id AND role='parent' AND is_active=1)
              AND EXISTS(SELECT 1 FROM family_members WHERE family_id=completion.referee_family_id
                           AND user_id=completion.referee_child_user_id AND role='child' AND is_active=1)
              AND NOT EXISTS(SELECT 1 FROM account_deletion_scopes
                              WHERE (scope_type='family' AND scope_id IN (completion.referrer_family_id,completion.referee_family_id))
                                 OR (scope_type='user' AND scope_id IN (completion.referrer_parent_id,completion.referee_parent_id,
                                                                        completion.referrer_child_user_id,completion.referee_child_user_id)))
              AND NOT EXISTS(SELECT 1 FROM ai_credit_ledger WHERE id IN (?,?))
           ) THEN 1 ELSE json_extract('referral_reward_not_claimable','$') END AS ok`,
        ).bind(
          row.id,
          row.referrer_family_id,
          row.referee_family_id,
          row.referrer_child_user_id,
          evidence.child_user_id,
          rewardCredits,
          REFERRAL_QUALIFICATION_HOURS,
          nowPg,
          REFERRAL_LOCATION_RETENTION_HOURS,
          referrerLedgerId,
          refereeLedgerId,
        ),
        env.DB.prepare(
          `INSERT INTO ai_credit_ledger
             (id,family_id,child_user_id,parent_id,delta,reason,source,transaction_id,created_at)
           VALUES (?,?,?,?,?,'referral_reward','referral_reward',?,?)`,
        ).bind(
          referrerLedgerId,
          row.referrer_family_id,
          row.referrer_child_user_id,
          row.referrer_parent_id,
          rewardCredits,
          row.id,
          nowPg,
        ),
        balanceUpsert(env.DB, {
          balanceId: `referral-balance:${row.referrer_family_id}:${row.referrer_child_user_id}`,
          familyId: row.referrer_family_id,
          childUserId: row.referrer_child_user_id,
          parentId: row.referrer_parent_id,
          isPremium: referrerPremium,
          now,
        }),
        env.DB.prepare(
          `INSERT INTO ai_credit_ledger
             (id,family_id,child_user_id,parent_id,delta,reason,source,transaction_id,created_at)
           VALUES (?,?,?,?,?,'referral_reward','referral_reward',?,?)`,
        ).bind(
          refereeLedgerId,
          row.referee_family_id,
          evidence.child_user_id,
          row.referee_parent_id,
          rewardCredits,
          row.id,
          nowPg,
        ),
        balanceUpsert(env.DB, {
          balanceId: `referral-balance:${row.referee_family_id}:${evidence.child_user_id}`,
          familyId: row.referee_family_id,
          childUserId: evidence.child_user_id,
          parentId: row.referee_parent_id,
          isPremium: refereePremium,
          now,
        }),
        env.DB.prepare(
          `UPDATE referral_codes_v2
              SET successful_referrals=successful_referrals+1,updated_at=?
            WHERE id=? AND family_id=?`,
        ).bind(nowPg, row.referral_code_id, row.referrer_family_id),
        env.DB.prepare(
          `UPDATE referral_completions_v2
              SET status='rewarded',qualified_at=COALESCE(qualified_at,?),rewarded_at=?,updated_at=?
            WHERE id=? AND status IN ('pending','qualified')`,
        ).bind(nowPg, nowPg, nowPg, row.id),
      ]);
    } catch {
      const current = await env.DB.prepare(
        "SELECT status FROM referral_completions_v2 WHERE id=? LIMIT 1",
      ).bind(row.id).first<{ status: string }>();
      return current?.status === "rewarded" ? "duplicate" : "failed";
    }

    await Promise.all([
      notifyPg(env, row.referrer_family_id, "ai_credit_balances", "UPDATE", {
        family_id: row.referrer_family_id,
        child_user_id: row.referrer_child_user_id,
      }).catch(() => undefined),
      notifyPg(env, row.referee_family_id, "ai_credit_balances", "UPDATE", {
        family_id: row.referee_family_id,
        child_user_id: evidence.child_user_id,
      }).catch(() => undefined),
    ]);
    return "rewarded";
  } finally {
    await releaseAccountMutationLeases(env.DB, mutationLeases.leases);
  }
}

export interface ReferralRewardRunResult {
  scanned: number;
  rewarded: number;
  rejected: number;
  pending: number;
  failed: number;
}

/** 서버 cron 전용. 사용자/client가 호출할 지급 endpoint는 만들지 않는다. */
export async function processPendingReferralRewards(
  env: Env,
  options: { now?: Date; limit?: number } = {},
): Promise<ReferralRewardRunResult> {
  const now = options.now ?? new Date();
  // hourly invocation의 50-query 상한을 지키는 안전 기본값. 명시적 backfill만 더 크게 요청한다.
  const limit = Math.max(1, Math.min(20, Math.trunc(options.limit ?? 1)));
  const cutoff = pgTs(new Date(now.getTime() - REFERRAL_QUALIFICATION_HOURS * HOUR_MS));
  const { results } = await env.DB.prepare(
    `SELECT id,referral_code_id,referrer_family_id,referrer_parent_id,referrer_child_user_id,
            referee_family_id,referee_parent_id,referee_child_user_id,reward_credits,
            first_location_at,latest_location_at,created_at
       FROM referral_completions_v2
      WHERE status IN ('pending','qualified')
        AND referee_child_user_id IS NOT NULL
        AND first_location_at IS NOT NULL
        AND latest_location_at IS NOT NULL
        AND datetime(substr(latest_location_at,1,19))
          >=datetime(substr(first_location_at,1,19),'+48 hours')
        AND substr(created_at,1,19)<=substr(?,1,19)
      ORDER BY substr(created_at,1,19),id
      LIMIT ?`,
  ).bind(cutoff, limit).all<PendingReferralRow>();
  const outcome: ReferralRewardRunResult = {
    scanned: results.length,
    rewarded: 0,
    rejected: 0,
    pending: 0,
    failed: 0,
  };

  for (const row of results) {
    try {
      const evidence = locationEvidenceFromSummary(row);
      if (!evidence) {
        outcome.pending += 1;
        continue;
      }
      const firstMs = timestampMs(evidence.first_location_at);
      const latestMs = timestampMs(evidence.latest_location_at);
      const createdMs = timestampMs(row.created_at);
      if (
        firstMs === null
        || latestMs === null
        || createdMs === null
        || firstMs < createdMs
        || latestMs < firstMs + REFERRAL_LOCATION_RETENTION_HOURS * HOUR_MS
      ) {
        outcome.pending += 1;
        continue;
      }
      const code = await env.DB.prepare(
        "SELECT successful_referrals FROM referral_codes_v2 WHERE id=? AND family_id=? LIMIT 1",
      ).bind(row.referral_code_id, row.referrer_family_id).first<{ successful_referrals: number }>();
      // 초대 코드 행이 사라졌다면 추천자 쪽을 확인할 수 없다는 뜻이다(사유 enum 은 D1 CHECK 로 고정돼 있다).
      if (!code) {
        if (await markRejected(env.DB, row.id, "referrer_unavailable", now)) outcome.rejected += 1;
        continue;
      }
      const partyState = await referralPartyState(env.DB, row, evidence);
      if (partyState !== "ready") {
        if (await markRejected(env.DB, row.id, partyState, now)) outcome.rejected += 1;
        continue;
      }
      const granted = await grantReferralReward(env, row, evidence, now);
      if (granted === "rewarded") outcome.rewarded += 1;
      else if (granted === "duplicate") outcome.pending += 1;
      else outcome.failed += 1;
    } catch {
      outcome.failed += 1;
    }
  }
  return outcome;
}

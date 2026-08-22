// 가족 라이프사이클(페어링) 라우트. src/lib/auth.js 의 setupFamily/joinFamily/
// joinFamilyAsParent/getMyFamily/regeneratePairCode/updateMyProfile/unpairChild +
// FamilyScreen.jsx 의 rename/profile/photo by_id RPC 를 D1 백엔드로 직역.
//
// Supabase RPC 원본: supabase/migrations/*_join_family*·*pair_code*·*unpair_child*·
// *rename_family_member_by_id*·*set_family_member_profile_by_id*·*set_family_member_photo_url_by_id*.
// 복합 unique(family_id,user_id) 는 D1 미이관 → 모든 upsert 는 select-then-write.
import { Hono } from "hono";
import type { Env, Vars, AuthUser } from "../types";
import type { PushEnv } from "../lib/pushEnv";
import { requireAuth } from "../middleware/auth";
import { pgNow, pgToIso, pgToMs, tsNorm } from "../lib/time";
import {
  resolveCanonicalFamilyMembership,
  resolveVerifiedFamilyMembership,
  commitFamilySelection,
  assertFamilyAccess,
  assertPrimaryParent,
  isFamilyPremium,
} from "../db/authz";
import { parseJson } from "../lib/serialize";
import { normalizeDeviceId } from "../lib/refresh";
import { issueAccountSession } from "../lib/authSession";
import {
  isDeviceIdentityRequiredError,
} from "../lib/accountDeviceSession";
import { notifyPg, revokeFamilyRealtimeUser, revokeFamilyRealtimeUsers } from "../lib/realtime";
import { supersedeActiveChildren } from "../lib/realtimeMembership.ts";
import { insertParentAlertV2 } from "./push-notify";
import { normalizeMemberDisplayName } from "../lib/profileInput";
import {
  collectChildPhotoKeys,
  collectRetainedChildPhotoKeys,
  type AccountMemberReference,
} from "../lib/accountDeletion";
import { processFamilyUnpairCleanup } from "../lib/unpairCleanup";
import { accountDeletionMutationState } from "../lib/accountDeletionClaims";
import { recordFamilyLifecycleEvent } from "../lib/familyLifecycleFunnel";
import {
  ReferralAttributionError,
  buildReferralAttributionStatements,
  normalizeReferralCode,
  prepareReferralAttribution,
  type PreparedReferralAttribution,
} from "../lib/referralRewardsV2";

const family = new Hono<{ Bindings: Env; Variables: Vars }>();

const PAIR_CODE_TTL_MS = 48 * 60 * 60 * 1000;
const RATE_LIMIT_MAX = 10;
const FREE_CHILD_CAP = 1;
const PREMIUM_CHILD_CAP = 2;

const ACCOUNT_DELETION_ABSENT_ONE_USER = `NOT EXISTS (
  SELECT 1 FROM account_deletion_scopes
   WHERE (scope_type='user' AND scope_id=?)
      OR (scope_type='family' AND scope_id=?)
)`;

const ACCOUNT_DELETION_ABSENT_TWO_USERS = `NOT EXISTS (
  SELECT 1 FROM account_deletion_scopes
   WHERE (scope_type='user' AND scope_id IN (?,?))
      OR (scope_type='family' AND scope_id=?)
)`;

const ACTIVE_CHILD_MUTATION_LEASE_ABSENT = `NOT EXISTS (
  SELECT 1 FROM account_mutation_leases
   WHERE user_id=? AND expires_at>?
)`;

const ACTIVE_PARENT_MEMBERSHIP_ABSENT = `NOT EXISTS (
  SELECT 1 FROM family_members
   WHERE user_id=? AND role='parent' AND is_active=1
)`;

const ACTIVE_CHILD_MEMBERSHIP_ABSENT = `NOT EXISTS (
  SELECT 1 FROM family_members
   WHERE user_id=? AND role='child' AND is_active=1
)`;

const FAMILY_STORAGE_UPLOAD_JOURNAL_ABSENT = `NOT EXISTS (
  SELECT 1 FROM storage_invalid_upload_cleanup_jobs
   WHERE family_id=? AND committed_at IS NULL AND cleaned_at IS NULL
)`;

async function hasActiveChildMutationLease(
  db: D1Database,
  childUserId: string,
  now = new Date(),
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS active FROM account_mutation_leases
        WHERE user_id=? AND expires_at>? LIMIT 1`,
    )
    .bind(childUserId, now.toISOString())
    .first<{ active: number }>();
  return !!row;
}

async function hasPendingFamilyStorageUpload(
  db: D1Database,
  familyId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS pending FROM storage_invalid_upload_cleanup_jobs
        WHERE family_id=? AND committed_at IS NULL AND cleaned_at IS NULL LIMIT 1`,
    )
    .bind(familyId)
    .first<{ pending: number }>();
  return !!row;
}

// 'KID-' + 8 upper hex — generatePairCode (auth.js) 직역.
function genPairCode(): string {
  return "KID-" + crypto.randomUUID().replace(/-/g, "").substring(0, 8).toUpperCase();
}

// D1 비교형 타임스탬프(공백 + +00). pair_code_expires_at 등 write 용.
function pgFrom(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").replace("Z", "+00");
}

// family_members.role 로 역할 판정(auth.ts resolveRole 와 동일). child 가 아니면 parent.
async function resolveRole(db: D1Database, uid: string): Promise<AuthUser["role"]> {
  const rm = await db
    .prepare("SELECT role FROM family_members WHERE user_id=? AND is_active=1 AND role IN ('parent','child') LIMIT 1")
    .bind(uid)
    .first<{ role: string }>();
  return rm?.role === "child" ? "child" : "parent";
}

async function isAnonymousUser(db: D1Database, uid: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT is_anonymous FROM users WHERE id=? LIMIT 1")
    .bind(uid)
    .first<{ is_anonymous: number }>();
  return !!Number(row?.is_anonymous);
}

interface FreshSession {
  session: { access_token: string; refresh_token: string; token_type: string };
  user: { id: string; role: AuthUser["role"]; family_id: string | null; is_anonymous: boolean; user_metadata: unknown };
}

// 페어링 성공 후 갱신된 claim(family_id/role/is_anonymous)을 담은 새 세션을 발급한다.
// 익명 user 는 호출 전에 is_anonymous=0 으로 플립돼 있어야 한다(join 라우트가 수행).
// 추가로 해당 user 의 기존 refresh_tokens.family_id 스냅샷도 갱신해 다른 기기/토큰의
// stale family_id 를 해소한다.
async function buildFreshSession(
  env: Env,
  userId: string,
  deviceId: string | null = null,
  preferredFamilyId: string | null = null,
  deviceLabel: string | null = null,
  devicePlatform: string | null = null,
): Promise<FreshSession> {
  const canonicalFamily = preferredFamilyId
    ? await resolveVerifiedFamilyMembership(env.DB, userId, preferredFamilyId)
    : await resolveCanonicalFamilyMembership(env.DB, userId);
  if (preferredFamilyId && !canonicalFamily) {
    throw new Error("family_session_scope_invalid");
  }
  const familyId = canonicalFamily?.familyId ?? null;
  if (preferredFamilyId && familyId) {
    await commitFamilySelection(env.DB, userId, familyId);
  }
  const isAnon = await isAnonymousUser(env.DB, userId);
  const role = isAnon ? "anonymous" : canonicalFamily?.role ?? await resolveRole(env.DB, userId);
  const authUser: AuthUser = { sub: userId, role, family_id: familyId, is_anonymous: isAnon };
  const issued = await issueAccountSession(env, authUser, {
    deviceId,
    deviceLabel,
    devicePlatform,
  });
  const accessToken = issued.accessToken;
  const refreshToken = issued.refreshToken;
  let meta: unknown = {};
  try {
    const row = await env.DB.prepare("SELECT raw_user_meta_data AS m FROM users WHERE id=? LIMIT 1")
      .bind(userId)
      .first<{ m: string | null }>();
    meta = row?.m ? JSON.parse(row.m) : {};
  } catch {
    /* keep {} */
  }
  return {
    session: { access_token: accessToken, refresh_token: refreshToken, token_type: "bearer" },
    user: { id: userId, role, family_id: familyId, is_anonymous: isAnon, user_metadata: meta },
  };
}

// 누락 가능 테이블/행 DELETE 를 best-effort 로 실행(스키마 drift 내성).
async function safeRun(db: D1Database, sql: string, binds: unknown[]): Promise<void> {
  try {
    await db.prepare(sql).bind(...binds).run();
  } catch (e) {
    if (!/no such table/i.test(String(e))) console.warn("[family] safeRun failed:");
  }
}

async function hasPendingUnpairCleanup(
  db: D1Database,
  familyId: string,
  userId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      "SELECT 1 AS pending FROM family_unpair_cleanup_jobs WHERE family_id=? AND child_user_id=? LIMIT 1",
    )
    .bind(familyId, userId)
    .first<{ pending: number }>();
  return !!row;
}

async function revokeChildRealtimeSocket(env: Env, familyId: string, childUserId: string): Promise<void> {
  try {
    await revokeFamilyRealtimeUser(env, familyId, childUserId);
  } catch (error) {
    // 권한 정본에서 제외된 사용자는 이후 audience에 포함되지 않는다. 연결도 즉시
    // 닫기를 시도하되 일시적 DO 장애로 페어링 상태 변경을 실패시키지는 않는다.
    console.error("[family/unpair] realtime socket revoke failed");
  }
}

async function revokeInactiveSameNameChildSockets(
  env: Env,
  familyId: string,
  keepUserId: string,
  name: string,
): Promise<void> {
  const { results } = await env.DB
    .prepare(
      `SELECT user_id FROM family_members
        WHERE family_id=? AND role='child' AND is_active=0
          AND user_id IS NOT NULL AND user_id<>? AND name=?
        ORDER BY user_id`,
    )
    .bind(familyId, keepUserId, name)
    .all<{ user_id: string }>();
  const userIds = [...new Set(
    (results ?? []).map((row) => String(row.user_id ?? "").trim()).filter(Boolean),
  )];
  if (userIds.length === 0) return;
  try {
    await revokeFamilyRealtimeUsers(env, familyId, userIds);
  } catch (error) {
    // 멤버십 권한은 앞선 원자 UPDATE로 이미 닫혔다. DO 연결도 즉시 닫기를 시도하되
    // 일시적 DO 장애가 성공한 페어링 mutation을 되돌리지는 않는다.
    console.error("[family/join] superseded socket revoke failed");
  }
}

// 호출자(uid)가 해당 가족의 부모(주 보호자 OR family_members role='parent')인지.
// regenerate_pair_code RPC 의 parent-only 게이트(families.parent_id OR fm.role='parent') 직역.
async function isFamilyParent(db: D1Database, uid: string, familyId: string): Promise<boolean> {
  if (!familyId) return false;
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM families WHERE id=?1 AND parent_id=?2
       UNION
       SELECT 1 AS ok FROM family_members WHERE family_id=?1 AND user_id=?2 AND role='parent' AND is_active=1
       LIMIT 1`,
    )
    .bind(familyId, uid)
    .first<{ ok: number }>();
  return !!row;
}

async function childCapForFamily(db: D1Database, familyId: string): Promise<number> {
  const premium = await isFamilyPremium(db, familyId, /* failOpen */ false);
  return premium ? PREMIUM_CHILD_CAP : FREE_CHILD_CAP;
}

async function activeChildCount(
  db: D1Database,
  familyId: string,
  opts: { connectedOnly?: boolean; excludeUserId?: string } = {},
): Promise<number> {
  const where = ["family_id=?", "role='child'", "is_active=1"];
  const binds: unknown[] = [familyId];
  if (opts.connectedOnly) where.push("user_id IS NOT NULL");
  if (opts.excludeUserId) {
    where.push("(user_id IS NULL OR user_id<>?)");
    binds.push(opts.excludeUserId);
  }
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM family_members WHERE ${where.join(" AND ")}`)
    .bind(...binds)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

function childLimitPayload(cap: number) {
  return {
    error:
      cap >= PREMIUM_CHILD_CAP
        ? "프리미엄에서는 아이 2명까지 연결할 수 있어요. 기존 아이를 해제한 뒤 다시 시도해 주세요."
        : "무료에서는 아이 1명까지 연결할 수 있어요. 추가 아이 연결은 프리미엄에서 가능해요.",
    code: "child_limit_reached",
    cap,
  };
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function uuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

interface ChildReuseHint {
  previousUserId: string;
  previousFamilyId: string;
  deviceInstallId: string;
  deviceLabel: string;
}

interface ReusableChild {
  id: string;
  user_id: string;
  name: string;
}

async function reusableChildByUserId(
  db: D1Database,
  familyId: string,
  currentUserId: string,
  previousUserId: string,
): Promise<ReusableChild | null> {
  if (!uuidLike(previousUserId) || previousUserId === currentUserId) return null;
  const row = await db
    .prepare(
      `SELECT id, user_id, name FROM family_members
        WHERE family_id=? AND role='child' AND is_active=1 AND user_id=?
        LIMIT 1`,
    )
    .bind(familyId, previousUserId)
    .first<ReusableChild>();
  return row ?? null;
}

async function reusableChildByDeviceInstallId(
  db: D1Database,
  familyId: string,
  currentUserId: string,
  deviceInstallId: string,
): Promise<ReusableChild | null> {
  if (!deviceInstallId) return null;
  try {
    const row = await db
      .prepare(
        `SELECT id, user_id, name FROM family_members
          WHERE family_id=? AND role='child' AND is_active=1
            AND user_id IS NOT NULL AND user_id<>?
            AND device_health IS NOT NULL
            AND json_valid(device_health)
            AND json_extract(device_health, '$.deviceInstallId')=?
          LIMIT 1`,
      )
      .bind(familyId, currentUserId, deviceInstallId)
      .first<ReusableChild>();
    return row ?? null;
  } catch (e) {
    console.warn("[family/join] deviceInstallId reuse lookup failed:");
    return null;
  }
}

async function reusableChildByUniqueDeviceLabel(
  db: D1Database,
  familyId: string,
  currentUserId: string,
  deviceLabel: string,
): Promise<ReusableChild | null> {
  if (!deviceLabel) return null;
  const { results } = await db
    .prepare(
      `SELECT id, user_id, name FROM family_members
        WHERE family_id=? AND role='child' AND is_active=1
          AND user_id IS NOT NULL AND user_id<>? AND device_label=?
        ORDER BY COALESCE(child_order, 999999), id
        LIMIT 2`,
    )
    .bind(familyId, currentUserId, deviceLabel)
    .all<ReusableChild>();
  return results.length === 1 ? results[0] : null;
}

async function reuseExistingChild(
  db: D1Database,
  familyId: string,
  currentUserId: string,
  hint: ChildReuseHint,
): Promise<ReusableChild | null> {
  if (hint.previousFamilyId && hint.previousFamilyId !== familyId) return null;
  return (
    (await reusableChildByUserId(db, familyId, currentUserId, hint.previousUserId)) ??
    (await reusableChildByDeviceInstallId(db, familyId, currentUserId, hint.deviceInstallId)) ??
    (await reusableChildByUniqueDeviceLabel(db, familyId, currentUserId, hint.deviceLabel))
  );
}

// pair_attempts 레이트리밋(1시간 10회) + 시도 기록. 초과 시 false.
async function checkAndRecordAttempt(db: D1Database, userId: string): Promise<boolean> {
  const threshold = tsNorm(new Date(Date.now() - 60 * 60 * 1000).toISOString());
  const cnt = await db
    .prepare("SELECT COUNT(*) AS n FROM pair_attempts WHERE user_id=? AND substr(attempted_at,1,19) > ?")
    .bind(userId, threshold)
    .first<{ n: number }>();
  if (Number(cnt?.n ?? 0) >= RATE_LIMIT_MAX) return false;
  await db.prepare("INSERT INTO pair_attempts (user_id, attempted_at) VALUES (?,?)").bind(userId, pgNow()).run();
  return true;
}

const MEMBER_COLS =
  "id, user_id, role, name, phone, gender, emoji, child_order, color_hex, birthdate, photo_url, device_label, device_health";

function hydrateMember(m: Record<string, unknown>): Record<string, unknown> {
  return { ...m, device_health: parseJson(m.device_health) };
}

// ── POST /setup — setupFamily (families upsert + parent member + children) ────
family.post("/setup", requireAuth, async (c) => {
  const user = c.get("user");
  const userId = user.sub;
  // JWT claim은 과거 토큰이거나 변조 시도의 입력일 수 있으므로, 가족 생성 권한은
  // users 정본의 실명 계정 여부를 먼저 확인한다. 익명 자녀 세션은 join만 허용한다.
  const account = await c.env.DB
    .prepare("SELECT is_anonymous FROM users WHERE id=? LIMIT 1")
    .bind(userId)
    .first<{ is_anonymous: number }>();
  if (!account || Number(account.is_anonymous) !== 0) {
    return c.json({ error: "anonymous_parent_setup_forbidden" }, 403);
  }
  const setupDeletionState = await accountDeletionMutationState(c.env.DB, { userIds: [userId] });
  if (setupDeletionState === "blocked") {
    return c.json({ error: "account_deletion_in_progress" }, 409);
  }
  if (setupDeletionState === "unavailable") {
    return c.json({ error: "account_deletion_guard_unavailable" }, 503);
  }
  let body: Record<string, unknown>;
  try {
    const parsed = await c.req.json<unknown>();
    if (!isRecord(parsed)) return c.json({ error: "invalid_setup_payload" }, 400);
    body = parsed;
  } catch {
    return c.json({ error: "invalid_setup_payload" }, 400);
  }
  const parentName = String(body.parentName ?? "").trim();
  const familyName = typeof body.familyName === "string" ? body.familyName : "";
  const plannedChildCount = Number(body.plannedChildCount ?? 1) || 1;
  const children = Array.isArray(body.children) ? (body.children as Record<string, unknown>[]) : [];
  const parentPhone = typeof body.parentPhone === "string" ? body.parentPhone.trim() : "";
  const parentGender = typeof body.parentGender === "string" ? body.parentGender : "";
  const referralLikeKeys = Object.keys(body).filter((key) => key.toLowerCase().includes("referral"));
  if (referralLikeKeys.some((key) => key !== "referralCode")) {
    return c.json({ error: "referral_code_invalid" }, 400);
  }
  const hasReferralCode = Object.prototype.hasOwnProperty.call(body, "referralCode");
  const referralCode = hasReferralCode ? normalizeReferralCode(body.referralCode) : null;
  if (hasReferralCode && !referralCode) {
    return c.json({ error: "referral_code_invalid" }, 400);
  }

  // 1. 본인 소유 family 조회 → 있으면 조건부 update, 없으면 신규 insert.
  const canonicalFamily = await resolveCanonicalFamilyMembership(c.env.DB, userId, user.family_id ?? null);
  const existing = await c.env.DB.prepare(
    `SELECT f.id, f.pair_code, f.planned_child_count
       FROM families f
      WHERE f.parent_id=?1
      ORDER BY CASE WHEN f.id=?2 THEN 0 ELSE 1 END,
               (SELECT COUNT(*) FROM family_members fm
                 WHERE fm.family_id=f.id AND fm.is_active=1) DESC,
               substr(COALESCE(f.created_at,''),1,19) DESC,
               f.id ASC
      LIMIT 1`,
  )
    .bind(userId, canonicalFamily?.familyId ?? "")
    .first<{ id: string; pair_code: string; planned_child_count: number }>();

  let familyId: string;
  let pairCode: string;
  let setupChildCap = FREE_CHILD_CAP;
  const setupStatements: D1PreparedStatement[] = [];
  let childInsertStatementIndex: number | null = null;
  let referralGuardStatementIndex: number | null = null;
  let referralCompletionStatement: D1PreparedStatement | null = null;
  let referralAttribution: PreparedReferralAttribution | null = null;
  if (existing) {
    familyId = existing.id;
    pairCode = existing.pair_code;
    if (referralCode) {
      try {
        await prepareReferralAttribution(c.env.DB, {
          code: referralCode,
          refereeFamilyId: familyId,
          refereeParentId: userId,
        });
      } catch (error) {
        if (error instanceof ReferralAttributionError) {
          return c.json({ error: error.message }, error.status);
        }
        throw error;
      }
      return c.json({ error: "referral_existing_family_forbidden" }, 409);
    }
    if (children.length > 0) {
      const cap = await childCapForFamily(c.env.DB, familyId);
      setupChildCap = cap;
      const activeChildren = await activeChildCount(c.env.DB, familyId);
      if (activeChildren + children.length > cap) {
        return c.json(childLimitPayload(cap), 403);
      }
    }
    const sets: string[] = [];
    const binds: unknown[] = [];
    if (plannedChildCount && plannedChildCount !== existing.planned_child_count) {
      sets.push("planned_child_count=?");
      binds.push(plannedChildCount);
    }
    if (parentName) {
      sets.push("parent_name=?");
      binds.push(parentName);
    }
    if (familyName) {
      sets.push("name=?");
      binds.push(familyName);
    }
    if (sets.length === 0) sets.push("id=id");
    setupStatements.push(
      c.env.DB
        .prepare(
          `UPDATE families SET ${sets.join(", ")}
            WHERE id=? AND parent_id=?
              AND ${ACCOUNT_DELETION_ABSENT_ONE_USER}`,
        )
        .bind(...binds, familyId, userId, userId, familyId),
    );
  } else {
    familyId = crypto.randomUUID();
    pairCode = genPairCode();
    const cap = await childCapForFamily(c.env.DB, familyId);
    setupChildCap = cap;
    const requestedChildren = children.length > 0 ? children.length : plannedChildCount;
    if (requestedChildren > cap) {
      return c.json(childLimitPayload(cap), 403);
    }
    if (referralCode) {
      try {
        referralAttribution = await prepareReferralAttribution(c.env.DB, {
          code: referralCode,
          refereeFamilyId: familyId,
          refereeParentId: userId,
        });
      } catch (error) {
        if (error instanceof ReferralAttributionError) {
          return c.json({ error: error.message }, error.status);
        }
        throw error;
      }
      const [guardStatement, completionStatement] = buildReferralAttributionStatements(
        c.env.DB,
        referralAttribution,
      );
      referralGuardStatementIndex = setupStatements.length;
      setupStatements.push(guardStatement);
      referralCompletionStatement = completionStatement;
    }
    setupStatements.push(c.env.DB.prepare(
      `INSERT INTO families
         (id, parent_id, pair_code, planned_child_count, parent_name, name, created_at, referred_by_family_id)
       SELECT ?,?,?,?,?,?,?,?
        WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND is_anonymous=0)
          AND NOT EXISTS(SELECT 1 FROM families WHERE parent_id=?)
          AND ${ACCOUNT_DELETION_ABSENT_ONE_USER}`,
    )
      .bind(
        familyId,
        userId,
        pairCode,
        plannedChildCount,
        parentName || "부모",
        familyName,
        pgNow(),
        referralAttribution?.referrerFamilyId ?? null,
        userId,
        userId,
        userId,
        familyId,
      ));
  }

  // 2. 부모 family_members upsert. 실제 쓰기는 아래 한 D1 batch에서 가족 쓰기와 함께 확정한다.
  const parentMember = await c.env.DB.prepare(
    "SELECT id, phone, gender FROM family_members WHERE family_id=? AND user_id=? LIMIT 1",
  )
    .bind(familyId, userId)
    .first<{ id: string; phone: string | null; gender: string | null }>();
  const isKnownGender = parentGender === "mom" || parentGender === "dad" || parentGender === "guardian";
  if (parentMember) {
    setupStatements.push(
      c.env.DB.prepare(
        `UPDATE family_members
            SET role='parent',
                is_active=1,
                name=?,
                phone=CASE WHEN ?<>'' AND COALESCE(phone,'')='' THEN ? ELSE phone END,
                gender=CASE WHEN ?=1 AND COALESCE(gender,'')='' THEN ? ELSE gender END
          WHERE id=? AND family_id=? AND user_id=?
            AND EXISTS(SELECT 1 FROM families WHERE id=? AND parent_id=?)
            AND ${ACCOUNT_DELETION_ABSENT_ONE_USER}`,
      ).bind(
        parentName || "부모",
        parentPhone,
        parentPhone,
        isKnownGender ? 1 : 0,
        parentGender,
        parentMember.id,
        familyId,
        userId,
        familyId,
        userId,
        userId,
        familyId,
      ),
    );
  } else {
    setupStatements.push(
      c.env.DB.prepare(
        `INSERT INTO family_members
           (id,family_id,user_id,role,name,phone,gender,created_at)
         SELECT ?,?,?,'parent',?,?,?,?
          WHERE EXISTS(SELECT 1 FROM families WHERE id=? AND parent_id=?)
            AND NOT EXISTS(
              SELECT 1 FROM family_members WHERE family_id=? AND user_id=?
            )
            AND ${ACCOUNT_DELETION_ABSENT_ONE_USER}`,
      ).bind(
        crypto.randomUUID(),
        familyId,
        userId,
        parentName || "부모",
        parentPhone,
        isKnownGender ? parentGender : "",
        pgNow(),
        familyId,
        userId,
        familyId,
        userId,
        userId,
        familyId,
      ),
    );
  }

  // 3. 자녀 placeholder를 한 문장으로 넣고, 같은 문장 안에서 현재 활성 자녀 수를
  // 다시 확인한다. D1이 경쟁 batch를 직렬화할 때 뒤 요청은 0행이 되어 cap을 넘지 않는다.
  if (children.length > 0) {
    const childRows = children.map((ch, index) => ({
      id: crypto.randomUUID(),
      name: String(ch.name ?? ""),
      birthdate: (ch.birthdate as string) || null,
      colorHex: (ch.color_hex as string) ?? null,
      photoUrl: (ch.photo_url as string) || null,
      childOrder: index + 1,
      createdAt: pgNow(),
    }));
    const childSelectSql = childRows
      .map(() => "SELECT ? AS id, ? AS name, ? AS birthdate, ? AS color_hex, ? AS photo_url, ? AS child_order, ? AS created_at")
      .join(" UNION ALL ");
    const childBindings = childRows.flatMap((row) => [
      row.id,
      row.name,
      row.birthdate,
      row.colorHex,
      row.photoUrl,
      row.childOrder,
      row.createdAt,
    ]);
    childInsertStatementIndex = setupStatements.length;
    setupStatements.push(c.env.DB.prepare(
      `INSERT INTO family_members
         (id, family_id, user_id, role, name, birthdate, color_hex, photo_url, child_order, created_at)
       SELECT child.id, ?, NULL, 'child', child.name, child.birthdate, child.color_hex,
              child.photo_url, child.child_order, child.created_at
         FROM (${childSelectSql}) AS child
        WHERE EXISTS(SELECT 1 FROM families WHERE id=? AND parent_id=?)
          AND ${ACCOUNT_DELETION_ABSENT_ONE_USER}
          AND (
            SELECT COUNT(*) FROM family_members
             WHERE family_id=? AND role='child' AND is_active=1
          ) + ? <= ?`,
    ).bind(
      familyId,
      ...childBindings,
      familyId,
      userId,
      userId,
      familyId,
      familyId,
      children.length,
      setupChildCap,
    ));
  }

  if (referralCompletionStatement) setupStatements.push(referralCompletionStatement);

  try {
    const results = await c.env.DB.batch(setupStatements);
    const childChanges = childInsertStatementIndex === null
      ? null
      : Number(results[childInsertStatementIndex]?.meta?.changes ?? 0);
    if (childChanges !== null && childChanges !== children.length) {
      const currentCount = await activeChildCount(c.env.DB, familyId);
      if (currentCount + children.length > setupChildCap) {
        return c.json(childLimitPayload(setupChildCap), 403);
      }
      return c.json({ error: "family_setup_retryable" }, 503);
    }
    if (
      results.length !== setupStatements.length
      || results.some((result, index) => index !== referralGuardStatementIndex
        && Number(result.meta?.changes ?? 0)
          !== (index === childInsertStatementIndex ? children.length : 1))
    ) {
      return c.json({ error: "account_deletion_in_progress" }, 409);
    }
  } catch (error) {
    const state = await accountDeletionMutationState(c.env.DB, {
      userIds: [userId],
      familyIds: [familyId],
    });
    const userStillExists = await c.env.DB
      .prepare("SELECT 1 AS ok FROM users WHERE id=? AND is_anonymous=0 LIMIT 1")
      .bind(userId)
      .first<{ ok: number }>();
    if (state === "blocked" || !userStillExists) {
      return c.json({ error: "account_deletion_in_progress" }, 409);
    }
    if (referralAttribution && /referral_attribution_invalid|malformed json/i.test(String(error))) {
      return c.json({ error: "referral_attribution_changed" }, 409);
    }
    console.error("[family/setup] atomic write failed");
    return c.json({ error: "family_setup_retryable" }, 503);
  }

  await notifyPg(c.env, familyId, "family_members", "INSERT", { family_id: familyId }, null);
  await commitFamilySelection(c.env.DB, userId, familyId);
  await recordFamilyLifecycleEvent(c.env, {
    familyId,
    event: "family_created",
  });
  return c.json({ id: familyId, pair_code: pairCode });
});

// ── POST /join — joinFamily (child, pair code) + 익명 user 전환 + 세션 재발급 ──
family.post("/join", requireAuth, async (c) => {
  const user = c.get("user");
  const userId = user.sub;
  const body = await c.req.json<Record<string, unknown>>();
  const raw = String(body.pairCode ?? body.pair_code ?? "").trim();
  if (!raw) return c.json({ error: "연동 코드를 입력해주세요", code: "invalid_pair_code" }, 400);
  const pairCode = raw.toUpperCase();
  const reqName = typeof body.name === "string" ? body.name.trim() : "";
  const name = reqName || "아이";
  const deviceLabel = cleanText(body.device_label);
  const deviceInstallId = cleanText(body.device_install_id);
  const childPlatform = cleanText(body.device_platform) === "android" ? "android" : null;
  const previousUserId = cleanText(body.previous_user_id);
  const previousFamilyId = cleanText(body.previous_family_id);
  let sessionUserId = userId;

  if (!(await checkAndRecordAttempt(c.env.DB, userId))) {
    return c.json({ error: "Too many attempts. Try again later." }, 429);
  }

  const fam = await c.env.DB.prepare(
    "SELECT id, pair_code_expires_at FROM families WHERE pair_code=? LIMIT 1",
  )
    .bind(pairCode)
    .first<{ id: string; pair_code_expires_at: string | null }>();
  if (!fam) return c.json({ error: "Invalid pair code", code: "invalid_pair_code" }, 400);
  if (fam.pair_code_expires_at && pgToMs(fam.pair_code_expires_at) < Date.now()) {
    return c.json({
      error: "만료된 연동 코드예요. 부모님께 새 코드를 받아 주세요",
      code: "pair_code_expired",
    }, 400);
  }
  const familyId = fam.id;
  const initialDeletionState = await accountDeletionMutationState(c.env.DB, {
    userIds: [userId],
    familyIds: [familyId],
  });
  if (initialDeletionState === "blocked") {
    return c.json({ error: "account_deletion_in_progress" }, 409);
  }
  if (initialDeletionState === "unavailable") {
    return c.json({ error: "account_deletion_guard_unavailable" }, 503);
  }
  if (await hasPendingUnpairCleanup(c.env.DB, familyId, userId)) {
    return c.json({ error: "연결 해제를 정리 중이에요. 잠시 후 다시 시도해 주세요" }, 409);
  }

  if (user.role === "parent") {
    return c.json({
      error: "이미 보호자 계정이에요. 보호자 연결은 다른 경로로 진행해 주세요",
      code: "parent_cannot_join_as_child",
    }, 400);
  }
  if (user.role === "teacher") {
    return c.json({
      error: "현재 역할로는 아이 기기에 연결할 수 없어요",
      code: "role_cannot_join_as_child",
    }, 403);
  }

  // ★역할 검증: 이미 다른 가족에서 parent인 사용자는 child 전용 /join을 호출할 수 없다.
  //   보호자가 실수로 자녀 페어링 링크를 타면 join-as-parent 로 안내한다.
  const callerParentMember = await c.env.DB.prepare(
    `SELECT 1 AS ok FROM family_members
      WHERE user_id=? AND role='parent' AND is_active=1
      LIMIT 1`,
  )
    .bind(userId)
    .first<{ ok: number }>();
  if (callerParentMember) {
    return c.json({
      error: "이미 보호자 계정이에요. 보호자 연결은 다른 경로로 진행해 주세요",
      code: "parent_cannot_join_as_child",
    }, 400);
  }

  // Path A: 이미 멤버 → 멱등(자녀면 재활성 + 동명 다른 활성 supersede).
  const already = await c.env.DB.prepare(
    "SELECT id, role, name, is_active FROM family_members WHERE family_id=? AND user_id=? LIMIT 1",
  )
    .bind(familyId, userId)
    .first<{ id: string; role: string; name: string; is_active: number | null }>();

  if (!already) {
    const reusable = await reuseExistingChild(c.env.DB, familyId, userId, {
      previousUserId,
      previousFamilyId,
      deviceInstallId,
      deviceLabel,
    });

    if (reusable) {
      sessionUserId = reusable.user_id;
      const sets = ["is_active=1"];
      const binds: unknown[] = [];
      if (deviceLabel) {
        sets.push("device_label=?");
        binds.push(deviceLabel);
      }
      const mutation = await c.env.DB.batch([
        c.env.DB.prepare(
          `UPDATE family_members SET ${sets.join(", ")}
            WHERE id=?
              AND EXISTS(SELECT 1 FROM users WHERE id=?)
              AND ${ACTIVE_PARENT_MEMBERSHIP_ABSENT}
              AND ${ACTIVE_PARENT_MEMBERSHIP_ABSENT}
              AND ${ACCOUNT_DELETION_ABSENT_TWO_USERS}`,
        ).bind(
          ...binds,
          reusable.id,
          sessionUserId,
          userId,
          sessionUserId,
          userId,
          sessionUserId,
          familyId,
        ),
        c.env.DB.prepare(
          `UPDATE users SET is_anonymous=0
            WHERE id=? AND ${ACCOUNT_DELETION_ABSENT_TWO_USERS}`,
        ).bind(sessionUserId, userId, sessionUserId, familyId),
      ]);
      if (
        Number(mutation[0]?.meta?.changes ?? 0) !== 1
        || Number(mutation[1]?.meta?.changes ?? 0) !== 1
      ) {
        return c.json({ error: "join_session_invalidated" }, 409);
      }
      await supersedeActiveChildren(c.env, {
        familyId,
        keepUserId: sessionUserId,
        name: reusable.name,
      });
      await notifyPg(c.env, familyId, "family_members", "UPDATE", { family_id: familyId, user_id: sessionUserId }, null);
    } else {
      // Path B: unclaimed placeholder(user_id IS NULL) 우선 채움.
      // is_active=1 만 — 은퇴한(비활성) placeholder 에 새 아이가 붙으면 부모 화면(활성
      // 아이만 표시)에서 보이지 않는 유령 페어링이 된다.
      const placeholder = await c.env.DB.prepare(
        `SELECT id, name FROM family_members
          WHERE family_id=? AND role='child' AND user_id IS NULL AND is_active=1
          ORDER BY (CASE WHEN name=? THEN 0 ELSE 1 END), COALESCE(child_order, 999999), id
          LIMIT 1`,
      )
        .bind(familyId, name)
        .first<{ id: string; name: string }>();

      const sameNameActive = placeholder
        ? null
        : await c.env.DB.prepare(
            `SELECT id FROM family_members
              WHERE family_id=? AND role='child' AND is_active=1
                AND user_id IS NOT NULL AND user_id<>? AND name=?
              LIMIT 1`,
          )
            .bind(familyId, userId, name)
            .first<{ id: string }>();
      const cap = await childCapForFamily(c.env.DB, familyId);

      // 새 슬롯을 쓰는 등록은 먼저 상한을 확인한다. 같은 이름 활성 자녀를 대체하는
      // 기기교체(Path C)는 슬롯 수가 늘지 않으므로 허용하되, 기존 아이를 사후에 밀어내지 않는다.
      if (!sameNameActive) {
        const connected = await activeChildCount(c.env.DB, familyId, { connectedOnly: true });
        if (connected >= cap) {
          return c.json(childLimitPayload(cap), 403);
        }
      }

      if (placeholder) {
        const newName = name && name !== "아이" ? name : placeholder.name;
        // is_active=1 을 명시(방어) — placeholder 는 활성이어야 하지만 재활성 보장.
        const mutation = await c.env.DB.batch([
          c.env.DB.prepare(
            `UPDATE family_members SET user_id=?, name=?, is_active=1
              WHERE id=? AND family_id=? AND role='child' AND is_active=1 AND user_id IS NULL
                AND (
                  SELECT COUNT(*) FROM family_members
                   WHERE family_id=? AND role='child' AND is_active=1 AND user_id IS NOT NULL
                ) < ?
                AND EXISTS(SELECT 1 FROM users WHERE id=?)
                AND ${ACTIVE_PARENT_MEMBERSHIP_ABSENT}
                AND ${ACCOUNT_DELETION_ABSENT_ONE_USER}`,
          ).bind(
            userId,
            newName,
            placeholder.id,
            familyId,
            familyId,
            cap,
            userId,
            userId,
            userId,
            familyId,
          ),
          c.env.DB.prepare(
            `UPDATE users SET is_anonymous=0
              WHERE id=?
                AND EXISTS(
                  SELECT 1 FROM family_members
                   WHERE id=? AND family_id=? AND user_id=?
                     AND role='child' AND is_active=1
                )
                AND ${ACCOUNT_DELETION_ABSENT_ONE_USER}`,
          ).bind(userId, placeholder.id, familyId, userId, userId, familyId),
        ]);
        if (
          Number(mutation[0]?.meta?.changes ?? 0) !== 1
          || Number(mutation[1]?.meta?.changes ?? 0) !== 1
        ) {
          return c.json({ error: "join_session_invalidated" }, 409);
        }
      } else {
        // Path C: 재가입(새 user_id) 후보. 활성기기 격리: 같은 이름의 기존 활성 자녀를
        // supersede(is_active=0)한 뒤 새 기기를 활성으로 삽입한다. 옛 user_id 는
        // is_active=0 이 되어 모든 부모-대상 경로에서 제외된다(정확 동명만 → 이명 형제 보존).
        const memberId = crypto.randomUUID();
        const mutation = await c.env.DB.batch([
          c.env.DB.prepare(
            `INSERT INTO family_members (id, family_id, user_id, role, name, is_active, created_at)
             SELECT ?,?,?, 'child',?,1,?
              WHERE EXISTS(SELECT 1 FROM users WHERE id=?)
                AND ${ACTIVE_PARENT_MEMBERSHIP_ABSENT}
                AND ${ACCOUNT_DELETION_ABSENT_ONE_USER}
                AND (
                  EXISTS(
                    SELECT 1 FROM family_members
                     WHERE family_id=? AND role='child' AND is_active=1
                       AND user_id IS NOT NULL AND user_id<>? AND name=?
                  )
                  OR (
                    SELECT COUNT(*) FROM family_members
                     WHERE family_id=? AND role='child' AND is_active=1
                       AND user_id IS NOT NULL
                  ) < ?
                )`,
          ).bind(
            memberId,
            familyId,
            userId,
            name,
            pgNow(),
            userId,
            userId,
            userId,
            familyId,
            familyId,
            userId,
            name,
            familyId,
            cap,
          ),
          c.env.DB.prepare(
            `UPDATE users SET is_anonymous=0
              WHERE id=?
                AND EXISTS(
                  SELECT 1 FROM family_members
                   WHERE id=? AND family_id=? AND user_id=?
                     AND role='child' AND is_active=1
                )
                AND ${ACCOUNT_DELETION_ABSENT_ONE_USER}`,
          ).bind(userId, memberId, familyId, userId, userId, familyId),
          c.env.DB.prepare(
            `UPDATE family_members SET is_active=0
              WHERE family_id=? AND role='child' AND is_active=1
                AND user_id IS NOT NULL AND user_id<>? AND name=?
                AND EXISTS(
                  SELECT 1 FROM family_members
                   WHERE id=? AND family_id=? AND user_id=?
                     AND role='child' AND is_active=1
                )`,
          ).bind(familyId, userId, name, memberId, familyId, userId),
        ]);
        if (
          Number(mutation[0]?.meta?.changes ?? 0) !== 1
          || Number(mutation[1]?.meta?.changes ?? 0) !== 1
        ) {
          const replacement = await c.env.DB.prepare(
            `SELECT 1 AS ok FROM family_members
              WHERE family_id=? AND role='child' AND is_active=1
                AND user_id IS NOT NULL AND user_id<>? AND name=? LIMIT 1`,
          ).bind(familyId, userId, name).first<{ ok: number }>();
          const connected = await activeChildCount(c.env.DB, familyId, { connectedOnly: true });
          if (!replacement && connected >= cap) return c.json(childLimitPayload(cap), 403);
          return c.json({ error: "join_session_invalidated" }, 409);
        }
        // 새 membership insert와 동명 기기 비활성화를 한 batch에서 선형화한 뒤,
        // 이미 권한이 닫힌 구기기의 realtime 연결도 즉시 종료한다.
        await revokeInactiveSameNameChildSockets(c.env, familyId, userId, name);

        // 재가입 감지 알림(best-effort) — premium + 자녀수 초과 시 child_rejoined.
        try {
          const cc = await c.env.DB.prepare(
            "SELECT COUNT(*) AS n FROM family_members WHERE family_id=? AND role='child'",
          )
            .bind(familyId)
            .first<{ n: number }>();
          const pl = await c.env.DB.prepare("SELECT planned_child_count FROM families WHERE id=?")
            .bind(familyId)
            .first<{ planned_child_count: number }>();
          const premium = await isFamilyPremium(c.env.DB, familyId, false);
          const planned = Math.max(Number(pl?.planned_child_count ?? 1) || 1, 1);
          if (premium && Number(cc?.n ?? 0) > planned) {
            await insertParentAlertV2(c.env as PushEnv, c.env.DB, {
              familyId,
              alertType: "child_rejoined",
              title: "자녀 기기 변경 감지",
              message: "자녀가 다시 연결됐을 수 있어요. 가족 화면에서 확인해 주세요.",
              severity: "warning",
              eventId: null,
              childUserId: userId,
            });
          }
        } catch (e) {
          console.warn("[family/join] rejoin detect failed:");
        }
      }
      await notifyPg(c.env, familyId, "family_members", "INSERT", { family_id: familyId, user_id: userId }, null);
    }
  } else if (already.role === "child") {
    // Path A(자녀 재페어링, 동일 user_id): 본인 행 재활성 + 동명 다른 활성 자녀 supersede.
    // (이전에 다른 기기에 의해 superseded 됐던 옛 기기가 되돌아온 경우 알림 재개 보장.)
    const wasInactive = Number(already.is_active) !== 1;
    const cap = wasInactive ? await childCapForFamily(c.env.DB, familyId) : FREE_CHILD_CAP;
    if (wasInactive) {
      const sameNameActive = await c.env.DB.prepare(
        `SELECT id FROM family_members
          WHERE family_id=? AND role='child' AND is_active=1
            AND user_id IS NOT NULL AND user_id<>? AND name=?
          LIMIT 1`,
      )
        .bind(familyId, userId, already.name)
        .first<{ id: string }>();
      if (!sameNameActive) {
        const connected = await activeChildCount(c.env.DB, familyId, {
          connectedOnly: true,
          excludeUserId: userId,
        });
        if (connected >= cap) {
          return c.json(childLimitPayload(cap), 403);
        }
      }
    }
    const mutation = await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE family_members SET is_active=1
          WHERE id=? AND family_id=? AND user_id=? AND role='child'
            AND (
              is_active=1
              OR EXISTS(
                SELECT 1 FROM family_members AS same_name
                 WHERE same_name.family_id=? AND same_name.role='child'
                   AND same_name.is_active=1 AND same_name.user_id IS NOT NULL
                   AND same_name.user_id<>? AND same_name.name=?
              )
              OR (
                SELECT COUNT(*) FROM family_members AS connected
                 WHERE connected.family_id=? AND connected.role='child'
                   AND connected.is_active=1 AND connected.user_id IS NOT NULL
                   AND connected.user_id<>?
              ) < ?
            )
            AND EXISTS(SELECT 1 FROM users WHERE id=?)
            AND ${ACTIVE_PARENT_MEMBERSHIP_ABSENT}
            AND ${ACCOUNT_DELETION_ABSENT_ONE_USER}`,
      ).bind(
        already.id,
        familyId,
        userId,
        familyId,
        userId,
        already.name,
        familyId,
        userId,
        cap,
        userId,
        userId,
        userId,
        familyId,
      ),
      c.env.DB.prepare(
        `UPDATE users SET is_anonymous=0
          WHERE id=?
            AND EXISTS(
              SELECT 1 FROM family_members
               WHERE id=? AND family_id=? AND user_id=?
                 AND role='child' AND is_active=1
            )
            AND ${ACCOUNT_DELETION_ABSENT_ONE_USER}`,
      ).bind(userId, already.id, familyId, userId, userId, familyId),
      c.env.DB.prepare(
        `UPDATE family_members SET is_active=0
          WHERE family_id=? AND role='child' AND is_active=1
            AND user_id IS NOT NULL AND user_id<>? AND name=?
            AND EXISTS(
              SELECT 1 FROM family_members
               WHERE id=? AND family_id=? AND user_id=?
                 AND role='child' AND is_active=1
            )`,
      ).bind(familyId, userId, already.name, already.id, familyId, userId),
    ]);
    if (
      Number(mutation[0]?.meta?.changes ?? 0) !== 1
      || Number(mutation[1]?.meta?.changes ?? 0) !== 1
    ) {
      if (wasInactive) {
        const replacement = await c.env.DB.prepare(
          `SELECT 1 AS ok FROM family_members
            WHERE family_id=? AND role='child' AND is_active=1
              AND user_id IS NOT NULL AND user_id<>? AND name=? LIMIT 1`,
        ).bind(familyId, userId, already.name).first<{ ok: number }>();
        const connected = await activeChildCount(c.env.DB, familyId, {
          connectedOnly: true,
          excludeUserId: userId,
        });
        if (!replacement && connected >= cap) return c.json(childLimitPayload(cap), 403);
      }
      return c.json({ error: "join_session_invalidated" }, 409);
    }
    await revokeInactiveSameNameChildSockets(c.env, familyId, userId, already.name);
  } else {
    // child 전용 엔드포인트 — parent·teacher 등 다른 역할이 이미 멤버면 거부.
    // 보호자가 실수로 자녀 페어링 링크(/join)를 타면 join-as-parent 로 안내한다.
    return c.json({
      error: "이미 보호자로 등록된 계정이에요. 보호자 연결은 다른 경로로 진행해 주세요",
      code: "already_parent_member",
    }, 400);
  }

  // 각 membership mutation과 같은 D1 batch에서 is_anonymous=0을 확정한 뒤
  // deviceInstallId가 바인딩된 새 세션을 발급한다.
  let fresh: FreshSession;
  try {
    fresh = await buildFreshSession(
      c.env,
      sessionUserId,
      normalizeDeviceId(deviceInstallId),
      familyId,
      deviceLabel,
      childPlatform,
    );
  } catch (error) {
    if (isDeviceIdentityRequiredError(error)) {
      return c.json({ error: "device_identity_required" }, 400);
    }
    const state = await accountDeletionMutationState(c.env.DB, {
      userIds: [userId, sessionUserId],
      familyIds: [familyId],
    });
    if (state !== "clear") return c.json({ error: "account_deletion_in_progress" }, 409);
    throw error;
  }
  const postJoinState = await accountDeletionMutationState(c.env.DB, {
    userIds: [userId, sessionUserId],
    familyIds: [familyId],
  });
  const committedJoin = await c.env.DB.prepare(
    `SELECT
       EXISTS(SELECT 1 FROM users WHERE id=?1) AS has_user,
       EXISTS(
         SELECT 1 FROM family_members
          WHERE family_id=?2 AND user_id=?1 AND is_active=1
       ) AS has_membership,
       EXISTS(
         SELECT 1 FROM refresh_tokens
          WHERE token=?3 AND user_id=?1 AND family_id=?2 AND revoked=0
       ) AS has_session`,
  ).bind(sessionUserId, familyId, fresh.session.refresh_token).first<{
    has_user: number;
    has_membership: number;
    has_session: number;
  }>();
  if (
    postJoinState !== "clear"
    || !committedJoin
    || Number(committedJoin.has_user) !== 1
    || Number(committedJoin.has_membership) !== 1
    || Number(committedJoin.has_session) !== 1
  ) {
    await c.env.DB.prepare("DELETE FROM refresh_tokens WHERE token=?").bind(fresh.session.refresh_token).run();
    return c.json({ error: "account_deletion_in_progress" }, 409);
  }
  if (childPlatform === "android") {
    await recordFamilyLifecycleEvent(c.env, {
      familyId,
      event: "child_paired",
      dedupeKey: sessionUserId,
      childPlatform: "android",
    });
  }
  return c.json({ family_id: familyId, session: fresh.session, user: fresh.user });
});

// ── POST /join-as-parent — joinFamilyAsParent (co-parent, 단일 보조 보호자 불변식) ──
family.post("/join-as-parent", requireAuth, async (c) => {
  const user = c.get("user");
  const userId = user.sub;
  const body = await c.req.json<Record<string, unknown>>();
  const raw = String(body.pairCode ?? body.pair_code ?? "").trim();
  if (!raw) return c.json({ error: "연동 코드를 입력해주세요", code: "invalid_pair_code" }, 400);
  const pairCode = raw.toUpperCase();
  const reqName = typeof body.name === "string" ? body.name.trim() : "";
  const parentName = reqName || "부모";

  if (!(await checkAndRecordAttempt(c.env.DB, userId))) {
    return c.json({ error: "Too many attempts. Try again later." }, 429);
  }

  const fam = await c.env.DB.prepare(
    "SELECT id, parent_id, pair_code_expires_at FROM families WHERE pair_code=? LIMIT 1",
  )
    .bind(pairCode)
    .first<{ id: string; parent_id: string; pair_code_expires_at: string | null }>();
  if (!fam) return c.json({ error: "Invalid pair code", code: "invalid_pair_code" }, 400);
  if (fam.parent_id === userId) {
    return c.json({ error: "이미 이 가족의 주 보호자입니다" }, 400);
  }
  if (fam.pair_code_expires_at && pgToMs(fam.pair_code_expires_at) < Date.now()) {
    return c.json({
      error: "만료된 연동 코드예요. 가족 관리자에게 새 코드를 받아 주세요",
      code: "pair_code_expired",
    }, 400);
  }
  const familyId = fam.id;
  const initialDeletionState = await accountDeletionMutationState(c.env.DB, {
    userIds: [userId],
    familyIds: [familyId],
  });
  if (initialDeletionState === "blocked") {
    return c.json({ error: "account_deletion_in_progress" }, 409);
  }
  if (initialDeletionState === "unavailable") {
    return c.json({ error: "account_deletion_guard_unavailable" }, 503);
  }
  if (await hasPendingUnpairCleanup(c.env.DB, familyId, userId)) {
    return c.json({ error: "연결 해제를 정리 중이에요. 잠시 후 다시 시도해 주세요" }, 409);
  }

  if (user.role !== "parent" || user.is_anonymous) {
    return c.json({
      error: "보호자 계정으로 로그인한 뒤 연결해 주세요",
      code: "role_cannot_join_as_parent",
    }, 403);
  }

  // ★익명 세션 차단: 익명 사용자는 join-as-parent로 보호자 등록 불가.
  const account = await c.env.DB.prepare(
    "SELECT is_anonymous FROM users WHERE id=? LIMIT 1",
  )
    .bind(userId)
    .first<{ is_anonymous: number }>();
  if (!account || Number(account.is_anonymous) !== 0) {
    return c.json({ error: "anonymous_cannot_join_as_parent" }, 403);
  }

  const callerChildMember = await c.env.DB.prepare(
    `SELECT 1 AS ok FROM family_members
      WHERE user_id=? AND role='child' AND is_active=1
      LIMIT 1`,
  )
    .bind(userId)
    .first<{ ok: number }>();
  if (callerChildMember) {
    return c.json({
      error: "이미 자녀 계정으로 등록되어 있어 보호자 역할을 추가할 수 없어요",
      code: "role_cannot_join_as_parent",
    }, 403);
  }

  // 단일 보조 보호자 불변식 — primary/본인 아닌 parent 가 이미 있으면 거부.
  const existingCoparent = await c.env.DB.prepare(
    `SELECT user_id FROM family_members
      WHERE family_id=? AND role='parent' AND is_active=1 AND user_id IS NOT NULL
        AND user_id<>? AND user_id<>? LIMIT 1`,
  )
    .bind(familyId, fam.parent_id, userId)
    .first<{ user_id: string }>();
  if (existingCoparent) {
    return c.json({
      error: "이미 보조 보호자가 등록되어 있어요",
      code: "coparent_slot_occupied",
    }, 409);
  }

  // 기존 행 여부만 먼저 고르고, 실제 활성화/삽입은 같은 SQL 문 안에서 현재 활성
  // 보조 보호자가 없는지 다시 확인한다. 경쟁 요청의 뒤 문장은 0행으로 닫힌다.
  // ★권한 상승 방지: parent 행만 찾는다 — child가 join-as-parent로 role 변경 불가.
  const member = await c.env.DB.prepare(
    "SELECT id FROM family_members WHERE family_id=? AND user_id=? AND role='parent' LIMIT 1",
  )
    .bind(familyId, userId)
    .first<{ id: string }>();
  if (!member) {
    // child·teacher 등 다른 역할로 이미 이 가족에 있으면 join-as-parent를 거부한다.
    const otherRole = await c.env.DB.prepare(
      "SELECT role FROM family_members WHERE family_id=? AND user_id=? LIMIT 1",
    )
      .bind(familyId, userId)
      .first<{ role: string }>();
    if (otherRole) {
      return c.json({
        error: `이미 ${otherRole.role === "child" ? "자녀" : "다른 역할"}로 등록된 계정이에요`,
        code: "already_member_other_role",
      }, 400);
    }
  }
  if (member) {
    const mutation = await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE family_members SET role='parent', is_active=1, name=?
          WHERE id=? AND family_id=? AND user_id=?
            AND EXISTS(SELECT 1 FROM users WHERE id=?)
            AND EXISTS(
              SELECT 1 FROM families AS target_family
               WHERE target_family.id=? AND target_family.parent_id<>?
                 AND NOT EXISTS(
                   SELECT 1 FROM family_members AS other_parent
                    WHERE other_parent.family_id=target_family.id
                      AND other_parent.role='parent' AND other_parent.is_active=1
                      AND other_parent.user_id IS NOT NULL
                      AND other_parent.user_id<>target_family.parent_id
                      AND other_parent.user_id<>?
                  )
            )
            AND ${ACTIVE_CHILD_MEMBERSHIP_ABSENT}
            AND ${ACCOUNT_DELETION_ABSENT_ONE_USER}`,
      ).bind(
        parentName,
        member.id,
        familyId,
        userId,
        userId,
        familyId,
        userId,
        userId,
        userId,
        userId,
        familyId,
      ),
      c.env.DB.prepare(
        `UPDATE users SET is_anonymous=0
          WHERE id=?
            AND EXISTS(
              SELECT 1 FROM family_members
               WHERE id=? AND family_id=? AND user_id=?
                 AND role='parent' AND is_active=1
            )
            AND ${ACCOUNT_DELETION_ABSENT_ONE_USER}`,
      ).bind(userId, member.id, familyId, userId, userId, familyId),
    ]);
    if (
      Number(mutation[0]?.meta?.changes ?? 0) !== 1
      || Number(mutation[1]?.meta?.changes ?? 0) !== 1
    ) {
      const winner = await c.env.DB.prepare(
        `SELECT 1 AS ok FROM family_members
          WHERE family_id=? AND role='parent' AND is_active=1 AND user_id IS NOT NULL
            AND user_id<>? AND user_id<>? LIMIT 1`,
      ).bind(familyId, fam.parent_id, userId).first<{ ok: number }>();
      if (winner) {
        return c.json({
          error: "이미 보조 보호자가 등록되어 있어요",
          code: "coparent_slot_occupied",
        }, 409);
      }
      return c.json({ error: "join_session_invalidated" }, 409);
    }
  } else {
    const mutation = await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO family_members (id, family_id, user_id, role, name, created_at)
         SELECT ?,?,?, 'parent',?,?
          WHERE EXISTS(SELECT 1 FROM users WHERE id=?)
            AND EXISTS(
              SELECT 1 FROM families AS target_family
               WHERE target_family.id=? AND target_family.parent_id<>?
                 AND NOT EXISTS(
                   SELECT 1 FROM family_members AS other_parent
                    WHERE other_parent.family_id=target_family.id
                      AND other_parent.role='parent' AND other_parent.is_active=1
                      AND other_parent.user_id IS NOT NULL
                      AND other_parent.user_id<>target_family.parent_id
                      AND other_parent.user_id<>?
                 )
            )
            AND NOT EXISTS(
              SELECT 1 FROM family_members WHERE family_id=? AND user_id=?
            )
            AND ${ACTIVE_CHILD_MEMBERSHIP_ABSENT}
            AND ${ACCOUNT_DELETION_ABSENT_ONE_USER}`,
      ).bind(
        crypto.randomUUID(),
        familyId,
        userId,
        parentName,
        pgNow(),
        userId,
        familyId,
        userId,
        userId,
        userId,
        familyId,
        userId,
        userId,
        familyId,
      ),
      c.env.DB.prepare(
        `UPDATE users SET is_anonymous=0
          WHERE id=?
            AND EXISTS(
              SELECT 1 FROM family_members
               WHERE family_id=? AND user_id=? AND role='parent' AND is_active=1
            )
            AND ${ACCOUNT_DELETION_ABSENT_ONE_USER}`,
      ).bind(userId, familyId, userId, userId, familyId),
    ]);
    if (
      Number(mutation[0]?.meta?.changes ?? 0) !== 1
      || Number(mutation[1]?.meta?.changes ?? 0) !== 1
    ) {
      const winner = await c.env.DB.prepare(
        `SELECT 1 AS ok FROM family_members
          WHERE family_id=? AND role='parent' AND is_active=1 AND user_id IS NOT NULL
            AND user_id<>? AND user_id<>? LIMIT 1`,
      ).bind(familyId, fam.parent_id, userId).first<{ ok: number }>();
      if (winner) {
        return c.json({
          error: "이미 보조 보호자가 등록되어 있어요",
          code: "coparent_slot_occupied",
        }, 409);
      }
      return c.json({ error: "join_session_invalidated" }, 409);
    }
  }

  await notifyPg(c.env, familyId, "family_members", "INSERT", { family_id: familyId, user_id: userId }, null);
  let fresh: FreshSession;
  try {
    fresh = await buildFreshSession(
      c.env,
      userId,
      normalizeDeviceId(body.device_install_id) ?? user.device_id ?? null,
      familyId,
      cleanText(body.device_label),
      cleanText(body.device_platform),
    );
  } catch (error) {
    if (isDeviceIdentityRequiredError(error)) {
      return c.json({ error: "device_identity_required" }, 400);
    }
    const state = await accountDeletionMutationState(c.env.DB, {
      userIds: [userId],
      familyIds: [familyId],
    });
    if (state !== "clear") return c.json({ error: "account_deletion_in_progress" }, 409);
    throw error;
  }
  const postJoinState = await accountDeletionMutationState(c.env.DB, {
    userIds: [userId],
    familyIds: [familyId],
  });
  const committedJoin = await c.env.DB.prepare(
    `SELECT
       EXISTS(SELECT 1 FROM users WHERE id=?1) AS has_user,
       EXISTS(
         SELECT 1 FROM family_members
          WHERE family_id=?2 AND user_id=?1 AND role='parent' AND is_active=1
       ) AS has_membership,
       EXISTS(
         SELECT 1 FROM refresh_tokens
          WHERE token=?3 AND user_id=?1 AND family_id=?2 AND revoked=0
       ) AS has_session`,
  ).bind(userId, familyId, fresh.session.refresh_token).first<{
    has_user: number;
    has_membership: number;
    has_session: number;
  }>();
  if (
    postJoinState !== "clear"
    || !committedJoin
    || Number(committedJoin.has_user) !== 1
    || Number(committedJoin.has_membership) !== 1
    || Number(committedJoin.has_session) !== 1
  ) {
    await c.env.DB.prepare("DELETE FROM refresh_tokens WHERE token=?").bind(fresh.session.refresh_token).run();
    return c.json({ error: "account_deletion_in_progress" }, 409);
  }
  return c.json({ family_id: familyId, session: fresh.session, user: fresh.user });
});

// ── GET /mine — getMyFamily (membership OR parent-owned family) ───────────────
family.get("/mine", requireAuth, async (c) => {
  const user = c.get("user");
  const userId = user.sub;

  const canonicalFamily = await resolveCanonicalFamilyMembership(c.env.DB, userId, user.family_id ?? null);
  if (!canonicalFamily) return c.json(null);

  const membership = await c.env.DB.prepare(
    `SELECT family_id, role, name FROM family_members
      WHERE family_id=? AND user_id=? AND is_active=1 LIMIT 1`,
  )
    .bind(canonicalFamily.familyId, userId)
    .first<{ family_id: string; role: string; name: string }>();

  // 분기 1: 멤버십 없음 → 본인 소유 family(parent_id) 폴백.
  if (!membership) {
    const pf = await c.env.DB.prepare(
      `SELECT id, parent_id, pair_code, parent_name, pair_code_expires_at, registered_place_alerts_enabled
         FROM families WHERE id=? AND parent_id=? LIMIT 1`,
    )
      .bind(canonicalFamily.familyId, userId)
      .first<Record<string, unknown>>();
    if (!pf) return c.json(null);

    let finalPairCode = String(pf.pair_code ?? "");
    if (!finalPairCode) {
      finalPairCode = genPairCode();
      await safeRun(c.env.DB, "UPDATE families SET pair_code=? WHERE id=?", [finalPairCode, pf.id]);
    }
    const { results } = await c.env.DB.prepare(
      `SELECT ${MEMBER_COLS} FROM family_members WHERE family_id=? AND is_active=1`,
    )
      .bind(pf.id)
      .all<Record<string, unknown>>();
    return c.json({
      familyId: pf.id,
      pairCode: finalPairCode,
      parentName: pf.parent_name ?? null,
      myRole: "parent",
      myName: pf.parent_name || "부모",
      members: (results ?? []).map(hydrateMember),
      pairCodeExpiresAt: pf.pair_code_expires_at ? pgToIso(String(pf.pair_code_expires_at)) : null,
      primaryParentId: pf.parent_id,
      isPrimaryParent: pf.parent_id === userId,
      isCoParent: false,
      registeredPlaceAlertsEnabled: Number(pf.registered_place_alerts_enabled) !== 0,
    });
  }

  // 분기 2: 멤버십 있음.
  const fam = await c.env.DB.prepare(
    `SELECT id, parent_id, pair_code, parent_name, pair_code_expires_at, registered_place_alerts_enabled
       FROM families WHERE id=? LIMIT 1`,
  )
    .bind(membership.family_id)
    .first<Record<string, unknown>>();
  if (!fam) return c.json(null);

  let finalPairCode = String(fam.pair_code ?? "");
  if (!finalPairCode && membership.role === "parent") {
    finalPairCode = genPairCode();
    await safeRun(c.env.DB, "UPDATE families SET pair_code=? WHERE id=?", [finalPairCode, membership.family_id]);
  }

  const { results } = await c.env.DB.prepare(
    `SELECT ${MEMBER_COLS} FROM family_members WHERE family_id=? AND is_active=1`,
  )
    .bind(membership.family_id)
    .all<Record<string, unknown>>();
  const members = (results ?? []).map(hydrateMember);

  const parentMembers = members.filter((m) => m.role === "parent" && m.user_id);
  const explicitPrimary = String(fam?.parent_id ?? "");
  const inferredPrimary =
    explicitPrimary ||
    (membership.role === "parent" && parentMembers.length === 1 ? String(parentMembers[0].user_id) : "");
  const isPrimaryParent = membership.role === "parent" && !!inferredPrimary && inferredPrimary === userId;
  const isCoParent = membership.role === "parent" && !!inferredPrimary && inferredPrimary !== userId;

  return c.json({
    familyId: membership.family_id,
    pairCode: finalPairCode,
    parentName: fam.parent_name || "",
    myRole: membership.role,
    myName: membership.name,
    members,
    pairCodeExpiresAt: fam.pair_code_expires_at ? pgToIso(String(fam.pair_code_expires_at)) : null,
    primaryParentId: inferredPrimary,
    isPrimaryParent,
    isCoParent,
    registeredPlaceAlertsEnabled: Number(fam?.registered_place_alerts_enabled) !== 0,
  });
});

// ── POST /pair-code/regenerate — regenerate_pair_code (any parent) ────────────
family.post("/pair-code/regenerate", requireAuth, async (c) => {
  const userId = c.get("user").sub;
  const body = await c.req.json<Record<string, unknown>>();
  const familyId = String(body.family_id ?? "");
  if (!familyId) return c.json({ error: "familyId가 필요해요" }, 400);
  if (!(await isFamilyParent(c.env.DB, userId, familyId))) {
    return c.json({ error: "부모 계정만 연동 코드를 재생성할 수 있어요" }, 403);
  }
  const code = genPairCode();
  const expiresMs = Date.now() + PAIR_CODE_TTL_MS;
  await c.env.DB.prepare("UPDATE families SET pair_code=?, pair_code_expires_at=? WHERE id=?")
    .bind(code, pgFrom(expiresMs), familyId)
    .run();
  return c.json({ pair_code: code, pair_code_expires_at: new Date(expiresMs).toISOString() });
});

// ── PATCH /settings — updateRegisteredPlaceAlertSetting (any parent) ──────────
// families.registered_place_alerts_enabled 토글. getMyFamily 가 이 컬럼을 반환하므로
// write 게이트도 동일하게 isFamilyParent 로 일관 유지. notifyPg(families) 로 실시간 반영.
family.patch("/settings", requireAuth, async (c) => {
  const userId = c.get("user").sub;
  const body = await c.req.json<Record<string, unknown>>();
  const familyId = String(body.family_id ?? "");
  if (!familyId) return c.json({ error: "familyId가 필요해요" }, 400);
  if (!(await isFamilyParent(c.env.DB, userId, familyId))) {
    return c.json({ error: "부모 계정만 설정을 변경할 수 있어요" }, 403);
  }
  const enabled = body.registered_place_alerts_enabled !== false;
  await c.env.DB.prepare("UPDATE families SET registered_place_alerts_enabled=? WHERE id=?")
    .bind(enabled ? 1 : 0, familyId)
    .run();
  // 부분 행 통지(클라 applyFamilySettings 가 'registered_place_alerts_enabled' in newRow 가드).
  await notifyPg(c.env, familyId, "families", "UPDATE",
    { id: familyId, registered_place_alerts_enabled: enabled }, null);
  return c.json({ ok: true, registered_place_alerts_enabled: enabled });
});

// ── PATCH /profile — updateMyProfile (본인 family_members + auth metadata) ─────
family.patch("/profile", requireAuth, async (c) => {
  const userId = c.get("user").sub;
  const body = await c.req.json<Record<string, unknown>>();
  const familyId = String(body.family_id ?? "");
  if (!familyId) return c.json({ error: "familyId required" }, 400);
  if (!(await assertFamilyAccess(c.env.DB, userId, familyId))) {
    return c.json({ error: "forbidden" }, 403);
  }
  const sets: string[] = [];
  const binds: unknown[] = [];
  let newName: string | null = null;
  if (typeof body.name === "string") {
    newName = normalizeMemberDisplayName(body.name);
    if (!newName) {
      return c.json({ error: "이름은 1~40자이며 줄바꿈 없이 입력해 주세요" }, 400);
    }
    sets.push("name=?");
    binds.push(newName);
  }
  if (typeof body.phone === "string") {
    sets.push("phone=?");
    binds.push(body.phone.trim());
  }
  if (typeof body.emoji === "string") {
    sets.push("emoji=?");
    binds.push(body.emoji.trim());
  }
  if (!sets.length) return c.json({ ok: true });

  binds.push(familyId, userId);
  await c.env.DB.prepare(`UPDATE family_members SET ${sets.join(", ")} WHERE family_id=? AND user_id=?`)
    .bind(...binds)
    .run();

  // auth metadata name 동기화(best-effort) — supabase.auth.updateUser({data:{name}}) 대체.
  if (newName != null) {
    try {
      const row = await c.env.DB.prepare("SELECT raw_user_meta_data AS m FROM users WHERE id=? LIMIT 1")
        .bind(userId)
        .first<{ m: string | null }>();
      const meta = row?.m ? JSON.parse(row.m) : {};
      meta.name = newName;
      await c.env.DB.prepare("UPDATE users SET raw_user_meta_data=? WHERE id=?")
        .bind(JSON.stringify(meta), userId)
        .run();
    } catch (e) {
      console.warn("[family/profile] auth metadata update failed:");
    }
  }

  await notifyPg(c.env, familyId, "family_members", "UPDATE", { family_id: familyId, user_id: userId }, null);
  return c.json({ ok: true });
});

// ── PATCH /member/device — 자녀 기기 라벨/상태 자기-행 write (App.jsx device_label·device_health) ─
// Supabase 원본: family_members.update({device_label|device_health}).eq("user_id", auth.uid())
// — RLS fm_upd 정책(user_id = auth.uid() 자기 행만)을 코드로 복제한다. 대상은 항상 호출자 본인
// 행(WHERE user_id=caller.sub) 이며, assertFamilyAccess 로 요청 family 소속을 확인한다(타 family_id
// 스푸핑 차단). device_health 는 jsonb → JSON.stringify(TEXT). 부모 관리 카드 실시간 반영.
family.patch("/member/device", requireAuth, async (c) => {
  const userId = c.get("user").sub;
  const body = await c.req.json<Record<string, unknown>>();
  const familyId = String(body.family_id ?? "");
  if (!familyId) return c.json({ error: "familyId required" }, 400);
  if (!(await assertFamilyAccess(c.env.DB, userId, familyId))) {
    return c.json({ error: "forbidden" }, 403);
  }
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (typeof body.device_label === "string") {
    sets.push("device_label=?");
    binds.push(body.device_label);
  }
  if ("device_health" in body) {
    const dh = body.device_health;
    sets.push("device_health=?");
    binds.push(dh == null ? null : JSON.stringify(dh)); // jsonb → TEXT(JSON).
  }
  if (!sets.length) return c.json({ ok: true });

  binds.push(familyId, userId);
  await c.env.DB.prepare(`UPDATE family_members SET ${sets.join(", ")} WHERE family_id=? AND user_id=?`)
    .bind(...binds)
    .run();

  await notifyPg(c.env, familyId, "family_members", "UPDATE", { family_id: familyId, user_id: userId }, null);
  return c.json({ ok: true });
});

// ── POST /member/rename — rename_family_member_by_id (primary parent, any row) ─
family.post("/member/rename", requireAuth, async (c) => {
  const userId = c.get("user").sub;
  const body = await c.req.json<Record<string, unknown>>();
  const familyId = String(body.family_id ?? "");
  const memberId = String(body.member_id ?? "");
  const newName = normalizeMemberDisplayName(body.new_name);
  if (!(await assertPrimaryParent(c.env.DB, userId, familyId))) {
    return c.json({ error: "Not authorized" }, 403);
  }
  if (!newName) return c.json({ error: "이름은 1~40자이며 줄바꿈 없이 입력해 주세요" }, 400);
  await c.env.DB.prepare("UPDATE family_members SET name=? WHERE id=? AND family_id=?")
    .bind(newName, memberId, familyId)
    .run();
  await notifyPg(c.env, familyId, "family_members", "UPDATE", { id: memberId, family_id: familyId }, null);
  return c.json({ ok: true });
});

// ── POST /member/profile — set_family_member_profile_by_id ─
// 부모(주 보호자)가 아이 정보를 편집: name(필수) + color_hex·birthdate·phone(선택).
// birthdate/phone 은 hyeni-3 아이 정보 편집(부모가 전 정보 편집→아이기기 실시간 반영) 지원용 확장.
// 필드가 body 에 있을 때만 UPDATE(부분 수정). notifyPg 로 가족 WS 실시간 반영.
family.post("/member/profile", requireAuth, async (c) => {
  const userId = c.get("user").sub;
  const body = await c.req.json<Record<string, unknown>>();
  const familyId = String(body.family_id ?? "");
  const memberId = String(body.member_id ?? "");
  const newName = normalizeMemberDisplayName(body.new_name);
  if (!(await assertPrimaryParent(c.env.DB, userId, familyId))) {
    return c.json({ error: "Not authorized" }, 403);
  }
  if (!newName) return c.json({ error: "이름은 1~40자이며 줄바꿈 없이 입력해 주세요" }, 400);

  const sets: string[] = ["name=?"];
  const binds: unknown[] = [newName];
  // color_hex 는 선택(형식 검증). hyeni-3 는 색상 UI 제거로 자동배정값을 보낸다.
  if (typeof body.color_hex === "string" && body.color_hex.trim()) {
    if (!/^#[0-9A-Fa-f]{6}$/.test(body.color_hex.trim())) {
      return c.json({ error: "테마 색상이 올바르지 않아요" }, 400);
    }
    sets.push("color_hex=?");
    binds.push(body.color_hex.toUpperCase().trim());
  }
  // birthdate: "YYYY-MM-DD" 또는 null(지움). 키가 있을 때만 수정.
  if ("birthdate" in body) {
    const bd = body.birthdate == null ? null : String(body.birthdate).trim() || null;
    if (bd && !/^\d{4}-\d{2}-\d{2}$/.test(bd)) {
      return c.json({ error: "생년월일 형식이 올바르지 않아요" }, 400);
    }
    sets.push("birthdate=?");
    binds.push(bd);
  }
  // phone: 숫자/하이픈 텍스트 또는 null. 키가 있을 때만 수정.
  if ("phone" in body) {
    const ph = body.phone == null ? null : String(body.phone).trim() || null;
    sets.push("phone=?");
    binds.push(ph);
  }

  binds.push(memberId, familyId);
  const res = await c.env.DB.prepare(
    `UPDATE family_members SET ${sets.join(", ")} WHERE id=? AND family_id=? AND role='child'`,
  )
    .bind(...binds)
    .run();
  if (!res.meta.changes) return c.json({ error: "아이 정보를 찾지 못했어요" }, 404);
  await notifyPg(c.env, familyId, "family_members", "UPDATE", { id: memberId, family_id: familyId }, null);
  return c.json({ ok: true });
});

// ── POST /member/photo — set_family_member_photo_url_by_id (url 텍스트만) ──────
// 주 보호자는 가족 멤버 사진을 정하고, 그 외 부모는 자기 프로필 사진만 정한다(2026-08-17).
// 본인 경로는 서버가 발급한 `{familyId}/uploads/{본인}/{uuid}.{ext}` 키만 받는다 —
// 임의 문자열이나 남의 업로드 키를 자기 아바타로 붙이지 못하게 한다.
const OWN_UPLOAD_PHOTO_KEY =
  /^[A-Za-z0-9_-]{1,128}\/uploads\/[A-Za-z0-9_-]{1,128}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp)$/i;

function isOwnUploadPhotoKey(url: string | null, familyId: string, userId: string): boolean {
  if (url === null) return true; // 사진 지우기
  if (!OWN_UPLOAD_PHOTO_KEY.test(url)) return false;
  const segments = url.split("/");
  return segments[0] === familyId && segments[2] === userId;
}

async function isOwnActiveParentMember(
  db: D1Database,
  memberId: string,
  familyId: string,
  userId: string,
): Promise<boolean> {
  if (!memberId || !familyId || !userId) return false;
  const row = await db
    .prepare(
      `SELECT 1 AS ok
         FROM family_members fm
         JOIN families f ON f.id = fm.family_id
        WHERE fm.id = ? AND fm.family_id = ? AND fm.user_id = ?
          AND fm.role = 'parent' AND fm.is_active = 1
        LIMIT 1`,
    )
    .bind(memberId, familyId, userId)
    .first<{ ok: number }>();
  return !!row;
}

family.post("/member/photo", requireAuth, async (c) => {
  const userId = c.get("user").sub;
  const body = await c.req.json<Record<string, unknown>>();
  const familyId = String(body.family_id ?? "");
  const memberId = String(body.member_id ?? "");
  const url = body.url == null ? null : String(body.url);
  if (!(await assertPrimaryParent(c.env.DB, userId, familyId))) {
    if (
      !isOwnUploadPhotoKey(url, familyId, userId)
      || !(await isOwnActiveParentMember(c.env.DB, memberId, familyId, userId))
    ) {
      return c.json({ error: "Not authorized" }, 403);
    }
  }
  await c.env.DB.prepare("UPDATE family_members SET photo_url=? WHERE id=? AND family_id=?")
    .bind(url, memberId, familyId)
    .run();
  await notifyPg(c.env, familyId, "family_members", "UPDATE", { id: memberId, family_id: familyId }, null);
  return c.json({ ok: true });
});

// ── POST /co-parent/remove — 공동 보호자 연결 해제(주 보호자만) ─────────────
family.post("/co-parent/remove", requireAuth, async (c) => {
  const userId = c.get("user").sub;
  const body = await c.req.json<Record<string, unknown>>();
  const familyId = String(body.family_id ?? "").trim();
  const parentUserId = String(body.parent_user_id ?? "").trim();
  if (!familyId || !parentUserId) {
    return c.json({ error: "family_id/parent_user_id required", code: "invalid_coparent_target" }, 400);
  }
  if (!(await assertPrimaryParent(c.env.DB, userId, familyId))) {
    return c.json({ error: "forbidden", code: "primary_parent_required" }, 403);
  }
  if (parentUserId === userId) {
    return c.json({ error: "cannot_remove_primary_parent", code: "cannot_remove_primary_parent" }, 400);
  }

  const member = await c.env.DB.prepare(
    `SELECT id,is_active FROM family_members
      WHERE family_id=? AND user_id=? AND role='parent'
      LIMIT 1`,
  )
    .bind(familyId, parentUserId)
    .first<{ id: string; is_active: number }>();
  if (!member) {
    return c.json({ error: "coparent_not_found", code: "coparent_not_found" }, 404);
  }

  const alreadyRemoved = Number(member.is_active) !== 1;
  const now = new Date().toISOString();
  let results: D1Result<unknown>[];
  try {
    results = await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE family_members SET is_active=0,last_selected_at=NULL
          WHERE id=? AND family_id=? AND user_id=? AND role='parent' AND is_active=1
            AND user_id<>?
            AND EXISTS(SELECT 1 FROM families WHERE id=? AND parent_id=?)`,
      ).bind(member.id, familyId, parentUserId, userId, familyId, userId),
      c.env.DB.prepare(
        `UPDATE refresh_tokens SET revoked=1
          WHERE user_id=? AND revoked=0
            AND EXISTS(SELECT 1 FROM families WHERE id=? AND parent_id=?)
            AND EXISTS(
              SELECT 1 FROM family_members
               WHERE id=? AND family_id=? AND user_id=? AND role='parent' AND is_active=0
            )`,
      ).bind(parentUserId, familyId, userId, member.id, familyId, parentUserId),
      c.env.DB.prepare(
        `UPDATE account_device_sessions SET revoked_at=?,last_seen_at=?
          WHERE user_id=? AND revoked_at IS NULL
            AND EXISTS(SELECT 1 FROM families WHERE id=? AND parent_id=?)
            AND EXISTS(
              SELECT 1 FROM family_members
               WHERE id=? AND family_id=? AND user_id=? AND role='parent' AND is_active=0
            )`,
      ).bind(now, now, parentUserId, familyId, userId, member.id, familyId, parentUserId),
      c.env.DB.prepare(
        `UPDATE fcm_tokens SET disabled_at=?,disabled_reason='family_member_removed'
          WHERE family_id=? AND user_id=? AND disabled_at IS NULL
            AND EXISTS(SELECT 1 FROM families WHERE id=? AND parent_id=?)
            AND EXISTS(
              SELECT 1 FROM family_members
               WHERE id=? AND family_id=? AND user_id=? AND role='parent' AND is_active=0
            )`,
      ).bind(now, familyId, parentUserId, familyId, userId, member.id, familyId, parentUserId),
      c.env.DB.prepare(
        `UPDATE push_subscriptions SET disabled_at=?,disabled_reason='family_member_removed'
          WHERE family_id=? AND user_id=? AND disabled_at IS NULL
            AND EXISTS(SELECT 1 FROM families WHERE id=? AND parent_id=?)
            AND EXISTS(
              SELECT 1 FROM family_members
               WHERE id=? AND family_id=? AND user_id=? AND role='parent' AND is_active=0
            )`,
      ).bind(now, familyId, parentUserId, familyId, userId, member.id, familyId, parentUserId),
    ]);
  } catch {
    console.error("[family/co-parent/remove] mutation failed");
    return c.json({ error: "coparent_remove_failed", code: "coparent_remove_failed" }, 503);
  }

  const finalMember = await c.env.DB.prepare(
    "SELECT is_active FROM family_members WHERE id=? AND family_id=? AND user_id=? AND role='parent' LIMIT 1",
  )
    .bind(member.id, familyId, parentUserId)
    .first<{ is_active: number }>();
  if (!finalMember || Number(finalMember.is_active) !== 0) {
    return c.json({ error: "coparent_remove_conflict", code: "coparent_remove_conflict" }, 409);
  }

  try {
    await revokeFamilyRealtimeUser(c.env, familyId, parentUserId);
  } catch {
    console.error("[family/co-parent/remove] realtime socket revoke failed");
  }
  if (Number(results[0]?.meta?.changes ?? 0) === 1) {
    await notifyPg(
      c.env,
      familyId,
      "family_members",
      "DELETE",
      null,
      { id: member.id, family_id: familyId, user_id: parentUserId },
    );
  }
  return c.json({ ok: true, already_removed: alreadyRemoved });
});

// ── POST /unpair — unpair_child (primary parent only; user-tied cleanup) ───────
family.post("/unpair", requireAuth, async (c) => {
  const userId = c.get("user").sub;
  const body = await c.req.json<Record<string, unknown>>();
  const familyId = String(body.family_id ?? "");
  const childUserId = String(body.child_user_id ?? "");
  if (!familyId || !childUserId) return c.json({ error: "familyId/childUserId required" }, 400);

  // SECURITY DEFINER 게이트: families.parent_id = caller(주 보호자만).
  if (!(await assertPrimaryParent(c.env.DB, userId, familyId))) {
    return c.json({ error: "forbidden" }, 403);
  }
  const initialDeletionState = await accountDeletionMutationState(c.env.DB, {
    userIds: [userId, childUserId],
    familyIds: [familyId],
  });
  if (initialDeletionState === "blocked") {
    return c.json({ error: "account_deletion_in_progress" }, 409);
  }
  if (initialDeletionState === "unavailable") {
    return c.json({ error: "account_deletion_guard_unavailable" }, 503);
  }
  if (await hasActiveChildMutationLease(c.env.DB, childUserId)) {
    return c.json({ error: "child_mutation_in_progress" }, 409);
  }

  // inactive tombstone도 cleanup 재진입에 필요하므로 함께 조회한다.
  const childRows = await c.env.DB.prepare(
    "SELECT id, photo_url FROM family_members WHERE family_id=? AND user_id=? AND role='child'",
  )
    .bind(familyId, childUserId)
    .all<{ id: string; photo_url: string | null }>();
  if (!childRows.results?.length) {
    const cleanup = await processFamilyUnpairCleanup(c.env, familyId, childUserId);
    await revokeChildRealtimeSocket(c.env, familyId, childUserId);
    return c.json({ ok: true, cleanup_pending: cleanup.status === "pending" });
  }

  // family_members 행을 먼저 지우면 이후 계정 삭제에서 과거 familyId를 복구할 수 없다.
  // 연결 해제 전에 서버 발급 업로더 prefix와 해당 스레드의 legacy 키를 회수하되,
  // 남는 가족 구성원이 정확히 참조하는 공유 객체는 보존한다.
  const unlinkMembers: AccountMemberReference[] = childRows.results.map((row) => ({
    id: String(row.id),
    familyId,
    userId: childUserId,
    role: "child",
    photoUrl: row.photo_url ? String(row.photo_url) : null,
  }));
  const memberIds = childRows.results.map((row) => String(row.id));
  try {
    const exactPhotoKeys = await collectChildPhotoKeys(c.env.DB, unlinkMembers);
    const retainedPhotoKeys = await collectRetainedChildPhotoKeys(c.env.DB, unlinkMembers);
    const placeholders = memberIds.map(() => "?").join(",");
    const now = pgNow();
    const leaseNow = new Date().toISOString();
    // 권한 차단 tombstone과 cleanup journal은 한 D1 batch에서 함께 확정한다.
    // 이 batch가 실패하면 R2를 건드리지 않아 active 사용자의 데이터가 보존된다.
    const results = await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE family_members SET is_active=0
          WHERE family_id=? AND user_id=? AND role='child' AND id IN (${placeholders})
            AND ${ACCOUNT_DELETION_ABSENT_TWO_USERS}
            AND ${ACTIVE_CHILD_MUTATION_LEASE_ABSENT}
            AND ${FAMILY_STORAGE_UPLOAD_JOURNAL_ABSENT}`,
      ).bind(
        familyId,
        childUserId,
        ...memberIds,
        userId,
        childUserId,
        familyId,
        childUserId,
        leaseNow,
        familyId,
      ),
      c.env.DB.prepare(
        `INSERT INTO family_unpair_cleanup_jobs
           (family_id,child_user_id,member_ids,exact_photo_keys,preserve_photo_keys,attempts,last_error,created_at,updated_at)
         SELECT ?,?,?,?,?,0,NULL,?,?
          WHERE ${ACCOUNT_DELETION_ABSENT_TWO_USERS}
            AND ${ACTIVE_CHILD_MUTATION_LEASE_ABSENT}
            AND ${FAMILY_STORAGE_UPLOAD_JOURNAL_ABSENT}
         ON CONFLICT(family_id,child_user_id) DO UPDATE SET
           member_ids=excluded.member_ids,
           exact_photo_keys=excluded.exact_photo_keys,
           preserve_photo_keys=excluded.preserve_photo_keys,
           last_error=NULL,
           updated_at=excluded.updated_at`,
      ).bind(
        familyId,
        childUserId,
        JSON.stringify(memberIds),
        JSON.stringify(exactPhotoKeys),
        JSON.stringify(retainedPhotoKeys),
        now,
        now,
        userId,
        childUserId,
        familyId,
        childUserId,
        leaseNow,
        familyId,
      ),
      c.env.DB.prepare(
        `UPDATE fcm_tokens SET disabled_at=?, disabled_reason='family_member_removed'
          WHERE family_id=? AND user_id=? AND disabled_at IS NULL
            AND EXISTS(
              SELECT 1 FROM family_unpair_cleanup_jobs
               WHERE family_id=? AND child_user_id=?
            )`,
      ).bind(now, familyId, childUserId, familyId, childUserId),
      c.env.DB.prepare(
        `UPDATE push_subscriptions SET disabled_at=?, disabled_reason='family_member_removed'
          WHERE family_id=? AND user_id=? AND disabled_at IS NULL
            AND EXISTS(
              SELECT 1 FROM family_unpair_cleanup_jobs
               WHERE family_id=? AND child_user_id=?
            )`,
      ).bind(now, familyId, childUserId, familyId, childUserId),
    ]);
    if (Number(results[1]?.meta?.changes ?? 0) !== 1) {
      const state = await accountDeletionMutationState(c.env.DB, {
        userIds: [userId, childUserId],
        familyIds: [familyId],
      });
      if (state === "blocked") {
        return c.json({ error: "account_deletion_in_progress" }, 409);
      }
      if (await hasActiveChildMutationLease(c.env.DB, childUserId)) {
        return c.json({ error: "child_mutation_in_progress" }, 409);
      }
      if (await hasPendingFamilyStorageUpload(c.env.DB, familyId)) {
        return c.json({ error: "child_mutation_in_progress" }, 409);
      }
      throw new Error("unpair_claim_not_created");
    }
  } catch (error) {
    const state = await accountDeletionMutationState(c.env.DB, {
      userIds: [userId, childUserId],
      familyIds: [familyId],
    });
    if (state === "blocked") {
      return c.json({ error: "account_deletion_in_progress" }, 409);
    }
    if (await hasActiveChildMutationLease(c.env.DB, childUserId)) {
      return c.json({ error: "child_mutation_in_progress" }, 409);
    }
    if (await hasPendingFamilyStorageUpload(c.env.DB, familyId)) {
      return c.json({ error: "child_mutation_in_progress" }, 409);
    }
    console.error("[family/unpair] prepare failed");
    return c.json({ error: "unpair_prepare_retryable" }, 503);
  }

  // 권한은 이미 inactive로 차단됐다. R2/D1 finalize 실패는 durable job과 cron이 재시도한다.
  await revokeChildRealtimeSocket(c.env, familyId, childUserId);
  await notifyPg(c.env, familyId, "family_members", "DELETE", null, { family_id: familyId, user_id: childUserId });
  const cleanup = await processFamilyUnpairCleanup(c.env, familyId, childUserId);
  return c.json({ ok: true, cleanup_pending: cleanup.status === "pending" });
});

export default family;

// 친구 초대 보상: 주 보호자 조회·공개 코드 발급만 제공한다.
// 귀속은 /api/family/setup의 신규 가족 생성 batch에서, 실제 보상은 서버 cron에서만 수행한다.
import { Hono, type Context } from "hono";
import type { Env, Vars } from "../types";
import { requireAuth } from "../middleware/auth";
import { assertPrimaryParent, resolveCanonicalFamilyMembership } from "../db/authz";
import {
  ReferralAttributionError,
  readReferralStatus,
  upsertReferralCode,
} from "../lib/referralRewardsV2";

const referrals = new Hono<{ Bindings: Env; Variables: Vars }>();
const REFERRAL_CODE_BODY_MAX_BYTES = 4_096;
const SAFE_USER_ID = /^[A-Za-z0-9_-]{1,128}$/;

type ReferralJsonReadResult =
  | { ok: true; value: unknown }
  | { ok: false; error: "payload_too_large" | "invalid_json" };

/** Content-Length를 신뢰하지 않고 실제 stream을 maxBytes+1 이전에 닫는다. */
async function readBoundedReferralJson(
  request: Request,
  maxBytes = REFERRAL_CODE_BODY_MAX_BYTES,
): Promise<ReferralJsonReadResult> {
  const rawLength = request.headers.get("Content-Length");
  if (rawLength !== null) {
    const declaredLength = Number(rawLength);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      return { ok: false, error: "payload_too_large" };
    }
  }
  const reader = request.body?.getReader();
  if (!reader) return { ok: false, error: "invalid_json" };
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // stream 취소 실패가 이미 확정한 413 판정을 바꾸면 안 된다.
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function primaryFamily(
  db: D1Database,
  userId: string,
  preferredFamilyId: string | null,
): Promise<string | null> {
  const membership = await resolveCanonicalFamilyMembership(db, userId, preferredFamilyId);
  if (!membership || membership.role !== "parent") return null;
  return await assertPrimaryParent(db, userId, membership.familyId)
    ? membership.familyId
    : null;
}

/**
 * 조회는 가족의 모든 활성 보호자에게 연다(2026-08-18).
 * 코드는 가족의 것이라 공동 보호자도 보고 공유할 수 있어야 한다 — 만들고 바꾸는 것만 주 보호자다.
 */
async function parentFamily(
  db: D1Database,
  userId: string,
  preferredFamilyId: string | null,
): Promise<{ familyId: string; canManage: boolean } | null> {
  const membership = await resolveCanonicalFamilyMembership(db, userId, preferredFamilyId);
  if (!membership || membership.role !== "parent") return null;
  return {
    familyId: membership.familyId,
    canManage: await assertPrimaryParent(db, userId, membership.familyId),
  };
}

function referralError(c: Context<{ Bindings: Env; Variables: Vars }>, error: unknown) {
  if (error instanceof ReferralAttributionError) {
    return c.json({ error: error.message }, error.status);
  }
  if (/no such table|no such index/i.test(String(error))) {
    return c.json({ error: "referral_program_unavailable" }, 503);
  }
  console.error("[referrals] request failed");
  return c.json({ error: "referral_program_unavailable" }, 503);
}

referrals.get("/me", requireAuth, async (c) => {
  const user = c.get("user");
  const family = await parentFamily(c.env.DB, user.sub, user.family_id);
  if (!family) return c.json({ error: "referral_primary_parent_required" }, 403);
  try {
    const status = await readReferralStatus(c.env.DB, family.familyId);
    return c.json({ ...status, canManage: family.canManage });
  } catch (error) {
    return referralError(c, error);
  }
});

referrals.post("/code", requireAuth, async (c) => {
  const user = c.get("user");
  const parsed = await readBoundedReferralJson(c.req.raw);
  if (!parsed.ok) {
    if (parsed.error === "payload_too_large") {
      return c.json({ error: "referral_payload_too_large" }, 413);
    }
    return c.json({ error: "invalid_json_payload" }, 400);
  }
  const body = parsed.value;
  if (!isRecord(body)) return c.json({ error: "referral_reward_child_invalid" }, 400);
  const rewardChildUserId = typeof body.rewardChildUserId === "string"
    ? body.rewardChildUserId.trim()
    : "";
  if (
    !SAFE_USER_ID.test(rewardChildUserId)
    || Object.keys(body).length !== 1
    || Object.keys(body)[0] !== "rewardChildUserId"
  ) {
    return c.json({ error: "referral_reward_child_invalid" }, 400);
  }
  const familyId = await primaryFamily(c.env.DB, user.sub, user.family_id);
  if (!familyId) return c.json({ error: "referral_primary_parent_required" }, 403);
  try {
    const status = await upsertReferralCode(c.env.DB, {
      familyId,
      parentId: user.sub,
      rewardChildUserId,
    });
    return c.json({ ...status, canManage: true });
  } catch (error) {
    return referralError(c, error);
  }
});

export default referrals;

// family_review_rewards legacy read + 신규 claim 종료 계약.
//   GET  /api/review-rewards?familyId=...  ← loadReviewTierReward
//   POST /api/review-rewards { familyId }  ← 410 review_reward_program_ended
// 기존 가족 단위 보상 행은 읽기 호환을 유지하되 새 행은 만들거나 갱신하지 않는다.
//
// family_review_rewards 는 cloudflare/schema_d1.sql 정본과
// worker/db/review-rewards-schema.sql 증분 스키마에 모두 포함한다. 과거 환경처럼 아직
// 적재되지 않은 DB에서도 500 대신 graceful — 원본 reviewPrompt.js 의 schema-missing
// 흡수(rewarded=false / ok=false)와 동일하게 동작한다.
//
// authz: 원본 RLS(family_review_rewards_{select,insert,update}_parent) 직역 — 호출자가 해당
//   가족의 parent(family_members.role='parent') 일 때만. parent_id 는 서버가 토큰 sub 로 고정한다
//   (원본 WITH CHECK parent_id = auth.uid()).
import { Hono } from "hono";
import type { Env, Vars } from "../types";
import { requireAuth } from "../middleware/auth";
import { resolveVerifiedFamilyMembership } from "../db/authz";

const reviewRewards = new Hono<{ Bindings: Env; Variables: Vars }>();

// 테이블 미적재(원격/로컬 D1 에 family_review_rewards 부재) → graceful. 이 라우트는 해당
// 테이블만 접근하므로 "no such table" 은 곧 미적재를 의미한다.
function isMissingTableError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /no such table/i.test(msg);
}

async function assertParentOfFamily(
  db: D1Database,
  uid: string,
  familyId: string,
): Promise<boolean> {
  if (!familyId) return false;
  const membership = await resolveVerifiedFamilyMembership(db, uid, familyId);
  return membership?.role === "parent";
}

// GET — { rewarded: boolean }. rewarded = 행 존재 + granted_at(원본 isReviewTierRewarded).
// familyId 누락/부모아님/미부여/테이블부재는 모두 rewarded=false(원본 graceful 계약).
reviewRewards.get("/", requireAuth, async (c) => {
  const uid = c.get("user").sub;
  const familyId = c.req.query("familyId") || "";
  if (!familyId) return c.json({ rewarded: false });
  if (!(await assertParentOfFamily(c.env.DB, uid, familyId))) {
    return c.json({ error: "forbidden" }, 403);
  }
  try {
    const row = await c.env.DB
      .prepare(
        "SELECT family_id, granted_at FROM family_review_rewards WHERE family_id=? LIMIT 1",
      )
      .bind(familyId)
      .first<{ family_id: string; granted_at: string }>();
    return c.json({ rewarded: !!(row && row.family_id && row.granted_at) });
  } catch (e) {
    if (isMissingTableError(e)) return c.json({ rewarded: false });
    throw e;
  }
});

// POST — 신규 지급 종료. 부모 본인 가족 확인 뒤 410을 반환하며 기존 행도 변경하지 않는다.
reviewRewards.post("/", requireAuth, async (c) => {
  const uid = c.get("user").sub;
  let body: { familyId?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const familyId = String(body.familyId || "");
  if (!familyId) return c.json({ error: "invalid_family_id" }, 400);
  if (!(await assertParentOfFamily(c.env.DB, uid, familyId))) {
    return c.json({ error: "forbidden" }, 403);
  }
  return c.json({
    ok: false,
    error: "review_reward_program_ended",
    message: "스토어 방문 혜택의 신규 지급은 종료되었어요. 기존에 받은 혜택은 그대로 유지됩니다.",
  }, 410);
});

export default reviewRewards;

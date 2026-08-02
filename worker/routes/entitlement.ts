// 가족 entitlement read API.
// 기존 클라이언트 호환을 위해 family_subscription + families raw 행을 유지하면서,
// 서버 공통 resolver 결과를 effective로 함께 돌려준다. 신규 서버 기능은 raw 값을
// 재해석하지 않고 이 resolver만 사용한다.
// RLS(가족 단위 select)는 assertFamilyAccess 로 대체. timestamptz(trial_ends_at·
// current_period_end)는 pg COPY 형식('공백 + +00')을 ISO 로 정규화해 돌려준다 —
// 클라가 new Date() 로 파싱하기 때문(subscriptions.ts 와 동일 규약).
import { Hono } from "hono";
import type { Env, Vars } from "../types";
import { requireAuth } from "../middleware/auth";
import { assertFamilyAccess } from "../db/authz";
import { pgToIso } from "../lib/time";
import { resolveFamilyEntitlement } from "../shared/subscriptionEntitlement.js";

const entitlement = new Hono<{ Bindings: Env; Variables: Vars }>();

// GET /api/entitlement?family_id=... →
//   { subscription: { status, trial_ends_at, current_period_end, product_id, base_plan_id, provider } | null,
//     family:       { id, user_tier } | null }
entitlement.get("/", requireAuth, async (c) => {
  const uid = c.get("user").sub;
  const familyId = c.req.query("family_id") ?? "";
  if (!(await assertFamilyAccess(c.env.DB, uid, familyId))) {
    return c.json({ error: "forbidden" }, 403);
  }

  try {
    const effectiveEntitlement = await resolveFamilyEntitlement(c.env.DB, familyId);

    // raw 응답은 배포 중 구버전 클라이언트가 계속 판정할 수 있도록 보존한다.
    const sub = await c.env.DB.prepare(
      `SELECT status, trial_ends_at, current_period_end, product_id, base_plan_id, provider
         FROM family_subscription WHERE family_id = ? LIMIT 1`,
    )
      .bind(familyId)
      .first<Record<string, unknown>>();

    const subscription = sub
      ? {
          status: sub.status ?? null,
          trial_ends_at:
            sub.trial_ends_at != null ? pgToIso(sub.trial_ends_at as string) : null,
          current_period_end:
            sub.current_period_end != null ? pgToIso(sub.current_period_end as string) : null,
          product_id: sub.product_id ?? null,
          base_plan_id: sub.base_plan_id ?? null,
          provider: sub.provider ?? null,
        }
      : null;

    const fam = await c.env.DB.prepare(
      `SELECT id, user_tier, subscription_tier FROM families WHERE id = ? LIMIT 1`,
    )
      .bind(familyId)
      .first<{ id: string; user_tier: string | null; subscription_tier: string | null }>();

    const family = fam
      ? {
          id: fam.id,
          user_tier: fam.user_tier ?? null,
          subscription_tier: fam.subscription_tier ?? null,
        }
      : null;

    return c.json({
      subscription,
      family,
      effective: {
        tier: effectiveEntitlement.tier,
        is_premium: effectiveEntitlement.isPremium,
        source: effectiveEntitlement.source,
        has_grandfathered_review_limits:
          effectiveEntitlement.hasGrandfatheredReviewLimits,
      },
    });
  } catch (error) {
    console.warn("[entitlement] resolve failed:");
    return c.json({ error: "family_entitlement_unavailable" }, 503);
  }
});

export default entitlement;

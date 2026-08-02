import { resolveFamilyEntitlement } from "../shared/subscriptionEntitlement.js";

export type PremiumAiParentAccessResult =
  | { ok: true; familyId: string }
  | {
      ok: false;
      status: 403 | 503;
      error: "forbidden" | "premium_required" | "ai_access_unavailable" | "family_entitlement_unavailable";
    };

type FamilyEntitlementResolver = typeof resolveFamilyEntitlement;

/** AI 하루·주간 요약의 공통 서버 권한 판정이다. */
export async function authorizePremiumAiParent(
  db: D1Database,
  input: { callerUserId: string; familyId: string },
  resolveEntitlement: FamilyEntitlementResolver = resolveFamilyEntitlement,
): Promise<PremiumAiParentAccessResult> {
  const callerUserId = String(input.callerUserId ?? "").trim();
  const familyId = String(input.familyId ?? "").trim();
  if (!callerUserId || !familyId) {
    return { ok: false, status: 403, error: "forbidden" };
  }

  let parent: unknown;
  try {
    parent = await db
      .prepare(
        `SELECT 1 AS ok
           FROM family_members fm
           JOIN families f ON f.id = fm.family_id
          WHERE fm.family_id = ?1
            AND fm.user_id = ?2
            AND fm.role = 'parent'
            AND fm.is_active = 1
          LIMIT 1`,
      )
      .bind(familyId, callerUserId)
      .first();
  } catch {
    return { ok: false, status: 503, error: "ai_access_unavailable" };
  }
  if (!parent) return { ok: false, status: 403, error: "forbidden" };

  try {
    const entitlement = await resolveEntitlement(db, familyId);
    if (!entitlement.isPremium) {
      return { ok: false, status: 403, error: "premium_required" };
    }
  } catch {
    return { ok: false, status: 503, error: "family_entitlement_unavailable" };
  }

  return { ok: true, familyId };
}

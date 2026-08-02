import { resolveCanonicalFamilyMembership } from "../db/authz";
import { resolveFamilyEntitlement } from "../shared/subscriptionEntitlement.js";

interface AcademyScheduleCaller {
  sub: string;
  family_id: string | null;
}

export type AcademyScheduleAccessResult =
  | { ok: true; familyId: string }
  | {
      ok: false;
      status: 403 | 503;
      error: "forbidden" | "premium_required" | "academy_schedule_access_unavailable" | "family_entitlement_unavailable";
    };

/**
 * 학원 시간표 전용 AI 요청의 서버 정본 권한 판정.
 * JWT role·클라이언트 tier를 믿지 않고 현재 활성 가족과 공통 엔타이틀먼트를 다시 읽는다.
 */
export async function authorizeAcademyScheduleRequest(
  db: D1Database,
  caller: AcademyScheduleCaller,
): Promise<AcademyScheduleAccessResult> {
  let membership: Awaited<ReturnType<typeof resolveCanonicalFamilyMembership>>;
  try {
    membership = await resolveCanonicalFamilyMembership(db, caller.sub, caller.family_id);
  } catch {
    return { ok: false, status: 503, error: "academy_schedule_access_unavailable" };
  }
  if (!membership || membership.role !== "parent") {
    return { ok: false, status: 403, error: "forbidden" };
  }

  try {
    const entitlement = await resolveFamilyEntitlement(db, membership.familyId);
    if (!entitlement.isPremium) {
      return { ok: false, status: 403, error: "premium_required" };
    }
  } catch {
    return { ok: false, status: 503, error: "family_entitlement_unavailable" };
  }

  return { ok: true, familyId: membership.familyId };
}

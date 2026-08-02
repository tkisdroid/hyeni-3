import { assertPrimaryParent, resolveVerifiedFamilyMembership } from "../db/authz";
import { resolveFamilyEntitlement } from "../shared/subscriptionEntitlement.js";

export type AcademyDataAction = "read" | "write" | "delete";

export type AcademyDataAccessResult =
  | { ok: true; familyId: string; role: "parent" | "child" }
  | {
      ok: false;
      status: 403 | 503;
      error: "forbidden" | "premium_required" | "academy_access_unavailable" | "family_entitlement_unavailable";
    };

/**
 * 학원 데이터의 공통 서버 권한 판정이다.
 * - 조회: Premium 가족의 활성 부모·아이(Android 위치 판정 포함)
 * - 생성/수정: Premium 가족의 주보호자
 * - 삭제: 구독이 끝나도 기존 데이터를 지울 수 있는 주보호자
 */
export async function authorizeAcademyDataAccess(
  db: D1Database,
  input: {
    callerUserId: string;
    familyId: string;
    action: AcademyDataAction;
  },
): Promise<AcademyDataAccessResult> {
  const callerUserId = String(input.callerUserId ?? "").trim();
  const familyId = String(input.familyId ?? "").trim();
  if (!callerUserId || !familyId || !["read", "write", "delete"].includes(input.action)) {
    return { ok: false, status: 403, error: "forbidden" };
  }

  let membership: Awaited<ReturnType<typeof resolveVerifiedFamilyMembership>>;
  try {
    membership = await resolveVerifiedFamilyMembership(db, callerUserId, familyId);
  } catch {
    return { ok: false, status: 503, error: "academy_access_unavailable" };
  }
  if (!membership) return { ok: false, status: 403, error: "forbidden" };

  if (input.action !== "read") {
    let primaryParent = false;
    try {
      primaryParent = await assertPrimaryParent(db, callerUserId, familyId);
    } catch {
      return { ok: false, status: 503, error: "academy_access_unavailable" };
    }
    if (!primaryParent) return { ok: false, status: 403, error: "forbidden" };
  }

  // 구독 종료가 개인정보·사용자 데이터 삭제권까지 잠그면 안 된다.
  if (input.action === "delete") {
    return { ok: true, familyId, role: "parent" };
  }

  try {
    const entitlement = await resolveFamilyEntitlement(db, familyId);
    if (!entitlement.isPremium) {
      return { ok: false, status: 403, error: "premium_required" };
    }
  } catch {
    return { ok: false, status: 503, error: "family_entitlement_unavailable" };
  }

  return { ok: true, familyId, role: membership.role };
}

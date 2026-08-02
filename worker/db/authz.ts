// RLS 2축 중 (1) family_id 격리의 기반. get_my_family_ids 함수를 D1 쿼리로 직역.
// 원본(schema.sql): family_members(user_id) UNION families(parent_id).
import {
  resolveFamilyEntitlement,
} from "../shared/subscriptionEntitlement.js";

export async function getMyFamilyIds(
  db: D1Database,
  uid: string,
): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT family_id AS fid
         FROM family_members
        WHERE user_id = ?1
          AND is_active = 1
          AND role IN ('parent', 'child')
       UNION
       SELECT id AS fid FROM families WHERE parent_id = ?1`,
    )
    .bind(uid)
    .all<{ fid: string }>();
  return (results ?? []).map((r) => r.fid).filter(Boolean);
}

export interface CanonicalFamilyMembership {
  familyId: string;
  role: "parent" | "child";
}

// access token·refresh snapshot·/family/mine 이 공유하는 현재 가족 정본.
// 활성 membership이 있으면 그 소속을 우선한다. membership이 없는 주보호자는
// 활성 구성원이 있는 소유 가족을 빈 레거시 가족보다 먼저 선택한다.
// UNION/UUID/암묵적 행 순서에는 절대 의존하지 않는다.
export async function resolveCanonicalFamilyMembership(
  db: D1Database,
  userId: string,
  preferredFamilyId: string | null = null,
): Promise<CanonicalFamilyMembership | null> {
  if (!userId) return null;

  // 명시 선택 marker가 있으면 과거 refresh snapshot보다 항상 우선한다.
  const selectedMembership = await db
    .prepare(
      `SELECT fm.family_id, fm.role
         FROM family_members fm
         JOIN families f ON f.id = fm.family_id
        WHERE fm.user_id = ?1
          AND fm.is_active = 1
          AND fm.role IN ('parent', 'child')
          AND fm.last_selected_at IS NOT NULL
          AND fm.last_selected_at <> ''
        ORDER BY substr(fm.last_selected_at, 1, 23) DESC,
                 substr(COALESCE(fm.created_at, ''), 1, 19) DESC,
                 fm.rowid DESC
        LIMIT 1`,
    )
    .bind(userId)
    .first<{ family_id: string; role: string }>();
  if (
    selectedMembership?.family_id
    && (selectedMembership.role === "parent" || selectedMembership.role === "child")
  ) {
    return { familyId: selectedMembership.family_id, role: selectedMembership.role };
  }

  // migration 직후 marker가 아직 없는 사용자만 기존 refresh/access snapshot을
  // 보존한다. 활성 membership뿐 아니라 owner-only 주보호자 가족도 검증한다.
  if (preferredFamilyId) {
    const preferred = await resolveVerifiedFamilyMembership(db, userId, preferredFamilyId);
    if (preferred) return preferred;
  }

  const membership = await db
    .prepare(
      `SELECT fm.family_id, fm.role
         FROM family_members fm
         JOIN families f ON f.id = fm.family_id
        WHERE fm.user_id = ?1
          AND fm.is_active = 1
          AND fm.role IN ('parent', 'child')
        ORDER BY substr(COALESCE(fm.created_at, ''), 1, 19) DESC,
                 fm.rowid DESC
        LIMIT 1`,
    )
    .bind(userId)
    .first<{ family_id: string; role: string }>();
  if (membership?.family_id && (membership.role === "parent" || membership.role === "child")) {
    return { familyId: membership.family_id, role: membership.role };
  }

  const owned = await db
    .prepare(
      `SELECT f.id AS family_id,
              COUNT(CASE WHEN fm.is_active = 1 THEN 1 END) AS active_members
         FROM families f
         LEFT JOIN family_members fm ON fm.family_id = f.id
        WHERE f.parent_id = ?1
        GROUP BY f.id, f.created_at
        ORDER BY active_members DESC,
                 substr(COALESCE(f.created_at, ''), 1, 19) DESC,
                 f.id ASC
        LIMIT 1`,
    )
    .bind(userId)
    .first<{ family_id: string }>();
  return owned?.family_id ? { familyId: owned.family_id, role: "parent" } : null;
}

// 페어링·가족 생성 직후에는 방금 변경한 가족이 세션 정본이다. 다른 가족의 더
// 최근 membership이 있어도 자동 선택하지 않고, 지정 가족에 대한 현재 권한을
// 다시 확인한 경우에만 그 family/role을 반환한다.
export async function resolveVerifiedFamilyMembership(
  db: D1Database,
  userId: string,
  familyId: string,
): Promise<CanonicalFamilyMembership | null> {
  if (!userId || !familyId) return null;
  const membership = await db
    .prepare(
      `SELECT fm.family_id, fm.role
         FROM family_members fm
         JOIN families f ON f.id = fm.family_id
        WHERE fm.family_id = ?1
          AND fm.user_id = ?2
          AND fm.is_active = 1
          AND fm.role IN ('parent', 'child')
        LIMIT 1`,
    )
    .bind(familyId, userId)
    .first<{ family_id: string; role: string }>();
  if (membership && (membership.role === "parent" || membership.role === "child")) {
    return { familyId: membership.family_id, role: membership.role };
  }
  const owner = await db
    .prepare("SELECT id FROM families WHERE id=? AND parent_id=? LIMIT 1")
    .bind(familyId, userId)
    .first<{ id: string }>();
  return owner ? { familyId: owner.id, role: "parent" } : null;
}

export async function markFamilySelection(
  db: D1Database,
  userId: string,
  familyId: string,
  selectedAt = new Date().toISOString(),
): Promise<void> {
  if (!userId || !familyId) return;
  await db
    .prepare(
      `UPDATE family_members
          SET last_selected_at = ?
        WHERE family_id = ? AND user_id = ? AND is_active = 1`,
    )
    .bind(selectedAt, familyId, userId)
    .run();
}

// /setup·/join·/join-as-parent처럼 사용자가 명시적으로 가족을 전환한 경로만
// 선택 마커와 살아 있는 refresh snapshot을 같은 D1 batch로 갱신한다. 일반
// login/refresh는 이 함수를 호출하지 않아 늦게 끝난 요청이 새 선택을 되돌리지 않는다.
export async function commitFamilySelection(
  db: D1Database,
  userId: string,
  familyId: string,
  selectedAt = new Date().toISOString(),
): Promise<void> {
  if (!userId || !familyId) return;
  await db.batch([
    db
      .prepare(
        `UPDATE family_members
            SET last_selected_at = NULL
          WHERE user_id = ? AND is_active = 1
            AND last_selected_at IS NOT NULL`,
      )
      .bind(userId),
    db
      .prepare(
        `UPDATE family_members
            SET last_selected_at = ?
          WHERE family_id = ? AND user_id = ? AND is_active = 1`,
      )
      .bind(selectedAt, familyId, userId),
    db
      .prepare(
        `UPDATE refresh_tokens
            SET family_id = ?
          WHERE user_id = ? AND revoked = 0
            AND substr(COALESCE(expires_at, ''), 1, 19) > substr(?3, 1, 19)`,
      )
      .bind(familyId, userId, selectedAt),
  ]);
}

// 요청 family_id가 사용자 소속인지 검증(RLS family 격리 대체).
export async function assertFamilyAccess(
  db: D1Database,
  uid: string,
  familyId: string,
): Promise<boolean> {
  if (!familyId) return false;
  const ids = await getMyFamilyIds(db, uid);
  return ids.includes(familyId);
}

// 교체된 옛 아이 기기에는 일반 가족 데이터 권한을 주지 않되, 이미 로그인된 기기에서
// 누른 SOS까지 막지는 않는다. 호출부가 사전에 안전 action allowlist를 확인한 경우에만
// 이 helper를 사용하고 위치·메모·일정 등 일반 API에는 사용하지 않는다.
export async function assertSafetyFamilyAccess(
  db: D1Database,
  uid: string,
  familyId: string,
): Promise<boolean> {
  if (await assertFamilyAccess(db, uid, familyId)) return true;
  if (!uid || !familyId) return false;
  const inactiveChild = await db
    .prepare(
      `SELECT 1 AS ok
         FROM family_members fm
         JOIN families f ON f.id = fm.family_id
        WHERE fm.family_id = ?
          AND fm.user_id = ?
          AND fm.role = 'child'
          AND fm.is_active = 0
        LIMIT 1`,
    )
    .bind(familyId, uid)
    .first<{ ok: number }>();
  return !!inactiveChild;
}

export type LocationCallerRole = "parent" | "child";

// 위치 read API의 역할 정본. JWT role은 과거 상태일 수 있으므로 user id만 신뢰하고,
// 요청 가족의 현재 주보호자 또는 활성 family member 행에서 역할을 다시 판정한다.
export async function resolveLocationCallerRole(
  db: D1Database,
  uid: string,
  familyId: string,
): Promise<LocationCallerRole | null> {
  if (!uid || !familyId) return null;
  const row = await db
    .prepare(
      `SELECT CASE
         WHEN EXISTS (
           SELECT 1 FROM families
            WHERE id = ?1 AND parent_id = ?2
         ) THEN 'parent'
         WHEN EXISTS (
           SELECT 1 FROM family_members
            WHERE family_id = ?1 AND user_id = ?2 AND role = 'parent' AND is_active = 1
         ) THEN 'parent'
         WHEN EXISTS (
           SELECT 1 FROM family_members
            WHERE family_id = ?1 AND user_id = ?2 AND role = 'child' AND is_active = 1
         ) THEN 'child'
         ELSE NULL
       END AS role`,
    )
    .bind(familyId, uid)
    .first<{ role: string | null }>();
  return row?.role === "parent" || row?.role === "child" ? row.role : null;
}

// 활성기기 격리: 호출자(uid)가 이 가족에서 superseded(is_active=0) 자녀 기기인지.
// 옛 페어링 기기가 알림(place_arrived 등)을 써 넣는 것을 소스에서 막는 게이트.
// 부모(role='parent')·활성 자녀(is_active=1)·family_members row 없는 주보호자는 false
// (차단 대상 아님) → 오직 role='child' AND is_active=0 인 경우에만 true.
export async function isSupersededChildDevice(
  db: D1Database,
  uid: string,
  familyId: string,
): Promise<boolean> {
  if (!familyId || !uid) return false;
  const row = await db
    .prepare(
      `SELECT is_active FROM family_members
        WHERE family_id = ?1 AND user_id = ?2 AND role = 'child' LIMIT 1`,
    )
    .bind(familyId, uid)
    .first<{ is_active: number }>();
  return !!row && Number(row.is_active) === 0;
}

// RLS 2축 중 (2) teacher 교차접근의 기반. my_teacher_id() PG 헬퍼 직역.
// 호출자(uid)의 teacher_profiles.id를 반환(선생님이 아니면 null).
export async function getMyTeacherId(
  db: D1Database,
  uid: string,
): Promise<string | null> {
  const row = await db
    .prepare(`SELECT id FROM teacher_profiles WHERE user_id = ?1 LIMIT 1`)
    .bind(uid)
    .first<{ id: string }>();
  return row?.id ?? null;
}

// 호출자(uid)가 해당 가족의 주 보호자(families.parent_id)인지 검증.
// is_primary_parent PG 헬퍼 직역 — events/saved_places/danger_zones write 게이트.
export async function assertPrimaryParent(
  db: D1Database,
  uid: string,
  familyId: string,
): Promise<boolean> {
  if (!familyId) return false;
  const row = await db
    .prepare(`SELECT 1 AS ok FROM families WHERE id = ?1 AND parent_id = ?2 LIMIT 1`)
    .bind(familyId, uid)
    .first<{ ok: number }>();
  return !!row;
}

// is_parent_of_member PG 헬퍼 직역 — 호출자(uid)가 child_member_id 의 부모인지.
// revoke/accept/reject teacher pairing 게이트.
export async function isParentOfMember(
  db: D1Database,
  uid: string,
  childMemberId: string,
): Promise<boolean> {
  if (!childMemberId) return false;
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM family_members child_fm
        JOIN family_members parent_fm ON parent_fm.family_id = child_fm.family_id
       WHERE child_fm.id = ?1
         AND parent_fm.user_id = ?2
         AND parent_fm.role = 'parent'
       LIMIT 1`,
    )
    .bind(childMemberId, uid)
    .first<{ ok: number }>();
  return !!row;
}

// ── 위치 조회 티어 게이트 (서버 강제) ─────────────────────────────────────────
// 확정 정책(tierPolicy): Free/reviewed = 10분 자동 스냅샷+오늘 이력(standard),
// Premium = 실시간+최근 30일(realtime). reviewed는 상업 티어가 아니라 저장장소
// grandfather 한도에만 남으므로 위치 접근 모드에는 관여하지 않는다.
// 구독·legacy 판정은 공통 가족 엔타이틀먼트 resolver만 사용한다.
// 판정 DB 오류는 최신 위치를 fail-open하지 않고 API가 503으로 강등한다.
export type LocationAccessMode = "locked" | "standard" | "realtime";

export class LocationEntitlementUnavailableError extends Error {
  readonly code = "location_entitlement_unavailable";
  readonly status = 503;

  constructor(cause: unknown) {
    super("location_entitlement_unavailable", { cause });
    this.name = "LocationEntitlementUnavailableError";
  }
}

export async function resolveLocationAccessMode(
  db: D1Database,
  familyId: string,
): Promise<LocationAccessMode> {
  if (!familyId) return "locked";
  try {
    const entitlement = await resolveFamilyEntitlement(db, familyId);
    if (entitlement.isPremium) return "realtime";
    return "standard";
  } catch (e) {
    console.warn("[authz] resolveLocationAccessMode failed:");
    throw new LocationEntitlementUnavailableError(e);
  }
}

// 가족이 프리미엄인가. 기존 호출부 호환을 위한 boolean facade이며 실제 판정은 공통 resolver가 한다.
// DB 오류를 Free로 오판하지 않고 typed 503 오류를 호출자까지 전파한다. failOpen 인자는 과거 호출 시그니처만 보존한다.
export async function isFamilyPremium(
  db: D1Database,
  familyId: string,
  _failOpen = false,
): Promise<boolean> {
  if (!familyId) return false;
  return (await resolveFamilyEntitlement(db, familyId)).isPremium;
}

export type LimitedService = "schedule" | "saved_place" | "danger_zone";

/**
 * 서버 강제 서비스 한도.
 * - 일정: 모든 티어 무제한.
 * - 저장장소: 무료 2개, 기존 review 보너스 3개, 프리미엄 무제한.
 * - 위험구역: 1개는 안전 기능으로 무료, 2개 이상(다중 위험구역)은 프리미엄.
 * null = 무제한.
 */
export async function serviceLimitForFamily(
  db: D1Database,
  familyId: string,
  service: LimitedService,
): Promise<number | null> {
  if (service === "schedule") return null;
  if (!familyId) return 0;
  const entitlement = await resolveFamilyEntitlement(db, familyId);
  if (entitlement.isPremium) return null;
  if (service === "danger_zone") return 1;
  return entitlement.hasGrandfatheredReviewLimits ? 3 : 2;
}

// 호출자(uid)가 p_class_id 반의 소유 선생님인지 검증.
// get_class_roster / get_class_today_schedule 의 EXISTS 게이트 직역.
export async function assertClassOwner(
  db: D1Database,
  uid: string,
  classId: string,
): Promise<boolean> {
  if (!classId) return false;
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM teacher_classes tc
        WHERE tc.id = ?1
          AND tc.teacher_id = (SELECT id FROM teacher_profiles WHERE user_id = ?2 LIMIT 1)
        LIMIT 1`,
    )
    .bind(classId, uid)
    .first<{ ok: number }>();
  return !!row;
}

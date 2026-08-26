import {
  assertFamilyParent,
  assertPrimaryParent,
  resolveCanonicalFamilyMembership,
} from "../db/authz";

export class StudyAccessError extends Error {
  readonly status: 403 | 404;
  readonly code: "study_parent_required" | "study_child_not_found";

  constructor(
    status: 403 | 404,
    code: "study_parent_required" | "study_child_not_found",
  ) {
    super(code);
    this.name = "StudyAccessError";
    this.status = status;
    this.code = code;
  }
}

export type StudyParentAccess = Readonly<{
  familyId: string;
  primary: boolean;
}>;

export type StudyChildAccess = StudyParentAccess & Readonly<{
  memberId: string;
}>;

export type CalendarStudyChild = Readonly<{
  memberId: string;
  displayName: string;
  photoAvailable: boolean;
}>;

export async function requireStudyParent(
  db: D1Database,
  parentUserId: string,
  preferredFamilyId: string | null = null,
): Promise<StudyParentAccess> {
  const membership = await resolveCanonicalFamilyMembership(
    db,
    parentUserId,
    preferredFamilyId,
  );
  if (
    !membership
    || membership.role !== "parent"
    || !(await assertFamilyParent(db, parentUserId, membership.familyId))
  ) {
    throw new StudyAccessError(403, "study_parent_required");
  }
  return {
    familyId: membership.familyId,
    primary: await assertPrimaryParent(db, parentUserId, membership.familyId),
  };
}

export async function requireStudyChild(
  db: D1Database,
  parentUserId: string,
  memberId: string,
  preferredFamilyId: string | null = null,
): Promise<StudyChildAccess> {
  const parent = await requireStudyParent(db, parentUserId, preferredFamilyId);
  const child = await db.prepare(
    `SELECT id FROM family_members
      WHERE id=? AND family_id=? AND role='child' AND is_active=1
      LIMIT 1`,
  ).bind(memberId, parent.familyId).first<{ id: string }>();
  if (!child) throw new StudyAccessError(404, "study_child_not_found");
  return { ...parent, memberId: child.id };
}

export async function listCalendarStudyChildren(
  db: D1Database,
  familyId: string,
): Promise<CalendarStudyChild[]> {
  const rows = await db.prepare(
    `SELECT id AS memberId, name AS displayName, photo_url AS avatarObjectKey
       FROM family_members
      WHERE family_id=? AND role='child' AND is_active=1
      ORDER BY substr(COALESCE(created_at,''),1,23), rowid`,
  ).bind(familyId).all<{
    memberId: string;
    displayName: string;
    avatarObjectKey: string | null;
  }>();
  return (rows.results ?? []).map((row) => ({
    memberId: row.memberId,
    displayName: row.displayName,
    photoAvailable: Boolean(String(row.avatarObjectKey ?? "").trim()),
  }));
}

export async function calendarStudyChild(
  db: D1Database,
  familyId: string,
  memberId: string,
): Promise<CalendarStudyChild> {
  const row = await db.prepare(
    `SELECT id AS memberId, name AS displayName, photo_url AS avatarObjectKey
       FROM family_members
      WHERE id=? AND family_id=? AND role='child' AND is_active=1
      LIMIT 1`,
  ).bind(memberId, familyId).first<{
    memberId: string;
    displayName: string;
    avatarObjectKey: string | null;
  }>();
  if (!row) throw new StudyAccessError(404, "study_child_not_found");
  return {
    memberId: row.memberId,
    displayName: row.displayName,
    photoAvailable: Boolean(String(row.avatarObjectKey ?? "").trim()),
  };
}

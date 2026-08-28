export type LearningGrade = 3 | 4 | 5 | 6;

export interface ResolvedLearningGrade {
  grade: LearningGrade;
  source: "birthdate" | "parent_override";
  academicYear: number;
}

export class LearningGradeUnavailableError extends Error {
  readonly code = "learning_grade_unavailable";

  constructor() {
    super("learning_grade_unavailable");
    this.name = "LearningGradeUnavailableError";
  }
}

interface SeoulDateParts {
  year: number;
  month: number;
  day: number;
}

export interface LearningGradeInput {
  birthdate: unknown;
  overrideGrade: unknown;
}

function seoulDateParts(now: Date): SeoulDateParts {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new LearningGradeUnavailableError();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  const year = value("year");
  const month = value("month");
  const day = value("day");
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) throw new LearningGradeUnavailableError();
  return { year, month, day };
}

export function academicYearAtSeoul(now: Date): number {
  const { year, month } = seoulDateParts(now);
  return month < 3 ? year - 1 : year;
}

function validLearningGrade(value: unknown): value is LearningGrade {
  return Number.isInteger(value) && Number(value) >= 3 && Number(value) <= 6;
}

function birthYearAtSeoul(value: unknown, now: Date): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new LearningGradeUnavailableError();
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  if (
    utcDate.getUTCFullYear() !== year
    || utcDate.getUTCMonth() !== month - 1
    || utcDate.getUTCDate() !== day
  ) throw new LearningGradeUnavailableError();
  const today = seoulDateParts(now);
  if (
    year > today.year
    || (year === today.year && (month > today.month || (month === today.month && day > today.day)))
  ) throw new LearningGradeUnavailableError();
  return year;
}

export function resolveLearningGrade(input: LearningGradeInput, now: Date): ResolvedLearningGrade {
  const academicYear = academicYearAtSeoul(now);
  if (input.overrideGrade !== null && input.overrideGrade !== undefined) {
    if (!validLearningGrade(input.overrideGrade)) throw new LearningGradeUnavailableError();
    return { grade: input.overrideGrade, source: "parent_override", academicYear };
  }
  const calculated = academicYear - birthYearAtSeoul(input.birthdate, now) - 6;
  if (!validLearningGrade(calculated)) throw new LearningGradeUnavailableError();
  return { grade: calculated, source: "birthdate", academicYear };
}

interface ActiveChildGradeRow {
  birthdate: string | null;
  learning_grade_override: number | null;
  learning_grade_row_version: number;
}

export interface ChangeLearningGradeInput {
  actorId: string;
  familyId: string;
  memberId: string;
  grade: unknown;
  rowVersion: unknown;
  requestId: string;
  occurredAt: string;
  now: Date;
}

export type ChangeLearningGradeResult =
  | { status: 200; grade: ResolvedLearningGrade; rowVersion: number }
  | { status: 400; error: "invalid_learning_grade" | "invalid_learning_grade_row_version" }
  | { status: 403; error: "grade_forbidden" }
  | { status: 409; error: "grade_changed"; grade: ResolvedLearningGrade; rowVersion: number }
  | { status: 409; error: "grade_request_id_conflict" };

function validRowVersion(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function validOverrideInput(value: unknown): value is LearningGrade | null {
  return value === null || validLearningGrade(value);
}

async function readActiveChildGrade(
  db: D1Database,
  familyId: string,
  memberId: string,
): Promise<ActiveChildGradeRow | null> {
  return db.prepare(
    `SELECT birthdate, learning_grade_override, learning_grade_row_version
       FROM family_members
      WHERE id=? AND family_id=? AND role='child' AND is_active=1
      LIMIT 1`,
  ).bind(memberId, familyId).first<ActiveChildGradeRow>();
}

function gradeForRow(row: ActiveChildGradeRow, now: Date): ResolvedLearningGrade {
  return resolveLearningGrade({ birthdate: row.birthdate, overrideGrade: row.learning_grade_override }, now);
}

async function hasActiveParentMembership(
  db: D1Database,
  actorId: string,
  familyId: string,
): Promise<boolean> {
  const row = await db.prepare(
    `SELECT 1 AS ok
       FROM family_members
      WHERE family_id=? AND user_id=? AND role='parent' AND is_active=1
      LIMIT 1`,
  ).bind(familyId, actorId).first<{ ok: number }>();
  return !!row;
}

interface GradeAuditRow {
  family_id: string;
  member_id: string | null;
  actor_user_id: string;
  setting: string;
  next_value: string | null;
  request_row_version: number;
}

function matchesAudit(audit: GradeAuditRow, input: ChangeLearningGradeInput, grade: LearningGrade | null): boolean {
  return audit.family_id === input.familyId
    && audit.member_id === input.memberId
    && audit.actor_user_id === input.actorId
    && audit.setting === "learning_grade_override"
    && audit.next_value === (grade === null ? null : String(grade))
    && Number(audit.request_row_version) === input.rowVersion;
}

async function replayOrConflict(
  db: D1Database,
  input: ChangeLearningGradeInput,
  grade: LearningGrade | null,
): Promise<ChangeLearningGradeResult | null> {
  const audit = await db.prepare(
    `SELECT family_id, member_id, actor_user_id, setting, next_value, request_row_version
       FROM study_setting_audit WHERE request_id=? LIMIT 1`,
  ).bind(input.requestId).first<GradeAuditRow>();
  if (!audit) return null;
  if (!matchesAudit(audit, input, grade)) return { status: 409, error: "grade_request_id_conflict" };
  const canonical = await readActiveChildGrade(db, input.familyId, input.memberId);
  if (!canonical) return { status: 403, error: "grade_forbidden" };
  return {
    status: 200,
    grade: gradeForRow(canonical, input.now),
    rowVersion: Number(canonical.learning_grade_row_version),
  };
}

export async function changeLearningGrade(
  db: D1Database,
  input: ChangeLearningGradeInput,
): Promise<ChangeLearningGradeResult> {
  if (!validOverrideInput(input.grade)) return { status: 400, error: "invalid_learning_grade" };
  if (!validRowVersion(input.rowVersion)) return { status: 400, error: "invalid_learning_grade_row_version" };
  if (!(await hasActiveParentMembership(db, input.actorId, input.familyId))) return { status: 403, error: "grade_forbidden" };

  const grade = input.grade;
  const existing = await replayOrConflict(db, input, grade);
  if (existing) return existing;

  const current = await readActiveChildGrade(db, input.familyId, input.memberId);
  if (!current) return { status: 403, error: "grade_forbidden" };
  const currentVersion = Number(current.learning_grade_row_version);
  if (currentVersion !== input.rowVersion) {
    return { status: 409, error: "grade_changed", grade: gradeForRow(current, input.now), rowVersion: currentVersion };
  }

  // reset(null)도 commit 전 새 자동 학년을 계산한다. 생년월일 보정이 필요하면
  // 어떤 override·version·audit도 먼저 남기지 않고 호출자에게 돌려준다.
  const prospectiveGrade = resolveLearningGrade({ birthdate: current.birthdate, overrideGrade: grade }, input.now);

  const nextVersion = currentVersion + 1;
  const update = db.prepare(
    `UPDATE family_members
        SET learning_grade_override=?, learning_grade_row_version=?
      WHERE id=? AND family_id=? AND role='child' AND is_active=1
        AND learning_grade_row_version=?
        AND EXISTS (
          SELECT 1 FROM family_members guardian
           WHERE guardian.family_id=?
             AND guardian.user_id=?
             AND guardian.role='parent'
             AND guardian.is_active=1
        )`,
  ).bind(grade, nextVersion, input.memberId, input.familyId, currentVersion, input.familyId, input.actorId);
  const audit = db.prepare(
    `INSERT INTO study_setting_audit
       (id, family_id, member_id, actor_user_id, setting, previous_value, next_value, request_id, request_row_version, occurred_at)
     SELECT ?,?,?,?, 'learning_grade_override', ?,?,?,?,?
      WHERE changes()=1`,
  ).bind(
    crypto.randomUUID(),
    input.familyId,
    input.memberId,
    input.actorId,
    current.learning_grade_override === null ? null : String(current.learning_grade_override),
    grade === null ? null : String(grade),
    input.requestId,
    currentVersion,
    input.occurredAt,
  );

  try {
    const [updated, audited] = await db.batch([update, audit]);
    if (Number(updated?.meta?.changes ?? 0) === 1 && Number(audited?.meta?.changes ?? 0) === 1) {
      return {
        status: 200,
        grade: prospectiveGrade,
        rowVersion: nextVersion,
      };
    }
  } catch (error) {
    const replay = await replayOrConflict(db, input, grade);
    if (replay) return replay;
    throw error;
  }

  const replay = await replayOrConflict(db, input, grade);
  if (replay) return replay;
  const latest = await readActiveChildGrade(db, input.familyId, input.memberId);
  if (!latest) return { status: 403, error: "grade_forbidden" };
  return {
    status: 409,
    error: "grade_changed",
    grade: gradeForRow(latest, input.now),
    rowVersion: Number(latest.learning_grade_row_version),
  };
}

import { pgNow } from "./time";

export interface TeacherNoticeRecipientTarget {
  familyId: string;
  childMemberId: string;
}

export interface TeacherNoticeAudienceMember {
  familyId: string;
  userId: string;
  role: "parent" | "child";
}

export type TeacherNoticeTerminalClaim = "claimed" | "duplicate";

const TEACHER_NOTICE_ACTION = "teacher_notice";
const TEACHER_NOTICE_TARGET_CHUNK_SIZE = 30;

function compareAudienceMember(
  left: TeacherNoticeAudienceMember,
  right: TeacherNoticeAudienceMember,
): number {
  if (left.familyId !== right.familyId) return left.familyId < right.familyId ? -1 : 1;
  if (left.role !== right.role) return left.role < right.role ? -1 : 1;
  if (left.userId !== right.userId) return left.userId < right.userId ? -1 : 1;
  return 0;
}

export async function loadTeacherNoticeAudience(
  db: D1Database,
  targets: Iterable<TeacherNoticeRecipientTarget>,
): Promise<TeacherNoticeAudienceMember[]> {
  const uniqueTargets = new Map<string, TeacherNoticeRecipientTarget>();
  for (const target of targets) {
    const familyId = String(target.familyId ?? "").trim();
    const childMemberId = String(target.childMemberId ?? "").trim();
    if (!familyId || !childMemberId) continue;
    uniqueTargets.set(`${familyId}\u0000${childMemberId}`, { familyId, childMemberId });
  }
  const normalizedTargets = [...uniqueTargets.values()];
  if (normalizedTargets.length === 0) return [];

  const audienceByIdentity = new Map<string, TeacherNoticeAudienceMember>();
  for (let offset = 0; offset < normalizedTargets.length; offset += TEACHER_NOTICE_TARGET_CHUNK_SIZE) {
    const targetChunk = normalizedTargets.slice(offset, offset + TEACHER_NOTICE_TARGET_CHUNK_SIZE);
    const familyIds = [...new Set(targetChunk.map((target) => target.familyId))];
    const familyValues = familyIds.map(() => "(?)").join(",");
    const childValues = targetChunk.map(() => "(?,?)").join(",");
    const { results } = await db
      .prepare(
        `WITH target_families(family_id) AS (VALUES ${familyValues}),
              target_children(family_id, child_member_id) AS (VALUES ${childValues}),
              audience(family_id, user_id, role) AS (
                SELECT fm.family_id, fm.user_id, 'parent'
                  FROM target_families tf
                  JOIN family_members fm ON fm.family_id=tf.family_id
                 WHERE fm.role='parent' AND fm.is_active=1 AND fm.user_id IS NOT NULL
                UNION
                SELECT f.id, f.parent_id, 'parent'
                  FROM target_families tf
                  JOIN families f ON f.id=tf.family_id
                  JOIN users u ON u.id=f.parent_id
                 WHERE f.parent_id IS NOT NULL AND trim(f.parent_id)<>''
                UNION
                SELECT fm.family_id, fm.user_id, 'child'
                  FROM target_children tc
                  JOIN family_members fm
                    ON fm.family_id=tc.family_id AND fm.id=tc.child_member_id
                 WHERE fm.role='child' AND fm.is_active=1 AND fm.user_id IS NOT NULL
              )
         SELECT family_id, user_id, role
           FROM audience
          ORDER BY family_id, role, user_id`,
      )
      .bind(
        ...familyIds,
        ...targetChunk.flatMap((target) => [target.familyId, target.childMemberId]),
      )
      .all<{ family_id: string; user_id: string; role: "parent" | "child" }>();

    for (const row of results ?? []) {
      const member: TeacherNoticeAudienceMember = {
        familyId: String(row.family_id),
        userId: String(row.user_id),
        role: row.role,
      };
      audienceByIdentity.set(
        `${member.familyId}\u0000${member.userId}\u0000${member.role}`,
        member,
      );
    }
  }

  return [...audienceByIdentity.values()].sort(compareAudienceMember);
}

export async function claimTeacherNoticeTerminalSuppression(
  db: D1Database,
  noticeId: string,
): Promise<TeacherNoticeTerminalClaim> {
  const now = pgNow();
  const inserted = await db
    .prepare(
      `INSERT OR IGNORE INTO push_idempotency
         (key,family_id,action,first_sent_at,created_at)
       VALUES (?,NULL,?,?,?)`,
    )
    .bind(noticeId, TEACHER_NOTICE_ACTION, now, now)
    .run();
  const persisted = await db
    .prepare(
      `SELECT key FROM push_idempotency
        WHERE key=? AND action=? AND family_id IS NULL AND first_sent_at IS NOT NULL
        LIMIT 1`,
    )
    .bind(noticeId, TEACHER_NOTICE_ACTION)
    .first<{ key: string }>();
  if (!persisted || String(persisted.key) !== noticeId) {
    throw new Error("teacher_notice_terminal_claim_incomplete");
  }
  return Number(inserted.meta?.changes ?? 0) > 0 ? "claimed" : "duplicate";
}

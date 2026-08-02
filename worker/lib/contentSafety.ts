export type ContentReportKind = "ai" | "memo";

const AI_REPORT_REASONS = new Set([
  "scary_or_uncomfortable",
  "abusive_language",
  "asks_personal_info",
  "inaccurate",
  "other",
]);

const MEMO_REPORT_REASONS = new Set([
  "harassment",
  "sexual_or_violent",
  "personal_info",
  "illegal_or_dangerous",
  "other",
]);

const MAX_REPORT_DETAIL_LENGTH = 500;

function contentSafetyNow(): string {
  return new Date().toISOString().replace("T", " ").replace("Z", "+00");
}

export interface NormalizedContentReportInput {
  reason: string;
  detail: string | null;
}

export function normalizeContentReportInput(
  kind: ContentReportKind,
  input: { reason?: unknown; detail?: unknown } | null | undefined,
): NormalizedContentReportInput | null {
  const reason = typeof input?.reason === "string" ? input.reason.trim() : "";
  const allowed = kind === "ai" ? AI_REPORT_REASONS : MEMO_REPORT_REASONS;
  if (!allowed.has(reason)) return null;
  const detail = typeof input?.detail === "string" ? input.detail.trim() : "";
  if (detail.length > MAX_REPORT_DETAIL_LENGTH) return null;
  return { reason, detail: detail || null };
}

export interface InsertContentReportInput extends NormalizedContentReportInput {
  kind: ContentReportKind;
  familyId: string;
  reporterUserId: string;
  contentId: string;
  reportedUserId: string | null;
  currentScreen: string;
}

export async function insertContentReport(
  db: D1Database,
  input: InsertContentReportInput,
): Promise<{ id: string; duplicate: boolean }> {
  const id = `${input.kind}-report:${input.reporterUserId}:${input.contentId}`;
  const type = input.kind === "ai" ? "ai_content_report" : "memo_content_report";
  const message = JSON.stringify({
    kind: input.kind,
    contentId: input.contentId,
    reportedUserId: input.reportedUserId,
    reason: input.reason,
    detail: input.detail,
  });
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO user_feedback
         (id, family_id, user_id, type, message, error_logs, device_info, current_screen, status, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, 'new', ?)`,
    )
    .bind(
      id,
      input.familyId,
      input.reporterUserId,
      type,
      message,
      input.currentScreen,
      contentSafetyNow(),
    )
    .run();
  return { id, duplicate: Number(result.meta?.changes ?? 0) === 0 };
}

export async function listBlockedUserIds(
  db: D1Database,
  familyId: string,
  blockerUserId: string,
): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT blocked_user_id
         FROM user_interaction_blocks
        WHERE family_id = ? AND blocker_user_id = ?
        ORDER BY created_at ASC, blocked_user_id ASC`,
    )
    .bind(familyId, blockerUserId)
    .all<{ blocked_user_id: string }>();
  return (results ?? []).map((row) => row.blocked_user_id).filter(Boolean);
}

export async function filterMemoRecipientIdsByBlocks(
  db: D1Database,
  familyId: string,
  senderUserId: string,
  recipientUserIds: Iterable<string>,
): Promise<string[]> {
  const recipients = [...new Set([...recipientUserIds].map((id) => id.trim()).filter(Boolean))];
  if (!familyId || !senderUserId || recipients.length === 0) return recipients;

  const { results } = await db
    .prepare(
      `SELECT blocker_user_id, blocked_user_id
         FROM user_interaction_blocks
        WHERE family_id = ?
          AND (blocker_user_id = ? OR blocked_user_id = ?)`,
    )
    .bind(familyId, senderUserId, senderUserId)
    .all<{ blocker_user_id: string; blocked_user_id: string }>();

  const excluded = new Set<string>();
  for (const row of results ?? []) {
    if (row.blocker_user_id === senderUserId && row.blocked_user_id) excluded.add(row.blocked_user_id);
    if (row.blocked_user_id === senderUserId && row.blocker_user_id) excluded.add(row.blocker_user_id);
  }
  return recipients.filter((recipientUserId) => !excluded.has(recipientUserId));
}

// self/co-parent 계정 삭제에서는 가족 전체 데이터는 보존하되, 삭제 사용자의 메모
// 차단 관계와 본인이 만든 신고를 제거한다. 타인이 제출한 신고 증거는 사유만 보존하고
// 피신고자 식별자를 null로 익명화한다.
export function deleteUserContentSafetyStateStmts(
  db: D1Database,
  userId: string,
): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `DELETE FROM user_interaction_blocks
          WHERE blocker_user_id = ? OR blocked_user_id = ?`,
      )
      .bind(userId, userId),
    db.prepare("DELETE FROM user_feedback WHERE user_id = ?").bind(userId),
    db
      .prepare(
        `UPDATE user_feedback
            SET message = json_set(message, '$.reportedUserId', NULL)
          WHERE type = 'memo_content_report'
            AND json_valid(message)
            AND json_extract(message, '$.reportedUserId') = ?`,
      )
      .bind(userId),
  ];
}

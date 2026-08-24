export type AiChildChatContextMessage = {
  role: "assistant" | "user";
  content: string;
  createdAt: string;
};

/**
 * 한 응답의 user/assistant 행은 같은 created_at을 공유한다. rowid를 동률 기준으로 써서
 * 최신순 조회 뒤 reverse해도 실제 삽입 순서(user → assistant)를 보존한다.
 */
export async function loadAiChildChatContextWindow(
  db: D1Database,
  familyId: string,
  childUserId: string,
  limit = 14,
): Promise<AiChildChatContextMessage[]> {
  const safeLimit = Math.max(1, Math.min(50, Math.trunc(limit) || 14));
  const result = await db
    .prepare(
      `SELECT role, content, created_at
         FROM ai_chat_messages
        WHERE family_id=? AND child_user_id=? AND role != 'system'
        ORDER BY substr(created_at,1,19) DESC, rowid DESC
        LIMIT ?`,
    )
    .bind(familyId, childUserId, safeLimit)
    .all<{ role: string; content: string; created_at: string }>();

  return (result.results ?? [])
    .slice()
    .reverse()
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: String(message.content || ""),
      createdAt: String(message.created_at || ""),
    }));
}

export type AiMutationScopeState = "active" | "blocked" | "unavailable";

/** 외부 AI 응답 뒤에도 사용자·활성 가족 관계·deletion tombstone을 다시 확인한다. */
export async function aiMutationScopeState(
  db: D1Database,
  input: {
    actorUserId: string;
    familyId: string;
    childUserId: string;
    actorRole: "parent" | "child";
  },
): Promise<AiMutationScopeState> {
  try {
    const row = await db
      .prepare(
        `SELECT 1 AS ok
           FROM users actor
           JOIN users child ON child.id=?
          WHERE actor.id=?
            AND EXISTS(
              SELECT 1 FROM family_members fm
               WHERE fm.family_id=? AND fm.user_id=? AND fm.role=? AND fm.is_active=1
            )
            AND EXISTS(
              SELECT 1 FROM family_members fm
               WHERE fm.family_id=? AND fm.user_id=? AND fm.role='child' AND fm.is_active=1
            )
            AND NOT EXISTS(
              SELECT 1 FROM account_deletion_scopes
               WHERE (scope_type='family' AND scope_id=?)
                  OR (scope_type='user' AND scope_id IN (?,?))
            )
          LIMIT 1`,
      )
      .bind(
        input.childUserId,
        input.actorUserId,
        input.familyId,
        input.actorUserId,
        input.actorRole,
        input.familyId,
        input.childUserId,
        input.familyId,
        input.actorUserId,
        input.childUserId,
      )
      .first<{ ok: number }>();
    return row ? "active" : "blocked";
  } catch (error) {
    console.error("[ai-mutation-scope] validation failed");
    return "unavailable";
  }
}

export function aiMutationScopeErrorResponse(state: Exclude<AiMutationScopeState, "active">) {
  return state === "unavailable"
    ? { status: 503 as const, body: { error: "account_state_unavailable" } }
    : { status: 409 as const, body: { error: "account_state_changed" } };
}

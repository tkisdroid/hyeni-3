export interface AuthIdentityInsert {
  id: string;
  userId: string;
  provider: string;
  providerId: string;
  identityData: string;
  createdAt: string;
}

/**
 * 기존 사용자에 identity를 붙이는 순간 users 생존과 account deletion scope 부재를
 * 같은 INSERT 문에서 확인한다. 삭제 claim이 먼저면 0건, INSERT가 먼저면 후속 삭제가
 * identity를 함께 회수하므로 orphan identity가 생기지 않는다.
 */
export async function insertAuthIdentityForCurrentUser(
  db: D1Database,
  input: AuthIdentityInsert,
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO auth_identities
         (id,user_id,provider,provider_id,identity_data,created_at)
       SELECT ?,?,?,?,?,?
        WHERE EXISTS(SELECT 1 FROM users WHERE id=?)
          AND NOT EXISTS(
            SELECT 1 FROM account_deletion_scopes
             WHERE scope_type='user' AND scope_id=?
          )`,
    )
    .bind(
      input.id,
      input.userId,
      input.provider,
      input.providerId,
      input.identityData,
      input.createdAt,
      input.userId,
      input.userId,
    )
    .run();
  return Number(result.meta?.changes ?? 0) === 1;
}

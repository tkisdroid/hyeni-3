export async function isPushSubscriptionRegisteredForAccount(
  db: D1Database,
  args: {
    endpoint: string;
    userId: string;
    familyId: string;
  },
): Promise<boolean> {
  if (!args.endpoint || !args.userId || !args.familyId) return false;
  const row = await db
    .prepare(
      `SELECT 1 AS registered
         FROM push_subscriptions
        WHERE endpoint = ? AND user_id = ? AND family_id = ?
          AND disabled_at IS NULL
        LIMIT 1`,
    )
    .bind(args.endpoint, args.userId, args.familyId)
    .first<{ registered: number }>();
  return !!row;
}

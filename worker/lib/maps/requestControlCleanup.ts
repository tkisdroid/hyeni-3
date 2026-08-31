import { deriveMapScopeDigests } from "./quota.ts";

const SESSION_GRACE_MS = 10 * 60_000;
const QUOTA_GRACE_MS = 2 * 60 * 60_000;

export async function cleanupMapRequestControl(db: D1Database, nowMs = Date.now()): Promise<{
  sessionsRemoved: number;
  quotaRowsRemoved: number;
}> {
  const [sessions, quota] = await Promise.all([
    db.prepare("DELETE FROM map_autocomplete_sessions WHERE expires_at_ms<=?")
      .bind(nowMs - SESSION_GRACE_MS).run(),
    db.prepare("DELETE FROM map_request_quota WHERE expires_at_ms<=?")
      .bind(nowMs - QUOTA_GRACE_MS).run(),
  ]);
  return {
    sessionsRemoved: Number(sessions.meta?.changes ?? 0),
    quotaRowsRemoved: Number(quota.meta?.changes ?? 0),
  };
}

export async function removeMapQuotaForUser(input: {
  db: D1Database;
  secret: string;
  userId: string;
  familyId: string;
}): Promise<number> {
  const { familyScopeDigest, userScopeDigest } = await deriveMapScopeDigests(
    input.secret,
    input.userId,
    input.familyId,
  );
  const result = await input.db.prepare(
    `UPDATE map_request_quota
        SET family_count=MAX(0,family_count-COALESCE(json_extract(user_counts_json,'$."' || ?2 || '"'),0)),
            user_counts_json=json_remove(user_counts_json,'$."' || ?2 || '"')
      WHERE family_scope_digest=?1
        AND json_type(user_counts_json,'$."' || ?2 || '"') IS NOT NULL`,
  ).bind(familyScopeDigest, userScopeDigest).run();
  return Number(result.meta?.changes ?? 0);
}

export async function removeMapQuotaForFamily(input: {
  db: D1Database;
  secret: string;
  familyId: string;
}): Promise<number> {
  const { familyScopeDigest } = await deriveMapScopeDigests(input.secret, "", input.familyId);
  const result = await input.db.prepare(
    "DELETE FROM map_request_quota WHERE family_scope_digest=?",
  ).bind(familyScopeDigest).run();
  return Number(result.meta?.changes ?? 0);
}

import { hmacHex } from "./crypto.ts";
import { MapRequestControlError } from "./errors.ts";

export type MapQuotaAction =
  | "autocomplete"
  | "details"
  | "reverse_object"
  | "reverse_raw"
  | "directions";

export const MAP_QUOTA_LIMITS: Readonly<Record<MapQuotaAction, readonly [number, number]>> = {
  autocomplete: [120, 360],
  details: [30, 90],
  reverse_object: [120, 360],
  reverse_raw: [30, 90],
  directions: [30, 90],
};

const HOUR_MS = 60 * 60_000;

export async function deriveMapScopeDigests(secret: string, userId: string, familyId: string) {
  const [familyScopeDigest, userScopeDigest] = await Promise.all([
    hmacHex(secret, `hyeni:maps:quota:family:v1\0${familyId}`),
    hmacHex(secret, `hyeni:maps:quota:user:v1\0${userId}`),
  ]);
  return { familyScopeDigest, userScopeDigest };
}

export async function claimMapQuota(input: {
  db: D1Database;
  secret: string;
  userId: string;
  familyId: string;
  action: MapQuotaAction;
  nowMs: number;
}): Promise<
  | { allowed: true; userRemaining: number; familyRemaining: number }
  | { allowed: false; retryAfterSeconds: number }
> {
  const limits = MAP_QUOTA_LIMITS[input.action];
  if (!limits) throw new MapRequestControlError();
  const [userLimit, familyLimit] = limits;
  const bucketStartMs = Math.floor(input.nowMs / HOUR_MS) * HOUR_MS;
  const expiresAtMs = bucketStartMs + HOUR_MS;
  const { familyScopeDigest, userScopeDigest } = await deriveMapScopeDigests(
    input.secret,
    input.userId,
    input.familyId,
  );
  try {
    const row = await input.db.prepare(
      `INSERT INTO map_request_quota
         (family_scope_digest,action,bucket_start_ms,family_count,user_counts_json,expires_at_ms)
       VALUES (?1,?2,?3,1,json_object(?4,1),?5)
       ON CONFLICT(family_scope_digest,action,bucket_start_ms) DO UPDATE SET
         family_count=family_count+1,
         user_counts_json=json_set(
           user_counts_json,
           '$."' || ?4 || '"',
           COALESCE(json_extract(user_counts_json,'$."' || ?4 || '"'),0)+1
         )
       WHERE family_count < ?6
         AND COALESCE(json_extract(user_counts_json,'$."' || ?4 || '"'),0) < ?7
       RETURNING family_count,
         json_extract(user_counts_json,'$."' || ?4 || '"') AS user_count`,
    ).bind(
      familyScopeDigest,
      input.action,
      bucketStartMs,
      userScopeDigest,
      expiresAtMs,
      familyLimit,
      userLimit,
    ).first<{ family_count: number; user_count: number }>();
    if (!row) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((expiresAtMs - input.nowMs) / 1000)) };
    }
    return {
      allowed: true,
      userRemaining: Math.max(0, userLimit - Number(row.user_count)),
      familyRemaining: Math.max(0, familyLimit - Number(row.family_count)),
    };
  } catch {
    throw new MapRequestControlError();
  }
}

import type { Env } from "../types";
import {
  buildFamilyUserReferenceDeleteStmts,
  buildMemberReferenceDeleteStmts,
  deleteAccountPhotoObjects,
} from "./accountDeletion";

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

interface UnpairCleanupJobRow {
  family_id: string;
  child_user_id: string;
  member_ids: string;
  exact_photo_keys: string;
  preserve_photo_keys: string;
}

export type UnpairCleanupResult =
  | { status: "complete" }
  | { status: "pending"; error: string };

function parseIds(raw: string): string[] | null {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return null;
    const ids = [...new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean))];
    return ids.length > 0 && ids.every((id) => SAFE_ID.test(id)) ? ids : null;
  } catch {
    return null;
  }
}

function parsePhotoKeys(raw: string, familyId: string): string[] | null {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return null;
    const keys = [...new Set(value.map((item) => String(item ?? "").replace(/^\/+/, "").trim()).filter(Boolean))];
    return keys.every((key) =>
      key.startsWith(`${familyId}/`) && !key.includes("..") && !key.includes("\\")
    ) ? keys : null;
  } catch {
    return null;
  }
}

async function markCleanupFailure(
  db: D1Database,
  familyId: string,
  childUserId: string,
  error: string,
): Promise<void> {
  try {
    await db
      .prepare(
        `UPDATE family_unpair_cleanup_jobs
            SET attempts=attempts+1, last_error=?, updated_at=?
          WHERE family_id=? AND child_user_id=?`,
      )
      .bind(error, new Date().toISOString(), familyId, childUserId)
      .run();
  } catch {
    // 원본 job과 inactive tombstone을 보존한다. 토큰·사진 키는 로그에 남기지 않는다.
  }
}

/**
 * inactive tombstone과 같은 D1 batch로 만들어진 job을 멱등 처리한다.
 * R2가 먼저 성공하고 D1 finalize가 실패해도 job/tombstone이 남아 재진입할 수 있다.
 */
export async function processFamilyUnpairCleanup(
  env: Pick<Env, "DB" | "PHOTOS">,
  familyId: string,
  childUserId: string,
): Promise<UnpairCleanupResult> {
  const job = await env.DB
    .prepare(
      `SELECT family_id, child_user_id, member_ids, exact_photo_keys, preserve_photo_keys
         FROM family_unpair_cleanup_jobs
        WHERE family_id=? AND child_user_id=?
        LIMIT 1`,
    )
    .bind(familyId, childUserId)
    .first<UnpairCleanupJobRow>();
  if (!job) return { status: "complete" };
  if (!SAFE_ID.test(familyId) || !SAFE_ID.test(childUserId)) {
    await markCleanupFailure(env.DB, familyId, childUserId, "invalid_cleanup_scope");
    return { status: "pending", error: "invalid_cleanup_scope" };
  }

  const memberIds = parseIds(job.member_ids);
  const exactPhotoKeys = parsePhotoKeys(job.exact_photo_keys, familyId);
  const preservePhotoKeys = parsePhotoKeys(job.preserve_photo_keys, familyId);
  if (!memberIds || !exactPhotoKeys || !preservePhotoKeys) {
    await markCleanupFailure(env.DB, familyId, childUserId, "invalid_cleanup_job");
    return { status: "pending", error: "invalid_cleanup_job" };
  }

  const placeholders = memberIds.map(() => "?").join(",");
  const active = await env.DB
    .prepare(
      `SELECT COUNT(*) AS count
         FROM family_members
        WHERE family_id=? AND user_id=? AND role='child' AND is_active=1
          AND id IN (${placeholders})`,
    )
    .bind(familyId, childUserId, ...memberIds)
    .first<{ count: number }>();
  if (Number(active?.count ?? 0) > 0) {
    await markCleanupFailure(env.DB, familyId, childUserId, "member_reactivated");
    return { status: "pending", error: "member_reactivated" };
  }

  let referenceDeletes: D1PreparedStatement[];
  try {
    referenceDeletes = [
      ...buildMemberReferenceDeleteStmts(env.DB, memberIds),
      ...(await buildFamilyUserReferenceDeleteStmts(env.DB, familyId, childUserId)),
    ];
  } catch {
    await markCleanupFailure(env.DB, familyId, childUserId, "d1_reference_plan_failed");
    return { status: "pending", error: "d1_reference_plan_failed" };
  }

  try {
    await deleteAccountPhotoObjects(env.PHOTOS, {
      userUploadScopes: [{ familyId, userId: childUserId }],
      exactKeys: exactPhotoKeys,
      preserveKeys: preservePhotoKeys,
    });
  } catch {
    await markCleanupFailure(env.DB, familyId, childUserId, "r2_cleanup_failed");
    return { status: "pending", error: "r2_cleanup_failed" };
  }

  try {
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE fcm_tokens SET disabled_at=?, disabled_reason='family_member_removed' WHERE family_id=? AND user_id=? AND disabled_at IS NULL",
      ).bind(now, familyId, childUserId),
      env.DB.prepare(
        "UPDATE push_subscriptions SET disabled_at=?, disabled_reason='family_member_removed' WHERE family_id=? AND user_id=? AND disabled_at IS NULL",
      ).bind(now, familyId, childUserId),
      ...referenceDeletes,
      env.DB.prepare(
        `DELETE FROM storage_invalid_upload_cleanup_jobs
          WHERE family_id=? AND user_id=?
            AND (committed_at IS NOT NULL OR cleaned_at IS NOT NULL)`,
      ).bind(familyId, childUserId),
      env.DB.prepare(
        `DELETE FROM family_members
          WHERE family_id=? AND user_id=? AND role='child' AND is_active=0
            AND id IN (${placeholders})`,
      ).bind(familyId, childUserId, ...memberIds),
      env.DB.prepare(
        "DELETE FROM family_unpair_cleanup_jobs WHERE family_id=? AND child_user_id=?",
      ).bind(familyId, childUserId),
    ]);
    return { status: "complete" };
  } catch {
    await markCleanupFailure(env.DB, familyId, childUserId, "d1_finalize_failed");
    return { status: "pending", error: "d1_finalize_failed" };
  }
}

/** cron용 제한 배치. 한 job 실패가 다른 job의 재시도를 막지 않는다. */
export async function processPendingFamilyUnpairCleanups(
  env: Pick<Env, "DB" | "PHOTOS">,
  limit = 20,
): Promise<{ processed: number; pending: number }> {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const { results } = await env.DB
    .prepare(
      `SELECT family_id, child_user_id
         FROM family_unpair_cleanup_jobs
        ORDER BY updated_at ASC
        LIMIT ?`,
    )
    .bind(safeLimit)
    .all<{ family_id: string; child_user_id: string }>();
  let processed = 0;
  let pending = 0;
  for (const row of results ?? []) {
    const result = await processFamilyUnpairCleanup(env, row.family_id, row.child_user_id);
    if (result.status === "complete") processed += 1;
    else pending += 1;
  }
  return { processed, pending };
}

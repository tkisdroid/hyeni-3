import type { Env } from "../types";
import type { StorageUploadQuotaScopeClaims } from "./storageUploadQuota";

const MAX_OBJECT_KEY_LENGTH = 768;
const PENDING_UPLOAD_GRACE_MS = 60 * 60 * 1000;
const TERMINAL_UPLOAD_JOURNAL_TTL_MS = 24 * 60 * 60 * 1000;
const CLEANUP_RETRY_BACKOFF_MS = [1, 5, 15, 30, 60].map(
  (minutes) => minutes * 60 * 1000,
);

interface CleanupJobRow {
  object_key: string;
  upload_nonce: string;
  upload_protocol: "multipart" | "reservation";
  multipart_upload_id: string | null;
  cleanup_started_at: string | null;
  multipart_aborted_at: string | null;
  reservation_etag: string | null;
  reservation_retired_at: string | null;
  committed_at: string | null;
  cleaned_at: string | null;
  user_id: string;
  user_day_key: string;
  family_id: string | null;
  family_day_key: string | null;
  byte_count: number;
}

export type StorageUploadJournalResult = "created" | "conflict" | "unavailable" | "ambiguous";
export type InvalidUploadCleanupResult = "complete" | "pending" | "unavailable";
export type CommittedStorageUploadRequestResult =
  | { status: "missing" | "pending" | "retired" | "conflict" | "unavailable" }
  | { status: "committed"; objectKey: string };

export type StorageUploadJournalAuthorization =
  | { kind: "child_memo"; targetMemberId: string }
  | { kind: "child_profile"; targetMemberId: string }
  | { kind: "primary_parent" }
  | { kind: "family_member" }
  | { kind: "teacher" };

function validObjectKey(value: string): boolean {
  return value.length > 0
    && value.length <= MAX_OBJECT_KEY_LENGTH
    && !value.includes("\0")
    && !value.includes("\\");
}

function validNonce(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f-]{27,40}$/i.test(value);
}

function validMultipartUploadId(value: string): boolean {
  return value.length > 0 && value.length <= 1_024 && !value.includes("\0");
}

function validR2Etag(value: string): boolean {
  return value.length > 0 && value.length <= 1_024 && !value.includes("\0");
}

function isNoSuchMultipartUpload(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; code?: unknown; message?: unknown };
  const name = String(candidate.name ?? "");
  const code = String(candidate.code ?? "");
  const message = String(candidate.message ?? "");
  return name === "NoSuchUpload"
    || code === "NoSuchUpload"
    || code === "10024"
    || message.includes("NoSuchUpload");
}

/** quota claim 직후, R2 PUT보다 먼저 crash-safe pending journal을 확정한다. */
export async function beginStorageUploadJournal(
  db: D1Database,
  input: {
    objectKey: string;
    uploadNonce: string;
    uploadProtocol?: "multipart" | "reservation";
    authorization: StorageUploadJournalAuthorization;
    requestId?: string | null;
    contentSha256?: string | null;
    claims: StorageUploadQuotaScopeClaims;
    now?: Date;
  },
): Promise<StorageUploadJournalResult> {
  if (!validObjectKey(input.objectKey) || !validNonce(input.uploadNonce)) return "unavailable";
  const uploadProtocol = input.uploadProtocol ?? "multipart";
  if (uploadProtocol !== "multipart" && uploadProtocol !== "reservation") return "unavailable";
  const authorizationKind = input.authorization.kind;
  const targetMemberId = "targetMemberId" in input.authorization
    ? input.authorization.targetMemberId
    : null;
  if (targetMemberId !== null && !/^[A-Za-z0-9_-]{1,128}$/.test(targetMemberId)) {
    return "unavailable";
  }
  const requestId = input.requestId ?? null;
  const contentSha256 = input.contentSha256 ?? null;
  if (
    (requestId !== null && !validNonce(requestId))
    || (contentSha256 !== null && !/^[0-9a-f]{64}$/i.test(contentSha256))
    || ((requestId === null) !== (contentSha256 === null))
  ) {
    return "unavailable";
  }
  const now = input.now ?? new Date();
  try {
    const result = await db
      .prepare(
         `INSERT INTO storage_invalid_upload_cleanup_jobs
           (object_key,upload_nonce,upload_protocol,user_id,user_day_key,family_id,family_day_key,byte_count,
            request_id,authorization_kind,authorization_target_id,content_sha256,
            attempts,last_error,cleanup_after,created_at,updated_at)
         SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?14,?12,?13,?15,0,NULL,?9,?10,?11
          WHERE EXISTS(SELECT 1 FROM users WHERE id=?4)
            AND NOT EXISTS (
              SELECT 1 FROM account_deletion_scopes
               WHERE (scope_type='user' AND scope_id=?4)
                  OR (?6 IS NOT NULL AND scope_type='family' AND scope_id=?6)
            )
            AND NOT EXISTS (
              SELECT 1 FROM family_unpair_cleanup_jobs
               WHERE ?6 IS NOT NULL AND family_id=?6
            )
            AND (
              (?12='teacher' AND ?6 IS NULL AND EXISTS(
                SELECT 1 FROM teacher_profiles WHERE user_id=?4
              ))
              OR (?12='primary_parent' AND ?6 IS NOT NULL AND EXISTS(
                SELECT 1 FROM families WHERE id=?6 AND parent_id=?4
              ))
              OR (?12='family_member' AND ?6 IS NOT NULL AND EXISTS(
                SELECT 1 FROM families f
                 WHERE f.id=?6
                   AND (
                     f.parent_id=?4
                     OR EXISTS(
                       SELECT 1 FROM family_members fm
                        WHERE fm.family_id=?6 AND fm.user_id=?4 AND fm.is_active=1
                          AND fm.role IN ('parent','child')
                     )
                   )
              ))
              OR (?12='child_profile' AND ?6 IS NOT NULL AND EXISTS(
                SELECT 1 FROM families f
                JOIN family_members target ON target.family_id=f.id
                 WHERE f.id=?6 AND f.parent_id=?4
                   AND target.id=?13 AND target.role='child' AND target.is_active=1
              ))
              OR (?12='child_memo' AND ?6 IS NOT NULL AND EXISTS(
                SELECT 1 FROM family_members target
                 WHERE target.id=?13 AND target.family_id=?6
                   AND target.role='child' AND target.is_active=1
                   AND (
                     EXISTS(SELECT 1 FROM families f WHERE f.id=?6 AND f.parent_id=?4)
                     OR EXISTS(
                       SELECT 1 FROM family_members caller
                        WHERE caller.family_id=?6 AND caller.user_id=?4 AND caller.is_active=1
                          AND (
                            caller.role='parent'
                            OR (caller.role='child' AND target.user_id=?4)
                          )
                     )
                   )
              ))
            )
         ON CONFLICT(object_key) DO NOTHING`,
      )
      .bind(
        input.objectKey,
        input.uploadNonce,
        uploadProtocol,
        input.claims.user.userId,
        input.claims.user.dayKey,
        input.claims.family?.familyId ?? null,
        input.claims.family?.dayKey ?? null,
        input.claims.user.byteCount,
        new Date(now.getTime() + PENDING_UPLOAD_GRACE_MS).toISOString(),
        now.toISOString(),
        now.toISOString(),
        authorizationKind,
        targetMemberId,
        requestId,
        contentSha256,
      )
      .run();
    return Number(result.meta?.changes ?? 0) === 1 ? "created" : "conflict";
  } catch (error) {
    console.error("[storage-upload-journal] begin failed");
    try {
      const row = await db
        .prepare(
          `SELECT 1 AS owned FROM storage_invalid_upload_cleanup_jobs
            WHERE object_key=? AND upload_nonce=? LIMIT 1`,
        )
        .bind(input.objectKey, input.uploadNonce)
        .first<{ owned: number }>();
      return row ? "created" : "unavailable";
    } catch {
      // INSERT commit 여부를 읽지 못한 상태에서 quota를 직접 반환하면 cron과 이중 차감될 수 있다.
      return "ambiguous";
    }
  }
}

export async function resolveCommittedStorageUploadRequest(
  db: D1Database,
  input: {
    userId: string;
    familyId: string;
    requestId: string;
    contentSha256: string;
    byteCount: number;
    authorization: StorageUploadJournalAuthorization;
  },
): Promise<CommittedStorageUploadRequestResult> {
  const targetMemberId = "targetMemberId" in input.authorization
    ? input.authorization.targetMemberId
    : null;
  if (
    !validNonce(input.requestId)
    || !/^[0-9a-f]{64}$/i.test(input.contentSha256)
    || !validObjectKey(input.userId)
    || !validObjectKey(input.familyId)
  ) {
    return { status: "conflict" };
  }
  try {
    const row = await db
      .prepare(
        `SELECT object_key,family_id,byte_count,authorization_kind,authorization_target_id,
                content_sha256,committed_at,cleaned_at
           FROM storage_invalid_upload_cleanup_jobs
          WHERE user_id=? AND request_id=? LIMIT 1`,
      )
      .bind(input.userId, input.requestId)
      .first<{
        object_key: string;
        family_id: string | null;
        byte_count: number;
        authorization_kind: string | null;
        authorization_target_id: string | null;
        content_sha256: string | null;
        committed_at: string | null;
        cleaned_at: string | null;
      }>();
    if (!row) return { status: "missing" };
    if (
      row.family_id !== input.familyId
      || Number(row.byte_count) !== input.byteCount
      || row.authorization_kind !== input.authorization.kind
      || (row.authorization_target_id ?? null) !== targetMemberId
      || String(row.content_sha256 ?? "").toLowerCase() !== input.contentSha256.toLowerCase()
    ) {
      return { status: "conflict" };
    }
    if (row.committed_at) return { status: "committed", objectKey: row.object_key };
    if (row.cleaned_at) return { status: "retired" };
    return { status: "pending" };
  } catch (error) {
    console.error("[storage-upload-journal] idempotency read failed");
    return { status: "unavailable" };
  }
}

/** multipart uploadId가 journal에 붙기 전에는 part를 올리지 않는다. cleanup 선점 뒤 attach는 실패한다. */
export async function attachStorageUploadJournalMultipart(
  db: D1Database,
  objectKey: string,
  uploadNonce: string,
  multipartUploadId: string,
): Promise<boolean> {
  if (
    !validObjectKey(objectKey)
    || !validNonce(uploadNonce)
    || !validMultipartUploadId(multipartUploadId)
  ) {
    return false;
  }
  try {
    const result = await db
      .prepare(
        `UPDATE storage_invalid_upload_cleanup_jobs
            SET multipart_upload_id=?,updated_at=?
          WHERE object_key=? AND upload_nonce=?
            AND upload_protocol='multipart'
            AND multipart_upload_id IS NULL
            AND cleanup_started_at IS NULL`,
      )
      .bind(
        multipartUploadId,
        new Date().toISOString(),
        objectKey,
        uploadNonce,
      )
      .run();
    return Number(result.meta?.changes ?? 0) === 1;
  } catch (error) {
    console.error("[storage-upload-journal] multipart attach failed");
    return false;
  }
}

/** create-only reservation의 raw ETag를 붙인 뒤에만 민감 파일 CAS를 시작한다. */
export async function attachStorageUploadJournalReservation(
  db: D1Database,
  objectKey: string,
  uploadNonce: string,
  reservationEtag: string,
): Promise<boolean> {
  if (!validObjectKey(objectKey) || !validNonce(uploadNonce) || !validR2Etag(reservationEtag)) {
    return false;
  }
  try {
    const result = await db
      .prepare(
        `UPDATE storage_invalid_upload_cleanup_jobs
            SET reservation_etag=?,updated_at=?
          WHERE object_key=? AND upload_nonce=?
            AND upload_protocol='reservation'
            AND reservation_etag IS NULL
            AND cleanup_started_at IS NULL`,
      )
      .bind(reservationEtag, new Date().toISOString(), objectKey, uploadNonce)
      .run();
    return Number(result.meta?.changes ?? 0) === 1;
  } catch (error) {
    console.error("[storage-upload-journal] reservation attach failed");
    return false;
  }
}

/** reservation PUT가 더는 민감 파일로 이어질 수 없음을 route/cleanup이 durable하게 표시한다. */
export async function markStorageUploadReservationRetired(
  db: D1Database,
  objectKey: string,
  uploadNonce: string,
): Promise<boolean> {
  if (!validObjectKey(objectKey) || !validNonce(uploadNonce)) return false;
  try {
    const result = await db
      .prepare(
        `UPDATE storage_invalid_upload_cleanup_jobs
            SET reservation_retired_at=COALESCE(reservation_retired_at,?),updated_at=?
          WHERE object_key=? AND upload_nonce=? AND upload_protocol='reservation'`,
      )
      .bind(new Date().toISOString(), new Date().toISOString(), objectKey, uploadNonce)
      .run();
    return Number(result.meta?.changes ?? 0) === 1;
  } catch (error) {
    console.error("[storage-upload-journal] reservation retire mark failed");
    return false;
  }
}

/** 유효한 업로드 응답은 정확한 nonce의 journal commit이 확정된 뒤에만 반환한다. */
export async function commitStorageUploadJournal(
  db: D1Database,
  objectKey: string,
  uploadNonce: string,
): Promise<boolean> {
  try {
    const result = await db
      .prepare(
        `UPDATE storage_invalid_upload_cleanup_jobs
            SET committed_at=COALESCE(committed_at,?),updated_at=?
          WHERE object_key=? AND upload_nonce=?
            AND cleanup_started_at IS NULL`,
      )
      .bind(new Date().toISOString(), new Date().toISOString(), objectKey, uploadNonce)
      .run();
    if (Number(result.meta?.changes ?? 0) === 1) return true;
  } catch (error) {
    console.error("[storage-upload-journal] commit failed");
  }
  try {
    const row = await db
      .prepare(
        `SELECT committed_at FROM storage_invalid_upload_cleanup_jobs
          WHERE object_key=? AND upload_nonce=? LIMIT 1`,
      )
      .bind(objectKey, uploadNonce)
      .first<{ committed_at: string | null }>();
    return !!row?.committed_at;
  } catch {
    return false;
  }
}

/** R2 PUT이 객체를 만들지 않은 것이 확실한 create-only 충돌에서 journal만 제거한다. */
export async function discardStorageUploadJournal(
  db: D1Database,
  objectKey: string,
  uploadNonce: string,
): Promise<boolean> {
  try {
    const result = await db
      .prepare(
        `DELETE FROM storage_invalid_upload_cleanup_jobs
          WHERE object_key=? AND upload_nonce=?
            AND cleanup_started_at IS NULL AND committed_at IS NULL`,
      )
      .bind(objectKey, uploadNonce)
      .run();
    if (Number(result.meta?.changes ?? 0) === 1) return true;
    const row = await db
      .prepare(
        `SELECT 1 AS pending FROM storage_invalid_upload_cleanup_jobs
          WHERE object_key=? AND upload_nonce=? LIMIT 1`,
      )
      .bind(objectKey, uploadNonce)
      .first<{ pending: number }>();
    return !row;
  } catch (error) {
    console.error("[storage-upload-journal] discard failed");
    return false;
  }
}

async function recordCleanupFailure(
  db: D1Database,
  objectKey: string,
  uploadNonce: string,
  lastError: string,
): Promise<void> {
  const failedAt = new Date();
  const retryAt = CLEANUP_RETRY_BACKOFF_MS.map(
    (delayMs) => new Date(failedAt.getTime() + delayMs).toISOString(),
  );
  try {
    await db
      .prepare(
        `UPDATE storage_invalid_upload_cleanup_jobs
            SET attempts=attempts+1,
                last_error=?,
                cleanup_after=CASE
                  WHEN attempts<=0 THEN ?
                  WHEN attempts=1 THEN ?
                  WHEN attempts=2 THEN ?
                  WHEN attempts=3 THEN ?
                  ELSE ?
                END,
                updated_at=?
          WHERE object_key=? AND upload_nonce=?`,
      )
      .bind(lastError, ...retryAt, failedAt.toISOString(), objectKey, uploadNonce)
      .run();
  } catch {
    // claim과 quota는 그대로 남아 다음 cron이 같은 cleanup을 재시도한다.
  }
}

/**
 * cleanup claim과 정상 commit 중 하나를 D1에서 먼저 확정한다. multipart abort가 먼저면
 * 늦은 complete가 실패하고, complete가 먼저면 strong-consistent HEAD/CAS tombstone으로 객체를 회수한다.
 */
export async function processStorageInvalidUploadCleanup(
  env: Pick<Env, "DB" | "PHOTOS">,
  objectKey: string,
  expectedUploadNonce: string,
): Promise<InvalidUploadCleanupResult> {
  if (!validObjectKey(objectKey) || !validNonce(expectedUploadNonce)) return "unavailable";
  const claimTime = new Date().toISOString();
  let row: CleanupJobRow | null;
  try {
    await env.DB
      .prepare(
        `UPDATE storage_invalid_upload_cleanup_jobs
            SET cleanup_started_at=COALESCE(cleanup_started_at,?),updated_at=?
          WHERE object_key=? AND upload_nonce=?
            AND committed_at IS NULL AND cleaned_at IS NULL`,
      )
      .bind(claimTime, claimTime, objectKey, expectedUploadNonce)
      .run();
    row = await env.DB
      .prepare(
        `SELECT object_key,upload_nonce,upload_protocol,multipart_upload_id,cleanup_started_at,
                multipart_aborted_at,reservation_etag,reservation_retired_at,committed_at,cleaned_at,
                user_id,user_day_key,family_id,family_day_key,byte_count
           FROM storage_invalid_upload_cleanup_jobs
          WHERE object_key=? AND upload_nonce=?
            AND committed_at IS NULL AND cleaned_at IS NULL LIMIT 1`,
      )
      .bind(objectKey, expectedUploadNonce)
      .first<CleanupJobRow>();
  } catch (error) {
    console.error("[storage-invalid-cleanup] job claim failed");
    return "unavailable";
  }
  if (!row) return "complete";

  let multipartStopped = !row.multipart_upload_id || !!row.multipart_aborted_at;
  if (row.multipart_upload_id && !multipartStopped) {
    try {
      await env.PHOTOS.resumeMultipartUpload(objectKey, row.multipart_upload_id).abort();
      multipartStopped = true;
    } catch (error) {
      multipartStopped = isNoSuchMultipartUpload(error);
      if (!multipartStopped) {
        console.error("[storage-invalid-cleanup] multipart abort failed");
      }
    }
    if (multipartStopped) {
      try {
        const result = await env.DB
          .prepare(
            `UPDATE storage_invalid_upload_cleanup_jobs
                SET multipart_aborted_at=COALESCE(multipart_aborted_at,?),updated_at=?
              WHERE object_key=? AND upload_nonce=? AND cleanup_started_at IS NOT NULL`,
          )
          .bind(claimTime, claimTime, objectKey, row.upload_nonce)
          .run();
        if (Number(result.meta?.changes ?? 0) !== 1) return "complete";
      } catch (error) {
        console.error("[storage-invalid-cleanup] multipart abort confirmation failed");
        await recordCleanupFailure(env.DB, objectKey, row.upload_nonce, "multipart_abort_confirmation_failed");
        return "pending";
      }
    }
  }

  let matchingObjectRetired = false;
  let stableObjectStateObserved = false;
  try {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const object = await env.PHOTOS.head(objectKey);
      if (!object) {
        if (
          row.upload_protocol === "reservation"
          && !row.reservation_etag
          && !row.reservation_retired_at
        ) {
          const marker = await env.PHOTOS.put(objectKey, row.upload_nonce, {
            onlyIf: { etagDoesNotMatch: "*" },
            httpMetadata: { contentType: "application/octet-stream" },
            customMetadata: {
              uploadNonce: row.upload_nonce,
              storageState: "cleanup",
            },
          });
          if (!marker) continue;
          matchingObjectRetired = true;
        }
        stableObjectStateObserved = true;
        break;
      }
      if (object.customMetadata?.uploadNonce !== row.upload_nonce) {
        stableObjectStateObserved = true;
        break;
      }
      const etag = String(object.etag ?? "");
      if (!validR2Etag(etag)) break;
      const marker = await env.PHOTOS.put(objectKey, row.upload_nonce, {
        onlyIf: { etagMatches: etag },
        httpMetadata: { contentType: "application/octet-stream" },
        customMetadata: {
          uploadNonce: row.upload_nonce,
          storageState: "cleanup",
        },
      });
      if (!marker) continue;
      // R2 delete는 조건부 연산이 아니다. CAS marker를 tombstone으로 유지해야
      // marker 직후 구 Worker가 쓴 새 정상 객체를 cleanup이 지우는 TOCTOU가 없다.
      matchingObjectRetired = true;
      stableObjectStateObserved = true;
      break;
    }
  } catch (error) {
    await recordCleanupFailure(env.DB, objectKey, row.upload_nonce, "r2_cleanup_failed");
    console.error("[storage-invalid-cleanup] R2 cleanup failed");
    return "pending";
  }

  if (!stableObjectStateObserved) {
    await recordCleanupFailure(env.DB, objectKey, row.upload_nonce, "r2_cleanup_raced");
    return "pending";
  }

  if (row.upload_protocol === "reservation" && !row.reservation_retired_at) {
    if (!row.reservation_etag && !matchingObjectRetired) {
      await recordCleanupFailure(env.DB, objectKey, row.upload_nonce, "reservation_attach_pending");
      return "pending";
    }
    if (!(await markStorageUploadReservationRetired(env.DB, objectKey, row.upload_nonce))) {
      return "pending";
    }
  }

  if (row.upload_protocol === "multipart" && !multipartStopped && !matchingObjectRetired) {
    await recordCleanupFailure(env.DB, objectKey, row.upload_nonce, "multipart_abort_unconfirmed");
    return "pending";
  }

  const now = new Date().toISOString();
  const jobExists = `EXISTS(
    SELECT 1 FROM storage_invalid_upload_cleanup_jobs
     WHERE object_key=? AND upload_nonce=? AND cleanup_started_at IS NOT NULL
       AND committed_at IS NULL AND cleaned_at IS NULL
  )`;
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `UPDATE storage_upload_daily_usage
          SET object_count=MAX(object_count-1,0),
              byte_count=MAX(byte_count-?,0),
              updated_at=?
        WHERE user_id=? AND day_key=? AND ${jobExists}`,
    ).bind(
      row.byte_count,
      now,
      row.user_id,
      row.user_day_key,
      objectKey,
      row.upload_nonce,
    ),
  ];
  if (row.family_id && row.family_day_key) {
    statements.push(
      env.DB.prepare(
        `UPDATE storage_upload_family_daily_usage
            SET object_count=MAX(object_count-1,0),
                byte_count=MAX(byte_count-?,0),
                updated_at=?
          WHERE family_id=? AND day_key=? AND ${jobExists}`,
      ).bind(
        row.byte_count,
        now,
        row.family_id,
        row.family_day_key,
        objectKey,
        row.upload_nonce,
      ),
    );
  }
  statements.push(
    env.DB.prepare(
      `UPDATE storage_invalid_upload_cleanup_jobs
          SET cleaned_at=COALESCE(cleaned_at,?),last_error=NULL,updated_at=?
        WHERE object_key=? AND upload_nonce=? AND cleanup_started_at IS NOT NULL
          AND committed_at IS NULL AND cleaned_at IS NULL`,
    ).bind(now, now, objectKey, row.upload_nonce),
  );
  try {
    await env.DB.batch(statements);
    return "complete";
  } catch (error) {
    await recordCleanupFailure(env.DB, objectKey, row.upload_nonce, "quota_release_failed");
    console.error("[storage-invalid-cleanup] quota finalize failed");
    return "pending";
  }
}

export async function processPendingStorageInvalidUploadCleanups(
  env: Pick<Env, "DB" | "PHOTOS">,
  limit = 40,
  now = new Date(),
): Promise<{ processed: number; pending: number }> {
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
  const terminalCutoff = new Date(now.getTime() - TERMINAL_UPLOAD_JOURNAL_TTL_MS).toISOString();
  try {
    // 앱 pending request id도 24시간 뒤 만료된다. 그보다 오래된 terminal 행은 quota나
    // 객체 소유권을 더 바꾸지 않으므로 cron에서 지워 활성 사용자의 원장이 무한히 늘지 않게 한다.
    await env.DB
      .prepare(
        `DELETE FROM storage_invalid_upload_cleanup_jobs
          WHERE (committed_at IS NOT NULL AND committed_at<=?)
             OR (cleaned_at IS NOT NULL AND cleaned_at<=?)`,
      )
      .bind(terminalCutoff, terminalCutoff)
      .run();
  } catch (error) {
    // terminal GC 실패는 pending PII cleanup을 막지 않는다.
    console.error("[storage-invalid-cleanup] terminal journal cleanup failed");
  }
  const { results } = await env.DB
    .prepare(
      `SELECT object_key,upload_nonce FROM storage_invalid_upload_cleanup_jobs
        WHERE cleanup_after<=? AND committed_at IS NULL AND cleaned_at IS NULL
        ORDER BY cleanup_after ASC,updated_at ASC,object_key ASC LIMIT ?`,
    )
    .bind(now.toISOString(), safeLimit)
    .all<{ object_key: string; upload_nonce: string }>();
  let processed = 0;
  let pending = 0;
  for (const row of results ?? []) {
    const result = await processStorageInvalidUploadCleanup(env, row.object_key, row.upload_nonce);
    if (result === "complete") processed += 1;
    else pending += 1;
  }
  return { processed, pending };
}

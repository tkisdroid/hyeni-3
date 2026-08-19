// P1-storage: child-photos(Supabase Storage private bucket + createSignedUrl) → R2.
//
//   POST     /api/storage/child-photo-uploads/:familyId — 서버 키 신규 업로드
//   PUT/POST /api/storage/child-photos/:path{.+}        — 구버전 create-only 호환
//   GET      /api/storage/child-photos/:path{.+}  — 조회(Bearer, 가족 격리)
//
// 왜 Worker proxy(presigned 아님)인가:
//   - child-photos 는 가족 멤버만 접근 가능해야 한다(가족 격리). R2 presigned 는 별도 서명
//     로직이 필요하고 격리도 직접 못 건다. Worker 가 JWT 를 검증하고 가족 소속을 확인한 뒤
//     객체를 직접 스트리밍한다(Supabase createSignedUrl 의 역할 대체).
//   - 비공개 객체는 Authorization 헤더로만 조회하며 브라우저는 fetch→blob URL을 사용한다
//     WebSocket은 별도의 45초·1회용 realtime ticket을 사용한다. 업로드도 Bearer 전용이다.
//
// 신규 키 규칙: `{familyId}/uploads/{uploaderUserId}/{serverUuid}.{ext}`. 클라이언트가
// 기존 profile/memo 키를 지정하거나 upsert 할 수 없고, 탈퇴 시 업로더 prefix를 회수한다.
import { Hono } from "hono";
import type { Context } from "hono";
import type { Env, Vars } from "../types";
import { requireAuth } from "../middleware/auth";
import { verifyActiveAccessToken } from "../lib/authenticatedAccess";
import {
  assertFamilyAccess,
  assertPrimaryParent,
  getMyFamilyIds,
  getMyTeacherId,
  resolveVerifiedFamilyMembership,
} from "../db/authz";
import {
  applySafeObjectResponseHeaders,
  CHILD_PHOTO_CONTENT_TYPES,
  readStorageRequestBodyCapped,
  TEACHER_NOTICE_CONTENT_TYPES,
  validateStorageUpload,
} from "../lib/storageObjectValidation";
import {
  claimStorageUploadQuotaScopes,
  releaseStorageUploadQuotaScopes,
  type StorageUploadQuotaScopeClaims,
  type StorageUploadQuotaScopesResult,
} from "../lib/storageUploadQuota";
import { accountDeletionMutationState } from "../lib/accountDeletionClaims";
import {
  attachStorageUploadJournalMultipart,
  attachStorageUploadJournalReservation,
  beginStorageUploadJournal,
  commitStorageUploadJournal,
  discardStorageUploadJournal,
  markStorageUploadReservationRetired,
  processStorageInvalidUploadCleanup,
  resolveCommittedStorageUploadRequest,
  type StorageUploadJournalAuthorization,
} from "../lib/storageInvalidUploadCleanup";

const storage = new Hono<{ Bindings: Env; Variables: Vars }>();

type Ctx = Context<{ Bindings: Env; Variables: Vars }>;
// parent_profile = 부모가 올리는 자기 프로필 사진(2026-08-17). 대상은 항상 caller 본인 멤버 행이다.
type ChildPhotoUploadPurpose = "memo" | "profile" | "placeholder" | "parent_profile";
type LegacyChildPhotoUploadKind = "memo" | "profile" | "placeholder";

const SAFE_KEY_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/;

// child-photos 키 파싱 + 검증. 첫 세그먼트를 familyId 로 추출한다.
// R2 키는 파일시스템이 아니라 평면 문자열이라 '..' 가 상위탈출은 아니지만(가족 격리가
// 진짜 경계) 방어적으로 거른다.
function parseChildPhotoPath(
  raw: string | undefined,
): { path: string; familyId: string } | null {
  const path = String(raw ?? "").replace(/^\/+/, "");
  if (!path || path.includes("..") || path.includes("\\")) return null;
  const familyId = path.split("/")[0] || "";
  if (!familyId) return null;
  return { path, familyId };
}

function parseTeacherNoticePath(
  raw: string | undefined,
): { objectKey: string; ownerUserId: string } | null {
  const rel = String(raw ?? "").replace(/^\/+/, "");
  if (!rel || rel.includes("..") || rel.includes("\\")) return null;
  const ownerUserId = rel.split("/")[0] || "";
  if (!ownerUserId) return null;
  return { objectKey: `teacher-notices/${rel}`, ownerUserId };
}

function storageValidationError(
  c: Ctx,
  error: "empty_body" | "file_too_large" | "unsupported_media_type" | "body_length_mismatch" | "body_read_failed",
) {
  if (error === "file_too_large") return c.json({ error }, 413);
  if (error === "unsupported_media_type") return c.json({ error }, 415);
  return c.json({ error }, 400);
}

function childPhotoExtension(contentType: string): string {
  if (contentType === "image/png") return ".png";
  if (contentType === "image/webp") return ".webp";
  return ".jpg";
}

function readUploadPurpose(c: Ctx): ChildPhotoUploadPurpose | null {
  const value = String(c.req.header("X-Hyeni-Upload-Purpose") ?? "").trim();
  return value === "memo" || value === "profile" || value === "placeholder" || value === "parent_profile"
    ? value
    : null;
}

async function authorizeChildPhotoUpload(
  c: Ctx,
  familyId: string,
  purpose: ChildPhotoUploadPurpose,
  targetMemberId: string,
): Promise<"ok" | "bad_target" | "forbidden"> {
  const user = c.get("user");
  if (purpose === "placeholder") {
    return (await assertPrimaryParent(c.env.DB, user.sub, familyId)) ? "ok" : "forbidden";
  }

  // 부모 본인 프로필 사진 — 주 보호자 여부와 무관하게 자기 멤버 행만 대상으로 허용한다.
  // 공동 보호자가 다른 부모의 사진을 대신 올리지 못하게 대상=caller 로 못 박는다.
  if (purpose === "parent_profile") {
    if (!targetMemberId || !SAFE_KEY_SEGMENT.test(targetMemberId)) return "bad_target";
    const own = await c.env.DB
      .prepare(
        `SELECT 1 AS ok
           FROM family_members fm
           JOIN families f ON f.id = fm.family_id
          WHERE fm.id = ? AND fm.family_id = ? AND fm.user_id = ?
            AND fm.role = 'parent' AND fm.is_active = 1
          LIMIT 1`,
      )
      .bind(targetMemberId, familyId, user.sub)
      .first<{ ok: number }>();
    return own ? "ok" : "forbidden";
  }

  if (purpose === "profile" && !(await assertPrimaryParent(c.env.DB, user.sub, familyId))) {
    return "forbidden";
  }
  const caller = purpose === "memo"
    ? await resolveVerifiedFamilyMembership(c.env.DB, user.sub, familyId)
    : null;
  if (purpose === "memo" && !caller) return "forbidden";

  if (!targetMemberId || !SAFE_KEY_SEGMENT.test(targetMemberId)) return "bad_target";
  const target = await c.env.DB
    .prepare(
      `SELECT user_id
         FROM family_members
        WHERE id = ? AND family_id = ? AND role = 'child' AND is_active = 1
        LIMIT 1`,
    )
    .bind(targetMemberId, familyId)
    .first<{ user_id: string | null }>();
  if (!target) return "bad_target";

  if (caller?.role === "child" && target.user_id !== user.sub) return "forbidden";
  return "ok";
}

async function storageMutationState(
  c: Ctx,
  familyId: string | null,
): Promise<"clear" | "blocked" | "unavailable"> {
  return accountDeletionMutationState(c.env.DB, {
    userIds: [c.get("user").sub],
    familyIds: familyId ? [familyId] : [],
  });
}

function storageMutationGuardResponse(
  c: Ctx,
  state: "blocked" | "unavailable",
) {
  return state === "blocked"
    ? c.json({ error: "account_deletion_in_progress" }, 409)
    : c.json({ error: "storage_scope_revalidation_unavailable" }, 503);
}

async function rejectStoredInvalidScope(
  c: Ctx,
  objectKey: string,
  uploadNonce: string,
  unavailable = false,
) {
  const cleanup = await processStorageInvalidUploadCleanup(c.env, objectKey, uploadNonce);
  if (cleanup !== "complete") {
    return c.json({ error: "storage_cleanup_pending" }, 503);
  }
  return unavailable
    ? c.json({ error: "storage_scope_revalidation_unavailable" }, 503)
    : c.json({ error: "storage_scope_changed" }, 409);
}

async function authorizeLegacyChildPhotoUpload(
  c: Ctx,
  familyId: string,
  relativePath: string,
): Promise<
  | { status: "ok"; kind: "memo" | "placeholder" }
  | { status: "ok"; kind: "profile"; targetMemberId: string }
  | { status: "forbidden" | "invalid_path" }
> {
  const userId = c.get("user").sub;
  if (/^memo-\d{10,}-([0-9]|[1-9]\d{1,5})\.jpg$/.test(relativePath)) {
    return (await resolveVerifiedFamilyMembership(c.env.DB, userId, familyId))
      ? { status: "ok", kind: "memo" }
      : { status: "forbidden" };
  }
  if (/^child-[1-9]\d*-\d{10,}(?:-\d{1,6})?\.jpg$/.test(relativePath)) {
    return (await assertPrimaryParent(c.env.DB, userId, familyId))
      ? { status: "ok", kind: "placeholder" }
      : { status: "forbidden" };
  }
  if (!(await assertPrimaryParent(c.env.DB, userId, familyId))) {
    return { status: "forbidden" };
  }
  const activeChildren = await c.env.DB
    .prepare(
      `SELECT id FROM family_members
        WHERE family_id=? AND role='child' AND is_active=1`,
    )
    .bind(familyId)
    .all<{ id: string }>();
  const profileMember = (activeChildren.results ?? []).find(({ id }) => {
    if (!SAFE_KEY_SEGMENT.test(id)) return false;
    const suffix = relativePath.slice(id.length);
    return relativePath.startsWith(`${id}-`) && /^-\d{10,}(?:-\d{1,6})?\.jpg$/.test(suffix);
  });
  return profileMember
    ? { status: "ok", kind: "profile", targetMemberId: profileMember.id }
    : { status: "invalid_path" };
}

async function readValidatedChildPhoto(
  c: Ctx,
): Promise<
  | { ok: true; bytes: ArrayBuffer; contentType: string }
  | {
      ok: false;
      error: "empty_body" | "file_too_large" | "unsupported_media_type" | "body_length_mismatch" | "body_read_failed";
    }
> {
  const reqContentType = c.req.header("Content-Type") || "";
  if (reqContentType.startsWith("multipart/form-data")) {
    return { ok: false, error: "unsupported_media_type" };
  }
  const body = await readStorageRequestBodyCapped(c.req.raw);
  if (!body.ok) return body;
  const buf = body.buffer;
  const validation = validateStorageUpload(buf, reqContentType, CHILD_PHOTO_CONTENT_TYPES);
  return validation.ok
    ? { ok: true, bytes: buf, contentType: validation.contentType }
    : { ok: false, error: validation.error };
}

async function sha256Hex(bytes: ArrayBuffer | ArrayBufferView): Promise<string> {
  const view = bytes instanceof ArrayBuffer
    ? new Uint8Array(bytes)
    : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const source = new Uint8Array(view.byteLength);
  source.set(view);
  const digest = await crypto.subtle.digest("SHA-256", source.buffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function storageQuotaError(
  c: Ctx,
  quota: Exclude<StorageUploadQuotaScopesResult, { status: "claimed" }>,
) {
  if (quota.status === "limited") {
    c.header("Retry-After", String(quota.retryAfterSeconds));
    return c.json({ error: "storage_upload_daily_limit" }, 429);
  }
  return c.json({ error: "storage_quota_unavailable" }, 503);
}

async function releaseQuotaAfterFailedUpload(
  c: Ctx,
  claims: StorageUploadQuotaScopeClaims,
): Promise<void> {
  try {
    await releaseStorageUploadQuotaScopes(c.env.DB, claims);
  } catch (error) {
    // 저장되지 않았더라도 rollback 실패는 제한을 느슨하게 만들지 않고 보수적으로 소비한다.
    console.error("[storage-quota] release failed");
  }
}

type JournaledMultipartStoreResult =
  | { status: "stored"; uploadNonce: string }
  | { status: "object_exists" }
  | { status: "journal_unavailable" }
  | { status: "journal_ambiguous" }
  | { status: "failed"; error: unknown };

async function retireReservationObject(
  c: Ctx,
  objectKey: string,
  uploadNonce: string,
  reservationEtag: string,
): Promise<void> {
  try {
    const marker = await c.env.PHOTOS.put(objectKey, uploadNonce, {
      onlyIf: { etagMatches: reservationEtag },
      httpMetadata: { contentType: "application/octet-stream" },
      customMetadata: { uploadNonce, storageState: "cleanup" },
    });
    // 조건부 delete가 없는 R2에서 marker를 지우면 구 Worker의 직후 PUT까지
    // 삭제할 수 있으므로 비민감 tombstone을 그대로 유지한다.
  } catch (error) {
    console.error("[storage] reservation retire failed");
  }
}

/** journal attach 전에는 part를 올리지 않아 cleanup과 늦은 complete가 abort/complete로 선형화된다. */
async function storeJournaledMultipartObject(
  c: Ctx,
  input: {
    objectKey: string;
    bytes: ArrayBuffer | ArrayBufferView;
    contentType: string;
    customMetadata: Record<string, string>;
    claims: StorageUploadQuotaScopeClaims;
    requireAbsent: boolean;
    uploadProtocol: "multipart" | "reservation";
    authorization: StorageUploadJournalAuthorization;
    requestId?: string | null;
    contentSha256?: string | null;
  },
): Promise<JournaledMultipartStoreResult> {
  const uploadNonce = crypto.randomUUID();
  const journal = await beginStorageUploadJournal(c.env.DB, {
    objectKey: input.objectKey,
    uploadNonce,
    uploadProtocol: input.uploadProtocol,
    authorization: input.authorization,
    requestId: input.requestId,
    contentSha256: input.contentSha256,
    claims: input.claims,
  });
  if (journal === "ambiguous") return { status: "journal_ambiguous" };
  if (journal === "conflict") {
    try {
      if (input.requireAbsent && await c.env.PHOTOS.head(input.objectKey)) {
        return { status: "object_exists" };
      }
    } catch {
      // 충돌 원인의 객체 존재를 확인하지 못하면 재시도 가능한 오류로 닫는다.
    }
    return { status: "journal_unavailable" };
  }
  if (journal !== "created") return { status: "journal_unavailable" };

  try {
    if (input.uploadProtocol === "reservation") {
      const reservation = await c.env.PHOTOS.put(input.objectKey, uploadNonce, {
        onlyIf: { etagDoesNotMatch: "*" },
        httpMetadata: { contentType: "application/octet-stream" },
        customMetadata: { uploadNonce, storageState: "reservation" },
      });
      if (!reservation) {
        await markStorageUploadReservationRetired(c.env.DB, input.objectKey, uploadNonce);
        if (await discardStorageUploadJournal(c.env.DB, input.objectKey, uploadNonce)) {
          return { status: "object_exists" };
        }
        await processStorageInvalidUploadCleanup(c.env, input.objectKey, uploadNonce);
        return { status: "failed", error: new Error("storage_cleanup_claimed") };
      }
      const reservationEtag = String(reservation.etag ?? "");
      const attached = await attachStorageUploadJournalReservation(
        c.env.DB,
        input.objectKey,
        uploadNonce,
        reservationEtag,
      );
      if (!attached) {
        await retireReservationObject(c, input.objectKey, uploadNonce, reservationEtag);
        await markStorageUploadReservationRetired(c.env.DB, input.objectKey, uploadNonce);
        await processStorageInvalidUploadCleanup(c.env, input.objectKey, uploadNonce);
        return { status: "failed", error: new Error("storage_cleanup_claimed") };
      }
      const stored = await c.env.PHOTOS.put(input.objectKey, input.bytes, {
        onlyIf: { etagMatches: reservationEtag },
        httpMetadata: { contentType: input.contentType },
        customMetadata: { ...input.customMetadata, uploadNonce },
      });
      if (!stored) {
        await markStorageUploadReservationRetired(c.env.DB, input.objectKey, uploadNonce);
        await processStorageInvalidUploadCleanup(c.env, input.objectKey, uploadNonce);
        return { status: "failed", error: new Error("storage_reservation_changed") };
      }
      return { status: "stored", uploadNonce };
    }

    if (input.requireAbsent && await c.env.PHOTOS.head(input.objectKey)) {
      if (await discardStorageUploadJournal(c.env.DB, input.objectKey, uploadNonce)) {
        return { status: "object_exists" };
      }
      await processStorageInvalidUploadCleanup(c.env, input.objectKey, uploadNonce);
      return { status: "failed", error: new Error("storage_cleanup_claimed") };
    }

    const multipart = await c.env.PHOTOS.createMultipartUpload(input.objectKey, {
      httpMetadata: { contentType: input.contentType },
      customMetadata: { ...input.customMetadata, uploadNonce },
    });
    const attached = await attachStorageUploadJournalMultipart(
      c.env.DB,
      input.objectKey,
      uploadNonce,
      multipart.uploadId,
    );
    if (!attached) {
      try {
        await multipart.abort();
      } catch (error) {
        // attach 전에는 part가 없어 PII 객체는 생기지 않으며 R2가 미완료 upload를 자동 회수한다.
        console.error("[storage] unattached multipart abort failed");
      }
      await processStorageInvalidUploadCleanup(c.env, input.objectKey, uploadNonce);
      return { status: "failed", error: new Error("storage_cleanup_claimed") };
    }

    const part = await multipart.uploadPart(1, input.bytes);
    await multipart.complete([part]);
    return { status: "stored", uploadNonce };
  } catch (error) {
    if (input.uploadProtocol === "reservation") {
      await markStorageUploadReservationRetired(c.env.DB, input.objectKey, uploadNonce);
    }
    await processStorageInvalidUploadCleanup(c.env, input.objectKey, uploadNonce);
    return { status: "failed", error };
  }
}

// 신규 child-photo 업로드는 caller key를 받지 않는다. UUID 충돌도 조건부 PUT으로
// 기존 객체를 절대 덮지 않고, 드문 충돌은 새 UUID로 제한 횟수 재시도한다.
async function handleChildPhotoCreate(c: Ctx) {
  const familyId = String(c.req.param("familyId") ?? "").trim();
  const user = c.get("user");
  if (!SAFE_KEY_SEGMENT.test(familyId) || !SAFE_KEY_SEGMENT.test(user.sub)) {
    return c.json({ error: "invalid_scope" }, 400);
  }
  const purpose = readUploadPurpose(c);
  if (!purpose) return c.json({ error: "invalid_upload_purpose" }, 400);
  const targetMemberId = String(c.req.header("X-Hyeni-Target-Member-Id") ?? "").trim();
  const requestId = String(c.req.header("X-Hyeni-Upload-Request-Id") ?? "").trim();
  if (requestId && !/^[0-9a-f]{8}-[0-9a-f-]{27,40}$/i.test(requestId)) {
    return c.json({ error: "invalid_upload_request_id" }, 400);
  }
  const authorization = await authorizeChildPhotoUpload(c, familyId, purpose, targetMemberId);
  if (authorization === "bad_target") return c.json({ error: "invalid_target_member" }, 400);
  if (authorization === "forbidden") return c.json({ error: "forbidden" }, 403);
  const initialMutationState = await storageMutationState(c, familyId);
  if (initialMutationState !== "clear") {
    return storageMutationGuardResponse(c, initialMutationState);
  }

  const upload = await readValidatedChildPhoto(c);
  if (!upload.ok) {
    return storageValidationError(c, upload.error);
  }
  const postBodyAuthorization = await authorizeChildPhotoUpload(
    c,
    familyId,
    purpose,
    targetMemberId,
  );
  const postBodyMutationState = await storageMutationState(c, familyId);
  if (postBodyMutationState !== "clear") {
    return storageMutationGuardResponse(c, postBodyMutationState);
  }
  if (postBodyAuthorization !== "ok") {
    return c.json({ error: "storage_scope_changed" }, 409);
  }
  const journalAuthorization: StorageUploadJournalAuthorization = purpose === "memo"
    ? { kind: "child_memo", targetMemberId }
    : purpose === "profile"
      ? { kind: "child_profile", targetMemberId }
      : purpose === "parent_profile"
        ? { kind: "parent_profile", targetMemberId }
        : { kind: "primary_parent" };
  const contentSha256 = requestId ? await sha256Hex(upload.bytes) : null;
  if (requestId && contentSha256) {
    const existing = await resolveCommittedStorageUploadRequest(c.env.DB, {
      userId: user.sub,
      familyId,
      requestId,
      contentSha256,
      byteCount: upload.bytes.byteLength,
      authorization: journalAuthorization,
    });
    if (existing.status === "committed") return c.json({ path: existing.objectKey });
    if (existing.status === "conflict") {
      return c.json({ error: "storage_upload_request_conflict" }, 409);
    }
    if (existing.status === "pending") {
      return c.json({ error: "storage_upload_in_progress" }, 409);
    }
    if (existing.status === "retired") {
      return c.json({ error: "storage_upload_request_retired" }, 409);
    }
    if (existing.status === "unavailable") {
      return c.json({ error: "storage_journal_unavailable" }, 503);
    }
  }
  const quota = await claimStorageUploadQuotaScopes(c.env.DB, {
    userId: user.sub,
    familyId,
    byteCount: upload.bytes.byteLength,
  });
  if (quota.status !== "claimed") return storageQuotaError(c, quota);

  const prePutAuthorization = await authorizeChildPhotoUpload(c, familyId, purpose, targetMemberId);
  const prePutMutationState = await storageMutationState(c, familyId);
  if (prePutAuthorization !== "ok" || prePutMutationState !== "clear") {
    await releaseQuotaAfterFailedUpload(c, quota.claims);
    if (prePutMutationState !== "clear") {
      return storageMutationGuardResponse(c, prePutMutationState);
    }
    return c.json({ error: "storage_scope_changed" }, 409);
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const path = `${familyId}/uploads/${user.sub}/${crypto.randomUUID()}${childPhotoExtension(upload.contentType)}`;
    const stored = await storeJournaledMultipartObject(c, {
      objectKey: path,
      bytes: upload.bytes,
      contentType: upload.contentType,
      customMetadata: {
        familyId,
        ownerUserId: user.sub,
        purpose,
        ...(targetMemberId ? { targetMemberId } : {}),
      },
      claims: quota.claims,
      requireAbsent: true,
      uploadProtocol: "multipart",
      authorization: journalAuthorization,
      requestId: requestId || null,
      contentSha256,
    });
    if (stored.status === "object_exists") continue;
    if (stored.status === "journal_ambiguous") {
      return c.json({ error: "storage_journal_unavailable" }, 503);
    }
    if (stored.status === "journal_unavailable") {
      await releaseQuotaAfterFailedUpload(c, quota.claims);
      return c.json({ error: "storage_journal_unavailable" }, 503);
    }
    if (stored.status === "failed") {
      console.error("[storage] child photo multipart upload failed");
      return c.json({ error: "storage_upload_failed" }, 503);
    }

    const postPutAuthorization = await authorizeChildPhotoUpload(
      c,
      familyId,
      purpose,
      targetMemberId,
    );
    const postPutMutationState = await storageMutationState(c, familyId);
    if (postPutAuthorization !== "ok" || postPutMutationState !== "clear") {
      return rejectStoredInvalidScope(
        c,
        path,
        stored.uploadNonce,
        postPutMutationState === "unavailable",
      );
    }
    if (!(await commitStorageUploadJournal(c.env.DB, path, stored.uploadNonce))) {
      await processStorageInvalidUploadCleanup(c.env, path, stored.uploadNonce);
      return c.json({ error: "storage_commit_unavailable" }, 503);
    }
    return c.json({ path });
  }
  await releaseQuotaAfterFailedUpload(c, quota.claims);
  return c.json({ error: "storage_key_collision" }, 503);
}

storage.post("/child-photo-uploads/:familyId", requireAuth, handleChildPhotoCreate);

async function handleLegacyChildPhotoUpload(c: Ctx) {
  const user = c.get("user");
  const parsed = parseChildPhotoPath(c.req.param("path"));
  if (!parsed || parsed.path.length > 512) return c.json({ error: "invalid_path" }, 400);
  const relativePath = parsed.path.slice(parsed.familyId.length + 1);
  if (!SAFE_KEY_SEGMENT.test(parsed.familyId) || !relativePath || relativePath.includes("/")) {
    return c.json({ error: "invalid_legacy_storage_path" }, 400);
  }

  const legacyAuthorization = await authorizeLegacyChildPhotoUpload(
    c,
    parsed.familyId,
    relativePath,
  );
  if (legacyAuthorization.status !== "ok") {
    if (legacyAuthorization.status === "forbidden") return c.json({ error: "forbidden" }, 403);
    return c.json({ error: "invalid_legacy_storage_path" }, 400);
  }
  const legacyKind = legacyAuthorization.kind;
  const initialMutationState = await storageMutationState(c, parsed.familyId);
  if (initialMutationState !== "clear") {
    return storageMutationGuardResponse(c, initialMutationState);
  }
  const upload = await readValidatedChildPhoto(c);
  if (!upload.ok) return storageValidationError(c, upload.error);
  const postBodyAuthorization = await authorizeLegacyChildPhotoUpload(
    c,
    parsed.familyId,
    relativePath,
  );
  const postBodyMutationState = await storageMutationState(c, parsed.familyId);
  if (postBodyMutationState !== "clear") {
    return storageMutationGuardResponse(c, postBodyMutationState);
  }
  if (postBodyAuthorization.status !== "ok") {
    return c.json({ error: "storage_scope_changed" }, 409);
  }
  const quota = await claimStorageUploadQuotaScopes(c.env.DB, {
    userId: user.sub,
    familyId: parsed.familyId,
    byteCount: upload.bytes.byteLength,
  });
  if (quota.status !== "claimed") return storageQuotaError(c, quota);

  const prePutAuthorization = await authorizeLegacyChildPhotoUpload(
    c,
    parsed.familyId,
    relativePath,
  );
  const prePutMutationState = await storageMutationState(c, parsed.familyId);
  if (prePutAuthorization.status !== "ok" || prePutMutationState !== "clear") {
    await releaseQuotaAfterFailedUpload(c, quota.claims);
    if (prePutMutationState !== "clear") {
      return storageMutationGuardResponse(c, prePutMutationState);
    }
    return c.json({ error: "storage_scope_changed" }, 409);
  }

  const stored = await storeJournaledMultipartObject(c, {
    objectKey: parsed.path,
    bytes: upload.bytes,
    contentType: upload.contentType,
    customMetadata: {
      familyId: parsed.familyId,
      ownerUserId: user.sub,
      purpose: "legacy",
      legacyKind,
    },
    claims: quota.claims,
    requireAbsent: true,
    uploadProtocol: "reservation",
    authorization: legacyAuthorization.kind === "memo"
      ? { kind: "family_member" }
      : legacyAuthorization.kind === "profile"
        ? { kind: "child_profile", targetMemberId: legacyAuthorization.targetMemberId }
        : { kind: "primary_parent" },
  });
  if (stored.status === "journal_ambiguous") {
    return c.json({ error: "storage_journal_unavailable" }, 503);
  }
  if (stored.status === "journal_unavailable") {
    await releaseQuotaAfterFailedUpload(c, quota.claims);
    return c.json({ error: "storage_journal_unavailable" }, 503);
  }
  if (stored.status === "object_exists") {
    await releaseQuotaAfterFailedUpload(c, quota.claims);
    return c.json({ error: "storage_object_exists" }, 409);
  }
  if (stored.status === "failed") {
    console.error("[storage] legacy multipart upload failed");
    return c.json({ error: "storage_upload_failed" }, 503);
  }

  const postPutAuthorization = await authorizeLegacyChildPhotoUpload(
    c,
    parsed.familyId,
    relativePath,
  );
  const postPutMutationState = await storageMutationState(c, parsed.familyId);
  if (postPutAuthorization.status !== "ok" || postPutMutationState !== "clear") {
    return rejectStoredInvalidScope(
      c,
      parsed.path,
      stored.uploadNonce,
      postPutMutationState === "unavailable",
    );
  }
  if (!(await commitStorageUploadJournal(c.env.DB, parsed.path, stored.uploadNonce))) {
    await processStorageInvalidUploadCleanup(c.env, parsed.path, stored.uploadNonce);
    return c.json({ error: "storage_commit_unavailable" }, 503);
  }

  c.header("Deprecation", "true");
  c.header(
    "Link",
    `</api/storage/child-photo-uploads/${encodeURIComponent(parsed.familyId)}>; rel="successor-version"`,
  );
  return c.json({ path: parsed.path });
}

storage.put("/child-photos/:path{.+}", requireAuth, handleLegacyChildPhotoUpload);
storage.post("/child-photos/:path{.+}", requireAuth, handleLegacyChildPhotoUpload);

async function authorizeTeacherNoticeUpload(
  c: Ctx,
  ownerUserId: string,
): Promise<"ok" | "forbidden" | "teacher_profile_required" | "blocked" | "unavailable"> {
  const userId = c.get("user").sub;
  if (ownerUserId !== userId) return "forbidden";
  const state = await storageMutationState(c, null);
  if (state !== "clear") return state;
  return (await getMyTeacherId(c.env.DB, userId)) ? "ok" : "teacher_profile_required";
}

async function handleTeacherNoticeUpload(c: Ctx) {
  const user = c.get("user");
  const parsed = parseTeacherNoticePath(c.req.param("path"));
  if (!parsed) return c.json({ error: "invalid_path" }, 400);
  const initialAuthorization = await authorizeTeacherNoticeUpload(c, parsed.ownerUserId);
  if (initialAuthorization === "forbidden") return c.json({ error: "forbidden" }, 403);
  if (initialAuthorization === "teacher_profile_required") {
    return c.json({ error: "teacher_profile_required" }, 403);
  }
  if (initialAuthorization === "blocked" || initialAuthorization === "unavailable") {
    return storageMutationGuardResponse(c, initialAuthorization);
  }
  const body = await readStorageRequestBodyCapped(c.req.raw);
  if (!body.ok) return storageValidationError(c, body.error);
  const buf = body.buffer;
  const validation = validateStorageUpload(
    buf,
    c.req.header("Content-Type") || "application/octet-stream",
    TEACHER_NOTICE_CONTENT_TYPES,
  );
  if (!validation.ok) return storageValidationError(c, validation.error);

  const postBodyAuthorization = await authorizeTeacherNoticeUpload(c, parsed.ownerUserId);
  if (postBodyAuthorization !== "ok") {
    if (postBodyAuthorization === "unavailable") {
      return storageMutationGuardResponse(c, postBodyAuthorization);
    }
    return c.json({ error: "storage_scope_changed" }, 409);
  }

  const quota = await claimStorageUploadQuotaScopes(c.env.DB, {
    userId: user.sub,
    familyId: null,
    byteCount: buf.byteLength,
  });
  if (quota.status !== "claimed") return storageQuotaError(c, quota);

  const prePutAuthorization = await authorizeTeacherNoticeUpload(c, parsed.ownerUserId);
  if (prePutAuthorization !== "ok") {
    await releaseQuotaAfterFailedUpload(c, quota.claims);
    if (prePutAuthorization === "unavailable") {
      return storageMutationGuardResponse(c, prePutAuthorization);
    }
    return c.json({ error: "storage_scope_changed" }, 409);
  }

  const stored = await storeJournaledMultipartObject(c, {
    objectKey: parsed.objectKey,
    bytes: buf,
    contentType: validation.contentType,
    customMetadata: {
      ownerUserId: user.sub,
      purpose: "teacher_notice",
    },
    claims: quota.claims,
    requireAbsent: true,
    uploadProtocol: "reservation",
    authorization: { kind: "teacher" },
  });
  if (stored.status === "journal_ambiguous") {
    return c.json({ error: "storage_journal_unavailable" }, 503);
  }
  if (stored.status === "journal_unavailable") {
    await releaseQuotaAfterFailedUpload(c, quota.claims);
    return c.json({ error: "storage_journal_unavailable" }, 503);
  }
  if (stored.status === "object_exists") {
    await releaseQuotaAfterFailedUpload(c, quota.claims);
    return c.json({ error: "storage_object_exists" }, 409);
  }
  if (stored.status === "failed") {
    console.error("[storage] teacher notice multipart upload failed");
    return c.json({ error: "storage_upload_failed" }, 503);
  }
  const postPutAuthorization = await authorizeTeacherNoticeUpload(c, parsed.ownerUserId);
  if (postPutAuthorization !== "ok") {
    return rejectStoredInvalidScope(
      c,
      parsed.objectKey,
      stored.uploadNonce,
      postPutAuthorization === "unavailable",
    );
  }
  if (!(await commitStorageUploadJournal(c.env.DB, parsed.objectKey, stored.uploadNonce))) {
    await processStorageInvalidUploadCleanup(c.env, parsed.objectKey, stored.uploadNonce);
    return c.json({ error: "storage_commit_unavailable" }, 503);
  }
  return c.json({ path: parsed.objectKey });
}

storage.put("/teacher-notices/:path{.+}", requireAuth, handleTeacherNoticeUpload);
storage.post("/teacher-notices/:path{.+}", requireAuth, handleTeacherNoticeUpload);

async function canReadTeacherNoticeObject(
  db: D1Database,
  sub: string,
  objectKey: string,
  ownerUserId: string,
): Promise<boolean> {
  if (sub === ownerUserId) return true;
  const familyIds = await getMyFamilyIds(db, sub);
  if (!familyIds.length) return false;
  const ph = familyIds.map(() => "?").join(",");
  const row = await db.prepare(
    `SELECT 1 AS ok
       FROM teacher_notice_recipients r
       JOIN teacher_notices n ON n.id = r.notice_id
       JOIN json_each(
         CASE WHEN json_valid(n.attachments) THEN n.attachments ELSE '[]' END
       ) attachment
      WHERE r.family_id IN (${ph})
        AND n.attachments IS NOT NULL
        AND json_extract(attachment.value, '$.path') = ?
      LIMIT 1`,
  )
    .bind(...familyIds, objectKey)
    .first<{ ok: number }>();
  return !!row;
}

async function canReadMemoPhotoObject(
  db: D1Database,
  sub: string,
  familyId: string,
  objectPath: string,
  metadata: Record<string, string> | undefined,
): Promise<boolean> {
  const serverNamespace = objectPath.startsWith(`${familyId}/uploads/`);
  if (!serverNamespace) return true;

  const ownerUserId = String(metadata?.ownerUserId ?? "").trim();
  const targetMemberId = String(metadata?.targetMemberId ?? "").trim();
  const purpose = String(metadata?.purpose ?? "").trim();
  const segments = objectPath.split("/");
  if (
    metadata?.familyId !== familyId
    || !SAFE_KEY_SEGMENT.test(ownerUserId)
    || segments.length !== 4
    || segments[0] !== familyId
    || segments[1] !== "uploads"
    || segments[2] !== ownerUserId
    || !["memo", "profile", "placeholder", "parent_profile"].includes(purpose)
  ) return false;

  if (purpose === "placeholder") return true;
  if (!SAFE_KEY_SEGMENT.test(targetMemberId)) return false;
  // 프로필 사진은 다른 활성 구성원이 같은 immutable 키를 photo_url로 함께 참조할 수 있다.
  // 원 대상이 연결 해제돼도 남은 참조를 깨지 않도록 메타데이터 무결성까지만 확인한다.
  // 부모 본인 프로필도 같은 가족의 아이·공동 보호자가 아바타로 보므로 같은 판정을 쓴다.
  if (purpose === "profile" || purpose === "parent_profile") return true;

  const caller = await resolveVerifiedFamilyMembership(db, sub, familyId);
  if (!caller) return false;
  const target = await db
    .prepare(
      `SELECT user_id
         FROM family_members
        WHERE id=? AND family_id=? AND role='child' AND is_active=1
        LIMIT 1`,
    )
    .bind(targetMemberId, familyId)
    .first<{ user_id: string | null }>();
  if (!target?.user_id) return false;

  if (sub !== ownerUserId) {
    const blocked = await db
      .prepare(
        `SELECT 1 AS blocked
           FROM user_interaction_blocks
          WHERE family_id=?
            AND ((blocker_user_id=? AND blocked_user_id=?)
              OR (blocker_user_id=? AND blocked_user_id=?))
          LIMIT 1`,
      )
      .bind(familyId, sub, ownerUserId, ownerUserId, sub)
      .first<{ blocked: number }>();
    if (blocked) return false;
  }
  return caller.role === "parent" || target.user_id === sub;
}

// ── 조회 (Bearer 전용) — access JWT가 URL·브라우저 기록·invocation log에 남지 않게 한다 ──
storage.get("/child-photos/:path{.+}", async (c: Ctx) => {
  const parsed = parseChildPhotoPath(c.req.param("path"));
  if (!parsed) return c.json({ error: "invalid_path" }, 400);

  const hdr = c.req.header("Authorization") ?? "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7).trim() : "";
  if (!token) return c.json({ error: "invalid_token" }, 401);
  let sub: string;
  try {
    const claims = await verifyActiveAccessToken(c.env, c.env.DB, token);
    sub = claims.sub;
  } catch {
    return c.json({ error: "invalid_token" }, 401);
  }
  if (!(await assertFamilyAccess(c.env.DB, sub, parsed.familyId))) {
    return c.json({ error: "forbidden" }, 403);
  }

  const obj = await c.env.PHOTOS.get(parsed.path);
  if (!obj) return c.json({ error: "not_found" }, 404);
  if (!(await canReadMemoPhotoObject(
    c.env.DB,
    sub,
    parsed.familyId,
    parsed.path,
    obj.customMetadata,
  ))) {
    return c.json({ error: "forbidden" }, 403);
  }

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("ETag", obj.httpEtag);
  // Authorization별 비공개 객체를 브라우저 HTTP cache가 다른 로그인에 재사용하지 않게 한다.
  // 앱 내부의 session-bound blob cache만 사용하며 응답 자체는 디스크·메모리 cache에 남기지 않는다.
  headers.set("Cache-Control", "private, no-store");
  applySafeObjectResponseHeaders(headers, CHILD_PHOTO_CONTENT_TYPES);
  return new Response(obj.body, { headers });
});

storage.get("/teacher-notices/:path{.+}", async (c: Ctx) => {
  const parsed = parseTeacherNoticePath(c.req.param("path"));
  if (!parsed) return c.json({ error: "invalid_path" }, 400);

  const hdr = c.req.header("Authorization") ?? "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7).trim() : "";
  if (!token) return c.json({ error: "invalid_token" }, 401);
  let sub: string;
  try {
    const claims = await verifyActiveAccessToken(c.env, c.env.DB, token);
    sub = claims.sub;
  } catch {
    return c.json({ error: "invalid_token" }, 401);
  }
  if (!(await canReadTeacherNoticeObject(c.env.DB, sub, parsed.objectKey, parsed.ownerUserId))) {
    return c.json({ error: "forbidden" }, 403);
  }

  const obj = await c.env.PHOTOS.get(parsed.objectKey);
  if (!obj) return c.json({ error: "not_found" }, 404);

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("ETag", obj.httpEtag);
  headers.set("Cache-Control", "private, no-store");
  applySafeObjectResponseHeaders(headers, TEACHER_NOTICE_CONTENT_TYPES);
  return new Response(obj.body, { headers });
});

export default storage;

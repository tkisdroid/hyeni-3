export const MAX_STORAGE_OBJECT_BYTES = 8 * 1024 * 1024;

export const CHILD_PHOTO_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export const TEACHER_NOTICE_CONTENT_TYPES = new Set([
  ...CHILD_PHOTO_CONTENT_TYPES,
  "application/pdf",
]);

export type StorageBodyReadResult =
  | { ok: true; buffer: ArrayBuffer }
  | { ok: false; error: "file_too_large" | "body_length_mismatch" | "body_read_failed" };

async function cancelBody(body: ReadableStream<Uint8Array> | null): Promise<void> {
  if (!body || body.locked) return;
  try {
    await body.cancel();
  } catch {
    // 이미 오류/종료된 stream 취소 실패는 원래 read 결과를 바꾸지 않는다.
  }
}

/** Content-Length를 신뢰하지 않고 maxBytes+1 전에 stream을 취소하는 bounded reader. */
export async function readStorageRequestBodyCapped(
  request: Request,
  maxBytes = MAX_STORAGE_OBJECT_BYTES,
): Promise<StorageBodyReadResult> {
  const rawLength = request.headers.get("Content-Length");
  let declaredLength: number | null = null;
  if (rawLength != null && rawLength.trim() !== "") {
    if (!/^\d+$/.test(rawLength.trim())) {
      await cancelBody(request.body);
      return { ok: false, error: "body_length_mismatch" };
    }
    declaredLength = Number(rawLength);
    if (!Number.isSafeInteger(declaredLength) || declaredLength > maxBytes) {
      await cancelBody(request.body);
      return { ok: false, error: "file_too_large" };
    }
  }

  const body = request.body;
  if (!body) {
    return declaredLength === 0 || declaredLength == null
      ? { ok: true, buffer: new ArrayBuffer(0) }
      : { ok: false, error: "body_length_mismatch" };
  }
  const reader = body.getReader();
  let capacity = Math.min(maxBytes, 64 * 1024);
  let bytes = new Uint8Array(capacity);
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const nextTotal = total + value.byteLength;
      if (nextTotal > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          /* 초과 판정 유지 */
        }
        return { ok: false, error: "file_too_large" };
      }
      if (nextTotal > bytes.byteLength) {
        let nextCapacity = Math.max(bytes.byteLength, 1);
        while (nextCapacity < nextTotal) nextCapacity = Math.min(maxBytes, nextCapacity * 2);
        const grown = new Uint8Array(nextCapacity);
        grown.set(bytes.subarray(0, total));
        bytes = grown;
      }
      bytes.set(value, total);
      total = nextTotal;
    }
  } catch {
    try {
      await reader.cancel();
    } catch {
      /* read 오류 유지 */
    }
    return { ok: false, error: "body_read_failed" };
  } finally {
    reader.releaseLock();
  }
  if (declaredLength != null && declaredLength !== total) {
    return { ok: false, error: "body_length_mismatch" };
  }
  return { ok: true, buffer: bytes.buffer.slice(0, total) as ArrayBuffer };
}

export function normalizeStorageContentType(raw: string | null | undefined): string {
  const value = String(raw ?? "").split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return value === "image/jpg" ? "image/jpeg" : value;
}

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

export function detectStorageObjectContentType(bytes: Uint8Array): string | null {
  if (bytes.byteLength >= 3 && hasPrefix(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (
    bytes.byteLength >= 8
    && hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  ) return "image/png";
  if (
    bytes.byteLength >= 12
    && hasPrefix(bytes, [0x52, 0x49, 0x46, 0x46])
    && hasPrefix(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50])
  ) return "image/webp";
  if (bytes.byteLength >= 6) {
    const signature = String.fromCharCode(...bytes.subarray(0, 6));
    if (signature === "GIF87a" || signature === "GIF89a") return "image/gif";
  }
  if (bytes.byteLength >= 5 && String.fromCharCode(...bytes.subarray(0, 5)) === "%PDF-") {
    return "application/pdf";
  }
  return null;
}

export type StorageUploadValidation =
  | { ok: true; contentType: string }
  | { ok: false; error: "empty_body" | "file_too_large" | "unsupported_media_type" };

export function validateStorageUpload(
  buffer: ArrayBuffer,
  declaredContentType: string | null | undefined,
  allowedContentTypes: ReadonlySet<string>,
): StorageUploadValidation {
  if (buffer.byteLength === 0) return { ok: false, error: "empty_body" };
  if (buffer.byteLength > MAX_STORAGE_OBJECT_BYTES) return { ok: false, error: "file_too_large" };
  const detected = detectStorageObjectContentType(new Uint8Array(buffer));
  if (!detected || !allowedContentTypes.has(detected)) {
    return { ok: false, error: "unsupported_media_type" };
  }
  const declared = normalizeStorageContentType(declaredContentType);
  if (declared && declared !== "application/octet-stream" && declared !== detected) {
    return { ok: false, error: "unsupported_media_type" };
  }
  return { ok: true, contentType: detected };
}

export type StoredObjectValidation =
  | { ok: true; contentType: string; size: number }
  | { ok: false; error: "empty_body" | "file_too_large" | "unsupported_media_type" };

export function validateStoredObjectMetadata(
  object: Pick<R2Object, "size" | "httpMetadata">,
  allowedContentTypes: ReadonlySet<string>,
): StoredObjectValidation {
  const size = Number(object.size ?? 0);
  if (!Number.isFinite(size) || size <= 0) return { ok: false, error: "empty_body" };
  if (size > MAX_STORAGE_OBJECT_BYTES) return { ok: false, error: "file_too_large" };
  const contentType = normalizeStorageContentType(object.httpMetadata?.contentType);
  if (!allowedContentTypes.has(contentType)) return { ok: false, error: "unsupported_media_type" };
  return { ok: true, contentType, size };
}

export function applySafeObjectResponseHeaders(
  headers: Headers,
  allowedContentTypes: ReadonlySet<string>,
): void {
  const contentType = normalizeStorageContentType(headers.get("Content-Type"));
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  if (allowedContentTypes.has(contentType)) {
    headers.set("Content-Type", contentType);
    return;
  }
  headers.set("Content-Type", "application/octet-stream");
  headers.set("Content-Disposition", "attachment");
}

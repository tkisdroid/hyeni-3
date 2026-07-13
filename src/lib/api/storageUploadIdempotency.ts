const STORAGE_KEY = "hyeni-storage-upload-pending-v1";
const MAX_PENDING_UPLOADS = 24;
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

interface PendingUploadEntry {
  scopeHash: string;
  requestId: string;
  createdAt: number;
}

interface PendingUploadState {
  version: 1;
  entries: PendingUploadEntry[];
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ChildPhotoUploadRequestScope {
  familyId: string;
  purpose: "memo" | "profile" | "placeholder";
  targetMemberId?: string;
  fileOrBlob: Blob;
}

export interface PendingChildPhotoUploadRequest {
  scopeHash: string;
  requestId: string;
}

interface PendingRequestOptions {
  storage?: StorageLike | null;
  now?: number;
  createRequestId?: () => string;
}

let memoryState: PendingUploadState = { version: 1, entries: [] };

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function validEntry(value: unknown): value is PendingUploadEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<PendingUploadEntry>;
  return typeof entry.scopeHash === "string"
    && /^[0-9a-f]{64}$/i.test(entry.scopeHash)
    && typeof entry.requestId === "string"
    && /^[0-9a-f]{8}-[0-9a-f-]{27,40}$/i.test(entry.requestId)
    && typeof entry.createdAt === "number"
    && Number.isFinite(entry.createdAt);
}

function readState(storage: StorageLike | null): PendingUploadState {
  if (!storage) return memoryState;
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null") as Partial<PendingUploadState> | null;
    return parsed?.version === 1 && Array.isArray(parsed.entries)
      ? { version: 1, entries: parsed.entries.filter(validEntry) }
      : { version: 1, entries: [] };
  } catch {
    return { version: 1, entries: [] };
  }
}

function writeState(storage: StorageLike | null, state: PendingUploadState): void {
  const bounded = {
    version: 1 as const,
    entries: state.entries
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_PENDING_UPLOADS),
  };
  memoryState = bounded;
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(bounded));
  } catch {
    // WebView storage가 잠시 불가해도 현재 프로세스에서는 같은 request id를 유지한다.
  }
}

function activeEntries(entries: PendingUploadEntry[], now: number): PendingUploadEntry[] {
  return entries.filter((entry) => entry.createdAt <= now && now - entry.createdAt < PENDING_TTL_MS);
}

async function digestHex(value: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function uploadScopeHash(input: ChildPhotoUploadRequestScope): Promise<string> {
  const contentHash = await digestHex(await input.fileOrBlob.arrayBuffer());
  const scope = JSON.stringify([
    input.familyId,
    input.purpose,
    input.targetMemberId ?? "",
    contentHash,
  ]);
  return digestHex(new TextEncoder().encode(scope).buffer);
}

export async function acquirePendingChildPhotoUploadRequest(
  input: ChildPhotoUploadRequestScope,
  options: PendingRequestOptions = {},
): Promise<PendingChildPhotoUploadRequest> {
  const now = options.now ?? Date.now();
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const scopeHash = await uploadScopeHash(input);
  const state = readState(storage);
  state.entries = activeEntries(state.entries, now);
  const existing = state.entries.find((entry) => entry.scopeHash === scopeHash);
  if (existing) {
    writeState(storage, state);
    return { scopeHash, requestId: existing.requestId };
  }
  const requestId = (options.createRequestId ?? (() => crypto.randomUUID()))();
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,40}$/i.test(requestId)) {
    throw new Error("invalid_storage_upload_request_id");
  }
  state.entries.unshift({ scopeHash, requestId, createdAt: now });
  writeState(storage, state);
  return { scopeHash, requestId };
}

export function clearPendingChildPhotoUploadRequest(
  request: PendingChildPhotoUploadRequest,
  options: Pick<PendingRequestOptions, "storage" | "now"> = {},
): void {
  const now = options.now ?? Date.now();
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const state = readState(storage);
  state.entries = activeEntries(state.entries, now).filter(
    (entry) => entry.scopeHash !== request.scopeHash || entry.requestId !== request.requestId,
  );
  writeState(storage, state);
}

export const storageUploadIdempotencyPolicy = {
  maxPendingUploads: MAX_PENDING_UPLOADS,
  pendingTtlMs: PENDING_TTL_MS,
} as const;

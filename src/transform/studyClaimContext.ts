export const STUDY_CLAIM_KEY = "hyeni-study-claim-v1" as const;
export const STUDY_CLAIM_ROUTE = "#/study-management/claim" as const;

const CLAIM_TTL_MS = 10 * 60_000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const CLAIM_HASH_PATTERN = /^#\/study-management\/claim\?token=([A-Za-z0-9_-]{32,128})$/;

export type StudyClaimStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type StudyClaimClock = Readonly<{ now(): number }>;
export type StudyClaimHistory = Readonly<{ replace(hash: string): void }>;

export type StudyClaimContext = Readonly<{
  consume<T>(send: (token: string) => Promise<T>): Promise<T>;
  cancel(): void;
}>;

type ClaimEnvelope = Readonly<{ token: string; expiresAt: number }>;

function parseEnvelope(raw: string): ClaimEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("study_claim_invalid");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("study_claim_invalid");
  const envelope = parsed as { token?: unknown; expiresAt?: unknown };
  if (
    typeof envelope.token !== "string"
    || !TOKEN_PATTERN.test(envelope.token)
    || typeof envelope.expiresAt !== "number"
    || !Number.isFinite(envelope.expiresAt)
  ) {
    throw new Error("study_claim_invalid");
  }
  return { token: envelope.token, expiresAt: envelope.expiresAt };
}

export function restoreStudyClaim(
  storage: StudyClaimStorage,
  clock: StudyClaimClock,
): StudyClaimContext {
  return {
    async consume<T>(send: (token: string) => Promise<T>): Promise<T> {
      const raw = storage.getItem(STUDY_CLAIM_KEY);
      storage.removeItem(STUDY_CLAIM_KEY);
      if (!raw) throw new Error("study_claim_already_consumed");
      const saved = parseEnvelope(raw);
      if (saved.expiresAt <= clock.now()) throw new Error("study_claim_expired");
      return send(saved.token);
    },
    cancel(): void {
      storage.removeItem(STUDY_CLAIM_KEY);
    },
  };
}

export function captureStudyClaim(
  hash: string,
  history: StudyClaimHistory,
  storage: StudyClaimStorage,
  clock: StudyClaimClock,
): StudyClaimContext {
  const match = CLAIM_HASH_PATTERN.exec(hash);
  if (!match) throw new Error("study_claim_invalid");
  history.replace(STUDY_CLAIM_ROUTE);
  storage.setItem(STUDY_CLAIM_KEY, JSON.stringify({
    token: match[1],
    expiresAt: clock.now() + CLAIM_TTL_MS,
  }));
  return restoreStudyClaim(storage, clock);
}

export function pendingStudyClaimDestination(
  role: "parent" | "child" | "teacher" | null,
  storage: StudyClaimStorage,
  clock: StudyClaimClock,
): "/study-management/claim" | null {
  const raw = storage.getItem(STUDY_CLAIM_KEY);
  if (!raw) return null;
  let saved: ClaimEnvelope;
  try {
    saved = parseEnvelope(raw);
  } catch {
    storage.removeItem(STUDY_CLAIM_KEY);
    return null;
  }
  if (saved.expiresAt <= clock.now()) {
    storage.removeItem(STUDY_CLAIM_KEY);
    return null;
  }
  if (role === "parent") return "/study-management/claim";
  if (role !== null) storage.removeItem(STUDY_CLAIM_KEY);
  return null;
}

export function clearPendingStudyClaim(storage: StudyClaimStorage): void {
  storage.removeItem(STUDY_CLAIM_KEY);
}

export function requireSafeStudyAttachQrUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("study_attach_qr_invalid");
  }
  if (
    url.origin !== "https://study.hyenicalendar.com"
    || url.pathname !== "/math/connect"
    || url.search !== ""
    || url.username !== ""
    || url.password !== ""
    || !TOKEN_PATTERN.test(url.hash.slice(1))
  ) {
    throw new Error("study_attach_qr_invalid");
  }
  return url.href;
}

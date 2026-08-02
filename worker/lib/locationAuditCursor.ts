export const LOCATION_AUDIT_CURSOR_VERSION = 1 as const;

const TOKEN_PREFIX = "lac1";
const MAX_TOKEN_LENGTH = 4_096;
const MAX_SECRET_LENGTH = 8_192;
const MIN_SECRET_BYTES = 32;
const MAX_ID_LENGTH = 512;
const MAX_TIMESTAMP_LENGTH = 64;
const utf8 = new TextEncoder();

export interface LocationAuditCursorPayload {
  v: typeof LOCATION_AUDIT_CURSOR_VERSION;
  familyId: string;
  start: string;
  end: string;
  subjectUserId: string | null;
  occurredAt: string;
  id: string;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}

function base64UrlToBytes(value: string): Uint8Array | null {
  if (!value || !/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return bytesToBase64Url(bytes) === value ? bytes : null;
  } catch {
    return null;
  }
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= maxLength;
}

function hasExactPayloadKeys(value: Record<string, unknown>): boolean {
  const expected = [
    "end",
    "familyId",
    "id",
    "occurredAt",
    "start",
    "subjectUserId",
    "v",
  ];
  return Object.keys(value).sort().join("\n") === expected.join("\n");
}

function validatePayload(value: unknown): LocationAuditCursorPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (!hasExactPayloadKeys(payload) || payload.v !== LOCATION_AUDIT_CURSOR_VERSION) return null;
  if (!isBoundedString(payload.familyId, MAX_ID_LENGTH)) return null;
  if (!isBoundedString(payload.start, MAX_TIMESTAMP_LENGTH)) return null;
  if (!isBoundedString(payload.end, MAX_TIMESTAMP_LENGTH)) return null;
  if (payload.subjectUserId !== null && !isBoundedString(payload.subjectUserId, MAX_ID_LENGTH)) return null;
  if (!isBoundedString(payload.occurredAt, MAX_TIMESTAMP_LENGTH)) return null;
  if (!isBoundedString(payload.id, MAX_ID_LENGTH)) return null;
  return {
    v: LOCATION_AUDIT_CURSOR_VERSION,
    familyId: payload.familyId,
    start: payload.start,
    end: payload.end,
    subjectUserId: payload.subjectUserId,
    occurredAt: payload.occurredAt,
    id: payload.id,
  };
}

export function isLocationAuditCursorSecretConfigured(
  secret: string | undefined,
): secret is string {
  if (typeof secret !== "string") return false;
  const byteLength = utf8.encode(secret.trim()).byteLength;
  return byteLength >= MIN_SECRET_BYTES && byteLength <= MAX_SECRET_LENGTH;
}

async function importHmacKey(
  secret: string,
  usages: Array<"sign" | "verify">,
): Promise<CryptoKey | null> {
  if (!isLocationAuditCursorSecretConfigured(secret)) return null;
  try {
    return await crypto.subtle.importKey(
      "raw",
      utf8.encode(secret.trim()),
      { name: "HMAC", hash: "SHA-256" },
      false,
      usages,
    );
  } catch {
    return null;
  }
}

export async function createLocationAuditCursor(
  secret: string,
  input: LocationAuditCursorPayload,
): Promise<string | null> {
  const payload = validatePayload(input);
  if (!payload) return null;
  const key = await importHmacKey(secret, ["sign"]);
  if (!key) return null;
  try {
    const encodedPayload = bytesToBase64Url(utf8.encode(JSON.stringify(payload)));
    const signedValue = `${TOKEN_PREFIX}.${encodedPayload}`;
    const signature = new Uint8Array(await crypto.subtle.sign(
      "HMAC",
      key,
      utf8.encode(signedValue),
    ));
    const token = `${signedValue}.${bytesToBase64Url(signature)}`;
    return token.length <= MAX_TOKEN_LENGTH ? token : null;
  } catch {
    return null;
  }
}

export async function verifyLocationAuditCursor(
  secret: string,
  token: string,
): Promise<LocationAuditCursorPayload | null> {
  if (typeof token !== "string" || token.length < 1 || token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return null;
  const payloadBytes = base64UrlToBytes(parts[1]);
  const signature = base64UrlToBytes(parts[2]);
  if (!payloadBytes || !signature || signature.length !== 32) return null;
  const key = await importHmacKey(secret, ["verify"]);
  if (!key) return null;
  try {
    const validSignature = await crypto.subtle.verify(
      "HMAC",
      key,
      signature,
      utf8.encode(`${TOKEN_PREFIX}.${parts[1]}`),
    );
    if (!validSignature) return null;
    const decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(payloadBytes);
    return validatePayload(JSON.parse(decoded));
  } catch {
    return null;
  }
}

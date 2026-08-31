import { MapRequestControlError } from "./errors.ts";
import { bytesToBase64Url, hmacBytes, hmacHex, secureEqual } from "./crypto.ts";

export type MapSessionProvider = "kakao" | "google";

const SESSION_VERSION = "v1";
const SESSION_TTL_MS = 5 * 60_000;

interface SessionBinding {
  handle: string;
  secret: string;
  userId: string;
  familyId: string;
  provider: MapSessionProvider;
  nowMs: number;
}

interface ParsedHandle {
  nonce: string;
  expiresAtMs: number;
}

function signatureMessage(
  nonce: string,
  expiresAtMs: number,
  userId: string,
  familyId: string,
  provider: MapSessionProvider,
): string {
  return `hyeni:maps:autocomplete:handle:v1\0${nonce}\0${expiresAtMs}\0${userId}\0${familyId}\0${provider}`;
}

async function parseVerifiedHandle(input: Omit<SessionBinding, "nowMs">): Promise<ParsedHandle | null> {
  const [version, nonce, expiryText, signature, ...rest] = input.handle.split(".");
  if (rest.length > 0 || version !== SESSION_VERSION || !/^[A-Za-z0-9_-]{20,}$/u.test(nonce ?? "")) return null;
  if (!/^\d{1,16}$/u.test(expiryText ?? "") || !/^[A-Za-z0-9_-]{40,}$/u.test(signature ?? "")) return null;
  const expiresAtMs = Number(expiryText);
  if (!Number.isSafeInteger(expiresAtMs)) return null;
  const expected = bytesToBase64Url(await hmacBytes(
    input.secret,
    signatureMessage(nonce, expiresAtMs, input.userId, input.familyId, input.provider),
  ));
  return secureEqual(expected, signature) ? { nonce, expiresAtMs } : null;
}

async function handleDigest(secret: string, handle: string): Promise<string> {
  return hmacHex(secret, `hyeni:maps:autocomplete:digest:v1\0${handle}`);
}

export async function createAutocompleteSession(input: {
  db: D1Database;
  secret: string;
  userId: string;
  familyId: string;
  provider: MapSessionProvider;
  nowMs: number;
}): Promise<{ handle: string; expiresAt: string }> {
  const nonce = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(18)));
  const expiresAtMs = input.nowMs + SESSION_TTL_MS;
  const signature = bytesToBase64Url(await hmacBytes(
    input.secret,
    signatureMessage(nonce, expiresAtMs, input.userId, input.familyId, input.provider),
  ));
  const handle = `${SESSION_VERSION}.${nonce}.${expiresAtMs}.${signature}`;
  try {
    await input.db.prepare(
      `INSERT INTO map_autocomplete_sessions(handle_digest,expires_at_ms,consumed_at_ms,created_at_ms)
       VALUES (?, ?, NULL, ?)`,
    ).bind(await handleDigest(input.secret, handle), expiresAtMs, input.nowMs).run();
  } catch {
    throw new MapRequestControlError();
  }
  return { handle, expiresAt: new Date(expiresAtMs).toISOString() };
}

export async function inspectAutocompleteHandle(input: SessionBinding): Promise<ParsedHandle | null> {
  const parsed = await parseVerifiedHandle(input);
  return parsed && parsed.expiresAtMs >= input.nowMs ? parsed : null;
}

export async function deriveProviderSessionToken(input: SessionBinding): Promise<string> {
  const parsed = await inspectAutocompleteHandle(input);
  if (!parsed) throw new Error("invalid_map_autocomplete_handle");
  const bytes = (await hmacBytes(
    input.secret,
    `hyeni:maps:provider-session:v1\0${parsed.nonce}\0${input.userId}\0${input.familyId}\0${input.provider}`,
  )).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function consumeAutocompleteHandleAtomically(input: SessionBinding & {
  db: D1Database;
  providerPlaceId: string;
}): Promise<"consumed" | "invalid" | "expired" | "reused"> {
  if (!input.providerPlaceId.trim()) return "invalid";
  const parsed = await parseVerifiedHandle(input);
  if (!parsed) return "invalid";
  if (parsed.expiresAtMs < input.nowMs) return "expired";
  const digest = await handleDigest(input.secret, input.handle);
  try {
    const claimed = await input.db.prepare(
      `UPDATE map_autocomplete_sessions
          SET consumed_at_ms=?
        WHERE handle_digest=? AND consumed_at_ms IS NULL AND expires_at_ms>=?
        RETURNING handle_digest`,
    ).bind(input.nowMs, digest, input.nowMs).first<{ handle_digest: string }>();
    if (claimed) return "consumed";
    const existing = await input.db.prepare(
      "SELECT expires_at_ms,consumed_at_ms FROM map_autocomplete_sessions WHERE handle_digest=? LIMIT 1",
    ).bind(digest).first<{ expires_at_ms: number; consumed_at_ms: number | null }>();
    if (!existing) return "invalid";
    if (existing.expires_at_ms < input.nowMs) return "expired";
    return existing.consumed_at_ms == null ? "invalid" : "reused";
  } catch {
    throw new MapRequestControlError();
  }
}

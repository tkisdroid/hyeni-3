export const MEMO_DISPLAY_PERMIT_VERSION = 1 as const;
// 발송 경계의 최대 90초 network deadline + push service 120초 보관 + 표시 승인
// 왕복 여유를 모두 덮되, 재사용 범위는 5분을 넘지 않는다.
export const MEMO_DISPLAY_PERMIT_TTL_SECONDS = 5 * 60;

const MAX_PERMIT_LENGTH = 3_072;
const MAX_SECRET_LENGTH = 8_192;
const MAX_SCOPE_ID_LENGTH = 128;
const MAX_PUSH_ID_LENGTH = 200;
const MAX_FUTURE_SECONDS = 5 * 60;
const SAFE_SCOPE_ID = /^[A-Za-z0-9._:-]+$/;

export interface MemoDisplayPermitPayload {
  version: typeof MEMO_DISPLAY_PERMIT_VERSION;
  familyId: string;
  senderUserId: string;
  recipientUserId: string;
  pushId: string;
  targetChildUserId: string;
  exp: number;
}

export type MemoDisplayPermitInput = Omit<MemoDisplayPermitPayload, "version" | "exp">;

const utf8 = new TextEncoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array | null {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return bytesToBase64Url(bytes) === value ? bytes : null;
  } catch {
    return null;
  }
}

function isBoundedScopeId(value: unknown, maxLength = MAX_SCOPE_ID_LENGTH): value is string {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= maxLength
    && SAFE_SCOPE_ID.test(value);
}

function hasExactPayloadKeys(value: Record<string, unknown>): boolean {
  const expected = [
    "exp",
    "familyId",
    "pushId",
    "recipientUserId",
    "senderUserId",
    "targetChildUserId",
    "version",
  ];
  return Object.keys(value).sort().join("\n") === expected.join("\n");
}

function validatePayload(
  value: unknown,
  nowSeconds: number,
): MemoDisplayPermitPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (!hasExactPayloadKeys(payload)) return null;
  if (payload.version !== MEMO_DISPLAY_PERMIT_VERSION) return null;
  if (!isBoundedScopeId(payload.familyId)) return null;
  if (!isBoundedScopeId(payload.senderUserId)) return null;
  if (!isBoundedScopeId(payload.recipientUserId)) return null;
  if (!isBoundedScopeId(payload.targetChildUserId)) return null;
  if (!isBoundedScopeId(payload.pushId, MAX_PUSH_ID_LENGTH)) return null;
  if (payload.senderUserId === payload.recipientUserId) return null;
  if (!Number.isSafeInteger(payload.exp)) return null;
  const exp = Number(payload.exp);
  if (exp <= nowSeconds || exp > nowSeconds + MAX_FUTURE_SECONDS) return null;
  return {
    version: MEMO_DISPLAY_PERMIT_VERSION,
    familyId: payload.familyId,
    senderUserId: payload.senderUserId,
    recipientUserId: payload.recipientUserId,
    pushId: payload.pushId,
    targetChildUserId: payload.targetChildUserId,
    exp,
  };
}

async function importHmacKey(
  secret: string,
  usage: Array<"sign" | "verify">,
): Promise<CryptoKey | null> {
  if (!secret || secret.length > MAX_SECRET_LENGTH) return null;
  try {
    return await crypto.subtle.importKey(
      "raw",
      utf8.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      usage,
    );
  } catch {
    return null;
  }
}

export async function createMemoDisplayPermit(
  secret: string,
  input: MemoDisplayPermitInput,
  nowMs = Date.now(),
): Promise<string | null> {
  const nowSeconds = Math.floor(nowMs / 1000);
  if (!Number.isSafeInteger(nowSeconds)) return null;
  const payload = validatePayload({
    version: MEMO_DISPLAY_PERMIT_VERSION,
    familyId: input.familyId,
    senderUserId: input.senderUserId,
    recipientUserId: input.recipientUserId,
    pushId: input.pushId,
    targetChildUserId: input.targetChildUserId,
    exp: nowSeconds + MEMO_DISPLAY_PERMIT_TTL_SECONDS,
  }, nowSeconds);
  if (!payload) return null;

  const key = await importHmacKey(secret, ["sign"]);
  if (!key) return null;
  try {
    const encodedPayload = bytesToBase64Url(utf8.encode(JSON.stringify(payload)));
    const signedValue = `mdp1.${encodedPayload}`;
    const signature = new Uint8Array(await crypto.subtle.sign(
      "HMAC",
      key,
      utf8.encode(signedValue),
    ));
    const permit = `${signedValue}.${bytesToBase64Url(signature)}`;
    return permit.length <= MAX_PERMIT_LENGTH ? permit : null;
  } catch {
    return null;
  }
}

export async function verifyMemoDisplayPermit(
  secret: string,
  permit: string,
  nowMs = Date.now(),
): Promise<MemoDisplayPermitPayload | null> {
  if (typeof permit !== "string" || permit.length < 1 || permit.length > MAX_PERMIT_LENGTH) return null;
  const parts = permit.split(".");
  if (parts.length !== 3 || parts[0] !== "mdp1") return null;
  const payloadBytes = base64UrlToBytes(parts[1]);
  const signature = base64UrlToBytes(parts[2]);
  if (!payloadBytes || !signature || signature.length !== 32) return null;

  const key = await importHmacKey(secret, ["verify"]);
  if (!key) return null;
  try {
    const nowSeconds = Math.floor(nowMs / 1000);
    if (!Number.isSafeInteger(nowSeconds)) return null;
    const validSignature = await crypto.subtle.verify(
      "HMAC",
      key,
      signature,
      utf8.encode(`mdp1.${parts[1]}`),
    );
    if (!validSignature) return null;
    const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(payloadBytes));
    return validatePayload(parsed, nowSeconds);
  } catch {
    return null;
  }
}

/**
 * 표시 직전의 현재 가족 관계와 양방향 차단을 단일 D1 statement에서 다시 읽는다.
 * 서명 payload는 라우팅 힌트일 뿐이며 DB 정본이 허용하지 않으면 항상 false다.
 */
export async function isMemoDisplayPermitAllowed(
  db: D1Database,
  payload: MemoDisplayPermitPayload,
): Promise<boolean> {
  const row = await db.prepare(
    `SELECT CASE WHEN
       EXISTS(SELECT 1 FROM families WHERE id=?1)
       AND (
         EXISTS(
           SELECT 1 FROM family_members
            WHERE family_id=?1 AND user_id=?2 AND role='parent' AND is_active=1
         )
         OR EXISTS(SELECT 1 FROM families WHERE id=?1 AND parent_id=?2)
         OR (
           ?2=?4 AND EXISTS(
             SELECT 1 FROM family_members
              WHERE family_id=?1 AND user_id=?2 AND role='child' AND is_active=1
           )
         )
       )
       AND (
         EXISTS(
           SELECT 1 FROM family_members
            WHERE family_id=?1 AND user_id=?3 AND role='parent' AND is_active=1
         )
         OR EXISTS(SELECT 1 FROM families WHERE id=?1 AND parent_id=?3)
         OR (
           ?3=?4 AND EXISTS(
             SELECT 1 FROM family_members
              WHERE family_id=?1 AND user_id=?3 AND role='child' AND is_active=1
           )
         )
       )
       AND EXISTS(
         SELECT 1 FROM family_members
          WHERE family_id=?1 AND user_id=?4 AND role='child' AND is_active=1
       )
       AND NOT EXISTS(
         SELECT 1 FROM user_interaction_blocks
          WHERE family_id=?1
            AND (
              (blocker_user_id=?2 AND blocked_user_id=?3)
              OR (blocker_user_id=?3 AND blocked_user_id=?2)
            )
       )
      THEN 1 ELSE 0 END AS allowed`,
  ).bind(
    payload.familyId,
    payload.senderUserId,
    payload.recipientUserId,
    payload.targetChildUserId,
  ).first<{ allowed: number | boolean | null }>();
  return row?.allowed === 1 || row?.allowed === true;
}

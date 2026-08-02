import { pgTs } from "./time";

export type OAuthClientKind = "native" | "web";
export type OAuthFlowMode = "login" | "link";

const NATIVE_REDIRECT_TARGET = "https://hyeni-calendar.pages.dev/oauth/callback";
const WEB_REDIRECT_ORIGINS = new Set([
  "https://hyeni-calendar.pages.dev",
]);
const TRANSACTION_TTL_MS = 10 * 60 * 1000;
const MAX_STATE_LENGTH = 256;
const MAX_TRANSACTION_SECRET_LENGTH = 256;
const MAX_AUTHORIZATION_CODE_LENGTH = 8_192;

function isBoundedValue(value: string, maxLength: number): boolean {
  return value.length > 0 && value.length <= maxLength;
}

export interface OAuthTransactionInput {
  provider: string;
  clientKind: OAuthClientKind;
  webOrigin?: string | null;
  flowMode: OAuthFlowMode;
  userId?: string | null;
}

export interface OAuthCallbackTransaction {
  redirectTarget: string;
  flowMode: OAuthFlowMode;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function createOAuthStateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export async function hashOAuthSecret(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

export function resolveOAuthRedirectTarget(
  clientKind: OAuthClientKind,
  webOrigin?: string | null,
): string | null {
  if (clientKind === "native") return NATIVE_REDIRECT_TARGET;
  const raw = String(webOrigin ?? "").trim();
  if (!WEB_REDIRECT_ORIGINS.has(raw)) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.origin !== raw || parsed.pathname !== "/" || parsed.search || parsed.hash) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

export function parseOAuthPrepareBody(value: unknown): {
  clientKind: OAuthClientKind;
  webOrigin: string | null;
} | null {
  if (!value || typeof value !== "object") return null;
  const body = value as { client?: unknown; webOrigin?: unknown };
  if (body.client !== "native" && body.client !== "web") return null;
  const webOrigin = typeof body.webOrigin === "string" ? body.webOrigin.trim() : null;
  if (!resolveOAuthRedirectTarget(body.client, webOrigin)) return null;
  return { clientKind: body.client, webOrigin };
}

export async function createOAuthTransaction(
  db: D1Database,
  input: OAuthTransactionInput,
  now = new Date(),
): Promise<{
  state: string;
  transactionSecret: string;
  redirectTarget: string;
  expiresAt: string;
}> {
  const redirectTarget = resolveOAuthRedirectTarget(input.clientKind, input.webOrigin);
  if (!redirectTarget) throw new Error("oauth_redirect_target_invalid");
  if (input.flowMode === "link" && !input.userId) throw new Error("oauth_link_user_missing");
  if (input.flowMode === "login" && input.userId) throw new Error("oauth_login_user_forbidden");

  const state = createOAuthStateToken();
  const transactionSecret = createOAuthStateToken();
  const stateHash = await hashOAuthSecret(state);
  const transactionSecretHash = await hashOAuthSecret(transactionSecret);
  const createdAt = pgTs(now);
  const expiresDate = new Date(now.getTime() + TRANSACTION_TTL_MS);
  const expiresAt = pgTs(expiresDate);
  await db.prepare(
    `INSERT INTO oauth_state_transactions
      (state_hash, transaction_secret_hash, provider, client_kind, redirect_target, flow_mode, user_id,
       authorization_code_hash, callback_received_at, consumed_at, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`,
  ).bind(
    stateHash,
    transactionSecretHash,
    input.provider,
    input.clientKind,
    redirectTarget,
    input.flowMode,
    input.userId ?? null,
    createdAt,
    expiresAt,
  ).run();

  // 운영 중 무한 누적을 막되, 생성 성공 자체는 정리 실패와 분리한다.
  try {
    await db.prepare(
      "DELETE FROM oauth_state_transactions WHERE expires_at < ? OR (consumed_at IS NOT NULL AND consumed_at < ?)",
    ).bind(
      createdAt,
      pgTs(new Date(now.getTime() - 24 * 60 * 60 * 1000)),
    ).run();
  } catch (error) {
    console.error("oauth state cleanup failed");
  }
  return { state, transactionSecret, redirectTarget, expiresAt: expiresDate.toISOString() };
}

export async function markOAuthCallback(
  db: D1Database,
  provider: string,
  state: string,
  code: string,
  now = new Date(),
): Promise<OAuthCallbackTransaction | null> {
  if (
    !isBoundedValue(state, MAX_STATE_LENGTH)
    || !isBoundedValue(code, MAX_AUTHORIZATION_CODE_LENGTH)
  ) return null;
  const stateHash = await hashOAuthSecret(state);
  const codeHash = await hashOAuthSecret(code);
  const nowTs = pgTs(now);
  await db.prepare(
    `UPDATE oauth_state_transactions
        SET authorization_code_hash=?, callback_received_at=?
      WHERE state_hash=? AND provider=? AND expires_at>?
        AND consumed_at IS NULL AND authorization_code_hash IS NULL`,
  ).bind(codeHash, nowTs, stateHash, provider, nowTs).run();
  const row = await db.prepare(
    `SELECT redirect_target, flow_mode
       FROM oauth_state_transactions
      WHERE state_hash=? AND provider=? AND authorization_code_hash=?
        AND callback_received_at IS NOT NULL AND consumed_at IS NULL AND expires_at>?`,
  ).bind(stateHash, provider, codeHash, nowTs).first<{
    redirect_target: string;
    flow_mode: OAuthFlowMode;
  }>();
  if (!row || (row.flow_mode !== "login" && row.flow_mode !== "link")) return null;
  return { redirectTarget: row.redirect_target, flowMode: row.flow_mode };
}

export async function cancelOAuthTransaction(
  db: D1Database,
  provider: string,
  state: string,
  now = new Date(),
): Promise<OAuthCallbackTransaction | null> {
  if (!isBoundedValue(state, MAX_STATE_LENGTH)) return null;
  const stateHash = await hashOAuthSecret(state);
  const nowTs = pgTs(now);
  const row = await db.prepare(
    `SELECT redirect_target, flow_mode
       FROM oauth_state_transactions
      WHERE state_hash=? AND provider=? AND consumed_at IS NULL AND expires_at>?`,
  ).bind(stateHash, provider, nowTs).first<{
    redirect_target: string;
    flow_mode: OAuthFlowMode;
  }>();
  if (!row || (row.flow_mode !== "login" && row.flow_mode !== "link")) return null;
  const canceled = await db.prepare(
    `UPDATE oauth_state_transactions SET consumed_at=?
      WHERE state_hash=? AND provider=? AND consumed_at IS NULL AND expires_at>?`,
  ).bind(nowTs, stateHash, provider, nowTs).run();
  if (Number(canceled.meta?.changes ?? 0) !== 1) return null;
  return { redirectTarget: row.redirect_target, flowMode: row.flow_mode };
}

export async function consumeOAuthTransaction(
  db: D1Database,
  input: {
    provider: string;
    state: string;
    code: string;
    transactionSecret: string;
    flowMode: OAuthFlowMode;
    userId?: string | null;
  },
  now = new Date(),
): Promise<boolean> {
  if (
    !isBoundedValue(input.state, MAX_STATE_LENGTH)
    || !isBoundedValue(input.code, MAX_AUTHORIZATION_CODE_LENGTH)
    || !isBoundedValue(input.transactionSecret, MAX_TRANSACTION_SECRET_LENGTH)
  ) return false;
  if (input.flowMode === "link" && !input.userId) return false;
  const stateHash = await hashOAuthSecret(input.state);
  const codeHash = await hashOAuthSecret(input.code);
  const transactionSecretHash = await hashOAuthSecret(input.transactionSecret);
  const nowTs = pgTs(now);
  const userClause = input.flowMode === "link" ? "AND user_id=?" : "AND user_id IS NULL";
  const statement = db.prepare(
    `UPDATE oauth_state_transactions SET consumed_at=?
      WHERE state_hash=? AND provider=? AND flow_mode=?
        AND authorization_code_hash=? AND transaction_secret_hash=?
        AND callback_received_at IS NOT NULL
        AND consumed_at IS NULL AND expires_at>? ${userClause}`,
  );
  const result = input.flowMode === "link"
    ? await statement.bind(
        nowTs,
        stateHash,
        input.provider,
        input.flowMode,
        codeHash,
        transactionSecretHash,
        nowTs,
        input.userId,
      ).run()
    : await statement.bind(
        nowTs,
        stateHash,
        input.provider,
        input.flowMode,
        codeHash,
        transactionSecretHash,
        nowTs,
      ).run();
  return Number(result.meta?.changes ?? 0) === 1;
}

export function appendOAuthCallbackQuery(
  redirectTarget: string,
  input: { provider: string; code?: string; state?: string; error?: string },
): string {
  const query = new URLSearchParams({ provider: input.provider });
  if (input.code) query.set("code", input.code);
  if (input.state) query.set("state", input.state);
  if (input.error) query.set("error", input.error);
  return `${redirectTarget}${redirectTarget.includes("?") ? "&" : "?"}${query.toString()}`;
}

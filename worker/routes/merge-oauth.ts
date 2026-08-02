// POST /api/account/merge-oauth  ← supabase/functions/merge-oauth-into-phone (직역).
// OAuth(카카오/구글) identity 를 기존 phone user 로 이전. 클라가 phone OTP 재인증을
// 마친 뒤 호출하며, caller 의 JWT(phone 세션)가 신뢰 anchor 다.
//
// 인증: requireAuth → phoneUserId = sub. (원본 service_role + auth.admin 경로는 Worker
//   엔 GoTrue 가 없으므로 D1 users/auth_identities 직접 조작으로 직역.)
//
// 원본 transfer_oauth_identity(SECURITY DEFINER RPC) + auth.admin.deleteUser 를
// D1 직접 write 로 직역:
//   1) auth_identities(provider, provider_id PK) 의 user_id 를 oauth→phone 으로 UPDATE
//   2) 고아가 된 oauth-only user 의 auth row(refresh/identities/users) 삭제
//      (GoTrue deleteUser 의 auth-schema 한정 삭제 범위 미러 — 앱 데이터는 건드리지 않음).
// delete-account 의 deleteAuthUserStmts 패턴(account.ts) 재사용.
import { Hono } from "hono";
import type { Env, Vars } from "../types";
import { requireAuth } from "../middleware/auth";

const mergeOauth = new Hono<{ Bindings: Env; Variables: Vars }>();

const ALLOWED_PROVIDERS = new Set(["kakao", "google"]);

mergeOauth.post("/merge-oauth", requireAuth, async (c) => {
  const db = c.env.DB;
  const phoneUserId = c.get("user").sub;

  let body: { oauth_user_id?: unknown; provider?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid_json" }, 400);
  }
  const oauthUserId = typeof body.oauth_user_id === "string" ? body.oauth_user_id : "";
  const provider = typeof body.provider === "string" ? body.provider : "";
  if (!oauthUserId) return c.json({ ok: false, error: "missing_oauth_user_id" }, 400);
  if (!provider || !ALLOWED_PROVIDERS.has(provider)) {
    return c.json({ ok: false, error: "unsupported_provider" }, 400);
  }
  if (oauthUserId === phoneUserId) return c.json({ ok: false, error: "same_user" }, 400);

  // 3a. oauth user 존재 확인.
  const oauthUser = await db.prepare("SELECT id FROM users WHERE id = ? LIMIT 1").bind(oauthUserId).first<{ id: string }>();
  if (!oauthUser) return c.json({ ok: false, error: "oauth_user_not_found" }, 404);

  // oauth user 가 해당 provider identity 를 보유하는지(원본 transfer RPC 의 count 검증).
  const oauthIdentity = await db
    .prepare("SELECT provider_id FROM auth_identities WHERE user_id = ? AND provider = ? LIMIT 1")
    .bind(oauthUserId, provider)
    .first<{ provider_id: string }>();
  if (!oauthIdentity) return c.json({ ok: false, error: "oauth_identity_missing" }, 409);

  // 3b. phone user 존재 확인.
  const phoneUser = await db.prepare("SELECT id FROM users WHERE id = ? LIMIT 1").bind(phoneUserId).first<{ id: string }>();
  if (!phoneUser) return c.json({ ok: false, error: "phone_user_not_found" }, 404);

  // phone user 가 이미 같은 provider 를 연결했으면 중단(RPC 의 already_has_provider).
  const conflicting = await db
    .prepare("SELECT provider_id FROM auth_identities WHERE user_id = ? AND provider = ? LIMIT 1")
    .bind(phoneUserId, provider)
    .first<{ provider_id: string }>();
  if (conflicting) return c.json({ ok: false, error: "phone_user_already_linked" }, 409);

  // 3c+3d. transfer + 고아 user 삭제를 단일 batch(트랜잭션)로 — 부분 실패 제거.
  //   transfer 가 먼저라 옮겨진 row 는 user_id=phoneUserId 가 되어 이후 oauth 삭제에서 살아남는다.
  try {
    await db.batch([
      db.prepare("UPDATE auth_identities SET user_id = ? WHERE user_id = ? AND provider = ?").bind(phoneUserId, oauthUserId, provider),
      db.prepare("DELETE FROM refresh_tokens WHERE user_id = ?").bind(oauthUserId),
      db.prepare("DELETE FROM auth_identities WHERE user_id = ?").bind(oauthUserId),
      db.prepare("DELETE FROM users WHERE id = ?").bind(oauthUserId),
    ]);
  } catch (e) {
    console.error("merge-oauth: transfer failed");
    return c.json({ ok: false, error: "transfer_failed" }, 500);
  }

  return c.json({ ok: true, linked: true, provider });
});

export default mergeOauth;

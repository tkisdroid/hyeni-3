// /api/auth/oauth-bridge/*  — OAuth(카카오/구글) 신규 user 가 기존 전화 계정과 연결할 때
// 본인 확인용 전화 OTP 브리지(P3). 원본 Supabase GoTrue signInWithOtp/verifyOtp(SMS)를
// Worker 자체 OTP(phone_otp 테이블 + NCP SENS 발송)로 직역.
//
// 브리지 흐름(OAuthBridgeScreen, 모두 OAuth 세션 JWT 로 인증):
//   1) POST /find-user   { phone } → { user_id|null }   (find_user_by_phone RPC 직역)
//   2) POST /send-otp    { phone } → {ok} | 404 no_account | 429 rate_limited | 503
//        전화→6자리 생성→HMAC 해시로 phone_otp 저장→NCP SENS 발송(send-sms 와 동일 sender 재사용).
//   3) POST /verify-otp  { phone, token } → { userId, user, session }
//        OTP 대조(만료/시도 체크)→ 전화 user(=기존 계정) 의 ES256 세션 발급(supabase verifyOtp 의
//        "세션 전환" 미러). 클라가 이 세션으로 전환하면 후속 merge-oauth 가 전화 user JWT 로 인증된다.
//   4) POST /mark-linked { user_id, provider, payload } → {ok}  (mark_linked_provider RPC 직역,
//        auth.uid()=caller 게이트). 멱등 marker → 다음 OAuth 로그인은 브리지를 건너뛴다.
//   5) POST /mark-signup-complete { provider, payload } → {ok,user}
//        기존 전화 계정 연결이 아니라 OAuth 신규 가입을 선택한 경우 raw_user_meta_data 에
//        linked_providers marker 를 남긴다. 다음 cold start / OAuth 로그인 때 bridge 를 반복하지 않는다.
//
// 전화 primary linking 모델(merge-oauth)과 일관: 기존 전화 계정이 anchor 이고, OAuth identity 는
// 그 계정으로 이전된다(verify 가 OAuth user 가 아니라 "전화 user" 세션을 발급하는 이유).
//
// 보안: code 평문 저장 금지(lib/otp HMAC) · 만료(5분) · 시도 제한(5) · 재발송 cooldown(60초).
//   NCP SENS 키 미설정이면 503 graceful(send-sms 와 동일).
// OTP 발송/검증·전화 정규화는 lib/phoneOtp·lib/phone 으로 추출해 가입(auth signup)과 공유한다.
import { Hono } from "hono";
import type { Env, Vars, AuthUser } from "../types";
import { requireAuth } from "../middleware/auth";
import { signAccessToken } from "../lib/jwt";
import { issueRefreshToken, isRefreshTokenIssuanceBlocked } from "../lib/refresh";
import { resolveCanonicalFamilyMembership } from "../db/authz";
import { pgNow } from "../lib/time";
import { parsePhone } from "../lib/phone";
import { sendPhoneOtp, verifyPhoneOtp } from "../lib/phoneOtp";

const bridge = new Hono<{ Bindings: Env; Variables: Vars }>();

// 전화 user = 부모. family_members 에 child 로 있으면 child, 아니면 parent(auth.ts resolveRole 직역).
async function resolveRole(db: D1Database, uid: string): Promise<AuthUser["role"]> {
  const rm = await db.prepare("SELECT role FROM family_members WHERE user_id=? AND is_active=1 AND role IN ('parent','child') LIMIT 1").bind(uid).first<{ role: string }>();
  if (rm?.role === "child") return "child";
  return "parent";
}

// 전화 → 기존 user_id 해소(find_user_by_phone: user_profiles.phone 매칭).
async function findUserIdByPhone(db: D1Database, phone: string): Promise<string | null> {
  const row = await db.prepare("SELECT user_id FROM user_profiles WHERE phone=? LIMIT 1").bind(phone).first<{ user_id: string }>();
  return row?.user_id ? String(row.user_id) : null;
}

// 1) 전화로 기존 계정 존재 확인(find_user_by_phone RPC 직역). 존재(uuid)만 노출.
bridge.post("/oauth-bridge/find-user", requireAuth, async (c) => {
  let body: { phone?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const phone = parsePhone(body?.phone);
  if (!phone) return c.json({ error: "invalid_phone" }, 400);
  const userId = await findUserIdByPhone(c.env.DB, phone);
  return c.json({ user_id: userId });
});

// 2) OTP 발송 — 6자리 생성 → HMAC 해시 저장(평문 금지) → NCP SENS 발송.
bridge.post("/oauth-bridge/send-otp", requireAuth, async (c) => {
  const db = c.env.DB;
  let body: { phone?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const phone = parsePhone(body?.phone);
  if (!phone) return c.json({ error: "invalid_phone" }, 400);

  // shouldCreateUser:false 미러 — 기존 계정이 없으면 OTP 발송하지 않는다.
  const targetUserId = await findUserIdByPhone(db, phone);
  if (!targetUserId) return c.json({ error: "no_account" }, 404);

  // 발송 자체는 공유 모듈(키 체크·rate limit·HMAC 저장·NCP SENS)에 위임.
  const sent = await sendPhoneOtp(db, c.env, phone);
  if (!sent.ok) {
    if (sent.retryAfter) c.header("Retry-After", sent.retryAfter);
    return c.json({ error: sent.error }, (sent.status ?? 500) as 429 | 503 | 500);
  }
  return c.json({ ok: true });
});

// 3) OTP 검증 → 전화 user(기존 계정) 의 ES256 세션 발급.
bridge.post("/oauth-bridge/verify-otp", requireAuth, async (c) => {
  const db = c.env.DB;
  let body: { phone?: unknown; token?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const phone = parsePhone(body?.phone);
  if (!phone) return c.json({ error: "invalid_phone" }, 400);
  const token = String(body?.token ?? "").replace(/\D/g, "");
  if (!/^\d{6}$/.test(token)) return c.json({ error: "invalid_token_format" }, 400);

  // 검증·소비는 공유 모듈에 위임(만료/시도제한/상수시간 대조 → 1회용 소비).
  const verified = await verifyPhoneOtp(db, c.env, phone, token);
  if (!verified.ok) {
    return c.json({ error: verified.error }, (verified.status ?? 401) as 401 | 429);
  }

  // 전화 user 해소(find_user_by_phone 와 동일 — 기존 계정).
  const userId = await findUserIdByPhone(db, phone);
  if (!userId) return c.json({ error: "no_account" }, 404);

  // 전화 user 세션 발급(supabase verifyOtp 세션 전환 미러). 후속 merge-oauth 가 이 JWT 로 인증된다.
  const canonicalFamily = await resolveCanonicalFamilyMembership(db, userId);
  const familyId = canonicalFamily?.familyId ?? null;
  const role = canonicalFamily?.role ?? await resolveRole(db, userId);
  const user: AuthUser = { sub: userId, role, family_id: familyId, is_anonymous: false };
  const accessToken = await signAccessToken(c.env, user);
  let refreshToken: string;
  try {
    refreshToken = await issueRefreshToken(db, userId, familyId);
  } catch (error) {
    if (isRefreshTokenIssuanceBlocked(error)) {
      return c.json({ error: "account_deletion_in_progress" }, 409);
    }
    throw error;
  }

  const metaRow = await db.prepare("SELECT raw_user_meta_data FROM users WHERE id=? LIMIT 1").bind(userId).first<{ raw_user_meta_data: string | null }>();
  let userMeta: Record<string, unknown> = {};
  try {
    userMeta = metaRow?.raw_user_meta_data ? JSON.parse(metaRow.raw_user_meta_data) : {};
  } catch {
    userMeta = {};
  }

  return c.json({
    userId,
    // phone 이 채워진 phone-primary user → 클라 getOAuthUserNeedsBridge=false(브리지 종료).
    user: {
      id: userId,
      role,
      family_id: familyId,
      phone,
      is_anonymous: false,
      app_metadata: { provider: "phone" },
      user_metadata: userMeta,
    },
    session: { access_token: accessToken, refresh_token: refreshToken, token_type: "bearer" },
  });
});

// 4) provider linking 멱등 marker(mark_linked_provider RPC 직역, auth.uid()=caller 게이트).
bridge.post("/oauth-bridge/mark-linked", requireAuth, async (c) => {
  const db = c.env.DB;
  const callerId = c.get("user").sub;

  let body: { user_id?: unknown; provider?: unknown; payload?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const userId = typeof body?.user_id === "string" ? body.user_id : "";
  const provider = typeof body?.provider === "string" ? body.provider : "";
  const payload = body?.payload && typeof body.payload === "object" ? (body.payload as Record<string, unknown>) : {};
  if (!userId || !provider) return c.json({ error: "missing_params" }, 400);
  // auth.uid() 게이트 미러 — 본인만 자신의 marker 갱신.
  if (userId !== callerId) return c.json({ error: "forbidden" }, 403);

  // select-then-write — linked_providers JSON 병합(postgres jsonb || 연산 미러).
  const row = await db.prepare("SELECT linked_providers FROM user_profiles WHERE user_id=? LIMIT 1").bind(userId).first<{ linked_providers: string | null }>();
  if (!row) return c.json({ error: "profile_not_found" }, 404);
  let linked: Record<string, unknown> = {};
  try {
    linked = row.linked_providers ? JSON.parse(row.linked_providers) : {};
  } catch {
    linked = {};
  }
  const merged = { ...linked, [provider]: payload };
  await db.prepare("UPDATE user_profiles SET linked_providers=?, updated_at=? WHERE user_id=?").bind(JSON.stringify(merged), pgNow(), userId).run();
  return c.json({ ok: true });
});

// 5) OAuth 신규 가입 완료 marker. user_profiles 가 아직 없는 OAuth-only 계정도
// raw_user_meta_data 는 users row 에 있으므로, 가입/가족 설정 전 cold start 에서도 유지된다.
bridge.post("/oauth-bridge/mark-signup-complete", requireAuth, async (c) => {
  const db = c.env.DB;
  const caller = c.get("user");
  const callerId = caller.sub;

  let body: { provider?: unknown; payload?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const provider = typeof body?.provider === "string" ? body.provider : "";
  if (provider !== "kakao" && provider !== "google") {
    return c.json({ error: "unsupported_provider" }, 400);
  }
  const payload = body?.payload && typeof body.payload === "object"
    ? (body.payload as Record<string, unknown>)
    : {};

  const row = await db
    .prepare("SELECT phone, raw_user_meta_data FROM users WHERE id=? LIMIT 1")
    .bind(callerId)
    .first<{ phone: string | null; raw_user_meta_data: string | null }>();
  if (!row) return c.json({ error: "user_not_found" }, 404);

  let meta: Record<string, unknown> = {};
  try {
    meta = row.raw_user_meta_data ? JSON.parse(row.raw_user_meta_data) : {};
  } catch {
    meta = {};
  }
  const linked = meta.linked_providers && typeof meta.linked_providers === "object"
    ? (meta.linked_providers as Record<string, unknown>)
    : {};
  const marker = {
    mode: "oauth-signup",
    signupAt: new Date().toISOString(),
    ...payload,
  };
  const mergedMeta = {
    ...meta,
    provider: meta.provider || provider,
    linked_providers: {
      ...linked,
      [provider]: marker,
    },
  };

  await db
    .prepare("UPDATE users SET raw_user_meta_data=? WHERE id=?")
    .bind(JSON.stringify(mergedMeta), callerId)
    .run();

  const canonicalFamily = await resolveCanonicalFamilyMembership(db, callerId, caller.family_id ?? null);
  const familyId = canonicalFamily?.familyId ?? null;
  const role = canonicalFamily?.role ?? await resolveRole(db, callerId);
  return c.json({
    ok: true,
    user: {
      id: callerId,
      role,
      family_id: familyId,
      phone: row.phone ?? null,
      is_anonymous: false,
      app_metadata: { provider },
      identities: [{ provider }],
      user_metadata: mergedMeta,
    },
  });
});

export default bridge;

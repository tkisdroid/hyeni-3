// /api/auth/naver  ← supabase/functions/naver-auth (직역).
// Naver OAuth 콜백 핸들러(부모 로그인). Naver 는 빌트인 provider 가 아니라 커스텀.
//
// GET  /api/auth/naver  — Naver 가 redirect_uri 로 호출 → deep link/origin 으로 재리다이렉트
//                         (code/state 동봉). 원본 HTML 리다이렉트 직역(Supabase 의존 없음).
// POST /api/auth/naver  — { code, state, redirect_uri } → Naver token 교환 → 프로필 →
//                         D1 user 해소(auth_identities provider='naver') → Worker 세션 발급.
//
// ⚠ 원본 대비 변경(세션 모델): 원본은 Supabase admin.generateLink(magiclink) 로 일회용 토큰을
//   반환 → 클라가 supabase.verifyOtp 로 세션 활성화. Worker 엔 GoTrue magiclink 가 없으므로,
//   대신 ES256 access + opaque refresh 세션을 직접 발급해 { user, session } 으로 반환한다
//   (auth.ts 의 login-password 응답 형태 미러). 클라 시임(auth.js finishNaverLogin)이
//   isApiEnabled 분기에서 이 세션을 적용한다. 원본 호환 필드(email/name/user_id)도 함께 반환.
//
// 외부키 graceful: NAVER_CLIENT_ID/SECRET 미설정이면 503 naver_not_configured(원본 보존).
import { Hono } from "hono";
import type { Env, Vars, AuthUser } from "../types";
import { signAccessToken } from "../lib/jwt";
import { issueRefreshToken, isRefreshTokenIssuanceBlocked } from "../lib/refresh";
import { insertAuthIdentityForCurrentUser } from "../lib/authIdentity";
import { decideOAuthLink, oauthConflictMessage } from "../lib/oauthLink";
import { resolveCanonicalFamilyMembership } from "../db/authz";
import { pgNow } from "../lib/time";
import {
  appendOAuthCallbackQuery,
  cancelOAuthTransaction,
  consumeOAuthTransaction,
  markOAuthCallback,
} from "../lib/oauthState";
import { invalidOAuthCallbackResponse, oauthCallbackResponse } from "../lib/oauthCallbackPage";
import { writeOperationalLog } from "../lib/safeOperationalLog";

// 추가 Secret(메인이 types.ts 로 승격).
type NaverEnv = Env & {
  NAVER_CLIENT_ID?: string;
  NAVER_CLIENT_SECRET?: string;
};

const NAVER_TOKEN_URL = "https://nid.naver.com/oauth2.0/token";
const NAVER_PROFILE_URL = "https://openapi.naver.com/v1/nid/me";

interface NaverTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}
interface NaverProfileResponse {
  resultcode?: string;
  message?: string;
  response?: {
    id?: string;
    email?: string;
    name?: string;
    nickname?: string;
    profile_image?: string;
  };
}

const naver = new Hono<{ Bindings: Env; Variables: Vars }>();

// naver = 부모. family_members 에 child 로 있으면 child, 아니면 parent(auth.ts resolveRole 직역).
async function resolveRole(db: D1Database, uid: string): Promise<AuthUser["role"]> {
  const rm = await db.prepare("SELECT role FROM family_members WHERE user_id=? AND is_active=1 AND role IN ('parent','child') LIMIT 1").bind(uid).first<{ role: string }>();
  if (rm?.role === "child") return "child";
  return "parent";
}

// GET 콜백 — 서버 발급 state를 확인해 DB에 고정한 target으로만 복귀한다.
naver.get("/naver", async (c) => {
  const url = new URL(c.req.url);
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const providerError = url.searchParams.get("error") || "";
  const transaction = providerError
    ? await cancelOAuthTransaction(c.env.DB, "naver", state)
    : await markOAuthCallback(c.env.DB, "naver", state, code);
  if (!transaction) return invalidOAuthCallbackResponse();

  const targetUrl = appendOAuthCallbackQuery(transaction.redirectTarget, {
    provider: "naver",
    code: providerError ? undefined : code,
    state,
    error: providerError ? "oauth_cancelled" : undefined,
  });
  return oauthCallbackResponse("네이버", targetUrl);
});

naver.post("/naver", async (c) => {
  const db = c.env.DB;
  const env = c.env as NaverEnv;
  const clientId = env.NAVER_CLIENT_ID || "";
  const clientSecret = env.NAVER_CLIENT_SECRET || "";

  if (!clientId || !clientSecret) {
    return c.json({
      error: "naver_not_configured",
      message: "Naver 설정(NAVER_CLIENT_ID, NAVER_CLIENT_SECRET)이 등록되지 않았어요. 운영자에게 문의해 주세요.",
    }, 503);
  }

  let body: { code?: unknown; state?: unknown; transactionSecret?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const code = typeof body.code === "string" ? body.code : "";
  const state = typeof body.state === "string" ? body.state : "";
  const transactionSecret = typeof body.transactionSecret === "string" ? body.transactionSecret : "";
  if (!code || !state || !transactionSecret) {
    return c.json({ error: "missing_params", required: ["code", "state", "transactionSecret"] }, 400);
  }

  const claimed = await consumeOAuthTransaction(db, {
    provider: "naver",
    code,
    state,
    transactionSecret,
    flowMode: "login",
  });
  if (!claimed) return c.json({ error: "invalid_oauth_transaction" }, 400);

  // 1. code → access_token.
  const tokenParams = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    code,
    state,
  });
  let tokenResp: Response;
  try {
    tokenResp = await fetch(`${NAVER_TOKEN_URL}?${tokenParams.toString()}`, { method: "GET", headers: { Accept: "application/json" } });
  } catch {
    writeOperationalLog("error", "naver_token_fetch_failed", { provider: "naver" });
    return c.json({ error: "token_exchange_failed" }, 502);
  }
  if (!tokenResp.ok) {
    return c.json({ error: "token_exchange_failed", status: tokenResp.status }, 502);
  }
  const tokenData = await tokenResp.json() as NaverTokenResponse;
  if (tokenData.error || !tokenData.access_token) {
    return c.json({ error: "token_exchange_rejected" }, 401);
  }

  // 2. 프로필.
  let profileResp: Response;
  try {
    profileResp = await fetch(NAVER_PROFILE_URL, { headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: "application/json" } });
  } catch {
    writeOperationalLog("error", "naver_profile_fetch_failed", { provider: "naver" });
    return c.json({ error: "profile_fetch_failed" }, 502);
  }
  if (!profileResp.ok) {
    return c.json({ error: "profile_fetch_failed", status: profileResp.status }, 502);
  }
  const profile = await profileResp.json() as NaverProfileResponse;
  const naverUser = profile?.response;
  if (profile?.resultcode !== "00" || !naverUser?.id) {
    return c.json({ error: "profile_invalid" }, 502);
  }

  const naverId = naverUser.id;
  const emailIsFallback = !naverUser.email;
  const email = naverUser.email || `naver-${naverId}@hyeni.local`;
  const displayName = naverUser.name || naverUser.nickname || "";

  // 3. user 해소 — 본인 anchor = naver_id(auth_identities provider='naver', provider_id=naverId).
  //    원본 auth_user_id_by_naver_id RPC(raw_user_meta_data 인덱스) 대신 D1 auth_identities 조회.
  const identity = await db
    .prepare("SELECT user_id FROM auth_identities WHERE provider='naver' AND provider_id=? LIMIT 1")
    .bind(naverId)
    .first<{ user_id: string }>();

  let userId: string;
  if (identity?.user_id) {
    // 기존 네이버 사용자 재로그인. 메타데이터 best-effort 최신화.
    userId = String(identity.user_id);
    try {
      const existing = await db.prepare("SELECT raw_user_meta_data FROM users WHERE id=? LIMIT 1").bind(userId).first<{ raw_user_meta_data: string | null }>();
      let meta: Record<string, unknown> = {};
      try { meta = existing?.raw_user_meta_data ? JSON.parse(existing.raw_user_meta_data) : {}; } catch { meta = {}; }
      const merged = {
        ...meta,
        provider: "naver",
        naver_id: naverId,
        name: displayName || meta.name || "",
        nickname: naverUser.nickname || meta.nickname || null,
        avatar_url: naverUser.profile_image || meta.avatar_url || null,
      };
      await db.prepare("UPDATE users SET raw_user_meta_data=? WHERE id=?").bind(JSON.stringify(merged), userId).run();
    } catch (e) {
      console.error("naver-auth: metadata update failed");
    }
  } else {
    // 신규 identity — 같은 이메일 계정이 있으면 거부가 아니라 연결(link). oauth.ts 와 동일 정책.
    // 네이버는 별도 email_verified 필드를 주지 않는다. 네이버 계정 이메일은 가입 시 본인확인을 거치므로
    // 실제 이메일(폴백 아님)이 온 경우에만 검증된 것으로 본다.
    const emailOwner = await db
      .prepare("SELECT id, is_anonymous FROM users WHERE email=? LIMIT 1")
      .bind(email)
      .first<{ id: string; is_anonymous: number | null }>();
    const decision = decideOAuthLink({
      emailIsFallback,
      emailVerified: !emailIsFallback,
      owner: emailOwner ? { id: String(emailOwner.id), isAnonymous: !!emailOwner.is_anonymous } : null,
    });
    if (decision.kind === "conflict") {
      writeOperationalLog("error", "naver_email_conflict", { provider: "naver" });
      return c.json(
        { error: "email_conflict_other_account", reason: decision.reason, message: oauthConflictMessage(decision.reason) },
        409,
      );
    }

    const meta = {
      provider: "naver",
      naver_id: naverId,
      name: displayName,
      nickname: naverUser.nickname || null,
      avatar_url: naverUser.profile_image || null,
    };
    const identityData = JSON.stringify({ sub: naverId, email, name: displayName });

    if (decision.kind === "link") {
      userId = decision.userId;
      try {
        const inserted = await insertAuthIdentityForCurrentUser(db, {
          id: crypto.randomUUID(),
          userId,
          provider: "naver",
          providerId: naverId,
          identityData,
          createdAt: pgNow(),
        });
        if (!inserted) return c.json({ error: "account_deletion_in_progress" }, 409);
      } catch (e) {
        console.error("naver-auth: identity link failed");
        return c.json({ error: "identity_link_failed" }, 500);
      }
    } else {
      userId = crypto.randomUUID();
      try {
        await db.batch([
          db.prepare("INSERT INTO users (id, email, is_anonymous, raw_user_meta_data, created_at) VALUES (?,?,0,?,?)").bind(userId, email, JSON.stringify(meta), pgNow()),
          db.prepare("INSERT INTO auth_identities (id, user_id, provider, provider_id, identity_data, created_at) VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID(), userId, "naver", naverId, identityData, pgNow()),
        ]);
      } catch (e) {
        console.error("naver-auth: user create failed");
        return c.json({ error: "user_create_failed" }, 500);
      }
    }
  }

  // 4. Worker 세션 발급(magiclink 대체).
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

  return c.json({
    // 원본 호환 필드.
    email,
    name: displayName,
    user_id: userId,
    // Worker 세션(클라 시임이 적용).
    user: { id: userId, role, family_id: familyId, user_metadata: { provider: "naver", naver_id: naverId, name: displayName } },
    session: { access_token: accessToken, refresh_token: refreshToken, token_type: "bearer" },
  });
});

export default naver;

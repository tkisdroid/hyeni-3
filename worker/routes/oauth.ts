// /api/auth/oauth/:provider  — kakao/google OAuth(부모 로그인) Worker 이식 (P0-b).
// naver-auth.ts 패턴 직역. 원본은 Supabase 빌트인 provider 였다:
//   supabase.auth.signInWithOAuth({provider:'kakao'|'google'}) → Supabase /auth/v1/callback
//   이 code 교환 + auth.users 생성 + 세션 발급을 모두 대행 → redirectTo 로 세션 반환.
// Worker 엔 GoTrue 가 없으므로 그 dance 를 직접 수행한다:
//   provider token 교환 → userinfo → D1 user 해소(auth_identities) → ES256 세션 발급.
//
// 흐름(3 엔드포인트, 모두 /api/auth 하위):
//   GET  /api/auth/oauth/:provider/start     — 클라가 연다 → provider authorize 로 302.
//       client_id 시크릿이 서버에만 있으므로 클라가 authorize URL 을 직접 만들지 않는다
//       (kakao REST key 를 번들에 노출하지 않는 기존 정책 — kakao-proxy 와 일관).
//   GET  /api/auth/oauth/:provider/callback  — provider redirect_uri. deep link/origin 으로
//       재리다이렉트(provider/code/state 동봉). naver GET 핸들러 직역(Supabase 의존 없음).
//       ★ 이 URL 을 Kakao/Google 콘솔 redirect_uri 에 등록한다(운영은 사용자 후속).
//   POST /api/auth/oauth/:provider           — { code, state } → token 교환 → userinfo →
//       D1 user 해소 → { user, session } 반환(auth.ts login-password 응답 형태 미러).
//
// 세션 모델: naver-auth 와 동일(ES256 access + opaque refresh). 클라 시임 finishOAuthLogin 이
//   isApiEnabled 분기에서 applyApiSession + setApiUser 로 적용한다.
// 전화 primary + OAuth linking: 신규 OAuth user 는 phone 미보유 → 클라 getOAuthUserNeedsBridge
//   가 OAuthBridgeScreen 으로 라우팅(merge-oauth 로 기존 phone user 에 이전). 그래서 응답 user 에
//   app_metadata.provider / phone / user_metadata(linked_providers) 를 실어 브리지 게이트가
//   정상 동작하게 한다(merge-oauth·naver-auth 와 일관).
//
// graceful: client_id(또는 google client_secret) 미설정이면 503 oauth_not_configured.
import { Hono } from "hono";
import type { Context } from "hono";
import type { Env, Vars, AuthUser } from "../types";
import { isRefreshTokenIssuanceBlocked, normalizeDeviceId } from "../lib/refresh";
import { issueAccountSession } from "../lib/authSession";
import {
  isDeviceIdentityRequiredError,
} from "../lib/accountDeviceSession";
import { insertAuthIdentityForCurrentUser } from "../lib/authIdentity";
import {
  decideOAuthLink,
  decideOAuthUnlink,
  oauthConflictMessage,
  oauthUnlinkDenyMessage,
  readEmailVerified,
} from "../lib/oauthLink";
import { resolveCanonicalFamilyMembership } from "../db/authz";
import { requireAuth } from "../middleware/auth";
import { pgNow } from "../lib/time";
import {
  appendOAuthCallbackQuery,
  cancelOAuthTransaction,
  consumeOAuthTransaction,
  createOAuthTransaction,
  markOAuthCallback,
  parseOAuthPrepareBody,
  type OAuthFlowMode,
} from "../lib/oauthState";
import { attachOnboardingPreferences, parseOnboardingInterests } from "../lib/onboardingPreferences";
import { invalidOAuthCallbackResponse, oauthCallbackResponse } from "../lib/oauthCallbackPage";
import { writeOperationalLog } from "../lib/safeOperationalLog";

type OAuthEnv = Env;

interface NormalizedProfile {
  providerId: string;
  email: string;
  /** provider 가 이메일 소유를 검증했는가 — 계정 연결(link) 허용의 유일한 근거. */
  emailVerified: boolean;
  name: string;
  avatar: string | null;
  nickname: string | null;
}

interface ProviderConfig {
  authorizeUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scope: string;
  // google 은 client_secret 필수, kakao 는 선택(콘솔 "보안" 활성 시에만).
  requireClientSecret: boolean;
  clientId(env: OAuthEnv): string;
  clientSecret(env: OAuthEnv): string;
  parseProfile(json: Record<string, unknown>): NormalizedProfile | null;
}

function asString(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  return "";
}

const PROVIDERS: Record<string, ProviderConfig> = {
  // Kakao — client_id 는 REST API key. userinfo: kakao_account.{email,profile.{nickname,profile_image_url}}.
  kakao: {
    authorizeUrl: "https://kauth.kakao.com/oauth/authorize",
    tokenUrl: "https://kauth.kakao.com/oauth/token",
    userInfoUrl: "https://kapi.kakao.com/v2/user/me",
    scope: "profile_nickname account_email profile_image",
    requireClientSecret: false,
    clientId: (env) => env.KAKAO_REST_API_KEY || env.KAKAO_REST_KEY || "",
    clientSecret: (env) => env.KAKAO_CLIENT_SECRET || "",
    parseProfile: (json) => {
      const id = asString((json as { id?: unknown }).id);
      if (!id) return null;
      const account = (json.kakao_account as Record<string, unknown> | undefined) || {};
      const profile = (account.profile as Record<string, unknown> | undefined) || {};
      return {
        providerId: id,
        email: asString(account.email),
        emailVerified: readEmailVerified(account.is_email_verified),
        name: asString(profile.nickname),
        avatar: asString(profile.profile_image_url) || null,
        nickname: asString(profile.nickname) || null,
      };
    },
  },
  // Google — OpenID Connect userinfo: { sub, email, name, picture }.
  google: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userInfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
    scope: "openid email profile",
    requireClientSecret: true,
    clientId: (env) => env.GOOGLE_OAUTH_CLIENT_ID || "",
    clientSecret: (env) => env.GOOGLE_OAUTH_CLIENT_SECRET || "",
    parseProfile: (json) => {
      const id = asString((json as { sub?: unknown }).sub);
      if (!id) return null;
      return {
        providerId: id,
        email: asString(json.email),
        emailVerified: readEmailVerified(json.email_verified),
        name: asString(json.name),
        avatar: asString(json.picture) || null,
        nickname: null,
      };
    },
  },
};

interface KakaoGoogleTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

const oauth = new Hono<{ Bindings: Env; Variables: Vars }>();

// OAuth(kakao/google) = 부모. family_members 에 child 로 있으면 child, 아니면 parent
// (auth.ts / naver-auth.ts resolveRole 직역).
async function resolveRole(db: D1Database, uid: string): Promise<AuthUser["role"]> {
  const rm = await db.prepare("SELECT role FROM family_members WHERE user_id=? AND is_active=1 AND role IN ('parent','child') LIMIT 1").bind(uid).first<{ role: string }>();
  if (rm?.role === "child") return "child";
  return "parent";
}

function configError(c: Context<{ Bindings: Env; Variables: Vars }>, provider: string) {
  writeOperationalLog("error", "oauth_not_configured", { provider });
  return c.json({
    error: "oauth_not_configured",
    provider,
    message: `${provider} 로그인 설정이 아직 안 됐어요. 운영자에게 문의해 주세요!`,
  }, 503);
}

function isOAuthProviderConfigured(env: OAuthEnv, provider: string): boolean {
  if (provider === "naver") return !!env.NAVER_CLIENT_ID && !!env.NAVER_CLIENT_SECRET;
  const cfg = PROVIDERS[provider];
  if (!cfg) return false;
  return !!cfg.clientId(env) && (!cfg.requireClientSecret || !!cfg.clientSecret(env));
}

/**
 * 요청 scope 해석 — 콘솔 동의항목에 없는 scope 를 요청하면 provider 가 거부한다
 * (Kakao: KOE205 "존재하지 않는 동의항목"). 카카오 이메일(account_email)은 비즈니스 앱
 * 전환·검수가 필요할 수 있어, 콘솔 상태에 맞춰 코드 배포 없이 조정할 수 있게 secret 로 뺀다.
 * 미설정이면 기본 scope 를 쓴다. 이메일이 없어도 서버가 `{provider}-{id}@hyeni.local` 로 폴백한다.
 */
function resolveScope(env: OAuthEnv, provider: string, cfg: ProviderConfig): string {
  const override = provider === "kakao" ? (env.KAKAO_OAUTH_SCOPE || "").trim() : "";
  return override || cfg.scope;
}

// 콜백 callback URL — provider 콘솔 redirect_uri 와 token 교환 redirect_uri 가 항상 일치하도록
// 서버 origin 에서 동일하게 계산한다(클라가 보낸 값에 의존하지 않음).
function callbackUrl(reqUrl: string, provider: string): string {
  const origin = new URL(reqUrl).origin;
  if (provider === "naver") return `${origin}/api/auth/naver`;
  return `${origin}/api/auth/oauth/${provider}/callback`;
}

const NAVER_AUTHORIZE_URL = "https://nid.naver.com/oauth2.0/authorize";

function authorizationUrl(
  c: Context<{ Bindings: Env; Variables: Vars }>,
  provider: string,
  state: string,
): string | Response {
  if (provider === "naver") {
    const clientId = c.env.NAVER_CLIENT_ID || "";
    if (!isOAuthProviderConfigured(c.env, provider)) return configError(c, provider);
    return `${NAVER_AUTHORIZE_URL}?${new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: callbackUrl(c.req.url, provider),
      state,
    }).toString()}`;
  }
  const cfg = PROVIDERS[provider];
  if (!cfg) return c.json({ error: "unsupported_provider" }, 404);
  const clientId = cfg.clientId(c.env);
  if (!isOAuthProviderConfigured(c.env, provider)) {
    return configError(c, provider);
  }
  return `${cfg.authorizeUrl}?${new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: callbackUrl(c.req.url, provider),
    scope: resolveScope(c.env, provider, cfg),
    state,
  }).toString()}`;
}

async function prepareOAuth(
  c: Context<{ Bindings: Env; Variables: Vars }>,
  flowMode: OAuthFlowMode,
  userId: string | null,
): Promise<Response> {
  const provider = String(c.req.param("provider") ?? "");
  if (!PROVIDERS[provider] && provider !== "naver") {
    return c.json({ error: "unsupported_provider" }, 404);
  }
  if (flowMode === "link" && provider === "naver") {
    return c.json({ error: "unsupported_provider" }, 404);
  }
  let rawBody: unknown;
  try { rawBody = await c.req.json(); } catch { return c.json({ error: "invalid_json" }, 400); }
  const body = parseOAuthPrepareBody(rawBody);
  if (!body) return c.json({ error: "invalid_oauth_client" }, 400);
  // 설정 누락 시 DB에 교환 불가능한 orphan transaction을 만들지 않는다.
  if (!isOAuthProviderConfigured(c.env, provider)) return configError(c, provider);

  const transaction = await createOAuthTransaction(c.env.DB, {
    provider,
    clientKind: body.clientKind,
    webOrigin: body.webOrigin,
    flowMode,
    userId,
  });
  const authorizeUrl = authorizationUrl(c, provider, transaction.state);
  if (authorizeUrl instanceof Response) return authorizeUrl;
  c.header("Cache-Control", "no-store");
  return c.json({
    authorizationUrl: authorizeUrl,
    state: transaction.state,
    transactionSecret: transaction.transactionSecret,
    expiresAt: transaction.expiresAt,
  });
}

// 구버전의 client-controlled state/target 시작 경로는 보안상 호환하지 않는다.
oauth.get("/oauth/:provider/start", (c) => c.json({
  error: "oauth_client_update_required",
  message: "앱을 최신 버전으로 업데이트한 뒤 다시 로그인해 주세요.",
}, 410));

oauth.post("/oauth/:provider/start", (c) => prepareOAuth(c, "login", null));
oauth.post("/oauth/:provider/link/start", requireAuth, (c) => (
  prepareOAuth(c, "link", c.get("user").sub)
));

// provider 콜백은 DB에 저장된 고정 target만 사용하고 code를 해당 transaction에 결합한다.
oauth.get("/oauth/:provider/callback", async (c) => {
  const provider = c.req.param("provider");
  if (!PROVIDERS[provider]) return c.json({ error: "unsupported_provider" }, 404);
  const url = new URL(c.req.url);
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const providerError = url.searchParams.get("error") || "";
  const transaction = providerError
    ? await cancelOAuthTransaction(c.env.DB, provider, state)
    : await markOAuthCallback(c.env.DB, provider, state, code);
  if (!transaction) return invalidOAuthCallbackResponse();

  const targetUrl = appendOAuthCallbackQuery(transaction.redirectTarget, {
    provider,
    code: providerError ? undefined : code,
    state,
    error: providerError ? "oauth_cancelled" : undefined,
  });
  const label = provider === "google" ? "구글" : "카카오";
  return oauthCallbackResponse(label, targetUrl);
});


/**
 * code → access_token → userinfo → NormalizedProfile.
 * 실패 시 그대로 반환할 Response 를 돌려준다(호출부는 instanceof Response 로 분기).
 * 로그인(POST /oauth/:provider)과 계정 연결(POST /oauth/:provider/link)이 공유한다.
 */
async function exchangeProfile(
  c: Context<{ Bindings: Env; Variables: Vars }>,
  provider: string,
  cfg: ProviderConfig,
  code: string,
): Promise<NormalizedProfile | Response> {
  const clientId = cfg.clientId(c.env);
  const clientSecret = cfg.clientSecret(c.env);
  const redirectUri = callbackUrl(c.req.url, provider);

  const tokenForm = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code,
  });
  if (clientSecret) tokenForm.set("client_secret", clientSecret);

  let tokenResp: Response;
  try {
    tokenResp = await fetch(cfg.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: tokenForm.toString(),
    });
  } catch {
    writeOperationalLog("error", "oauth_token_fetch_failed", { provider });
    return c.json({ error: "token_exchange_failed" }, 502);
  }
  if (!tokenResp.ok) {
    writeOperationalLog("error", "oauth_token_exchange_http_failed", {
      provider,
      status: tokenResp.status,
    });
    return c.json({ error: "token_exchange_failed" }, 502);
  }
  const tokenData = await tokenResp.json() as KakaoGoogleTokenResponse;
  if (tokenData.error || !tokenData.access_token) {
    writeOperationalLog("error", "oauth_token_exchange_rejected", { provider });
    return c.json({ error: "token_exchange_rejected" }, 401);
  }

  let profileResp: Response;
  try {
    profileResp = await fetch(cfg.userInfoUrl, {
      headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: "application/json" },
    });
  } catch {
    writeOperationalLog("error", "oauth_profile_fetch_failed", { provider });
    return c.json({ error: "profile_fetch_failed" }, 502);
  }
  if (!profileResp.ok) return c.json({ error: "profile_fetch_failed", status: profileResp.status }, 502);

  const profileJson = await profileResp.json() as Record<string, unknown>;
  const profile = cfg.parseProfile(profileJson);
  if (!profile?.providerId) return c.json({ error: "profile_invalid" }, 502);
  return profile;
}

const SOCIAL_PROVIDERS = "('kakao','google','naver')";

function identityEmail(identityData: string | null): string {
  try {
    return String((JSON.parse(identityData || "{}") as { email?: unknown }).email || "");
  } catch {
    return "";
  }
}

/**
 * login-password 로 들어올 수 있는 계정인가.
 * (auth.ts /login-password 는 user_profiles.login_id → users.phone 조인 + encrypted_password 비교.)
 */
async function hasPasswordLogin(db: D1Database, uid: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT encrypted_password AS pw, phone FROM users WHERE id=? LIMIT 1")
    .bind(uid)
    .first<{ pw: string | null; phone: string | null }>();
  return !!(row?.pw && row?.phone);
}

async function countSocialIdentities(db: D1Database, uid: string): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM auth_identities WHERE user_id=? AND provider IN ${SOCIAL_PROVIDERS}`)
    .bind(uid)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

/**
 * GET /oauth/links — 내가 연결한 소셜 계정 목록 + 해제 가능 여부 판단 재료.
 * 같은 provider 에 여러 계정(예: 구글 2개)이 있을 수 있으므로 provider_id 로 각 행을 식별한다.
 */
oauth.get("/oauth/links", requireAuth, async (c) => {
  const db = c.env.DB;
  const uid = c.get("user").sub;
  const rows = await db
    .prepare(`SELECT provider, provider_id, identity_data, created_at FROM auth_identities WHERE user_id=? AND provider IN ${SOCIAL_PROVIDERS} ORDER BY created_at`)
    .bind(uid)
    .all<{ provider: string; provider_id: string; identity_data: string | null; created_at: string }>();

  const links = (rows.results || []).map((r) => ({
    provider: r.provider,
    providerId: r.provider_id,
    email: identityEmail(r.identity_data),
    createdAt: r.created_at,
  }));
  return c.json({ links, hasPasswordLogin: await hasPasswordLogin(db, uid) });
});

/**
 * POST /oauth/:provider/unlink — 내 계정에서 소셜 연결을 끊는다. body: { provider_id }.
 *
 * 마지막 로그인 수단은 절대 지우지 않는다(지우면 계정에 다시 못 들어간다).
 * 남의 identity 는 대상이 될 수 없다(user_id 조건이 DELETE 에 포함).
 */
oauth.post("/oauth/:provider/unlink", requireAuth, async (c) => {
  const provider = c.req.param("provider");
  if (!PROVIDERS[provider] && provider !== "naver") return c.json({ error: "unsupported_provider" }, 404);

  let body: { provider_id?: unknown };
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid_json" }, 400); }
  const providerId = typeof body.provider_id === "string" ? body.provider_id.trim() : "";
  if (!providerId) return c.json({ error: "missing_params", required: ["provider_id"] }, 400);

  const db = c.env.DB;
  const uid = c.get("user").sub;
  const mine = await db
    .prepare("SELECT id FROM auth_identities WHERE user_id=? AND provider=? AND provider_id=? LIMIT 1")
    .bind(uid, provider, providerId)
    .first<{ id: string }>();
  if (!mine) return c.json({ error: "identity_not_found" }, 404);

  const decision = decideOAuthUnlink({
    hasPasswordLogin: await hasPasswordLogin(db, uid),
    remainingSocialCount: (await countSocialIdentities(db, uid)) - 1,
  });
  if (decision.kind === "deny") {
    return c.json({ error: decision.reason, message: oauthUnlinkDenyMessage(decision.reason) }, 409);
  }

  try {
    await db
      .prepare("DELETE FROM auth_identities WHERE user_id=? AND provider=? AND provider_id=?")
      .bind(uid, provider, providerId)
      .run();
  } catch (e) {
    writeOperationalLog("error", "oauth_unlink_failed", { provider });
    return c.json({ error: "identity_unlink_failed" }, 500);
  }
  return c.json({ unlinked: true, provider, providerId });
});

/**
 * POST /oauth/:provider/link — 로그인된 계정에 소셜 identity 를 추가 연결.
 *
 * 왜 필요한가: 이메일이 다른 계정에 묶여 있거나(users.email 이 NULL 인 전화 가입 계정 등)
 * 이미 다른 provider 로 가입한 사람이, 자기 계정에 소셜 로그인을 붙일 정식 경로가 없었다.
 * (merge-oauth 는 provider 가 이미 연결된 계정을 거부하고, 별도 oauth user 존재를 전제한다.)
 * 여기서는 caller 의 세션이 신뢰 anchor 이며, 다른 사람이 이미 쓰는 identity 는 절대 뺏지 않는다.
 */
oauth.post("/oauth/:provider/link", requireAuth, async (c) => {
  const provider = c.req.param("provider");
  const cfg = PROVIDERS[provider];
  if (!cfg) return c.json({ error: "unsupported_provider" }, 404);
  const clientId = cfg.clientId(c.env);
  const clientSecret = cfg.clientSecret(c.env);
  if (!clientId || (cfg.requireClientSecret && !clientSecret)) return configError(c, provider);

  let body: { code?: unknown; state?: unknown; transactionSecret?: unknown };
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid_json" }, 400); }
  const code = typeof body.code === "string" ? body.code : "";
  const state = typeof body.state === "string" ? body.state : "";
  const transactionSecret = typeof body.transactionSecret === "string" ? body.transactionSecret : "";
  if (!code || !state || !transactionSecret) {
    return c.json({ error: "missing_params", required: ["code", "state", "transactionSecret"] }, 400);
  }
  const db = c.env.DB;
  const uid = c.get("user").sub;
  const claimed = await consumeOAuthTransaction(db, {
    provider,
    code,
    state,
    transactionSecret,
    flowMode: "link",
    userId: uid,
  });
  if (!claimed) return c.json({ error: "invalid_oauth_transaction" }, 400);

  const profile = await exchangeProfile(c, provider, cfg, code);
  if (profile instanceof Response) return profile;

  const existing = await db
    .prepare("SELECT user_id FROM auth_identities WHERE provider=? AND provider_id=? LIMIT 1")
    .bind(provider, profile.providerId)
    .first<{ user_id: string }>();

  if (existing?.user_id) {
    if (String(existing.user_id) === uid) {
      return c.json({ linked: true, already: true, provider, email: profile.email });
    }
    return c.json(
      { error: "identity_taken", message: "이 소셜 계정은 이미 다른 계정에 연결돼 있어요." },
      409,
    );
  }

  try {
    const inserted = await insertAuthIdentityForCurrentUser(db, {
      id: crypto.randomUUID(),
      userId: uid,
      provider,
      providerId: profile.providerId,
      identityData: JSON.stringify({
        sub: profile.providerId,
        email: profile.email,
        name: profile.name,
      }),
      createdAt: pgNow(),
    });
    if (!inserted) return c.json({ error: "account_deletion_in_progress" }, 409);
  } catch (e) {
    writeOperationalLog("error", "oauth_link_insert_failed", { provider });
    return c.json({ error: "identity_link_failed" }, 500);
  }
  return c.json({ linked: true, already: false, provider, email: profile.email });
});

// POST /oauth/:provider — code → token → userinfo → D1 user → ES256 세션.
oauth.post("/oauth/:provider", async (c) => {
  const provider = c.req.param("provider");
  const cfg = PROVIDERS[provider];
  if (!cfg) return c.json({ error: "unsupported_provider" }, 404);

  const db = c.env.DB;
  const clientId = cfg.clientId(c.env);
  const clientSecret = cfg.clientSecret(c.env);
  if (!clientId || (cfg.requireClientSecret && !clientSecret)) {
    return configError(c, provider);
  }

  let body: {
    code?: unknown;
    state?: unknown;
    transactionSecret?: unknown;
    device_install_id?: unknown;
    device_label?: unknown;
    device_platform?: unknown;
    onboardingInterests?: unknown;
  };
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
  const deviceId = normalizeDeviceId(body.device_install_id);
  if (!deviceId) return c.json({ error: "device_identity_required" }, 400);
  const onboardingInterests = parseOnboardingInterests(body.onboardingInterests);
  if (!onboardingInterests.ok) return c.json({ error: "invalid_onboarding_interests" }, 400);
  const claimed = await consumeOAuthTransaction(db, {
    provider,
    code,
    state,
    transactionSecret,
    flowMode: "login",
  });
  if (!claimed) return c.json({ error: "invalid_oauth_transaction" }, 400);
  const profile = await exchangeProfile(c, provider, cfg, code);
  if (profile instanceof Response) return profile;

  const providerId = profile.providerId;
  const emailIsFallback = !profile.email;
  const email = profile.email || `${provider}-${providerId}@hyeni.local`;
  const displayName = profile.name || "";

  // 3. user 해소 — anchor = auth_identities(provider, provider_id).
  //    복합 unique 미이관 → select-then-write(naver-auth 와 동일 gotcha 회피).
  const identity = await db
    .prepare("SELECT user_id FROM auth_identities WHERE provider=? AND provider_id=? LIMIT 1")
    .bind(provider, providerId)
    .first<{ user_id: string }>();

  let userId: string;
  let accountStatus: "existing" | "linked" | "created";
  if (identity?.user_id) {
    // 기존 사용자(또는 merge-oauth 로 phone user 에 이전된 identity). 메타데이터 best-effort 최신화.
    userId = String(identity.user_id);
    accountStatus = "existing";
    try {
      const existing = await db.prepare("SELECT raw_user_meta_data FROM users WHERE id=? LIMIT 1").bind(userId).first<{ raw_user_meta_data: string | null }>();
      let meta: Record<string, unknown> = {};
      try { meta = existing?.raw_user_meta_data ? JSON.parse(existing.raw_user_meta_data) : {}; } catch { meta = {}; }
      const merged = {
        ...meta,
        provider,
        [`${provider}_id`]: providerId,
        name: displayName || meta.name || "",
        nickname: profile.nickname || meta.nickname || null,
        avatar_url: profile.avatar || meta.avatar_url || null,
      };
      await db.prepare("UPDATE users SET raw_user_meta_data=? WHERE id=?").bind(JSON.stringify(merged), userId).run();
    } catch (e) {
      writeOperationalLog("error", "oauth_metadata_update_failed", { provider });
    }
  } else {
    // 신규 identity — 같은 이메일 계정이 있으면 "거부"가 아니라 "연결"이 정답이다.
    // 같은 사람이 ID/PW 나 다른 provider 로 이미 가입한 경우가 대부분이며, 무조건 409 로 막으면
    // 그 사람은 해당 소셜 로그인을 영원히 못 쓴다. 단, provider 가 이메일을 검증했을 때만 연결한다.
    const emailOwner = await db
      .prepare("SELECT id, is_anonymous FROM users WHERE email=? LIMIT 1")
      .bind(email)
      .first<{ id: string; is_anonymous: number | null }>();

    const decision = decideOAuthLink({
      emailIsFallback,
      emailVerified: profile.emailVerified,
      owner: emailOwner ? { id: String(emailOwner.id), isAnonymous: !!emailOwner.is_anonymous } : null,
    });

    if (decision.kind === "conflict") {
      writeOperationalLog("error", "oauth_email_conflict", { provider });
      return c.json(
        { error: "email_conflict_other_account", reason: decision.reason, message: oauthConflictMessage(decision.reason) },
        409,
      );
    }

    const meta = {
      provider,
      [`${provider}_id`]: providerId,
      name: displayName,
      nickname: profile.nickname || null,
      avatar_url: profile.avatar || null,
    };
    const identityRow = db
      .prepare("INSERT INTO auth_identities (id, user_id, provider, provider_id, identity_data, created_at) VALUES (?,?,?,?,?,?)");
    const identityData = JSON.stringify({ sub: providerId, email, name: displayName });

    if (decision.kind === "link") {
      // 기존 계정에 이 provider identity 를 붙인다(link). 가족·구독·아이 페어링이 그대로 유지된다.
      userId = decision.userId;
      accountStatus = "linked";
      try {
        const inserted = await insertAuthIdentityForCurrentUser(db, {
          id: crypto.randomUUID(),
          userId,
          provider,
          providerId,
          identityData,
          createdAt: pgNow(),
        });
        if (!inserted) return c.json({ error: "account_deletion_in_progress" }, 409);
      } catch (e) {
        writeOperationalLog("error", "oauth_identity_link_failed", { provider });
        return c.json({ error: "identity_link_failed" }, 500);
      }
    } else {
      userId = crypto.randomUUID();
      accountStatus = "created";
      const createdAt = pgNow();
      const signupMeta = attachOnboardingPreferences(meta, onboardingInterests, createdAt);
      try {
        await db.batch([
          db.prepare("INSERT INTO users (id, email, is_anonymous, raw_user_meta_data, created_at) VALUES (?,?,0,?,?)").bind(userId, email, JSON.stringify(signupMeta), createdAt),
          identityRow.bind(crypto.randomUUID(), userId, provider, providerId, identityData, createdAt),
        ]);
      } catch (e) {
        writeOperationalLog("error", "oauth_user_create_failed", { provider });
        return c.json({ error: "user_create_failed" }, 500);
      }
    }
  }

  // 4. Worker 세션 발급. 응답 user 에 브리지 게이트(getOAuthUserNeedsBridge)가 읽는
  //    app_metadata.provider / phone / user_metadata 를 함께 싣는다.
  const userRow = await db.prepare("SELECT phone, raw_user_meta_data FROM users WHERE id=? LIMIT 1").bind(userId).first<{ phone: string | null; raw_user_meta_data: string | null }>();
  let userMeta: Record<string, unknown> = {};
  try { userMeta = userRow?.raw_user_meta_data ? JSON.parse(userRow.raw_user_meta_data) : {}; } catch { userMeta = {}; }

  const canonicalFamily = await resolveCanonicalFamilyMembership(db, userId);
  const familyId = canonicalFamily?.familyId ?? null;
  const role = canonicalFamily?.role ?? await resolveRole(db, userId);
  const user: AuthUser = { sub: userId, role, family_id: familyId, is_anonymous: false };
  let accessToken: string;
  let refreshToken: string;
  try {
    const issued = await issueAccountSession(c.env, user, {
      deviceId,
      deviceLabel: body.device_label,
      devicePlatform: body.device_platform,
    });
    accessToken = issued.accessToken;
    refreshToken = issued.refreshToken;
  } catch (error) {
    if (isDeviceIdentityRequiredError(error)) {
      return c.json({ error: "device_identity_required" }, 400);
    }
    if (isRefreshTokenIssuanceBlocked(error)) {
      return c.json({ error: "account_deletion_in_progress" }, 409);
    }
    throw error;
  }

  return c.json({
    account_status: accountStatus,
    // 원본 호환 필드.
    email,
    name: displayName,
    user_id: userId,
    provider,
    // Worker 세션(클라 시임이 적용).
    user: {
      id: userId,
      role,
      family_id: familyId,
      phone: userRow?.phone ?? null,
      is_anonymous: false,
      app_metadata: { provider },
      identities: [{ provider, provider_id: providerId }],
      user_metadata: userMeta,
    },
    session: { access_token: accessToken, refresh_token: refreshToken, token_type: "bearer" },
  });
});

export default oauth;

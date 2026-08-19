// 인증 라우트. accountAuth.js signInWithLoginId 계약을 D1 백엔드로 직역.
import { Hono } from "hono";
import type { Env, Vars, AuthUser } from "../types";
import { requireAuth } from "../middleware/auth";
import { comparePassword, hashPassword } from "../lib/bcrypt";
import { signAccessToken } from "../lib/jwt";
import {
  issueRefreshToken,
  isRefreshTokenIssuanceBlocked,
  rotateRefreshToken,
  normalizeDeviceId,
} from "../lib/refresh";
import { issueAccountSession } from "../lib/authSession";
import {
  isActiveDeviceSessionExistsError,
  isDeviceIdentityRequiredError,
} from "../lib/accountDeviceSession";
import { resolveCanonicalFamilyMembership } from "../db/authz";
import { pgNow, tsNorm } from "../lib/time";
import { parsePhone, e164ToGoTruePhone, e164ToLocalKr } from "../lib/phone";
import { sendPhoneOtp, verifyPhoneOtp } from "../lib/phoneOtp";
import {
  claimAnonymousSignupProtection,
  releaseAnonymousSignupProtectionClaims,
} from "../lib/anonymousSignupProtection";

const auth = new Hono<{ Bindings: Env; Variables: Vars }>();

// access token 수명(초). signAccessToken 기본값 "1h"와 동기화 — 응답 expires_in 에 사용.
const ACCESS_TTL_SECONDS = 3600;

// login_id 규칙 — 클라 accountAuth.LOGIN_ID_RE 와 동일(영소문자/숫자/._- 4~24자).
const LOGIN_ID_RE = /^[a-z0-9][a-z0-9._-]{3,23}$/;
const GENDER_VALUES = new Set(["mom", "dad", "guardian"]);

function normalizeLoginId(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

// user_profiles.login_id 미사용 여부(is_login_id_available RPC 직역, lower(trim) 매칭).
async function isLoginIdAvailable(db: D1Database, loginId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS x FROM user_profiles WHERE login_id = ? LIMIT 1")
    .bind(loginId)
    .first<{ x: number }>();
  return !row;
}

// 전화 중복 — user_profiles.phone(E.164) 또는 users.phone('+' 제거형) 중 하나라도 있으면 true.
async function isPhoneTaken(db: D1Database, phoneAuth: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS x FROM user_profiles WHERE phone = ?1
       UNION ALL
       SELECT 1 AS x FROM users WHERE phone = ?2 LIMIT 1`,
    )
    .bind(phoneAuth, e164ToGoTruePhone(phoneAuth))
    .first<{ x: number }>();
  return !!row;
}

// users.is_anonymous 조회. 익명 user 는 family_members 가 없어 resolveRole 이 'parent'로
// 오판하므로, refresh 시 이 플래그로 role/is_anonymous 를 보존한다.
async function isAnonymousUser(db: D1Database, uid: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT is_anonymous FROM users WHERE id=? LIMIT 1")
    .bind(uid)
    .first<{ is_anonymous: number }>();
  return !!Number(row?.is_anonymous);
}

// login_id → user_profiles.phone → users(phone 매칭, '+' 제거) → role/family
async function resolveRole(
  db: D1Database,
  uid: string,
): Promise<AuthUser["role"]> {
  const rm = await db
    .prepare("SELECT role FROM family_members WHERE user_id=? AND is_active=1 AND role IN ('parent','child') LIMIT 1")
    .bind(uid)
    .first<{ role: string }>();
  if (rm?.role === "child") return "child";
  // family_members에 없으면 families.parent_id 매칭 = 부모
  return "parent";
}

// 비밀번호 로그인 무차별 대입 방지(§3 감사 HIGH). loginId 별 실패 횟수를 윈도우 내
// 집계해 임계 초과 시 429, 성공 시 기록을 비운다. login_attempts 테이블이 아직
// 없으면(배포 순서) fail-open — 절대 정상 로그인을 막지 않는다.
const LOGIN_RL_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_RL_MAX_FAILURES = 8;

async function loginRateLimited(db: D1Database, loginId: string): Promise<boolean> {
  try {
    const threshold = tsNorm(new Date(Date.now() - LOGIN_RL_WINDOW_MS).toISOString());
    const cnt = await db
      .prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE login_id=? AND substr(attempted_at,1,19) > ?")
      .bind(loginId, threshold)
      .first<{ n: number }>();
    return Number(cnt?.n ?? 0) >= LOGIN_RL_MAX_FAILURES;
  } catch {
    return false; // 테이블 부재 등 → fail-open(정상 로그인 보호 우선)
  }
}

async function recordLoginFailure(db: D1Database, loginId: string): Promise<void> {
  try {
    await db.prepare("INSERT INTO login_attempts (login_id, attempted_at) VALUES (?,?)").bind(loginId, pgNow()).run();
  } catch { /* fail-open: 기록 실패가 로그인 흐름을 막지 않음 */ }
}

async function clearLoginFailures(db: D1Database, loginId: string): Promise<void> {
  try {
    await db.prepare("DELETE FROM login_attempts WHERE login_id=?").bind(loginId).run();
  } catch { /* noop */ }
}

// POST /auth/login-password — 전화+비밀번호 로그인 (login_id 기반)
auth.post("/login-password", async (c) => {
  let body: {
    loginId?: string;
    password?: string;
    device_install_id?: unknown;
    device_label?: unknown;
    device_platform?: unknown;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad_request" }, 400);
  }
  const loginDeviceId = normalizeDeviceId(body?.device_install_id);
  if (!loginDeviceId) return c.json({ error: "device_identity_required" }, 400);
  const loginId = String(body?.loginId ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");
  if (!loginId || !password) {
    return c.json({ error: "invalid_credentials" }, 401);
  }
  if (await loginRateLimited(c.env.DB, loginId)) {
    return c.json({ error: "too_many_attempts" }, 429);
  }

  const row = await c.env.DB.prepare(
    `SELECT u.id AS id, u.encrypted_password AS pw,
            u.raw_user_meta_data AS meta, u.is_anonymous AS anon
     FROM user_profiles up
     JOIN users u ON u.phone = REPLACE(up.phone,'+','')
     WHERE up.login_id = ? LIMIT 1`,
  )
    .bind(loginId)
    .first<{ id: string; pw: string; meta: string | null; anon: number }>();

  if (!row?.pw) {
    await recordLoginFailure(c.env.DB, loginId);
    return c.json({ error: "invalid_credentials" }, 401);
  }
  if (!(await comparePassword(password, row.pw))) {
    await recordLoginFailure(c.env.DB, loginId);
    return c.json({ error: "invalid_credentials" }, 401);
  }
  await clearLoginFailures(c.env.DB, loginId);

  const canonicalFamily = await resolveCanonicalFamilyMembership(c.env.DB, row.id);
  const familyId = canonicalFamily?.familyId ?? null;
  const role = canonicalFamily?.role ?? await resolveRole(c.env.DB, row.id);
  const user: AuthUser = {
    sub: row.id,
    role,
    family_id: familyId,
    is_anonymous: !!Number(row.anon),
  };
  let accessToken: string;
  let refreshToken: string;
  try {
    const issued = await issueAccountSession(c.env, user, {
      deviceId: loginDeviceId,
      deviceLabel: body.device_label,
      devicePlatform: body.device_platform,
    });
    accessToken = issued.accessToken;
    refreshToken = issued.refreshToken;
  } catch (error) {
    if (isDeviceIdentityRequiredError(error)) {
      return c.json({ error: "device_identity_required" }, 400);
    }
    if (isActiveDeviceSessionExistsError(error)) {
      return c.json({ error: "active_device_session_exists" }, 409);
    }
    if (isRefreshTokenIssuanceBlocked(error)) {
      return c.json({ error: "account_deletion_in_progress" }, 409);
    }
    throw error;
  }

  let userMeta: unknown = {};
  try {
    userMeta = row.meta ? JSON.parse(row.meta) : {};
  } catch {
    /* keep {} */
  }

  // Supabase signInWithPassword data 형태 미러 (클라 시임 호환)
  return c.json({
    user: { id: row.id, role, family_id: familyId, user_metadata: userMeta },
    session: {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: "bearer",
    },
  });
});

// POST /auth/anonymous — 자녀 익명 세션 발급 (Supabase signInAnonymously 미러)
// 매 호출마다 새 익명 user(uuid v4, is_anonymous=1, family_id=null)를 만들고
// ES256 access + 불투명 refresh 를 발급한다. 페어링(join_family) 전까지 가족이 없다.
auth.post("/anonymous", async (c) => {
  let anonDeviceId: string | null = null;
  let anonDeviceLabel: unknown;
  let anonDevicePlatform: unknown;
  try {
    const body = await c.req.json<{
      device_install_id?: unknown;
      device_label?: unknown;
      device_platform?: unknown;
    }>();
    anonDeviceId = normalizeDeviceId(body?.device_install_id);
    anonDeviceLabel = body?.device_label;
    anonDevicePlatform = body?.device_platform;
  } catch {
    /* 아래 설치 식별자 필수 게이트에서 거부 */
  }
  const protection = await claimAnonymousSignupProtection(c.env.DB, {
    cfConnectingIp: c.req.header("CF-Connecting-IP"),
    deviceInstallId: anonDeviceId,
    dedicatedSecret: c.env.ANONYMOUS_SIGNUP_RATE_LIMIT_SECRET,
    jwtPrivateKey: c.env.JWT_PRIVATE_KEY,
  });
  if (protection.status === "unavailable") {
    return c.json({ error: "anonymous_signup_protection_unavailable" }, 503);
  }
  if (protection.status === "limited") {
    c.header("Retry-After", String(protection.retryAfterSeconds));
    return c.json({ error: "anonymous_signup_rate_limited" }, 429);
  }

  const userId = crypto.randomUUID();
  try {
    await c.env.DB.prepare(
      `INSERT INTO users(id, is_anonymous, created_at) VALUES(?, 1, ?)`,
    )
      .bind(userId, pgNow())
      .run();
  } catch {
    await releaseAnonymousSignupProtectionClaims(c.env.DB, protection.claims);
    console.error("[auth/anonymous] user insert failed");
    return c.json({ error: "anonymous_signup_failed" }, 500);
  }

  const user: AuthUser = {
    sub: userId,
    role: "anonymous",
    family_id: null,
    is_anonymous: true,
  };
  let accessToken: string;
  let refreshToken: string;
  try {
    if (anonDeviceId) {
      const issued = await issueAccountSession(c.env, user, {
        deviceId: anonDeviceId,
        deviceLabel: anonDeviceLabel,
        devicePlatform: anonDevicePlatform,
      });
      accessToken = issued.accessToken;
      refreshToken = issued.refreshToken;
    } else {
      // 미페어링 익명 계정은 가족/아이 데이터를 볼 수 없으므로 구버전 온보딩을 유지한다.
      // 실제 페어링 세션 재발급에서는 설치 식별자를 필수로 받는다.
      accessToken = await signAccessToken(c.env, user);
      refreshToken = await issueRefreshToken(c.env.DB, userId, null, null);
    }
  } catch {
    try {
      await c.env.DB.batch([
        c.env.DB.prepare("DELETE FROM account_device_sessions WHERE user_id=?").bind(userId),
        c.env.DB.prepare("DELETE FROM refresh_tokens WHERE user_id=?").bind(userId),
        c.env.DB
          .prepare(
            `DELETE FROM users
              WHERE id=? AND is_anonymous=1
                AND NOT EXISTS (SELECT 1 FROM family_members WHERE user_id=?)`,
          )
          .bind(userId, userId),
      ]);
    } catch {
      // 즉시 정리가 실패해도 48시간 orphan cleanup이 회수한다.
      console.error("[auth/anonymous] incomplete account cleanup deferred");
    }
    await releaseAnonymousSignupProtectionClaims(c.env.DB, protection.claims);
    console.error("[auth/anonymous] session issuance failed");
    return c.json({ error: "anonymous_signup_failed" }, 503);
  }

  // Supabase signInAnonymously data 형태 미러 (data.user / data.session).
  return c.json({
    user: {
      id: userId,
      role: "anonymous",
      family_id: null,
      is_anonymous: true,
      user_metadata: {},
    },
    session: {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: "bearer",
      expires_in: ACCESS_TTL_SECONDS,
    },
  });
});

// POST /auth/refresh — 불투명 refresh 토큰 회전 후 새 access 발급.
// device_install_id 를 함께 받으면 기기 바인딩 회전(스탬핑된 체인은 같은 기기만 회전 가능).
auth.post("/refresh", async (c) => {
  let body: {
    refresh_token?: string;
    device_install_id?: unknown;
    device_label?: unknown;
    device_platform?: unknown;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad_request" }, 400);
  }
  const old = String(body?.refresh_token ?? "");
  if (!old) return c.json({ error: "invalid_token" }, 401);

  let rot: Awaited<ReturnType<typeof rotateRefreshToken>>;
  try {
    rot = await rotateRefreshToken(
      c.env.DB,
      old,
      normalizeDeviceId(body?.device_install_id),
      { deviceLabel: body.device_label, devicePlatform: body.device_platform },
    );
  } catch (error) {
    if (isActiveDeviceSessionExistsError(error)) {
      return c.json({ error: "device_session_inactive" }, 401);
    }
    if (isDeviceIdentityRequiredError(error)) {
      return c.json({ error: "device_identity_required" }, 401);
    }
    throw error;
  }
  if (!rot) return c.json({ error: "invalid_token" }, 401);

  // 익명 세션도 갱신 가능해야 한다. 익명 user 는 family_members 가 없어 resolveRole 이
  // 'parent'로 오판하므로, is_anonymous 플래그로 role='anonymous'를 보존한다.
  const isAnon = await isAnonymousUser(c.env.DB, rot.userId);
  const canonicalFamily = isAnon
    ? null
    : await resolveCanonicalFamilyMembership(c.env.DB, rot.userId, rot.familyId);
  const role = isAnon
    ? "anonymous"
    : canonicalFamily?.role ?? await resolveRole(c.env.DB, rot.userId);
  const familyId = canonicalFamily?.familyId ?? null;
  if (rot.familyId !== familyId) {
    await c.env.DB.prepare("UPDATE refresh_tokens SET family_id=? WHERE token=? AND user_id=?")
      .bind(familyId, rot.newToken, rot.userId)
      .run();
  }
  const user: AuthUser = {
    sub: rot.userId,
    role,
    family_id: familyId,
    is_anonymous: isAnon,
    device_id: rot.deviceId,
  };
  const accessToken = await signAccessToken(c.env, user);
  return c.json({
    session: {
      access_token: accessToken,
      refresh_token: rot.newToken,
      token_type: "bearer",
    },
  });
});

// POST /auth/logout — 현재 설치의 활성 잠금과 모든 refresh 체인을 함께 철회한다.
// 클라이언트는 이 성공 응답을 받은 뒤에만 로컬 세션을 지운다.
auth.post("/logout", requireAuth, async (c) => {
  const user = c.get("user");
  let body: { device_install_id?: unknown } = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad_request" }, 400);
  }
  const deviceId = normalizeDeviceId(user.device_id ?? body.device_install_id);
  if (!deviceId) return c.json({ error: "device_identity_required" }, 400);
  if (user.device_id && normalizeDeviceId(body.device_install_id) !== user.device_id) {
    return c.json({ error: "device_identity_mismatch" }, 403);
  }
  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB
      .prepare(
        `UPDATE refresh_tokens SET revoked=1
          WHERE user_id=? AND device_id=? AND revoked=0`,
      )
      .bind(user.sub, deviceId),
    c.env.DB
      .prepare(
        `UPDATE account_device_sessions
            SET revoked_at=?, last_seen_at=?
          WHERE user_id=? AND device_id=? AND revoked_at IS NULL`,
      )
      .bind(now, now, user.sub, deviceId),
  ]);
  return c.json({ ok: true });
});

// POST /auth/change-password — 현재 비밀번호 확인 후 새 비밀번호 저장.
// OAuth-only/익명 계정처럼 encrypted_password 가 없는 계정은 명확히 거부한다.
auth.post("/change-password", requireAuth, async (c) => {
  const user = c.get("user");
  let body: { currentPassword?: unknown; newPassword?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad_request" }, 400);
  }

  const currentPassword = String(body?.currentPassword ?? "");
  const newPassword = String(body?.newPassword ?? "");
  if (!currentPassword || newPassword.length < 6) {
    return c.json({ error: "weak_password" }, 400);
  }
  if (currentPassword === newPassword) {
    return c.json({ error: "same_password" }, 400);
  }

  const row = await c.env.DB.prepare(
    "SELECT encrypted_password FROM users WHERE id = ? LIMIT 1",
  )
    .bind(user.sub)
    .first<{ encrypted_password: string | null }>();

  if (!row?.encrypted_password) {
    return c.json({ error: "password_account_required" }, 400);
  }
  if (!(await comparePassword(currentPassword, row.encrypted_password))) {
    return c.json({ error: "current_password_mismatch" }, 401);
  }

  const nextHash = await hashPassword(newPassword);
  await c.env.DB.prepare("UPDATE users SET encrypted_password = ? WHERE id = ?")
    .bind(nextHash, user.sub)
    .run();
  return c.json({ ok: true });
});

// ── 신규 부모/선생님 전화 가입(Supabase auth.signUp + verifyOtp 직역) ──────────────
// 원본 흐름: checkLoginIdAvailability → signUp{phone,password,data} OTP 발송 → verifyOtp 세션
//            → user_profiles upsert(login_id/이름). Worker 는 GoTrue 가 없으므로 user/identity/
//            user_profiles 를 D1 에 직접 생성하고 ES256 세션을 발급한다(login-password 와 동일 형태).

// POST /auth/check-login-id — { loginId } → { available } (is_login_id_available RPC 직역)
auth.post("/check-login-id", async (c) => {
  let body: { loginId?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad_request" }, 400);
  }
  const loginId = normalizeLoginId(body?.loginId);
  if (!LOGIN_ID_RE.test(loginId)) return c.json({ error: "invalid_login_id" }, 400);
  const available = await isLoginIdAvailable(c.env.DB, loginId);
  return c.json({ available });
});

// POST /auth/signup/request-otp — { phone, password, loginId? } → 전화 OTP 발송.
// 가입 전 게이트: 이미 가입된 전화면 거부(브리지의 "존재 필수"와 반대), login_id 가 오면 중복확인.
// user/비밀번호 해시는 만들지 않는다(verify 단계에서 OTP 확인 후 생성).
auth.post("/signup/request-otp", async (c) => {
  const db = c.env.DB;
  let body: { phone?: unknown; password?: unknown; loginId?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad_request" }, 400);
  }
  const phone = parsePhone(body?.phone);
  if (!phone) return c.json({ error: "invalid_phone" }, 400);
  const password = String(body?.password ?? "");
  if (password.length < 6) return c.json({ error: "weak_password" }, 400);

  // login_id 가 동봉되면 형식·중복 검사(SMS 낭비 전 차단). 미동봉이면 verify 에서 강제.
  if (body?.loginId !== undefined && body?.loginId !== null && body?.loginId !== "") {
    const loginId = normalizeLoginId(body.loginId);
    if (!LOGIN_ID_RE.test(loginId)) return c.json({ error: "invalid_login_id" }, 400);
    if (!(await isLoginIdAvailable(db, loginId))) return c.json({ error: "login_id_taken" }, 409);
  }

  // 이미 가입된 전화면 거부(shouldCreateUser:true 인데 중복 전화는 GoTrue 가 거부하던 동작 미러).
  if (await isPhoneTaken(db, phone)) return c.json({ error: "phone_exists" }, 409);

  const sent = await sendPhoneOtp(db, c.env, phone);
  if (!sent.ok) {
    if (sent.retryAfter) c.header("Retry-After", sent.retryAfter);
    return c.json({ error: sent.error }, (sent.status ?? 500) as 409 | 429 | 503 | 500);
  }
  return c.json({ ok: true });
});

// POST /auth/signup/verify — { phone, token, password, loginId, name, gender?, birthdate? }
//   OTP 검증 → users(bcrypt 해시, phone) + auth_identities(phone) + user_profiles(login_id/이름)
//   생성 → ES256 {access,refresh} 세션 발급. select-then-write 로 전화/login_id 중복 가드.
auth.post("/signup/verify", async (c) => {
  const db = c.env.DB;
  let body: {
    phone?: unknown;
    token?: unknown;
    password?: unknown;
    loginId?: unknown;
    name?: unknown;
    gender?: unknown;
    birthdate?: unknown;
    device_install_id?: unknown;
    device_label?: unknown;
    device_platform?: unknown;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad_request" }, 400);
  }

  const signupDeviceId = normalizeDeviceId(body?.device_install_id);
  const phone = parsePhone(body?.phone);
  if (!phone) return c.json({ error: "invalid_phone" }, 400);
  const token = String(body?.token ?? "").replace(/\D/g, "");
  if (!/^\d{6}$/.test(token)) return c.json({ error: "invalid_token_format" }, 400);
  const password = String(body?.password ?? "");
  if (password.length < 6) return c.json({ error: "weak_password" }, 400);
  const loginId = normalizeLoginId(body?.loginId);
  if (!LOGIN_ID_RE.test(loginId)) return c.json({ error: "invalid_login_id" }, 400);
  const name = String(body?.name ?? "").trim();
  if (!name) return c.json({ error: "missing_name" }, 400);
  const gender = GENDER_VALUES.has(String(body?.gender ?? "")) ? String(body.gender) : null;
  const birthdate = /^\d{4}-\d{2}-\d{2}$/.test(String(body?.birthdate ?? ""))
    ? String(body.birthdate)
    : null;

  // OTP 검증·소비(만료/시도제한/상수시간) — 공유 모듈. 통과 후에만 user 를 만든다.
  const verified = await verifyPhoneOtp(db, c.env, phone, token);
  if (!verified.ok) {
    return c.json({ error: verified.error }, (verified.status ?? 401) as 401 | 429);
  }
  if (!signupDeviceId) return c.json({ error: "device_identity_required" }, 400);

  // select-then-write 중복 가드 — OTP 통과 후 재확인(동시 가입/직접 호출 방어).
  if (await isPhoneTaken(db, phone)) return c.json({ error: "phone_exists" }, 409);
  if (!(await isLoginIdAvailable(db, loginId))) return c.json({ error: "login_id_taken" }, 409);

  const userId = crypto.randomUUID();
  const phoneNoPlus = e164ToGoTruePhone(phone); // users.phone (GoTrue 형식, '+' 제거)
  const phoneLocal = e164ToLocalKr(phone); // raw_user_meta_data.phone (클라 phoneStorage 미러)
  const encryptedPassword = await hashPassword(password); // 평문 저장 금지 — bcrypt 해시
  const nowTs = pgNow();
  const meta = {
    auth_provider: "phone",
    login_id: loginId,
    name,
    phone: phoneLocal,
    ...(gender ? { gender } : {}),
    ...(birthdate ? { birthdate } : {}),
  };

  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO users (id, phone, encrypted_password, is_anonymous, raw_user_meta_data, created_at)
           VALUES (?,?,?,0,?,?)`,
        )
        .bind(userId, phoneNoPlus, encryptedPassword, JSON.stringify(meta), nowTs),
      // phone identity — GoTrue 는 phone provider 의 provider_id 를 user.id 로 둔다(충돌 없음).
      db
        .prepare(
          `INSERT INTO auth_identities (id, user_id, provider, provider_id, identity_data, created_at)
           VALUES (?,?,?,?,?,?)`,
        )
        .bind(crypto.randomUUID(), userId, "phone", userId, JSON.stringify({ sub: userId, phone: phoneNoPlus }), nowTs),
      db
        .prepare(
          `INSERT INTO user_profiles (user_id, login_id, display_name, phone, provider, gender, birthdate, linked_providers, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,'{}',?,?)`,
        )
        .bind(userId, loginId, name, phone, "phone", gender, birthdate, nowTs, nowTs),
    ]);
  } catch (err) {
    console.error("[auth/signup/verify] user insert failed:");
    return c.json({ error: "signup_failed" }, 500);
  }

  // 가입 직후엔 가족이 없다(페어링/가족 생성은 후속). login-password 와 동일한 세션 형태.
  const user: AuthUser = { sub: userId, role: "parent", family_id: null, is_anonymous: false };
  let accessToken: string;
  let refreshToken: string;
  try {
    const issued = await issueAccountSession(c.env, user, {
      deviceId: signupDeviceId,
      deviceLabel: body.device_label,
      devicePlatform: body.device_platform,
    });
    accessToken = issued.accessToken;
    refreshToken = issued.refreshToken;
  } catch (error) {
    if (isDeviceIdentityRequiredError(error)) {
      return c.json({ error: "device_identity_required" }, 400);
    }
    throw error;
  }

  return c.json({
    user: {
      id: userId,
      role: "parent",
      family_id: null,
      phone,
      is_anonymous: false,
      app_metadata: { provider: "phone" },
      user_metadata: meta,
    },
    session: {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: "bearer",
      expires_in: ACCESS_TTL_SECONDS,
    },
  });
});

export default auth;

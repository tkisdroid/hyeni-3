import type { AuthUser, Env } from "../types";
import { resolveCanonicalFamilyMembership } from "../db/authz";
import {
  checkAccountDeviceSession,
  requireDeviceDescriptor,
} from "./accountDeviceSession";
import { signAccessToken } from "./jwt";
import {
  acknowledgeOAuthRecovery,
  hashOAuthSecret,
  readOAuthRecovery,
  type OAuthRecoveryAccountStatus,
} from "./oauthState";

interface LiveRefreshRow {
  token: string;
  family_id: string | null;
}

interface RecoveredApiUser {
  id: string;
  role: AuthUser["role"];
  family_id: string | null;
  phone: string | null;
  email: string | null;
  is_anonymous: false;
  app_metadata: { provider: string };
  identities: Array<{ provider: string; provider_id: string }>;
  user_metadata: Record<string, unknown>;
}

export type RecoveredOAuthSession =
  | { status: "pending" }
  | {
      status: "ready";
      accountStatus: OAuthRecoveryAccountStatus;
      user: RecoveredApiUser;
      accessToken: string;
      refreshToken: string;
      accessJti: string;
    };

async function findExactCanonicalRefresh(
  db: D1Database,
  input: { userId: string; deviceId: string; expectedHash: string },
  now = new Date(),
): Promise<LiveRefreshRow | null> {
  const rows = await db.prepare(
    `SELECT token,family_id FROM refresh_tokens
      WHERE user_id=? AND device_id=? AND revoked=0 AND expires_at>?
      ORDER BY issued_at DESC
      LIMIT 2`,
  ).bind(input.userId, input.deviceId, now.toISOString()).all<LiveRefreshRow>();
  // 여러 live candidate는 세션 정본이 모호하므로 임의 선택하지 않는다.
  if ((rows.results?.length ?? 0) !== 1) return null;
  const only = rows.results[0];
  if (!only || await hashOAuthSecret(only.token) !== input.expectedHash) return null;
  return only;
}

export async function isOAuthRecoveryAccessGenerationActive(
  db: D1Database,
  input: { userId: string; deviceId: string; refreshTokenHash: string },
  now = new Date(),
): Promise<boolean> {
  return !!await findExactCanonicalRefresh(db, {
    userId: input.userId,
    deviceId: input.deviceId,
    expectedHash: input.refreshTokenHash,
  }, now);
}

async function readRecoveryUser(
  env: Env,
  provider: string,
  userId: string,
): Promise<{ authUser: AuthUser; apiUser: RecoveredApiUser } | null> {
  const row = await env.DB.prepare(
    "SELECT phone,email,raw_user_meta_data FROM users WHERE id=? LIMIT 1",
  ).bind(userId).first<{
    phone: string | null;
    email: string | null;
    raw_user_meta_data: string | null;
  }>();
  if (!row) return null;
  let userMetadata: Record<string, unknown> = {};
  try {
    userMetadata = row.raw_user_meta_data ? JSON.parse(row.raw_user_meta_data) : {};
  } catch {
    userMetadata = {};
  }
  const membership = await resolveCanonicalFamilyMembership(env.DB, userId);
  const familyId = membership?.familyId ?? null;
  const role: AuthUser["role"] = membership?.role === "child" ? "child" : "parent";
  const identity = await env.DB.prepare(
    "SELECT provider_id FROM auth_identities WHERE user_id=? AND provider=? LIMIT 1",
  ).bind(userId, provider).first<{ provider_id: string }>();
  const authUser: AuthUser = {
    sub: userId,
    role,
    family_id: familyId,
    is_anonymous: false,
  };
  return {
    authUser,
    apiUser: {
      id: userId,
      role,
      family_id: familyId,
      phone: row.phone,
      email: row.email,
      is_anonymous: false,
      app_metadata: { provider },
      identities: identity ? [{ provider, provider_id: identity.provider_id }] : [],
      user_metadata: userMetadata,
    },
  };
}

/**
 * recoveryId 자체가 256-bit bearer다. device ID는 비밀/PoP가 아니며 해시 결합은
 * 다른 설치의 우발적 오사용만 막는다. 따라서 raw ID는 저장·로그하지 않는다.
 */
export async function recoverOAuthSession(
  env: Env,
  input: {
    provider: string;
    recoveryId: string;
    deviceId?: unknown;
    deviceLabel?: unknown;
    devicePlatform?: unknown;
  },
  now = new Date(),
): Promise<RecoveredOAuthSession | null> {
  const device = requireDeviceDescriptor(input);
  const recovery = await readOAuthRecovery(env.DB, {
    provider: input.provider,
    recoveryId: input.recoveryId,
    deviceId: device.deviceId,
  }, now);
  if (!recovery) return null;
  if (recovery.status === "pending") return recovery;
  if (await checkAccountDeviceSession(env.DB, recovery.userId, device.deviceId, now) !== "active") {
    return null;
  }
  const refresh = await findExactCanonicalRefresh(env.DB, {
    userId: recovery.userId,
    deviceId: device.deviceId,
    expectedHash: recovery.refreshTokenHash,
  }, now);
  if (!refresh) return null;
  const recoveredUser = await readRecoveryUser(env, input.provider, recovery.userId);
  if (!recoveredUser) return null;
  if (recoveredUser.authUser.family_id !== refresh.family_id) return null;
  const boundUser: AuthUser = { ...recoveredUser.authUser, device_id: device.deviceId };
  const accessToken = await signAccessToken(
    env,
    boundUser,
    "1h",
    recovery.accessJti,
    recovery.refreshTokenHash,
  );
  return {
    status: "ready",
    accountStatus: recovery.accountStatus,
    user: recoveredUser.apiUser,
    accessToken,
    refreshToken: refresh.token,
    accessJti: recovery.accessJti,
  };
}

export async function acknowledgeRecoveredOAuthSession(
  env: Env,
  input: {
    provider: string;
    recoveryId: string;
    userId: string;
    deviceId: string;
    accessJti: string;
  },
  now = new Date(),
): Promise<boolean> {
  const recovery = await readOAuthRecovery(env.DB, {
    provider: input.provider,
    recoveryId: input.recoveryId,
    deviceId: input.deviceId,
  }, now);
  if (
    !recovery
    || recovery.status !== "ready"
    || recovery.userId !== input.userId
    || recovery.accessJti !== input.accessJti
    || await checkAccountDeviceSession(env.DB, input.userId, input.deviceId, now) !== "active"
  ) return false;
  const refresh = await findExactCanonicalRefresh(env.DB, {
    userId: input.userId,
    deviceId: input.deviceId,
    expectedHash: recovery.refreshTokenHash,
  }, now);
  if (!refresh) return false;
  return acknowledgeOAuthRecovery(env.DB, input, now);
}

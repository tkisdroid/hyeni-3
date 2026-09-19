import type { AuthUser, Env } from "../types";
import { signAccessToken } from "./jwt";
import { issueRefreshToken, newOpaqueToken } from "./refresh";
import {
  requireDeviceDescriptor,
  takeOverAccountDeviceSession,
  type AccountDeviceDescriptor,
} from "./accountDeviceSession";
import { revokeFamilyRealtimeUser } from "./realtime";
import {
  hashOAuthSecret,
  type OAuthRecoveryAccountStatus,
} from "./oauthState";
import { pgTs } from "./time";

export interface IssuedAccountSession {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
  device: AccountDeviceDescriptor;
}

export interface OAuthRecoveryGrant {
  provider: string;
  recoveryId: string;
  accountStatus: OAuthRecoveryAccountStatus;
}

async function revokePreviousRealtimeSession(env: Env, user: AuthUser): Promise<void> {
  if (!user.family_id) return;
  try {
    await revokeFamilyRealtimeUser(env, user.family_id, user.sub);
  } catch {
    try {
      await revokeFamilyRealtimeUser(env, user.family_id, user.sub);
    } catch {
      console.error("[auth/session] previous realtime session revoke failed");
    }
  }
}

/**
 * 반환 가능한 토큰을 만든 뒤 명시적으로 인증한 설치가 활성 세션을 인계한다.
 * 이전 refresh·푸시 endpoint는 활성 설치 변경과 같은 D1 batch에서 닫힌다.
 */
export async function issueAccountSession(
  env: Env,
  user: AuthUser,
  input: { deviceId?: unknown; deviceLabel?: unknown; devicePlatform?: unknown },
): Promise<IssuedAccountSession> {
  const device = requireDeviceDescriptor(input);
  const boundUser: AuthUser = { ...user, device_id: device.deviceId };
  const accessToken = await signAccessToken(env, boundUser);
  const persistentParent = user.role === "parent" && !user.is_anonymous;
  const refreshToken = await issueRefreshToken(
    env.DB,
    user.sub,
    user.family_id,
    device.deviceId,
    persistentParent,
  );
  try {
    await takeOverAccountDeviceSession(env.DB, user.sub, device, refreshToken, new Date(), persistentParent);
  } catch (error) {
    await env.DB.prepare("DELETE FROM refresh_tokens WHERE token=? AND user_id=?")
      .bind(refreshToken, user.sub)
      .run();
    throw error;
  }
  // 이미 연결된 이전 설치의 WebSocket도 즉시 닫는다. D1 정본 전환은 위에서 끝났으므로
  // 일시적인 DO 오류가 새 기기 로그인을 되돌리지는 않되 한 번 더 시도한다.
  await revokePreviousRealtimeSession(env, user);
  return { accessToken, refreshToken, user: boundUser, device };
}

/**
 * 네이티브 OAuth 최초 세션과 recovery ready 표식을 한 D1 원자 경계에서 확정한다.
 * recovery row에는 raw bearer/device/token 대신 SHA-256 해시와 session JTI만 남는다.
 */
export async function issueRecoverableAccountSession(
  env: Env,
  user: AuthUser,
  input: {
    deviceId?: unknown;
    deviceLabel?: unknown;
    devicePlatform?: unknown;
    recovery: OAuthRecoveryGrant;
  },
): Promise<IssuedAccountSession & { accessJti: string }> {
  const device = requireDeviceDescriptor(input);
  const recoveryIdHash = await hashOAuthSecret(input.recovery.recoveryId);
  const recoveryBindingHash = await hashOAuthSecret(
    `${input.recovery.recoveryId}\0${device.deviceId}`,
  );
  const accessJti = crypto.randomUUID();
  const refreshToken = newOpaqueToken();
  const refreshTokenHash = await hashOAuthSecret(refreshToken);
  const now = new Date();
  const nowIso = now.toISOString();
  const oauthNow = pgTs(now);
  const refreshExpiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const deviceExpiresAt = refreshExpiresAt;

  const readyMatch = `provider=? AND flow_mode='login'
    AND recovery_id_hash=? AND recovery_binding_hash=?
    AND recovery_user_id=? AND recovery_access_jti=?
    AND recovery_refresh_token_hash=? AND recovery_ready_at=?
    AND recovery_acknowledged_at IS NULL AND recovery_expires_at>?`;
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE oauth_state_transactions
          SET recovery_user_id=?, recovery_account_status=?, recovery_access_jti=?,
              recovery_refresh_token_hash=?, recovery_ready_at=?
        WHERE provider=? AND flow_mode='login'
          AND recovery_id_hash=? AND recovery_binding_hash=?
          AND consumed_at IS NOT NULL AND recovery_ready_at IS NULL
          AND recovery_acknowledged_at IS NULL AND recovery_expires_at>?
          AND EXISTS(SELECT 1 FROM users WHERE id=?)
          AND NOT EXISTS(
            SELECT 1 FROM account_deletion_scopes
             WHERE (scope_type='user' AND scope_id=?)
                OR (? IS NOT NULL AND scope_type='family' AND scope_id=?)
          )`,
    ).bind(
      user.sub,
      input.recovery.accountStatus,
      accessJti,
      refreshTokenHash,
      oauthNow,
      input.recovery.provider,
      recoveryIdHash,
      recoveryBindingHash,
      oauthNow,
      user.sub,
      user.sub,
      user.family_id,
      user.family_id,
    ),
    env.DB.prepare(
      `INSERT INTO refresh_tokens
         (token,user_id,family_id,device_id,issued_at,expires_at,revoked)
       SELECT ?,?,?,?,?,?,0
        WHERE EXISTS(
          SELECT 1 FROM oauth_state_transactions WHERE ${readyMatch}
        )`,
    ).bind(
      refreshToken,
      user.sub,
      user.family_id,
      device.deviceId,
      nowIso,
      refreshExpiresAt,
      input.recovery.provider,
      recoveryIdHash,
      recoveryBindingHash,
      user.sub,
      accessJti,
      refreshTokenHash,
      oauthNow,
      oauthNow,
    ),
    env.DB.prepare(
      `UPDATE refresh_tokens SET revoked=1,rotated_to=NULL,rotated_at=?
        WHERE user_id=? AND token<>? AND revoked=0
          AND EXISTS(
            SELECT 1 FROM refresh_tokens current
             WHERE current.token=? AND current.user_id=? AND current.device_id=?
               AND current.revoked=0 AND current.expires_at>?
          )`,
    ).bind(
      nowIso,
      user.sub,
      refreshToken,
      refreshToken,
      user.sub,
      device.deviceId,
      nowIso,
    ),
    env.DB.prepare(
      `UPDATE fcm_tokens SET disabled_at=?,disabled_reason='device_session_replaced'
        WHERE user_id=? AND disabled_at IS NULL
          AND EXISTS(SELECT 1 FROM refresh_tokens WHERE token=? AND revoked=0)`,
    ).bind(nowIso, user.sub, refreshToken),
    env.DB.prepare(
      `UPDATE push_subscriptions SET disabled_at=?,disabled_reason='device_session_replaced'
        WHERE user_id=? AND disabled_at IS NULL
          AND EXISTS(SELECT 1 FROM refresh_tokens WHERE token=? AND revoked=0)`,
    ).bind(nowIso, user.sub, refreshToken),
    env.DB.prepare(
      `INSERT INTO account_device_sessions
         (user_id,device_id,device_label,device_platform,claimed_at,last_seen_at,expires_at,revoked_at)
       SELECT ?,?,?,?,?,?,?,NULL
        WHERE EXISTS(
          SELECT 1 FROM refresh_tokens
           WHERE token=? AND user_id=? AND device_id=? AND revoked=0 AND expires_at>?
        )
       ON CONFLICT(user_id) DO UPDATE SET
         device_id=excluded.device_id,
         device_label=COALESCE(excluded.device_label,account_device_sessions.device_label),
         device_platform=COALESCE(excluded.device_platform,account_device_sessions.device_platform),
         claimed_at=CASE
           WHEN account_device_sessions.device_id=excluded.device_id
             THEN account_device_sessions.claimed_at
           ELSE excluded.claimed_at
         END,
         last_seen_at=excluded.last_seen_at,
         expires_at=excluded.expires_at,
         revoked_at=NULL`,
    ).bind(
      user.sub,
      device.deviceId,
      device.deviceLabel ?? null,
      device.devicePlatform ?? null,
      nowIso,
      nowIso,
      deviceExpiresAt,
      refreshToken,
      user.sub,
      device.deviceId,
      nowIso,
    ),
  ]);

  if (
    Number(results[0]?.meta?.changes ?? 0) !== 1
    || Number(results[1]?.meta?.changes ?? 0) !== 1
    || Number(results[5]?.meta?.changes ?? 0) !== 1
  ) {
    throw new Error("oauth_recovery_session_issue_failed");
  }

  const boundUser: AuthUser = { ...user, device_id: device.deviceId };
  // DB 확정 뒤 서명한다. 이 지점에서 Worker가 종료돼도 recovery가 같은 JTI로 재서명할 수 있다.
  const accessToken = await signAccessToken(
    env,
    boundUser,
    "1h",
    accessJti,
    refreshTokenHash,
  );
  await revokePreviousRealtimeSession(env, user);
  return { accessToken, refreshToken, user: boundUser, device, accessJti };
}

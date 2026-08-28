import type { Env } from "../types";
import { checkAccountDeviceSession } from "./accountDeviceSession";
import { verifyAccessToken, type AccessClaims } from "./jwt";
import { isOAuthRecoveryAccessGenerationActive } from "./oauthRecovery";

export class DeviceSessionInactiveError extends Error {
  readonly code = "device_session_inactive";
}

export class ActiveAccessUnavailableError extends Error {
  readonly code = "auth_unavailable";
}

export function isDeviceSessionInactiveError(error: unknown): boolean {
  return error instanceof DeviceSessionInactiveError;
}

export function isActiveAccessUnavailableError(error: unknown): boolean {
  return error instanceof ActiveAccessUnavailableError;
}

/** 서명뿐 아니라 계정당 활성 설치까지 확인한 access token만 반환한다. */
export async function verifyActiveAccessToken(
  env: Env,
  db: D1Database,
  token: string,
): Promise<AccessClaims> {
  const claims = await verifyAccessToken(env, token);
  let deviceState: Awaited<ReturnType<typeof checkAccountDeviceSession>>;
  try {
    deviceState = await checkAccountDeviceSession(db, claims.sub, claims.device_id);
  } catch {
    throw new ActiveAccessUnavailableError("active access verification unavailable");
  }
  if (deviceState === "inactive") throw new DeviceSessionInactiveError("device session inactive");
  if (claims.oauth_recovery_refresh_hash) {
    try {
      const active = !!claims.device_id && await isOAuthRecoveryAccessGenerationActive(db, {
        userId: claims.sub,
        deviceId: claims.device_id,
        refreshTokenHash: claims.oauth_recovery_refresh_hash,
      });
      if (!active) throw new DeviceSessionInactiveError("recovery session generation inactive");
    } catch (error) {
      if (error instanceof DeviceSessionInactiveError) throw error;
      throw new ActiveAccessUnavailableError("recovery access verification unavailable");
    }
  }
  return claims;
}

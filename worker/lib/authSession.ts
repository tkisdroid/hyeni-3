import type { AuthUser, Env } from "../types";
import { signAccessToken } from "./jwt";
import { issueRefreshToken } from "./refresh";
import {
  claimAccountDeviceSession,
  requireDeviceDescriptor,
  type AccountDeviceDescriptor,
} from "./accountDeviceSession";

export interface IssuedAccountSession {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
  device: AccountDeviceDescriptor;
}

/**
 * 반환 가능한 토큰을 만든 뒤 활성 설치를 원자적으로 선점한다.
 * 선점 실패 시 방금 만든 refresh만 폐기해 다른 설치에는 유효 세션이 남지 않는다.
 */
export async function issueAccountSession(
  env: Env,
  user: AuthUser,
  input: { deviceId?: unknown; deviceLabel?: unknown; devicePlatform?: unknown },
): Promise<IssuedAccountSession> {
  const device = requireDeviceDescriptor(input);
  const boundUser: AuthUser = { ...user, device_id: device.deviceId };
  const accessToken = await signAccessToken(env, boundUser);
  const refreshToken = await issueRefreshToken(
    env.DB,
    user.sub,
    user.family_id,
    device.deviceId,
  );
  try {
    await claimAccountDeviceSession(env.DB, user.sub, device);
  } catch (error) {
    await env.DB.prepare("DELETE FROM refresh_tokens WHERE token=? AND user_id=?")
      .bind(refreshToken, user.sub)
      .run();
    throw error;
  }
  return { accessToken, refreshToken, user: boundUser, device };
}

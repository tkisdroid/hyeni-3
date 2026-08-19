import type { AuthUser, Env } from "../types";
import { signAccessToken } from "./jwt";
import { issueRefreshToken } from "./refresh";
import {
  requireDeviceDescriptor,
  takeOverAccountDeviceSession,
  type AccountDeviceDescriptor,
} from "./accountDeviceSession";
import { revokeFamilyRealtimeUser } from "./realtime";

export interface IssuedAccountSession {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
  device: AccountDeviceDescriptor;
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
  const refreshToken = await issueRefreshToken(
    env.DB,
    user.sub,
    user.family_id,
    device.deviceId,
  );
  try {
    await takeOverAccountDeviceSession(env.DB, user.sub, device, refreshToken);
  } catch (error) {
    await env.DB.prepare("DELETE FROM refresh_tokens WHERE token=? AND user_id=?")
      .bind(refreshToken, user.sub)
      .run();
    throw error;
  }
  // 이미 연결된 이전 설치의 WebSocket도 즉시 닫는다. D1 정본 전환은 위에서 끝났으므로
  // 일시적인 DO 오류가 새 기기 로그인을 되돌리지는 않되 한 번 더 시도한다.
  if (user.family_id) {
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
  return { accessToken, refreshToken, user: boundUser, device };
}

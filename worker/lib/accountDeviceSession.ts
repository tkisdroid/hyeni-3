const DEVICE_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type AccountDevicePlatform = "android" | "ios" | "web";

export interface AccountDeviceDescriptor {
  deviceId: string;
  deviceLabel?: string | null;
  devicePlatform?: AccountDevicePlatform | null;
}

export type AccountDeviceSessionCheck = "active" | "legacy" | "inactive";

export class DeviceIdentityRequiredError extends Error {
  readonly code = "device_identity_required";

  constructor() {
    super("device identity required");
    this.name = "DeviceIdentityRequiredError";
  }
}

export class ActiveDeviceSessionExistsError extends Error {
  readonly code = "active_device_session_exists";

  constructor() {
    super("another device session is active");
    this.name = "ActiveDeviceSessionExistsError";
  }
}

export function isDeviceIdentityRequiredError(error: unknown): boolean {
  return error instanceof DeviceIdentityRequiredError
    || (typeof error === "object" && error !== null && "code" in error
      && error.code === "device_identity_required");
}

export function isActiveDeviceSessionExistsError(error: unknown): boolean {
  return error instanceof ActiveDeviceSessionExistsError
    || (typeof error === "object" && error !== null && "code" in error
      && error.code === "active_device_session_exists");
}

export function normalizeDeviceLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const label = value.trim().replace(/\s+/g, " ");
  return label ? label.slice(0, 80) : null;
}

export function normalizeDevicePlatform(value: unknown): AccountDevicePlatform | null {
  return value === "android" || value === "ios" || value === "web" ? value : null;
}

function normalizeAccountDeviceId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const deviceId = value.trim();
  if (!deviceId || deviceId.length > 64) return null;
  return /^[A-Za-z0-9-]+$/.test(deviceId) ? deviceId : null;
}

export function requireDeviceDescriptor(input: {
  deviceId?: unknown;
  deviceLabel?: unknown;
  devicePlatform?: unknown;
}): AccountDeviceDescriptor {
  const deviceId = normalizeAccountDeviceId(input.deviceId);
  if (!deviceId) throw new DeviceIdentityRequiredError();
  return {
    deviceId,
    deviceLabel: normalizeDeviceLabel(input.deviceLabel),
    devicePlatform: normalizeDevicePlatform(input.devicePlatform),
  };
}

/**
 * 사용자별 한 행을 조건부 upsert해 활성 설치를 선형화한다.
 * 같은 설치의 재로그인/refresh, 만료 또는 정상 로그아웃된 행만 갱신할 수 있다.
 */
export async function claimAccountDeviceSession(
  db: D1Database,
  userId: string,
  device: AccountDeviceDescriptor,
  now = new Date(),
): Promise<void> {
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + DEVICE_SESSION_TTL_MS).toISOString();
  const result = await db
    .prepare(
      `INSERT INTO account_device_sessions
         (user_id,device_id,device_label,device_platform,claimed_at,last_seen_at,expires_at,revoked_at)
       VALUES (?,?,?,?,?,?,?,NULL)
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
         revoked_at=NULL
       WHERE account_device_sessions.device_id=excluded.device_id
          OR account_device_sessions.revoked_at IS NOT NULL
          OR account_device_sessions.expires_at<=excluded.claimed_at`,
    )
    .bind(
      userId,
      device.deviceId,
      device.deviceLabel ?? null,
      device.devicePlatform ?? null,
      nowIso,
      nowIso,
      expiresAt,
    )
    .run();
  if (Number(result.meta?.changes ?? 0) !== 1) {
    throw new ActiveDeviceSessionExistsError();
  }
}

/**
 * 명시적 본인 인증이 성공한 새 설치로 계정을 원자 전환한다.
 * 이전 설치의 API/refresh뿐 아니라 푸시 endpoint도 같은 batch에서 닫아,
 * 기존 기기에 가족 정보가 계속 전달되는 짧은 틈을 만들지 않는다.
 */
export async function takeOverAccountDeviceSession(
  db: D1Database,
  userId: string,
  device: AccountDeviceDescriptor,
  newRefreshToken: string,
  now = new Date(),
): Promise<void> {
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + DEVICE_SESSION_TTL_MS).toISOString();
  const results = await db.batch([
    db
      .prepare(
        `UPDATE refresh_tokens
            SET revoked=1, rotated_to=NULL, rotated_at=?
          WHERE user_id=? AND token<>? AND revoked=0`,
      )
      .bind(nowIso, userId, newRefreshToken),
    db
      .prepare(
        `UPDATE fcm_tokens
            SET disabled_at=?, disabled_reason='device_session_replaced'
          WHERE user_id=? AND disabled_at IS NULL`,
      )
      .bind(nowIso, userId),
    db
      .prepare(
        `UPDATE push_subscriptions
            SET disabled_at=?, disabled_reason='device_session_replaced'
          WHERE user_id=? AND disabled_at IS NULL`,
      )
      .bind(nowIso, userId),
    db
      .prepare(
        `INSERT INTO account_device_sessions
           (user_id,device_id,device_label,device_platform,claimed_at,last_seen_at,expires_at,revoked_at)
         VALUES (?,?,?,?,?,?,?,NULL)
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
      )
      .bind(
        userId,
        device.deviceId,
        device.deviceLabel ?? null,
        device.devicePlatform ?? null,
        nowIso,
        nowIso,
        expiresAt,
      ),
  ]);
  if (Number(results[3]?.meta?.changes ?? 0) !== 1) {
    throw new Error("account_device_session_takeover_failed");
  }
}

/** JWT의 설치 claim과 서버 활성 설치 정본을 대조한다. */
export async function checkAccountDeviceSession(
  db: D1Database,
  userId: string,
  tokenDeviceId: string | null | undefined,
  now = new Date(),
): Promise<AccountDeviceSessionCheck> {
  let row: { device_id: string; revoked_at: string | null; expires_at: string } | null;
  try {
    row = await db
      .prepare(
        `SELECT device_id,revoked_at,expires_at
           FROM account_device_sessions
          WHERE user_id=?
          LIMIT 1`,
      )
      .bind(userId)
      .first<{ device_id: string; revoked_at: string | null; expires_at: string }>();
  } catch (error) {
    // additive migration 직전의 레거시 access token만 계속 읽을 수 있게 한다.
    // 새 로그인/refresh는 이 테이블에 쓰므로 스키마가 없으면 발급 자체가 실패하며,
    // readiness manifest도 배포 완료를 인정하지 않는다.
    if (/no such table:\s*account_device_sessions/i.test(String(error))) return "legacy";
    throw error;
  }
  const normalized = normalizeAccountDeviceId(tokenDeviceId);
  if (!row) return normalized ? "inactive" : "legacy";
  if (!normalized || row.revoked_at || row.expires_at <= now.toISOString()) return "inactive";
  return row.device_id === normalized ? "active" : "inactive";
}

/** 정상 로그아웃한 동일 설치만 잠금을 해제한다. */
export async function releaseAccountDeviceSession(
  db: D1Database,
  userId: string,
  deviceId: string,
  now = new Date(),
): Promise<boolean> {
  const normalized = normalizeAccountDeviceId(deviceId);
  if (!normalized) return false;
  const result = await db
    .prepare(
      `UPDATE account_device_sessions
          SET revoked_at=?, last_seen_at=?
        WHERE user_id=? AND device_id=? AND revoked_at IS NULL`,
    )
    .bind(now.toISOString(), now.toISOString(), userId, normalized)
    .run();
  return Number(result.meta?.changes ?? 0) === 1;
}

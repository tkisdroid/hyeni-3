import { PERSISTENT_PARENT_SESSION_EXPIRY } from "./sessionLifetime";
// 불투명 refresh 토큰 발급/회전. D1 refresh_tokens 테이블에 저장.
import {
  claimAccountDeviceSession,
  requireDeviceDescriptor,
} from "./accountDeviceSession";

const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30일

export function newOpaqueToken(): string {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
}

export class RefreshTokenIssuanceBlockedError extends Error {
  readonly code = "refresh_token_issuance_blocked";

  constructor() {
    super("refresh token issuance blocked");
    this.name = "RefreshTokenIssuanceBlockedError";
  }
}

export function isRefreshTokenIssuanceBlocked(error: unknown): boolean {
  return error instanceof RefreshTokenIssuanceBlockedError
    || (typeof error === "object"
      && error !== null
      && "code" in error
      && error.code === "refresh_token_issuance_blocked");
}

export async function issueRefreshToken(
  db: D1Database,
  userId: string,
  familyId: string | null,
  deviceId: string | null = null,
  persistentParent = false,
): Promise<string> {
  const token = newOpaqueToken();
  const now = new Date();
  const result = await db
    .prepare(
      `INSERT INTO refresh_tokens(token,user_id,family_id,device_id,issued_at,expires_at,revoked)
       SELECT ?,?,?,?,?,?,0
        WHERE EXISTS(SELECT 1 FROM users WHERE id=?)
          AND NOT EXISTS(
            SELECT 1 FROM account_deletion_scopes
             WHERE (scope_type='user' AND scope_id=?)
                OR (? IS NOT NULL AND scope_type='family' AND scope_id=?)
          )`,
    )
    .bind(
      token,
      userId,
      familyId,
      deviceId,
      now.toISOString(),
      persistentParent && deviceId
        ? PERSISTENT_PARENT_SESSION_EXPIRY
        : new Date(now.getTime() + REFRESH_TTL_MS).toISOString(),
      userId,
      userId,
      familyId,
      familyId,
    )
    .run();
  if (Number(result.meta?.changes ?? 0) !== 1) {
    throw new RefreshTokenIssuanceBlockedError();
  }
  return token;
}

export interface RotatedToken {
  userId: string;
  familyId: string | null;
  deviceId: string | null;
  newToken: string;
}

// 재사용 유예(초) — 직전 회전의 재시도(동시 401 레이스·회전 직후 프로세스 킬)를 멱등으로 흡수.
// 유예가 없으면 폐기 토큰 재사용 → rejected → 클라가 세션을 지워 "아이 기기가 자꾸 풀리는" 사고가 난다.
const ROTATE_REUSE_GRACE_MS = 60 * 1000;

// deviceInstallId 정규화 — uuid 또는 dev-* 폴백(클라 생성). 이상값은 null 로 무시.
export function normalizeDeviceId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v || v.length > 64) return null;
  return /^[A-Za-z0-9-]+$/.test(v) ? v : null;
}

// 30일 수명 동안 네이티브·WebView가 시간당 회전해도 복구할 수 있는 상한.
// 실측 razr는 2.5일에 88행이어서 20-hop은 하루도 못 버텼다. 재귀 CTE 한 번으로
// 인과 체인만 따라가며, 이 상한은 DB 손상에 의한 순환·무한 재귀도 차단한다.
const MAX_CHAIN_HOPS = 2048;

interface RefreshTokenRow {
  user_id: string;
  family_id: string | null;
  device_id: string | null;
  expires_at: string;
  revoked: number;
  rotated_to: string | null;
  rotated_at: string | null;
}

/**
 * rotated_to 체인을 따라가 아직 살아 있는(revoked=0, 미만료) 토큰을 찾는다.
 * 뒤처진 홀더를 현재 토큰으로 재동기화하기 위한 조회. 없으면 null.
 */
async function findLiveTokenInChain(
  db: D1Database,
  startToken: string,
  maxHops: number,
): Promise<RotatedToken | null> {
  if (!startToken || maxHops < 1) return null;
  const row = await db
    .prepare(
      `WITH RECURSIVE token_chain(
         token, user_id, family_id, device_id, expires_at, revoked, rotated_to, depth
       ) AS (
         SELECT token, user_id, family_id, device_id, expires_at, revoked, rotated_to, 0
         FROM refresh_tokens
         WHERE token=?
         UNION ALL
         SELECT next.token, next.user_id, next.family_id, next.device_id,
                next.expires_at, next.revoked, next.rotated_to, token_chain.depth + 1
         FROM token_chain
         JOIN refresh_tokens next ON next.token=token_chain.rotated_to
         WHERE token_chain.depth + 1 < ?
       )
       SELECT user_id, family_id, device_id, token AS live_token
       FROM token_chain
       WHERE revoked=0 AND expires_at>?
         AND EXISTS(SELECT 1 FROM users WHERE id=token_chain.user_id)
         AND NOT EXISTS(
           SELECT 1 FROM account_deletion_scopes
            WHERE (scope_type='user' AND scope_id=token_chain.user_id)
               OR (token_chain.family_id IS NOT NULL
                   AND scope_type='family' AND scope_id=token_chain.family_id)
         )
       ORDER BY depth ASC
       LIMIT 1`,
    )
    .bind(startToken, maxHops, new Date().toISOString())
    .first<{
      user_id: string;
      family_id: string | null;
      device_id: string | null;
      live_token: string;
    }>();
  if (!row) return null;
  return {
    userId: row.user_id,
    familyId: row.family_id,
    deviceId: row.device_id,
    newToken: row.live_token,
  };
}

async function resolveRevokedRefreshToken(
  db: D1Database,
  row: RefreshTokenRow,
  presentedDeviceId: string | null,
): Promise<RotatedToken | null> {
  if (row.device_id && row.device_id !== presentedDeviceId) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;

  const deviceBound = !!row.device_id;
  const withinGrace =
    !!row.rotated_at && Date.now() - new Date(row.rotated_at).getTime() < ROTATE_REUSE_GRACE_MS;
  if (!row.rotated_to) return null;
  if (!deviceBound && !withinGrace) return null;
  return findLiveTokenInChain(db, row.rotated_to, deviceBound ? MAX_CHAIN_HOPS : 1);
}

export async function rotateRefreshToken(
  db: D1Database,
  oldToken: string,
  presentedDeviceId: string | null = null,
  deviceMeta: { deviceLabel?: unknown; devicePlatform?: unknown } = {},
): Promise<RotatedToken | null> {
  const row = await db
    .prepare("SELECT * FROM refresh_tokens WHERE token=?")
    .bind(oldToken)
    .first<RefreshTokenRow>();
  if (!row) return null;

  // 기기 바인딩: device_id 가 스탬핑된 체인은 같은 deviceInstallId 를 제시해야만 회전할 수 있다.
  // 세션 사본(외부 검증 도구·유출 토큰)이 체인을 회전시켜 원 기기를 고아로 만드는 사고를 차단한다.
  // 레거시 체인(device_id NULL)은 하위호환으로 허용하고, 회전 시 제시된 기기 id 로 점진 스탬핑한다.
  if (row.device_id && row.device_id !== presentedDeviceId) return null;

  // 제시한 토큰 자체의 30일 수명이 끝났으면, 폐기 토큰이라도 후속 체인으로 복귀시키지 않는다.
  // device_install_id는 비밀 증명이 아니므로 만료 토큰의 장기 재사용 창을 열어서는 안 된다.
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;

  if (row.revoked) {
    // 이미 회전된 토큰의 재사용 처리.
    //
    // 같은 기기 안에서 WebView 와 네이티브 위치 서비스가 각자 refresh 를 회전하다 보면
    // 체인이 갈라지고(실측: 0.7초 간격 2회전), 낙오한 쪽이 폐기 토큰을 들고 남는다.
    // 그 쪽은 다음 회전에서 401 → 네이티브가 위치 서비스를 멈춘다(혜니 위치 89분 중단 사고).
    //
    // 기기 바인딩(device_id)이 이미 위 게이트에서 검증됐으므로, **같은 기기**의 폐기 토큰은
    // 도난이 아니라 "뒤처진 홀더"로 보고 체인을 따라가 현재 살아 있는 토큰으로 재동기화한다.
    // 탈취자는 device_id 불일치로 위에서 이미 차단된다.
    //
    // device_id 가 없는 레거시 체인은 기존 60초 유예 + 1단계만 유지(보수적).
    const live = await resolveRevokedRefreshToken(db, row, presentedDeviceId);
    if (!live) return null;
    const device = requireDeviceDescriptor({
      deviceId: live.deviceId ?? presentedDeviceId,
      ...deviceMeta,
    });
    await claimAccountDeviceSession(db, live.userId, device);
    return live;
  }

  // 유효 refresh를 회전시키기 전에 계정당 활성 설치를 먼저 선점한다. 다른 설치가
  // 활성 상태면 old token을 건드리지 않아 원래 기기의 세션 체인이 보존된다.
  const activeDevice = requireDeviceDescriptor({
    deviceId: row.device_id ?? presentedDeviceId,
    ...deviceMeta,
  });
  await claimAccountDeviceSession(db, row.user_id, activeDevice);

  // old claim과 새 token INSERT를 한 D1 batch로 선형화한다. 동일 old token의 동시 회전은
  // 조건부 UPDATE를 먼저 성공한 한 요청만 새 token을 만들고, 나머지는 그 체인으로 재동기화한다.
  // 계정 삭제 scope가 먼저 생겼거나 users 행이 사라졌다면 두 statement 모두 0건으로 닫힌다.
  const newToken = newOpaqueToken();
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = row.expires_at === PERSISTENT_PARENT_SESSION_EXPIRY
    ? PERSISTENT_PARENT_SESSION_EXPIRY
    : new Date(now.getTime() + REFRESH_TTL_MS).toISOString();
  const results = await db.batch([
    db
      .prepare(
        `UPDATE refresh_tokens
            SET revoked=1, rotated_to=?, rotated_at=?
          WHERE token=? AND revoked=0 AND expires_at>?
            AND (device_id IS NULL OR device_id=?)
            AND EXISTS(SELECT 1 FROM users WHERE id=refresh_tokens.user_id)
            AND NOT EXISTS(
              SELECT 1 FROM account_deletion_scopes
               WHERE (scope_type='user' AND scope_id=refresh_tokens.user_id)
                  OR (refresh_tokens.family_id IS NOT NULL
                      AND scope_type='family' AND scope_id=refresh_tokens.family_id)
            )`,
      )
      .bind(newToken, nowIso, oldToken, nowIso, presentedDeviceId),
    db
      .prepare(
        `INSERT INTO refresh_tokens(token,user_id,family_id,device_id,issued_at,expires_at,revoked)
         SELECT ?, old.user_id, old.family_id, COALESCE(old.device_id, ?), ?, ?, 0
           FROM refresh_tokens old
          WHERE old.token=? AND old.revoked=1 AND old.rotated_to=?
            AND EXISTS(SELECT 1 FROM users WHERE id=old.user_id)
            AND NOT EXISTS(
              SELECT 1 FROM account_deletion_scopes
               WHERE (scope_type='user' AND scope_id=old.user_id)
                  OR (old.family_id IS NOT NULL
                      AND scope_type='family' AND scope_id=old.family_id)
            )`,
      )
      .bind(newToken, presentedDeviceId, nowIso, expiresAt, oldToken, newToken),
  ]);
  if (
    Number(results[0]?.meta?.changes ?? 0) !== 1
    || Number(results[1]?.meta?.changes ?? 0) !== 1
  ) {
    const raced = await db
      .prepare("SELECT * FROM refresh_tokens WHERE token=?")
      .bind(oldToken)
      .first<RefreshTokenRow>();
    return raced?.revoked
      ? resolveRevokedRefreshToken(db, raced, presentedDeviceId)
      : null;
  }
  return {
    userId: row.user_id,
    familyId: row.family_id,
    deviceId: row.device_id ?? presentedDeviceId,
    newToken,
  };
}

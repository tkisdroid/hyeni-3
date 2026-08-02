export interface FcmTokenOwnershipInput {
  id: string;
  userId: string;
  familyId: string;
  token: string;
  platform: string;
  registrationInstanceId: string;
  now: string;
}

export interface PushSubscriptionOwnershipInput {
  id: string;
  userId: string;
  familyId: string;
  endpoint: string;
  subscription: string;
  registrationInstanceId: string;
  now: string;
}

export interface LegacyFcmTokenRefreshInput {
  userId: string;
  familyId: string;
  token: string;
  platform: string;
  now: string;
}

const ENDPOINT_SCHEMA_ERROR = "notification_endpoint_schema_unavailable";

type EndpointTable = "fcm_tokens" | "push_subscriptions";

const ENDPOINT_UNIQUE_INDEX: Record<EndpointTable, string> = {
  fcm_tokens: "idx_fcm_tokens_token_active_unique",
  push_subscriptions: "idx_push_subscriptions_endpoint_active_unique",
};

export class NotificationEndpointSchemaUnavailableError extends Error {
  readonly code = ENDPOINT_SCHEMA_ERROR;

  constructor(table: EndpointTable) {
    super(`${ENDPOINT_SCHEMA_ERROR}:${table}`);
    this.name = "NotificationEndpointSchemaUnavailableError";
  }
}

export function isNotificationEndpointSchemaUnavailable(
  error: unknown,
): error is NotificationEndpointSchemaUnavailableError {
  return error instanceof NotificationEndpointSchemaUnavailableError
    || (typeof error === "object"
      && error !== null
      && "code" in error
      && error.code === ENDPOINT_SCHEMA_ERROR);
}

function hasRequiredValues(values: string[]): boolean {
  return values.every((value) => typeof value === "string" && value.trim().length > 0);
}

// migration이 덜 적용된 스키마에서는 legacy mutation으로 보안 계약을 약화하지 않는다.
// 컬럼과 active-only UNIQUE가 모두 준비된 뒤에만 최신 등록·해제를 연다.
async function assertEndpointSchemaReady(db: D1Database, table: EndpointTable): Promise<void> {
  try {
    await db.prepare(
      `SELECT registration_instance_id, disabled_at, disabled_reason FROM ${table} LIMIT 1`,
    ).first();
    const uniqueIndex = await db.prepare(
      `SELECT 1 AS ok
         FROM pragma_index_list('${table}')
        WHERE name = ? AND "unique" = 1
        LIMIT 1`,
    )
      .bind(ENDPOINT_UNIQUE_INDEX[table])
      .first<{ ok: number }>();
    if (!uniqueIndex) throw new Error("missing_unique_index");
  } catch {
    throw new NotificationEndpointSchemaUnavailableError(table);
  }
}

// active-only UNIQUE와 한 문장의 조건부 upsert로 같은 등록 세션만 갱신한다.
// 타 사용자·타 세션 이관은 거부하고 exact 해제 뒤 새 세션 insert만 허용한다.
export async function upsertFcmTokenOwnership(
  db: D1Database,
  input: FcmTokenOwnershipInput,
): Promise<boolean> {
  if (!hasRequiredValues([
    input.id,
    input.userId,
    input.familyId,
    input.token,
    input.platform,
    input.registrationInstanceId,
    input.now,
  ])) {
    throw new Error("invalid_fcm_token_ownership");
  }
  await assertEndpointSchemaReady(db, "fcm_tokens");
  const result = await db.prepare(
    `INSERT INTO fcm_tokens
       (id, user_id, family_id, fcm_token, platform, registration_instance_id,
        created_at, updated_at, disabled_at, disabled_reason)
     SELECT ?,?,?,?,?,?,?,?,NULL,NULL
      WHERE NOT EXISTS (
        SELECT 1 FROM fcm_tokens
         WHERE fcm_token = ?
           AND registration_instance_id = ?
           AND disabled_at IS NOT NULL
      )
     ON CONFLICT(fcm_token) WHERE disabled_at IS NULL DO UPDATE SET
       platform = excluded.platform,
       registration_instance_id = excluded.registration_instance_id,
       updated_at = excluded.updated_at
     WHERE fcm_tokens.user_id = excluded.user_id
       AND fcm_tokens.family_id = excluded.family_id
       AND (
         fcm_tokens.registration_instance_id = excluded.registration_instance_id
         OR fcm_tokens.registration_instance_id LIKE 'legacy:%'
       )`,
  )
    .bind(
      input.id,
      input.userId,
      input.familyId,
      input.token.trim(),
      input.platform,
      input.registrationInstanceId.trim(),
      input.now,
      input.now,
      input.token.trim(),
      input.registrationInstanceId.trim(),
    )
    .run();
  return (result.meta.changes ?? 0) > 0;
}

function isMissingDisabledColumn(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no such column[^\n]*disabled_at|has no column named disabled_at/i.test(message);
}

// registration_instance_id를 보내지 못하는 구버전 Android는 이미 존재하는 동일
// token+user+family 행의 시각/플랫폼만 갱신한다. 새 행 생성이나 소유권 이관은 하지 않는다.
// migration 이전에도 이 제한 갱신만 허용해 설치된 구버전의 토큰 재등록을 유지한다.
export async function refreshLegacyFcmTokenOwnership(
  db: D1Database,
  input: LegacyFcmTokenRefreshInput,
): Promise<boolean> {
  if (!hasRequiredValues([
    input.userId,
    input.familyId,
    input.token,
    input.platform,
    input.now,
  ])) return false;

  const bindings = [
    input.platform,
    input.now,
    input.token.trim(),
    input.userId,
    input.familyId,
  ] as const;
  try {
    const result = await db.prepare(
      `UPDATE fcm_tokens
          SET platform = ?, updated_at = ?
        WHERE fcm_token = ?
          AND user_id = ?
          AND family_id = ?
          AND disabled_at IS NULL`,
    ).bind(...bindings).run();
    return (result.meta.changes ?? 0) > 0;
  } catch (error) {
    if (!isMissingDisabledColumn(error)) throw error;
    const legacyResult = await db.prepare(
      `UPDATE fcm_tokens
          SET platform = ?, updated_at = ?
        WHERE fcm_token = ?
          AND user_id = ?
          AND family_id = ?`,
    ).bind(...bindings).run();
    return (legacyResult.meta.changes ?? 0) > 0;
  }
}

// 새 소유자가 등록한 뒤 옛 계정의 logout이 늦게 도착해도 현재 활성 행을 닫지 않는다.
export async function unregisterOwnedFcmToken(
  db: D1Database,
  input: { token: string; userId: string; registrationInstanceId: string; now: string },
): Promise<boolean> {
  if (!hasRequiredValues([input.token, input.userId, input.registrationInstanceId, input.now])) return false;
  await assertEndpointSchemaReady(db, "fcm_tokens");
  const result = await db
    .prepare(
      `UPDATE fcm_tokens
          SET disabled_at = ?, disabled_reason = 'session_unregistered'
        WHERE fcm_token = ?
          AND user_id = ?
          AND registration_instance_id = ?
          AND disabled_at IS NULL`,
    )
    .bind(input.now, input.token.trim(), input.userId, input.registrationInstanceId.trim())
    .run();
  return (result.meta.changes ?? 0) > 0;
}

// 웹 푸시 endpoint는 타 사용자·타 등록 세션이 이미 소유하면 409 계약을 유지한다.
// 조건부 UPDATE 한 문장으로 동일 세션 갱신만 허용해 동시 INSERT를 차단한다.
export async function upsertPushSubscriptionOwnership(
  db: D1Database,
  input: PushSubscriptionOwnershipInput,
): Promise<boolean> {
  if (!hasRequiredValues([
    input.id,
    input.userId,
    input.familyId,
    input.endpoint,
    input.subscription,
    input.registrationInstanceId,
    input.now,
  ])) {
    throw new Error("invalid_push_subscription_ownership");
  }
  await assertEndpointSchemaReady(db, "push_subscriptions");
  const result = await db.prepare(
    `INSERT INTO push_subscriptions
       (id, user_id, family_id, endpoint, subscription, registration_instance_id,
        created_at, updated_at, disabled_at, disabled_reason)
     SELECT ?,?,?,?,?,?,?,?,NULL,NULL
      WHERE NOT EXISTS (
        SELECT 1 FROM push_subscriptions
         WHERE endpoint = ?
           AND registration_instance_id = ?
           AND disabled_at IS NOT NULL
      )
     ON CONFLICT(endpoint) WHERE disabled_at IS NULL DO UPDATE SET
       family_id = excluded.family_id,
       subscription = excluded.subscription,
       registration_instance_id = excluded.registration_instance_id,
       updated_at = excluded.updated_at
     WHERE push_subscriptions.user_id = excluded.user_id
       AND push_subscriptions.family_id = excluded.family_id
       AND (
         push_subscriptions.registration_instance_id = excluded.registration_instance_id
         OR push_subscriptions.registration_instance_id LIKE 'legacy:%'
       )`,
  )
    .bind(
      input.id,
      input.userId,
      input.familyId,
      input.endpoint.trim(),
      input.subscription,
      input.registrationInstanceId.trim(),
      input.now,
      input.now,
      input.endpoint.trim(),
      input.registrationInstanceId.trim(),
    )
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function unregisterOwnedPushSubscription(
  db: D1Database,
  input: { endpoint: string; userId: string; registrationInstanceId: string; now: string },
): Promise<boolean> {
  if (!hasRequiredValues([input.endpoint, input.userId, input.registrationInstanceId, input.now])) return false;
  await assertEndpointSchemaReady(db, "push_subscriptions");
  const result = await db.prepare(
    `UPDATE push_subscriptions
        SET disabled_at = ?, disabled_reason = 'session_unregistered'
      WHERE endpoint = ?
        AND user_id = ?
        AND registration_instance_id = ?
        AND disabled_at IS NULL`,
  )
    .bind(input.now, input.endpoint.trim(), input.userId, input.registrationInstanceId.trim())
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function isPushSubscriptionRegistrationCurrent(
  db: D1Database,
  input: {
    endpoint: string;
    userId: string;
    familyId: string;
    registrationInstanceId: string;
  },
): Promise<boolean> {
  if (!hasRequiredValues([
    input.endpoint,
    input.userId,
    input.familyId,
    input.registrationInstanceId,
  ])) return false;
  await assertEndpointSchemaReady(db, "push_subscriptions");
  const row = await db.prepare(
    `SELECT 1 AS ok
       FROM push_subscriptions
      WHERE endpoint = ?
        AND user_id = ?
        AND family_id = ?
        AND registration_instance_id = ?
        AND disabled_at IS NULL
      LIMIT 1`,
  )
    .bind(
      input.endpoint.trim(),
      input.userId,
      input.familyId,
      input.registrationInstanceId.trim(),
    )
    .first<{ ok: number }>();
  return !!row;
}

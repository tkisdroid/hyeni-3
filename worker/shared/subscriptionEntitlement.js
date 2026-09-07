function normalizeStatus(status) {
  return String(status || "").trim().toLowerCase();
}

const LEGACY_PREMIUM_TIERS = new Set(["premium", "subscription", "active", "grace"]);

function isLegacyPremiumTier(value) {
  return LEGACY_PREMIUM_TIERS.has(normalizeStatus(value));
}

function futureDate(value, now) {
  if (typeof value !== "string" || !value.trim()) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > now.getTime();
}

/**
 * @param {string | null | undefined} status
 * @param {string | null | undefined} trialEndsAt
 * @param {string | null | undefined} currentPeriodEnd
 * @param {Date} now
 */
export function isPremiumSubscriptionState(
  status,
  trialEndsAt = null,
  currentPeriodEnd = null,
  now = new Date(),
) {
  const normalized = normalizeStatus(status);
  if (normalized === "trial") return futureDate(trialEndsAt, now);
  return (normalized === "active" || normalized === "grace" || normalized === "cancelled")
    && futureDate(currentPeriodEnd, now);
}

export function premiumSubscriptionSql(alias = "", clockSql = "datetime('now')") {
  const prefix = alias ? `${alias}.` : "";
  const status = `LOWER(TRIM(COALESCE(${prefix}status, '')))`;
  return `((${status} IN ('active','grace','cancelled') `
    + `AND ${prefix}current_period_end IS NOT NULL `
    + `AND datetime(substr(${prefix}current_period_end,1,19)) > ${clockSql}) OR (`
    + `${status}='trial' AND ${prefix}trial_ends_at IS NOT NULL `
    + `AND datetime(substr(${prefix}trial_ends_at,1,19)) > ${clockSql}))`;
}

/**
 * @param {string | null | undefined} status
 * @param {string | null | undefined} expiresAt
 * @param {Date} now
 */
export function isPremiumChildSubscriptionState(status, expiresAt, now = new Date()) {
  const normalized = normalizeStatus(status);
  return (normalized === "active" || normalized === "grace") && futureDate(expiresAt, now);
}

export function premiumChildSubscriptionSql(alias = "", clockSql = "datetime('now')") {
  const prefix = alias ? `${alias}.` : "";
  return `(LOWER(TRIM(COALESCE(${prefix}status, ''))) IN ('active','grace') AND ${prefix}expires_at IS NOT NULL `
    + `AND datetime(substr(${prefix}expires_at,1,19)) > ${clockSql})`;
}

/**
 * Premium family_id를 한 번의 set scan으로 만드는 공통 SQL.
 * subscriptions에 family_id 인덱스가 없는 기존 D1에서도 가족마다 반복 스캔하지 않는다.
 */
export function premiumFamilyIdsSql(clockSql = "datetime('now')") {
  return `
    SELECT entitlement_fs.family_id AS family_id
      FROM family_subscription entitlement_fs
     WHERE ${premiumSubscriptionSql("entitlement_fs", clockSql)}
    UNION
    SELECT entitlement_cs.family_id AS family_id
      FROM subscriptions entitlement_cs
     WHERE ${premiumChildSubscriptionSql("entitlement_cs", clockSql)}
    UNION
    SELECT entitlement_f.id AS family_id
      FROM families entitlement_f
     WHERE NOT EXISTS (
             SELECT 1 FROM family_subscription entitlement_any_fs
              WHERE entitlement_any_fs.family_id = entitlement_f.id
           )
       AND (
         LOWER(TRIM(COALESCE(entitlement_f.subscription_tier, ''))) IN ('premium','subscription','active','grace')
         OR LOWER(TRIM(COALESCE(entitlement_f.user_tier, ''))) IN ('premium','subscription','active','grace')
       )`;
}

/**
 * 가족 단위 bulk 조회에서 단일-family resolver와 같은 Premium 판정을 사용한다.
 * family_subscription 행이 존재하면 만료 상태를 legacy 컬럼으로 되살리지 않는다.
 * 과거 자녀 단위 subscriptions는 유효 기간이 남아 있을 때만 구매 호환으로 인정한다.
 *
 * @param {string} familyAlias
 */
export function premiumFamilyEntitlementSql(familyAlias = "f", clockSql = "datetime('now')") {
  const familyPrefix = familyAlias ? `${familyAlias}.` : "";
  return `(${familyPrefix}id IN (${premiumFamilyIdsSql(clockSql)}))`;
}

export class FamilyEntitlementUnavailableError extends Error {
  code = "family_entitlement_unavailable";
  status = 503;

  constructor(cause) {
    super("family_entitlement_unavailable", { cause });
    this.name = "FamilyEntitlementUnavailableError";
  }
}

/**
 * DB 행을 Free/Premium 상업 티어와 grandfather 보너스로 분리한다.
 * reviewed는 별도 판매 티어가 아니며 Premium 판정에도 관여하지 않는다.
 *
 * @param {{
 *   subscription: {status?: unknown, trial_ends_at?: unknown, current_period_end?: unknown,
 *     remote_listen_enabled?: unknown} | null,
 *   family: {user_tier?: unknown, subscription_tier?: unknown} | null,
 *   childSubscriptions: Array<{status?: unknown, expires_at?: unknown}>,
 *   hasGrandfatheredReviewLimits: boolean,
 * }} rows
 * @param {Date} now
 */
export function resolveFamilyEntitlementRows(rows, now = new Date()) {
  const subscription = rows.subscription;
  const remoteListenEnabled = subscription?.remote_listen_enabled !== 0
    && subscription?.remote_listen_enabled !== false;

  let source = "free";
  if (
    subscription
    && isPremiumSubscriptionState(
      subscription.status,
      subscription.trial_ends_at,
      subscription.current_period_end,
      now,
    )
  ) {
    source = "family_subscription";
  } else if (
    rows.childSubscriptions.some((childSubscription) =>
      isPremiumChildSubscriptionState(
        childSubscription.status,
        childSubscription.expires_at,
        now,
      ))
  ) {
    source = "child_subscription";
  } else if (
    !subscription
    && rows.family
    && (
      isLegacyPremiumTier(rows.family.subscription_tier)
      || isLegacyPremiumTier(rows.family.user_tier)
    )
  ) {
    source = "legacy_family";
  }

  const isPremium = source !== "free";
  return {
    tier: isPremium ? "premium" : "free",
    isPremium,
    source,
    hasGrandfatheredReviewLimits: rows.hasGrandfatheredReviewLimits === true,
    remoteListenEnabled,
  };
}

/**
 * Worker의 일반 API·위치·원격 기능이 공유하는 가족 엔타이틀먼트 정본.
 * 어느 판정 소스든 D1 조회에 실패하면 무료로 추정하지 않고 typed 503 오류로 닫는다.
 *
 * @param {D1Database} db
 * @param {string} familyId
 * @param {Date} now
 */
export async function resolveFamilyEntitlement(db, familyId, now = new Date()) {
  if (!familyId) {
    return resolveFamilyEntitlementRows({
      subscription: null,
      family: null,
      childSubscriptions: [],
      hasGrandfatheredReviewLimits: false,
    }, now);
  }

  let subscription;
  let family;
  let childSubscriptions;
  try {
    subscription = await db
      .prepare(
        `SELECT status, trial_ends_at, current_period_end, remote_listen_enabled
           FROM family_subscription WHERE family_id = ?1 LIMIT 1`,
      )
      .bind(familyId)
      .first();
    family = await db
      .prepare(
        `SELECT user_tier, subscription_tier FROM families WHERE id = ?1 LIMIT 1`,
      )
      .bind(familyId)
      .first();
    const childSubscriptionResult = await db
      .prepare(
        `SELECT status, expires_at FROM subscriptions
          WHERE family_id = ?1
            AND LOWER(TRIM(COALESCE(status, ''))) IN ('active','grace')`,
      )
      .bind(familyId)
      .all();
    childSubscriptions = childSubscriptionResult.results ?? [];
  } catch (error) {
    if (error instanceof FamilyEntitlementUnavailableError) throw error;
    throw new FamilyEntitlementUnavailableError(error);
  }

  // grandfather는 상업 티어 소스가 아니다. 조회 실패 시 보너스만 미부여하여
  // fail-closed하고, 이미 검증한 유효 유료 구독까지 무료로 강등하지 않는다.
  let hasGrandfatheredReviewLimits = false;
  try {
    const review = await db
      .prepare(
        `SELECT granted_at FROM family_review_rewards WHERE family_id = ?1 LIMIT 1`,
      )
      .bind(familyId)
      .first();
    hasGrandfatheredReviewLimits = Boolean(review?.granted_at);
  } catch {
    hasGrandfatheredReviewLimits = false;
  }

  return resolveFamilyEntitlementRows({
    subscription,
    family,
    childSubscriptions,
    hasGrandfatheredReviewLimits,
  }, now);
}

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function mapSubscriptionStatus(subscription) {
  const state = asString(subscription?.subscriptionState);
  if (state === "SUBSCRIPTION_STATE_IN_GRACE_PERIOD") return "grace";
  if (state === "SUBSCRIPTION_STATE_CANCELED") return "cancelled";
  if (state === "SUBSCRIPTION_STATE_EXPIRED") return "expired";
  if (state === "SUBSCRIPTION_STATE_ACTIVE") return "active";
  // PENDING은 결제 완료 전, ON_HOLD는 entitlement 상실 상태이므로 프리미엄으로 승격하지 않는다.
  if (state === "SUBSCRIPTION_STATE_PENDING" || state === "SUBSCRIPTION_STATE_ON_HOLD") return "expired";
  return "expired";
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const LAUNCH_PRICE_CUTOVER_MS = Date.parse("2026-08-01T00:00:00+09:00");
const LAUNCH_RECURRING_PRICES = Object.freeze({
  "monthly-2900": Object.freeze({ currencyCode: "KRW", units: "4900" }),
  "annual-27840": Object.freeze({ currencyCode: "KRW", units: "39000" }),
});
const LEGACY_RECURRING_PRICES = Object.freeze({
  "monthly-2900": Object.freeze({ currencyCode: "KRW", units: "2900" }),
  "annual-27840": Object.freeze({ currencyCode: "KRW", units: "27840" }),
});

function hasExpectedRecurringPrice(price, expected) {
  const nanos = price?.nanos === undefined ? 0 : price.nanos;
  return Boolean(price && typeof price === "object"
    && asString(price.currencyCode) === expected.currencyCode
    && typeof price.units === "string" && price.units === expected.units
    && typeof nanos === "number" && Number.isInteger(nanos) && nanos === 0);
}

function assertGooglePlayRecurringPrice(line, basePlanId, subscriptionStartTime, restore) {
  const launchPrice = LAUNCH_RECURRING_PRICES[basePlanId];
  // 허용 base plan 판정은 호출 route가 담당한다. 알려진 출시 plan만 가격 계약을 검증한다.
  if (!launchPrice) return;
  const price = line?.autoRenewingPlan?.recurringPrice;
  if (hasExpectedRecurringPrice(price, launchPrice)) return;

  // 신규 결제는 출시 가격만 허용한다. 기존 가격은 전환일 이전에 시작된 실제 구독을
  // 복원하거나 RTDN으로 재검증할 때만 인정해, 기존 구독자를 보호하면서 신규 우회를 막는다.
  const legacyPrice = LEGACY_RECURRING_PRICES[basePlanId];
  const startedAtMs = Date.parse(asString(subscriptionStartTime));
  if (restore
    && legacyPrice
    && Number.isFinite(startedAtMs)
    && startedAtMs < LAUNCH_PRICE_CUTOVER_MS
    && hasExpectedRecurringPrice(price, legacyPrice)) return;

  throw new Error("recurring_price_mismatch");
}

export function assertGooglePlayPurchaseOwner(purchase, expectedAccountId, expectedProfileId) {
  const identifiers = purchase?.externalAccountIdentifiers && typeof purchase.externalAccountIdentifiers === "object"
    ? purchase.externalAccountIdentifiers
    : purchase;
  const accountId = asString(identifiers?.obfuscatedExternalAccountId);
  const profileId = asString(identifiers?.obfuscatedExternalProfileId);
  if (!expectedAccountId || !expectedProfileId || accountId !== expectedAccountId || profileId !== expectedProfileId) {
    throw new Error("purchase_owner_mismatch");
  }
}

export function mapGoogleSubscriptionPurchaseMetadata(subscription, productId) {
  const lineItems = Array.isArray(subscription?.lineItems) ? subscription.lineItems : [];
  const line = lineItems.find((item) => asString(item?.productId) === productId);
  if (!line) throw new Error("product_mismatch");
  return {
    productId: asString(line.productId),
    offerId: asString(line?.offerDetails?.offerId),
    linkedPurchaseToken: asString(subscription?.linkedPurchaseToken),
  };
}

export function mapGoogleSubscriptionEntitlement(
  subscription,
  productId,
  requestedBasePlanId,
  requestedOfferId = "",
  now = new Date(),
  expectedAccountId = "",
  expectedProfileId = "",
  restore = false,
) {
  if (expectedAccountId || expectedProfileId) {
    assertGooglePlayPurchaseOwner(subscription, expectedAccountId, expectedProfileId);
  }
  const lineItems = Array.isArray(subscription?.lineItems) ? subscription.lineItems : [];
  const line = lineItems.find((item) => asString(item?.productId) === productId);
  if (!line) throw new Error("product_mismatch");

  const remoteBasePlanId = asString(line?.offerDetails?.basePlanId);
  if (!remoteBasePlanId || (requestedBasePlanId && remoteBasePlanId !== requestedBasePlanId)) {
    throw new Error("base_plan_mismatch");
  }
  assertGooglePlayRecurringPrice(line, remoteBasePlanId, subscription?.startTime, restore);
  const remoteOfferId = asString(line?.offerDetails?.offerId);
  if (!restore && remoteOfferId !== asString(requestedOfferId)) throw new Error("offer_id_mismatch");

  const expiryTime = asString(line.expiryTime) || null;
  const offerPhase = line?.offerPhase;
  const freeTrial = offerPhase && typeof offerPhase === "object"
    && Object.prototype.hasOwnProperty.call(offerPhase, "freeTrial")
    ? offerPhase.freeTrial
    : null;
  const isFreeTrial = freeTrial === true || (freeTrial !== null && typeof freeTrial === "object");
  if (isFreeTrial) {
    const startTimestamp = Date.parse(asString(subscription?.startTime));
    const expiryTimestamp = Date.parse(expiryTime || "");
    if (!Number.isFinite(startTimestamp) || !Number.isFinite(expiryTimestamp)
      || expiryTimestamp - startTimestamp !== SEVEN_DAYS_MS) {
      throw new Error("trial_period_mismatch");
    }
  }
  const playStateStatus = mapSubscriptionStatus(subscription);
  const mappedStatus = isFreeTrial && playStateStatus === "active" ? "trial" : playStateStatus;
  const expiryTimestamp = expiryTime ? Date.parse(expiryTime) : Number.NaN;
  const hasFutureExpiry = Number.isFinite(expiryTimestamp) && expiryTimestamp > now.getTime();
  const status = ["trial", "active", "grace", "cancelled"].includes(mappedStatus) && !hasFutureExpiry
    ? "expired"
    : mappedStatus;
  return {
    status,
    currentPeriodEnd: expiryTime,
    trialEndsAt: status === "trial" ? expiryTime : null,
    basePlanId: remoteBasePlanId,
    // subscriptionsv2 정본은 line item의 latestSuccessfulOrderId다. 과거 fixture/응답은
    // top-level latestOrderId를 사용했으므로 읽기 호환만 유지한다.
    orderId: asString(line?.latestSuccessfulOrderId) || asString(subscription?.latestOrderId),
    acknowledgementState: asString(subscription?.acknowledgementState),
  };
}

export function isGooglePlayVerifierConfigured(env) {
  return typeof env?.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON === "string"
    && env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON.trim().length > 0;
}

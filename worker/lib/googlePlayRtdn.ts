type JsonMap = Record<string, unknown>;

export type GooglePlayRtdnEvent =
  | {
    messageId: string;
    eventTimeMillis: string;
    kind: "test";
  }
  | {
    messageId: string;
    eventTimeMillis: string;
    kind: "subscription";
    notificationType: number;
    purchaseToken: string;
    subscriptionId?: string;
  }
  | {
    messageId: string;
    eventTimeMillis: string;
    kind: "voided";
    purchaseToken: string;
    orderId: string;
    productType: number;
    refundType: number;
  };

export class GooglePlayRtdnPayloadError extends Error {
  readonly code = "invalid_rtdn_payload";

  constructor() {
    super("invalid_rtdn_payload");
    this.name = "GooglePlayRtdnPayloadError";
  }
}

function fail(): never {
  throw new GooglePlayRtdnPayloadError();
}

function isObject(value: unknown): value is JsonMap {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) fail();
  return value;
}

function decodeStrictBase64Json(value: unknown): JsonMap {
  if (typeof value !== "string"
    || value.length === 0
    || value.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    fail();
  }

  try {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
    if (!isObject(parsed)) fail();
    return parsed;
  } catch (error) {
    if (error instanceof GooglePlayRtdnPayloadError) throw error;
    fail();
  }
}

export function parseGooglePlayRtdnEnvelope(input: unknown): GooglePlayRtdnEvent {
  if (!isObject(input) || !isObject(input.message)) fail();
  const messageId = requiredString(input.message.messageId);
  const payload = decodeStrictBase64Json(input.message.data);

  if (payload.packageName !== "com.hyeni.calendar") fail();
  const eventTimeMillis = requiredString(payload.eventTimeMillis);
  if (!/^\d+$/.test(eventTimeMillis)) fail();
  const allowedPayloadKeys = new Set([
    "version",
    "packageName",
    "eventTimeMillis",
    "testNotification",
    "subscriptionNotification",
    "voidedPurchaseNotification",
  ]);
  if (Object.keys(payload).some((key) => !allowedPayloadKeys.has(key))) fail();

  const hasTest = Object.hasOwn(payload, "testNotification");
  const hasSubscription = Object.hasOwn(payload, "subscriptionNotification");
  const hasVoided = Object.hasOwn(payload, "voidedPurchaseNotification");
  if (Number(hasTest) + Number(hasSubscription) + Number(hasVoided) !== 1) fail();

  if (hasTest) {
    if (!isObject(payload.testNotification)) fail();
    return { messageId, eventTimeMillis, kind: "test" };
  }

  if (hasVoided) {
    if (!isObject(payload.voidedPurchaseNotification)) fail();
    const productType = payload.voidedPurchaseNotification.productType;
    const refundType = payload.voidedPurchaseNotification.refundType;
    if (!Number.isSafeInteger(productType) || (productType as number) <= 0) fail();
    if (!Number.isSafeInteger(refundType) || (refundType as number) <= 0) fail();
    return {
      messageId,
      eventTimeMillis,
      kind: "voided",
      purchaseToken: requiredString(payload.voidedPurchaseNotification.purchaseToken),
      orderId: requiredString(payload.voidedPurchaseNotification.orderId),
      productType: productType as number,
      refundType: refundType as number,
    };
  }

  if (!isObject(payload.subscriptionNotification)) fail();
  const notificationType = payload.subscriptionNotification.notificationType;
  if (!Number.isSafeInteger(notificationType) || (notificationType as number) <= 0) fail();
  // notificationType은 트리거 정보일 뿐이다. 알 수 없는 양수도 수용하고 entitlement는 항상 Play API 재조회 결과로 결정한다.
  const purchaseToken = requiredString(payload.subscriptionNotification.purchaseToken);
  const subscriptionIdValue = payload.subscriptionNotification.subscriptionId;
  if (subscriptionIdValue !== undefined && (typeof subscriptionIdValue !== "string" || subscriptionIdValue.trim().length === 0)) {
    fail();
  }

  return {
    messageId,
    eventTimeMillis,
    kind: "subscription",
    notificationType: notificationType as number,
    purchaseToken,
    ...(typeof subscriptionIdValue === "string" ? { subscriptionId: subscriptionIdValue } : {}),
  };
}

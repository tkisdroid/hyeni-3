export const WEB_BILLING_PLANS = Object.freeze({
  month: Object.freeze({ amount: 4_900, displayPrice: "월 4,900원", basePlanId: "web-month" }),
  year: Object.freeze({ amount: 39_000, displayPrice: "연 39,000원", basePlanId: "web-year" }),
});

export const WEB_BILLING_PROVIDER = "toss_web";
export const WEB_BILLING_CHECKOUT_TTL_MS = 15 * 60 * 1000;
export const WEB_BILLING_CLAIM_TTL_MS = 2 * 60 * 1000;
export const WEB_BILLING_TRIAL_DAYS = 7;
// 최초 시도 뒤 1h/6h/24h 세 번 재시도하고 네 번째 확정 실패에서 닫는다.
export const WEB_BILLING_MAX_RENEWAL_FAILURES = 4;

const SAFE_TOSS_CODE = /^[A-Z0-9_]{1,64}$/;

const KEY_PATTERN = /^(test|live)_(ck|sk)_[A-Za-z0-9_-]{8,200}$/;

function base64ToBytes(value) {
  const normalized = String(value || "").trim().replace(/-/g, "+").replace(/_/g, "/");
  if (!normalized) return null;
  try {
    const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function readWebBillingConfig(env) {
  const clientKey = String(env?.TOSS_PAYMENTS_CLIENT_KEY || "").trim();
  const secretKey = String(env?.TOSS_PAYMENTS_SECRET_KEY || "").trim();
  const encryptionSecret = String(env?.WEB_BILLING_KEY_ENCRYPTION_SECRET || "").trim();
  const clientMatch = clientKey.match(KEY_PATTERN);
  const secretMatch = secretKey.match(KEY_PATTERN);
  const encryptionBytes = base64ToBytes(encryptionSecret);
  if (
    !clientMatch
    || !secretMatch
    || clientMatch[2] !== "ck"
    || secretMatch[2] !== "sk"
    || clientMatch[1] !== secretMatch[1]
    || encryptionBytes?.byteLength !== 32
  ) {
    return null;
  }
  return {
    clientKey,
    secretKey,
    encryptionSecret,
    mode: clientMatch[1],
  };
}

async function importEncryptionKey(secret) {
  const bytes = base64ToBytes(secret);
  if (bytes?.byteLength !== 32) throw new Error("web_billing_encryption_key_invalid");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function aad(familyId, customerKey) {
  return new TextEncoder().encode(`hyeni:web-billing:v1:${familyId}:${customerKey}`);
}

export async function encryptWebBillingSecret(
  encryptionSecret,
  plaintext,
  familyId,
  customerKey,
) {
  if (!plaintext || !familyId || !customerKey) throw new Error("web_billing_encryption_input_invalid");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importEncryptionKey(encryptionSecret);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad(familyId, customerKey), tagLength: 128 },
    key,
    new TextEncoder().encode(plaintext),
  );
  return {
    version: "v1",
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
  };
}

export async function decryptWebBillingSecret(
  encryptionSecret,
  encrypted,
  familyId,
  customerKey,
) {
  if (encrypted?.version !== "v1") throw new Error("web_billing_key_version_unsupported");
  const iv = base64ToBytes(encrypted.iv);
  const ciphertext = base64ToBytes(encrypted.ciphertext);
  if (iv?.byteLength !== 12 || !ciphertext?.byteLength) {
    throw new Error("web_billing_ciphertext_invalid");
  }
  const key = await importEncryptionKey(encryptionSecret);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: aad(familyId, customerKey), tagLength: 128 },
    key,
    ciphertext,
  );
  return new TextDecoder().decode(plaintext);
}

export function addWebBillingPeriod(start, plan) {
  if (!(start instanceof Date) || !Number.isFinite(start.getTime()) || !WEB_BILLING_PLANS[plan]) {
    throw new Error("web_billing_period_invalid");
  }
  const originalDay = start.getUTCDate();
  const targetMonthIndex = start.getUTCMonth() + (plan === "month" ? 1 : 12);
  const targetYear = start.getUTCFullYear() + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(
    targetYear,
    targetMonth,
    Math.min(originalDay, lastDay),
    start.getUTCHours(),
    start.getUTCMinutes(),
    start.getUTCSeconds(),
    start.getUTCMilliseconds(),
  ));
}

export function addWebBillingTrialPeriod(start) {
  if (!(start instanceof Date) || !Number.isFinite(start.getTime())) {
    throw new Error("web_billing_trial_period_invalid");
  }
  return new Date(start.getTime() + WEB_BILLING_TRIAL_DAYS * 24 * 60 * 60 * 1000);
}

export function validateTossBillingPayment(payment, expected) {
  if (!payment || typeof payment !== "object") throw new Error("toss_payment_mismatch");
  const paymentKey = typeof payment.paymentKey === "string" ? payment.paymentKey : "";
  if (
    paymentKey.length < 1
    || paymentKey.length > 200
    || payment.orderId !== expected.orderId
    || payment.status !== "DONE"
    || payment.type !== "BILLING"
    || payment.currency !== "KRW"
    || typeof payment.totalAmount !== "number"
    || !Number.isSafeInteger(payment.totalAmount)
    || payment.totalAmount !== expected.amount
  ) {
    throw new Error("toss_payment_mismatch");
  }
  return { paymentKey };
}

/**
 * Toss Payment 조회 응답에서 자동결제 취소 정본만 추출한다.
 * 웹훅 본문의 status/amount/cancels는 사용하지 않고 이 검증기를 통과한 조회 응답만 반영한다.
 */
export function validateTossBillingPaymentState(payment, expected) {
  if (!payment || typeof payment !== "object") throw new Error("toss_payment_mismatch");
  const paymentKey = typeof payment.paymentKey === "string" ? payment.paymentKey : "";
  if (
    paymentKey.length < 1
    || paymentKey.length > 200
    || payment.orderId !== expected.orderId
    || payment.type !== "BILLING"
    || payment.currency !== "KRW"
    || !Number.isSafeInteger(payment.totalAmount)
    || payment.totalAmount !== expected.amount
  ) {
    throw new Error("toss_payment_mismatch");
  }
  if (payment.status === "DONE") {
    return {
      state: "paid",
      paymentKey,
      refundedAmount: 0,
      balanceAmount: expected.amount,
      transactionKeys: [],
    };
  }
  if (payment.status !== "CANCELED" && payment.status !== "PARTIAL_CANCELED") {
    throw new Error("toss_payment_mismatch");
  }
  if (
    !Number.isSafeInteger(payment.balanceAmount)
    || payment.balanceAmount < 0
    || payment.balanceAmount >= expected.amount
    || !Array.isArray(payment.cancels)
    || payment.cancels.length < 1
  ) {
    throw new Error("toss_payment_mismatch");
  }

  let refundedAmount = 0;
  let currentBalanceObserved = false;
  const transactionKeys = [];
  const seenTransactions = new Set();
  for (const value of payment.cancels) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("toss_payment_mismatch");
    }
    if (value.cancelStatus !== "DONE") continue;
    const transactionKey = typeof value.transactionKey === "string" ? value.transactionKey : "";
    if (
      transactionKey.length < 1
      || transactionKey.length > 200
      || seenTransactions.has(transactionKey)
      || !Number.isSafeInteger(value.cancelAmount)
      || value.cancelAmount <= 0
      || value.cancelAmount > expected.amount
      || !Number.isSafeInteger(value.refundableAmount)
      || value.refundableAmount < 0
      || value.refundableAmount > expected.amount
    ) {
      throw new Error("toss_payment_mismatch");
    }
    seenTransactions.add(transactionKey);
    transactionKeys.push(transactionKey);
    refundedAmount += value.cancelAmount;
    if (!Number.isSafeInteger(refundedAmount) || refundedAmount > expected.amount) {
      throw new Error("toss_payment_mismatch");
    }
    if (value.refundableAmount === payment.balanceAmount) currentBalanceObserved = true;
  }
  if (
    transactionKeys.length < 1
    || !currentBalanceObserved
    || refundedAmount !== expected.amount - payment.balanceAmount
    || (payment.status === "CANCELED" && payment.balanceAmount !== 0)
    || (payment.status === "PARTIAL_CANCELED" && payment.balanceAmount <= 0)
  ) {
    throw new Error("toss_payment_mismatch");
  }
  transactionKeys.sort();
  return {
    state: payment.status === "CANCELED" ? "refunded" : "partial_refund",
    paymentKey,
    refundedAmount,
    balanceAmount: payment.balanceAmount,
    transactionKeys,
  };
}

export function validateTossBillingAuthorization(value, expectedCustomerKey) {
  if (!value || typeof value !== "object") throw new Error("toss_billing_authorization_mismatch");
  const customerKey = typeof value.customerKey === "string" ? value.customerKey : "";
  const billingKey = typeof value.billingKey === "string" ? value.billingKey : "";
  // Toss 공식 응답 계약은 billingKey의 최대 길이만 200자로 규정한다.
  // 임의 문자셋·최소 길이를 추가하거나 trim해 provider 원문을 바꾸지 않는다.
  if (customerKey !== expectedCustomerKey || billingKey.length < 1 || billingKey.length > 200) {
    throw new Error("toss_billing_authorization_mismatch");
  }
  return { billingKey };
}

export function safeTossErrorCode(value, fallback = "TOSS_REQUEST_FAILED") {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  return SAFE_TOSS_CODE.test(code) ? code : fallback;
}

export function createWebBillingCustomerKey() {
  return `HYENI_${crypto.randomUUID().replace(/-/g, "")}`;
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createWebBillingOrderId(kind, identity) {
  if (kind !== "initial" && kind !== "trial_conversion" && kind !== "renewal") {
    throw new Error("web_billing_order_kind_invalid");
  }
  const normalized = String(identity || "").trim();
  if (!normalized) throw new Error("web_billing_order_identity_invalid");
  const digest = await sha256Hex(`hyeni:web-billing:${kind}:${normalized}`);
  const prefix = kind === "initial" ? "I" : kind === "trial_conversion" ? "T" : "R";
  return `HYENI-${prefix}-${digest.slice(0, 40)}`;
}

export async function hashWebBillingPaymentKey(paymentKey) {
  if (typeof paymentKey !== "string" || !paymentKey.trim()) {
    throw new Error("web_billing_payment_key_invalid");
  }
  return sha256Hex(`hyeni:web-billing:payment:${paymentKey}`);
}

export async function hashWebBillingRefundState(input) {
  if (
    !input
    || (input.state !== "partial_refund" && input.state !== "refunded")
    || typeof input.paymentKey !== "string"
    || input.paymentKey.length < 1
    || input.paymentKey.length > 200
    || !Number.isSafeInteger(input.refundedAmount)
    || input.refundedAmount <= 0
    || !Number.isSafeInteger(input.balanceAmount)
    || input.balanceAmount < 0
    || !Array.isArray(input.transactionKeys)
    || input.transactionKeys.length < 1
  ) {
    throw new Error("web_billing_refund_state_invalid");
  }
  const transactionKeys = [...input.transactionKeys];
  const transactionKeyBytes = transactionKeys.reduce(
    (total, value) => total + (typeof value === "string" ? new TextEncoder().encode(value).byteLength : 0),
    0,
  );
  if (
    transactionKeys.some((value) => typeof value !== "string" || value.length < 1 || value.length > 200)
    || new Set(transactionKeys).size !== transactionKeys.length
    || transactionKeyBytes > 512 * 1024
  ) {
    throw new Error("web_billing_refund_state_invalid");
  }
  transactionKeys.sort();
  return sha256Hex([
    "hyeni:web-billing:refund:v1",
    input.paymentKey,
    input.state,
    String(input.refundedAmount),
    String(input.balanceAmount),
    ...transactionKeys,
  ].join(":"));
}

export function webBillingRetryAt(now, failureCount) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error("web_billing_retry_time_invalid");
  }
  const delayHours = failureCount <= 1 ? 1 : failureCount === 2 ? 6 : 24;
  return new Date(now.getTime() + delayHours * 60 * 60 * 1000);
}

export function webBillingPlan(value) {
  return value === "month" || value === "year" ? value : null;
}

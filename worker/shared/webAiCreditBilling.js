export const WEB_AI_CREDIT_CHECKOUT_TTL_MS = 15 * 60 * 1000;
export const WEB_AI_CREDIT_CLAIM_TTL_MS = 2 * 60 * 1000;

export const WEB_AI_CREDIT_PACKS = Object.freeze([
  Object.freeze({
    productCode: "ai-credit-30",
    credits: 30,
    envKey: "TOSS_AI_CREDIT_30_AMOUNT_KRW",
  }),
  Object.freeze({
    productCode: "ai-credit-80",
    credits: 80,
    envKey: "TOSS_AI_CREDIT_80_AMOUNT_KRW",
  }),
  Object.freeze({
    productCode: "ai-credit-200",
    credits: 200,
    envKey: "TOSS_AI_CREDIT_200_AMOUNT_KRW",
  }),
]);

const MAX_KRW_AMOUNT = 10_000_000;
const TOSS_KEY_PATTERN = /^(test|live)_(ck|sk)_[A-Za-z0-9_-]{8,200}$/;

export function readWebAiCreditTossConfig(env) {
  const clientKey = String(env?.TOSS_PAYMENTS_CLIENT_KEY || "").trim();
  const secretKey = String(env?.TOSS_PAYMENTS_SECRET_KEY || "").trim();
  const clientMatch = clientKey.match(TOSS_KEY_PATTERN);
  const secretMatch = secretKey.match(TOSS_KEY_PATTERN);
  if (
    !clientMatch
    || !secretMatch
    || clientMatch[2] !== "ck"
    || secretMatch[2] !== "sk"
    || clientMatch[1] !== secretMatch[1]
  ) return null;
  return { clientKey, secretKey, mode: clientMatch[1] };
}

function validKrwAmount(value) {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) return null;
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount <= MAX_KRW_AMOUNT ? amount : null;
}

export function formatWebAiCreditKrw(amount) {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error("web_ai_credit_amount_invalid");
  }
  return `${amount.toLocaleString("ko-KR")}원`;
}

/** 보고서에 가격 정본이 없으므로 운영 환경에 명시된 팩만 판매한다. */
export function readWebAiCreditCatalog(env) {
  const catalog = [];
  for (const definition of WEB_AI_CREDIT_PACKS) {
    const amount = validKrwAmount(env?.[definition.envKey]);
    if (amount == null) continue;
    catalog.push({
      productCode: definition.productCode,
      credits: definition.credits,
      amount,
      displayPrice: formatWebAiCreditKrw(amount),
    });
  }
  return catalog;
}

export function findWebAiCreditPack(catalog, productCode) {
  return Array.isArray(catalog)
    ? catalog.find((pack) => pack?.productCode === productCode) ?? null
    : null;
}

export function createWebAiCreditOrderId() {
  return `HYENI-AI-${crypto.randomUUID().replace(/-/g, "")}`;
}

export function createWebAiCreditCustomerKey() {
  return `HYENI_AI_${crypto.randomUUID().replace(/-/g, "")}`;
}

export function validateTossOneTimePayment(payment, expected) {
  const state = validateTossOneTimePaymentState(payment, expected);
  if (
    state.state !== "paid"
    || (typeof expected.paymentKey === "string" && state.paymentKey !== expected.paymentKey)
  ) {
    throw new Error("toss_ai_credit_payment_mismatch");
  }
  return { paymentKey: state.paymentKey };
}

export function validateTossOneTimePaymentState(payment, expected) {
  if (!payment || typeof payment !== "object") {
    throw new Error("toss_ai_credit_payment_mismatch");
  }
  const paymentKey = typeof payment.paymentKey === "string" ? payment.paymentKey : "";
  if (
    paymentKey.length < 1
    || paymentKey.length > 200
    || payment.orderId !== expected.orderId
    || payment.type !== "NORMAL"
    || payment.currency !== "KRW"
    || !Number.isSafeInteger(payment.totalAmount)
    || payment.totalAmount !== expected.amount
  ) throw new Error("toss_ai_credit_payment_mismatch");

  if (payment.status === "DONE") return { state: "paid", paymentKey };
  if (payment.status === "CANCELED") {
    if (!Number.isSafeInteger(payment.balanceAmount) || payment.balanceAmount !== 0) {
      throw new Error("toss_ai_credit_payment_mismatch");
    }
    return { state: "refunded", paymentKey, refundedAmount: expected.amount };
  }
  if (payment.status === "PARTIAL_CANCELED") {
    if (
      !Number.isSafeInteger(payment.balanceAmount)
      || payment.balanceAmount < 0
      || payment.balanceAmount >= expected.amount
    ) throw new Error("toss_ai_credit_payment_mismatch");
    return {
      state: "partial_refund",
      paymentKey,
      refundedAmount: expected.amount - payment.balanceAmount,
    };
  }
  if (["READY", "IN_PROGRESS", "WAITING_FOR_DEPOSIT"].includes(payment.status)) {
    return { state: "pending", paymentKey };
  }
  if (["ABORTED", "EXPIRED"].includes(payment.status)) {
    return { state: "failed", paymentKey };
  }
  throw new Error("toss_ai_credit_payment_mismatch");
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashWebAiCreditPaymentKey(paymentKey) {
  if (typeof paymentKey !== "string" || paymentKey.length < 1 || paymentKey.length > 200) {
    throw new Error("web_ai_credit_payment_key_invalid");
  }
  return sha256Hex(`hyeni:web-ai-credit:payment:${paymentKey}`);
}

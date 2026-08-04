export type WebAiCreditProductCode =
  | "ai-credit-30"
  | "ai-credit-80"
  | "ai-credit-200";

export type WebAiCreditPack = {
  productCode: WebAiCreditProductCode;
  credits: 30 | 80 | 200;
  amount: number;
  displayPrice: string;
};

export type WebAiCreditCatalog = {
  provider: "toss_payments";
  currency: "KRW";
  configured: boolean;
  packs: WebAiCreditPack[];
};

export type WebAiCreditCheckout = WebAiCreditPack & {
  orderId: string;
  customerKey: string;
  clientKey: string;
  currency: "KRW";
  expiresAt: string;
};

export type WebAiCreditDebtImpact = {
  debtApplied: number;
  availableCreditsAdded: number;
  remainingDebt: number;
};

function nonNegativeSafeInteger(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

/** 결제 전에 환불 사용분 상계와 실제 사용 가능 증가량을 같은 정수 계약으로 표시한다. */
export function resolveWebAiCreditDebtImpact(
  credits: number,
  purchasedCreditDebt: number,
): WebAiCreditDebtImpact {
  const safeCredits = nonNegativeSafeInteger(credits);
  const safeDebt = nonNegativeSafeInteger(purchasedCreditDebt);
  const debtApplied = Math.min(safeCredits, safeDebt);
  return {
    debtApplied,
    availableCreditsAdded: safeCredits - debtApplied,
    remainingDebt: safeDebt - debtApplied,
  };
}

export type PendingWebAiCreditCheckout = Omit<WebAiCreditCheckout, "clientKey" | "displayPrice"> & {
  familyId: string;
  childUserId: string;
};

export interface WebAiCreditPendingStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PENDING_KEY = "hyeni:web-ai-credit:pending:v1";
const RECONCILIATION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const PRODUCT_CREDITS: Readonly<Record<WebAiCreditProductCode, 30 | 80 | 200>> = {
  "ai-credit-30": 30,
  "ai-credit-80": 80,
  "ai-credit-200": 200,
};
const ORDER_ID = /^[A-Za-z0-9_-]{6,64}$/;
const CUSTOMER_KEY = /^[A-Za-z0-9_=.@-]{2,50}$/;
const CLIENT_KEY = /^(?:test|live)_ck_[A-Za-z0-9_-]{8,200}$/;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function productCode(value: unknown): WebAiCreditProductCode | null {
  return value === "ai-credit-30" || value === "ai-credit-80" || value === "ai-credit-200"
    ? value
    : null;
}

function validPack(value: unknown): WebAiCreditPack | null {
  const row = record(value);
  const code = productCode(row?.productCode);
  if (!row || !code) return null;
  const credits = PRODUCT_CREDITS[code];
  if (
    row.credits !== credits
    || !Number.isSafeInteger(row.amount)
    || Number(row.amount) <= 0
    || typeof row.displayPrice !== "string"
    || row.displayPrice !== `${Number(row.amount).toLocaleString("ko-KR")}원`
  ) return null;
  return {
    productCode: code,
    credits,
    amount: Number(row.amount),
    displayPrice: row.displayPrice,
  };
}

export function validateWebAiCreditCatalog(value: unknown): WebAiCreditCatalog {
  const row = record(value);
  if (
    !row
    || row.provider !== "toss_payments"
    || row.currency !== "KRW"
    || typeof row.configured !== "boolean"
    || !Array.isArray(row.packs)
  ) throw new Error("invalid_web_ai_credit_catalog");
  const packs = row.packs.map(validPack);
  if (packs.some((pack) => pack == null)) throw new Error("invalid_web_ai_credit_catalog");
  const validPacks = packs as WebAiCreditPack[];
  if (!row.configured && validPacks.length !== 0) throw new Error("invalid_web_ai_credit_catalog");
  if (new Set(validPacks.map((pack) => pack.productCode)).size !== validPacks.length) {
    throw new Error("invalid_web_ai_credit_catalog");
  }
  return {
    provider: "toss_payments",
    currency: "KRW",
    configured: row.configured,
    packs: validPacks,
  };
}

export function validateWebAiCreditCheckout(
  value: unknown,
  selectedPack: WebAiCreditPack,
): WebAiCreditCheckout {
  const row = record(value);
  const checkoutCode = productCode(row?.productCode);
  const expiresAt = typeof row?.expiresAt === "string" ? Date.parse(row.expiresAt) : Number.NaN;
  if (
    !row
    || checkoutCode !== selectedPack.productCode
    || row.credits !== selectedPack.credits
    || row.amount !== selectedPack.amount
    || row.currency !== "KRW"
    || typeof row.orderId !== "string"
    || !ORDER_ID.test(row.orderId)
    || typeof row.customerKey !== "string"
    || !CUSTOMER_KEY.test(row.customerKey)
    || typeof row.clientKey !== "string"
    || !CLIENT_KEY.test(row.clientKey)
    || !Number.isFinite(expiresAt)
  ) throw new Error("invalid_web_ai_credit_checkout");
  return {
    ...selectedPack,
    orderId: row.orderId,
    customerKey: row.customerKey,
    clientKey: row.clientKey,
    currency: "KRW",
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

export function buildWebAiCreditRedirectUrls(currentHref: string): {
  successUrl: string;
  failUrl: string;
} {
  const current = new URL(currentHref);
  const success = new URL(current.origin);
  success.searchParams.set("aiCreditResult", "success");
  success.hash = "/ai-credit";
  const fail = new URL(current.origin);
  fail.searchParams.set("aiCreditResult", "fail");
  fail.hash = "/ai-credit";
  return { successUrl: success.href, failUrl: fail.href };
}

export type WebAiCreditRedirect =
  | { kind: "none" }
  | { kind: "fail"; code: string | null; message: string | null }
  | { kind: "success"; paymentKey: string; orderId: string; amount: number }
  | { kind: "invalid" };

export function parseWebAiCreditRedirect(search: string): WebAiCreditRedirect {
  const query = new URLSearchParams(search);
  const result = query.get("aiCreditResult");
  if (!result) return { kind: "none" };
  if (result === "fail") {
    return { kind: "fail", code: query.get("code"), message: query.get("message") };
  }
  if (result !== "success") return { kind: "invalid" };
  const paymentKey = query.get("paymentKey") ?? "";
  const orderId = query.get("orderId") ?? "";
  const amountText = query.get("amount") ?? "";
  if (
    paymentKey.length < 1
    || paymentKey.length > 200
    || !ORDER_ID.test(orderId)
    || !/^[1-9][0-9]*$/.test(amountText)
  ) return { kind: "invalid" };
  const amount = Number(amountText);
  return Number.isSafeInteger(amount)
    ? { kind: "success", paymentKey, orderId, amount }
    : { kind: "invalid" };
}

export function clearWebAiCreditRedirectQuery(currentHref: string): string {
  const url = new URL(currentHref);
  for (const key of ["aiCreditResult", "paymentKey", "orderId", "amount", "code", "message"]) {
    url.searchParams.delete(key);
  }
  url.search = url.searchParams.toString();
  return url.href;
}

function validPending(value: unknown): PendingWebAiCreditCheckout | null {
  const row = record(value);
  const code = productCode(row?.productCode);
  const credits = code ? PRODUCT_CREDITS[code] : null;
  const expiresAtMs = typeof row?.expiresAt === "string" ? Date.parse(row.expiresAt) : Number.NaN;
  if (
    !row
    || !code
    || row.credits !== credits
    || !Number.isSafeInteger(row.amount)
    || Number(row.amount) <= 0
    || row.currency !== "KRW"
    || typeof row.orderId !== "string"
    || !ORDER_ID.test(row.orderId)
    || typeof row.customerKey !== "string"
    || !CUSTOMER_KEY.test(row.customerKey)
    || typeof row.familyId !== "string"
    || !row.familyId
    || typeof row.childUserId !== "string"
    || !row.childUserId
    || !Number.isFinite(expiresAtMs)
  ) return null;
  return {
    orderId: row.orderId,
    customerKey: row.customerKey,
    familyId: row.familyId,
    childUserId: row.childUserId,
    productCode: code,
    credits: credits as 30 | 80 | 200,
    amount: Number(row.amount),
    currency: "KRW",
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}

export function validateRecoveredWebAiCreditCheckout(
  value: unknown,
  expected: {
    familyId: string;
    childUserId: string;
    orderId: string;
    amount: number;
  },
): PendingWebAiCreditCheckout {
  const pending = validPending(value);
  if (
    !pending
    || typeof expected.familyId !== "string"
    || !expected.familyId
    || typeof expected.childUserId !== "string"
    || !expected.childUserId
    || typeof expected.orderId !== "string"
    || !ORDER_ID.test(expected.orderId)
    || !Number.isSafeInteger(expected.amount)
    || expected.amount <= 0
    || pending.familyId !== expected.familyId
    || pending.childUserId !== expected.childUserId
    || pending.orderId !== expected.orderId
    || pending.amount !== expected.amount
  ) throw new Error("invalid_web_ai_credit_recovery");
  return pending;
}

export function savePendingWebAiCreditCheckout(
  storage: WebAiCreditPendingStorage,
  checkout: PendingWebAiCreditCheckout,
): void {
  const valid = validPending(checkout);
  if (!valid) throw new Error("invalid_web_ai_credit_pending");
  storage.setItem(PENDING_KEY, JSON.stringify(valid));
}

export function readPendingWebAiCreditCheckout(
  storage: WebAiCreditPendingStorage,
  nowMs = Date.now(),
): PendingWebAiCreditCheckout | null {
  let value: unknown;
  try {
    const raw = storage.getItem(PENDING_KEY);
    value = raw ? JSON.parse(raw) : null;
  } catch {
    value = null;
  }
  const pending = validPending(value);
  if (!pending || Date.parse(pending.expiresAt) + RECONCILIATION_RETENTION_MS <= nowMs) {
    storage.removeItem(PENDING_KEY);
    return null;
  }
  return pending;
}

export function clearPendingWebAiCreditCheckout(storage: WebAiCreditPendingStorage): void {
  storage.removeItem(PENDING_KEY);
}

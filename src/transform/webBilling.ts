import { isApiError } from "../lib/api/errors.ts";

export type WebBillingPlan = "month" | "year";

export const WEB_BILLING_AMOUNTS: Readonly<Record<WebBillingPlan, number>> = Object.freeze({
  month: 4_900,
  year: 39_000,
});

export const WEB_BILLING_DISPLAY_PRICES: Readonly<Record<WebBillingPlan, string>> = Object.freeze({
  month: "월 4,900원",
  year: "연 39,000원",
});

const REDIRECT_RESULT = "billingResult";
const REDIRECT_QUERY_KEYS = [REDIRECT_RESULT, "authKey", "customerKey", "code", "message"] as const;
// Toss 계약은 authKey의 최대 길이만 보장한다. URL-safe 문자로 임의 축소해 정상 키를
// 거부하지 않되, JSON/로그 오염을 막기 위해 공백·제어문자 없는 printable ASCII만 받는다.
const AUTH_KEY = /^[\x21-\x7E]{1,300}$/;
const CUSTOMER_KEY = /^[A-Za-z0-9_=.@-]{2,50}$/;
const SESSION_ID = /^[A-Za-z0-9_-]{8,128}$/;
const PENDING_STORAGE_KEY = "hyeni.webBilling.pending.v1";

const SAFE_FAILURE_CODES = new Set([
  "PAY_PROCESS_CANCELED",
  "PAY_PROCESS_ABORTED",
  "REJECT_CARD_COMPANY",
  "INVALID_CARD_NUMBER",
  "INVALID_CARD_EXPIRATION",
  "INVALID_STOPPED_CARD",
  "NOT_SUPPORTED_METHOD",
]);

// 이 두 코드는 Worker 응답이 아니라 Subscription 화면이 직접 만드는 고정 sentinel이다.
// 그 밖의 Error.message는 결제사/SDK 원문일 수 있으므로 절대 상태 코드로 해석하지 않는다.
const LOCAL_WEB_BILLING_FAILURE_CODES = new Set([
  "web_billing_not_configured",
  "web_billing_session_storage_unavailable",
]);

export type WebBillingRedirect =
  | { kind: "none" }
  | { kind: "invalid" }
  | { kind: "success"; authKey: string; customerKey: string }
  | { kind: "fail"; code: string };

/** 모바일 redirect 결제를 HashRouter의 구독 화면으로만 복귀시킨다. */
export function buildWebBillingRedirectUrls(currentUrl: string): {
  successUrl: string;
  failUrl: string;
} {
  const current = new URL(currentUrl);
  if (!(["https:", "http:"].includes(current.protocol)) || current.username || current.password) {
    throw new Error("invalid_web_billing_origin");
  }
  const make = (result: "success" | "fail") => {
    const redirect = new URL(current.origin + current.pathname);
    redirect.searchParams.set(REDIRECT_RESULT, result);
    redirect.hash = "/subscription";
    return redirect.toString();
  };
  return { successUrl: make("success"), failUrl: make("fail") };
}

/** 결제사 원문 message는 읽거나 보존하지 않고, 고정 코드만 해석한다. */
export function parseWebBillingRedirect(search: string): WebBillingRedirect {
  const params = new URLSearchParams(search);
  const result = params.get(REDIRECT_RESULT);
  if (!result) return { kind: "none" };
  if (result === "success") {
    const authKey = params.get("authKey") ?? "";
    const customerKey = params.get("customerKey") ?? "";
    if (!AUTH_KEY.test(authKey) || !CUSTOMER_KEY.test(customerKey)) {
      return { kind: "invalid" };
    }
    return { kind: "success", authKey, customerKey };
  }
  if (result === "fail") {
    const code = params.get("code") ?? "";
    return { kind: "fail", code: SAFE_FAILURE_CODES.has(code) ? code : "UNKNOWN" };
  }
  return { kind: "invalid" };
}

/** authKey/customerKey가 브라우저 주소창·history에 남지 않게 즉시 제거할 URL을 만든다. */
export function clearWebBillingRedirectQuery(currentUrl: string): string {
  const url = new URL(currentUrl);
  for (const key of REDIRECT_QUERY_KEYS) url.searchParams.delete(key);
  return url.toString();
}

export interface PendingWebBilling {
  sessionId: string;
  customerKey: string;
  expiresAt: string;
}

export interface WebBillingCheckoutSession {
  sessionId: string;
  customerKey: string;
  clientKey: string;
  plan: WebBillingPlan;
  amount: number;
  displayPrice: string;
  trialEligible: boolean;
  trialDays: 0 | 7;
  expiresAt: string;
}

export interface RecoveredWebBillingCheckoutSession {
  sessionId: string;
  customerKey: string;
}

export interface WebBillingCatalog {
  provider: "toss_payments";
  currency: "KRW";
  trialEligible: boolean;
  trialDays: 0 | 7;
  plans: Record<WebBillingPlan, {
    amount: number;
    displayPrice: string;
  }>;
}

export function validateWebBillingCatalog(value: unknown): WebBillingCatalog {
  if (!value || typeof value !== "object") throw new Error("invalid_web_billing_catalog");
  const record = value as Record<string, unknown>;
  const plans = record.plans;
  if (record.provider !== "toss_payments" || record.currency !== "KRW" || !plans || typeof plans !== "object") {
    throw new Error("invalid_web_billing_catalog");
  }
  if (
    typeof record.trialEligible !== "boolean"
    || (record.trialEligible ? record.trialDays !== 7 : record.trialDays !== 0)
  ) {
    throw new Error("invalid_web_billing_catalog");
  }
  const rawPlans = plans as Record<string, unknown>;
  const readPlan = (plan: WebBillingPlan) => {
    const raw = rawPlans[plan];
    if (!raw || typeof raw !== "object") throw new Error("invalid_web_billing_catalog");
    const item = raw as Record<string, unknown>;
    if (
      typeof item.amount !== "number"
      || !Number.isSafeInteger(item.amount)
      || item.amount !== WEB_BILLING_AMOUNTS[plan]
      || item.displayPrice !== WEB_BILLING_DISPLAY_PRICES[plan]
    ) {
      throw new Error("invalid_web_billing_catalog");
    }
    return { amount: WEB_BILLING_AMOUNTS[plan], displayPrice: WEB_BILLING_DISPLAY_PRICES[plan] };
  };
  return {
    provider: "toss_payments",
    currency: "KRW",
    trialEligible: record.trialEligible,
    trialDays: record.trialDays as 0 | 7,
    plans: { month: readPlan("month"), year: readPlan("year") },
  };
}

export function webBillingAnnualSavings(catalog: WebBillingCatalog): number {
  return Math.max(0, catalog.plans.month.amount * 12 - catalog.plans.year.amount);
}

export function validateWebBillingCheckoutSession(
  value: unknown,
  expectedPlan: WebBillingPlan,
  expectedTrial: boolean,
): WebBillingCheckoutSession {
  if (!value || typeof value !== "object") throw new Error("invalid_web_billing_response");
  const record = value as Record<string, unknown>;
  const plan = record.plan;
  const amount = typeof record.amount === "number" ? record.amount : Number.NaN;
  const session: WebBillingCheckoutSession = {
    sessionId: typeof record.sessionId === "string" ? record.sessionId : "",
    customerKey: typeof record.customerKey === "string" ? record.customerKey : "",
    clientKey: typeof record.clientKey === "string" ? record.clientKey : "",
    plan: plan === "month" || plan === "year" ? plan : expectedPlan,
    amount,
    displayPrice: typeof record.displayPrice === "string" ? record.displayPrice : "",
    trialEligible: typeof record.trialEligible === "boolean" ? record.trialEligible : !expectedTrial,
    trialDays: record.trialDays === 7 ? 7 : 0,
    expiresAt: typeof record.expiresAt === "string" ? record.expiresAt : "",
  };
  if (
    session.plan !== expectedPlan
    || session.trialEligible !== expectedTrial
    || session.trialDays !== (expectedTrial ? 7 : 0)
    || !SESSION_ID.test(session.sessionId)
    || !CUSTOMER_KEY.test(session.customerKey)
    || !/^[A-Za-z0-9_-]{10,200}$/.test(session.clientKey)
    || session.amount !== WEB_BILLING_AMOUNTS[expectedPlan]
    || session.displayPrice !== WEB_BILLING_DISPLAY_PRICES[expectedPlan]
    || !Number.isFinite(Date.parse(session.expiresAt))
    || Date.parse(session.expiresAt) <= Date.now()
  ) {
    throw new Error("invalid_web_billing_response");
  }
  return session;
}

export function validateRecoveredWebBillingCheckoutSession(
  value: unknown,
  expectedCustomerKey: string,
): RecoveredWebBillingCheckoutSession {
  if (!CUSTOMER_KEY.test(expectedCustomerKey) || !value || typeof value !== "object") {
    throw new Error("invalid_web_billing_recovery");
  }
  const record = value as Record<string, unknown>;
  const sessionId = typeof record.sessionId === "string" ? record.sessionId : "";
  const customerKey = typeof record.customerKey === "string" ? record.customerKey : "";
  if (!SESSION_ID.test(sessionId) || customerKey !== expectedCustomerKey) {
    throw new Error("invalid_web_billing_recovery");
  }
  return { sessionId, customerKey };
}

export interface WebBillingPendingStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function isPendingWebBilling(value: unknown): value is PendingWebBilling {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.sessionId === "string"
    && SESSION_ID.test(record.sessionId)
    && typeof record.customerKey === "string"
    && CUSTOMER_KEY.test(record.customerKey)
    && typeof record.expiresAt === "string"
    && Number.isFinite(Date.parse(record.expiresAt))
  );
}

export function savePendingWebBilling(
  storage: WebBillingPendingStorage,
  pending: PendingWebBilling,
): void {
  if (!isPendingWebBilling(pending)) throw new Error("invalid_web_billing_session");
  storage.setItem(PENDING_STORAGE_KEY, JSON.stringify(pending));
}

export function clearPendingWebBilling(storage: WebBillingPendingStorage): void {
  storage.removeItem(PENDING_STORAGE_KEY);
}

export function readPendingWebBilling(
  storage: WebBillingPendingStorage,
  nowMs = Date.now(),
): PendingWebBilling | null {
  const raw = storage.getItem(PENDING_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isPendingWebBilling(parsed) || Date.parse(parsed.expiresAt) <= nowMs) {
      clearPendingWebBilling(storage);
      return null;
    }
    return parsed;
  } catch {
    clearPendingWebBilling(storage);
    return null;
  }
}

export function webBillingFailureMessage(code: string): string {
  if (code === "PAY_PROCESS_CANCELED" || code === "PAY_PROCESS_ABORTED") {
    return "결제 정보 등록을 취소했어요.";
  }
  if (code === "NOT_SUPPORTED_METHOD") {
    return "현재 결제수단으로 자동결제를 등록할 수 없어요.";
  }
  if (code === "REJECT_CARD_COMPANY" || code.startsWith("INVALID_CARD_")) {
    return "카드 정보를 확인한 뒤 다시 시도해 주세요.";
  }
  return "결제 정보 등록을 완료하지 못했어요. 다시 시도해 주세요.";
}

export function webBillingRequestFailureMessage(error: unknown): string {
  const code = isApiError(error)
    ? error.code ?? ""
    : error instanceof Error && LOCAL_WEB_BILLING_FAILURE_CODES.has(error.message)
      ? error.message
      : "";
  if (code === "web_subscription_new_checkouts_paused") {
    return "새 구독 결제를 잠시 중단했어요. 기존 결제 확인과 해지는 계속 이용할 수 있어요.";
  }
  if (
    code === "web_billing_not_configured"
    || code === "web_billing_contract_required"
    || code === "web_billing_unavailable"
  ) {
    return "웹 결제가 아직 준비되지 않았어요. 잠시 후 다시 확인해 주세요.";
  }
  if (code === "web_billing_session_expired" || code === "web_billing_session_not_found") {
    return "결제 인증 시간이 지나 다시 시작해야 해요.";
  }
  if (code === "web_billing_trial_state_changed") {
    return "무료 체험 가능 상태가 바뀌어요. 결제하지 않고 상품 조건을 다시 확인해 주세요.";
  }
  if (code === "web_billing_already_active" || code === "subscription_already_active") {
    return "이미 프리미엄을 이용 중이에요.";
  }
  if (code === "web_billing_payment_declined" || code === "web_billing_charge_failed") {
    return "카드 승인을 완료하지 못했어요. 카드 상태를 확인해 주세요.";
  }
  if (
    code === "web_billing_reconciliation_pending"
    || code === "web_billing_processing"
    || code === "billing_provider_reconciliation_pending"
  ) {
    return "결제 결과를 확인하고 있어요. 같은 주문을 다시 확인해 주세요.";
  }
  if (code === "billing_provider_conflict_refund_required") {
    return "다른 스토어 구독과 겹쳐 이번 결제를 프리미엄에 반영하지 않았어요. 환불 확인이 필요해요.";
  }
  if (code === "web_billing_authorization_required") {
    return "결제 정보 등록을 다시 시작해 주세요.";
  }
  if (code === "web_subscription_not_active") {
    return "활성 웹 구독을 확인하지 못했어요.";
  }
  if (code === "web_billing_cancellation_unavailable") {
    return "구독 해지 예약을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.";
  }
  return "웹 결제를 완료하지 못했어요. 잠시 후 다시 시도해 주세요.";
}

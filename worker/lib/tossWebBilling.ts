import {
  safeTossErrorCode,
  validateTossBillingAuthorization,
  validateTossBillingPayment,
  validateTossBillingPaymentState,
} from "../shared/webBilling.js";
import {
  validateTossOneTimePayment,
  validateTossOneTimePaymentState,
} from "../shared/webAiCreditBilling.js";

const TOSS_API_BASE = "https://api.tosspayments.com";
const CHARGE_TIMEOUT_MS = 60_000;
const LOOKUP_TIMEOUT_MS = 12_000;
const TOSS_RESPONSE_MAX_BYTES = 512 * 1024;

export interface TossPaymentsConfig {
  clientKey: string;
  secretKey: string;
  mode: "test" | "live";
}

export interface TossWebBillingConfig extends TossPaymentsConfig {
  encryptionSecret: string;
}

export class TossWebBillingRequestError extends Error {
  readonly code: string;
  readonly outcomeUnknown: boolean;
  readonly httpStatus: number | null;

  constructor(
    code: string,
    options: { outcomeUnknown?: boolean; httpStatus?: number | null; cause?: unknown } = {},
  ) {
    super(code, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "TossWebBillingRequestError";
    this.code = safeTossErrorCode(code);
    this.outcomeUnknown = options.outcomeUnknown === true;
    this.httpStatus = options.httpStatus ?? null;
  }
}

type FetchLike = typeof fetch;

async function readBoundedTossJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > TOSS_RESPONSE_MAX_BYTES) {
    throw new Error("toss_response_too_large");
  }
  const reader = response.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
  let bytes = 0;
  let text = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > TOSS_RESPONSE_MAX_BYTES) {
      try {
        await reader.cancel();
      } catch {
        // 크기 초과 판정은 stream 취소 실패와 무관하게 유지한다.
      }
      throw new Error("toss_response_too_large");
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  text += decoder.decode();
  return text ? JSON.parse(text) as unknown : null;
}

export type TossOneTimePaymentState =
  | { state: "paid"; paymentKey: string }
  | { state: "refunded"; paymentKey: string; refundedAmount: number }
  | { state: "partial_refund"; paymentKey: string; refundedAmount: number }
  | { state: "pending" | "failed"; paymentKey: string };

export type TossBillingPaymentState =
  | {
    state: "paid";
    paymentKey: string;
    refundedAmount: 0;
    balanceAmount: number;
    transactionKeys: [];
  }
  | {
    state: "partial_refund" | "refunded";
    paymentKey: string;
    refundedAmount: number;
    balanceAmount: number;
    transactionKeys: string[];
  };

function authorization(secretKey: string): string {
  return `Basic ${btoa(`${secretKey}:`)}`;
}

async function requestJson(
  fetchImpl: FetchLike,
  config: TossPaymentsConfig,
  path: string,
  init: RequestInit,
  options: { timeoutMs: number; unknownOnFailure: boolean },
): Promise<{ response: Response; json: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetchImpl(`${TOSS_API_BASE}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: authorization(config.secretKey),
        ...(init.body == null ? {} : { "Content-Type": "application/json" }),
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });
    let json: unknown = null;
    try {
      json = await readBoundedTossJson(response);
    } catch (error) {
      throw new TossWebBillingRequestError(
        error instanceof Error && error.message === "toss_response_too_large"
          ? "TOSS_RESPONSE_TOO_LARGE"
          : "TOSS_RESPONSE_INVALID",
        {
          httpStatus: response.status,
          outcomeUnknown: options.unknownOnFailure,
          cause: error,
        },
      );
    }
    if (!response.ok) {
      const providerCode = json && typeof json === "object"
        ? (json as Record<string, unknown>).code
        : null;
      throw new TossWebBillingRequestError(
        safeTossErrorCode(providerCode, `TOSS_HTTP_${response.status}`),
        {
          httpStatus: response.status,
          outcomeUnknown: options.unknownOnFailure && response.status >= 500,
        },
      );
    }
    return { response, json };
  } catch (error) {
    if (error instanceof TossWebBillingRequestError) throw error;
    throw new TossWebBillingRequestError("TOSS_NETWORK_ERROR", {
      cause: error,
      outcomeUnknown: options.unknownOnFailure,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function issueTossBillingKey(
  config: TossWebBillingConfig,
  input: { authKey: string; customerKey: string },
  fetchImpl: FetchLike = fetch,
): Promise<{ billingKey: string }> {
  const { json } = await requestJson(
    fetchImpl,
    config,
    "/v1/billing/authorizations/issue",
    {
      method: "POST",
      body: JSON.stringify({ authKey: input.authKey, customerKey: input.customerKey }),
    },
    { timeoutMs: 15_000, unknownOnFailure: false },
  );
  try {
    return validateTossBillingAuthorization(json, input.customerKey);
  } catch (error) {
    throw new TossWebBillingRequestError("TOSS_AUTHORIZATION_MISMATCH", { cause: error });
  }
}

export async function chargeTossBillingKey(
  config: TossWebBillingConfig,
  input: {
    billingKey: string;
    customerKey: string;
    amount: number;
    orderId: string;
    orderName: string;
  },
  fetchImpl: FetchLike = fetch,
): Promise<{ paymentKey: string }> {
  const { json } = await requestJson(
    fetchImpl,
    config,
    `/v1/billing/${encodeURIComponent(input.billingKey)}`,
    {
      method: "POST",
      body: JSON.stringify({
        customerKey: input.customerKey,
        amount: input.amount,
        orderId: input.orderId,
        orderName: input.orderName,
      }),
    },
    { timeoutMs: CHARGE_TIMEOUT_MS, unknownOnFailure: true },
  );
  try {
    return validateTossBillingPayment(json, input);
  } catch (error) {
    throw new TossWebBillingRequestError("TOSS_PAYMENT_MISMATCH", {
      cause: error,
      outcomeUnknown: true,
    });
  }
}

export async function findTossPaymentByOrderId(
  config: TossWebBillingConfig,
  input: { customerKey: string; amount: number; orderId: string },
  fetchImpl: FetchLike = fetch,
): Promise<{ paymentKey: string } | null> {
  try {
    const { json } = await requestJson(
      fetchImpl,
      config,
      `/v1/payments/orders/${encodeURIComponent(input.orderId)}`,
      { method: "GET" },
      { timeoutMs: LOOKUP_TIMEOUT_MS, unknownOnFailure: true },
    );
    try {
      return validateTossBillingPayment(json, input);
    } catch (error) {
      throw new TossWebBillingRequestError("TOSS_PAYMENT_MISMATCH", {
        cause: error,
        outcomeUnknown: true,
      });
    }
  } catch (error) {
    if (error instanceof TossWebBillingRequestError && error.httpStatus === 404) return null;
    throw error;
  }
}

/** 웹훅 값을 신뢰하지 않고 orderId 조회 Payment 전체를 환불 불변식으로 재검증한다. */
export async function findTossBillingPaymentStateByOrderId(
  config: TossWebBillingConfig,
  input: { customerKey: string; amount: number; orderId: string },
  fetchImpl: FetchLike = fetch,
  timeoutMs = LOOKUP_TIMEOUT_MS,
): Promise<TossBillingPaymentState | null> {
  try {
    const { json } = await requestJson(
      fetchImpl,
      config,
      `/v1/payments/orders/${encodeURIComponent(input.orderId)}`,
      { method: "GET" },
      { timeoutMs, unknownOnFailure: true },
    );
    try {
      return validateTossBillingPaymentState(json, input) as TossBillingPaymentState;
    } catch (error) {
      throw new TossWebBillingRequestError("TOSS_PAYMENT_MISMATCH", {
        cause: error,
        outcomeUnknown: true,
      });
    }
  } catch (error) {
    if (error instanceof TossWebBillingRequestError && error.httpStatus === 404) return null;
    throw error;
  }
}

export async function confirmTossOneTimePayment(
  config: TossPaymentsConfig,
  input: {
    paymentKey: string;
    customerKey: string;
    amount: number;
    orderId: string;
    idempotencyKey: string;
  },
  fetchImpl: FetchLike = fetch,
): Promise<{ paymentKey: string }> {
  const { json } = await requestJson(
    fetchImpl,
    config,
    "/v1/payments/confirm",
    {
      method: "POST",
      headers: { "Idempotency-Key": input.idempotencyKey },
      body: JSON.stringify({
        paymentKey: input.paymentKey,
        orderId: input.orderId,
        amount: input.amount,
      }),
    },
    { timeoutMs: CHARGE_TIMEOUT_MS, unknownOnFailure: true },
  );
  try {
    return validateTossOneTimePayment(json, input);
  } catch (error) {
    throw new TossWebBillingRequestError("TOSS_AI_CREDIT_PAYMENT_MISMATCH", {
      cause: error,
      outcomeUnknown: true,
    });
  }
}

export async function findTossOneTimePaymentByOrderId(
  config: TossPaymentsConfig,
  input: { customerKey: string; amount: number; orderId: string },
  fetchImpl: FetchLike = fetch,
): Promise<{ paymentKey: string } | null> {
  try {
    const { json } = await requestJson(
      fetchImpl,
      config,
      `/v1/payments/orders/${encodeURIComponent(input.orderId)}`,
      { method: "GET" },
      { timeoutMs: LOOKUP_TIMEOUT_MS, unknownOnFailure: true },
    );
    try {
      return validateTossOneTimePayment(json, input);
    } catch (error) {
      throw new TossWebBillingRequestError("TOSS_AI_CREDIT_PAYMENT_MISMATCH", {
        cause: error,
        outcomeUnknown: true,
      });
    }
  } catch (error) {
    if (error instanceof TossWebBillingRequestError && error.httpStatus === 404) return null;
    throw error;
  }
}

export async function findTossOneTimePaymentStateByOrderId(
  config: TossPaymentsConfig,
  input: { customerKey: string; amount: number; orderId: string },
  fetchImpl: FetchLike = fetch,
): Promise<
  TossOneTimePaymentState | null
> {
  try {
    const { json } = await requestJson(
      fetchImpl,
      config,
      `/v1/payments/orders/${encodeURIComponent(input.orderId)}`,
      { method: "GET" },
      { timeoutMs: LOOKUP_TIMEOUT_MS, unknownOnFailure: true },
    );
    try {
      return validateTossOneTimePaymentState(json, input) as TossOneTimePaymentState;
    } catch (error) {
      throw new TossWebBillingRequestError("TOSS_AI_CREDIT_PAYMENT_MISMATCH", {
        cause: error,
        outcomeUnknown: true,
      });
    }
  } catch (error) {
    if (error instanceof TossWebBillingRequestError && error.httpStatus === 404) return null;
    throw error;
  }
}

/** 더 이상 자동결제에 사용하지 않는 빌링키를 Toss에도 폐기한다. */
export async function deleteTossBillingKey(
  config: TossWebBillingConfig,
  billingKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  await requestJson(
    fetchImpl,
    config,
    `/v1/billing/${encodeURIComponent(billingKey)}`,
    { method: "DELETE" },
    { timeoutMs: 12_000, unknownOnFailure: false },
  );
}

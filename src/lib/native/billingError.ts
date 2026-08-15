export type BillingErrorCode =
  | "purchase_canceled"
  | "purchase_pending"
  | "product_unavailable"
  | "billing_unavailable"
  | "billing_failed";

const BILLING_ERROR_MESSAGE = "Billing request failed";
const BILLING_CODE_ALIASES: Readonly<Record<string, BillingErrorCode>> = Object.freeze({
  purchase_canceled: "purchase_canceled",
  purchase_pending: "purchase_pending",
  product_unavailable: "product_unavailable",
  product_offer_unavailable: "product_unavailable",
  billing_unavailable: "billing_unavailable",
});

export class BillingError extends Error {
  readonly code: BillingErrorCode;

  constructor(code: BillingErrorCode) {
    super(BILLING_ERROR_MESSAGE);
    this.name = "BillingError";
    this.code = code;
  }
}

export function isBillingError(error: unknown): error is BillingError {
  return error instanceof BillingError;
}

export function normalizeBillingFailure(error: unknown): BillingError {
  const value = error as { code?: unknown; error?: unknown; data?: { code?: unknown } };
  const raw = value?.data?.code ?? value?.code ?? value?.error;
  const code = typeof raw === "string" ? BILLING_CODE_ALIASES[raw] : undefined;
  return new BillingError(code ?? "billing_failed");
}

import { apiGet, apiPost } from "../client";
import type { WebBillingPlan } from "@/transform/webBilling";
import type { WebAiCreditProductCode } from "@/transform/webAiCreditBilling";

export interface WebBillingCheckoutSessionResponse {
  sessionId?: unknown;
  customerKey?: unknown;
  clientKey?: unknown;
  plan?: unknown;
  amount?: unknown;
  displayPrice?: unknown;
  trialEligible?: unknown;
  trialDays?: unknown;
  expiresAt?: unknown;
}

export interface WebBillingCheckoutRecoveryResponse {
  sessionId?: unknown;
  customerKey?: unknown;
}

export type WebBillingCompletionResponse =
  | {
    ok: true;
    status: "trial";
    plan: WebBillingPlan;
    trialDays: 7;
    trialEndsAt: string;
    nextChargeAt: string;
  }
  | {
    ok: true;
    status: "active";
    plan: WebBillingPlan;
    currentPeriodEnd: string;
  };

export interface WebBillingCancellationResponse {
  ok: true;
  status: "cancelled";
  currentPeriodEnd: string;
}

export interface WebAiCreditStatusResponse {
  isPremium: boolean;
  dailyIncludedLimit: number;
  dailyIncludedUsed: number;
  dailyIncludedRemaining: number;
  purchasedCredits: number;
  purchasedCreditDebt: number;
}

export interface WebAiCreditCheckoutRecoveryResponse {
  familyId?: unknown;
  childUserId?: unknown;
  orderId?: unknown;
  customerKey?: unknown;
  productCode?: unknown;
  credits?: unknown;
  amount?: unknown;
  currency?: unknown;
  expiresAt?: unknown;
}

export function fetchWebBillingCatalog(familyId: string): Promise<unknown> {
  return apiGet<unknown>(`/api/billing/web/catalog?familyId=${encodeURIComponent(familyId)}`);
}

export function createWebBillingCheckoutSession(input: {
  familyId: string;
  plan: WebBillingPlan;
  trialExpected: boolean;
}): Promise<WebBillingCheckoutSessionResponse> {
  return apiPost<WebBillingCheckoutSessionResponse>("/api/billing/web/checkout-session", input);
}

export function resolveWebBillingCheckoutSession(input: {
  familyId: string;
  customerKey: string;
}): Promise<WebBillingCheckoutRecoveryResponse> {
  return apiPost<WebBillingCheckoutRecoveryResponse>(
    "/api/billing/web/checkout-session/resolve",
    input,
  );
}

export function completeWebBillingCheckout(input: {
  familyId: string;
  sessionId: string;
  authKey: string;
  customerKey: string;
}): Promise<WebBillingCompletionResponse> {
  return apiPost<WebBillingCompletionResponse>("/api/billing/web/complete", input);
}

export function cancelWebBillingSubscription(input: {
  familyId: string;
}): Promise<WebBillingCancellationResponse> {
  return apiPost<WebBillingCancellationResponse>("/api/billing/web/cancel", input);
}

export type WebAiCreditCompletionResponse =
  | {
    ok: true;
    status: "done";
    orderId: string;
    productCode: WebAiCreditProductCode;
    credits: number;
    debtApplied: number;
    availableCreditsAdded: number;
    creditStatus: WebAiCreditStatusResponse;
  }
  | {
    ok: false;
    status: "pending" | "unknown" | "busy";
    error: "web_ai_credit_reconciliation_pending";
  };

export function fetchWebAiCreditCatalog(familyId: string): Promise<unknown> {
  return apiGet<unknown>(
    `/api/billing/web/ai-credits/catalog?familyId=${encodeURIComponent(familyId)}`,
  );
}

export function createWebAiCreditCheckout(input: {
  familyId: string;
  childUserId: string;
  productCode: WebAiCreditProductCode;
}): Promise<unknown> {
  return apiPost<unknown>("/api/billing/web/ai-credits/checkout-session", input);
}

export function resolveWebAiCreditCheckout(input: {
  familyId: string;
  childUserId: string;
  orderId: string;
  amount: number;
}): Promise<WebAiCreditCheckoutRecoveryResponse> {
  return apiPost<WebAiCreditCheckoutRecoveryResponse>(
    "/api/billing/web/ai-credits/checkout-session/resolve",
    input,
  );
}

export function completeWebAiCreditCheckout(input: {
  familyId: string;
  childUserId: string;
  orderId: string;
  paymentKey: string;
  amount: number;
}): Promise<WebAiCreditCompletionResponse> {
  return apiPost<WebAiCreditCompletionResponse>("/api/billing/web/ai-credits/complete", input);
}

export function reconcileWebAiCreditCheckout(input: {
  familyId: string;
  childUserId: string;
  orderId: string;
}): Promise<WebAiCreditCompletionResponse> {
  return apiPost<WebAiCreditCompletionResponse>("/api/billing/web/ai-credits/reconcile", input);
}

export interface BillingResultDiagnostics {
  responseCode: number;
  debugMessage: string;
}

export interface UnfetchedBillingProductDiagnostics {
  productId: string;
  productType: string;
  statusCode: number;
}

export interface BillingProductQueryDiagnostics {
  billingResult: BillingResultDiagnostics;
  requestedCount: number;
  returnedCount: number;
  unfetchedProducts: UnfetchedBillingProductDiagnostics[];
}

export interface BillingProductsQueryDiagnostics {
  subscriptions?: BillingProductQueryDiagnostics;
  inAppProducts?: BillingProductQueryDiagnostics;
}

export interface BillingProductsQueryResult<TSubscription, TInAppProduct = unknown> {
  subscriptions?: TSubscription[];
  inAppProducts?: TInAppProduct[];
  diagnostics?: BillingProductsQueryDiagnostics;
}

export interface SubscriptionProductQueryResult<TSubscription> {
  product: TSubscription | null;
  diagnostics: BillingProductQueryDiagnostics | null;
}

/** 구버전 네이티브 응답과 Billing 9 진단 응답을 같은 계약으로 읽는다. */
export function resolveSubscriptionProductQuery<TSubscription extends { productId?: string | null }>(
  result: BillingProductsQueryResult<TSubscription>,
  productId: string,
): SubscriptionProductQueryResult<TSubscription> {
  const subscriptions = Array.isArray(result.subscriptions) ? result.subscriptions : [];
  return {
    product: subscriptions.find((item) => item.productId === productId) ?? null,
    diagnostics: result.diagnostics?.subscriptions ?? null,
  };
}

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

export interface BillingProductQueryOptions {
  subscriptionProductIds: string[];
  inAppProductIds: string[];
}

export type BillingProductQuery<TSubscription, TInAppProduct = unknown> = (
  options: BillingProductQueryOptions,
) => Promise<BillingProductsQueryResult<TSubscription, TInAppProduct>>;

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

/** 네이티브 queryProducts의 성공·빈 결과·rejection 계약을 변경 없이 전달한다. */
export async function querySubscriptionProductWithDiagnostics<
  TSubscription extends { productId?: string | null },
>(
  queryProducts: BillingProductQuery<TSubscription>,
  productId: string,
): Promise<SubscriptionProductQueryResult<TSubscription>> {
  const result = await queryProducts({
    subscriptionProductIds: [productId],
    inAppProductIds: [],
  });
  return resolveSubscriptionProductQuery(result, productId);
}

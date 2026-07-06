/**
 * Google Play 결제 브리지(hyeni-1 googlePlayBilling.js + subscriptionBilling.js 충실 이관).
 *
 * 흐름: GooglePlayBillingPlugin 으로 결제(구독/인앱) → purchaseToken 획득 →
 *       백엔드 검증(POST /api/billing/google-play-verify) → 서버가 지시하면
 *       acknowledge(구독) / consume(크레딧) 마감.
 *
 * 웹(PWA)에는 네이티브 플러그인이 없다 → requirePlugin() 이 명확한 한국어 에러로 throw.
 *   호출부(화면)는 반드시 먼저 isBillingAvailable() 로 분기해 웹에서는 안내 토스트만 띄운다.
 *   (자동 실행 금지 — 결제는 사용자 onClick 에서만.)
 *
 * ⚠️ 상품 ID/베이스플랜/크레딧 개수는 Google Play Console 설정값과 반드시 일치해야 한다.
 *    (아래 상수는 hyeni-1 premiumPolicy.js 원본과 동일하게 이관한 것.)
 */
import { getNativePlugin, isNativePlatform } from "./plugins";
import { apiPost } from "@/lib/api/client";

const PACKAGE_NAME = "com.hyeni.calendar";
const PLUGIN_NAME = "GooglePlayBilling";
const VERIFY_PATH = "/api/billing/google-play-verify";

/** 프리미엄 구독 상품(단일). 월/연은 basePlanId 로 구분한다. */
export const SUBSCRIPTION_PRODUCT_ID = "hyeni_premium";
export const MONTHLY_BASE_PLAN_ID = "monthly-2900";
export const ANNUAL_BASE_PLAN_ID = "annual-27840";

/**
 * AI 크레딧 인앱 상품(개수 → productId). premiumPolicy.js 원본과 동일.
 * ⚠️ 백엔드가 인정하는 개수는 30/80/200 뿐이다(리디자인 화면의 30/100/300 과 불일치 —
 *    화면 배선 시 backendAmount 로 매핑한다. designGaps 참고).
 */
export const AI_CREDIT_PRODUCTS: Readonly<Record<number, string>> = Object.freeze({
  30: "hyeni_ai_credits_30",
  80: "hyeni_ai_credits_80",
  200: "hyeni_ai_credits_200",
});

/** 백엔드가 인정하는 크레딧 팩 개수(단일 source of truth). */
export const AI_CREDIT_AMOUNTS: readonly number[] = Object.freeze([30, 80, 200]);

// ── 네이티브 플러그인 계약(Java GooglePlayBillingPlugin) ──────────────

/** Java serializePurchase() 가 내려주는 원형 구매 객체. */
export interface RawPurchase {
  purchaseToken?: string;
  orderId?: string | null;
  packageName?: string;
  products?: string[];
  purchaseState?: string; // "PURCHASED" | "PENDING" | "UNSPECIFIED"
  acknowledged?: boolean;
  quantity?: number;
  originalJson?: string | null;
  signature?: string | null;
}

interface PurchaseResult {
  purchase?: RawPurchase;
}

interface GooglePlayBillingPlugin {
  isAvailable(): Promise<{ available: boolean; connected: boolean }>;
  purchaseSubscription(opts: { productId: string; basePlanId: string }): Promise<PurchaseResult>;
  purchaseInAppProduct(opts: { productId: string }): Promise<PurchaseResult>;
  acknowledgePurchase(opts: { purchaseToken: string }): Promise<{ acknowledged: boolean }>;
  consumePurchase(opts: { purchaseToken: string }): Promise<{ consumed: boolean; purchaseToken: string }>;
  queryPurchases(): Promise<{ purchases: RawPurchase[] }>;
}

// ── 정규화/검증 ──────────────────────────────────────────────────────

/** 서버 검증에 실어 보낼 정규화된 구매 객체(hyeni-1 normalizePurchase 이관). */
export interface NormalizedPurchase {
  purchaseToken: string;
  orderId: string | null;
  packageName: string;
  products: string[];
  purchaseState: string;
  acknowledged: boolean;
  quantity: number;
  originalJson: string | null;
  signature: string | null;
}

/** POST /api/billing/google-play-verify 응답(서버가 후속 액션을 지시). */
export interface VerifyResponse {
  ok?: boolean;
  message?: string;
  error?: string;
  needsClientAcknowledge?: boolean;
  needsClientConsume?: boolean;
  entitlement?: { status?: string } | null;
  status?: string;
  creditStatus?: unknown;
}

// ── 에러 매핑(Capacitor reject code → 한국어 메시지) ──────────────────

type BillingErrorLike = {
  message?: unknown;
  code?: unknown;
  error?: unknown;
  data?: { code?: unknown };
};

function messageOf(error: unknown, fallback: string): string {
  const e = error as BillingErrorLike;
  if (typeof e?.message === "string" && e.message.trim()) return e.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}

function codeOf(error: unknown): string {
  const e = error as BillingErrorLike;
  const raw = e?.data?.code ?? e?.code ?? e?.error;
  return typeof raw === "string" ? raw : "";
}

/** 결제 취소 여부(호출부에서 취소 토스트를 생략하고 싶을 때 사용). */
export function isPurchaseCanceled(error: unknown): boolean {
  return codeOf(error) === "purchase_canceled";
}

function billingError(error: unknown, fallback = "결제 처리 중 오류가 발생했어요."): Error {
  const code = codeOf(error);
  if (code === "purchase_canceled") return new Error("구매가 취소되었어요.");
  if (code === "purchase_pending") {
    return new Error("결제 승인이 대기 중입니다. 승인 완료 후 다시 확인해 주세요.");
  }
  if (code === "product_unavailable" || code === "product_offer_unavailable") {
    return new Error("Google Play 상품 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
  }
  if (code === "billing_unavailable") return new Error("이 기기에서 Google Play 결제를 사용할 수 없어요.");
  return new Error(messageOf(error, fallback));
}

// ── 내부 헬퍼 ────────────────────────────────────────────────────────

/** 네이티브 결제 사용 가능 여부(웹/PWA 에서는 false). 화면은 이 값으로 CTA 분기. */
export function isBillingAvailable(): boolean {
  return isNativePlatform() && getNativePlugin<GooglePlayBillingPlugin>(PLUGIN_NAME) !== null;
}

function requirePlugin(): GooglePlayBillingPlugin {
  const plugin = getNativePlugin<GooglePlayBillingPlugin>(PLUGIN_NAME);
  if (!plugin) throw new Error("Google Play 결제는 Android 앱에서만 사용할 수 있어요.");
  return plugin;
}

function normalizePurchase(purchase: RawPurchase | undefined): NormalizedPurchase {
  const products = Array.isArray(purchase?.products) ? purchase.products : [];
  return {
    purchaseToken: purchase?.purchaseToken || "",
    orderId: purchase?.orderId || null,
    packageName: purchase?.packageName || PACKAGE_NAME,
    products,
    purchaseState: purchase?.purchaseState || "",
    acknowledged: !!purchase?.acknowledged,
    quantity: Number(purchase?.quantity || 1),
    originalJson: purchase?.originalJson || null,
    signature: purchase?.signature || null,
  };
}

/**
 * 서버 구매 검증. 부모 세션 JWT(Authorization)는 apiPost 가 자동으로 싣는다.
 * 비 2xx 는 apiPost 가 ApiError 로 throw, 2xx 라도 ok=false 면 여기서 throw.
 */
async function verifyPurchase(body: Record<string, unknown>): Promise<VerifyResponse> {
  const data = await apiPost<VerifyResponse>(VERIFY_PATH, body);
  if (!data?.ok) {
    throw new Error(data?.message || data?.error || "서버 구매 검증에 실패했어요.");
  }
  return data;
}

// ── 공개 API: 구독 ───────────────────────────────────────────────────

export interface SubscriptionPurchaseInput {
  familyId: string;
  /** 미지정 시 월구독. 연구독은 ANNUAL_BASE_PLAN_ID. */
  basePlanId?: string;
}

export interface SubscriptionPurchaseResult {
  success: true;
  productId: string;
  basePlanId: string;
  purchase: NormalizedPurchase;
  verification: VerifyResponse;
  status: string;
  isTrial: boolean;
}

/**
 * 프리미엄 구독 구매(hyeni-1 purchasePremiumSubscription 이관).
 * 네이티브 전용 — 웹에서 호출하면 requirePlugin() 이 throw 하므로 화면은 먼저
 * isBillingAvailable() 로 분기해야 한다.
 */
export async function launchSubscriptionPurchase({
  familyId,
  basePlanId = MONTHLY_BASE_PLAN_ID,
}: SubscriptionPurchaseInput): Promise<SubscriptionPurchaseResult> {
  if (!familyId) throw new Error("가족 연결 후 다시 시도해 주세요.");
  const plugin = requirePlugin();

  let result: PurchaseResult;
  try {
    result = await plugin.purchaseSubscription({ productId: SUBSCRIPTION_PRODUCT_ID, basePlanId });
  } catch (error) {
    throw billingError(error, "구독을 시작하지 못했어요.");
  }

  const purchase = normalizePurchase(result?.purchase);
  if (!purchase.purchaseToken) throw new Error("구매 토큰을 확인하지 못했어요.");

  const verification = await verifyPurchase({
    familyId,
    packageName: PACKAGE_NAME,
    productType: "subscription",
    productId: SUBSCRIPTION_PRODUCT_ID,
    basePlanId,
    purchaseToken: purchase.purchaseToken,
    orderId: purchase.orderId,
    purchase,
  });

  // 서버가 지시할 때만 클라이언트 acknowledge(중복 방지 — 이미 acknowledged 면 생략).
  if (verification.needsClientAcknowledge && !purchase.acknowledged) {
    await plugin.acknowledgePurchase({ purchaseToken: purchase.purchaseToken });
  }

  return {
    success: true,
    productId: SUBSCRIPTION_PRODUCT_ID,
    basePlanId,
    purchase,
    verification,
    status: verification.entitlement?.status || verification.status || "active",
    isTrial: verification.entitlement?.status === "trial",
  };
}

// ── 공개 API: AI 크레딧(인앱) ─────────────────────────────────────────

export interface CreditPurchaseInput {
  familyId: string;
  childUserId: string;
  /** 결제한 부모 user id(있으면 서버 원장에 기록). */
  parentId?: string | null;
  /** 백엔드가 인정하는 개수(30/80/200). */
  amount?: number;
}

export interface CreditPurchaseResult {
  success: true;
  productId: string;
  amount: number;
  purchase: NormalizedPurchase;
  verification: VerifyResponse;
  creditStatus: unknown;
}

/** 크레딧 개수 → 인앱 productId. 미지원 개수는 명확히 throw(잘못된 결제 방지). */
export function creditProductId(amount: number): string {
  const id = AI_CREDIT_PRODUCTS[amount];
  if (!id) throw new Error("지원하지 않는 크레딧 팩이에요.");
  return id;
}

/**
 * AI 크레딧 팩 구매(hyeni-1 purchaseAiCreditPack 이관).
 * 크레딧은 자녀별 — familyId + childUserId 필수. 네이티브 전용.
 */
export async function launchCreditPurchase({
  familyId,
  childUserId,
  parentId = null,
  amount = 30,
}: CreditPurchaseInput): Promise<CreditPurchaseResult> {
  if (!familyId || !childUserId) {
    throw new Error("AI 크레딧을 추가할 아이를 먼저 선택해 주세요.");
  }
  const productId = creditProductId(amount);
  const plugin = requirePlugin();

  let result: PurchaseResult;
  try {
    result = await plugin.purchaseInAppProduct({ productId });
  } catch (error) {
    throw billingError(error, "AI 크레딧 구매를 시작하지 못했어요.");
  }

  const purchase = normalizePurchase(result?.purchase);
  if (!purchase.purchaseToken) throw new Error("구매 토큰을 확인하지 못했어요.");

  const verification = await verifyPurchase({
    familyId,
    childUserId,
    parentId,
    packageName: PACKAGE_NAME,
    productType: "inapp",
    productId,
    creditAmount: amount,
    purchaseToken: purchase.purchaseToken,
    orderId: purchase.orderId,
    purchase,
  });

  // 소비성 상품 — 서버가 지시하면 consume 해야 재구매가 가능해진다.
  if (verification.needsClientConsume) {
    await plugin.consumePurchase({ purchaseToken: purchase.purchaseToken });
  }

  return {
    success: true,
    productId,
    amount,
    purchase,
    verification,
    creditStatus: verification.creditStatus ?? null,
  };
}

// ── 공개 API: 통합 진입점(productId 라우팅) ───────────────────────────

export interface LaunchPurchaseContext {
  familyId: string;
  /** 구독 결제일 때 사용(월/연). */
  basePlanId?: string;
  /** 크레딧 결제일 때 필수. */
  childUserId?: string;
  parentId?: string | null;
}

/**
 * productId 로 구독/크레딧을 자동 분기하는 통합 진입점.
 * - SUBSCRIPTION_PRODUCT_ID → launchSubscriptionPurchase
 * - AI_CREDIT_PRODUCTS 값    → launchCreditPurchase
 * 화면에서 상품 성격이 명확하면 위 전용 함수를 직접 쓰는 편이 타입상 안전하다.
 */
export async function launchPurchase(
  productId: string,
  ctx: LaunchPurchaseContext,
): Promise<SubscriptionPurchaseResult | CreditPurchaseResult> {
  if (productId === SUBSCRIPTION_PRODUCT_ID) {
    return launchSubscriptionPurchase({ familyId: ctx.familyId, basePlanId: ctx.basePlanId });
  }
  const amount = AI_CREDIT_AMOUNTS.find((n) => AI_CREDIT_PRODUCTS[n] === productId);
  if (amount == null) throw new Error("지원하지 않는 상품이에요.");
  if (!ctx.childUserId) throw new Error("AI 크레딧을 추가할 아이를 먼저 선택해 주세요.");
  return launchCreditPurchase({
    familyId: ctx.familyId,
    childUserId: ctx.childUserId,
    parentId: ctx.parentId ?? null,
    amount,
  });
}

// ── 공개 API: 복원(구매 내역 조회) ───────────────────────────────────

/**
 * Google Play 구매 내역 조회(구독 복원 등에 사용). 네이티브 전용.
 * 실패해도 앱 흐름을 막지 않도록 호출부에서 try/catch 권장(hyeni-1 restore 계약).
 */
export async function queryGooglePlayPurchases(): Promise<RawPurchase[]> {
  const plugin = requirePlugin();
  try {
    const res = await plugin.queryPurchases();
    return Array.isArray(res?.purchases) ? res.purchases : [];
  } catch (error) {
    throw billingError(error, "구매 내역을 확인하지 못했어요.");
  }
}

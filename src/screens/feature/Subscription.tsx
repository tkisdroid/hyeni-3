import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Check } from "lucide-react";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { ScreenQueryState } from "@/components/ui/ScreenQueryState";
import { useAuth } from "@/auth/AuthContext";
import { useEntitlement } from "@/queries/useEntitlement";
import { qk } from "@/queries/keys";
import {
  isBillingAvailable,
  fetchGooglePlayTrialEligibility,
  fetchSubscriptionProductDetails,
  launchSubscriptionPurchase,
  ANNUAL_BASE_PLAN_ID,
  MONTHLY_BASE_PLAN_ID,
  GOOGLE_PLAY_PACKAGE_NAME,
  SUBSCRIPTION_PRODUCT_ID,
} from "@/lib/native/billing";
import {
  hasExpectedLaunchSubscriptionPrice,
  selectSubscriptionOffer,
  subscriptionPlanForNavigationKey,
  type BillingProductDetails,
} from "@/transform/subscriptionOffer";
import { getPlatform } from "@/lib/native/plugins";
import {
  cancelWebBillingSubscription,
  completeWebBillingCheckout,
  createWebBillingCheckoutSession,
  fetchWebBillingCatalog,
  resolveWebBillingCheckoutSession,
} from "@/lib/api/endpoints/webBilling";
import { startTossBillingAuthorization } from "@/lib/webBilling";
import { useIntl } from "react-intl";
import { localizeApiError } from "@/i18n/apiError";
import { BillingError } from "@/lib/native/billingError";
import { isApiError } from "@/lib/api/errors";
import {
  buildWebBillingRedirectUrls,
  clearPendingWebBilling,
  clearWebBillingRedirectQuery,
  parseWebBillingRedirect,
  readPendingWebBilling,
  savePendingWebBilling,
  validateWebBillingCatalog,
  validateWebBillingCheckoutSession,
  validateRecoveredWebBillingCheckoutSession,
  webBillingAnnualSavings,
  webBillingFailureMessage,
  webBillingRequestFailureMessage,
  type WebBillingCatalog,
  type WebBillingPlan,
} from "@/transform/webBilling";
import { openExternal } from "@/lib/native/browser";
import {
  classifyPremiumCheckoutFailure,
  recordPremiumFunnelEvent,
} from "@/lib/premiumFunnel";
import { resolveQueryTruthState } from "@/transform/queryTruthState";
import {
  browserPremiumReturnIntentStorage,
  clearPremiumReturnIntent,
  loadPremiumReturnIntent,
} from "@/transform/premiumReturnIntent";
import { usePwaUpdateCriticalSection } from "@/lib/usePwaUpdateCriticalSection";
import {
  TIERS,
  FEATURES,
  maxChildrenFor,
  placeLimitFor,
  historyDaysFor,
  manualLocationRequestDailyLimitFor,
  dangerZoneLimitFor,
  forceRingDailyLimitFor,
  aiFriendDailyBaseFor,
  aiScheduleDailyLimitFor,
  locationModeFor,
  canUse,
  getTierLabel,
  type Tier,
} from "@/transform/tierPolicy";
import { MAX_SUPPLY_ITEMS_PER_KIND } from "@/transform/eventSupplies";
import type { SupportedLocale } from "@/i18n/locale";
import { useLocale } from "@/i18n/useLocale";
import {
  formatDateTime,
  formatNumber,
  formatProviderPrice,
  formatRelativeTime,
  LEGACY_FAMILY_TIME_ZONE,
} from "@/i18n/format";
import "./Subscription.css";

/** 프리미엄 혜택 목록 (표현 데이터 — 화면 고정). */
const BENEFITS = [
  { icon: "ui/pin-heart.webp", t: "실시간 위치 확인", s: "아이의 현재 위치와 이동 흐름을 더 빠르게 확인해요" },
  { icon: "ui/menu-child-tracker.webp", t: "다자녀 안심 관리", s: "두 아이까지 일정과 위치를 함께 관리해요" },
  { icon: "ui/ai-robot.webp", t: "AI 하루 요약", s: "일정·위치·안전 기록을 AI가 정리해 드려요" },
  { icon: "ui/menu-remote-audio.webp", t: "주변 소리 듣기", s: "위급할 때 1분 동안 아이 주변 상황을 확인해요" },
  { icon: "ui/shield-heart.webp", t: "장소·위험구역 무제한", s: "필요한 안심 장소와 위험구역을 제한 없이 등록해요" },
] as const;

// ── 플랜 비교표(S-02) — 티어별 값은 tierPolicy, 준비물 저장 상한은 eventSupplies에서 파생 ──
const COMPARE_COLS: readonly Tier[] = [TIERS.FREE, TIERS.PREMIUM];
const YES = "✓";
const NO = "—";
const EXISTING_CHILD_DOWNGRADE_NOTICE = "이미 연결된 아이는 구독이 끝나도 자동으로 해제하거나 숨기지 않아요.";
const DOWNGRADE_LIMIT_NOTICE = "구독 중 이미 저장한 한도 초과 장소·위험구역은 삭제되지 않고 관리할 수 있지만, 프리미엄을 다시 시작하기 전까지 알림 대상에서 제외돼요.";

function limitLabel(n: number): string {
  return n === Infinity ? "무제한" : `${n}개`;
}
function locationLabel(t: Tier): string {
  const mode = locationModeFor(t);
  if (mode === "realtime") return "실시간";
  if (mode === "standard") return "약 10분 간격 최신 실측";
  return "잠금";
}

function dailyLimitLabel(n: number): string {
  return n === Infinity ? "제한 없음" : `하루 ${n}회`;
}

function rolling24LimitLabel(n: number): string {
  return n === Infinity ? "최근 24시간 제한 없음" : `최근 24시간 ${n}회`;
}

interface CompareRow {
  label: string;
  cell: (t: Tier) => string;
  /** 과거 스토어 방문 혜택 가족이 Free 열에서 실제로 보는 보존 값. */
  reviewedCell?: string;
  /** 안전 기능(티어 무관 항상 제공) — 초록 강조. */
  safe?: boolean;
}
const COMPARE_ROWS: readonly CompareRow[] = [
  { label: "새 아이 연결 상한", cell: (t) => `${maxChildrenFor(t)}명` },
  { label: "일정·메모·스티커", cell: () => "무제한" },
  { label: "준비물·숙제", cell: () => `아이별 하루 각각 ${MAX_SUPPLY_ITEMS_PER_KIND}개` },
  { label: "위치 보기", cell: (t) => locationLabel(t) },
  { label: "지금 위치 요청", cell: (t) => rolling24LimitLabel(manualLocationRequestDailyLimitFor(t)) },
  { label: "위치 이력", cell: (t) => (historyDaysFor(t) === 1 ? "오전 8시 기준 현재 안심일" : `최근 ${historyDaysFor(t)}일`) },
  { label: "장소·도착/출발 알림", cell: (t) => limitLabel(placeLimitFor(t)), reviewedCell: "기존 혜택 3개" },
  { label: "위험구역", cell: (t) => limitLabel(dangerZoneLimitFor(t)) },
  { label: "소리 울리기", cell: (t) => rolling24LimitLabel(forceRingDailyLimitFor(t)) },
  { label: "AI 친구 기본 제공", cell: (t) => dailyLimitLabel(aiFriendDailyBaseFor(t)) },
  { label: "AI 일정 정리", cell: (t) => dailyLimitLabel(aiScheduleDailyLimitFor(t)) },
  { label: "오늘의 안심 리포트", cell: () => "제공" },
  { label: "주변 소리 듣기", cell: (t) => (canUse(t, FEATURES.REMOTE_AUDIO) ? "최대 1분" : NO) },
  { label: "위치 끊김·미등록 체류", cell: (t) => (canUse(t, FEATURES.SAFETY_INSIGHTS) ? "자동 알림" : "수동 확인") },
  { label: "AI 하루 요약", cell: (t) => (canUse(t, FEATURES.AI_ANALYSIS) ? YES : NO) },
  { label: "주간 가족 리포트", cell: (t) => (canUse(t, FEATURES.WEEKLY_REPORT) ? "전체 보기" : "한 줄 미리보기") },
  { label: "학원 시간표 자동 정리", cell: (t) => (canUse(t, FEATURES.ACADEMY_SCHEDULE) ? YES : NO) },
  { label: "SOS · 긴급 알림", cell: () => YES, safe: true },
];

type Plan = WebBillingPlan;
const GOOGLE_PLAY_FUNNEL_PROVIDER = "google_play" as const;
const TOSS_FUNNEL_PROVIDER = "toss_payments" as const;

/** 결제 주기 종료일 → "2026년 7월 4일" 형식. */
function formatPeriodEnd(d: Date, locale: SupportedLocale): string {
  return formatDateTime(d, {
    locale,
    timeZone: LEGACY_FAMILY_TIME_ZONE,
    dateStyle: "medium",
  });
}

function webBillingStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    const storage = window.sessionStorage;
    const probe = "hyeni.webBilling.storageProbe";
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

function shouldRetainWebBillingPending(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (!isApiError(error)) return false;
  if (
    error.code === "web_billing_reconciliation_pending"
    || error.code === "web_billing_processing"
    || error.code === "billing_provider_reconciliation_pending"
  ) return true;
  return error.status >= 500;
}

/** 구독 · 페이월: 프리미엄 혜택 · 플랜 선택 · 결제 CTA. 실 티어로 활성 상태 표시. */
export function Subscription() {
  const intl = useIntl();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const { show } = useToast();
  const { familyId } = useAuth();
  const qc = useQueryClient();
  const isWebBillingChannel = getPlatform() === "web";
  const [plan, setPlan] = useState<Plan>("year");
  const planRefs = useRef<Record<Plan, HTMLButtonElement | null>>({ year: null, month: null });
  const [busy, setBusy] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [webCatalog, setWebCatalog] = useState<WebBillingCatalog | null>(null);
  const [webCatalogUnavailable, setWebCatalogUnavailable] = useState(false);
  const [billingRedirect] = useState(() => (
    typeof window === "undefined"
      ? { kind: "none" } as const
      : parseWebBillingRedirect(window.location.search)
  ));
  const billingRedirectHandledRef = useRef(false);
  const billingRedirectScrubbedRef = useRef(false);
  const subscriptionViewRecordedRef = useRef(false);
  const [returnIntent] = useState(() => {
    const storage = browserPremiumReturnIntentStorage();
    return storage ? loadPremiumReturnIntent(storage) : null;
  });
  const entitlementQuery = useEntitlement();
  const { ready, isPremium, view, tier } = entitlementQuery;
  const comparisonTier = tier === TIERS.REVIEWED ? TIERS.FREE : tier;
  const subscriptionQueryState = resolveQueryTruthState([
    { isLoading: entitlementQuery.isLoading, isError: entitlementQuery.isError },
  ]);
  const subscriptionDataEmpty = subscriptionQueryState === "ready" && (!ready || !view);
  const retrySubscription = async (): Promise<void> => {
    await entitlementQuery.refetch();
  };
  const premiumActive = ready && isPremium;
  const webCancellationScheduled = view?.provider === "toss_web" && view?.status === "cancelled";
  const [productDetails, setProductDetails] = useState<BillingProductDetails | null>(null);
  const [playTrialEligible, setPlayTrialEligible] = useState<boolean | null>(null);
  const subscriptionSource = returnIntent?.source ?? "direct";
  const [webReconciliationPending, setWebReconciliationPending] = useState(false);
  const [webReconcileNonce, setWebReconcileNonce] = useState(0);
  usePwaUpdateCriticalSection(busy || webReconciliationPending);
  const webCompletionInFlightRef = useRef(false);
  const webPendingToastShownRef = useRef(false);
  const webReconcileTimerRef = useRef<number | null>(null);
  const webReconcileAttemptRef = useRef(0);

  const onPlanKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, currentPlan: Plan): void => {
    const nextPlan = subscriptionPlanForNavigationKey(currentPlan, event.key);
    if (!nextPlan) return;
    event.preventDefault();
    setPlan(nextPlan);
    planRefs.current[nextPlan]?.focus();
  };

  const scheduleWebReconciliation = useCallback(() => {
    if (
      typeof window === "undefined"
      || webReconcileTimerRef.current !== null
      || webReconcileAttemptRef.current >= 6
    ) return;
    webReconcileTimerRef.current = window.setTimeout(() => {
      webReconcileTimerRef.current = null;
      setWebReconcileNonce((value) => value + 1);
    }, 5_000);
  }, []);

  useEffect(() => () => {
    if (webReconcileTimerRef.current !== null) {
      window.clearTimeout(webReconcileTimerRef.current);
      webReconcileTimerRef.current = null;
    }
  }, []);

  const finishWebBilling = useCallback(async (input: {
    familyId: string;
    sessionId: string;
    customerKey: string;
    authKey: string;
    storage: Storage | null;
  }): Promise<void> => {
    if (webCompletionInFlightRef.current) return;
    webCompletionInFlightRef.current = true;
    setBusy(true);
    try {
      const completed = await completeWebBillingCheckout({
        familyId: input.familyId,
        sessionId: input.sessionId,
        authKey: input.authKey,
        customerKey: input.customerKey,
      });
      if (input.storage) clearPendingWebBilling(input.storage);
      setWebReconciliationPending(false);
      webPendingToastShownRef.current = false;
      webReconcileAttemptRef.current = 0;
      recordPremiumFunnelEvent({
        event: "checkout_result",
        result: "success",
        provider: TOSS_FUNNEL_PROVIDER,
        error_code: null,
      });
      await qc.invalidateQueries({ queryKey: qk.entitlement(input.familyId) });
      show(
        completed.status === "trial"
          ? "7일 무료 체험을 시작했어요"
          : "프리미엄 구독을 시작했어요",
        "👑",
      );
    } catch (error) {
      if (shouldRetainWebBillingPending(error)) {
        const expiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
        try {
          if (input.storage) savePendingWebBilling(input.storage, {
            sessionId: input.sessionId,
            customerKey: input.customerKey,
            expiresAt,
          });
        } catch {
          // 기존 pending을 보존할 수 없는 브라우저에서는 서버 정본만 재조회한다.
        }
        setWebReconciliationPending(true);
        if (!webPendingToastShownRef.current) {
          webPendingToastShownRef.current = true;
          show("결제 승인 결과를 확인하고 있어요. 중복 결제 없이 같은 주문을 다시 확인합니다.", "👑");
        }
        scheduleWebReconciliation();
        return;
      }
      if (input.storage) clearPendingWebBilling(input.storage);
      setWebReconciliationPending(false);
      webPendingToastShownRef.current = false;
      webReconcileAttemptRef.current = 0;
      const failure = classifyPremiumCheckoutFailure(error);
      recordPremiumFunnelEvent({
        event: "checkout_result",
        result: failure.result,
        provider: TOSS_FUNNEL_PROVIDER,
        error_code: failure.error_code,
      });
      show(webBillingRequestFailureMessage(error), "👑");
    } finally {
      webCompletionInFlightRef.current = false;
      setBusy(false);
    }
  }, [qc, scheduleWebReconciliation, show]);

  useEffect(() => {
    if (subscriptionViewRecordedRef.current) return;
    subscriptionViewRecordedRef.current = true;
    recordPremiumFunnelEvent({
      event: "subscription_view",
      source: subscriptionSource,
    });
  }, [subscriptionSource]);

  useEffect(() => {
    if (!isWebBillingChannel || premiumActive || !familyId) return;
    let cancelled = false;
    setWebCatalogUnavailable(false);
    void fetchWebBillingCatalog(familyId)
      .then((raw) => {
        const catalog = validateWebBillingCatalog(raw);
        recordPremiumFunnelEvent({
          event: "product_query_result",
          provider: TOSS_FUNNEL_PROVIDER,
          result: "success",
        });
        if (!cancelled) setWebCatalog(catalog);
      })
      .catch(() => {
        recordPremiumFunnelEvent({
          event: "product_query_result",
          provider: TOSS_FUNNEL_PROVIDER,
          result: "fail",
        });
        if (!cancelled) {
          setWebCatalog(null);
          setWebCatalogUnavailable(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [familyId, isWebBillingChannel, premiumActive]);

  useEffect(() => {
    if (billingRedirect.kind === "none" || billingRedirectScrubbedRef.current) return;
    billingRedirectScrubbedRef.current = true;
    try {
      window.history.replaceState(
        window.history.state,
        "",
        clearWebBillingRedirectQuery(window.location.href),
      );
    } catch {
      // 주소 정리가 실패해도 authKey를 로그·오류 메시지에 싣지 않는다.
    }
  }, [billingRedirect]);

  useEffect(() => {
    if (billingRedirectHandledRef.current || billingRedirect.kind === "none") return;
    const storage = webBillingStorage();
    if (billingRedirect.kind === "fail" || billingRedirect.kind === "invalid") {
      billingRedirectHandledRef.current = true;
      if (storage) clearPendingWebBilling(storage);
      setWebReconciliationPending(false);
      const code = billingRedirect.kind === "fail" ? billingRedirect.code : "UNKNOWN";
      const canceled = code === "PAY_PROCESS_CANCELED" || code === "PAY_PROCESS_ABORTED";
      recordPremiumFunnelEvent({
        event: "checkout_result",
        result: canceled ? "cancel" : "fail",
        provider: TOSS_FUNNEL_PROVIDER,
        error_code: canceled ? "purchase_canceled" : "unknown",
      });
      show(
        billingRedirect.kind === "fail"
          ? webBillingFailureMessage(billingRedirect.code)
          : "결제 인증 결과를 확인하지 못했어요. 다시 시도해 주세요.",
        "👑",
      );
      return;
    }
    if (!familyId) return;

    billingRedirectHandledRef.current = true;
    const pending = storage ? readPendingWebBilling(storage) : null;
    void (async () => {
      try {
        const recovered = pending?.customerKey === billingRedirect.customerKey
          ? { sessionId: pending.sessionId, customerKey: pending.customerKey }
          : validateRecoveredWebBillingCheckoutSession(
            await resolveWebBillingCheckoutSession({
              familyId,
              customerKey: billingRedirect.customerKey,
            }),
            billingRedirect.customerKey,
          );
        await finishWebBilling({
          familyId,
          sessionId: recovered.sessionId,
          authKey: billingRedirect.authKey,
          customerKey: recovered.customerKey,
          storage,
        });
      } catch {
        if (storage) clearPendingWebBilling(storage);
        setWebReconciliationPending(false);
        recordPremiumFunnelEvent({
          event: "checkout_result",
          result: "fail",
          provider: TOSS_FUNNEL_PROVIDER,
          error_code: "verification_failed",
        });
        show("결제 인증 세션을 확인하지 못했어요. 다시 시작해 주세요.", "👑");
      }
    })();
  }, [billingRedirect, familyId, finishWebBilling, show]);

  useEffect(() => {
    if (!isWebBillingChannel || !familyId) return;
    if (billingRedirect.kind !== "none" && webReconcileNonce === 0) return;
    const storage = webBillingStorage();
    const pending = storage ? readPendingWebBilling(storage) : null;
    if (!storage || !pending) {
      setWebReconciliationPending(false);
      return;
    }
    setWebReconciliationPending(true);
    webReconcileAttemptRef.current += 1;
    void finishWebBilling({
      familyId,
      sessionId: pending.sessionId,
      customerKey: pending.customerKey,
      authKey: "",
      storage,
    });
  }, [
    billingRedirect.kind,
    familyId,
    finishWebBilling,
    isWebBillingChannel,
    webReconcileNonce,
  ]);

  useEffect(() => {
    if (premiumActive || !familyId || !isBillingAvailable()) return;
    let cancelled = false;
    setPlayTrialEligible(null);
    setProductDetails(null);
    void fetchGooglePlayTrialEligibility(familyId)
      .then((eligible) => {
        if (!cancelled) setPlayTrialEligible(eligible);
      })
      .catch((error) => {
        console.warn("Google Play 무료 체험 가능 여부 조회 실패:", error);
        if (!cancelled) setPlayTrialEligible(null);
      });
    void fetchSubscriptionProductDetails()
      .then((details) => {
        recordPremiumFunnelEvent({
          event: "product_query_result",
          provider: GOOGLE_PLAY_FUNNEL_PROVIDER,
          result: details !== null ? "success" : "fail",
        });
        if (!cancelled) setProductDetails(details);
      })
      .catch((error) => {
        recordPremiumFunnelEvent({
          event: "product_query_result",
          provider: GOOGLE_PLAY_FUNNEL_PROVIDER,
          result: "fail",
        });
        // 상품 조회 실패 시 가격·체험을 추측하지 않는다. 결제창에서 실제 조건을 확인한다.
        console.warn("Google Play 구독 상품 조회 실패:", error);
        if (!cancelled) setProductDetails(null);
      });
    return () => {
      cancelled = true;
    };
  }, [familyId, premiumActive]);

  const annualOffer = selectSubscriptionOffer(productDetails, ANNUAL_BASE_PLAN_ID, {
    allowTrial: playTrialEligible === true,
  });
  const monthlyOffer = selectSubscriptionOffer(productDetails, MONTHLY_BASE_PLAN_ID, {
    allowTrial: playTrialEligible === true,
  });
  const selectedOffer = plan === "year" ? annualOffer : monthlyOffer;
  const annualDisplayPrice = isWebBillingChannel
    ? webCatalog?.plans.year.displayPrice
      ? formatProviderPrice(webCatalog.plans.year.displayPrice, locale)
      : "웹 결제 준비 중"
    : annualOffer?.displayPrice
      ? formatProviderPrice(annualOffer.displayPrice, locale)
      : "Google Play에서 확인";
  const monthlyDisplayPrice = isWebBillingChannel
    ? webCatalog?.plans.month.displayPrice
      ? formatProviderPrice(webCatalog.plans.month.displayPrice, locale)
      : "웹 결제 준비 중"
    : monthlyOffer?.displayPrice
      ? formatProviderPrice(monthlyOffer.displayPrice, locale)
      : "Google Play에서 확인";
  const selectedDisplayPrice = plan === "year" ? annualDisplayPrice : monthlyDisplayPrice;
  const selectedHasTrial = isWebBillingChannel
    ? webCatalog?.trialEligible === true && webCatalog.trialDays === 7
    : playTrialEligible === true && selectedOffer?.hasSevenDayTrial === true;
  const annualSavingsWon = isWebBillingChannel && webCatalog
    ? webBillingAnnualSavings(webCatalog)
    : hasExpectedLaunchSubscriptionPrice(monthlyOffer)
      && hasExpectedLaunchSubscriptionPrice(annualOffer)
      ? Math.max(
        0,
        Math.round(((monthlyOffer?.priceAmountMicros ?? 0) * 12 - (annualOffer?.priceAmountMicros ?? 0)) / 1_000_000),
      )
      : 0;

  useEffect(() => {
    if (!premiumActive || !returnIntent) return;
    const storage = browserPremiumReturnIntentStorage();
    if (storage) clearPremiumReturnIntent(storage);
    navigate(returnIntent.returnTo, {
      replace: true,
      state: {
        premiumReturnSource: returnIntent.source,
        premiumReturnFeature: returnIntent.feature,
        premiumReturnDraft: returnIntent.draft,
        premiumEntitlementConfirmed: true,
      },
    });
  }, [navigate, premiumActive, returnIntent]);

  // 결제 CTA — Android 네이티브는 Google Play, PWA는 Toss 자동결제 인증을 사용한다.
  // 두 경로 모두 사용자 버튼 onClick에서만 시작하고 서로의 결제창으로 우회하지 않는다.
  const purchase = async () => {
    if (!familyId) {
      show("가족 연결 후 다시 시도해 주세요", "👑");
      return;
    }
    if (busy) return;
    if (isWebBillingChannel && webReconciliationPending) {
      if (webReconcileTimerRef.current !== null) {
        window.clearTimeout(webReconcileTimerRef.current);
        webReconcileTimerRef.current = null;
      }
      setWebReconcileNonce((value) => value + 1);
      return;
    }
    webReconcileAttemptRef.current = 0;
    const provider = isWebBillingChannel ? TOSS_FUNNEL_PROVIDER : GOOGLE_PLAY_FUNNEL_PROVIDER;
    recordPremiumFunnelEvent({
      event: "checkout_start",
      plan,
      provider,
    });
    setBusy(true);
    let checkoutSucceeded = false;
    let pendingStorage: Storage | null = null;
    try {
      if (isWebBillingChannel) {
        if (!webCatalog) throw new Error("web_billing_not_configured");
        pendingStorage = webBillingStorage();
        if (!pendingStorage) throw new Error("web_billing_session_storage_unavailable");
        const trialExpected = webCatalog.trialEligible === true && webCatalog.trialDays === 7;
        const rawSession = await createWebBillingCheckoutSession({ familyId, plan, trialExpected });
        const session = validateWebBillingCheckoutSession(rawSession, plan, trialExpected);
        recordPremiumFunnelEvent({
          event: "product_query_result",
          provider: TOSS_FUNNEL_PROVIDER,
          result: "success",
        });
        savePendingWebBilling(pendingStorage, {
          sessionId: session.sessionId,
          customerKey: session.customerKey,
          expiresAt: session.expiresAt,
        });
        const redirects = buildWebBillingRedirectUrls(window.location.href);
        await startTossBillingAuthorization({
          clientKey: session.clientKey,
          customerKey: session.customerKey,
          ...redirects,
        });
        return;
      }

      if (!isBillingAvailable()) {
        throw new BillingError("billing_unavailable");
      }
      const basePlanId = plan === "year" ? ANNUAL_BASE_PLAN_ID : MONTHLY_BASE_PLAN_ID;
      let freshProductDetails: BillingProductDetails | null;
      try {
        freshProductDetails = await fetchSubscriptionProductDetails();
        recordPremiumFunnelEvent({
          event: "product_query_result",
          provider: GOOGLE_PLAY_FUNNEL_PROVIDER,
          result: freshProductDetails !== null ? "success" : "fail",
        });
      } catch (error) {
        recordPremiumFunnelEvent({
          event: "product_query_result",
          provider: GOOGLE_PLAY_FUNNEL_PROVIDER,
          result: "fail",
        });
        throw error;
      }
      const freshSelectedOffer = selectSubscriptionOffer(freshProductDetails, basePlanId, {
        allowTrial: playTrialEligible === true,
      });
      if (!freshSelectedOffer) {
        throw new Error("Google Play 구독 조건을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.");
      }
      if (!hasExpectedLaunchSubscriptionPrice(freshSelectedOffer)) {
        throw new Error("Google Play 출시 가격이 월 4,900원·연 39,000원과 일치하지 않아요.");
      }
      setProductDetails(freshProductDetails);
      const result = await launchSubscriptionPurchase({
        familyId,
        basePlanId,
        selectedOffer: freshSelectedOffer,
        productDetails: freshProductDetails,
      });
      checkoutSucceeded = true;
      recordPremiumFunnelEvent({
        event: "checkout_result",
        result: "success",
        provider: GOOGLE_PLAY_FUNNEL_PROVIDER,
        error_code: null,
      });
      // 구독 성공 → 엔타이틀먼트 캐시 무효화로 활성 배너를 갱신한다.
      await qc.invalidateQueries({ queryKey: qk.entitlement(familyId) });
      show(result.isTrial ? "7일 무료 체험을 시작했어요" : "프리미엄 구독을 시작했어요", "👑");
    } catch (error) {
      if (!checkoutSucceeded) {
        if (pendingStorage) clearPendingWebBilling(pendingStorage);
        const failure = classifyPremiumCheckoutFailure(error);
        recordPremiumFunnelEvent({
          event: "checkout_result",
          result: failure.result,
          provider,
          error_code: failure.error_code,
        });
      }
      show(
        isWebBillingChannel
          ? webBillingRequestFailureMessage(error)
          : localizeApiError(error, intl, "formal"),
        "👑",
      );
    } finally {
      setBusy(false);
    }
  };
  const manage = async () => {
    if (view?.provider === "toss_web") {
      recordPremiumFunnelEvent({
        event: "subscription_cancel_requested",
        provider: TOSS_FUNNEL_PROVIDER,
      });
      setCancelConfirmOpen(true);
      return;
    }
    recordPremiumFunnelEvent({
      event: "subscription_cancel_requested",
      provider: GOOGLE_PLAY_FUNNEL_PROVIDER,
    });
    try {
      const url =
        `https://play.google.com/store/account/subscriptions?sku=${encodeURIComponent(SUBSCRIPTION_PRODUCT_ID)}` +
        `&package=${encodeURIComponent(GOOGLE_PLAY_PACKAGE_NAME)}`;
      await openExternal(url);
    } catch (error) {
      console.error("구독 관리 열기 실패:", error);
      show("구독 관리 화면을 열지 못했어요", "⚠️");
    }
  };

  const confirmWebCancellation = async () => {
    if (!familyId || busy) return;
    setBusy(true);
    try {
      await cancelWebBillingSubscription({ familyId });
      await qc.invalidateQueries({ queryKey: qk.entitlement(familyId) });
      setCancelConfirmOpen(false);
      show("현재 이용 기간이 끝날 때 구독이 해지되도록 예약했어요", "👑");
    } catch (error) {
      show(webBillingRequestFailureMessage(error), "👑");
    } finally {
      setBusy(false);
    }
  };

  // ready && isPremium 일 때만 활성 배너 노출. 조회 실패/미확정(ready=false)에서는
  // 무료로 강등하지 않고 기본 페이월(중립)만 보여준다(R9).
  const purchaseLabel = webReconciliationPending
    ? "결제 결과 다시 확인"
    : selectedHasTrial
      ? "결제 정보 등록하고 7일 무료 체험"
      : `${selectedDisplayPrice} · 시작하기`;

  // 활성 배너 보조 문구(체험 남은 일수 → 결제 주기 종료 → 기본).
  const activeSub = (() => {
    if (!view) return "";
    if (view.isTrial && view.trialDaysLeft != null) {
      return `무료 체험 종료 · ${formatRelativeTime(view.trialDaysLeft, "day", locale)}`;
    }
    if (view.periodEnd) return `${formatPeriodEnd(view.periodEnd, locale)}까지 이용 가능해요`;
    return "프리미엄 혜택을 모두 이용 중이에요";
  })();

  if (subscriptionQueryState === "loading") {
    return (
      <ScreenQueryState
        screenTitle="프리미엄 구독"
        state="loading"
        heading="구독 상태를 확인하고 있어요"
        description="현재 이용 중인 혜택과 결제 가능 상태를 안전하게 확인하는 중이에요."
        onBack={() => navigate(-1)}
      />
    );
  }

  if (subscriptionQueryState === "error") {
    return (
      <ScreenQueryState
        screenTitle="프리미엄 구독"
        state="error"
        heading="구독 상태를 확인하지 못했어요"
        description="확인되지 않은 상태에서 결제를 진행하지 않도록 잠시 닫았어요."
        onBack={() => navigate(-1)}
        onRetry={() => void retrySubscription()}
        retrying={entitlementQuery.isFetching}
      />
    );
  }

  if (subscriptionDataEmpty) {
    return (
      <ScreenQueryState
        screenTitle="프리미엄 구독"
        state="empty"
        heading="구독 정보가 아직 준비되지 않았어요"
        description="잠시 후 다시 확인해 주세요. 확인 전에는 결제가 시작되지 않아요."
        onBack={() => navigate(-1)}
        onRetry={() => void retrySubscription()}
        retrying={entitlementQuery.isFetching}
        retryLabel="구독 상태 다시 확인"
      />
    );
  }

  return (
    <div className="sub-screen">
      <div className="sub-header">
        <button
          type="button"
          className="hy-iconbtn hy-press sub-back"
          aria-label="뒤로"
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} strokeWidth={2.2} />
        </button>
        <span className="sub-header__title">프리미엄 구독</span>
      </div>

      <div className="sub-body">
        {/* 히어로 */}
        <div className="sub-hero">
          <img className="sub-hero__crown" src={asset("ui/crown.webp")} alt="" />
          <div className="sub-hero__title">혜니 프리미엄</div>
          <div className="sub-hero__sub">
            실시간 위치와 AI 요약으로
            <br />
            아이의 하루를 더 안심하게 확인하세요
          </div>
        </div>

        {/* 프리미엄 활성 배너 (실 티어) */}
        {premiumActive && view && (
          <div className="sub-active">
            <div className="sub-active__badge">
              <img src={asset("ui/crown.webp")} alt="" />
            </div>
            <div className="sub-active__text">
              <div className="sub-active__title">{view.planLabel} 이용 중</div>
              <div className="sub-active__sub">{activeSub}</div>
            </div>
            <Check className="sub-active__check" size={22} strokeWidth={3} />
          </div>
        )}

        {/* 플랜 선택 (미구독 시에만) */}
        {!premiumActive && (
          <div className="sub-plans" role="radiogroup" aria-label="프리미엄 결제 주기">
            <button
              ref={(element) => { planRefs.current.year = element; }}
              type="button"
              role="radio"
              aria-checked={plan === "year"}
              tabIndex={plan === "year" ? 0 : -1}
              className="sub-plan hy-press"
              data-selected={plan === "year"}
              onClick={() => setPlan("year")}
              onKeyDown={(event) => onPlanKeyDown(event, "year")}
            >
              <span className="sub-plan__ribbon">
                {annualSavingsWon > 0 ? `연 ${formatNumber(annualSavingsWon, locale)}원 절약` : "연간 플랜"}
              </span>
              <div className="sub-plan__info">
                <div className="sub-plan__name">프리미엄 연간 구독</div>
                <div className="sub-plan__meta">
                  월 환산 3,250원 · {isWebBillingChannel
                    ? webCatalog?.trialEligible === true && webCatalog.trialDays === 7
                      ? "7일 무료 체험 후 웹 자동결제"
                      : "웹 자동결제 · 언제든 해지 예약 가능"
                    : annualOffer?.hasSevenDayTrial ? "7일 무료 체험 후 자동 갱신" : "Google Play 구독 · 언제든 해지 가능"}
                </div>
              </div>
              <div className="sub-plan__price">{annualDisplayPrice}</div>
            </button>

            <button
              ref={(element) => { planRefs.current.month = element; }}
              type="button"
              role="radio"
              aria-checked={plan === "month"}
              tabIndex={plan === "month" ? 0 : -1}
              className="sub-plan hy-press"
              data-selected={plan === "month"}
              onClick={() => setPlan("month")}
              onKeyDown={(event) => onPlanKeyDown(event, "month")}
            >
              <div className="sub-plan__info">
                <div className="sub-plan__name">프리미엄 월간 구독</div>
                <div className="sub-plan__meta">
                  {isWebBillingChannel
                    ? webCatalog?.trialEligible === true && webCatalog.trialDays === 7
                      ? "7일 무료 체험 후 웹 자동결제"
                      : "웹 자동결제 · 언제든 해지 예약 가능"
                    : monthlyOffer?.hasSevenDayTrial ? "7일 무료 체험 후 자동 갱신" : "Google Play 구독 · 언제든 해지 가능"}
                </div>
              </div>
              <div className="sub-plan__price">{monthlyDisplayPrice}</div>
            </button>
          </div>
        )}

        {!premiumActive && isWebBillingChannel && (
          <div className="sub-note hy-explain">
            <span className="hy-explain__lines">
              <span className="hy-explain__line">웹 자동결제는 국내 발급 카드만 지원해요.</span>
              {selectedHasTrial && (
                <span className="hy-explain__line">결제 정보를 등록해도 지금은 청구하지 않고, 정확히 7일 후 선택한 주기로 첫 결제돼요.</span>
              )}
              <span className="hy-explain__line">선택한 주기마다 자동 갱신되며 이 화면에서 언제든 해지 예약할 수 있어요.</span>
            </span>
          </div>
        )}

        {!premiumActive && selectedHasTrial && (
          <div className="sub-note hy-explain">
            <span className="hy-explain__lines">
              {isWebBillingChannel ? (
                <>
                  <span className="hy-explain__line">이 가족이 처음 받는 7일 무료 체험이에요.</span>
                  <span className="hy-explain__line">체험 종료 전 해지하면 첫 결제는 발생하지 않아요.</span>
                </>
              ) : (
                <>
                  <span className="hy-explain__line">Google Play 결제 정보 등록 후 7일 동안 무료로 이용할 수 있어요.</span>
                  <span className="hy-explain__line">7일 무료 체험 종료 후 Google Play에 표시된 구독 금액으로 자동 갱신돼요.</span>
                  <span className="hy-explain__line">원하지 않으면 Google Play에서 체험 종료 전에 취소해 주세요.</span>
                </>
              )}
            </span>
          </div>
        )}

        {/* 혜택 */}
        <div className="sub-benefits">
          {BENEFITS.map((b) => (
            <div key={b.t} className="sub-benefit">
              <div className="sub-benefit__icon">
                <img src={asset(b.icon)} alt="" />
              </div>
              <div className="sub-benefit__text">
                <div className="sub-benefit__t">{b.t}</div>
                <div className="sub-benefit__s">{b.s}</div>
              </div>
              <Check className="sub-benefit__check" size={20} strokeWidth={3} />
            </div>
          ))}
        </div>

        {/* 플랜 비교표 (S-02) — 현재 티어 열 하이라이트 */}
        <div className="sub-compare">
          <div className="sub-compare__title">플랜 비교</div>
          <div className="sub-compare__scroll">
            <table className="sub-table">
              <thead>
                <tr>
                  <th scope="col" className="sub-table__rowhead sub-table__corner">
                    구분
                  </th>
                  {COMPARE_COLS.map((t) => (
                    <th
                      key={t}
                      scope="col"
                      className="sub-table__col"
                      data-current={t === comparisonTier}
                    >
                      <span className="sub-table__col-name">{getTierLabel(t)}</span>
                      {t === TIERS.PREMIUM && (
                        <span className="sub-table__col-price">{monthlyDisplayPrice}</span>
                      )}
                      {t === comparisonTier && <span className="sub-table__col-badge">현재</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARE_ROWS.map((row) => (
                  <tr key={row.label}>
                    <th scope="row" className="sub-table__rowhead">
                      {row.label}
                    </th>
                    {COMPARE_COLS.map((t) => (
                      <td
                        key={t}
                        className="sub-table__cell"
                        data-current={t === comparisonTier}
                        data-safe={row.safe ? "true" : undefined}
                      >
                        {t === TIERS.FREE && tier === TIERS.REVIEWED && row.reviewedCell
                          ? row.reviewedCell
                          : row.cell(t)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="sub-note hy-explain" role="note">
          <span className="hy-explain__lines">
            <span className="hy-explain__line">{EXISTING_CHILD_DOWNGRADE_NOTICE}</span>
            <span className="hy-explain__line">{DOWNGRADE_LIMIT_NOTICE}</span>
          </span>
        </div>

        {tier === TIERS.REVIEWED && (
          <div className="sub-note hy-explain" role="note">
            <span className="hy-explain__lines">
              <span className="hy-explain__line">현재 상품은 무료 플랜으로 표시돼요.</span>
              <span className="hy-explain__line">기존 혜택으로 저장 장소 3곳 한도는 계속 유지돼요.</span>
            </span>
          </div>
        )}

        {/* 안내 (미구독 시에만) */}
        {!premiumActive && (
          <div className="sub-note hy-explain">
            <span className="hy-explain__lines">
              <span className="hy-explain__line">SOS와 긴급 안전 알림은 무료로 계속 제공돼요.</span>
              <span className="hy-explain__line">프리미엄은 실시간 위치와 AI 요약처럼 더 자세한 안심 기능을 열어드려요.</span>
              <span className="hy-explain__line">
                위급 주변소리는 아이가 누르지 않아도 연결되지만, 아이 화면과 알림에 계속 표시되고 1분 뒤 자동 종료되며 청취 기록이 남아요.
              </span>
              <span className="hy-explain__line">
                실제 가격과 결제 조건은 {isWebBillingChannel ? "웹 결제" : "Google Play"} 확인 화면 기준입니다.
              </span>
            </span>
          </div>
        )}

        {!premiumActive && isWebBillingChannel && webCatalogUnavailable && (
          <div className="sub-web-unavailable" role="status">
            웹 결제 설정을 확인하지 못해 결제 시작을 잠시 닫았어요. 무료 기능은 그대로 이용할 수 있어요.
          </div>
        )}

        {/* CTA — provider별 관리 또는 결제 시작. Android 안에서 웹 결제를 열지 않는다. */}
        {premiumActive ? (
          <button
            type="button"
            className="sub-cta hy-press"
            onClick={() => void manage()}
            disabled={busy || webCancellationScheduled}
            aria-busy={busy}
          >
            <img src={asset("ui/crown.webp")} alt="" />
            {webCancellationScheduled ? "구독 해지 예약됨" : "구독 관리"}
          </button>
        ) : (
          <button
            type="button"
            className="sub-cta hy-press"
            onClick={purchase}
            disabled={busy || (isWebBillingChannel && !webCatalog && !webReconciliationPending)} aria-busy={busy}
          >
            <img src={asset("ui/crown.webp")} alt="" />
            {busy ? "결제 진행 중…" : purchaseLabel}
          </button>
        )}

        {premiumActive && view?.provider === "toss_web" && cancelConfirmOpen && (
          <section className="sub-cancel" aria-labelledby="sub-cancel-title">
            <h2 id="sub-cancel-title">웹 구독을 해지할까요?</h2>
            <p>
              {view.periodEnd
                ? `${formatPeriodEnd(view.periodEnd, locale)}까지 프리미엄을 이용하고, 이후 자동결제를 중단해요.`
                : "현재 결제 기간이 끝날 때 프리미엄 자동결제를 중단해요."}
            </p>
            <p>
              {EXISTING_CHILD_DOWNGRADE_NOTICE} {DOWNGRADE_LIMIT_NOTICE}
            </p>
            <div className="sub-cancel__actions">
              <button
                type="button"
                className="hy-press"
                onClick={() => setCancelConfirmOpen(false)}
                disabled={busy}
                aria-busy={busy}
              >
                계속 이용
              </button>
              <button
                type="button"
                className="hy-press"
                onClick={() => void confirmWebCancellation()}
                disabled={busy}
                aria-busy={busy}
              >
                {busy ? "해지 예약 중…" : "구독 해지 예약"}
              </button>
            </div>
          </section>
        )}

        <div className="sub-fine">
          {premiumActive ? (
            <>
              {view?.isTrial
                ? view.provider === "toss_web"
                  ? "무료 체험은 종료 전 이 화면에서 해지하지 않으면 선택한 웹 구독 금액으로 첫 결제돼요."
                  : "무료 체험은 종료 전 Google Play에서 취소하지 않으면 Google Play에 표시된 구독 금액으로 자동 갱신돼요."
                : view?.status === "cancelled"
                  ? `${view.periodEnd ? formatPeriodEnd(view.periodEnd, locale) : "현재 이용 기간"}까지 프리미엄 혜택이 유지돼요.`
                  : view?.provider === "toss_web"
                    ? "웹 구독은 이 화면에서 언제든 해지 예약할 수 있어요."
                    : "구독은 설정 > 구독 관리에서 언제든 해지할 수 있어요."}
            </>
          ) : (
            <>
              구독은 선택한 기간마다 자동 갱신되며,
              <br />
              설정 &gt; 구독 관리에서 언제든 해지할 수 있어요.
            </>
          )}
        </div>
      </div>
    </div>
  );
}

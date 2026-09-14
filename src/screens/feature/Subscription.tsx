import { useFamilyTimeZone } from "@/region/FamilyTimeZone";
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
  resolveWebBillingCheckoutSession,
} from "@/lib/api/endpoints/webBilling";
import { useIntl, type IntlShape } from "react-intl";
import { BillingError } from "@/lib/native/billingError";
import { resolveNativeBillingFailureMessage } from "@/transform/billingFailureMessage";
import { isApiError } from "@/lib/api/errors";
import {
  clearPendingWebBilling,
  clearWebBillingRedirectQuery,
  parseWebBillingRedirect,
  readPendingWebBilling,
  resolveSubscriptionPurchasePolicy,
  savePendingWebBilling,
  validateRecoveredWebBillingCheckoutSession,
  webBillingFailureMessage,
  webBillingRequestFailureMessage,
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
  formatProviderPrice,
  formatRelativeTime,
} from "@/i18n/format";
import "./Subscription.css";

const BENEFITS = [
  { icon: "ui/pin-heart.webp", id: "location" },
  { icon: "ui/menu-child-tracker.webp", id: "children" },
  { icon: "ui/ai-robot.webp", id: "ai" },
  { icon: "ui/menu-remote-audio.webp", id: "remoteAudio" },
  { icon: "ui/shield-heart.webp", id: "places" },
] as const;

// ── 플랜 비교표(S-02) — 티어별 값은 tierPolicy, 준비물 저장 상한은 eventSupplies에서 파생 ──
const COMPARE_COLS: readonly Tier[] = [TIERS.FREE, TIERS.PREMIUM];
const YES = "✓";
const NO = "—";
const BILLING_DATE_STYLE = "medium" as const;

function limitLabel(n: number, intl: IntlShape): string {
  return n === Infinity
    ? intl.formatMessage({ id: "billing.subscription.compare.unlimited" })
    : intl.formatMessage({ id: "billing.subscription.compare.itemCount" }, { count: n });
}
function locationLabel(t: Tier, intl: IntlShape): string {
  const mode = locationModeFor(t);
  if (mode === "realtime") return intl.formatMessage({ id: "billing.subscription.compare.locationRealtime" });
  if (mode === "standard") return intl.formatMessage({ id: "billing.subscription.compare.locationStandard" });
  return intl.formatMessage({ id: "billing.subscription.compare.locationLocked" });
}

function dailyLimitLabel(n: number, intl: IntlShape): string {
  return n === Infinity
    ? intl.formatMessage({ id: "billing.subscription.compare.noLimit" })
    : intl.formatMessage({ id: "billing.subscription.compare.dailyLimit" }, { count: n });
}

function rolling24LimitLabel(n: number, intl: IntlShape): string {
  return n === Infinity
    ? intl.formatMessage({ id: "billing.subscription.compare.rollingNoLimit" })
    : intl.formatMessage({ id: "billing.subscription.compare.rollingLimit" }, { count: n });
}

interface CompareRow {
  label: string;
  cell: (t: Tier) => string;
  /** 과거 스토어 방문 혜택 가족이 Free 열에서 실제로 보는 보존 값. */
  reviewedCell?: string;
  /** 안전 기능(티어 무관 항상 제공) — 초록 강조. */
  safe?: boolean;
}
function compareRows(intl: IntlShape): readonly CompareRow[] {
  const message = (id: string) => intl.formatMessage({ id });
  return [
    { label: message("billing.subscription.compare.childLimit"), cell: (t) => intl.formatMessage({ id: "billing.subscription.compare.children" }, { count: maxChildrenFor(t) }) },
    { label: message("billing.subscription.compare.memoSticker"), cell: () => message("billing.subscription.compare.unlimited") },
    { label: message("billing.subscription.compare.supplies"), cell: () => intl.formatMessage({ id: "billing.subscription.compare.suppliesLimit" }, { count: MAX_SUPPLY_ITEMS_PER_KIND }) },
    { label: message("billing.subscription.compare.location"), cell: (t) => locationLabel(t, intl) },
    { label: message("billing.subscription.compare.manualLocation"), cell: (t) => rolling24LimitLabel(manualLocationRequestDailyLimitFor(t), intl) },
    { label: message("billing.subscription.compare.history"), cell: (t) => (historyDaysFor(t) === 1 ? message("billing.subscription.compare.currentSafetyDay") : intl.formatMessage({ id: "billing.subscription.compare.recentDays" }, { count: historyDaysFor(t) })) },
    { label: message("billing.subscription.compare.places"), cell: (t) => limitLabel(placeLimitFor(t), intl), reviewedCell: intl.formatMessage({ id: "billing.subscription.compare.reviewedPlaces" }, { count: 3 }) },
    { label: message("billing.subscription.compare.dangerZone"), cell: (t) => limitLabel(dangerZoneLimitFor(t), intl) },
    { label: message("billing.subscription.compare.ring"), cell: (t) => rolling24LimitLabel(forceRingDailyLimitFor(t), intl) },
    { label: message("billing.subscription.compare.aiFriend"), cell: (t) => dailyLimitLabel(aiFriendDailyBaseFor(t), intl) },
    { label: message("billing.subscription.compare.aiSchedule"), cell: (t) => dailyLimitLabel(aiScheduleDailyLimitFor(t), intl) },
    { label: message("billing.subscription.compare.safetyReport"), cell: () => message("billing.subscription.compare.provided") },
    { label: message("billing.subscription.compare.remoteAudio"), cell: (t) => (canUse(t, FEATURES.REMOTE_AUDIO) ? message("billing.subscription.compare.maxMinute") : NO) },
    { label: message("billing.subscription.compare.safetyInsights"), cell: (t) => (canUse(t, FEATURES.SAFETY_INSIGHTS) ? message("billing.subscription.compare.autoAlert") : message("billing.subscription.compare.manualCheck")) },
    { label: message("billing.subscription.compare.aiDailySummary"), cell: (t) => (canUse(t, FEATURES.AI_ANALYSIS) ? YES : NO) },
    { label: message("billing.subscription.compare.weeklyReport"), cell: (t) => (canUse(t, FEATURES.WEEKLY_REPORT) ? message("billing.subscription.compare.weeklyFull") : message("billing.subscription.compare.weeklyPreview")) },
    { label: message("billing.subscription.compare.academySchedule"), cell: (t) => (canUse(t, FEATURES.ACADEMY_SCHEDULE) ? YES : NO) },
    { label: message("billing.subscription.compare.sos"), cell: () => YES, safe: true },
  ];
}

type Plan = WebBillingPlan;
const GOOGLE_PLAY_FUNNEL_PROVIDER = "google_play" as const;
const TOSS_FUNNEL_PROVIDER = "toss_payments" as const;

/** 결제 주기 종료일 → "2026년 7월 4일" 형식. */
function formatPeriodEnd(d: Date, locale: SupportedLocale, familyTimeZone: string): string {
  return formatDateTime(d, {
    locale,
    timeZone: familyTimeZone,
    dateStyle: BILLING_DATE_STYLE,
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
  const familyTimeZone = useFamilyTimeZone();
  const intl = useIntl();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const { show } = useToast();
  const { familyId } = useAuth();
  const qc = useQueryClient();
  const platform = getPlatform();
  const isWebBillingChannel = platform === "web";
  const [plan, setPlan] = useState<Plan>("year");
  const planRefs = useRef<Record<Plan, HTMLButtonElement | null>>({ year: null, month: null });
  const [busy, setBusy] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
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
  const localizedCompareRows = compareRows(intl);
  const existingChildDowngradeNotice = intl.formatMessage({
    id: "billing.subscription.downgrade.existingChild",
  });
  const downgradeLimitNotice = intl.formatMessage({
    id: "billing.subscription.downgrade.limit",
  });
  const subscriptionQueryState = resolveQueryTruthState([
    { isLoading: entitlementQuery.isLoading, isError: entitlementQuery.isError },
  ]);
  const subscriptionDataEmpty = subscriptionQueryState === "ready" && (!ready || !view);
  const retrySubscription = async (): Promise<void> => {
    await entitlementQuery.refetch();
  };
  const premiumActive = ready && isPremium;
  const purchasePolicy = resolveSubscriptionPurchasePolicy(platform, premiumActive);
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
          ? intl.formatMessage({ id: "billing.subscription.purchase.trialStarted" })
          : intl.formatMessage({ id: "billing.subscription.purchase.started" }),
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
          show(intl.formatMessage({ id: "billing.subscription.purchase.reconciling" }), "👑");
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
      show(webBillingRequestFailureMessage(error, intl), "👑");
    } finally {
      webCompletionInFlightRef.current = false;
      setBusy(false);
    }
  }, [intl, qc, scheduleWebReconciliation, show]);

  useEffect(() => {
    if (subscriptionViewRecordedRef.current) return;
    subscriptionViewRecordedRef.current = true;
    recordPremiumFunnelEvent({
      event: "subscription_view",
      source: subscriptionSource,
    });
  }, [subscriptionSource]);

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
          ? webBillingFailureMessage(billingRedirect.code, intl)
          : intl.formatMessage({ id: "billing.subscription.purchase.redirectInvalid" }),
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
        show(intl.formatMessage({ id: "billing.subscription.purchase.sessionInvalid" }), "👑");
      }
    })();
  }, [billingRedirect, familyId, finishWebBilling, intl, show]);

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
  }, [billingRedirect.kind,
    familyId,
    finishWebBilling,
    isWebBillingChannel,
    webReconcileNonce,
  ]);

  useEffect(() => {
    if (premiumActive || !purchasePolicy.canPurchase || !familyId || !isBillingAvailable()) return;
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
  }, [familyId, premiumActive, purchasePolicy.canPurchase]);

  const annualOffer = selectSubscriptionOffer(productDetails, ANNUAL_BASE_PLAN_ID, {
    allowTrial: playTrialEligible === true,
  });
  const monthlyOffer = selectSubscriptionOffer(productDetails, MONTHLY_BASE_PLAN_ID, {
    allowTrial: playTrialEligible === true,
  });
  const selectedOffer = plan === "year" ? annualOffer : monthlyOffer;
  const localizeDisplayPrice = (displayPrice: string): string => {
    const providerPrice = formatProviderPrice(displayPrice, locale);
    return intl.formatMessage(
      { id: "billing.subscription.providerPrice" },
      { formattedPrice: providerPrice },
    );
  };
  const annualDisplayPrice = annualOffer?.displayPrice
    ? localizeDisplayPrice(annualOffer.displayPrice)
    : intl.formatMessage({ id: "billing.subscription.google.pending" });
  const monthlyDisplayPrice = monthlyOffer?.displayPrice
    ? localizeDisplayPrice(monthlyOffer.displayPrice)
    : intl.formatMessage({ id: "billing.subscription.google.pending" });
  const selectedDisplayPrice = plan === "year" ? annualDisplayPrice : monthlyDisplayPrice;
  const selectedHasTrial = playTrialEligible === true && selectedOffer?.hasSevenDayTrial === true;

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

  // 신규 결제 CTA는 Android 네이티브 Google Play에서만 연다.
  const purchase = async () => {
    if (!purchasePolicy.canPurchase) {
      show(intl.formatMessage({ id: "billing.subscription.web.androidOnlyFree" }), "👑");
      return;
    }
    if (!familyId) {
      show(intl.formatMessage({ id: "billing.subscription.purchase.familyRequired" }), "👑");
      return;
    }
    if (busy) return;
    webReconcileAttemptRef.current = 0;
    const provider = GOOGLE_PLAY_FUNNEL_PROVIDER;
    recordPremiumFunnelEvent({
      event: "checkout_start",
      plan,
      provider,
    });
    setBusy(true);
    let checkoutSucceeded = false;
    try {
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
        throw new BillingError("product_unavailable");
      }
      if (!hasExpectedLaunchSubscriptionPrice(freshSelectedOffer)) {
        throw new BillingError("product_unavailable");
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
      show(
        result.isTrial
          ? intl.formatMessage({ id: "billing.subscription.purchase.trialStarted" })
          : intl.formatMessage({ id: "billing.subscription.purchase.started" }),
        "👑",
      );
    } catch (error) {
      if (!checkoutSucceeded) {
        const failure = classifyPremiumCheckoutFailure(error);
        recordPremiumFunnelEvent({
          event: "checkout_result",
          result: failure.result,
          provider,
          error_code: failure.error_code,
        });
      }
      show(resolveNativeBillingFailureMessage(error, intl), "👑");
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
      show(intl.formatMessage({ id: "billing.subscription.purchase.manageFailed" }), "⚠️");
    }
  };

  const confirmWebCancellation = async () => {
    if (!familyId || busy) return;
    setBusy(true);
    try {
      await cancelWebBillingSubscription({ familyId });
      await qc.invalidateQueries({ queryKey: qk.entitlement(familyId) });
      setCancelConfirmOpen(false);
      show(intl.formatMessage({ id: "billing.subscription.purchase.cancelScheduled" }), "👑");
    } catch (error) {
      show(webBillingRequestFailureMessage(error, intl), "👑");
    } finally {
      setBusy(false);
    }
  };

  // ready && isPremium 일 때만 활성 배너 노출. 조회 실패/미확정(ready=false)에서는
  // 무료로 강등하지 않고 기본 페이월(중립)만 보여준다(R9).
  const purchaseLabel = webReconciliationPending
    ? intl.formatMessage({ id: "billing.subscription.cta.reconcile" })
    : selectedHasTrial
      ? intl.formatMessage({ id: "billing.subscription.cta.trial" })
      : intl.formatMessage(
          { id: "billing.subscription.cta.start" },
          { price: selectedDisplayPrice },
        );

  // 활성 배너 보조 문구(체험 남은 일수 → 결제 주기 종료 → 기본).
  const activeSub = (() => {
    if (!view) return "";
    if (view.isTrial && view.trialDaysLeft != null) {
      return intl.formatMessage(
        { id: "billing.subscription.trial.remaining" },
        { remaining: formatRelativeTime(view.trialDaysLeft, "day", locale) },
      );
    }
    if (view.periodEnd) {
      return intl.formatMessage(
        { id: "billing.subscription.activeUntil" },
        { date: formatPeriodEnd(view.periodEnd, locale, familyTimeZone) },
      );
    }
    return intl.formatMessage({ id: "billing.subscription.activeDefault" });
  })();

  if (subscriptionQueryState === "loading") {
    return (
      <ScreenQueryState
        screenTitle={intl.formatMessage({ id: "billing.subscription.title" })}
        state="loading"
        heading={intl.formatMessage({ id: "billing.subscription.state.loadingTitle" })}
        description={intl.formatMessage({ id: "billing.subscription.state.loadingDescription" })}
        onBack={() => navigate(-1)}
      />
    );
  }

  if (subscriptionQueryState === "error") {
    return (
      <ScreenQueryState
        screenTitle={intl.formatMessage({ id: "billing.subscription.title" })}
        state="error"
        heading={intl.formatMessage({ id: "billing.subscription.state.errorTitle" })}
        description={intl.formatMessage({ id: "billing.subscription.state.errorDescription" })}
        onBack={() => navigate(-1)}
        onRetry={() => void retrySubscription()}
        retrying={entitlementQuery.isFetching}
      />
    );
  }

  if (subscriptionDataEmpty) {
    return (
      <ScreenQueryState
        screenTitle={intl.formatMessage({ id: "billing.subscription.title" })}
        state="empty"
        heading={intl.formatMessage({ id: "billing.subscription.state.emptyTitle" })}
        description={intl.formatMessage({ id: "billing.subscription.state.emptyDescription" })}
        onBack={() => navigate(-1)}
        onRetry={() => void retrySubscription()}
        retrying={entitlementQuery.isFetching}
        retryLabel={intl.formatMessage({ id: "billing.subscription.state.retry" })}
      />
    );
  }

  return (
    <div className="sub-screen">
      <div className="sub-header">
        <button
          type="button"
          className="hy-iconbtn hy-press sub-back"
          aria-label={intl.formatMessage({ id: "billing.common.back" })}
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} strokeWidth={2.2} />
        </button>
        <span className="sub-header__title">{intl.formatMessage({ id: "billing.subscription.title" })}</span>
      </div>

      <div className="sub-body">
        {/* 히어로 */}
        <div className="sub-hero">
          <img className="sub-hero__crown" src={asset("ui/crown.webp")} alt="" />
          <div className="sub-hero__title">{intl.formatMessage({ id: "billing.subscription.hero.title" })}</div>
          <div className="sub-hero__sub">
            {intl.formatMessage({ id: "billing.subscription.hero.description" })}
          </div>
        </div>

        {/* 프리미엄 활성 배너 (실 티어) */}
        {premiumActive && view && (
          <div className="sub-active">
            <div className="sub-active__badge">
              <img src={asset("ui/crown.webp")} alt="" />
            </div>
            <div className="sub-active__text">
              <div className="sub-active__title">
                {intl.formatMessage(
                  { id: "billing.subscription.activePlan" },
                  { plan: getTierLabel(tier, intl) },
                )}
              </div>
              <div className="sub-active__sub">{activeSub}</div>
            </div>
            <Check className="sub-active__check" size={22} strokeWidth={3} />
          </div>
        )}

        {/* 플랜 선택과 신규 결제는 Android Google Play에서만 제공한다. */}
        {!premiumActive && purchasePolicy.canPurchase && (
          <div
            className="sub-plans"
            role="radiogroup"
            aria-label={intl.formatMessage({ id: "billing.subscription.plan.groupAria" })}
          >
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
                {intl.formatMessage({ id: "billing.subscription.plan.annualRibbon" })}
              </span>
              <div className="sub-plan__info">
                <div className="sub-plan__name">
                  {intl.formatMessage({ id: "billing.subscription.plan.annual" })}
                </div>
                <div className="sub-plan__meta">
                  {annualOffer?.hasSevenDayTrial
                    ? intl.formatMessage(
                        { id: "billing.subscription.eligibleTrial" },
                        { trialDays: 7 },
                      )
                    : intl.formatMessage({ id: "billing.subscription.plan.googleManage" })}
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
                <div className="sub-plan__name">
                  {intl.formatMessage({ id: "billing.subscription.plan.monthly" })}
                </div>
                <div className="sub-plan__meta">
                  {monthlyOffer?.hasSevenDayTrial
                    ? intl.formatMessage(
                        { id: "billing.subscription.eligibleTrial" },
                        { trialDays: 7 },
                      )
                    : intl.formatMessage({ id: "billing.subscription.plan.googleManage" })}
                </div>
              </div>
              <div className="sub-plan__price">{monthlyDisplayPrice}</div>
            </button>
          </div>
        )}

        {!purchasePolicy.canPurchase && (
          <div className="sub-note hy-explain" role="note">
            <span className="hy-explain__lines">
              <span className="hy-explain__line">
                {intl.formatMessage({
                  id: premiumActive
                    ? "billing.subscription.web.androidOnlyPremium"
                    : "billing.subscription.web.androidOnlyFree",
                })}
              </span>
            </span>
          </div>
        )}

        {!premiumActive && purchasePolicy.canPurchase && selectedHasTrial && (
          <div className="sub-note hy-explain">
            <span className="hy-explain__lines">
              <span className="hy-explain__line">
                {intl.formatMessage({ id: "billing.subscription.trial.googleFree" })}
              </span>
              <span className="hy-explain__line">
                {intl.formatMessage({ id: "billing.subscription.trial.googleRenewal" })}
              </span>
              <span className="hy-explain__line">
                {intl.formatMessage({ id: "billing.subscription.trial.googleCancel" })}
              </span>
            </span>
          </div>
        )}

        {/* 혜택 */}
        <div className="sub-benefits">
          {BENEFITS.map((b) => (
            <div key={b.id} className="sub-benefit">
              <div className="sub-benefit__icon">
                <img src={asset(b.icon)} alt="" />
              </div>
              <div className="sub-benefit__text">
                <div className="sub-benefit__t">
                  {intl.formatMessage({ id: `billing.subscription.benefit.${b.id}.title` })}
                </div>
                <div className="sub-benefit__s">
                  {intl.formatMessage({ id: `billing.subscription.benefit.${b.id}.description` })}
                </div>
              </div>
              <Check className="sub-benefit__check" size={20} strokeWidth={3} />
            </div>
          ))}
        </div>

        {/* 플랜 비교표 (S-02) — 현재 티어 열 하이라이트 */}
        <div className="sub-compare">
          <div className="sub-compare__title">
            {intl.formatMessage({ id: "billing.subscription.compare.title" })}
          </div>
          <div className="sub-compare__scroll">
            <table className="sub-table">
              <thead>
                <tr>
                  <th scope="col" className="sub-table__rowhead sub-table__corner">
                    {intl.formatMessage({ id: "billing.subscription.compare.category" })}
                  </th>
                  {COMPARE_COLS.map((t) => (
                    <th
                      key={t}
                      scope="col"
                      className="sub-table__col"
                      data-current={t === comparisonTier}
                    >
                      <span className="sub-table__col-name">{getTierLabel(t, intl)}</span>
                      {t === TIERS.PREMIUM && (
                      <span className="sub-table__col-price">
                        {purchasePolicy.canPurchase
                          ? monthlyDisplayPrice
                          : intl.formatMessage({ id: "billing.subscription.web.priceOnAndroid" })}
                      </span>
                      )}
                      {t === comparisonTier && (
                        <span className="sub-table__col-badge">
                          {intl.formatMessage({ id: "billing.subscription.compare.current" })}
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {localizedCompareRows.map((row) => (
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
            <span className="hy-explain__line">{existingChildDowngradeNotice}</span>
            <span className="hy-explain__line">{downgradeLimitNotice}</span>
          </span>
        </div>

        {tier === TIERS.REVIEWED && (
          <div className="sub-note hy-explain" role="note">
            <span className="hy-explain__lines">
              <span className="hy-explain__line">
                {intl.formatMessage({ id: "billing.subscription.reviewed.currentFree" })}
              </span>
              <span className="hy-explain__line">
                {intl.formatMessage({ id: "billing.subscription.reviewed.placesKept" })}
              </span>
            </span>
          </div>
        )}

        {/* 안내 (미구독 시에만) */}
        {!premiumActive && (
          <div className="sub-note hy-explain">
            <span className="hy-explain__lines">
              <span className="hy-explain__line">
                {intl.formatMessage({ id: "billing.subscription.safetyFree" })}
              </span>
              <span className="hy-explain__line">
                {intl.formatMessage({ id: "billing.subscription.detailedPremium" })}
              </span>
              <span className="hy-explain__line">
                {intl.formatMessage({ id: "billing.subscription.remoteAudioDisclosure" })}
              </span>
              {purchasePolicy.canPurchase && (
                <span className="hy-explain__line">
                  {intl.formatMessage(
                    { id: "billing.subscription.provider.terms" },
                    { provider: intl.formatMessage({ id: "billing.subscription.provider.googlePlay" }) },
                  )}
                </span>
              )}
            </span>
          </div>
        )}

        {/* 신규 결제·Google Play 관리는 Android에서만 연다. 기존 웹 구독 해지는 계속 보존한다. */}
        {premiumActive && (purchasePolicy.canPurchase || view?.provider === "toss_web") ? (
          <button
            type="button"
            className="sub-cta hy-press"
            onClick={() => void manage()}
            disabled={busy || webCancellationScheduled}
            aria-busy={busy}
          >
            <img src={asset("ui/crown.webp")} alt="" />
            {webCancellationScheduled
              ? intl.formatMessage({ id: "billing.subscription.cancel.cancelScheduled" })
              : intl.formatMessage({ id: "billing.subscription.cta.manage" })}
          </button>
        ) : !premiumActive && purchasePolicy.canPurchase ? (
          <button
            type="button"
            className="sub-cta hy-press"
            onClick={purchase}
            disabled={busy} aria-busy={busy}
          >
            <img src={asset("ui/crown.webp")} alt="" />
            {busy ? intl.formatMessage({ id: "billing.subscription.cta.busy" }) : purchaseLabel}
          </button>
        ) : null}

        {premiumActive && view?.provider === "toss_web" && cancelConfirmOpen && (
          <section className="sub-cancel" aria-labelledby="sub-cancel-title">
            <h2 id="sub-cancel-title">
              {intl.formatMessage({ id: "billing.subscription.cancel.title" })}
            </h2>
            <p>
              {view.periodEnd
                ? intl.formatMessage(
                    { id: "billing.subscription.cancel.until" },
                    { date: formatPeriodEnd(view.periodEnd, locale, familyTimeZone) },
                  )
                : intl.formatMessage({ id: "billing.subscription.cancel.currentPeriod" })}
            </p>
            <p>
              {existingChildDowngradeNotice} {downgradeLimitNotice}
            </p>
            <div className="sub-cancel__actions">
              <button
                type="button"
                className="hy-press"
                onClick={() => setCancelConfirmOpen(false)}
                disabled={busy}
                aria-busy={busy}
              >
                {intl.formatMessage({ id: "billing.subscription.cancel.continue" })}
              </button>
              <button
                type="button"
                className="hy-press"
                onClick={() => void confirmWebCancellation()}
                disabled={busy}
                aria-busy={busy}
              >
                {busy
                  ? intl.formatMessage({ id: "billing.subscription.cancel.confirming" })
                  : intl.formatMessage({ id: "billing.subscription.cancel.confirm" })}
              </button>
            </div>
          </section>
        )}

        <div className="sub-fine">
          {premiumActive ? (
            <>
              {view?.isTrial
                ? view.provider === "toss_web"
                  ? intl.formatMessage({ id: "billing.subscription.fine.trialWeb" })
                  : intl.formatMessage({ id: "billing.subscription.fine.trialGoogle" })
                : view?.status === "cancelled"
                  ? intl.formatMessage(
                      { id: "billing.subscription.cancelledUntil" },
                      {
                        date: view.periodEnd
                          ? formatPeriodEnd(view.periodEnd, locale, familyTimeZone)
                          : intl.formatMessage({ id: "billing.subscription.currentPeriod" }),
                      },
                    )
                  : view?.provider === "toss_web"
                    ? intl.formatMessage({ id: "billing.subscription.fine.webManage" })
                    : intl.formatMessage({ id: "billing.subscription.fine.googleManage" })}
            </>
          ) : (
            <>
              {intl.formatMessage({ id: "billing.subscription.fine.inactiveFirst" })}
              <br />
              {intl.formatMessage({ id: "billing.subscription.fine.inactiveSecond" })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

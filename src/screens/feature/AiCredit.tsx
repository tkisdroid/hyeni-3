import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { BellRing, Bot, ChevronLeft, Hash, MessageCircle, Sparkles } from "lucide-react";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { useAuth } from "@/auth/AuthContext";
import { useActiveChild } from "@/app/activeChild";
import {
  useAiCreditPublicStatus,
  useAiCredits,
  useAiFriendSettings,
  useSaveAiFriendSettings,
  useWebAiCreditCatalog,
} from "@/queries/useAi";
import { qk } from "@/queries/keys";
import { isBillingAvailable, launchCreditPurchase } from "@/lib/native/billing";
import { getPlatform } from "@/lib/native/plugins";
import {
  completeWebAiCreditCheckout,
  createWebAiCreditCheckout,
  reconcileWebAiCreditCheckout,
  resolveWebAiCreditCheckout,
  type WebAiCreditCompletionResponse,
} from "@/lib/api/endpoints/webBilling";
import { isApiError } from "@/lib/api/errors";
import { useIntl, type IntlShape } from "react-intl";
import { BillingError } from "@/lib/native/billingError";
import { resolveNativeBillingFailureMessage } from "@/transform/billingFailureMessage";
import { startTossOneTimePayment } from "@/lib/webBilling";
import { creditHeroAmount } from "@/transform/aiView";
import {
  aiIncludedDailyLimitForExplicitTier,
  resolveAiLimitExhaustionReason,
} from "@/transform/aiCreditPublicStatus";
import {
  aiTopicsToText,
  buildAiFriendControlPatch,
  isAiFriendControlFormDirty,
  normalizeAiControlTime,
} from "@/transform/aiFriendSettingsForm";
import { ScreenQueryState } from "@/components/ui/ScreenQueryState";
import { resolveQueryTruthState } from "@/transform/queryTruthState";
import {
  buildWebAiCreditRedirectUrls,
  clearPendingWebAiCreditCheckout,
  clearWebAiCreditRedirectQuery,
  parseWebAiCreditRedirect,
  readPendingWebAiCreditCheckout,
  resolveWebAiCreditDebtImpact,
  savePendingWebAiCreditCheckout,
  validateRecoveredWebAiCreditCheckout,
  validateWebAiCreditCheckout,
  type PendingWebAiCreditCheckout,
  type WebAiCreditPack,
} from "@/transform/webAiCreditBilling";
import { usePwaUpdateCriticalSection } from "@/lib/usePwaUpdateCriticalSection";
import { PremiumUpsell } from "@/components/PremiumUpsell";
import {
  browserPremiumReturnIntentStorage,
  savePremiumReturnIntent,
} from "@/transform/premiumReturnIntent";
import { TIERS } from "@/transform/tierPolicy";
import "./AiCredit.css";

type CreditPack = {
  id: string;
  /**
   * 백엔드(및 Google Play 인앱 상품)가 실제로 지급하는 개수(30/80/200).
   * 화면 표기·토스트·결제 모두 이 값을 단일 기준으로 사용한다(표기≠지급 불일치 방지).
   * 이전엔 디자인 팩(30/100/300)을 별도 amt 로 표기해 실지급수(80/200)와 어긋났었다.
   */
  backendAmount: number;
  tagId?: string;
  descriptionId: string;
  ring: string;
  webPack?: WebAiCreditPack;
};

type SettingsSaveAction = "ai-toggle" | "limit-decrease" | "limit-increase" | "advanced" | null;

const CREDIT_PACKS: CreditPack[] = [
  {
    id: "p30",
    backendAmount: 30,
    descriptionId: "billing.aiCredit.pack.p30.description",
    ring: "1px solid rgba(32,26,29,.06)",
  },
  {
    id: "p80",
    backendAmount: 80,
    tagId: "billing.aiCredit.pack.p80.tag",
    descriptionId: "billing.aiCredit.pack.p80.description",
    ring: "2px solid #B79DFB",
  },
  {
    id: "p200",
    backendAmount: 200,
    tagId: "billing.aiCredit.pack.p200.tag",
    descriptionId: "billing.aiCredit.pack.p200.description",
    ring: "1px solid rgba(32,26,29,.06)",
  },
];

const CREDIT_PACK_PRESENTATION: Readonly<Record<30 | 80 | 200, Pick<CreditPack, "tagId" | "descriptionId" | "ring">>> = {
  30: {
    descriptionId: "billing.aiCredit.pack.p30.description",
    ring: "1px solid rgba(32,26,29,.06)",
  },
  80: {
    tagId: "billing.aiCredit.pack.p80.tag",
    descriptionId: "billing.aiCredit.pack.p80.description",
    ring: "2px solid #B79DFB",
  },
  200: {
    tagId: "billing.aiCredit.pack.p200.tag",
    descriptionId: "billing.aiCredit.pack.p200.description",
    ring: "1px solid rgba(32,26,29,.06)",
  },
};

function webAiCreditStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    const storage = window.sessionStorage;
    const probe = "hyeni.webAiCredit.storageProbe";
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

function isCompletedWebAiCredit(
  value: WebAiCreditCompletionResponse,
): value is Extract<WebAiCreditCompletionResponse, { ok: true }> {
  return value.ok === true
    && value.status === "done"
    && Number.isSafeInteger(value.credits)
    && value.credits > 0
    && Number.isSafeInteger(value.debtApplied)
    && value.debtApplied >= 0
    && Number.isSafeInteger(value.availableCreditsAdded)
    && value.availableCreditsAdded >= 0
    && value.debtApplied + value.availableCreditsAdded === value.credits;
}

function shouldRetainWebAiCreditPending(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (!isApiError(error)) return false;
  if (
    error.code === "web_ai_credit_reconciliation_pending"
    || error.code === "web_ai_credit_processing"
    || error.code === "web_ai_credit_payment_unknown"
    || error.code === "web_ai_credit_lookup_retry_later"
    || error.code === "web_ai_credit_lookup_rate_limited"
  ) return true;
  return error.status >= 500;
}

function webAiCreditFailureMessage(error: unknown, intl: IntlShape): string {
  if (isApiError(error)) {
    if (error.code === "web_ai_credit_new_checkouts_paused") {
      return intl.formatMessage({ id: "billing.aiCredit.failure.paused" });
    }
    if (error.code === "web_ai_credit_payment_refunded") {
      return intl.formatMessage({ id: "billing.aiCredit.failure.refunded" });
    }
    if (error.code === "web_ai_credit_payment_failed" || error.status === 402) {
      return intl.formatMessage({ id: "billing.aiCredit.failure.declined" });
    }
    if (error.status === 400 || error.status === 403) {
      return intl.formatMessage({ id: "billing.aiCredit.failure.mismatch" });
    }
  }
  if (error instanceof Error && error.message === "web_billing_session_storage_unavailable") {
    return intl.formatMessage({ id: "billing.aiCredit.failure.storage" });
  }
  return intl.formatMessage({ id: "billing.aiCredit.failure.generic" });
}

export function AiCredit() {
  const intl = useIntl();
  const navigate = useNavigate();
  const { show } = useToast();
  const { userId, familyId } = useAuth();
  const qc = useQueryClient();
  const isWebBillingChannel = getPlatform() === "web";
  const webCatalogQuery = useWebAiCreditCatalog(isWebBillingChannel);
  const webCatalog = webCatalogQuery.data ?? null;
  const [billingRedirect] = useState(() => (
    typeof window === "undefined"
      ? { kind: "none" } as const
      : parseWebAiCreditRedirect(window.location.search)
  ));
  const billingRedirectHandledRef = useRef(false);
  const billingRedirectScrubbedRef = useRef(false);
  const webCompletionInFlightRef = useRef(false);
  const webAutoReconcileOrderRef = useRef<string | null>(null);
  const webPendingToastShownRef = useRef(false);
  const [webReconciliationPending, setWebReconciliationPending] = useState(false);

  // 크레딧은 자녀별 — 전역 활성 아이(홈 스위치) 기준. 스위치 전환 시 대상 아이도 함께 바뀐다.
  const [searchParams] = useSearchParams();
  const { activeChild, childMembers, familyLoading } = useActiveChild();
  // 아이가 보낸 충전 요청 알림에서 오면 그 아이가 대상이다(다자녀 오귀속 방지).
  // 딥링크가 현재 가족의 활성 아이를 가리킬 때만 채택하고, 아니면 활성 아이를 쓴다.
  const requestedChildUserId = searchParams.get("child")?.trim() || null;
  const requestedChild = requestedChildUserId
    ? childMembers.find((m) => m.user_id === requestedChildUserId) ?? null
    : null;
  const targetChild = requestedChild ?? activeChild;
  const childUserId = targetChild?.user_id ?? null;
  const childName = targetChild?.name || intl.formatMessage({ id: "billing.aiCredit.fallbackChild" });

  const creditQuery = useAiCredits(childUserId);
  const creditStatus = creditQuery.data;
  const publicStatusQuery = useAiCreditPublicStatus(childUserId);
  const publicStatus = publicStatusQuery.data;
  // 부모 상한과 구매분까지 합친 공개 상태가 정본이다. 구버전 balance 값은 보조 폴백으로만 둔다.
  const heroAmount = publicStatus?.availableRemaining
    ?? (creditStatus
      ? creditHeroAmount(creditStatus)
      : creditStatus === null
        ? 0
        : null);

  // AI 대화 켜기/하루 한도(부모 설정, ai_parent_settings) — 이 설정이 없으면 아이 채팅이 403.
  const friendSettingsQuery = useAiFriendSettings(childUserId);
  const friendSettings = friendSettingsQuery.data;
  const aiCreditQueryState = resolveQueryTruthState([
    { isLoading: creditQuery.isLoading, isError: creditQuery.isError },
    { isLoading: publicStatusQuery.isLoading, isError: publicStatusQuery.isError },
    { isLoading: friendSettingsQuery.isLoading, isError: friendSettingsQuery.isError },
  ]);
  const aiCreditDataMissing = aiCreditQueryState === "ready"
    && !!childUserId
    && (creditStatus === undefined || publicStatus === undefined || friendSettings === undefined);
  const aiCreditDataReady = aiCreditQueryState === "ready"
    && !!childUserId
    && !aiCreditDataMissing;
  const aiCreditDataEmpty = aiCreditDataReady
    && (creditStatus === null || friendSettings === null);
  const aiCreditRefetching = creditQuery.isFetching
    || publicStatusQuery.isFetching
    || friendSettingsQuery.isFetching;
  const retryAiCredit = async (): Promise<void> => {
    await Promise.all([
      creditQuery.refetch(),
      publicStatusQuery.refetch(),
      friendSettingsQuery.refetch(),
    ]);
  };
  const saveSettings = useSaveAiFriendSettings();
  const [settingsSaveAction, setSettingsSaveAction] = useState<SettingsSaveAction>(null);
  const aiEnabled = friendSettings?.ai_enabled ?? false;
  const explicitTierFallback = aiIncludedDailyLimitForExplicitTier(
    publicStatus?.isPremium ?? creditStatus?.isPremium,
  );
  const commercialIsPremium = publicStatus?.isPremium ?? creditStatus?.isPremium ?? null;
  const commercialTier = commercialIsPremium === true
    ? TIERS.PREMIUM
    : commercialIsPremium === false
      ? TIERS.FREE
      : TIERS.UNKNOWN;
  const freeLimitExhaustionReason = publicStatus?.availableRemaining === 0
    ? resolveAiLimitExhaustionReason(publicStatus)
    : null;
  const dailyLimit = friendSettings?.daily_limit
    ?? publicStatus?.parentDailyLimit
    ?? publicStatus?.dailyIncludedLimit
    ?? creditStatus?.dailyIncludedLimit
    ?? explicitTierFallback;
  const [forbiddenTopicsText, setForbiddenTopicsText] = useState("");
  const [proactiveEnabled, setProactiveEnabled] = useState(false);
  const [proactiveStartTime, setProactiveStartTime] = useState("08:00");
  const [proactiveEndTime, setProactiveEndTime] = useState("20:00");
  const [quietHoursStart, setQuietHoursStart] = useState("21:00");
  const [quietHoursEnd, setQuietHoursEnd] = useState("07:00");
  const [allowScheduleActions, setAllowScheduleActions] = useState(true);
  const [allowContactActions, setAllowContactActions] = useState(true);
  // 플로팅 AI 친구가 스스로 아이를 부르는 동작. 서버에 값이 없는 옛 가족은 켜짐이 기본이다.
  const [buddyAttentionEnabled, setBuddyAttentionEnabled] = useState(true);
  const [formHydration, setFormHydration] = useState<{
    childUserId: string;
    source: typeof friendSettings;
  } | null>(null);

  useEffect(() => {
    if (!aiCreditDataReady || !childUserId || friendSettings === undefined) {
      setFormHydration(null);
      return;
    }
    setForbiddenTopicsText(aiTopicsToText(friendSettings?.forbidden_topics));
    setProactiveEnabled(friendSettings?.proactive_enabled ?? false);
    setProactiveStartTime(normalizeAiControlTime(friendSettings?.proactive_start_time, "08:00"));
    setProactiveEndTime(normalizeAiControlTime(friendSettings?.proactive_end_time, "20:00"));
    setQuietHoursStart(normalizeAiControlTime(friendSettings?.quiet_hours_start, "21:00"));
    setQuietHoursEnd(normalizeAiControlTime(friendSettings?.quiet_hours_end, "07:00"));
    setAllowScheduleActions(friendSettings?.allow_schedule_actions ?? true);
    setAllowContactActions(friendSettings?.allow_contact_actions ?? true);
    setBuddyAttentionEnabled(friendSettings?.buddy_attention_enabled ?? true);
    setFormHydration({ childUserId, source: friendSettings });
  }, [aiCreditDataReady, childUserId, friendSettings]);

  const advancedSettingsReady = aiCreditDataReady
    && formHydration?.childUserId === childUserId
    && formHydration.source === friendSettings;

  const toggleAiEnabled = () => {
    if (!aiCreditDataReady || !childUserId || saveSettings.isPending) return;
    setSettingsSaveAction("ai-toggle");
    const initialDailyLimitPatch = !aiEnabled && friendSettings === null && dailyLimit != null
      ? { daily_limit: dailyLimit }
      : {};
    saveSettings.mutate(
      { childUserId, patch: { ai_enabled: !aiEnabled, ...initialDailyLimitPatch } },
      {
        onSuccess: () => show(intl.formatMessage({
          id: !aiEnabled ? "billing.aiCredit.toast.enabled" : "billing.aiCredit.toast.disabled",
        }), "🤖"),
        onError: () => show(intl.formatMessage({ id: "billing.aiCredit.toast.saveFailed" }), "⚠️"),
        onSettled: () => setSettingsSaveAction(null),
      },
    );
  };
  const saveAdvancedSettings = () => {
    if (!advancedSettingsReady || !childUserId || dailyLimit == null || saveSettings.isPending) return;
    const patch = buildAiFriendControlPatch({
      forbiddenTopicsText,
      proactiveEnabled,
      proactiveStartTime,
      proactiveEndTime,
      quietHoursStart,
      quietHoursEnd,
      allowScheduleActions,
      allowContactActions,
      buddyAttentionEnabled,
    });
    setSettingsSaveAction("advanced");
    saveSettings.mutate(
      { childUserId, patch: { ai_enabled: aiEnabled, daily_limit: dailyLimit, ...patch } },
      {
        onSuccess: () => show(intl.formatMessage({ id: "billing.aiCredit.toast.detailSaved" }), "🤖"),
        onError: () => show(intl.formatMessage({ id: "billing.aiCredit.toast.saveFailed" }), "⚠️"),
        onSettled: () => setSettingsSaveAction(null),
      },
    );
  };
  const changeDailyLimit = (delta: number) => {
    if (!aiCreditDataReady || !childUserId || dailyLimit == null || saveSettings.isPending) return;
    const next = Math.min(100, Math.max(1, dailyLimit + delta));
    if (next === dailyLimit) return;
    setSettingsSaveAction(delta < 0 ? "limit-decrease" : "limit-increase");
    saveSettings.mutate(
      { childUserId, patch: { daily_limit: next } },
      {
        onError: () => show(intl.formatMessage({ id: "billing.aiCredit.toast.saveFailed" }), "⚠️"),
        onSettled: () => setSettingsSaveAction(null),
      },
    );
  };
  const aiToggleSaving = saveSettings.isPending && settingsSaveAction === "ai-toggle";
  const limitDecreaseSaving = saveSettings.isPending && settingsSaveAction === "limit-decrease";
  const limitIncreaseSaving = saveSettings.isPending && settingsSaveAction === "limit-increase";
  const advancedSettingsSaving = saveSettings.isPending && settingsSaveAction === "advanced";

  const [busyPack, setBusyPack] = useState<string | null>(null);
  const [aiLimitUpsellOpen, setAiLimitUpsellOpen] = useState(false);
  const advancedSettingsDirty = advancedSettingsReady && isAiFriendControlFormDirty({
    forbiddenTopicsText,
    proactiveEnabled,
    proactiveStartTime,
    proactiveEndTime,
    quietHoursStart,
    quietHoursEnd,
    allowScheduleActions,
    allowContactActions,
    buddyAttentionEnabled,
  }, friendSettings);
  usePwaUpdateCriticalSection(
    busyPack !== null
    || webReconciliationPending
    || saveSettings.isPending
    || advancedSettingsDirty,
  );
  const availablePacks = useMemo<CreditPack[]>(() => {
    if (!isWebBillingChannel) return CREDIT_PACKS;
    return (webCatalog?.packs ?? []).map((pack) => ({
      id: pack.productCode,
      backendAmount: pack.credits,
      ...CREDIT_PACK_PRESENTATION[pack.credits],
      webPack: pack,
    }));
  }, [isWebBillingChannel, webCatalog]);
  const localizeCreditPrice = (displayPrice: string): string => {
    const providerPrice = displayPrice;
    return isWebBillingChannel
      ? intl.formatMessage(
          { id: "billing.aiCredit.serverCatalogPrice" },
          { catalogPrice: providerPrice },
        )
      : intl.formatMessage(
          { id: "billing.aiCredit.providerPrice" },
          { formattedPrice: providerPrice },
        );
  };
  const lowCreditKey = useMemo(
    () => (childUserId ? `hyeni-low-credit-alert:${childUserId}` : ""),
    [childUserId],
  );
  const [lowCreditAlert, setLowCreditAlert] = useState(false);

  useEffect(() => {
    if (!lowCreditKey) {
      setLowCreditAlert(false);
      return;
    }
    try {
      setLowCreditAlert(window.localStorage.getItem(lowCreditKey) === "1");
    } catch {
      setLowCreditAlert(false);
    }
  }, [lowCreditKey]);

  useEffect(() => {
    if (!lowCreditKey) return;
    try {
      window.localStorage.setItem(lowCreditKey, lowCreditAlert ? "1" : "0");
    } catch {
      /* localStorage 불가 환경에서는 화면 상태만 유지 */
    }
  }, [lowCreditKey, lowCreditAlert]);

  useEffect(() => {
    if (!lowCreditAlert || heroAmount == null || heroAmount > 3 || !childUserId) return;
    const today = new Date().toISOString().slice(0, 10);
    const seenKey = `hyeni-low-credit-alert-seen:${childUserId}:${today}`;
    try {
      if (window.localStorage.getItem(seenKey) === "1") return;
      window.localStorage.setItem(seenKey, "1");
    } catch {
      /* 알림 중복 방지만 실패해도 토스트는 정상 표시 */
    }
    show(intl.formatMessage(
      { id: "billing.aiCredit.lowAlert.toast" },
      { childName, count: heroAmount },
    ), "💜");
  }, [childName, childUserId, heroAmount, intl, lowCreditAlert, show]);

  const finishWebAiCredit = useCallback(async (input: {
    pending: PendingWebAiCreditCheckout;
    storage: Storage | null;
    payment?: { paymentKey: string; orderId: string; amount: number };
  }): Promise<void> => {
    if (webCompletionInFlightRef.current) return;
    webCompletionInFlightRef.current = true;
    setBusyPack(input.pending.productCode);
    try {
      let result: WebAiCreditCompletionResponse;
      if (input.payment) {
        // complete가 미확정/재시도 상태를 반환해도 같은 사용자 동작 안에서 곧바로
        // reconcile을 중복 호출하지 않는다. 서버의 주문별 냉각시간과 pending을 보존한다.
        result = await completeWebAiCreditCheckout({
          familyId: input.pending.familyId,
          childUserId: input.pending.childUserId,
          orderId: input.payment.orderId,
          paymentKey: input.payment.paymentKey,
          amount: input.payment.amount,
        });
      } else {
        result = await reconcileWebAiCreditCheckout({
          familyId: input.pending.familyId,
          childUserId: input.pending.childUserId,
          orderId: input.pending.orderId,
        });
      }

      if (
        isCompletedWebAiCredit(result)
        && result.orderId === input.pending.orderId
        && result.productCode === input.pending.productCode
        && result.credits === input.pending.credits
      ) {
        if (input.storage) clearPendingWebAiCreditCheckout(input.storage);
        setWebReconciliationPending(false);
        webPendingToastShownRef.current = false;
        await Promise.all([
          qc.invalidateQueries({ queryKey: qk.aiCredits(input.pending.familyId) }),
          qc.invalidateQueries({
            queryKey: qk.aiCreditPublicStatus(
              input.pending.familyId,
              input.pending.childUserId,
            ),
          }),
        ]);
        show(
          result.debtApplied > 0
            ? intl.formatMessage(
                { id: "billing.aiCredit.purchase.debtApplied" },
                { debtApplied: result.debtApplied, available: result.availableCreditsAdded },
              )
            : intl.formatMessage(
                { id: "billing.aiCredit.purchase.charged" },
                { count: input.pending.credits },
              ),
          "💜",
        );
        return;
      }

      setWebReconciliationPending(true);
      if (!webPendingToastShownRef.current) {
        webPendingToastShownRef.current = true;
        show(intl.formatMessage({ id: "billing.aiCredit.purchase.pending" }), "💜");
      }
    } catch (error) {
      if (shouldRetainWebAiCreditPending(error)) {
        if (input.storage) {
          try {
            savePendingWebAiCreditCheckout(input.storage, input.pending);
          } catch {
            // 복원된 주문 저장 실패가 이미 진행 중인 결제 확인을 바꾸지 않게 한다.
          }
        }
        setWebReconciliationPending(true);
        if (!webPendingToastShownRef.current) {
          webPendingToastShownRef.current = true;
          show(intl.formatMessage({ id: "billing.aiCredit.purchase.pending" }), "💜");
        }
      } else {
        if (input.storage) clearPendingWebAiCreditCheckout(input.storage);
        setWebReconciliationPending(false);
        webPendingToastShownRef.current = false;
        show(webAiCreditFailureMessage(error, intl), "💜");
      }
    } finally {
      webCompletionInFlightRef.current = false;
      setBusyPack(null);
    }
  }, [intl, qc, show]);

  useEffect(() => {
    if (billingRedirect.kind === "none" || billingRedirectScrubbedRef.current) return;
    billingRedirectScrubbedRef.current = true;
    try {
      window.history.replaceState(
        window.history.state,
        "",
        clearWebAiCreditRedirectQuery(window.location.href),
      );
    } catch {
      // paymentKey는 주소 정리가 실패해도 로그나 화면 문구에 포함하지 않는다.
    }
  }, [billingRedirect]);

  useEffect(() => {
    if (billingRedirectHandledRef.current || billingRedirect.kind === "none") return;
    const storage = webAiCreditStorage();
    if (billingRedirect.kind === "fail") {
      billingRedirectHandledRef.current = true;
      if (storage) clearPendingWebAiCreditCheckout(storage);
      setWebReconciliationPending(false);
      const canceled = billingRedirect.code === "PAY_PROCESS_CANCELED"
        || billingRedirect.code === "PAY_PROCESS_ABORTED";
      show(
        canceled
          ? intl.formatMessage({ id: "billing.aiCredit.purchase.canceled" })
          : intl.formatMessage({ id: "billing.aiCredit.failure.declined" }),
        "💜",
      );
      return;
    }
    if (!familyId || !childUserId) return;

    billingRedirectHandledRef.current = true;
    const pending = storage ? readPendingWebAiCreditCheckout(storage) : null;
    const currentPending = pending?.familyId === familyId
      && pending.childUserId === childUserId
      ? pending
      : null;

    if (billingRedirect.kind === "invalid") {
      if (!currentPending) {
        setWebReconciliationPending(!!pending);
        show(intl.formatMessage({ id: "billing.aiCredit.purchase.invalidOrder" }), "💜");
        return;
      }
      setWebReconciliationPending(true);
      void finishWebAiCredit({ pending: currentPending, storage });
      return;
    }

    if (pending && !currentPending) {
      setWebReconciliationPending(true);
      show(intl.formatMessage({ id: "billing.aiCredit.purchase.familyMismatch" }), "💜");
      return;
    }
    if (currentPending) {
      if (
        currentPending.orderId !== billingRedirect.orderId
        || currentPending.amount !== billingRedirect.amount
      ) {
        setWebReconciliationPending(true);
        show(intl.formatMessage({ id: "billing.aiCredit.purchase.resultMismatch" }), "💜");
        return;
      }
      void finishWebAiCredit({ pending: currentPending, storage, payment: billingRedirect });
      return;
    }

    setWebReconciliationPending(true);
    void (async () => {
      try {
        const recovered = validateRecoveredWebAiCreditCheckout(
          await resolveWebAiCreditCheckout({
            familyId,
            childUserId,
            orderId: billingRedirect.orderId,
            amount: billingRedirect.amount,
          }),
          {
            familyId,
            childUserId,
            orderId: billingRedirect.orderId,
            amount: billingRedirect.amount,
          },
        );
        if (storage) savePendingWebAiCreditCheckout(storage, recovered);
        await finishWebAiCredit({ pending: recovered, storage, payment: billingRedirect });
      } catch {
        if (storage) clearPendingWebAiCreditCheckout(storage);
        setWebReconciliationPending(false);
        webPendingToastShownRef.current = false;
        show(intl.formatMessage({ id: "billing.aiCredit.purchase.invalidOrder" }), "💜");
      }
    })();
  }, [billingRedirect, childUserId, familyId, finishWebAiCredit, intl, show]);

  useEffect(() => {
    if (!isWebBillingChannel || billingRedirect.kind !== "none" || !familyId || !childUserId) return;
    const storage = webAiCreditStorage();
    const pending = storage ? readPendingWebAiCreditCheckout(storage) : null;
    if (
      !storage
      || !pending
      || pending.familyId !== familyId
      || pending.childUserId !== childUserId
    ) {
      setWebReconciliationPending(false);
      return;
    }
    setWebReconciliationPending(true);
    if (webAutoReconcileOrderRef.current === pending.orderId) return;
    webAutoReconcileOrderRef.current = pending.orderId;
    void finishWebAiCredit({ pending, storage });
  }, [billingRedirect.kind, childUserId, familyId, finishWebAiCredit, isWebBillingChannel]);

  const retryWebAiCreditReconciliation = () => {
    if (!familyId || !childUserId || webCompletionInFlightRef.current) return;
    const storage = webAiCreditStorage();
    const pending = storage ? readPendingWebAiCreditCheckout(storage) : null;
    if (
      !storage
      || !pending
      || pending.familyId !== familyId
      || pending.childUserId !== childUserId
    ) {
      setWebReconciliationPending(false);
      show(intl.formatMessage({ id: "billing.aiCredit.purchase.noPending" }), "💜");
      return;
    }
    void finishWebAiCredit({ pending, storage });
  };

  // 자동 실행 금지: 실제 새 결제는 팩 버튼 onClick에서만 시작한다.
  // Android는 Google Play, PWA는 서버 확정 카탈로그의 Toss 일회성 결제를 사용한다.
  const buy = async (p: CreditPack) => {
    if (!aiCreditDataReady) {
      show(intl.formatMessage({ id: "billing.aiCredit.purchase.notReady" }), "⚠️");
      return;
    }
    if (!familyId || !childUserId) {
      show(intl.formatMessage({ id: "billing.aiCredit.purchase.childRequired" }), "💜");
      return;
    }
    if (isWebBillingChannel && webReconciliationPending) {
      retryWebAiCreditReconciliation();
      return;
    }
    if (busyPack) return;
    setBusyPack(p.id);
    try {
      if (isWebBillingChannel) {
        if (!p.webPack) throw new Error("web_ai_credit_catalog_unavailable");
        const storage = webAiCreditStorage();
        if (!storage) throw new Error("web_billing_session_storage_unavailable");
        const rawCheckout = await createWebAiCreditCheckout({
          familyId,
          childUserId,
          productCode: p.webPack.productCode,
        });
        const checkout = validateWebAiCreditCheckout(rawCheckout, p.webPack);
        savePendingWebAiCreditCheckout(storage, {
          familyId,
          childUserId,
          orderId: checkout.orderId,
          customerKey: checkout.customerKey,
          productCode: checkout.productCode,
          credits: checkout.credits,
          amount: checkout.amount,
          currency: checkout.currency,
          expiresAt: checkout.expiresAt,
        });
        setWebReconciliationPending(true);
        webAutoReconcileOrderRef.current = checkout.orderId;
        const redirects = buildWebAiCreditRedirectUrls(window.location.href);
        await startTossOneTimePayment({
          clientKey: checkout.clientKey,
          customerKey: checkout.customerKey,
          orderId: checkout.orderId,
          credits: checkout.credits,
          amount: checkout.amount,
          ...redirects,
        });
        return;
      }

      if (!isBillingAvailable()) {
        throw new BillingError("billing_unavailable");
      }
      const purchase = await launchCreditPurchase({
        familyId,
        childUserId,
        parentId: userId,
        amount: p.backendAmount,
      });
      // 충전 성공 → 크레딧 캐시 무효화로 잔액 히어로를 갱신한다.
      await Promise.all([
        qc.invalidateQueries({ queryKey: qk.aiCredits(familyId) }),
        qc.invalidateQueries({ queryKey: qk.aiCreditPublicStatus(familyId, childUserId) }),
      ]);
      show(
        purchase.debtApplied > 0
          ? intl.formatMessage(
              { id: "billing.aiCredit.purchase.debtApplied" },
              { debtApplied: purchase.debtApplied, available: purchase.availableCreditsAdded },
            )
          : intl.formatMessage(
              { id: "billing.aiCredit.purchase.charged" },
              { count: p.backendAmount },
            ),
        "💜",
      );
    } catch (error) {
      show(
        isWebBillingChannel
          ? webAiCreditFailureMessage(error, intl)
          : resolveNativeBillingFailureMessage(error, intl),
        "💜",
      );
    } finally {
      setBusyPack(null);
    }
  };

  if (!childUserId && familyLoading) {
    return (
      <ScreenQueryState
        screenTitle={intl.formatMessage({ id: "billing.aiCredit.title" })}
        state="loading"
        heading={intl.formatMessage({ id: "billing.aiCredit.state.familyLoadingTitle" })}
        description={intl.formatMessage({ id: "billing.aiCredit.state.familyLoadingDescription" })}
        onBack={() => navigate(-1)}
      />
    );
  }

  if (!childUserId) {
    return (
      <ScreenQueryState
        screenTitle={intl.formatMessage({ id: "billing.aiCredit.title" })}
        state="empty"
        heading={intl.formatMessage({ id: "billing.aiCredit.state.noChildTitle" })}
        description={intl.formatMessage({ id: "billing.aiCredit.state.noChildDescription" })}
        onBack={() => navigate(-1)}
        onRetry={() => navigate("/child-invite")}
        retryLabel={intl.formatMessage({ id: "billing.aiCredit.state.connectChild" })}
      />
    );
  }

  if (aiCreditQueryState === "loading") {
    return (
      <ScreenQueryState
        screenTitle={intl.formatMessage({ id: "billing.aiCredit.title" })}
        state="loading"
        heading={intl.formatMessage({ id: "billing.aiCredit.state.loadingTitle" })}
        description={intl.formatMessage({ id: "billing.aiCredit.state.loadingDescription" })}
        onBack={() => navigate(-1)}
      />
    );
  }

  if (aiCreditQueryState === "error" || aiCreditDataMissing) {
    return (
      <ScreenQueryState
        screenTitle={intl.formatMessage({ id: "billing.aiCredit.title" })}
        state="error"
        heading={intl.formatMessage({ id: "billing.aiCredit.state.errorTitle" })}
        description={intl.formatMessage({ id: "billing.aiCredit.state.errorDescription" })}
        onBack={() => navigate(-1)}
        onRetry={() => void retryAiCredit()}
        retrying={aiCreditRefetching}
      />
    );
  }

  return (
    <div className="ac-screen">
      {/* sticky 헤더 */}
      <div className="ac-header">
        <button
          type="button"
          className="ac-back hy-press"
          aria-label={intl.formatMessage({ id: "billing.common.back" })}
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} strokeWidth={2.2} color="#4A4145" />
        </button>
        <span className="ac-title">{intl.formatMessage({ id: "billing.aiCredit.title" })}</span>
      </div>

      <div className="hy-content ac-content">
        {aiCreditDataEmpty && (
          <div className="sqs-inline-empty">
            {intl.formatMessage({ id: "billing.aiCredit.state.empty" })}
          </div>
        )}
        {/* 잔액 히어로 */}
        <div className="ac-hero">
          <span className="ac-hero__sheen" />
          <span className="ac-hero__mascot">
            <img src={asset("mascot/wave.webp")} alt="" />
          </span>
          <div className="ac-hero__label">
            {intl.formatMessage({ id: "billing.aiCredit.hero.remaining" }, { childName })}
          </div>
          <div className="ac-hero__amount">
            <span className="ac-hero__num">
              {heroAmount != null
                ? intl.formatMessage({ id: "billing.aiCredit.hero.count" }, { count: heroAmount })
                : "—"}
            </span>
          </div>
          <div className="ac-hero__badge">
            <Sparkles size={13} strokeWidth={2.2} aria-hidden="true" />
            {intl.formatMessage({ id: "billing.aiCredit.hero.badge" })}
          </div>
        </div>

        {/* 안내 */}
        <div className="ac-note hy-explain">
          <span className="ac-note__emoji"><MessageCircle size={15} strokeWidth={2.2} /></span>
            <span className="hy-explain__lines">
              <span className="hy-explain__line">{intl.formatMessage({ id: "billing.aiCredit.creditUse" })}</span>
              <span className="hy-explain__line">{intl.formatMessage({ id: "billing.aiCredit.topUpHint" })}</span>
          </span>
        </div>

        {/* 충전팩 */}
        <div>
          <div className="ac-packs__label">{intl.formatMessage({ id: "billing.aiCredit.packs.title" })}</div>
          <div className="sqs-inline-empty">
            {intl.formatMessage({
              id: isWebBillingChannel
                ? "billing.aiCredit.web.noGooglePlay"
                : "billing.aiCredit.native.providerNotice",
            })}
          </div>
          {isWebBillingChannel && webCatalogQuery.isLoading && (
            <div className="sqs-inline-empty" role="status">
              {intl.formatMessage({ id: "billing.aiCredit.packs.catalogLoading" })}
            </div>
          )}
          {isWebBillingChannel && webCatalogQuery.isError && (
            <div className="sqs-inline-empty" role="status">
              {intl.formatMessage({ id: "billing.aiCredit.packs.catalogError" })}
            </div>
          )}
          {isWebBillingChannel
            && !webCatalogQuery.isLoading
            && !webCatalogQuery.isError
            && (!webCatalog?.configured || webCatalog.packs.length === 0) && (
            <div className="sqs-inline-empty" role="status">
              {intl.formatMessage({ id: "billing.aiCredit.packs.catalogUnavailable" })}
            </div>
          )}
          {(creditStatus?.purchasedCreditDebt ?? 0) > 0 && (
            <div className="sqs-inline-empty" role="status">
              {intl.formatMessage(
                { id: "billing.aiCredit.packs.debtNotice" },
                { count: creditStatus?.purchasedCreditDebt },
              )}
            </div>
          )}
          <div className="ac-packs__list">
            {availablePacks.map((p) => {
              const debtImpact = resolveWebAiCreditDebtImpact(
                p.backendAmount,
                creditStatus?.purchasedCreditDebt ?? 0,
              );
              return (
                <div key={p.id} className="ac-pack" style={{ border: p.ring }}>
                <span className="ac-pack__icon">
                  <img src={asset("mascot/wave.webp")} alt="" />
                </span>
                <span className="ac-pack__main">
                  <span className="ac-pack__amt-row">
                    <span className="ac-pack__amt">
                      {intl.formatMessage({ id: "billing.aiCredit.packs.amount" }, { count: p.backendAmount })}
                    </span>
                    {p.tagId && (
                      <span className="ac-pack__tag">{intl.formatMessage({ id: p.tagId })}</span>
                    )}
                  </span>
                  <span className="ac-pack__per">{intl.formatMessage({ id: p.descriptionId })}</span>
                  {debtImpact.debtApplied > 0 && (
                    <span className="ac-pack__per">
                      {debtImpact.availableCreditsAdded > 0
                        ? intl.formatMessage(
                            { id: "billing.aiCredit.packs.debtPartial" },
                            {
                              total: p.backendAmount,
                              debtApplied: debtImpact.debtApplied,
                              available: debtImpact.availableCreditsAdded,
                            },
                          )
                        : intl.formatMessage(
                            { id: "billing.aiCredit.packs.debtFull" },
                            { total: p.backendAmount, remainingDebt: debtImpact.remainingDebt },
                          )}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  className="ac-buy hy-press"
                  onClick={() => buy(p)}
                  disabled={
                    busyPack !== null
                    || (isWebBillingChannel && webReconciliationPending)
                    || (!isWebBillingChannel && !isBillingAvailable())
                  }
                  aria-busy={busyPack === p.id}
                  aria-label={isWebBillingChannel
                    ? intl.formatMessage(
                        { id: "billing.aiCredit.packs.webAria" },
                        {
                          count: p.backendAmount,
                          price: p.webPack?.displayPrice
                            ? localizeCreditPrice(p.webPack.displayPrice)
                            : intl.formatMessage({ id: "billing.aiCredit.packs.pricePending" }),
                        },
                      )
                    : intl.formatMessage(
                        { id: "billing.aiCredit.packs.nativeAria" },
                        { count: p.backendAmount },
                      )}
                >
                  {busyPack === p.id
                    ? intl.formatMessage({ id: "billing.aiCredit.packs.checking" })
                    : isWebBillingChannel
                      ? p.webPack?.displayPrice
                        ? localizeCreditPrice(p.webPack.displayPrice)
                        : intl.formatMessage({ id: "billing.aiCredit.packs.pricePending" })
                      : isBillingAvailable()
                        ? intl.formatMessage({ id: "billing.aiCredit.packs.pricePending" })
                        : intl.formatMessage({ id: "billing.aiCredit.packs.unavailable" })}
                </button>
                </div>
              );
            })}
          </div>
          {isWebBillingChannel && webReconciliationPending && (
            <div className="sqs-inline-empty" role="status">
              <span>{intl.formatMessage({ id: "billing.aiCredit.packs.previousPending" })}</span>{" "}
              <button
                type="button"
                className="ac-buy hy-press"
                onClick={retryWebAiCreditReconciliation}
                disabled={busyPack !== null}
                aria-busy={busyPack !== null}
              >
                {intl.formatMessage({ id: "billing.aiCredit.packs.retry" })}
              </button>
            </div>
          )}
        </div>

        {commercialIsPremium === false && (
          <section
            className="ac-premium-callout"
            aria-label={intl.formatMessage({ id: "billing.aiCredit.premium.aria" })}
          >
            <div>
              <strong>{intl.formatMessage({
                id: freeLimitExhaustionReason === "free_included_limit"
                  ? "billing.aiCredit.premium.exhausted"
                  : "billing.aiCredit.premium.comparison",
              })}</strong>
              <p>{freeLimitExhaustionReason === "parent_safety_limit"
                ? intl.formatMessage(
                    { id: "billing.aiCredit.premium.parentLimit" },
                    { count: publicStatus?.parentDailyLimit ?? 0 },
                  )
                : intl.formatMessage({ id: "billing.aiCredit.premium.benefit" })}</p>
            </div>
            <button
              type="button"
              className="ac-premium-callout__cta hy-press"
              onClick={() => setAiLimitUpsellOpen(true)}
            >
              {intl.formatMessage({ id: "billing.aiCredit.premium.cta" })}
            </button>
          </section>
        )}

        {/* AI 친구 켜기 + 하루 대화 한도(부모 설정 — 꺼져 있으면 아이가 대화 불가) */}
        <div className="ac-auto">
          <span className="ac-auto__icon"><Bot size={20} strokeWidth={2.2} color="var(--mint-text)" /></span>
          <span className="ac-auto__main">
            <span className="ac-auto__title">{intl.formatMessage({ id: "billing.aiCredit.settings.aiToggleTitle" })}</span>
            <span className="ac-auto__sub">
              {aiEnabled
                ? dailyLimit != null
                  ? intl.formatMessage(
                      { id: "billing.aiCredit.settings.enabledLimit" },
                      { count: dailyLimit },
                    )
                  : intl.formatMessage({ id: "billing.aiCredit.settings.enabledPending" })
                : intl.formatMessage({ id: "billing.aiCredit.settings.disabled" })}
            </span>
          </span>
          <button
            type="button"
            className="ac-toggle"
            aria-label={intl.formatMessage({ id: "billing.aiCredit.settings.aiToggleTitle" })}
            aria-pressed={aiEnabled}
            onClick={toggleAiEnabled}
            disabled={saveSettings.isPending || !childUserId}
            aria-busy={aiToggleSaving}
            style={{ background: aiEnabled ? "var(--hy-accent-cta)" : "var(--line-soft)" }}
          >
            <span className="ac-toggle__knob" style={{ left: aiEnabled ? 22 : 2 }} />
          </button>
        </div>
        {aiEnabled && (
          <div className="ac-limit-wrap">
          <div className="ac-auto" style={{ marginTop: -4 }}>
            <span className="ac-auto__icon"><Hash size={20} strokeWidth={2.2} color="var(--mint-text)" /></span>
            <span className="ac-auto__main">
              <span className="ac-auto__title">{intl.formatMessage({ id: "billing.aiCredit.settings.dailyLimitTitle" })}</span>
              <span className="ac-auto__sub">{intl.formatMessage({ id: "billing.aiCredit.settings.dailyLimitDescription" })}</span>
            </span>
            <span className="ac-limit">
              <button
                type="button"
                className="ac-limit__btn hy-press"
                aria-label={intl.formatMessage({ id: "billing.aiCredit.settings.decrease" })}
                onClick={() => changeDailyLimit(-5)}
                disabled={saveSettings.isPending}
                aria-busy={limitDecreaseSaving}
              >
                −
              </button>
              <span className="ac-limit__num">{dailyLimit ?? "—"}</span>
              <button
                type="button"
                className="ac-limit__btn hy-press"
                aria-label={intl.formatMessage({ id: "billing.aiCredit.settings.increase" })}
                onClick={() => changeDailyLimit(5)}
                disabled={saveSettings.isPending}
                aria-busy={limitIncreaseSaving}
              >
                +
              </button>
            </span>
          </div>
          {commercialIsPremium === true && dailyLimit != null && dailyLimit < 20 && (
            <button
              type="button"
              className="ac-limit-default hy-press"
              onClick={() => changeDailyLimit(20 - dailyLimit)}
              disabled={saveSettings.isPending}
              aria-busy={limitIncreaseSaving}
            >
              {intl.formatMessage({ id: "billing.aiCredit.settings.premiumDefault" })}
            </button>
          )}
          </div>
        )}

        <section className="ac-detail" aria-busy={!advancedSettingsReady}>
          <div className="ac-detail__head">
            <div>
              <div className="ac-detail__title">{intl.formatMessage({ id: "billing.aiCredit.detail.title" })}</div>
              <div className="ac-detail__sub">
                {intl.formatMessage({ id: "billing.aiCredit.detail.description" }, { childName })}
              </div>
            </div>
          </div>

          <label className="ac-field">
            <span className="ac-field__label">{intl.formatMessage({ id: "billing.aiCredit.detail.forbiddenLabel" })}</span>
            <textarea
              className="ac-textarea"
              value={forbiddenTopicsText}
              onChange={(e) => setForbiddenTopicsText(e.target.value)}
              placeholder={intl.formatMessage({ id: "billing.aiCredit.detail.forbiddenPlaceholder" })}
              rows={3}
              disabled={!advancedSettingsReady || saveSettings.isPending}
            />
            <span className="ac-field__hint hy-explain">
              {intl.formatMessage({ id: "billing.aiCredit.detail.forbiddenHint" })}
            </span>
          </label>

          <div className="ac-control-row">
            <span className="ac-control-row__main">
              <span className="ac-control-row__title">{intl.formatMessage({ id: "billing.aiCredit.detail.proactiveTitle" })}</span>
              <span className="ac-control-row__sub">{intl.formatMessage({ id: "billing.aiCredit.detail.proactiveDescription" })}</span>
            </span>
            <button
              type="button"
              className="ac-toggle"
              aria-label={intl.formatMessage({ id: "billing.aiCredit.detail.proactiveTitle" })}
              aria-pressed={proactiveEnabled}
              onClick={() => setProactiveEnabled((v) => !v)}
              disabled={!advancedSettingsReady || saveSettings.isPending}
              data-progress-owner="advanced-save"
              style={{ background: proactiveEnabled ? "var(--hy-accent-cta)" : "var(--line-soft)" }}
            >
              <span className="ac-toggle__knob" style={{ left: proactiveEnabled ? 22 : 2 }} />
            </button>
          </div>

          <div className="ac-time-grid">
            <label className="ac-field">
              <span className="ac-field__label">{intl.formatMessage({ id: "billing.aiCredit.detail.proactiveStart" })}</span>
              <input
                className="ac-time"
                type="time"
                value={proactiveStartTime}
                onChange={(e) => setProactiveStartTime(e.target.value)}
                disabled={!advancedSettingsReady || saveSettings.isPending || !proactiveEnabled}
              />
            </label>
            <label className="ac-field">
              <span className="ac-field__label">{intl.formatMessage({ id: "billing.aiCredit.detail.proactiveEnd" })}</span>
              <input
                className="ac-time"
                type="time"
                value={proactiveEndTime}
                onChange={(e) => setProactiveEndTime(e.target.value)}
                disabled={!advancedSettingsReady || saveSettings.isPending || !proactiveEnabled}
              />
            </label>
            <label className="ac-field">
              <span className="ac-field__label">{intl.formatMessage({ id: "billing.aiCredit.detail.quietStart" })}</span>
              <input
                className="ac-time"
                type="time"
                value={quietHoursStart}
                onChange={(e) => setQuietHoursStart(e.target.value)}
                disabled={!advancedSettingsReady || saveSettings.isPending}
              />
            </label>
            <label className="ac-field">
              <span className="ac-field__label">{intl.formatMessage({ id: "billing.aiCredit.detail.quietEnd" })}</span>
              <input
                className="ac-time"
                type="time"
                value={quietHoursEnd}
                onChange={(e) => setQuietHoursEnd(e.target.value)}
                disabled={!advancedSettingsReady || saveSettings.isPending}
              />
            </label>
          </div>

          <div className="ac-control-row">
            <span className="ac-control-row__main">
              <span className="ac-control-row__title">{intl.formatMessage({ id: "billing.aiCredit.detail.scheduleTitle" })}</span>
              <span className="ac-control-row__sub">{intl.formatMessage({ id: "billing.aiCredit.detail.scheduleDescription" })}</span>
            </span>
            <button
              type="button"
              className="ac-toggle"
              aria-label={intl.formatMessage({ id: "billing.aiCredit.detail.scheduleTitle" })}
              aria-pressed={allowScheduleActions}
              onClick={() => setAllowScheduleActions((v) => !v)}
              disabled={!advancedSettingsReady || saveSettings.isPending}
              data-progress-owner="advanced-save"
              style={{ background: allowScheduleActions ? "var(--hy-accent-cta)" : "var(--line-soft)" }}
            >
              <span className="ac-toggle__knob" style={{ left: allowScheduleActions ? 22 : 2 }} />
            </button>
          </div>

          <div className="ac-control-row">
            <span className="ac-control-row__main">
              <span className="ac-control-row__title">{intl.formatMessage({ id: "billing.aiCredit.detail.contactTitle" })}</span>
              <span className="ac-control-row__sub">{intl.formatMessage({ id: "billing.aiCredit.detail.contactDescription" })}</span>
            </span>
            <button
              type="button"
              className="ac-toggle"
              aria-label={intl.formatMessage({ id: "billing.aiCredit.detail.contactTitle" })}
              aria-pressed={allowContactActions}
              onClick={() => setAllowContactActions((v) => !v)}
              disabled={!advancedSettingsReady || saveSettings.isPending}
              data-progress-owner="advanced-save"
              style={{ background: allowContactActions ? "var(--hy-accent-cta)" : "var(--line-soft)" }}
            >
              <span className="ac-toggle__knob" style={{ left: allowContactActions ? 22 : 2 }} />
            </button>
          </div>

          {/* 아이가 구석의 버튼을 지나치지 않도록 친구가 가끔 커지며 부른다 — 부담스러우면 끈다. */}
          <div className="ac-control-row">
            <span className="ac-control-row__main">
              <span className="ac-control-row__title">{intl.formatMessage({ id: "billing.aiCredit.detail.buddyAttentionTitle" })}</span>
              <span className="ac-control-row__sub">{intl.formatMessage({ id: "billing.aiCredit.detail.buddyAttentionDescription" })}</span>
            </span>
            <button
              type="button"
              className="ac-toggle"
              aria-label={intl.formatMessage({ id: "billing.aiCredit.detail.buddyAttentionTitle" })}
              aria-pressed={buddyAttentionEnabled}
              onClick={() => setBuddyAttentionEnabled((v) => !v)}
              disabled={!advancedSettingsReady || saveSettings.isPending}
              data-progress-owner="advanced-save"
              style={{ background: buddyAttentionEnabled ? "var(--hy-accent-cta)" : "var(--line-soft)" }}
            >
              <span className="ac-toggle__knob" style={{ left: buddyAttentionEnabled ? 22 : 2 }} />
            </button>
          </div>

          <button
            type="button"
            className="ac-save-detail hy-press"
            onClick={saveAdvancedSettings}
            disabled={!advancedSettingsReady || saveSettings.isPending}
            aria-busy={advancedSettingsSaving}
          >
            {advancedSettingsSaving
              ? intl.formatMessage({ id: "billing.aiCredit.detail.saving" })
              : intl.formatMessage({ id: "billing.aiCredit.detail.save" })}
          </button>
        </section>

        {/* 잔액 부족 알림 — 자동 결제는 하지 않고, 보호자 확인 후 직접 충전하도록 안내한다. */}
        <div className="ac-auto">
          <span className="ac-auto__icon"><BellRing size={20} strokeWidth={2.2} color="var(--mint-text)" /></span>
          <span className="ac-auto__main">
            <span className="ac-auto__title">{intl.formatMessage({ id: "billing.aiCredit.lowAlert.title" })}</span>
            <span className="ac-auto__sub">
              {intl.formatMessage({
                id: lowCreditAlert
                  ? "billing.aiCredit.lowAlert.enabledDescription"
                  : "billing.aiCredit.lowAlert.disabledDescription",
              })}
            </span>
          </span>
          <button
            type="button"
            className="ac-toggle"
            aria-label={intl.formatMessage({ id: "billing.aiCredit.lowAlert.title" })}
            aria-pressed={lowCreditAlert}
            onClick={() => {
              setLowCreditAlert((v) => {
                show(intl.formatMessage({
                  id: !v ? "billing.aiCredit.lowAlert.enabledToast" : "billing.aiCredit.lowAlert.disabledToast",
                }), "🔔");
                return !v;
              });
            }}
            disabled={!childUserId}
            style={{ background: lowCreditAlert ? "var(--hy-accent-cta)" : "var(--line-soft)" }}
          >
            <span className="ac-toggle__knob" style={{ left: lowCreditAlert ? 22 : 2 }} />
          </button>
        </div>

        <div className="ac-footer">
          {intl.formatMessage({ id: "billing.aiCredit.footer" })}
        </div>
      </div>
      <PremiumUpsell
        open={aiLimitUpsellOpen}
        source="ai_friend_limit"
        tier={commercialTier}
        returnTo="/ai-credit"
        onClose={() => setAiLimitUpsellOpen(false)}
        onUpgrade={({ source, feature, returnTo }) => {
          const storage = browserPremiumReturnIntentStorage();
          const saved = storage && returnTo
            ? savePremiumReturnIntent(storage, { source, feature, returnTo })
            : false;
          if (!saved) throw new Error(intl.formatMessage({ id: "billing.aiCredit.returnError" }));
          setAiLimitUpsellOpen(false);
          navigate("/subscription");
        }}
      />
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
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
  tag?: string;
  per: string;
  ring: string;
  webPack?: WebAiCreditPack;
};

type SettingsSaveAction = "ai-toggle" | "limit-decrease" | "limit-increase" | "advanced" | null;

const CREDIT_PACKS: CreditPack[] = [
  {
    id: "p30",
    backendAmount: 30,
    per: "가볍게 시작하기 좋아요",
    ring: "1px solid rgba(32,26,29,.06)",
  },
  {
    id: "p80",
    backendAmount: 80,
    tag: "인기",
    per: "한 달 넉넉하게 써요",
    ring: "2px solid #B79DFB",
  },
  {
    id: "p200",
    backendAmount: 200,
    tag: "최대 혜택",
    per: "가장 넉넉한 크레딧",
    ring: "1px solid rgba(32,26,29,.06)",
  },
];

const CREDIT_PACK_PRESENTATION: Readonly<Record<30 | 80 | 200, Pick<CreditPack, "tag" | "per" | "ring">>> = {
  30: {
    per: "가볍게 시작하기 좋아요",
    ring: "1px solid rgba(32,26,29,.06)",
  },
  80: {
    tag: "인기",
    per: "한 달 넉넉하게 써요",
    ring: "2px solid #B79DFB",
  },
  200: {
    tag: "최대 혜택",
    per: "가장 넉넉한 크레딧",
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
    error.message === "web_ai_credit_reconciliation_pending"
    || error.message === "web_ai_credit_processing"
    || error.message === "web_ai_credit_payment_unknown"
    || error.message === "web_ai_credit_lookup_retry_later"
    || error.message === "web_ai_credit_lookup_rate_limited"
  ) return true;
  return error.status >= 500;
}

function webAiCreditFailureMessage(error: unknown): string {
  if (isApiError(error)) {
    if (error.message === "web_ai_credit_new_checkouts_paused") {
      return "새 크레딧 결제를 잠시 중단했어요. 진행 중인 결제 확인은 계속할 수 있어요.";
    }
    if (error.message === "web_ai_credit_payment_refunded") {
      return "결제가 전액 취소되어 크레딧을 충전하지 않았어요.";
    }
    if (error.message === "web_ai_credit_payment_failed" || error.status === 402) {
      return "결제가 승인되지 않았어요. 카드 정보를 확인하고 다시 시도해 주세요.";
    }
    if (error.status === 400 || error.status === 403) {
      return "주문 정보가 현재 가족·아이 정보와 일치하지 않아 충전하지 않았어요.";
    }
  }
  if (error instanceof Error && error.message === "web_billing_session_storage_unavailable") {
    return "이 브라우저에서는 안전한 결제 복귀 정보를 저장할 수 없어요.";
  }
  return "결제를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.";
}

export function AiCredit() {
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
  const { activeChild, familyLoading } = useActiveChild();
  const childUserId = activeChild?.user_id ?? null;
  const childName = activeChild?.name || "우리 아이";

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
        onSuccess: () => show(!aiEnabled ? "AI 친구를 켰어요" : "AI 친구를 껐어요", "🤖"),
        onError: () => show("설정 저장에 실패했어요", "⚠️"),
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
    });
    setSettingsSaveAction("advanced");
    saveSettings.mutate(
      { childUserId, patch: { ai_enabled: aiEnabled, daily_limit: dailyLimit, ...patch } },
      {
        onSuccess: () => show("AI 친구 상세 설정을 저장했어요", "🤖"),
        onError: () => show("설정 저장에 실패했어요", "⚠️"),
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
        onError: () => show("설정 저장에 실패했어요", "⚠️"),
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
    show(`${childName} 크레딧이 ${heroAmount}회 남았어요`, "💜");
  }, [childName, childUserId, heroAmount, lowCreditAlert, show]);

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
            ? `${result.debtApplied}회는 환불 사용분에 상계하고 ${result.availableCreditsAdded}회를 사용할 수 있어요`
            : `${input.pending.credits}회를 충전했어요`,
          "💜",
        );
        return;
      }

      setWebReconciliationPending(true);
      if (!webPendingToastShownRef.current) {
        webPendingToastShownRef.current = true;
        show("결제 승인 결과를 확인하고 있어요. 같은 주문을 안전하게 다시 확인할 수 있어요.", "💜");
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
          show("결제 승인 결과를 확인하고 있어요. 같은 주문을 안전하게 다시 확인할 수 있어요.", "💜");
        }
      } else {
        if (input.storage) clearPendingWebAiCreditCheckout(input.storage);
        setWebReconciliationPending(false);
        webPendingToastShownRef.current = false;
        show(webAiCreditFailureMessage(error), "💜");
      }
    } finally {
      webCompletionInFlightRef.current = false;
      setBusyPack(null);
    }
  }, [qc, show]);

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
          ? "결제를 취소했어요. 크레딧은 충전되지 않았어요."
          : "결제가 승인되지 않았어요. 카드 정보를 확인하고 다시 시도해 주세요.",
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
        show("안전한 주문 정보를 확인하지 못해 크레딧을 충전하지 않았어요.", "💜");
        return;
      }
      setWebReconciliationPending(true);
      void finishWebAiCredit({ pending: currentPending, storage });
      return;
    }

    if (pending && !currentPending) {
      setWebReconciliationPending(true);
      show("현재 가족·아이의 주문 정보와 일치하지 않아 크레딧을 충전하지 않았어요.", "💜");
      return;
    }
    if (currentPending) {
      if (
        currentPending.orderId !== billingRedirect.orderId
        || currentPending.amount !== billingRedirect.amount
      ) {
        setWebReconciliationPending(true);
        show("결제 결과가 시작한 주문과 일치하지 않아 자동 충전을 중단했어요.", "💜");
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
        show("안전한 주문 정보를 확인하지 못해 크레딧을 충전하지 않았어요.", "💜");
      }
    })();
  }, [billingRedirect, childUserId, familyId, finishWebAiCredit, show]);

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
      show("다시 확인할 결제 주문이 없어요.", "💜");
      return;
    }
    void finishWebAiCredit({ pending, storage });
  };

  // 자동 실행 금지: 실제 새 결제는 팩 버튼 onClick에서만 시작한다.
  // Android는 Google Play, PWA는 서버 확정 카탈로그의 Toss 일회성 결제를 사용한다.
  const buy = async (p: CreditPack) => {
    if (!aiCreditDataReady) {
      show("크레딧과 아이 설정을 확인한 뒤 다시 시도해 주세요.", "⚠️");
      return;
    }
    if (!familyId || !childUserId) {
      show("충전할 아이를 먼저 연결해 주세요", "💜");
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
        throw new Error("이 기기에서 Google Play 결제를 사용할 수 없어요.");
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
          ? `${purchase.debtApplied}회는 환불 사용분에 상계하고 ${purchase.availableCreditsAdded}회를 사용할 수 있어요`
          : `${p.backendAmount}회를 충전했어요`,
        "💜",
      );
    } catch (error) {
      show(
        isWebBillingChannel
          ? webAiCreditFailureMessage(error)
          : error instanceof Error ? error.message : "충전에 실패했어요",
        "💜",
      );
    } finally {
      setBusyPack(null);
    }
  };

  if (!childUserId && familyLoading) {
    return (
      <ScreenQueryState
        screenTitle="AI 크레딧"
        state="loading"
        heading="가족 정보를 불러오는 중이에요"
        description="연결된 아이를 확인하고 있어요."
        onBack={() => navigate(-1)}
      />
    );
  }

  if (!childUserId) {
    return (
      <ScreenQueryState
        screenTitle="AI 크레딧"
        state="empty"
        heading="연결된 아이가 없어요"
        description="AI 크레딧을 확인하거나 충전하려면 먼저 아이를 연결해 주세요."
        onBack={() => navigate(-1)}
        onRetry={() => navigate("/child-invite")}
        retryLabel="아이 연결하기"
      />
    );
  }

  if (aiCreditQueryState === "loading") {
    return (
      <ScreenQueryState
        screenTitle="AI 크레딧"
        state="loading"
        heading="크레딧과 아이 설정을 확인하고 있어요"
        description="잔액과 AI 친구 설정을 안전하게 불러오는 중이에요."
        onBack={() => navigate(-1)}
      />
    );
  }

  if (aiCreditQueryState === "error" || aiCreditDataMissing) {
    return (
      <ScreenQueryState
        screenTitle="AI 크레딧"
        state="error"
        heading="AI 크레딧 정보를 확인하지 못했어요"
        description="확인되지 않은 잔액으로 결제하거나 설정을 바꾸지 않도록 잠시 닫았어요."
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
          aria-label="뒤로"
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} strokeWidth={2.2} color="#4A4145" />
        </button>
        <span className="ac-title">AI 크레딧</span>
      </div>

      <div className="hy-content ac-content">
        {aiCreditDataEmpty && (
          <div className="sqs-inline-empty">
            아직 기록이 없어요. 기본 설정으로 시작할 수 있어요.
          </div>
        )}
        {/* 잔액 히어로 */}
        <div className="ac-hero">
          <span className="ac-hero__sheen" />
          <span className="ac-hero__mascot">
            <img src={asset("mascot/wave.webp")} alt="" />
          </span>
          <div className="ac-hero__label">{childName}의 남은 크레딧</div>
          <div className="ac-hero__amount">
            <span className="ac-hero__num">{heroAmount != null ? heroAmount : "—"}</span>
            <span className="ac-hero__unit">회</span>
          </div>
          <div className="ac-hero__badge">
            <Sparkles size={13} strokeWidth={2.2} aria-hidden="true" />
            AI가 아이의 일정·안전 대화를 도와요
          </div>
        </div>

        {/* 안내 */}
        <div className="ac-note hy-explain">
          <span className="ac-note__emoji"><MessageCircle size={15} strokeWidth={2.2} /></span>
            <span className="hy-explain__lines">
              <span className="hy-explain__line">일정·안전 대화에 크레딧 1회가 사용돼요.</span>
              <span className="hy-explain__line">필요할 때 충전해 주세요.</span>
          </span>
        </div>

        {/* 충전팩 */}
        <div>
          <div className="ac-packs__label">크레딧 충전</div>
          {isWebBillingChannel && webCatalogQuery.isLoading && (
            <div className="sqs-inline-empty" role="status">
              결제 가능한 크레딧 팩과 가격을 확인하고 있어요.
            </div>
          )}
          {isWebBillingChannel && webCatalogQuery.isError && (
            <div className="sqs-inline-empty" role="status">
              가격을 확인하지 못해 결제 팩을 잠시 숨겼어요. 잔액과 무료 기능은 그대로예요.
            </div>
          )}
          {isWebBillingChannel
            && !webCatalogQuery.isLoading
            && !webCatalogQuery.isError
            && (!webCatalog?.configured || webCatalog.packs.length === 0) && (
            <div className="sqs-inline-empty" role="status">
              AI 크레딧 팩 가격을 확정하고 있어요. 가격이 준비된 팩만 이 화면에 표시됩니다.
            </div>
          )}
          {(creditStatus?.purchasedCreditDebt ?? 0) > 0 && (
            <div className="sqs-inline-empty" role="status">
              환불된 크레딧을 이미 사용한 {creditStatus?.purchasedCreditDebt}회는 다음 충전에서 먼저 상계돼요.
              팩마다 실제로 늘어나는 사용 가능 횟수를 확인해 주세요.
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
                    <span className="ac-pack__amt">{p.backendAmount}회</span>
                    {p.tag && <span className="ac-pack__tag">{p.tag}</span>}
                  </span>
                  <span className="ac-pack__per">{p.per}</span>
                  {debtImpact.debtApplied > 0 && (
                    <span className="ac-pack__per">
                      {debtImpact.availableCreditsAdded > 0
                        ? `이번 ${p.backendAmount}회 중 ${debtImpact.debtApplied}회 상계 · ${debtImpact.availableCreditsAdded}회 사용 가능`
                        : `이번 ${p.backendAmount}회 전부 상계 · 남은 상계분 ${debtImpact.remainingDebt}회`}
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
                    ? `${p.backendAmount}회 ${p.webPack?.displayPrice ?? "가격 확인"} 결제`
                    : `${p.backendAmount}회 가격 Google Play에서 확인`}
                >
                  {busyPack === p.id
                    ? "확인 중…"
                    : isWebBillingChannel
                      ? p.webPack?.displayPrice ?? "가격 확인"
                      : isBillingAvailable() ? "가격 확인" : "결제 불가"}
                </button>
                </div>
              );
            })}
          </div>
          {isWebBillingChannel && webReconciliationPending && (
            <div className="sqs-inline-empty" role="status">
              <span>이전 결제의 승인 결과를 확인하고 있어요.</span>{" "}
              <button
                type="button"
                className="ac-buy hy-press"
                onClick={retryWebAiCreditReconciliation}
                disabled={busyPack !== null}
                aria-busy={busyPack !== null}
              >
                결제 결과 다시 확인
              </button>
            </div>
          )}
        </div>

        {commercialIsPremium === false && (
          <section className="ac-premium-callout" aria-label="AI 친구 프리미엄 안내">
            <div>
              <strong>{freeLimitExhaustionReason === "free_included_limit" ? "오늘 무료 5회를 모두 사용했어요" : "무료 하루 5회 · 프리미엄 하루 20회"}</strong>
              <p>{freeLimitExhaustionReason === "parent_safety_limit"
                ? `현재 부모 설정은 하루 ${publicStatus?.parentDailyLimit ?? 0}회예요. 아래에서 안전 상한을 조정할 수 있어요.`
                : "프리미엄은 아이별 AI 친구 대화를 하루 20회 기본 제공해요. 추가 크레딧 팩과는 별도예요."}</p>
            </div>
            <button
              type="button"
              className="ac-premium-callout__cta hy-press"
              onClick={() => setAiLimitUpsellOpen(true)}
            >
              하루 20회로 늘리기
            </button>
          </section>
        )}

        {/* AI 친구 켜기 + 하루 대화 한도(부모 설정 — 꺼져 있으면 아이가 대화 불가) */}
        <div className="ac-auto">
          <span className="ac-auto__icon"><Bot size={20} strokeWidth={2.2} color="var(--mint-text)" /></span>
          <span className="ac-auto__main">
            <span className="ac-auto__title">AI 친구 대화 허용</span>
            <span className="ac-auto__sub">
              {aiEnabled
                ? dailyLimit != null
                  ? `켜짐 · 하루 ${dailyLimit}회까지`
                  : "켜짐 · 하루 한도 확인 중"
                : "꺼짐 · 아이가 AI 친구와 대화할 수 없어요"}
            </span>
          </span>
          <button
            type="button"
            className="ac-toggle"
            aria-label="AI 친구 대화 허용"
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
              <span className="ac-auto__title">하루 대화 한도</span>
              <span className="ac-auto__sub">무료 포함분 기준 · 초과분은 크레딧 사용</span>
            </span>
            <span className="ac-limit">
              <button
                type="button"
                className="ac-limit__btn hy-press"
                aria-label="한도 줄이기"
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
                aria-label="한도 늘리기"
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
              Premium 기본 20회로 설정
            </button>
          )}
          </div>
        )}

        <section className="ac-detail" aria-busy={!advancedSettingsReady}>
          <div className="ac-detail__head">
            <div>
              <div className="ac-detail__title">AI 친구 상세 제어</div>
              <div className="ac-detail__sub">{childName}에게 적용되는 부모 설정이에요</div>
            </div>
          </div>

          <label className="ac-field">
            <span className="ac-field__label">금지 주제</span>
            <textarea
              className="ac-textarea"
              value={forbiddenTopicsText}
              onChange={(e) => setForbiddenTopicsText(e.target.value)}
              placeholder="예: 게임 결제, 모르는 사람, 무서운 이야기"
              rows={3}
              disabled={!advancedSettingsReady || saveSettings.isPending}
            />
            <span className="ac-field__hint hy-explain">쉼표나 줄바꿈으로 여러 주제를 입력할 수 있어요.</span>
          </label>

          <div className="ac-control-row">
            <span className="ac-control-row__main">
              <span className="ac-control-row__title">선제 대화</span>
              <span className="ac-control-row__sub">일정이나 안내가 있을 때 먼저 말을 걸어요</span>
            </span>
            <button
              type="button"
              className="ac-toggle"
              aria-label="선제 대화"
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
              <span className="ac-field__label">선제 대화 시작</span>
              <input
                className="ac-time"
                type="time"
                value={proactiveStartTime}
                onChange={(e) => setProactiveStartTime(e.target.value)}
                disabled={!advancedSettingsReady || saveSettings.isPending || !proactiveEnabled}
              />
            </label>
            <label className="ac-field">
              <span className="ac-field__label">선제 대화 종료</span>
              <input
                className="ac-time"
                type="time"
                value={proactiveEndTime}
                onChange={(e) => setProactiveEndTime(e.target.value)}
                disabled={!advancedSettingsReady || saveSettings.isPending || !proactiveEnabled}
              />
            </label>
            <label className="ac-field">
              <span className="ac-field__label">조용한 시간 시작</span>
              <input
                className="ac-time"
                type="time"
                value={quietHoursStart}
                onChange={(e) => setQuietHoursStart(e.target.value)}
                disabled={!advancedSettingsReady || saveSettings.isPending}
              />
            </label>
            <label className="ac-field">
              <span className="ac-field__label">조용한 시간 종료</span>
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
              <span className="ac-control-row__title">일정 조작 허용</span>
              <span className="ac-control-row__sub">아이 일정의 조회·추가·수정을 도와요</span>
            </span>
            <button
              type="button"
              className="ac-toggle"
              aria-label="일정 조작 허용"
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
              <span className="ac-control-row__title">연락 동작 허용</span>
              <span className="ac-control-row__sub">부모님께 전화·메시지 요청을 도와요</span>
            </span>
            <button
              type="button"
              className="ac-toggle"
              aria-label="연락 동작 허용"
              aria-pressed={allowContactActions}
              onClick={() => setAllowContactActions((v) => !v)}
              disabled={!advancedSettingsReady || saveSettings.isPending}
              data-progress-owner="advanced-save"
              style={{ background: allowContactActions ? "var(--hy-accent-cta)" : "var(--line-soft)" }}
            >
              <span className="ac-toggle__knob" style={{ left: allowContactActions ? 22 : 2 }} />
            </button>
          </div>

          <button
            type="button"
            className="ac-save-detail hy-press"
            onClick={saveAdvancedSettings}
            disabled={!advancedSettingsReady || saveSettings.isPending}
            aria-busy={advancedSettingsSaving}
          >
            {advancedSettingsSaving ? "저장 중…" : "상세 설정 저장"}
          </button>
        </section>

        {/* 잔액 부족 알림 — 자동 결제는 하지 않고, 보호자 확인 후 직접 충전하도록 안내한다. */}
        <div className="ac-auto">
          <span className="ac-auto__icon"><BellRing size={20} strokeWidth={2.2} color="var(--mint-text)" /></span>
          <span className="ac-auto__main">
            <span className="ac-auto__title">잔액 부족 알림</span>
            <span className="ac-auto__sub">
              {lowCreditAlert ? "3회 이하가 되면 이 화면에서 알려드려요" : "크레딧이 부족할 때 확인할 수 있어요"}
            </span>
          </span>
          <button
            type="button"
            className="ac-toggle"
            aria-label="잔액 부족 알림"
            aria-pressed={lowCreditAlert}
            onClick={() => {
              setLowCreditAlert((v) => {
                show(!v ? "잔액 부족 알림을 켰어요" : "잔액 부족 알림을 껐어요", "🔔");
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
          사용하지 않은 크레딧은 차감되지 않아요 · 안전한 대화를 위해 대화 내용은 요약만 보관돼요
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
          if (!saved) throw new Error("AI 친구 화면으로 돌아올 경로를 보관하지 못했어요. 잠시 후 다시 시도해 주세요.");
          setAiLimitUpsellOpen(false);
          navigate("/subscription");
        }}
      />
    </div>
  );
}

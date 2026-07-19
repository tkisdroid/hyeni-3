import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { BellRing, Bot, ChevronLeft, Hash, MessageCircle, Sparkles } from "lucide-react";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { useAuth } from "@/auth/AuthContext";
import { useActiveChild } from "@/app/activeChild";
import { useAiCredits, useAiFriendSettings, useSaveAiFriendSettings } from "@/queries/useAi";
import { qk } from "@/queries/keys";
import { isBillingAvailable, launchCreditPurchase } from "@/lib/native/billing";
import { creditHeroAmount } from "@/transform/aiView";
import {
  aiTopicsToText,
  buildAiFriendControlPatch,
  normalizeAiControlTime,
} from "@/transform/aiFriendSettingsForm";
import { ScreenQueryState } from "@/components/ui/ScreenQueryState";
import { resolveQueryTruthState } from "@/transform/queryTruthState";
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
};

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

export function AiCredit() {
  const navigate = useNavigate();
  const { show } = useToast();
  const { userId, familyId } = useAuth();
  const qc = useQueryClient();

  // 크레딧은 자녀별 — 전역 활성 아이(홈 스위치) 기준. 스위치 전환 시 대상 아이도 함께 바뀐다.
  const { activeChild } = useActiveChild();
  const childUserId = activeChild?.user_id ?? null;
  const childName = activeChild?.name || "우리 아이";

  const creditQuery = useAiCredits(childUserId);
  const creditStatus = creditQuery.data;
  const heroAmount = creditStatus
    ? creditHeroAmount(creditStatus)
    : creditStatus === null
      ? 0
      : null;

  // AI 대화 켜기/하루 한도(부모 설정, ai_parent_settings) — 이 설정이 없으면 아이 채팅이 403.
  const friendSettingsQuery = useAiFriendSettings(childUserId);
  const friendSettings = friendSettingsQuery.data;
  const aiCreditQueryState = resolveQueryTruthState([
    { isLoading: creditQuery.isLoading, isError: creditQuery.isError },
    { isLoading: friendSettingsQuery.isLoading, isError: friendSettingsQuery.isError },
  ]);
  const aiCreditDataMissing = aiCreditQueryState === "ready"
    && !!childUserId
    && (creditStatus === undefined || friendSettings === undefined);
  const aiCreditDataReady = aiCreditQueryState === "ready"
    && !!childUserId
    && !aiCreditDataMissing;
  const aiCreditDataEmpty = aiCreditDataReady
    && (creditStatus === null || friendSettings === null);
  const aiCreditRefetching = creditQuery.isFetching || friendSettingsQuery.isFetching;
  const retryAiCredit = async (): Promise<void> => {
    await Promise.all([creditQuery.refetch(), friendSettingsQuery.refetch()]);
  };
  const saveSettings = useSaveAiFriendSettings();
  const aiEnabled = friendSettings?.ai_enabled ?? false;
  const dailyLimit = friendSettings?.daily_limit ?? 5;
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
    saveSettings.mutate(
      { childUserId, patch: { ai_enabled: !aiEnabled } },
      {
        onSuccess: () => show(!aiEnabled ? "AI 친구를 켰어요" : "AI 친구를 껐어요", "🤖"),
        onError: () => show("설정 저장에 실패했어요", "⚠️"),
      },
    );
  };
  const saveAdvancedSettings = () => {
    if (!advancedSettingsReady || !childUserId || saveSettings.isPending) return;
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
    saveSettings.mutate(
      { childUserId, patch: { ai_enabled: aiEnabled, daily_limit: dailyLimit, ...patch } },
      {
        onSuccess: () => show("AI 친구 상세 설정을 저장했어요", "🤖"),
        onError: () => show("설정 저장에 실패했어요", "⚠️"),
      },
    );
  };
  const changeDailyLimit = (delta: number) => {
    if (!aiCreditDataReady || !childUserId || saveSettings.isPending) return;
    const next = Math.min(100, Math.max(1, dailyLimit + delta));
    if (next === dailyLimit) return;
    saveSettings.mutate(
      { childUserId, patch: { daily_limit: next } },
      { onError: () => show("설정 저장에 실패했어요", "⚠️") },
    );
  };

  // 결제 가능 여부(네이티브 Android 만 true). 웹(PWA)에서는 결제 버튼을 비활성화한다.
  const billingAvailable = isBillingAvailable();

  const [busyPack, setBusyPack] = useState<string | null>(null);
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

  // 결제 CTA — 네이티브(Android)면 Google Play Billing(인앱)으로 실제 결제.
  // 웹(PWA)에서는 버튼이 disabled 라 여기까지 오지 않는다(방어적으로 가드 유지).
  // 자동 실행 금지: 팩 버튼 onClick 에서만 호출된다. 잔액 정본은 서버.
  const buy = async (p: CreditPack) => {
    if (!aiCreditDataReady) {
      show("크레딧과 아이 설정을 확인한 뒤 다시 시도해 주세요.", "⚠️");
      return;
    }
    if (!billingAvailable) {
      show(`${p.backendAmount}회 충전은 안드로이드 앱에서 가능해요`, "🤖");
      return;
    }
    if (!familyId || !childUserId) {
      show("충전할 아이를 먼저 연결해 주세요", "💜");
      return;
    }
    if (busyPack) return;
    setBusyPack(p.id);
    try {
      await launchCreditPurchase({
        familyId,
        childUserId,
        parentId: userId,
        amount: p.backendAmount,
      });
      // 충전 성공 → 크레딧 캐시 무효화로 잔액 히어로를 갱신한다.
      await qc.invalidateQueries({ queryKey: qk.aiCredits(familyId) });
      show(`${p.backendAmount}회를 충전했어요`, "💜");
    } catch (error) {
      show(error instanceof Error ? error.message : "충전에 실패했어요", "💜");
    } finally {
      setBusyPack(null);
    }
  };

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
            아직 크레딧 또는 AI 친구 설정 기록이 없어요. 현재 안전한 기본값부터 시작할 수 있어요.
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
            AI가 아이의 일정, 안전을 도와줘요
          </div>
        </div>

        {/* 안내 */}
        <div className="ac-note">
          <span className="ac-note__emoji"><MessageCircle size={15} strokeWidth={2.2} /></span>
          AI가 아이의 일정·안전 대화를 도울 때 크레딧 1회가 사용돼요. 부모님이 충전해 주세요.
        </div>

        {/* 충전팩 */}
        <div>
          <div className="ac-packs__label">크레딧 충전</div>
          <div className="ac-packs__list">
            {CREDIT_PACKS.map((p) => (
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
                </span>
                <button
                  type="button"
                  className="ac-buy hy-press"
                  onClick={() => buy(p)}
                  disabled={!billingAvailable || busyPack !== null}
                  aria-label={`${p.backendAmount}회 가격 Google Play에서 확인`}
                >
                  {!billingAvailable ? "앱에서 결제" : busyPack === p.id ? "결제 중…" : "가격 확인"}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* AI 친구 켜기 + 하루 대화 한도(부모 설정 — 꺼져 있으면 아이가 대화 불가) */}
        <div className="ac-auto">
          <span className="ac-auto__icon"><Bot size={20} strokeWidth={2.2} color="var(--mint-text)" /></span>
          <span className="ac-auto__main">
            <span className="ac-auto__title">AI 친구 대화 허용</span>
            <span className="ac-auto__sub">
              {aiEnabled ? `켜짐 · 하루 ${dailyLimit}회까지` : "꺼짐 · 아이가 AI 친구와 대화할 수 없어요"}
            </span>
          </span>
          <button
            type="button"
            className="ac-toggle"
            aria-label="AI 친구 대화 허용"
            aria-pressed={aiEnabled}
            onClick={toggleAiEnabled}
            disabled={saveSettings.isPending || !childUserId}
            style={{ background: aiEnabled ? "var(--hy-accent)" : "var(--line-soft)" }}
          >
            <span className="ac-toggle__knob" style={{ left: aiEnabled ? 22 : 2 }} />
          </button>
        </div>
        {aiEnabled && (
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
              >
                −
              </button>
              <span className="ac-limit__num">{dailyLimit}</span>
              <button
                type="button"
                className="ac-limit__btn hy-press"
                aria-label="한도 늘리기"
                onClick={() => changeDailyLimit(5)}
                disabled={saveSettings.isPending}
              >
                +
              </button>
            </span>
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
            <span className="ac-field__hint">쉼표나 줄바꿈으로 여러 주제를 입력할 수 있어요.</span>
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
              style={{ background: proactiveEnabled ? "var(--hy-accent)" : "var(--line-soft)" }}
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
              <span className="ac-control-row__sub">AI가 아이 일정 조회·추가·수정을 도울 수 있어요</span>
            </span>
            <button
              type="button"
              className="ac-toggle"
              aria-label="일정 조작 허용"
              aria-pressed={allowScheduleActions}
              onClick={() => setAllowScheduleActions((v) => !v)}
              disabled={!advancedSettingsReady || saveSettings.isPending}
              style={{ background: allowScheduleActions ? "var(--hy-accent)" : "var(--line-soft)" }}
            >
              <span className="ac-toggle__knob" style={{ left: allowScheduleActions ? 22 : 2 }} />
            </button>
          </div>

          <div className="ac-control-row">
            <span className="ac-control-row__main">
              <span className="ac-control-row__title">연락 동작 허용</span>
              <span className="ac-control-row__sub">AI가 부모에게 전화·메시지 요청을 도울 수 있어요</span>
            </span>
            <button
              type="button"
              className="ac-toggle"
              aria-label="연락 동작 허용"
              aria-pressed={allowContactActions}
              onClick={() => setAllowContactActions((v) => !v)}
              disabled={!advancedSettingsReady || saveSettings.isPending}
              style={{ background: allowContactActions ? "var(--hy-accent)" : "var(--line-soft)" }}
            >
              <span className="ac-toggle__knob" style={{ left: allowContactActions ? 22 : 2 }} />
            </button>
          </div>

          <button
            type="button"
            className="ac-save-detail hy-press"
            onClick={saveAdvancedSettings}
            disabled={!advancedSettingsReady || saveSettings.isPending}
          >
            {saveSettings.isPending ? "저장 중…" : "상세 설정 저장"}
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
            style={{ background: lowCreditAlert ? "var(--hy-accent)" : "var(--line-soft)" }}
          >
            <span className="ac-toggle__knob" style={{ left: lowCreditAlert ? 22 : 2 }} />
          </button>
        </div>

        <div className="ac-footer">
          사용하지 않은 크레딧은 차감되지 않아요 · 안전한 대화를 위해 대화 내용은 요약만 보관돼요
        </div>
      </div>
    </div>
  );
}

import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import {
  CalendarDays,
  ChevronLeft,
  MapPin,
  MessageCircle,
  ShieldCheck,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { useActiveChild } from "@/app/activeChild";
import { PremiumUpsell } from "@/components/PremiumUpsell";
import { useMyFamily } from "@/queries/useFamily";
import { useEvents } from "@/queries/useSchedule";
import { useDaySummary, useGenerateDaySummary } from "@/queries/useAi";
import { useEntitlement } from "@/queries/useEntitlement";
import type { DaySummarySignals, DaySummaryResult } from "@/lib/api/endpoints/ai";
import { formatTimeLabel } from "@/transform/scheduleView";
import { todayDateKey, dateKeyToDateInputValue, parseAppDateKey } from "@/transform/dateKey";
import { hasJongseong } from "@/transform/adventureMap";
import { canUse, FEATURES } from "@/transform/tierPolicy";
import {
  browserPremiumReturnIntentStorage,
  savePremiumReturnIntent,
} from "@/transform/premiumReturnIntent";
import { Loading } from "@/components/ui/Loading";
import type { SupportedLocale } from "@/i18n/locale";
import { useLocale } from "@/i18n/useLocale";
import "./DaySummary.css";

type RowTone = "info" | "safe" | "caution";
interface SummaryRow {
  key: string;
  icon: LucideIcon;
  text: string;
  sub?: string;
  tone: RowTone;
}

// 서버 신호(extractDaySummarySignals) → 요약 근거 행. 일정·체류·대화·안전을 종합한다.
function buildRows(signals: DaySummarySignals | null, locale: SupportedLocale): SummaryRow[] {
  if (!signals) return [];
  const rows: SummaryRow[] = [];
  (signals.events ?? []).slice(0, 4).forEach((e, i) => {
    rows.push({
      key: `ev-${i}`,
      icon: CalendarDays,
      text: e.title,
      sub: e.time ? formatTimeLabel(e.time, locale) : undefined,
      tone: "info",
    });
  });
  (signals.dwellPlaces ?? []).slice(0, 3).forEach((p, i) => {
    rows.push({ key: `dw-${i}`, icon: MapPin, text: p.title, sub: p.durationLabel || undefined, tone: "info" });
  });
  if ((signals.chatCount ?? 0) > 0) {
    rows.push({ key: "chat", icon: MessageCircle, text: `AI 친구와 ${signals.chatCount}번 이야기했어요`, tone: "info" });
  }
  const alertTotal =
    (signals.notArrived ?? 0) + (signals.dangerZone ?? 0) + (signals.sos ?? 0) + (signals.playdate ?? 0);
  if (alertTotal > 0) {
    const highlights = signals.alertHighlights ?? [];
    if (highlights.length > 0) {
      highlights.slice(0, 3).forEach((h, i) => rows.push({ key: `al-${i}`, icon: TriangleAlert, text: h, tone: "caution" }));
    } else {
      rows.push({ key: "al", icon: TriangleAlert, text: `안전 알림 ${alertTotal}건`, tone: "caution" });
    }
  } else {
    rows.push({ key: "safe", icon: ShieldCheck, text: "안전 알림 없이 잘 보냈어요", tone: "safe" });
  }
  return rows;
}

// 위험·SOS·미도착이 있으면 "주의" 하루로 헤로 톤을 바꾼다.
function isCautionDay(signals: DaySummarySignals | null): boolean {
  if (!signals) return false;
  return (signals.dangerZone ?? 0) + (signals.sos ?? 0) + (signals.notArrived ?? 0) > 0;
}

export function DaySummary() {
  const { locale } = useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const { show } = useToast();

  const state = (location.state ?? {}) as {
    childUserId?: string;
    childName?: string;
    dateKey?: string;
    premiumReturnDraft?: unknown;
  };
  const returnDraft = state.premiumReturnDraft && typeof state.premiumReturnDraft === "object"
    ? state.premiumReturnDraft as Record<string, unknown>
    : null;
  const requestedChildUserId = state.childUserId
    ?? (typeof returnDraft?.childUserId === "string" ? returnDraft.childUserId : undefined);
  const requestedDateKey = state.dateKey
    ?? (typeof returnDraft?.dateKey === "string" ? returnDraft.dateKey : undefined);

  // 크레딧·요약은 자녀별. state(딥링크) > 전역 활성 아이. state uid 가 현재 가족에 없으면
  // stale uid 로 생성하지 않도록 활성 아이로 폴백(첫 아이 하드코딩 제거 — AI 생성 오귀속 방지).
  const { data: family } = useMyFamily();
  const { activeChild: globalActive, familyLoading } = useActiveChild();
  const children = (family?.members ?? []).filter((m) => m.role === "child");
  const targetChild =
    (requestedChildUserId ? children.find((m) => m.user_id === requestedChildUserId) : undefined) ??
    globalActive ??
    null;
  const childUserId = targetChild?.user_id ?? null;
  const childName = targetChild?.name ?? state.childName ?? "우리 아이";

  // 앱 date_key(0-index 월) → ISO "YYYY-MM-DD"(서버 계약). 기본 = 오늘.
  const appDateKey = requestedDateKey && parseAppDateKey(requestedDateKey) ? requestedDateKey : todayDateKey();
  const isoDateKey = dateKeyToDateInputValue(appDateKey);
  const dateLabel = useMemo(() => {
    const d = parseAppDateKey(appDateKey);
    return d ? `${d.getMonth() + 1}월 ${d.getDate()}일` : "";
  }, [appDateKey]);

  // 생성 품질 향상용 clientSignals(그날 일정). 없으면 서버가 알림·대화만으로 요약.
  const { data: events } = useEvents();
  const clientSignals = useMemo(() => {
    const dayEvents = (events ?? [])
      .filter((e) => e.date_key === appDateKey)
      .map((e) => ({ title: e.title || "일정", time: e.time || "" }))
      .slice(0, 8);
    return dayEvents.length > 0 ? { events: dayEvents } : undefined;
  }, [events, appDateKey]);

  const entitlement = useEntitlement();
  const allowed = entitlement.ready && canUse(entitlement.tier, FEATURES.AI_ANALYSIS);
  const summaryQuery = useDaySummary(allowed ? childUserId : null, isoDateKey);
  const cached = summaryQuery.data;
  const isLoading = summaryQuery.isLoading;
  const isError = summaryQuery.isError;
  const refetchSummary = async () => {
    await summaryQuery.refetch();
  };
  const generate = useGenerateDaySummary();
  const [generated, setGenerated] = useState<DaySummaryResult | null>(null);
  const [upsellOpen, setUpsellOpen] = useState(false);

  const summary = generated?.summary ?? cached?.summary ?? "";
  const signals = generated?.signals ?? cached?.signals ?? null;
  const premiumLocked = (entitlement.ready && !allowed) || (generated ? !generated.premium : false);
  const isEmpty = generated ? generated.empty : false;
  const hasSummary = !!summary && !premiumLocked && !isEmpty;

  const rows = useMemo(() => buildRows(signals, locale), [locale, signals]);
  const caution = isCautionDay(signals);

  const onGenerate = () => {
    if (!allowed) {
      setUpsellOpen(true);
      return;
    }
    if (!childUserId || !isoDateKey || generate.isPending) return;
    generate.mutate(
      { childUserId, isoDateKey, clientSignals },
      {
        onSuccess: (res) => {
          if (!res.premium) {
            setGenerated(null);
            setUpsellOpen(true);
            return;
          }
          setGenerated(res);
        },
        onError: () => show("요약을 만들지 못했어요. 잠시 후 다시 시도해 주세요", "💜"),
      },
    );
  };

  return (
    <div className="ds-screen">
      <div className="ds-header">
        <button type="button" className="ds-back hy-press" aria-label="뒤로" onClick={() => navigate(-1)}>
          <ChevronLeft size={22} strokeWidth={2.2} color="#4A4145" />
        </button>
        <span className="ds-title">{childName}의 하루</span>
      </div>

      <div className="hy-content ds-content">
        {!childUserId && familyLoading ? (
          <div className="ds-panel">
            <Loading label="가족 정보를 불러오는 중" />
          </div>
        ) : !childUserId ? (
          <div className="ds-panel">
            <div className="ds-panel__art">
              <img src={asset("mascot/diary.webp")} alt="" />
            </div>
            <div className="ds-panel__title">연결된 아이가 없어요</div>
            <div className="ds-panel__desc">아이를 연결하면 AI 하루 요약을 볼 수 있어요.</div>
          </div>
        ) : !entitlement.ready && entitlement.isError ? (
          <div className="ds-panel" role="alert">
            <div className="ds-panel__art">
              <img src={asset("mascot/diary.webp")} alt="" />
            </div>
            <div className="ds-panel__title">구독 상태를 확인하지 못했어요</div>
            <div className="ds-panel__desc">확인되지 않은 상태에서는 AI 요약을 조회하거나 만들지 않아요.</div>
            <button type="button" className="ds-panel__cta hy-press" onClick={() => void entitlement.refetch()}>
              다시 확인하기
            </button>
          </div>
        ) : !entitlement.ready ? (
          <div className="ds-panel">
            <Loading label="구독 상태를 확인하는 중" />
          </div>
        ) : isError ? (
          <div className="ds-panel" role="alert">
            <div className="ds-panel__art">
              <img src={asset("mascot/diary.webp")} alt="" />
            </div>
            <div className="ds-panel__title">하루 요약을 불러오지 못했어요</div>
            <div className="ds-panel__desc">인터넷 연결을 확인한 뒤 다시 시도해 주세요.</div>
            <button type="button" className="ds-panel__cta hy-press" onClick={() => void refetchSummary()}>
              다시 시도
            </button>
          </div>
        ) : premiumLocked ? (
          <div className="ds-panel">
            <div className="ds-panel__art">
              <img src={asset("mascot/diary.webp")} alt="" />
            </div>
            <div className="ds-panel__title">프리미엄 기능이에요</div>
            <div className="ds-panel__desc">
              구독하시면 매일 AI가 정리한 {childName}의 하루 요약을 받아보실 수 있어요.
            </div>
            <button type="button" className="ds-panel__cta hy-press" onClick={() => setUpsellOpen(true)}>
              프리미엄 보기
            </button>
          </div>
        ) : hasSummary ? (
          <>
            <div className={`ds-hero${caution ? " ds-hero--caution" : ""}`}>
              <img className="ds-hero__mascot" src={asset("mascot/diary.webp")} alt="" />
              <div className="ds-hero__status">
                {caution ? "오늘은 살펴볼 일이 있었어요" : "안전하게 잘 보냈어요"}
              </div>
              <div className="ds-hero__date">{dateLabel} · AI 요약</div>
            </div>

            {rows.length > 0 && (
              <div className="ds-rows">
                {rows.map((r) => {
                  const RowIcon = r.icon;
                  return (
                    <div key={r.key} className={`ds-row ds-row--${r.tone}`}>
                      <span className="ds-row__icon" aria-hidden="true">
                        <RowIcon size={18} strokeWidth={2.2} />
                      </span>
                      <div className="ds-row__body">
                        <div className="ds-row__text">{r.text}</div>
                        {r.sub && <div className="ds-row__sub">{r.sub}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="ds-quote">“{summary}”</div>
            <div className="ds-foot">
              AI가 하루 데이터를 종합해 만들었어요 · 안전한 요약을 위해 대화는 주제만 반영돼요
            </div>
          </>
        ) : isEmpty ? (
          <div className="ds-panel">
            <div className="ds-panel__art">
              <img src={asset("mascot/diary.webp")} alt="" />
            </div>
            <div className="ds-panel__title">특별한 기록이 없어요</div>
            <div className="ds-panel__desc">
              {dateLabel}{hasJongseong(dateLabel) ? "은" : "는"} 조용히 지나갔어요. 일정이나 활동이
              쌓이면 요약이 만들어져요.
            </div>
          </div>
        ) : isLoading ? (
          <div className="ds-panel ds-panel--skel" role="status" aria-label="하루 요약을 불러오는 중">
            <span className="hy-skel ds-skel__art" aria-hidden="true" />
            <span className="hy-skel-lines ds-skel__lines" aria-hidden="true">
              <span className="hy-skel hy-skel--line hy-skel--line-lg" />
              <span className="hy-skel hy-skel--line" />
              <span className="hy-skel hy-skel--line" />
            </span>
          </div>
        ) : (
          <div className="ds-panel">
            <div className="ds-panel__art">
              <img src={asset("mascot/diary.webp")} alt="" />
            </div>
            <div className="ds-panel__title">
              {dateLabel} · {childName}의 하루
            </div>
            <div className="ds-panel__desc">
              AI가 일정·위치·리워드·안전 이벤트를 종합해 하루 요약을 만들어 드려요. 프리미엄 기능이에요.
            </div>
            <button
              type="button"
              className="ds-panel__cta hy-press"
              onClick={onGenerate}
              disabled={generate.isPending} aria-busy={generate.isPending}
            >
              {generate.isPending ? "요약 만드는 중…" : "AI 하루 요약 만들기"}
            </button>
          </div>
        )}
      </div>
      <PremiumUpsell
        open={upsellOpen}
        source="ai_daily_summary"
        tier={entitlement.tier}
        returnTo="/day-summary"
        onClose={() => setUpsellOpen(false)}
        onUpgrade={({ source, feature, returnTo }) => {
          const storage = browserPremiumReturnIntentStorage();
          const saved = storage && returnTo
            ? savePremiumReturnIntent(storage, {
                source,
                feature,
                returnTo,
                draft: { childUserId, dateKey: appDateKey },
              })
            : false;
          if (!saved) throw new Error("요약 대상과 날짜를 안전하게 보관하지 못했어요. 잠시 후 다시 시도해 주세요.");
          navigate("/subscription");
        }}
      />
    </div>
  );
}

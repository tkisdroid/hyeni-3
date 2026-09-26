import { ChildSwitcher } from "@/components/ChildSwitcher";
import { useFamilyTimeZone } from "@/region/FamilyTimeZone";
import { useMemo, useRef, useState } from "react";
import { scopedDaySummary, type DaySummaryScope, type ScopedDaySummary } from "@/transform/auditStateScope";
import { useAuth } from "@/auth/AuthContext";
import { useLocation, useNavigate } from "react-router";
import { useIntl, type IntlShape } from "react-intl";
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
import { dateKeyToDateInputValue, dateToDateKeyInTimeZone, parseAppDateKey } from "@/transform/dateKey";
import { filterEventsForChild } from "@/transform/eventScope";
import { canUse, FEATURES } from "@/transform/tierPolicy";
import {
  browserPremiumReturnIntentStorage,
  savePremiumReturnIntent,
} from "@/transform/premiumReturnIntent";
import { Loading } from "@/components/ui/Loading";
import type { SupportedLocale } from "@/i18n/locale";
import { useLocale } from "@/i18n/useLocale";
import { formatCalendarDay } from "@/i18n/format";
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
function buildRows(
  signals: DaySummarySignals | null,
  locale: SupportedLocale,
  intl: IntlShape,
): SummaryRow[] {
  if (!signals) return [];
  const rows: SummaryRow[] = [];
  (signals.events ?? []).slice(0, 4).forEach((e, i) => {
    rows.push({
      key: `ev-${i}`,
      icon: CalendarDays,
      text: e.title,
      sub: e.time ? formatTimeLabel(e.time, locale, intl) : undefined,
      tone: "info",
    });
  });
  (signals.dwellPlaces ?? []).slice(0, 3).forEach((p, i) => {
    rows.push({ key: `dw-${i}`, icon: MapPin, text: p.title, sub: p.durationLabel || undefined, tone: "info" });
  });
  if ((signals.chatCount ?? 0) > 0) {
    rows.push({
      key: "chat",
      icon: MessageCircle,
      text: intl.formatMessage(
        { id: "parent.daySummary.chatCount" },
        { count: intl.formatNumber(signals.chatCount ?? 0) },
      ),
      tone: "info",
    });
  }
  const alertTotal =
    (signals.notArrived ?? 0) + (signals.dangerZone ?? 0) + (signals.sos ?? 0) + (signals.playdate ?? 0);
  if (alertTotal > 0) {
    const highlights = signals.alertHighlights ?? [];
    if (highlights.length > 0) {
      highlights.slice(0, 3).forEach((h, i) => rows.push({ key: `al-${i}`, icon: TriangleAlert, text: h, tone: "caution" }));
    } else {
      rows.push({
        key: "al",
        icon: TriangleAlert,
        text: intl.formatMessage(
          { id: "parent.daySummary.alertCount" },
          { count: intl.formatNumber(alertTotal) },
        ),
        tone: "caution",
      });
    }
  } else {
    rows.push({
      key: "safe",
      icon: ShieldCheck,
      text: intl.formatMessage({ id: "parent.daySummary.safeRow" }),
      tone: "safe",
    });
  }
  return rows;
}

// 위험·SOS·미도착이 있으면 "주의" 하루로 헤로 톤을 바꾼다.
function isCautionDay(signals: DaySummarySignals | null): boolean {
  if (!signals) return false;
  return (signals.dangerZone ?? 0) + (signals.sos ?? 0) + (signals.notArrived ?? 0) > 0;
}

export function DaySummary() {
  const familyTimeZone = useFamilyTimeZone();
  const { locale } = useLocale();
  const intl = useIntl();
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
  const childMemberId = targetChild?.id ?? null;
  const childName = targetChild?.name
    ?? state.childName
    ?? intl.formatMessage({ id: "parent.daySummary.childFallback" });

  // 앱 date_key(0-index 월) → ISO "YYYY-MM-DD"(서버 계약). 기본 = 오늘.
  const appDateKey = requestedDateKey && parseAppDateKey(requestedDateKey)
    ? requestedDateKey
    : dateToDateKeyInTimeZone(new Date(), familyTimeZone);
  const isoDateKey = dateKeyToDateInputValue(appDateKey);
  const dateLabel = useMemo(() => {
    const d = parseAppDateKey(appDateKey);
    return d
      ? formatCalendarDay(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12), {
          locale,
          timeZone: "UTC",
        })
      : "";
  }, [appDateKey, locale]);

  // 생성 품질 향상용 clientSignals(그날 일정). 없으면 서버가 알림·대화만으로 요약.
  const { data: events } = useEvents();
  const clientSignals = useMemo(() => {
    if (!childMemberId) return undefined;
    const dayEvents = filterEventsForChild(events ?? [], childMemberId)
      .filter((e) => e.date_key === appDateKey && !!e.title?.trim())
      .map((e) => ({ title: e.title, time: e.time || "" }))
      .slice(0, 8);
    return dayEvents.length > 0 ? { events: dayEvents } : undefined;
  }, [events, appDateKey, childMemberId]);

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
  const { familyId } = useAuth();
  const scope: DaySummaryScope = [familyId ?? "", childUserId ?? "", isoDateKey ?? ""];
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const [generatedResult, setGenerated] = useState<ScopedDaySummary<DaySummaryResult> | null>(null);
  const generated = scopedDaySummary(generatedResult, scope);
  const [upsellOpen, setUpsellOpen] = useState(false);

  const summary = generated?.summary ?? cached?.summary ?? "";
  const signals = generated?.signals ?? cached?.signals ?? null;
  const premiumLocked = (entitlement.ready && !allowed) || (generated ? !generated.premium : false);
  const isEmpty = generated ? generated.empty : false;
  const hasSummary = !!summary && !premiumLocked && !isEmpty;

  const rows = useMemo(() => buildRows(signals, locale, intl), [intl, locale, signals]);
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
          if (!scopedDaySummary({ scope, value: res }, currentScope.current)) return;
          if (!res.premium) {
            setGenerated(null);
            setUpsellOpen(true);
            return;
          }
          setGenerated({ scope, value: res });
        },
        onError: () => {
          if (scopedDaySummary({ scope, value: true }, currentScope.current)) {
            show(intl.formatMessage({ id: "parent.daySummary.generateError" }), "💜");
          }
        },
      },
    );
  };

  return (
    <div className="ds-screen">
      <div className="ds-header">
        <button
          type="button"
          className="ds-back hy-press"
          aria-label={intl.formatMessage({ id: "parent.daySummary.back" })}
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} strokeWidth={2.2} color="#4A4145" />
        </button>
        <span className="ds-title">
          {intl.formatMessage(
            { id: "parent.daySummary.screenTitle" },
            { childName },
          )}
        </span>
      </div>

      <div className="hy-content ds-content">
        <ChildSwitcher className="hy-kidswitch--screen" />
        {!childUserId && familyLoading ? (
          <div className="ds-panel">
            <Loading label={intl.formatMessage({ id: "parent.daySummary.familyLoading" })} />
          </div>
        ) : !childUserId ? (
          <div className="ds-panel">
            <div className="ds-panel__art">
              <img src={asset("mascot/diary.webp")} alt="" />
            </div>
            <div className="ds-panel__title">
              {intl.formatMessage({ id: "parent.daySummary.noChildTitle" })}
            </div>
            <div className="ds-panel__desc">
              {intl.formatMessage({ id: "parent.daySummary.noChildDescription" })}
            </div>
          </div>
        ) : !entitlement.ready && entitlement.isError ? (
          <div className="ds-panel" role="alert">
            <div className="ds-panel__art">
              <img src={asset("mascot/diary.webp")} alt="" />
            </div>
            <div className="ds-panel__title">
              {intl.formatMessage({ id: "parent.daySummary.entitlementErrorTitle" })}
            </div>
            <div className="ds-panel__desc">
              {intl.formatMessage({ id: "parent.daySummary.entitlementErrorDescription" })}
            </div>
            <button type="button" className="ds-panel__cta hy-press" onClick={() => void entitlement.refetch()}>
              {intl.formatMessage({ id: "parent.daySummary.entitlementRetry" })}
            </button>
          </div>
        ) : !entitlement.ready ? (
          <div className="ds-panel">
            <Loading label={intl.formatMessage({ id: "parent.daySummary.entitlementLoading" })} />
          </div>
        ) : isError ? (
          <div className="ds-panel" role="alert">
            <div className="ds-panel__art">
              <img src={asset("mascot/diary.webp")} alt="" />
            </div>
            <div className="ds-panel__title">
              {intl.formatMessage({ id: "parent.daySummary.loadErrorTitle" })}
            </div>
            <div className="ds-panel__desc">
              {intl.formatMessage({ id: "parent.daySummary.loadErrorDescription" })}
            </div>
            <button type="button" className="ds-panel__cta hy-press" onClick={() => void refetchSummary()}>
              {intl.formatMessage({ id: "parent.daySummary.retry" })}
            </button>
          </div>
        ) : premiumLocked ? (
          <div className="ds-panel">
            <div className="ds-panel__art">
              <img src={asset("mascot/diary.webp")} alt="" />
            </div>
            <div className="ds-panel__title">
              {intl.formatMessage({ id: "parent.daySummary.premiumTitle" })}
            </div>
            <div className="ds-panel__desc">
              {intl.formatMessage(
                { id: "parent.daySummary.premiumDescription" },
                { childName },
              )}
            </div>
            <button type="button" className="ds-panel__cta hy-press" onClick={() => setUpsellOpen(true)}>
              {intl.formatMessage({ id: "parent.daySummary.premiumCta" })}
            </button>
          </div>
        ) : hasSummary ? (
          <>
            <div className={`ds-hero${caution ? " ds-hero--caution" : ""}`}>
              <img className="ds-hero__mascot" src={asset("mascot/diary.webp")} alt="" />
              <div className="ds-hero__status">
                {intl.formatMessage({
                  id: caution
                    ? "parent.daySummary.cautionStatus"
                    : "parent.daySummary.safeStatus",
                })}
              </div>
              <div className="ds-hero__date">
                {intl.formatMessage(
                  { id: "parent.daySummary.heroMeta" },
                  { date: dateLabel },
                )}
              </div>
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
              {intl.formatMessage({ id: "parent.daySummary.foot" })}
            </div>
          </>
        ) : isEmpty ? (
          <div className="ds-panel">
            <div className="ds-panel__art">
              <img src={asset("mascot/diary.webp")} alt="" />
            </div>
            <div className="ds-panel__title">
              {intl.formatMessage({ id: "parent.daySummary.emptyTitle" })}
            </div>
            <div className="ds-panel__desc">
              {intl.formatMessage(
                { id: "parent.daySummary.emptyDescription" },
                { date: dateLabel },
              )}
            </div>
          </div>
        ) : isLoading ? (
          <div
            className="ds-panel ds-panel--skel"
            role="status"
            aria-label={intl.formatMessage({ id: "parent.daySummary.loadingAria" })}
          >
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
              {intl.formatMessage(
                { id: "parent.daySummary.readyTitle" },
                { date: dateLabel, childName },
              )}
            </div>
            <div className="ds-panel__desc">
              {intl.formatMessage({ id: "parent.daySummary.readyDescription" })}
            </div>
            <button
              type="button"
              className="ds-panel__cta hy-press"
              onClick={onGenerate}
              disabled={generate.isPending} aria-busy={generate.isPending}
            >
              {intl.formatMessage({
                id: generate.isPending
                  ? "parent.daySummary.generating"
                  : "parent.daySummary.create",
              })}
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
          if (!saved) {
            throw new Error(intl.formatMessage({ id: "parent.daySummary.returnIntentFailed" }));
          }
          navigate("/subscription");
        }}
      />
    </div>
  );
}

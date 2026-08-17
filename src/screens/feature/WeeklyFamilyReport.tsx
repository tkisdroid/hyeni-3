import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useIntl, type IntlShape } from "react-intl";
import { AlertTriangle, ChevronLeft, RefreshCw } from "lucide-react";
import { asset } from "@/lib/assets";
import { Loading } from "@/components/ui/Loading";
import { PremiumUpsell } from "@/components/PremiumUpsell";
import { useActiveChild } from "@/app/activeChild";
import { useEntitlement } from "@/queries/useEntitlement";
import { useEvents, useDailySupplies } from "@/queries/useSchedule";
import { useMemoThread } from "@/queries/useMemo";
import { useParentAlerts } from "@/queries/useNotifications";
import { FEATURES, canUse } from "@/transform/tierPolicy";
import { parseAppDateKey } from "@/transform/dateKey";
import { resolveQueryTruthState } from "@/transform/queryTruthState";
import {
  buildRecentWeekDateKeys,
  resolveWeeklyReportReturnChildId,
  summarizeWeeklyReport,
  weeklyReportTeaser,
} from "@/transform/weeklyReportView";
import {
  browserPremiumReturnIntentStorage,
  savePremiumReturnIntent,
} from "@/transform/premiumReturnIntent";
import type { SupportedLocale } from "@/i18n/locale";
import { useLocale } from "@/i18n/useLocale";
import {
  formatDateTime,
  formatNumber,
  LEGACY_FAMILY_TIME_ZONE,
} from "@/i18n/format";
import "./WeeklyFamilyReport.css";

const REPORT_DATE_STYLE = "medium" as const;

function dateLabel(dateKey: string, locale: SupportedLocale, intl: IntlShape): string {
  const date = parseAppDateKey(dateKey);
  if (!date) return intl.formatMessage({ id: "reports.weekly.noRecord" });
  // date_key는 instant가 아닌 달력 날짜이므로 정오 합성값으로 날짜 자체만 지역화한다.
  return formatDateTime(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12), {
    locale,
    timeZone: LEGACY_FAMILY_TIME_ZONE,
    dateStyle: REPORT_DATE_STYLE,
  });
}

function rangeLabel(keys: readonly string[], locale: SupportedLocale, intl: IntlShape): string {
  const first = keys[0] ? dateLabel(keys[0], locale, intl) : "";
  const last = keys[keys.length - 1] ? dateLabel(keys[keys.length - 1], locale, intl) : "";
  return first && last
    ? intl.formatMessage({ id: "reports.weekly.range" }, { first, last })
    : intl.formatMessage({ id: "reports.weekly.recentDays" }, { count: 7 });
}

interface WeeklyReportRouteState {
  premiumReturnSource?: string;
  premiumEntitlementConfirmed?: boolean;
  premiumReturnDraft?: unknown;
}

export function WeeklyFamilyReport() {
  const intl = useIntl();
  const navigate = useNavigate();
  const routeState = (useLocation().state ?? null) as WeeklyReportRouteState | null;
  const { locale } = useLocale();
  const { activeChild, childMembers, familyLoading, setActiveChildId } = useActiveChild();
  const { ready, tier } = useEntitlement();
  const [now] = useState(() => new Date());
  const [upsellOpen, setUpsellOpen] = useState(false);
  const restoredChildId = routeState?.premiumReturnSource === "weekly_report"
    && routeState.premiumEntitlementConfirmed === true
    ? resolveWeeklyReportReturnChildId(routeState.premiumReturnDraft, childMembers)
    : null;

  useEffect(() => {
    if (restoredChildId && restoredChildId !== activeChild?.id) {
      setActiveChildId(restoredChildId);
    }
  }, [activeChild?.id, restoredChildId, setActiveChildId]);
  const weekDateKeys = useMemo(
    () => buildRecentWeekDateKeys(now, LEGACY_FAMILY_TIME_ZONE),
    [now],
  );
  const eventsQuery = useEvents();
  const suppliesQuery = useDailySupplies();
  const memoThread = useMemoThread(weekDateKeys, activeChild?.id ?? null);
  const alertsQuery = useParentAlerts(80);

  const allowed = ready && canUse(tier, FEATURES.WEEKLY_REPORT);
  const queryState = resolveQueryTruthState([
    { isLoading: eventsQuery.isLoading, isError: eventsQuery.isError },
    { isLoading: suppliesQuery.isLoading, isError: suppliesQuery.isError },
    { isLoading: memoThread.isLoading, isError: memoThread.isError },
    { isLoading: alertsQuery.isLoading, isError: alertsQuery.isError },
  ]);
  const summary = useMemo(() => {
    if (queryState !== "ready") return null;
    return summarizeWeeklyReport({
      childMemberId: activeChild?.id ?? null,
      childUserId: activeChild?.user_id ?? null,
      weekDateKeys,
      events: eventsQuery.data ?? [],
      supplies: suppliesQuery.data ?? [],
      memos: memoThread.data ?? [],
      alerts: alertsQuery.data ?? [],
      timeZone: LEGACY_FAMILY_TIME_ZONE,
    });
  }, [
    activeChild?.id,
    activeChild?.user_id,
    alertsQuery.data,
    eventsQuery.data,
    memoThread.data,
    queryState,
    suppliesQuery.data,
    weekDateKeys,
  ]);
  const refetching =
    eventsQuery.isFetching || suppliesQuery.isFetching || memoThread.isFetching || alertsQuery.isFetching;

  return (
    <div className="wr-root">
      <header className="wr-header">
        <button
          type="button"
          className="wr-back hy-press"
          aria-label={intl.formatMessage({ id: "reports.weekly.back" })}
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} strokeWidth={2.2} />
        </button>
        <div className="wr-head-main">
          <div className="wr-title">{intl.formatMessage({ id: "reports.weekly.title" })}</div>
          <div className="wr-subtitle">{intl.formatMessage({ id: "reports.weekly.subtitle" })}</div>
        </div>
      </header>

      <div className="wr-content">
        {!activeChild && familyLoading ? (
          <section className="hy-card wr-empty">
            <Loading label={intl.formatMessage({ id: "reports.weekly.familyLoading" })} />
          </section>
        ) : !activeChild ? (
          <section className="hy-card wr-empty">
            <div className="wr-empty__icon">
              <img src={asset("ui/chart-3d.webp")} alt="" />
            </div>
            <b>{intl.formatMessage({ id: "reports.weekly.noChildTitle" })}</b>
            <p>{intl.formatMessage({ id: "reports.weekly.noChildDescription" })}</p>
            <button type="button" className="wr-primary hy-press" onClick={() => navigate("/parent/home")}>
              {intl.formatMessage({ id: "reports.weekly.goParentHome" })}
            </button>
          </section>
        ) : (
          <>
            <section className="wr-hero">
              <div className="wr-hero__icon">
                <img src={asset("ui/chart-3d.webp")} alt="" />
              </div>
              <div className="wr-hero__body">
                <div className="wr-hero__eyebrow">
                  {intl.formatMessage(
                    { id: "reports.weekly.heroEyebrow" },
                    { childName: activeChild.name, range: rangeLabel(weekDateKeys, locale, intl) },
                  )}
                </div>
                <h1>
                  {intl.formatMessage({
                    id: allowed ? "reports.weekly.heroAllowed" : "reports.weekly.heroLocked",
                  })}
                </h1>
                <p>
                  {intl.formatMessage({
                    id: allowed
                      ? "reports.weekly.heroAllowedDescription"
                      : "reports.weekly.heroLockedDescription",
                  })}
                </p>
              </div>
            </section>

            {!ready ? (
              <section className="hy-card wr-section">
                <div className="wr-emptyline">
                  {intl.formatMessage({ id: "reports.weekly.subscriptionChecking" })}
                </div>
              </section>
            ) : !allowed ? (
              <>
                <section className="hy-card wr-section">
                  <div className="wr-section__head">
                    <img className="wr-metric__ic" src={asset("ui/star-medal.webp")} alt="" />
                    <b>{intl.formatMessage({ id: "reports.weekly.freeTeaserTitle" })}</b>
                  </div>
                  {queryState === "error" ? (
                    <div className="wr-emptyline">
                      {intl.formatMessage({ id: "reports.weekly.teaserError" })}
                    </div>
                  ) : queryState === "loading" ? (
                    <Loading label={intl.formatMessage({ id: "reports.weekly.teaserLoading" })} />
                  ) : summary ? (
                    <div className="wr-emptyline">
                      {weeklyReportTeaser(summary, activeChild.name ?? "", locale, intl)}
                    </div>
                  ) : null}
                </section>
                <section className="hy-card wr-lock">
                  <img className="wr-lock__icon" src={asset("ui/lock-3d.webp")} alt="" />
                  <div>
                    <b>{intl.formatMessage({ id: "reports.weekly.lockTitle" })}</b>
                    <p>{intl.formatMessage({ id: "reports.weekly.lockDescription" })}</p>
                  </div>
                  <button type="button" className="wr-primary hy-press" onClick={() => setUpsellOpen(true)}>
                    {intl.formatMessage({ id: "reports.weekly.premiumCta" })}
                  </button>
                </section>
                <section className="wr-preview">
                  {[
                    { id: "schedule", labelId: "reports.weekly.schedule", icon: "ui/calendar-heart.webp" },
                    { id: "supplies", labelId: "reports.weekly.supplies", icon: "cat/study.webp" },
                    { id: "memos", labelId: "reports.weekly.memos", icon: "ui/chat-heart.webp" },
                    { id: "alerts", labelId: "reports.weekly.alerts", icon: "ui/bell.webp" },
                  ].map(({ id, labelId, icon }) => (
                    <div key={id} className="hy-card wr-preview__item">
                      <span>
                        <img src={asset(icon)} alt="" style={{ width: 24, height: 24, objectFit: "contain" }} />
                      </span>
                      <b>{intl.formatMessage({ id: labelId })}</b>
                      <small>{intl.formatMessage({ id: "reports.weekly.previewDescription" })}</small>
                    </div>
                  ))}
                </section>
              </>
            ) : queryState === "error" ? (
              <section className="hy-card wr-state wr-state--error" role="alert" aria-live="assertive">
                <span className="wr-state__icon" aria-hidden="true">
                  <AlertTriangle size={25} strokeWidth={2.3} />
                </span>
                <b>{intl.formatMessage({ id: "reports.weekly.errorTitle" })}</b>
                <p>{intl.formatMessage({ id: "reports.weekly.errorDescription" })}</p>
                <button
                  type="button"
                  className="wr-state__retry hy-press hy-busy-quiet"
                  onClick={() =>
                    void Promise.all([
                      eventsQuery.refetch(),
                      suppliesQuery.refetch(),
                      memoThread.refetch(),
                      alertsQuery.refetch(),
                    ])
                  }
                  disabled={refetching}
                  aria-busy={refetching}
                >
                  <RefreshCw
                    size={17}
                    strokeWidth={2.4}
                    className={refetching ? "wr-spin" : undefined}
                    aria-hidden="true"
                  />
                  {refetching
                    ? intl.formatMessage({ id: "reports.weekly.retrying" })
                    : intl.formatMessage({ id: "reports.weekly.retry" })}
                </button>
              </section>
            ) : queryState === "loading" ? (
              <section className="hy-card wr-state" aria-busy="true">
                <Loading label={intl.formatMessage({ id: "reports.weekly.loading" })} />
              </section>
            ) : summary ? (
              <>
                <section className="wr-metrics">
                  <div className="hy-card wr-metric">
                    <img className="wr-metric__ic" src={asset("ui/calendar-heart.webp")} alt="" />
                    <span>{intl.formatMessage({ id: "reports.weekly.schedule" })}</span>
                    <b>
                      {intl.formatMessage(
                        { id: "reports.weekly.metricCount" },
                        { count: formatNumber(summary.eventCount, locale) },
                      )}
                    </b>
                  </div>
                  <div className="hy-card wr-metric">
                    <img className="wr-metric__ic" src={asset("cat/study.webp")} alt="" />
                    <span>{intl.formatMessage({ id: "reports.weekly.supplies" })}</span>
                    <b>
                      {intl.formatMessage(
                        { id: "reports.weekly.metricRatio" },
                        {
                          done: formatNumber(summary.supplyDone, locale),
                          total: formatNumber(summary.supplyTotal, locale),
                        },
                      )}
                    </b>
                  </div>
                  <div className="hy-card wr-metric">
                    <img className="wr-metric__ic" src={asset("ui/chat-heart.webp")} alt="" />
                    <span>{intl.formatMessage({ id: "reports.weekly.memos" })}</span>
                    <b>
                      {intl.formatMessage(
                        { id: "reports.weekly.metricCount" },
                        { count: formatNumber(summary.memoCount, locale) },
                      )}
                    </b>
                  </div>
                  <div className="hy-card wr-metric">
                    <img className="wr-metric__ic" src={asset("ui/bell.webp")} alt="" />
                    <span>{intl.formatMessage({ id: "reports.weekly.alerts" })}</span>
                    <b>
                      {intl.formatMessage(
                        { id: "reports.weekly.metricCount" },
                        { count: formatNumber(summary.alertCount, locale) },
                      )}
                    </b>
                  </div>
                </section>

                <section className="hy-card wr-section">
                  <div className="wr-section__head">
                    <img className="wr-metric__ic" src={asset("ui/star-medal.webp")} alt="" />
                    <b>{intl.formatMessage({ id: "reports.weekly.busiestTitle" })}</b>
                  </div>
                  {summary.busiestDay ? (
                    <div className="wr-kv">
                      <span>{intl.formatMessage({ id: "reports.weekly.date" })}</span>
                      <strong>{dateLabel(summary.busiestDay.dateKey, locale, intl)}</strong>
                      <span>{intl.formatMessage({ id: "reports.weekly.events" })}</span>
                      <strong>
                        {intl.formatMessage(
                          { id: "reports.weekly.metricCount" },
                          { count: formatNumber(summary.busiestDay.eventCount, locale) },
                        )}
                      </strong>
                    </div>
                  ) : (
                    <div className="wr-emptyline">
                      {intl.formatMessage({ id: "reports.weekly.noScheduleRecords" })}
                    </div>
                  )}
                </section>

                <section className="hy-card wr-section">
                  <div className="wr-section__head">
                    <img className="wr-metric__ic" src={asset("ui/crown.webp")} alt="" />
                    <b>{intl.formatMessage({ id: "reports.weekly.dataStatus" })}</b>
                  </div>
                  {summary.hasEnoughData ? (
                    <div className="wr-emptyline">
                      {intl.formatMessage({ id: "reports.weekly.dataReadyDescription" })}
                    </div>
                  ) : (
                    <div className="wr-emptyline">
                      {intl.formatMessage({ id: "reports.weekly.dataEmptyDescription" })}
                    </div>
                  )}
                </section>
              </>
            ) : null}
          </>
        )}
      </div>
      <PremiumUpsell
        open={upsellOpen}
        source="weekly_report"
        tier={tier}
        returnTo="/weekly-report"
        onClose={() => setUpsellOpen(false)}
        onUpgrade={({ source, feature, returnTo }) => {
          const storage = browserPremiumReturnIntentStorage();
          const saved = storage && returnTo
            ? savePremiumReturnIntent(storage, {
                source,
                feature,
                returnTo,
                draft: {
                  childMemberId: activeChild?.id ?? null,
                  childUserId: activeChild?.user_id ?? null,
                },
              })
            : false;
          if (!saved) {
            throw new Error(intl.formatMessage({ id: "reports.weekly.returnIntentFailed" }));
          }
          navigate("/subscription");
        }}
      />
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useIntl, type IntlShape } from "react-intl";
import { useNavigate } from "react-router";
import {
  AlertTriangle,
  BellRing,
  ChevronLeft,
  ChevronRight,
  Clock3,
  MapPinned,
  MessageSquareText,
  PackageOpen,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { Loading } from "@/components/ui/Loading";
import { useAuth } from "@/auth/AuthContext";
import { useActiveChild } from "@/app/activeChild";
import { useMyFamily } from "@/queries/useFamily";
import { useEvents, useDailySupplies } from "@/queries/useSchedule";
import { useChildLocations, useSavedPlaces } from "@/queries/useLocation";
import { useLocationLabels } from "@/queries/useLocationLabels";
import { useMemoThread } from "@/queries/useMemo";
import { useChildNotifSettingsStatus, useParentAlerts } from "@/queries/useNotifications";
import { useEntitlement } from "@/queries/useEntitlement";
import { requestDeviceStatus } from "@/lib/api/endpoints/remote";
import { filterEventsForChild } from "@/transform/eventScope";
import { groupEventsByDateKey, PAST_TAGS } from "@/transform/scheduleView";
import { deviceStatusView } from "@/transform/familyView";
import { formatFreshness } from "@/transform/locationView";
import {
  dailyReportDateScope,
  deriveDailyReportStatus,
  summarizeDailySupplies,
  type DailyReportAlertInput,
} from "@/transform/dailyReportView";
import { isLocationVisible, TIERS } from "@/transform/tierPolicy";
import type { SupportedLocale } from "@/i18n/locale";
import { useLocale } from "@/i18n/useLocale";
import { formatDateTime, LEGACY_FAMILY_TIME_ZONE } from "@/i18n/format";
import "./DailySafetyReport.css";

function formatShortTime(
  value: string | null | undefined,
  locale: SupportedLocale,
): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return formatDateTime(date, {
    locale,
    timeZone: LEGACY_FAMILY_TIME_ZONE,
    timeStyle: "short",
  });
}

function formatClock(value: Date, locale: SupportedLocale): string {
  return formatDateTime(value, {
    locale,
    timeZone: LEGACY_FAMILY_TIME_ZONE,
    timeStyle: "short",
  });
}

function alertLabel(alert: DailyReportAlertInput, intl: IntlShape): string {
  const type = alert.alert_type.toLowerCase();
  if (type === "sos" || type === "sos_followup") return intl.formatMessage({ id: "reports.daily.alert.sos" });
  if (type === "emergency") return intl.formatMessage({ id: "reports.daily.alert.emergency" });
  if (type === "not_arrived") return intl.formatMessage({ id: "reports.daily.alert.notArrived" });
  if (type === "danger_zone" || type === "danger_zone_entry") return intl.formatMessage({ id: "reports.daily.alert.dangerEntry" });
  if (type === "danger_zone_exit") return intl.formatMessage({ id: "reports.daily.alert.dangerExit" });
  return intl.formatMessage({ id: "reports.daily.alert.safety" });
}

function alertTone(alert: DailyReportAlertInput): ReportTone {
  const type = alert.alert_type.toLowerCase();
  const severity = (alert.severity ?? "").toLowerCase();
  if (type === "sos" || type === "sos_followup" || type === "emergency" || severity === "emergency" || severity === "critical") {
    return "danger";
  }
  return "cream";
}

type ReportTone = "mint" | "blue" | "cream" | "rose" | "lav" | "danger";

interface ReportOverviewCard {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone: ReportTone;
  icon: ReactNode;
}

export function DailySafetyReport() {
  const intl = useIntl();
  const navigate = useNavigate();
  const { show } = useToast();
  const { locale } = useLocale();
  const { familyId } = useAuth();
  const { activeChild } = useActiveChild();
  const [now, setNow] = useState(() => new Date());
  const [refreshingDevice, setRefreshingDevice] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const reportDateScope = useMemo(
    () => dailyReportDateScope(now, LEGACY_FAMILY_TIME_ZONE),
    [now],
  );
  const todayKey = reportDateScope.dateKey;
  const eventsQuery = useEvents();
  const suppliesQuery = useDailySupplies(todayKey);
  const familyQuery = useMyFamily();
  const locationsQuery = useChildLocations();
  const placesQuery = useSavedPlaces();
  const alertsQuery = useParentAlerts();
  const childNotifSettingsQuery = useChildNotifSettingsStatus(activeChild?.user_id);
  const memoThread = useMemoThread([todayKey], activeChild?.id ?? null);
  const entitlement = useEntitlement();

  const locationScopeError = entitlement.isError;
  const locationScopePending = entitlement.isError || entitlement.tier === TIERS.UNKNOWN;
  const safetySourceHasError =
    familyQuery.isError
    || alertsQuery.isError
    || locationsQuery.isError
    || entitlement.isError
    || (!!activeChild?.user_id && childNotifSettingsQuery.isError);
  const safetySourceIsLoading =
    !safetySourceHasError
    && (
      familyQuery.isLoading
      || alertsQuery.isLoading
      || locationsQuery.isLoading
      || entitlement.isLoading
      || entitlement.tier === TIERS.UNKNOWN
      || (!!activeChild?.user_id && childNotifSettingsQuery.isLoading)
    );
  const safetySourceState = safetySourceHasError
    ? "error"
    : safetySourceIsLoading
      ? "loading"
      : "ready";
  const canShowLocation = !locationScopePending && isLocationVisible(entitlement.tier);
  const locations = canShowLocation ? locationsQuery.data ?? [] : [];
  const places = placesQuery.data ?? [];
  const locationLabel = useLocationLabels(locations, places);
  const cachedChildLocation = activeChild?.user_id
    ? locationsQuery.data?.find((loc) => loc.user_id === activeChild.user_id) ?? null
    : null;
  const childLocation = canShowLocation ? cachedChildLocation : null;
  const locationFreshness = childLocation ? formatFreshness(childLocation.updated_at, now, locale, intl) : null;
  const locationLocked = !locationScopePending && !isLocationVisible(entitlement.tier);
  const device = useMemo(
    () => deviceStatusView(
      activeChild?.device_health,
      now,
      locale,
      childNotifSettingsQuery.data?.userId === activeChild?.user_id
        ? childNotifSettingsQuery.data?.childEnabled ?? null
        : null,
      childNotifSettingsQuery.isError
        ? "error"
        : childNotifSettingsQuery.isSuccess
          ? "ready"
          : "loading",
      intl,
    ),
    [
      activeChild,
      childNotifSettingsQuery.data,
      childNotifSettingsQuery.isError,
      childNotifSettingsQuery.isSuccess,
      intl,
      locale,
      now,
    ],
  );

  const todayEvents = useMemo(() => {
    if (!activeChild) return [];
    const dayEvents = filterEventsForChild(eventsQuery.data ?? [], activeChild.id).filter(
      (event) => event.date_key === todayKey,
    );
    const allowedIds = new Set(dayEvents.map((event) => event.id));
    return (groupEventsByDateKey(
      eventsQuery.data ?? [],
      now,
      locale,
      LEGACY_FAMILY_TIME_ZONE,
      undefined,
      places,
      intl,
    )[todayKey] ?? []).filter((event) =>
      allowedIds.has(event.id),
    );
  }, [activeChild, eventsQuery.data, intl, locale, now, places, todayKey]);
  const nextEvent = todayEvents.find((event) => !PAST_TAGS.has(event.tag)) ?? null;
  const pastEventCount = todayEvents.filter((event) => PAST_TAGS.has(event.tag)).length;

  const supplies = useMemo(
    () => (activeChild ? (suppliesQuery.data ?? []).filter((item) => item.child_user_id === activeChild.id) : []),
    [activeChild, suppliesQuery.data],
  );
  const supplySummary = useMemo(() => summarizeDailySupplies(supplies), [supplies]);

  const childAlerts = useMemo(() => {
    const childUserId = activeChild?.user_id ?? null;
    return (alertsQuery.data ?? []).filter((alert) => !alert.child_user_id || !childUserId || alert.child_user_id === childUserId);
  }, [alertsQuery.data, activeChild?.user_id]);
  const statusView = deriveDailyReportStatus({
    sourceState: safetySourceState,
    hasActiveChild: !!activeChild,
    alerts: childAlerts,
    locationFreshness: locationFreshness?.status ?? "unknown",
    deviceSafetyLabel: device.safetyLabel,
    deviceSafetyState: device.safetyState,
    deviceHasData: device.hasData,
    now,
    timeZone: LEGACY_FAMILY_TIME_ZONE,
  });
  const todayAlerts = useMemo(
    () => childAlerts.filter((alert) => reportDateScope.includesTimestamp(alert.created_at)).slice(0, 3),
    [childAlerts, reportDateScope],
  );
  const reportTimeLabel = useMemo(() => formatClock(now, locale), [locale, now]);
  const supplyPercent = supplySummary.total > 0 ? Math.round((supplySummary.done / supplySummary.total) * 100) : 0;
  const overviewCards = useMemo<ReportOverviewCard[]>(() => {
    const locationTone: ReportTone = locationScopeError
      ? "cream"
      : locationScopePending || locationLocked
        ? "lav"
        : !childLocation || locationFreshness?.status === "stale"
          ? "cream"
          : "mint";
    return [
      {
        id: "location",
        label: intl.formatMessage({ id: "reports.daily.recentLocation" }),
        value: locationScopeError
          ? intl.formatMessage({ id: "reports.daily.scopeFailed" })
          : locationScopePending
          ? intl.formatMessage({ id: "reports.daily.scopeLoading" })
          : locationLocked
            ? intl.formatMessage({ id: "reports.daily.locked" })
            : childLocation
              ? locationLabel(childLocation)
              : intl.formatMessage({ id: "reports.daily.checking" }),
        detail: locationScopeError
          ? intl.formatMessage({ id: "reports.daily.subscriptionFailed" })
          : locationScopePending
            ? intl.formatMessage({ id: "reports.daily.subscriptionChecking" })
            : locationLocked
              ? intl.formatMessage({ id: "reports.daily.premiumLocation" })
              : locationFreshness?.label ?? intl.formatMessage({ id: "reports.daily.noLocationInfo" }),
        tone: locationTone,
        icon: <img src={asset("ui/pin-heart.webp")} alt="" loading="lazy" decoding="async" />,
      },
      {
        id: "schedule",
        label: intl.formatMessage({ id: "reports.daily.todaySchedule" }),
        value: eventsQuery.isError
          ? intl.formatMessage({ id: "reports.daily.checkFailed" })
          : eventsQuery.isLoading
            ? intl.formatMessage({ id: "reports.daily.checking" })
            : intl.formatMessage({ id: "reports.daily.itemCount" }, { count: todayEvents.length }),
        detail: eventsQuery.isError
          ? intl.formatMessage({ id: "reports.daily.retryBelow" })
          : eventsQuery.isLoading
            ? intl.formatMessage({ id: "reports.daily.scheduleLoading" })
            : nextEvent
              ? `${nextEvent.title}${nextEvent.time ? ` · ${nextEvent.time}` : ""}`
              : intl.formatMessage({ id: "reports.daily.noRemainingSchedule" }),
        tone: eventsQuery.isError ? "cream" : todayEvents.length > 0 ? "blue" : "mint",
        icon: <img src={asset("ui/calendar-heart.webp")} alt="" loading="lazy" decoding="async" />,
      },
      {
        id: "supplies",
        label: intl.formatMessage({ id: "reports.daily.supplies" }),
        value: suppliesQuery.isError
          ? intl.formatMessage({ id: "reports.daily.checkFailed" })
          : suppliesQuery.isLoading
            ? intl.formatMessage({ id: "reports.daily.checking" })
            : supplySummary.total === 0
              ? intl.formatMessage({ id: "reports.daily.none" })
              : intl.formatMessage(
                  { id: "reports.daily.ratio" },
                  { done: supplySummary.done, total: supplySummary.total },
                ),
        detail: suppliesQuery.isError
          ? intl.formatMessage({ id: "reports.daily.retryBelow" })
          : suppliesQuery.isLoading
            ? intl.formatMessage({ id: "reports.daily.supplyLoading" })
            : supplySummary.total === 0
              ? intl.formatMessage({ id: "reports.daily.noItemsToday" })
              : intl.formatMessage({ id: "reports.daily.percentComplete" }, { percent: supplyPercent }),
        tone: suppliesQuery.isError ? "cream" : supplySummary.remaining > 0 ? "cream" : "mint",
        icon: <img src={asset("cat/study.webp")} alt="" loading="lazy" decoding="async" />,
      },
      {
        id: "device",
        label: intl.formatMessage({ id: "reports.daily.deviceStatus" }),
        value: device.safetyLabel,
        detail: device.hasData
          ? `${device.batteryLabel} · ${device.networkLabel}`
          : intl.formatMessage({ id: "reports.daily.refreshNeeded" }),
        tone: device.safetyState === "ready" ? "mint" : "cream",
        icon: <img src={asset("ui/battery.webp")} alt="" loading="lazy" decoding="async" />,
      },
    ];
  }, [
    childLocation,
    device.batteryLabel,
    device.hasData,
    device.networkLabel,
    device.safetyLabel,
    eventsQuery.isError,
    eventsQuery.isLoading,
    intl,
    locationFreshness?.label,
    locationFreshness?.status,
    locationLabel,
    locationLocked,
    locationScopeError,
    locationScopePending,
    nextEvent,
    supplyPercent,
    suppliesQuery.isError,
    suppliesQuery.isLoading,
    supplySummary.done,
    supplySummary.remaining,
    supplySummary.total,
    todayEvents.length,
  ]);
  const safetySignals = useMemo<ReportOverviewCard[]>(
    () => [
      {
        id: "alert",
        label: intl.formatMessage({ id: "reports.daily.safetyAlert" }),
        value: intl.formatMessage({ id: "reports.daily.alertCount" }, { count: todayAlerts.length }),
        detail: todayAlerts[0]
          ? alertLabel(todayAlerts[0], intl)
          : intl.formatMessage({ id: "reports.daily.noEmergencyToday" }),
        tone: statusView.status === "danger" ? "danger" : todayAlerts.length > 0 ? "cream" : "mint",
        icon: <img src={asset(todayAlerts.length > 0 ? "ui/bell.webp" : "ui/shield-heart.webp")} alt="" loading="lazy" decoding="async" />,
      },
      {
        id: "freshness",
        label: intl.formatMessage({ id: "reports.daily.locationFreshness" }),
        value: locationScopeError
          ? intl.formatMessage({ id: "reports.daily.scopeFailed" })
          : locationScopePending
            ? intl.formatMessage({ id: "reports.daily.scopeLoading" })
            : locationLocked
              ? intl.formatMessage({ id: "reports.daily.locked" })
              : locationFreshness?.label ?? intl.formatMessage({ id: "reports.daily.none" }),
        detail: locationScopeError
          ? intl.formatMessage({ id: "reports.daily.subscriptionFailed" })
          : locationScopePending
            ? intl.formatMessage({ id: "reports.daily.subscriptionChecking" })
            : childLocation
              ? intl.formatMessage({ id: "reports.daily.childLocationBasis" })
              : intl.formatMessage({ id: "reports.daily.locationWaiting" }),
        tone: locationScopeError ? "cream" : locationScopePending || locationLocked ? "lav" : locationFreshness?.status === "stale" || !childLocation ? "cream" : "mint",
        icon: <img src={asset("ui/pin.webp")} alt="" loading="lazy" decoding="async" />,
      },
      {
        id: "device-signal",
        label: intl.formatMessage({ id: "reports.daily.deviceReport" }),
        value: device.freshnessLabel,
        detail: device.hasData
          ? intl.formatMessage(
              { id: "reports.daily.unlockDetail" },
              { count: device.unlockCountLabel },
            )
          : intl.formatMessage({ id: "reports.daily.afterChildConnect" }),
        tone: device.safetyState === "ready" ? "blue" : "cream",
        icon: <img src={asset("ui/battery.webp")} alt="" loading="lazy" decoding="async" />,
      },
    ],
    [
      childLocation,
      device.unlockCountLabel,
      device.freshnessLabel,
      device.hasData,
      device.safetyLabel,
      locationFreshness?.label,
      locationFreshness?.status,
      locationLocked,
      locationScopeError,
      locationScopePending,
      statusView.status,
      todayAlerts,
      intl,
    ],
  );
  const topDeviceApps = device.topApps.slice(0, 2);

  const memoPreview = useMemo(
    () =>
      (memoThread.data ?? [])
        .filter((reply) => reply.content.trim())
        .slice(-3)
        .reverse(),
    [memoThread.data],
  );

  const safetySourceIssues = [
    {
      id: "alerts",
      label: intl.formatMessage({ id: "reports.daily.safetyAlert" }),
      retryLabel: intl.formatMessage({ id: "reports.daily.retryAlerts" }),
      failed: alertsQuery.isError,
      isFetching: alertsQuery.isFetching,
      refetch: async () => {
        await alertsQuery.refetch();
      },
    },
    {
      id: "location",
      label: intl.formatMessage({ id: "reports.daily.location" }),
      retryLabel: intl.formatMessage({ id: "reports.daily.retryLocation" }),
      failed: locationsQuery.isError || entitlement.isError,
      isFetching: locationsQuery.isFetching || entitlement.isFetching,
      refetch: async () => {
        await Promise.all([locationsQuery.refetch(), entitlement.refetch()]);
      },
    },
    {
      id: "device",
      label: intl.formatMessage({ id: "reports.daily.deviceStatus" }),
      retryLabel: intl.formatMessage({ id: "reports.daily.retryDevice" }),
      failed: familyQuery.isError || (!!activeChild?.user_id && childNotifSettingsQuery.isError),
      isFetching: familyQuery.isFetching || childNotifSettingsQuery.isFetching,
      refetch: async () => {
        if (activeChild?.user_id) {
          await Promise.all([familyQuery.refetch(), childNotifSettingsQuery.refetch()]);
          return;
        }
        await familyQuery.refetch();
      },
    },
  ].filter((source) => source.failed);

  const refreshDevice = async () => {
    if (!familyId || refreshingDevice) return;
    setRefreshingDevice(true);
    try {
      await requestDeviceStatus(familyId, activeChild?.user_id ?? null);
      show(intl.formatMessage({ id: "reports.daily.deviceRequestSent" }), "📱");
    } catch (error) {
      console.error("기기 상태 확인 요청 실패:", error);
      show(intl.formatMessage({ id: "reports.daily.deviceRequestFailed" }), "⚠️");
    } finally {
      setRefreshingDevice(false);
    }
  };

  const childName = activeChild?.name ?? intl.formatMessage({ id: "reports.daily.childFallback" });

  return (
    <div className="dr-root">
      <header className="dr-header">
        <button
          type="button"
          className="dr-back hy-press"
          aria-label={intl.formatMessage({ id: "reports.daily.back" })}
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} strokeWidth={2.2} />
        </button>
        <div className="dr-head-main">
          <div className="dr-title">{intl.formatMessage({ id: "reports.daily.title" })}</div>
          <div className="dr-subtitle">{intl.formatMessage({ id: "reports.daily.subtitle" })}</div>
        </div>
      </header>

      <div className="dr-content">
        {safetySourceState === "loading" ? (
          <section className="hy-card dr-loading">
            <Loading label={intl.formatMessage({ id: "reports.daily.loading" })} />
          </section>
        ) : safetySourceState === "error" ? (
          <section className="hy-card dr-source-error" role="alert" aria-live="assertive">
            <div className="dr-source-error__head">
              <span className="dr-source-error__icon" aria-hidden="true">
                <AlertTriangle size={24} strokeWidth={2.3} />
              </span>
              <span>
                <b>{intl.formatMessage({ id: "reports.daily.sourceErrorTitle" })}</b>
                <small>{intl.formatMessage({ id: "reports.daily.sourceErrorDescription" })}</small>
              </span>
            </div>
            <div
              className="dr-source-error__actions"
              aria-label={intl.formatMessage({ id: "reports.daily.sourceRetryAria" })}
            >
              {safetySourceIssues.map((source) => (
                <button
                  key={source.id}
                  type="button"
                  className="dr-source-error__retry hy-press hy-busy-quiet"
                  onClick={() => void source.refetch()}
                  disabled={source.isFetching} aria-busy={source.isFetching}
                  aria-label={source.retryLabel}
                >
                  <RefreshCw
                    size={16}
                    strokeWidth={2.4}
                    className={source.isFetching ? "dr-spin" : undefined}
                  />
                  {source.isFetching
                    ? intl.formatMessage(
                        { id: "reports.daily.checkingSource" },
                        { source: source.label },
                      )
                    : source.retryLabel}
                </button>
              ))}
            </div>
          </section>
        ) : !activeChild ? (
          <section className="hy-card dr-empty">
            <ShieldCheck size={38} strokeWidth={2.1} />
            <div className="dr-empty__title">{intl.formatMessage({ id: "reports.daily.noChildTitle" })}</div>
            <p>{intl.formatMessage({ id: "reports.daily.noChildDescription" })}</p>
            <button type="button" className="dr-primary hy-press" onClick={() => navigate("/child-invite")}>
              {intl.formatMessage({ id: "reports.daily.connectChild" })}
            </button>
          </section>
        ) : (
          <>
            <section className={`dr-hero dr-hero--${statusView.status}`}>
              <div className="dr-hero__copy">
                <div className="dr-hero__eyebrow">
                  {intl.formatMessage({ id: "reports.daily.heroEyebrow" }, { childName })}
                </div>
                <div className="dr-hero__title">
                  {intl.formatMessage({ id: `reports.daily.status.${statusView.status}.title` })}
                </div>
                <p>{intl.formatMessage({ id: `reports.daily.status.${statusView.status}.description` })}</p>
                <div className="dr-hero__chips">
                  <span>
                    <Clock3 size={14} strokeWidth={2.3} />
                    {intl.formatMessage({ id: "reports.daily.asOf" }, { time: reportTimeLabel })}
                  </span>
                  <span>
                    <ShieldCheck size={14} strokeWidth={2.3} />
                    {todayAlerts.length > 0
                      ? intl.formatMessage({ id: "reports.daily.heroAlertCount" }, { count: todayAlerts.length })
                      : intl.formatMessage({ id: "reports.daily.noAlerts" })}
                  </span>
                </div>
              </div>
              <div className="dr-hero__visual" aria-hidden="true">
                <span className="dr-hero__orb">
                  <img
                    src={asset(
                      statusView.status === "danger"
                        ? "ui/sos-shield.webp"
                        : statusView.status === "attention"
                          ? "ui/warning.webp"
                          : "ui/shield-heart.webp",
                    )}
                    alt=""
                    loading="eager"
                    decoding="async"
                    fetchPriority="high"
                  />
                </span>
              </div>
            </section>

            <section
              className="hy-card dr-overview"
              aria-label={intl.formatMessage({ id: "reports.daily.overviewAria" })}
            >
              {overviewCards.map((card) => (
                <div key={card.id} className={`dr-overview-card dr-tone--${card.tone}`}>
                  <span className="dr-overview-card__icon">{card.icon}</span>
                  <span className="dr-overview-card__label">{card.label}</span>
                  <strong>{card.value}</strong>
                  <small>{card.detail}</small>
                </div>
              ))}
            </section>

            <section className="hy-card dr-section">
              <div className="dr-section__head dr-section__head--large">
                <span className={`dr-section__icon dr-tone--${statusView.status === "danger" ? "danger" : statusView.status === "attention" ? "cream" : "mint"}`}>
                  <img src={asset("ui/safety-mascot.webp")} alt="" loading="lazy" decoding="async" />
                </span>
                <span>
                  <b>{intl.formatMessage({ id: "reports.daily.safetySignals" })}</b>
                  <small>{intl.formatMessage({ id: "reports.daily.safetySignalsDescription" })}</small>
                </span>
              </div>
              <div className="dr-signal-grid">
                {safetySignals.map((signal) => (
                  <div key={signal.id} className={`dr-signal dr-tone--${signal.tone}`}>
                    <span>{signal.icon}</span>
                    <b>{signal.value}</b>
                    <small>{signal.label} · {signal.detail}</small>
                  </div>
                ))}
              </div>
              {todayAlerts.length > 0 && (
                <div className="dr-alert-list">
                  {todayAlerts.map((alert) => (
                    <div key={`${alert.alert_type}-${alert.created_at}`} className={`dr-alert dr-tone--${alertTone(alert)}`}>
                      <BellRing size={16} strokeWidth={2.2} />
                      <span>{alertLabel(alert, intl)}</span>
                      <small>
                        {formatShortTime(alert.created_at, locale)
                          || intl.formatMessage({ id: "reports.daily.timePending" })}
                      </small>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="hy-card dr-section">
              <div className="dr-section__head dr-section__head--large">
                <span className="dr-section__icon dr-tone--mint">
                  <img src={asset("ui/pin-heart.webp")} alt="" loading="lazy" decoding="async" />
                </span>
                <span>
                  <b>{intl.formatMessage({ id: "reports.daily.movementTitle" })}</b>
                  <small>{intl.formatMessage({ id: "reports.daily.movementDescription" })}</small>
                </span>
                <button type="button" className="dr-link hy-press" onClick={() => navigate("/parent/location?view=history")}>
                  {intl.formatMessage({ id: "reports.daily.viewMap" })}
                  <ChevronRight size={14} strokeWidth={2.4} />
                </button>
              </div>
              {locationScopeError ? (
                <div className="dr-scope-error" role="alert" aria-live="assertive">
                  <AlertTriangle size={20} strokeWidth={2.2} aria-hidden="true" />
                  <span>
                    <b>{intl.formatMessage({ id: "reports.daily.scopeFailed" })}</b>
                    <small>{intl.formatMessage({ id: "reports.daily.scopeErrorDescription" })}</small>
                  </span>
                  <button
                    type="button"
                    className="dr-scope-error__retry hy-press hy-busy-quiet"
                    onClick={() => void entitlement.refetch()}
                    disabled={entitlement.isFetching} aria-busy={entitlement.isFetching}
                  >
                    <RefreshCw
                      size={15}
                      strokeWidth={2.4}
                      className={entitlement.isFetching ? "dr-spin" : undefined}
                    />
                    {entitlement.isFetching
                      ? intl.formatMessage({ id: "reports.daily.checking" })
                      : intl.formatMessage({ id: "reports.daily.retry" })}
                  </button>
                </div>
              ) : locationScopePending ? (
                <div className="dr-emptyline" role="status" aria-live="polite">
                  {intl.formatMessage({ id: "reports.daily.scopePendingDescription" })}
                </div>
              ) : locationLocked ? (
                <div className="dr-lock">
                  {intl.formatMessage({ id: "reports.daily.locationLockDescription" })}
                </div>
              ) : childLocation ? (
                <div className="dr-feature-row">
                  <span className="dr-feature-row__icon dr-tone--mint">
                    <MapPinned size={22} strokeWidth={2.2} />
                  </span>
                  <span className="dr-feature-row__main">
                    <b>{locationLabel(childLocation)}</b>
                    <small>
                      {intl.formatMessage(
                        { id: "reports.daily.lastUpdate" },
                        {
                          freshness: locationFreshness?.label
                            ?? intl.formatMessage({ id: "reports.daily.noLocationInfo" }),
                        },
                      )}
                    </small>
                  </span>
                </div>
              ) : (
                <div className="dr-emptyline">{intl.formatMessage({ id: "reports.daily.noLocationToday" })}</div>
              )}
            </section>

            <div className="dr-duo">
              <section className="hy-card dr-section">
                <div className="dr-section__head dr-section__head--large">
                  <span className="dr-section__icon dr-tone--blue">
                    <img src={asset("ui/calendar-heart.webp")} alt="" loading="lazy" decoding="async" />
                  </span>
                  <span>
                    <b>{intl.formatMessage({ id: "reports.daily.scheduleCheck" })}</b>
                    <small>
                      {eventsQuery.isError
                        ? intl.formatMessage({ id: "reports.daily.scheduleRetryDescription" })
                        : eventsQuery.isLoading
                          ? intl.formatMessage({ id: "reports.daily.scheduleLoading" })
                          : intl.formatMessage(
                              { id: "reports.daily.scheduleCounts" },
                              {
                                past: pastEventCount,
                                remaining: Math.max(0, todayEvents.length - pastEventCount),
                              },
                            )}
                    </small>
                  </span>
                  <button type="button" className="dr-link hy-press" onClick={() => navigate("/event-form", { state: { childId: activeChild.id } })}>
                    {intl.formatMessage({ id: "reports.daily.addSchedule" })}
                  </button>
                </div>
                {eventsQuery.isError ? (
                  <div className="dr-section-error" role="alert" aria-live="assertive">
                    <AlertTriangle size={19} strokeWidth={2.3} aria-hidden="true" />
                    <span>
                      <b>{intl.formatMessage({ id: "reports.daily.scheduleErrorTitle" })}</b>
                      <small>{intl.formatMessage({ id: "reports.daily.networkRetryDescription" })}</small>
                    </span>
                    <button
                      type="button"
                      className="dr-section-error__retry hy-press hy-busy-quiet"
                      onClick={() => void eventsQuery.refetch()}
                      disabled={eventsQuery.isFetching} aria-busy={eventsQuery.isFetching}
                    >
                      <RefreshCw
                        size={15}
                        strokeWidth={2.4}
                        className={eventsQuery.isFetching ? "dr-spin" : undefined}
                      />
                      {eventsQuery.isFetching
                        ? intl.formatMessage({ id: "reports.daily.scheduleChecking" })
                        : intl.formatMessage({ id: "reports.daily.retrySchedule" })}
                    </button>
                  </div>
                ) : eventsQuery.isLoading ? (
                  <Loading label={intl.formatMessage({ id: "reports.daily.scheduleLoading" })} />
                ) : todayEvents.length === 0 ? (
                  <div className="dr-emptyline">{intl.formatMessage({ id: "reports.daily.noScheduleToday" })}</div>
                ) : (
                  <div className="dr-event-list">
                    {todayEvents.slice(0, 3).map((event) => (
                      <div key={event.id} className="dr-event">
                        <span className="dr-event__emoji" style={{ background: event.soft }}>
                          <img src={asset(event.icon)} alt="" loading="lazy" decoding="async" />
                        </span>
                        <span className="dr-event__main">
                          <b>{event.title}</b>
                          <small>{event.time}{event.place ? ` · ${event.place}` : ""}</small>
                        </span>
                        <span className="dr-event__tag" style={{ color: event.tagText, background: event.tagBg }}>
                          {event.tagLabel}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="hy-card dr-section">
                <div className="dr-section__head dr-section__head--large">
                  <span className="dr-section__icon dr-tone--cream">
                  <img src={asset("cat/study.webp")} alt="" loading="lazy" decoding="async" />
                  </span>
                  <span>
                    <b>{intl.formatMessage({ id: "reports.daily.supplies" })}</b>
                    <small>{intl.formatMessage({ id: "reports.daily.suppliesDescription" })}</small>
                  </span>
                </div>
                {suppliesQuery.isError ? (
                  <div className="dr-section-error" role="alert" aria-live="assertive">
                    <AlertTriangle size={19} strokeWidth={2.3} aria-hidden="true" />
                    <span>
                      <b>{intl.formatMessage({ id: "reports.daily.suppliesErrorTitle" })}</b>
                      <small>{intl.formatMessage({ id: "reports.daily.networkRetryDescription" })}</small>
                    </span>
                    <button
                      type="button"
                      className="dr-section-error__retry hy-press hy-busy-quiet"
                      onClick={() => void suppliesQuery.refetch()}
                      disabled={suppliesQuery.isFetching} aria-busy={suppliesQuery.isFetching}
                    >
                      <RefreshCw
                        size={15}
                        strokeWidth={2.4}
                        className={suppliesQuery.isFetching ? "dr-spin" : undefined}
                      />
                      {suppliesQuery.isFetching
                        ? intl.formatMessage({ id: "reports.daily.suppliesChecking" })
                        : intl.formatMessage({ id: "reports.daily.retrySupplies" })}
                    </button>
                  </div>
                ) : suppliesQuery.isLoading ? (
                  <Loading label={intl.formatMessage({ id: "reports.daily.supplyLoading" })} />
                ) : supplySummary.total === 0 ? (
                  <div className="dr-emptyline">{intl.formatMessage({ id: "reports.daily.noSuppliesToday" })}</div>
                ) : (
                  <>
                    <div className="dr-progress">
                      <span style={{ width: `${supplyPercent}%` }} />
                    </div>
                    <div className="dr-note">
                      {intl.formatMessage(
                        { id: "reports.daily.supplyProgress" },
                        {
                          done: supplySummary.done,
                          total: supplySummary.total,
                          remaining: supplySummary.remaining,
                        },
                      )}
                    </div>
                    {supplySummary.remainingLabels.length > 0 && (
                      <div className="dr-chips">
                        {supplySummary.remainingLabels.map((label) => (
                          <span key={label}>
                            <PackageOpen size={13} strokeWidth={2.4} />
                            {label}
                          </span>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </section>
            </div>

            <section className="hy-card dr-section">
              <div className="dr-section__head dr-section__head--large">
                <span className="dr-section__icon dr-tone--lav">
                  <img src={asset("ui/battery.webp")} alt="" loading="lazy" decoding="async" />
                </span>
                <span>
                  <b>{intl.formatMessage({ id: "reports.daily.deviceStatus" })}</b>
                  <small>{intl.formatMessage({ id: "reports.daily.deviceDescription" })}</small>
                </span>
                <button
                  type="button"
                  className="dr-link hy-press"
                  onClick={() => void refreshDevice()}
                  disabled={refreshingDevice}
                  aria-busy={refreshingDevice}
                >
                  <RefreshCw size={14} strokeWidth={2.2} />
                  {refreshingDevice
                    ? intl.formatMessage({ id: "reports.daily.requesting" })
                    : intl.formatMessage({ id: "reports.daily.refresh" })}
                </button>
              </div>
              <div className="dr-device-grid">
                <div>
                  <img src={asset("ui/battery.webp")} alt="" loading="lazy" decoding="async" />
                  <span>{intl.formatMessage({ id: "reports.daily.battery" })}</span>
                  <b>{device.batteryLabel}</b>
                </div>
                <div>
                  <img src={asset("ui/lock-open-3d.webp")} alt="" loading="lazy" decoding="async" />
                  <span>{intl.formatMessage({ id: "reports.daily.unlock" })}</span>
                  <b>{device.unlockCountLabel}</b>
                </div>
                <div>
                  <img src={asset("ui/wifi-3d.webp")} alt="" loading="lazy" decoding="async" />
                  <span>{intl.formatMessage({ id: "reports.daily.network" })}</span>
                  <b>{device.networkLabel}</b>
                </div>
                <div>
                  <img src={asset("ui/clock-3d.webp")} alt="" loading="lazy" decoding="async" />
                  <span>{intl.formatMessage({ id: "reports.daily.lastChecked" })}</span>
                  <b>{device.freshnessLabel}</b>
                </div>
              </div>
              <div
                className="dr-notification-health"
                data-state={device.notification.state}
              >
                <BellRing size={17} strokeWidth={2.2} aria-hidden="true" />
                <span>
                  <b>{device.notification.label}</b>
                  <small>{device.notification.detail}</small>
                </span>
              </div>
              <div
                className="dr-notification-health"
                data-state={device.location.state}
              >
                <MapPinned size={17} strokeWidth={2.2} aria-hidden="true" />
                <span>
                  <b>{device.location.label}</b>
                  <small>{device.location.detail}</small>
                </span>
              </div>
              {!device.hasData ? (
                <div className="dr-emptyline">{intl.formatMessage({ id: "reports.daily.deviceRefreshEmpty" })}</div>
              ) : topDeviceApps.length > 0 ? (
                <div className="dr-app-list">
                  {topDeviceApps.map((app) => (
                    <div key={app.id} className="dr-app">
                      <span>{app.name}</span>
                      <b>{app.timeLabel}</b>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="dr-emptyline">
                  {device.appUsagePermissionGranted
                    ? intl.formatMessage({ id: "reports.daily.noOtherApps" })
                    : intl.formatMessage({ id: "reports.daily.appPermission" })}
                </div>
              )}
            </section>

            <section className="hy-card dr-section">
              <div className="dr-section__head dr-section__head--large">
                <span className="dr-section__icon dr-tone--rose">
                  <img src={asset("ui/chat-heart.webp")} alt="" loading="lazy" decoding="async" />
                </span>
                <span>
                  <b>{intl.formatMessage({ id: "reports.daily.latestNews" })}</b>
                  <small>{intl.formatMessage({ id: "reports.daily.latestNewsDescription" })}</small>
                </span>
                <button type="button" className="dr-link hy-press" onClick={() => navigate("/parent/memo")}>
                  {intl.formatMessage({ id: "reports.daily.openChat" })}
                </button>
              </div>
              {memoThread.isError ? (
                <div className="dr-section-error" role="alert" aria-live="assertive">
                  <AlertTriangle size={19} strokeWidth={2.3} aria-hidden="true" />
                  <span>
                    <b>{intl.formatMessage({ id: "reports.daily.memoErrorTitle" })}</b>
                    <small>{intl.formatMessage({ id: "reports.daily.networkRetryDescription" })}</small>
                  </span>
                  <button
                    type="button"
                    className="dr-section-error__retry hy-press hy-busy-quiet"
                    onClick={() => void memoThread.refetch()}
                    disabled={memoThread.isFetching} aria-busy={memoThread.isFetching}
                  >
                    <RefreshCw
                      size={15}
                      strokeWidth={2.4}
                      className={memoThread.isFetching ? "dr-spin" : undefined}
                    />
                    {memoThread.isFetching
                      ? intl.formatMessage({ id: "reports.daily.memoChecking" })
                      : intl.formatMessage({ id: "reports.daily.retryMemo" })}
                  </button>
                </div>
              ) : memoThread.isLoading ? (
                <Loading label={intl.formatMessage({ id: "reports.daily.memoLoading" })} />
              ) : memoPreview.length === 0 ? (
                <div className="dr-emptyline">{intl.formatMessage({ id: "reports.daily.noMemoToday" })}</div>
              ) : (
                <div className="dr-memos">
                  {memoPreview.map((memo) => (
                    <div key={memo.id} className="dr-memo">
                      <span className="dr-memo__icon">
                        <MessageSquareText size={15} strokeWidth={2.2} />
                      </span>
                      <span>
                        {memo.user_role === "child"
                          ? childName
                          : intl.formatMessage({ id: "reports.daily.parentSender" })}
                      </span>
                      <b>{memo.content}</b>
                      <small>{formatShortTime(memo.created_at, locale)}</small>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* 하루 대시보드는 알림으로도 오지만, 놓쳤을 때 여기서도 열 수 있어야 한다. */}
            <section className="hy-card dr-more">
              <button type="button" className="dr-weekly hy-press" onClick={() => navigate("/child-digest")}>
                <span className="dr-weekly__icon">
                  <img src={asset("ui/chart-3d.webp")} alt="" loading="lazy" decoding="async" />
                </span>
                <span>
                  <b>{intl.formatMessage({ id: "reports.digest.entryTitle" })}</b>
                  <small>{intl.formatMessage({ id: "reports.digest.entryDescription" })}</small>
                </span>
                <ChevronRight size={20} strokeWidth={2.4} />
              </button>

              <button type="button" className="dr-weekly hy-press" onClick={() => navigate("/day-summary")}>
                <span className="dr-weekly__icon">
                  <img src={asset("ui/ai-robot.webp")} alt="" loading="lazy" decoding="async" />
                </span>
                <span>
                  <b>{intl.formatMessage({ id: "reports.daily.aiSummaryTitle" })}</b>
                  <small>{intl.formatMessage({ id: "reports.daily.aiSummaryDescription" })}</small>
                </span>
                <ChevronRight size={20} strokeWidth={2.4} />
              </button>

              <button type="button" className="dr-weekly hy-press" onClick={() => navigate("/weekly-report")}>
                <span className="dr-weekly__icon">
                  <img src={asset("ui/sparkle.webp")} alt="" loading="lazy" decoding="async" />
                </span>
                <span>
                  <b>{intl.formatMessage({ id: "reports.daily.weeklyTitle" })}</b>
                  <small>
                    {intl.formatMessage({
                      id: entitlement.isPremium
                        ? "reports.daily.weeklyOpen"
                        : "reports.daily.weeklyPremium",
                    })}
                  </small>
                </span>
                <ChevronRight size={20} strokeWidth={2.4} />
              </button>
            </section>

            {!entitlement.isPremium && entitlement.ready && (
              <section className="hy-card dr-premium">
                <img className="dr-premium__crown" src={asset("ui/crown.webp")} alt="" loading="lazy" decoding="async" />
                <div>
                  <b>{intl.formatMessage({ id: "reports.daily.premiumTitle" })}</b>
                  <p>{intl.formatMessage({ id: "reports.daily.premiumDescription" })}</p>
                </div>
                <button type="button" className="hy-press" onClick={() => navigate("/subscription")}>
                  {intl.formatMessage({ id: "reports.daily.premiumCta" })}
                </button>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

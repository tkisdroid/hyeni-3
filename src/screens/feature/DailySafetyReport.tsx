import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  Battery,
  BellRing,
  ChevronLeft,
  ChevronRight,
  Clock3,
  MapPinned,
  MessageSquareText,
  PackageOpen,
  RefreshCw,
  ShieldCheck,
  Wifi,
  Zap,
} from "lucide-react";
import { asset } from "@/lib/assets";
import { resolveEventCharacter } from "@/transform/eventCharacter";
import { useToast } from "@/app/toast";
import { useAuth } from "@/auth/AuthContext";
import { useActiveChild } from "@/app/activeChild";
import { useEvents, useDailySupplies } from "@/queries/useSchedule";
import { useChildLocations, useSavedPlaces } from "@/queries/useLocation";
import { useLocationLabels } from "@/queries/useLocationLabels";
import { useMemoThread } from "@/queries/useMemo";
import { useParentAlerts } from "@/queries/useNotifications";
import { useEntitlement } from "@/queries/useEntitlement";
import { requestDeviceStatus } from "@/lib/api/endpoints/remote";
import { todayDateKey } from "@/transform/dateKey";
import { filterEventsForChild } from "@/transform/eventScope";
import { groupEventsByDateKey, PAST_TAGS } from "@/transform/scheduleView";
import { deviceStatusView } from "@/transform/familyView";
import { formatFreshness } from "@/transform/locationView";
import { deriveDailyReportStatus, summarizeDailySupplies, type DailyReportAlertInput } from "@/transform/dailyReportView";
import { isLocationVisible } from "@/transform/tierPolicy";
import { useMessage } from "@/i18n/useMessage";
import "./DailySafetyReport.css";

function formatShortTime(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatClock(value: Date): string {
  return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
}

function isSameLocalDay(value: string | null | undefined, now: Date): boolean {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function alertLabel(alert: DailyReportAlertInput): string {
  const type = alert.alert_type.toLowerCase();
  if (type === "sos" || type === "sos_followup") return "SOS 알림";
  if (type === "emergency") return "긴급 알림";
  if (type === "not_arrived") return "미도착 알림";
  if (type === "danger_zone" || type === "danger_zone_entry") return "위험구역 진입";
  if (type === "danger_zone_exit") return "위험구역 이탈";
  return "안전 알림";
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
  const navigate = useNavigate();
  const { show } = useToast();
  const msg = useMessage();
  const { familyId } = useAuth();
  const { activeChild } = useActiveChild();
  const [now, setNow] = useState(() => new Date());
  const [refreshingDevice, setRefreshingDevice] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const todayKey = useMemo(() => todayDateKey(now), [now]);
  const eventsQuery = useEvents();
  const suppliesQuery = useDailySupplies(todayKey);
  const locationsQuery = useChildLocations();
  const placesQuery = useSavedPlaces();
  const alertsQuery = useParentAlerts();
  const memoThread = useMemoThread([todayKey], activeChild?.id ?? null);
  const entitlement = useEntitlement();

  const locations = locationsQuery.data ?? [];
  const places = placesQuery.data ?? [];
  const locationLabel = useLocationLabels(locations, places);
  const childLocation = activeChild?.user_id
    ? locations.find((loc) => loc.user_id === activeChild.user_id) ?? null
    : null;
  const locationFreshness = childLocation ? formatFreshness(childLocation.updated_at, now) : null;
  const locationLocked = entitlement.ready && !isLocationVisible(entitlement.tier);
  const device = useMemo(() => deviceStatusView(activeChild?.device_health, now), [activeChild, now]);

  const todayEvents = useMemo(() => {
    if (!activeChild) return [];
    const dayEvents = filterEventsForChild(eventsQuery.data ?? [], activeChild.id).filter(
      (event) => event.date_key === todayKey,
    );
    const allowedIds = new Set(dayEvents.map((event) => event.id));
    return (groupEventsByDateKey(eventsQuery.data ?? [], now, undefined, places)[todayKey] ?? []).filter((event) =>
      allowedIds.has(event.id),
    );
  }, [activeChild, eventsQuery.data, now, places, todayKey]);
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
    hasActiveChild: !!activeChild,
    alerts: childAlerts,
    locationFreshness: locationFreshness?.status ?? "unknown",
    deviceSafetyLabel: device.safetyLabel,
    deviceHasData: device.hasData,
    now,
  });
  const todayAlerts = useMemo(
    () => childAlerts.filter((alert) => isSameLocalDay(alert.created_at, now)).slice(0, 3),
    [childAlerts, now],
  );
  const reportTimeLabel = useMemo(() => formatClock(now), [now]);
  const supplyPercent = supplySummary.total > 0 ? Math.round((supplySummary.done / supplySummary.total) * 100) : 0;
  const overviewCards = useMemo<ReportOverviewCard[]>(() => {
    const locationTone: ReportTone = locationLocked
      ? "lav"
      : !childLocation || locationFreshness?.status === "stale"
        ? "cream"
        : "mint";
    return [
      {
        id: "location",
        label: "최근 위치",
        value: locationLocked ? "잠금" : childLocation ? locationLabel(childLocation) : "확인 중",
        detail: locationLocked ? "프리미엄에서 상세 위치 확인" : locationFreshness?.label ?? "위치 정보 없음",
        tone: locationTone,
        icon: <img src={asset("ui/pin-heart.webp")} alt="" />,
      },
      {
        id: "schedule",
        label: "오늘 일정",
        value: `${todayEvents.length}개`,
        detail: nextEvent ? `${nextEvent.title}${nextEvent.time ? ` · ${nextEvent.time}` : ""}` : "남은 일정 없음",
        tone: todayEvents.length > 0 ? "blue" : "mint",
        icon: <img src={asset("ui/calendar-heart.webp")} alt="" />,
      },
      {
        id: "supplies",
        label: "준비물",
        value: supplySummary.total === 0 ? "없음" : `${supplySummary.done}/${supplySummary.total}`,
        detail: supplySummary.total === 0 ? "오늘 챙길 항목 없음" : `${supplyPercent}% 완료`,
        tone: supplySummary.remaining > 0 ? "cream" : "mint",
        icon: <img src={asset("cat/study.webp")} alt="" />,
      },
      {
        id: "device",
        label: "기기 상태",
        value: device.safetyLabel,
        detail: device.hasData ? `${device.batteryLabel} · ${device.networkLabel}` : "새로고침으로 확인 필요",
        tone: device.safetyLabel === "주의 필요" || !device.hasData ? "cream" : "mint",
        icon: <img src={asset("ui/battery.webp")} alt="" />,
      },
    ];
  }, [
    childLocation,
    device.batteryLabel,
    device.hasData,
    device.networkLabel,
    device.safetyLabel,
    locationFreshness?.label,
    locationFreshness?.status,
    locationLabel,
    locationLocked,
    nextEvent,
    supplyPercent,
    supplySummary.done,
    supplySummary.remaining,
    supplySummary.total,
    todayEvents.length,
  ]);
  const safetySignals = useMemo<ReportOverviewCard[]>(
    () => [
      {
        id: "alert",
        label: "안전 알림",
        value: todayAlerts.length > 0 ? `${todayAlerts.length}건` : "0건",
        detail: todayAlerts[0] ? alertLabel(todayAlerts[0]) : "오늘 긴급 신호 없음",
        tone: statusView.status === "danger" ? "danger" : todayAlerts.length > 0 ? "cream" : "mint",
        icon: <img src={asset(todayAlerts.length > 0 ? "ui/bell.webp" : "ui/shield-heart.webp")} alt="" />,
      },
      {
        id: "freshness",
        label: "위치 신선도",
        value: locationLocked ? "잠금" : locationFreshness?.label ?? "없음",
        detail: childLocation ? "아이 기기 위치 기준" : "위치 기록 대기 중",
        tone: locationLocked ? "lav" : locationFreshness?.status === "stale" || !childLocation ? "cream" : "mint",
        icon: <img src={asset("ui/pin.webp")} alt="" />,
      },
      {
        id: "device-signal",
        label: "기기 리포트",
        value: device.freshnessLabel,
        detail: device.hasData ? device.chargingLabel : "아이 앱 연결 후 표시",
        tone: device.hasData ? "blue" : "cream",
        icon: <img src={asset("ui/battery.webp")} alt="" />,
      },
    ],
    [
      childLocation,
      device.chargingLabel,
      device.freshnessLabel,
      device.hasData,
      locationFreshness?.label,
      locationFreshness?.status,
      locationLocked,
      statusView.status,
      todayAlerts,
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

  const refreshDevice = async () => {
    if (!familyId || refreshingDevice) return;
    setRefreshingDevice(true);
    try {
      await requestDeviceStatus(familyId, activeChild?.user_id ?? null);
      show("아이 기기에 상태 확인을 요청했어요", "📱");
    } catch (error) {
      console.error("기기 상태 확인 요청 실패:", error);
      show("기기 상태 요청에 실패했어요. 잠시 후 다시 시도해 주세요", "⚠️");
    } finally {
      setRefreshingDevice(false);
    }
  };

  const childName = activeChild?.name ?? "아이";

  return (
    <div className="dr-root">
      <header className="dr-header">
        <button type="button" className="dr-back hy-press" aria-label="뒤로" onClick={() => navigate(-1)}>
          <ChevronLeft size={22} strokeWidth={2.2} />
        </button>
        <div className="dr-head-main">
          <div className="dr-title">{msg.dailyReportTitle}</div>
          <div className="dr-subtitle">{msg.dailyReportSubtitle}</div>
        </div>
      </header>

      <div className="dr-content">
        {!activeChild ? (
          <section className="hy-card dr-empty">
            <ShieldCheck size={38} strokeWidth={2.1} />
            <div className="dr-empty__title">연결된 아이가 없어요</div>
            <p>아이를 연결하면 오늘의 위치, 일정, 준비물, 기기 상태를 한 화면에서 볼 수 있어요.</p>
            <button type="button" className="dr-primary hy-press" onClick={() => navigate("/child-invite")}>
              아이 연결하기
            </button>
          </section>
        ) : (
          <>
            <section className={`dr-hero dr-hero--${statusView.status}`}>
              <div className="dr-hero__copy">
                <div className="dr-hero__eyebrow">{childName} · 오늘</div>
                <div className="dr-hero__title">{statusView.title}</div>
                <p>{statusView.description}</p>
                <div className="dr-hero__chips">
                  <span>
                    <Clock3 size={14} strokeWidth={2.3} />
                    {reportTimeLabel} 기준
                  </span>
                  <span>
                    <ShieldCheck size={14} strokeWidth={2.3} />
                    {todayAlerts.length > 0 ? `알림 ${todayAlerts.length}건` : "알림 없음"}
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
                  />
                </span>
                <span className="dr-hero__mini dr-hero__mini--map">
                  <img src={asset("ui/pin-heart.webp")} alt="" />
                </span>
                <span className="dr-hero__mini dr-hero__mini--battery">
                  <img src={asset("ui/battery.webp")} alt="" />
                </span>
                <span className="dr-hero__mini dr-hero__mini--calendar">
                  <img src={asset("ui/calendar-heart.webp")} alt="" />
                </span>
              </div>
            </section>

            <section className="dr-overview" aria-label="오늘 주요 지표">
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
                  <img src={asset("ui/safety-mascot.webp")} alt="" />
                </span>
                <span>
                  <b>안전 신호</b>
                  <small>위치, 기기, 알림을 함께 봅니다</small>
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
                      <span>{alertLabel(alert)}</span>
                      <small>{formatShortTime(alert.created_at) || "시간 확인 중"}</small>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="hy-card dr-section">
              <div className="dr-section__head dr-section__head--large">
                <span className="dr-section__icon dr-tone--mint">
                  <img src={asset("ui/pin-heart.webp")} alt="" />
                </span>
                <span>
                  <b>이동 요약</b>
                  <small>오늘 위치 흐름을 확인합니다</small>
                </span>
                <button type="button" className="dr-link hy-press" onClick={() => navigate("/parent/location?view=history")}>
                  지도 보기
                  <ChevronRight size={14} strokeWidth={2.4} />
                </button>
              </div>
              {locationLocked ? (
                <div className="dr-lock">
                  실시간 위치는 프리미엄에서 확인할 수 있어요. SOS와 긴급 알림은 계속 무료로 받을 수 있어요.
                </div>
              ) : childLocation ? (
                <div className="dr-feature-row">
                  <span className="dr-feature-row__icon dr-tone--mint">
                    <MapPinned size={22} strokeWidth={2.2} />
                  </span>
                  <span className="dr-feature-row__main">
                    <b>{locationLabel(childLocation)}</b>
                    <small>마지막 업데이트 · {locationFreshness?.label ?? "위치 정보 없음"}</small>
                  </span>
                </div>
              ) : (
                <div className="dr-emptyline">아직 오늘 위치 기록이 없어요.</div>
              )}
            </section>

            <div className="dr-duo">
              <section className="hy-card dr-section">
                <div className="dr-section__head dr-section__head--large">
                  <span className="dr-section__icon dr-tone--blue">
                    <img src={asset("ui/calendar-heart.webp")} alt="" />
                  </span>
                  <span>
                    <b>일정 체크</b>
                    <small>지난 일정 {pastEventCount}개 · 남은 일정 {Math.max(0, todayEvents.length - pastEventCount)}개</small>
                  </span>
                  <button type="button" className="dr-link hy-press" onClick={() => navigate("/event-form", { state: { childId: activeChild.id } })}>
                    일정 추가
                  </button>
                </div>
                {todayEvents.length === 0 ? (
                  <div className="dr-emptyline">오늘 일정이 없어요.</div>
                ) : (
                  <div className="dr-event-list">
                    {todayEvents.slice(0, 3).map((event) => (
                      <div key={event.id} className="dr-event">
                        <span className="dr-event__emoji" style={{ background: event.soft }}>
                          <img src={asset(resolveEventCharacter(event.title))} alt="" />
                        </span>
                        <span className="dr-event__main">
                          <b>{event.title}</b>
                          <small>{event.time}{event.place ? ` · ${event.place}` : ""}</small>
                        </span>
                        <span className="dr-event__tag" style={{ color: event.tagText, background: event.tagBg }}>
                          {event.tag}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="hy-card dr-section">
                <div className="dr-section__head dr-section__head--large">
                  <span className="dr-section__icon dr-tone--cream">
                    <img src={asset("cat/study.webp")} alt="" />
                  </span>
                  <span>
                    <b>준비물</b>
                    <small>가방에 챙길 항목을 점검합니다</small>
                  </span>
                </div>
                {supplySummary.total === 0 ? (
                  <div className="dr-emptyline">오늘 챙길 준비물이 없어요.</div>
                ) : (
                  <>
                    <div className="dr-progress">
                      <span style={{ width: `${supplyPercent}%` }} />
                    </div>
                    <div className="dr-note">
                      {supplySummary.done}/{supplySummary.total}개 완료 · 남은 준비물 {supplySummary.remaining}개
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
                  <img src={asset("ui/battery.webp")} alt="" />
                </span>
                <span>
                  <b>기기 상태</b>
                  <small>배터리, 네트워크, 앱 사용 흐름</small>
                </span>
                <button type="button" className="dr-link hy-press" onClick={() => void refreshDevice()} disabled={refreshingDevice}>
                  <RefreshCw size={14} strokeWidth={2.2} />
                  {refreshingDevice ? "요청 중" : "새로고침"}
                </button>
              </div>
              <div className="dr-device-grid">
                <div>
                  <Battery size={17} strokeWidth={2.2} />
                  <span>배터리</span>
                  <b>{device.batteryLabel}</b>
                </div>
                <div>
                  <Zap size={17} strokeWidth={2.2} />
                  <span>충전</span>
                  <b>{device.chargingLabel}</b>
                </div>
                <div>
                  <Wifi size={17} strokeWidth={2.2} />
                  <span>네트워크</span>
                  <b>{device.networkLabel}</b>
                </div>
                <div>
                  <Clock3 size={17} strokeWidth={2.2} />
                  <span>마지막 확인</span>
                  <b>{device.freshnessLabel}</b>
                </div>
              </div>
              {!device.hasData ? (
                <div className="dr-emptyline">기기 상태를 확인하려면 새로고침을 눌러 주세요.</div>
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
                <div className="dr-emptyline">사용정보 접근 권한을 켜면 많이 쓴 앱이 표시돼요.</div>
              )}
            </section>

            <section className="hy-card dr-section">
              <div className="dr-section__head dr-section__head--large">
                <span className="dr-section__icon dr-tone--rose">
                  <img src={asset("ui/chat-heart.webp")} alt="" />
                </span>
                <span>
                  <b>최신 소식</b>
                  <small>오늘 아이와 주고받은 메시지</small>
                </span>
                <button type="button" className="dr-link hy-press" onClick={() => navigate("/parent/memo")}>
                  대화 열기
                </button>
              </div>
              {memoPreview.length === 0 ? (
                <div className="dr-emptyline">오늘 주고받은 메시지가 없어요.</div>
              ) : (
                <div className="dr-memos">
                  {memoPreview.map((memo) => (
                    <div key={memo.id} className="dr-memo">
                      <span className="dr-memo__icon">
                        <MessageSquareText size={15} strokeWidth={2.2} />
                      </span>
                      <span>{memo.user_role === "child" ? childName : "부모님"}</span>
                      <b>{memo.content}</b>
                      <small>{formatShortTime(memo.created_at)}</small>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <button type="button" className="hy-card dr-weekly hy-press" onClick={() => navigate("/day-summary")}>
              <span className="dr-weekly__icon">
                <img src={asset("ui/ai-robot.png")} alt="" />
              </span>
              <span>
                <b>AI 하루 요약 보기</b>
                <small>일정·위치·안전 기록을 AI가 정리해 드려요</small>
              </span>
              <ChevronRight size={20} strokeWidth={2.4} />
            </button>

            <button type="button" className="hy-card dr-weekly hy-press" onClick={() => navigate("/weekly-report")}>
              <span className="dr-weekly__icon">
                <img src={asset("ui/sparkle.webp")} alt="" />
              </span>
              <span>
                <b>이번 주 흐름 보기</b>
                <small>{entitlement.isPremium ? "주간 가족 리포트로 이동해요" : "프리미엄으로 주간 리포트 보기"}</small>
              </span>
              <ChevronRight size={20} strokeWidth={2.4} />
            </button>

            {!entitlement.isPremium && entitlement.ready && (
              <section className="dr-premium">
                <img className="dr-premium__crown" src={asset("ui/crown.webp")} alt="" />
                <div>
                  <b>프리미엄으로 더 자세히 확인하세요</b>
                  <p>실시간 위치, 주간 리포트, AI 하루 요약까지 함께 볼 수 있어요.</p>
                </div>
                <button type="button" className="hy-press" onClick={() => navigate("/subscription")}>
                  프리미엄 보기
                </button>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

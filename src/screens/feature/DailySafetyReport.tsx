import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Battery,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Crown,
  MapPin,
  MessageCircle,
  PackageCheck,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
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
import { deriveDailyReportStatus, summarizeDailySupplies } from "@/transform/dailyReportView";
import { isLocationVisible } from "@/transform/tierPolicy";
import { useMessage } from "@/i18n/useMessage";
import "./DailySafetyReport.css";

function formatShortTime(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
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
              <div className="dr-hero__icon">
                {statusView.status === "danger" ? (
                  <AlertTriangle size={30} strokeWidth={2.2} />
                ) : (
                  <ShieldCheck size={30} strokeWidth={2.2} />
                )}
              </div>
              <div className="dr-hero__body">
                <div className="dr-hero__eyebrow">{childName} · 오늘</div>
                <div className="dr-hero__title">{statusView.title}</div>
                <p>{statusView.description}</p>
              </div>
            </section>

            <section className="hy-card dr-section">
              <div className="dr-section__head">
                <MapPin size={20} strokeWidth={2.2} />
                <b>이동 요약</b>
              </div>
              {locationLocked ? (
                <div className="dr-lock">
                  실시간 위치는 프리미엄에서 확인할 수 있어요. SOS와 긴급 알림은 계속 무료로 받을 수 있어요.
                </div>
              ) : childLocation ? (
                <div className="dr-kv">
                  <span>최근 위치</span>
                  <strong>{locationLabel(childLocation)}</strong>
                  <span>업데이트</span>
                  <strong>{locationFreshness?.label ?? "위치 정보 없음"}</strong>
                </div>
              ) : (
                <div className="dr-emptyline">아직 오늘 위치 기록이 없어요.</div>
              )}
            </section>

            <section className="hy-card dr-section">
              <div className="dr-section__head">
                <CalendarDays size={20} strokeWidth={2.2} />
                <b>일정 체크</b>
                <button type="button" className="dr-link hy-press" onClick={() => navigate("/event-form", { state: { childId: activeChild.id } })}>
                  일정 추가
                </button>
              </div>
              <div className="dr-kv">
                <span>오늘 일정</span>
                <strong>{todayEvents.length}개</strong>
                <span>지난 일정</span>
                <strong>{pastEventCount}개</strong>
                <span>다음 일정</span>
                <strong>{nextEvent ? `${nextEvent.title}${nextEvent.time ? ` · ${nextEvent.time}` : ""}` : "없어요"}</strong>
              </div>
            </section>

            <section className="hy-card dr-section">
              <div className="dr-section__head">
                <PackageCheck size={20} strokeWidth={2.2} />
                <b>준비물</b>
              </div>
              {supplySummary.total === 0 ? (
                <div className="dr-emptyline">오늘 챙길 준비물이 없어요.</div>
              ) : (
                <>
                  <div className="dr-progress">
                    <span style={{ width: `${Math.round((supplySummary.done / supplySummary.total) * 100)}%` }} />
                  </div>
                  <div className="dr-note">
                    {supplySummary.done}/{supplySummary.total}개 완료 · 남은 준비물 {supplySummary.remaining}개
                  </div>
                  {supplySummary.remainingLabels.length > 0 && (
                    <div className="dr-chips">
                      {supplySummary.remainingLabels.map((label) => (
                        <span key={label}>{label}</span>
                      ))}
                    </div>
                  )}
                </>
              )}
            </section>

            <section className="hy-card dr-section">
              <div className="dr-section__head">
                <Battery size={20} strokeWidth={2.2} />
                <b>기기 상태</b>
                <button type="button" className="dr-link hy-press" onClick={() => void refreshDevice()} disabled={refreshingDevice}>
                  <RefreshCw size={14} strokeWidth={2.2} />
                  {refreshingDevice ? "요청 중" : "새로고침"}
                </button>
              </div>
              <div className="dr-kv">
                <span>배터리</span>
                <strong>{device.batteryLabel}</strong>
                <span>충전</span>
                <strong>{device.chargingLabel}</strong>
                <span>네트워크</span>
                <strong>{device.networkLabel}</strong>
                <span>마지막 확인</span>
                <strong>{device.freshnessLabel}</strong>
              </div>
              {!device.hasData && <div className="dr-emptyline">기기 상태를 확인하려면 새로고침을 눌러 주세요.</div>}
            </section>

            <section className="hy-card dr-section">
              <div className="dr-section__head">
                <MessageCircle size={20} strokeWidth={2.2} />
                <b>최신 소식</b>
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
                      <span>{memo.user_role === "child" ? childName : "부모님"}</span>
                      <b>{memo.content}</b>
                      <small>{formatShortTime(memo.created_at)}</small>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <button type="button" className="hy-card dr-weekly hy-press" onClick={() => navigate("/weekly-report")}>
              <span>
                <b>이번 주 흐름 보기</b>
                <small>{entitlement.isPremium ? "주간 가족 리포트로 이동해요" : "프리미엄으로 주간 리포트 보기"}</small>
              </span>
              <ChevronRight size={20} strokeWidth={2.4} />
            </button>

            {!entitlement.isPremium && entitlement.ready && (
              <section className="dr-premium">
                <Crown size={22} strokeWidth={2.2} />
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

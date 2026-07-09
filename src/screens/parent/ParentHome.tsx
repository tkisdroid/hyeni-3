import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Settings, ChevronRight, Clock, Zap, Wifi, Check, MapPin, Smartphone, Mic, Keyboard, Image as ImageIcon } from "lucide-react";
import { asset } from "@/lib/assets";
import { childAvatarPath } from "@/lib/avatar";
import { useToast } from "@/app/toast";
import { Loading } from "@/components/ui/Loading";
import { TopBar } from "@/components/ui/TopBar";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { shortcuts } from "@/data/mock";
import { useEvents, useDailySupplies, useUpsertDailySupply } from "@/queries/useSchedule";
import type { CalendarEvent, DailySupply } from "@/lib/api/endpoints/schedule";
import { useParentAlerts } from "@/queries/useNotifications";
import { countUnread } from "@/transform/notificationsView";
import { useMyFamily } from "@/queries/useFamily";
import { useActiveChild } from "@/app/activeChild";
import { useAuth } from "@/auth/AuthContext";
import { requestDeviceStatus } from "@/lib/api/endpoints/remote";
import { loadKakaoMaps } from "@/lib/kakaoMap";
import { useChildLocations, useSavedPlaces } from "@/queries/useLocation";
import { useLocationLabels } from "@/queries/useLocationLabels";
import type { ChildLocation } from "@/lib/api/endpoints/location";
import { groupEventsByDateKey, PAST_TAGS, type CalEventView } from "@/transform/scheduleView";
import { useVisitVerify } from "@/queries/useVisitVerify";
import { todayDateKey } from "@/transform/dateKey";
import { filterEventsForChild } from "@/transform/eventScope";
import { formatFreshness } from "@/transform/locationView";
import { deviceStatusView } from "@/transform/familyView";
import "./ParentHome.css";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

function avatarSrc(path: string): string {
  return path.startsWith("http") ? path : asset(path);
}

const SCHEDULE_PLACE_RADIUS_M = 150;

type ChildScheduleEvent = {
  raw: CalendarEvent;
  view: CalEventView;
};

function eventLocationPoint(event: CalendarEvent): { lat: number; lng: number } | null {
  const lat = event.location?.lat;
  const lng = event.location?.lng;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function eventTitleForPlace(event: CalendarEvent, view: CalEventView): string {
  const title = (event.title || view.title || "").trim();
  if (title) return title;
  return (event.location?.address || "일정 장소").trim();
}

function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

function schedulePlaceLabel(loc: ChildLocation, events: ChildScheduleEvent[]): string | null {
  const hits = events
    .map(({ raw, view }) => {
      const point = eventLocationPoint(raw);
      if (!point) return null;
      return {
        raw,
        view,
        distance: distanceM(loc.lat, loc.lng, point.lat, point.lng),
      };
    })
    .filter((hit): hit is { raw: CalendarEvent; view: CalEventView; distance: number } =>
      hit !== null && hit.distance <= SCHEDULE_PLACE_RADIUS_M,
    )
    .sort((a, b) => {
      const priority = (tag: CalEventView["tag"]) => {
        if (tag === "진행 중") return 0;
        if (tag === "예정") return 1;
        return 2;
      };
      const pa = priority(a.view.tag);
      const pb = priority(b.view.tag);
      return pa - pb || a.distance - b.distance;
    });
  const hit = hits[0];
  if (!hit) return null;
  return `${eventTitleForPlace(hit.raw, hit.view)} 근처`;
}

const shortcutRoutes: Record<string, string> = {
  "AI 일정": "/ai-schedule",
  "위치추적": "/parent/location?view=history",
  "친구놀이": "/friend-play",
  "장소관리": "/place-manager",
  "주변소리": "/remote-audio",
  "안심리포트": "/daily-report",
  "구독": "/subscription",
  "알림": "/notifications",
};

export function ParentHome() {
  const navigate = useNavigate();
  const { show } = useToast();

  // ── 실 데이터: 오늘 일정 + 아이 현황(가족·위치) ──
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const todayKey = useMemo(() => todayDateKey(now), [now]);

  const eventsQuery = useEvents();
  const familyQuery = useMyFamily();
  const locationsQuery = useChildLocations();
  const placesQuery = useSavedPlaces();
  const events = eventsQuery.data;
  const family = familyQuery.data;
  const locations = locationsQuery.data;

  // 아이 기기 상태 새로고침 요청 — 네이티브 device_health 리포트는 on-demand 라
  // 홈 진입 시 1회 요청해야 안전지표가 채워진다(도착하면 WS 브릿지가 자동 반영).
  const { familyId } = useAuth();
  const statusRequestedRef = useRef(false);
  useEffect(() => {
    if (statusRequestedRef.current || !familyId) return;
    statusRequestedRef.current = true;
    void requestDeviceStatus(familyId);
  }, [familyId]);
  const places = placesQuery.data;
  const locationLabel = useLocationLabels(locations, places);

  // 홈 바로가기에서 위치추적을 누를 때 지도 SDK 다운로드 대기 시간을 줄인다.
  useEffect(() => {
    void loadKakaoMaps().catch(() => undefined);
  }, []);

  // 알림 벨 빨간 점 + 바로가기 배지 — 실제 미읽음 알림 개수 기반(하드코딩 항상-3 제거).
  const alertsQuery = useParentAlerts();
  const unreadCount = useMemo(
    () => countUnread(alertsQuery.data ?? []),
    [alertsQuery.data],
  );
  const hasUnreadAlerts = unreadCount > 0;

  // 활성 아이(전역 스위치) — 홈 카드 탭으로만 전환. 안전지표·오늘일정·준비물이 이 아이 기준.
  const { activeChild, setActiveChildId } = useActiveChild();

  // 준비물·숙제: 오늘 date_key 의 daily-supplies 실데이터 + 체크 토글(서버 업서트).
  // 서버 응답은 모든 아이가 섞여 있으므로 활성 아이(activeChild.id = child_user_id)만 필터.
  const suppliesQuery = useDailySupplies(todayKey);
  const prep = useMemo(() => {
    const all = suppliesQuery.data ?? [];
    return activeChild ? all.filter((s) => s.child_user_id === activeChild.id) : all;
  }, [suppliesQuery.data, activeChild]);
  const upsert = useUpsertDailySupply();
  const prepDone = prep.filter((p) => p.done).length;
  const togglePrep = (item: DailySupply) =>
    upsert.mutate(
      {
        id: item.id,
        date_key: todayKey,
        label: item.label,
        done: !item.done,
        kind: item.kind ?? "prep",
        child_user_id: item.child_user_id ?? null,
      },
      { onError: () => show("반영에 실패했어요. 잠시 후 다시 시도해 주세요", "⚠️") },
    );

  // '지금 갱신': 실제 쿼리 리페치 후 결과에 따라 정직하게 토스트(거짓 성공 금지).
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      // 아이 기기에 상태 리포트 재요청(안전지표 실갱신 — 응답은 WS 로 자동 반영).
      if (familyId) void requestDeviceStatus(familyId);
      const results = await Promise.all([
        eventsQuery.refetch(),
        familyQuery.refetch(),
        locationsQuery.refetch(),
        placesQuery.refetch(),
      ]);
      if (results.some((r) => r.isError)) {
        show("갱신에 실패했어요. 잠시 후 다시 시도해 주세요", "⚠️");
      } else {
        show("최신 정보로 갱신했어요", "✅");
      }
    } catch (error) {
      console.error("아이 현황 갱신 실패:", error);
      show("갱신에 실패했어요. 잠시 후 다시 시도해 주세요", "⚠️");
    } finally {
      setRefreshing(false);
    }
  };

  // 지난 일정 "다녀옴" 위치 검증 — 활성 아이 이력으로 방문 확인(미확인=확인 필요).
  const visitMap = useVisitVerify(todayKey, events, activeChild?.user_id ?? null);

  // 오늘 일정 — 활성 아이 배정(events_children.child_id) + 가족 공유(is_family_event)만.
  // 형제에게만 배정된 일정은 활성 아이 화면에서 제외(아이별 구분 — TK 결정).
  const todayEvents = useMemo(() => {
    const byKey = groupEventsByDateKey(events ?? [], now, visitMap, places);
    const all = byKey[todayDateKey(now)] ?? [];
    if (!activeChild) return [];
    const allowedIds = new Set(
      filterEventsForChild(
        (events ?? []).filter((e) => e.date_key === todayKey),
        activeChild.id,
      ).map((e) => e.id),
    );
    return all.filter((v) => allowedIds.has(v.id));
  }, [events, now, todayKey, activeChild, visitMap, places]);

  const childName = activeChild?.name || "아이"; // 히어로·상단 스티커 대상 = 활성 아이

  // 아이별 현황 카드 — 등록된 모든 아이를 각각 위치·기기·다음 일정과 함께 표시(다자녀 = 둘 다).
  // 위치는 각 아이 user_id 로 매칭(폴백 없음 → 없으면 정직하게 "위치 정보 없음"). 다음 일정은
  // events_children(child_id=member.id) 배정 또는 가족 공유(is_family_event) 중 가장 이른 미완료 일정.
  const childCards = useMemo(() => {
    const kids = (family?.members ?? []).filter((m) => m.role === "child");
    const rawToday = (events ?? []).filter((e) => e.date_key === todayKey);
    // 카드별 다음 일정은 활성 아이 필터와 무관하게 "그 카드 아이" 기준으로 계산.
    const allViews = groupEventsByDateKey(events ?? [], now, undefined, places)[todayKey] ?? [];
    return kids.map((kid) => {
      const kidLoc = kid.user_id
        ? (locations ?? []).find((l) => l.user_id === kid.user_id) ?? null
        : null;
      const kidRaw = filterEventsForChild(rawToday, kid.id);
      const rawById = new Map(kidRaw.map((e) => [e.id, e]));
      const kidEvents = allViews
        .map((view) => {
          const raw = rawById.get(view.id);
          return raw ? { raw, view } : null;
        })
        .filter((row): row is ChildScheduleEvent => row !== null);
      const next = kidEvents.find(({ view }) => !PAST_TAGS.has(view.tag))?.view ?? null;
      const eventPlace = kidLoc ? schedulePlaceLabel(kidLoc, kidEvents) : null;
      return {
        id: kid.id,
        name: kid.name || "아이",
        avatar: childAvatarPath(kid.photo_url),
        device: kid.device_label?.trim() || null,
        place: kidLoc ? eventPlace ?? locationLabel(kidLoc) : "위치 확인 중",
        fresh: kidLoc ? formatFreshness(kidLoc.updated_at, now).label : "위치 정보 없음",
        scheduleLabel: next?.tag === "진행 중" ? "진행 중" : "다음 일정",
        next,
      };
    });
  }, [family, events, todayKey, locations, places, now]);

  // 안전 지표 = 활성 아이의 기기 리포트(스위치 전환 시 함께 전환).
  const safetyChildName = activeChild?.name || "아이";
  const deviceStatus = useMemo(
    () => deviceStatusView(activeChild?.device_health, now),
    [activeChild, now],
  );

  const todayLabel = `${WEEKDAYS[now.getDay()]}요일 · ${now.getMonth() + 1}월 ${now.getDate()}일`;

  return (
    <div className="hy-rise-in">
      <TopBar
        actions={
          <>
            <button
              type="button"
              className="ph-stickerbtn hy-press"
              aria-label={`${childName}에게 칭찬 스티커 보내기`}
              onClick={() => navigate("/sticker-send")}
            >
              <img src={asset("ui/menu-sticker.webp")} alt="" />
              <span>스티커</span>
            </button>
            <button
              type="button"
              className="hy-iconbtn hy-press"
              aria-label="알림"
              onClick={() => navigate("/notifications")}
            >
              <Bell size={21} strokeWidth={1.9} />
              {hasUnreadAlerts && <span className="hy-iconbtn__dot" />}
            </button>
            <button
              type="button"
              className="hy-iconbtn hy-press"
              aria-label="설정"
              onClick={() => navigate("/parent/settings")}
            >
              <Settings size={21} strokeWidth={1.9} />
            </button>
          </>
        }
      />

      <div className="hy-content">
        {/* 히어로: 오늘 */}
        <button type="button" className="ph-hero" onClick={() => navigate("/parent/calendar")}>
          <span className="ph-hero__sheen" />
          <span className="ph-hero__mascot">
            <img src={asset("mascot/phone.webp")} alt="" />
          </span>
          <span className="ph-hero__badge">{todayLabel}</span>
          <div className="ph-hero__title">
            {childName}의 오늘,
            <br />
            {eventsQuery.isLoading ? (
              <>
                일정 <em>불러오는 중</em>
              </>
            ) : (
              <>
                일정 <em>{todayEvents.length}개</em>
              </>
            )}
          </div>
          <div className="ph-hero__live">
            <span className="ph-live-dot">
              <span className="ring" />
              <span className="core" />
            </span>
            실시간 추적 중
          </div>
        </button>

        {/* 오늘의 일정 */}
        <section>
          <SectionHeader
            iconBg="var(--rose-soft)"
            icon={<img src={asset("ui/calendar-heart.webp")} alt="" />}
            title="오늘의 일정"
            action={
              <button
                type="button"
                className="hy-section-action"
                onClick={() => navigate("/parent/calendar")}
              >
                전체보기 <ChevronRight size={14} strokeWidth={2.4} />
              </button>
            }
          />
          <div className="hy-card ph-sched">
            {eventsQuery.isLoading ? (
              <div className="ph-sched-row" style={{ justifyContent: "center" }}>
                <Loading label="일정을 불러오는 중" />
              </div>
            ) : todayEvents.length === 0 ? (
              <div className="ph-sched-row" style={{ color: "var(--fg-muted)", fontSize: 14, fontWeight: 600, justifyContent: "center" }}>
                오늘은 일정이 없어요
              </div>
            ) : (
              todayEvents.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  className="ph-sched-row"
                  onClick={() => navigate("/parent/calendar")}
                >
                  <span className="ph-sched-icon" style={{ background: e.soft, fontSize: 20, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {e.emoji}
                  </span>
                  <span className="ph-sched-main">
                    <span className="ph-sched-title">{e.title}</span>
                    <span className="ph-sched-sub">{e.time}{e.place ? ` · ${e.place}` : ""}</span>
                  </span>
                  <span className="ph-sched-tag" style={{ color: e.tagText, background: e.tagBg }}>
                    {e.tag}
                  </span>
                </button>
              ))
            )}
          </div>
        </section>

        {/* AI로 일정 추가 */}
        <div className="ph-ai">
          <div className="ph-ai__head">
            <span className="ph-ai__icon">
              <img src={asset("ui/mic-lavender.png")} alt="" />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="ph-ai__title">AI로 일정 추가</span>
              <span className="ph-ai__sub">말하거나, 쓰거나, 알림장 사진 한 장으로</span>
            </span>
          </div>
          <div className="ph-ai__grid">
            <button type="button" className="ph-ai__btn hy-press" onClick={() => navigate("/ai-schedule")}>
              <Mic size={15} strokeWidth={2.4} /> 음성
            </button>
            <button type="button" className="ph-ai__btn hy-press" onClick={() => navigate("/ai-schedule")}>
              <Keyboard size={15} strokeWidth={2.4} /> 텍스트
            </button>
            <button type="button" className="ph-ai__btn hy-press" onClick={() => navigate("/ai-schedule")}>
              <ImageIcon size={15} strokeWidth={2.4} /> 알림장
            </button>
          </div>
        </div>

        {/* 아이 현황 */}
        <section>
          <SectionHeader
            iconBg="var(--mint-soft)"
            icon={<img src={asset("ui/pin-heart.webp")} alt="" />}
            title="아이 현황"
            action={
              <span className="hy-chip hy-chip--mint" style={{ marginLeft: "auto" }}>
                <span className="hy-chip__pulse" />
                실시간
              </span>
            }
          />
          {childCards.length === 0 ? (
            <div className="hy-card ph-child">
              <div className="ph-child__foot">
                <span className="ph-child__next">아직 연결된 아이가 없어요</span>
              </div>
            </div>
          ) : (
            <div className="ph-children">
              {childCards.map((c) => {
                const active = c.id === activeChild?.id;
                return (
                  <div key={c.id} className={`hy-card ph-child${active ? " ph-child--active" : ""}`}>
                    {/* 활성 표시는 카드 우상단 코너 배지(이름 행에 넣으면 줄바꿈 유발) */}
                    {active && <span className="ph-child__now">보는 중</span>}
                    {/* 카드 탭 = 아이 스위치(전역). 상세는 우측 화살표로. */}
                    <div className="ph-child__rowwrap">
                      <button
                        type="button"
                        className="ph-child__row"
                        aria-pressed={active}
                        onClick={() => setActiveChildId(c.id)}
                      >
                        <span className="ph-child__avatar" style={{ background: "var(--rose-soft)" }}>
                          <img src={avatarSrc(c.avatar)} alt="" />
                          <span className="ph-child__online" />
                        </span>
                        <span className="ph-child__main">
                          <span className="ph-child__name-row">
                            <span className="ph-child__name">{c.name}</span>
                            <span className="ph-child__device">
                              <Smartphone size={12} strokeWidth={2.2} />
                              <span className="ph-child__device-label">
                                {c.device ?? "기기 연결 대기 중"}
                              </span>
                            </span>
                          </span>
                          <span className="ph-child__loc">
                            <MapPin size={14} strokeWidth={2} color="var(--fg-muted)" />
                            <span>{c.place} · {c.fresh}</span>
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        className="ph-child__more hy-press"
                        aria-label={`${c.name} 상세`}
                        onClick={() => {
                          setActiveChildId(c.id);
                          navigate("/child-detail", { state: { childId: c.id } });
                        }}
                      >
                        <ChevronRight size={20} strokeWidth={2.4} color="var(--fg-disabled)" />
                      </button>
                    </div>
                    <div className="ph-child__foot">
                      <span className="ph-child__next">
                        {c.scheduleLabel} ·{" "}
                        <b>
                          {eventsQuery.isLoading
                            ? "확인 중"
                            : c.next
                              ? `${c.next.title} ${c.next.time}`
                              : "없음"}
                        </b>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* 안전 지표 */}
        <section>
          <SectionHeader
            iconBg="var(--lav-soft)"
            icon={<img src={asset("ui/shield-heart.webp")} alt="" />}
            title="안전 지표"
            action={
              <span className="hy-chip hy-chip--mint" style={{ marginLeft: "auto" }}>
                {safetyChildName} · {deviceStatus.safetyLabel}
              </span>
            }
          />
          <div className="hy-card ph-safety">
            {!deviceStatus.hasData && (
              <div className="ph-safety__pending">
                아이 기기가 아직 상태를 보내지 않았어요. 아이 앱이 연결되면 실시간으로 표시돼요.
              </div>
            )}
            <div className="ph-safety__grid">
              <div className="ph-metric">
                <span className="ph-metric__icon" style={{ background: "var(--mint-soft)" }}>
                  <img src={asset("ui/battery.webp")} alt="" />
                </span>
                <span style={{ minWidth: 0 }}>
                  <span className="ph-metric__k">배터리</span>
                  <span className="ph-metric__v big">{deviceStatus.batteryLabel}</span>
                </span>
              </div>
              <div className="ph-metric">
                <span className="ph-metric__icon" style={{ background: "var(--blue-soft)" }}>
                  <Clock size={22} strokeWidth={2} color="var(--blue-500)" />
                </span>
                <span style={{ minWidth: 0 }}>
                  <span className="ph-metric__k">화면시간</span>
                  <span className="ph-metric__v">{deviceStatus.screenTimeLabel}</span>
                </span>
              </div>
              <div className="ph-metric">
                <span className="ph-metric__icon" style={{ background: "var(--cream-soft)" }}>
                  <Zap size={20} strokeWidth={2} color="var(--gold-600)" />
                </span>
                <span style={{ minWidth: 0 }}>
                  <span className="ph-metric__k">충전</span>
                  <span className="ph-metric__v">{deviceStatus.chargingLabel}</span>
                </span>
              </div>
              <div className="ph-metric">
                <span className="ph-metric__icon" style={{ background: "var(--lav-soft)" }}>
                  <Wifi size={22} strokeWidth={2} color="var(--lav-600)" />
                </span>
                <span style={{ minWidth: 0 }}>
                  <span className="ph-metric__k">네트워크</span>
                  <span className="ph-metric__v">{deviceStatus.networkLabel}</span>
                </span>
              </div>
            </div>

            <div className="ph-safety__divider">
              <div className="ph-app-summary">
                <div className="ph-app-summary__item">
                  <span className="ph-app-summary__k">최근 실행</span>
                  <span className="ph-app-summary__v">
                    {deviceStatus.recentAppLabel ?? "—"}
                  </span>
                </div>
                <div className="ph-app-summary__item">
                  <span className="ph-app-summary__k">가장 많이 사용</span>
                  {deviceStatus.mostUsedApp ? (
                    <span className="ph-app-summary__v">
                      {deviceStatus.mostUsedApp.name}
                      <span className="ph-app-summary__time">{deviceStatus.mostUsedApp.timeLabel}</span>
                    </span>
                  ) : (
                    <span className="ph-app-summary__v">—</span>
                  )}
                </div>
              </div>
              <div className="ph-recent-head">
                <b>오늘 많이 쓴 앱</b>
                <span>{deviceStatus.topApps.length > 0 ? "사용시간" : "—"}</span>
              </div>
              {deviceStatus.topApps.length > 0 ? (
                <div className="ph-recent-list">
                  {deviceStatus.topApps.map((app, index) => (
                    <div key={app.id} className="ph-recent-row">
                      <span className="ph-recent-row__icon" aria-hidden="true">
                        {index + 1}
                      </span>
                      <span className="ph-recent-row__main">
                        <span className="ph-recent-row__name">{app.name}</span>
                        {app.isLatest && (
                          <span className="ph-recent-row__badge">최근 실행</span>
                        )}
                      </span>
                      <span className="ph-recent-row__time">{app.timeLabel}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="ph-recent-empty">
                  {deviceStatus.hasData
                    ? "아이 기기 설정 > 사용정보 접근 허용을 켜면 표시돼요"
                    : "아이 기기가 연동되면 표시돼요"}
                </div>
              )}
            </div>

            <div className="ph-safety__refresh">
              <span>{deviceStatus.freshnessLabel}</span>
              <button
                type="button"
                className="hy-press"
                onClick={handleRefresh}
                disabled={refreshing}
              >
                {refreshing ? "갱신 중…" : "지금 갱신"}
              </button>
            </div>
          </div>
        </section>

        {/* 준비물 · 숙제 */}
        <section>
          <SectionHeader
            iconBg="var(--cream-soft)"
            icon={<img src={asset("cat/study.webp")} alt="" />}
            title="준비물 · 숙제"
            action={
              <>
                <span className="ph-prep-count">
                  {prepDone}/{prep.length}
                </span>
                <button
                  type="button"
                  style={{ fontSize: 12.5, fontWeight: 800, color: "var(--hy-accent-text)" }}
                  onClick={() =>
                    navigate("/supplies", {
                      state: { dateKey: todayKey, childId: activeChild?.id },
                    })
                  }
                >
                  편집
                </button>
              </>
            }
          />
          <div className="hy-card ph-prep">
            {suppliesQuery.isLoading ? (
              <div
                className="ph-prep-row"
                style={{ justifyContent: "center" }}
              >
                <Loading label="준비물을 불러오는 중" />
              </div>
            ) : prep.length === 0 ? (
              <div
                className="ph-prep-row"
                style={{ color: "var(--fg-muted)", fontSize: 14, fontWeight: 600, justifyContent: "center" }}
              >
                오늘은 준비물·숙제가 없어요
              </div>
            ) : (
              prep.map((s) => (
                <div key={s.id} className="ph-prep-row">
                  <button
                    type="button"
                    className="ph-prep-check hy-press"
                    aria-label="완료 토글"
                    onClick={() => togglePrep(s)}
                    style={{
                      background: s.done ? "var(--hy-accent)" : "var(--bg-card)",
                      border: s.done ? "none" : "2px solid var(--line-strong)",
                    }}
                  >
                    <Check size={15} strokeWidth={3} color="var(--bg-card)" style={{ opacity: s.done ? 1 : 0 }} />
                  </button>
                  <button type="button" className="ph-prep-label" onClick={() => togglePrep(s)}>
                    {s.kind === "hw" && (
                      <span
                        className="ph-prep-kind"
                        style={{ color: "var(--lav-text)", background: "var(--lav-soft2)" }}
                      >
                        숙제
                      </span>
                    )}
                    <span
                      className="ph-prep-text"
                      style={{
                        color: s.done ? "var(--fg-faint)" : "var(--fg-body)",
                        textDecoration: s.done ? "line-through" : "none",
                      }}
                    >
                      {s.label}
                    </span>
                  </button>
                </div>
              ))
            )}
          </div>
        </section>

        {/* 대화 프리뷰 */}
        <button type="button" className="hy-card ph-memo hy-press" onClick={() => navigate("/parent/memo")}>
          <span className="ph-memo__icon">
            <img src={asset("ui/chat-heart.webp")} alt="" />
          </span>
          <span className="ph-memo__main">
            <span className="ph-memo__from">아이와 대화하기</span>
            <span className="ph-memo__text">{childName}에게 메시지를 보내보세요</span>
            <span className="ph-memo__time">메모 · 실시간</span>
          </span>
          <ChevronRight size={20} strokeWidth={2.4} color="var(--fg-disabled)" style={{ flex: "none" }} />
        </button>

        {/* 바로가기 */}
        <section>
          <SectionHeader
            iconBg="var(--lav-soft)"
            icon={<img src={asset("ui/sparkle.webp")} alt="" style={{ width: 20, height: 20 }} />}
            title="바로가기"
          />
          <div className="ph-shortcuts">
            {shortcuts.map((s) => {
              // "알림" 바로가기 배지는 실제 미읽음 개수(99+ 상한). 그 외는 배지 없음.
              const badge = s.label === "알림" ? unreadCount : 0;
              return (
                <button
                  key={s.id}
                  type="button"
                  className="ph-shortcut hy-press"
                  onPointerDown={s.label === "위치추적" ? () => void loadKakaoMaps().catch(() => undefined) : undefined}
                  onClick={() => navigate(shortcutRoutes[s.label])}
                >
                  <span
                    className="ph-shortcut__icon"
                    style={{ background: s.soft, boxShadow: `0 8px 18px ${s.shadow}` }}
                  >
                    <img src={asset(s.icon)} alt="" />
                    {badge > 0 && (
                      <span className="ph-shortcut__badge">{badge > 99 ? "99+" : badge}</span>
                    )}
                  </span>
                  <span className="ph-shortcut__label">{s.label}</span>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

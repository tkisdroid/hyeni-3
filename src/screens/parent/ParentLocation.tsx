import { useEffect, useMemo, useRef, useState } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  TouchEvent as ReactTouchEvent,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Lock, Crown, Navigation } from "lucide-react";
import { asset } from "@/lib/assets";
import { childAvatarPath } from "@/lib/avatar";
import { useToast } from "@/app/toast";
import { useAuth } from "@/auth/AuthContext";
import { useActiveChild } from "@/app/activeChild";
import { KakaoMap, type MapZone, type MapPlace, type MapStay } from "@/components/KakaoMap";
import {
  useChildLocations,
  useDangerZones,
  useSavedPlaces,
  useLocationHistory,
} from "@/queries/useLocation";
import { useEvents } from "@/queries/useSchedule";
import { useLocationLabels } from "@/queries/useLocationLabels";
import { useEntitlement } from "@/queries/useEntitlement";
import {
  formatFreshness,
  parseServerTimestamp,
  distanceMeters,
  hasNewerLocationUpdate,
} from "@/transform/locationView";
import {
  toTimedPoints,
  detectStayPoints,
  stayPlaceLabel,
  formatDwell,
  formatClockHM,
  type StayPoint,
} from "@/transform/stayPoints";
import { TIERS, locationModeFor } from "@/transform/tierPolicy";
import { parseAppDateKey } from "@/transform/dateKey";
import { filterEventsForChild } from "@/transform/eventScope";
import {
  clampHistoryOffsetMinute,
  getHistoryDayKey,
  getHistoryDayWindow,
} from "@/transform/locationHistoryWindow";
import { placePhoneCall } from "@/lib/native/phone";
import { requestLocationRefresh } from "@/lib/api/endpoints/remote";
import type { LocationHistoryPoint } from "@/lib/api/endpoints/location";
import type { CalendarEvent } from "@/lib/api/endpoints/schedule";
import "./ParentLocation.css";

function avatarSrc(path: string): string {
  return path.startsWith("http") ? path : asset(path);
}

const TRAIL_JITTER_M = 8; // hyeni-1 LOCATION_TRAIL_JITTER_M — 정지 중 GPS 지터(≈8m)를 한 점으로 압축.
const SCHEDULE_STAY_RADIUS_M = 220;
const MIN_SCHEDULE_STAY_OVERLAP_MS = 10 * 60 * 1000;
const STAYS_DRAG_TOGGLE_PX = 42;
const STAYS_DRAG_CLICK_GUARD_PX = 8;
const STAYS_DRAG_CLICK_GUARD_MS = 650;
const LOCATION_REFRESH_POLL_MS = 2_500;
const LOCATION_REFRESH_TIMEOUT_MS = 25_000;

type LocationRefreshState = "idle" | "requesting" | "waiting";

interface TrailPoint {
  lat: number;
  lng: number;
  ms: number;
}

function timeToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    return null;
  }
  return h * 60 + m;
}

function eventPoint(event: CalendarEvent): { lat: number; lng: number } | null {
  const lat = event.location?.lat;
  const lng = event.location?.lng;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function eventWindowMs(event: CalendarEvent): { startMs: number; endMs: number } | null {
  const date = parseAppDateKey(event.date_key);
  const startMin = timeToMinutes(event.time);
  if (!date || startMin == null) return null;
  const endMinRaw = timeToMinutes(event.end_time);
  const endMin = endMinRaw == null ? startMin + 60 : endMinRaw;
  const base = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const startMs = base + startMin * 60_000;
  const endMs = base + (endMin <= startMin ? endMin + 24 * 60 : endMin) * 60_000;
  return { startMs, endMs };
}

function eventLabel(event: CalendarEvent): string {
  return (event.title || event.location?.address || "일정 장소").trim();
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function scheduleStayLabel(stay: StayPoint, events: CalendarEvent[]): string | null {
  const candidates = events
    .map((event) => {
      const point = eventPoint(event);
      if (!point) return null;
      const distance = distanceMeters(stay.lat, stay.lng, point.lat, point.lng);
      if (distance > SCHEDULE_STAY_RADIUS_M) return null;
      const window = eventWindowMs(event);
      if (!window) return null;
      const overlapMs =
        Math.min(stay.departureMs, window.endMs) - Math.max(stay.arrivalMs, window.startMs);
      if (overlapMs < MIN_SCHEDULE_STAY_OVERLAP_MS) return null;
      return { event, distance, overlapMs };
    })
    .filter((row): row is { event: CalendarEvent; distance: number; overlapMs: number } => row !== null)
    .sort((a, b) => b.overlapMs - a.overlapMs || a.distance - b.distance);
  return candidates[0] ? eventLabel(candidates[0].event) : null;
}

/**
 * 하루 위치 이력 → 이동 경로 폴리라인 좌표.
 * 선택 자녀만 · 시간순 · 8m 이내 인접 중복 제거로 과도한 점을 다운샘플(hyeni-1 trailMath 규칙 이관).
 */
function buildTrailPoints(
  points: LocationHistoryPoint[] | undefined,
  userId: string | null,
): TrailPoint[] {
  const rows = (points ?? [])
    .filter(
      (p) => (!userId || p.user_id === userId) && Number.isFinite(p.lat) && Number.isFinite(p.lng),
    )
    .map((p) => ({ lat: p.lat, lng: p.lng, ms: parseServerTimestamp(p.recorded_at)?.getTime() ?? 0 }))
    .sort((a, b) => a.ms - b.ms);
  const out: TrailPoint[] = [];
  for (const r of rows) {
    const prev = out[out.length - 1];
    if (prev && distanceMeters(prev.lat, prev.lng, r.lat, r.lng) < TRAIL_JITTER_M) continue;
    out.push(r);
  }
  return out;
}

export function ParentLocation() {
  const navigate = useNavigate();
  const { show } = useToast();
  const { familyId } = useAuth();
  const { data: locations, refetch, isFetching, isError } = useChildLocations();
  const { data: zones } = useDangerZones();
  const { data: places } = useSavedPlaces();
  const { data: events } = useEvents();
  const { tier } = useEntitlement();

  // 티어 위치 모드: 무료=잠금 / 리뷰=지연 / 프리미엄=실시간. unknown(미확정)은 잠그지 않는다(R9).
  const tierKnown = tier !== TIERS.UNKNOWN;
  const mode = locationModeFor(tier);
  const isLocked = tierKnown && mode === "locked";
  const isDelayed = tierKnown && mode === "delayed";
  // 프리미엄 전용 액션(경로·주변소리)은 프리미엄이거나 티어 미확정일 때만 통과(확정 후 하위 티어는 유도).
  const premiumOpen = !tierKnown || mode === "realtime";

  const now = useMemo(() => new Date(), [locations]);
  const historyWindow = useMemo(() => getHistoryDayWindow(now), [now]);
  const historyDayKey = useMemo(() => getHistoryDayKey(now), [now]);
  const historyMaxOffsetMinute = historyWindow.maxOffsetMinutes;
  const [scrubOffsetMinute, setScrubOffsetMinute] = useState(historyMaxOffsetMinute);

  // 대상 아이 = 전역 활성 아이(스위치는 부모 홈에서만 — 이 화면엔 전환 UI 없음).
  // 예외: 알림/SOS/도착에서 `?child=<user_id>` 로 진입하면 그 아이를 우선(위급 아이 — 안전 규칙).
  const { activeChild, childMembers } = useActiveChild();
  const [searchParams] = useSearchParams();
  const childParam = searchParams.get("child");
  const requestedView: "live" | "history" =
    searchParams.get("view") === "history" ? "history" : "live";
  const selected = useMemo(() => {
    if (childParam) {
      const target = childMembers.find((m) => m.user_id === childParam);
      if (target) return target;
    }
    return activeChild;
  }, [childParam, childMembers, activeChild]);

  const childAvatar = childAvatarPath(selected?.photo_url);
  const childName = selected?.name || "아이";
  const loc = selected?.user_id
    ? locations?.find((l) => l.user_id === selected.user_id) ?? null
    : null;
  const [refreshState, setRefreshState] = useState<LocationRefreshState>("idle");
  const refreshSeq = useRef(0);
  const isRefreshingLocation = refreshState !== "idle";
  useEffect(() => {
    refreshSeq.current += 1;
    setRefreshState("idle");
  }, [selected?.user_id]);

  const fresh = loc ? formatFreshness(loc.updated_at, now) : null;
  const locationLabel = useLocationLabels(loc ? [loc] : [], places);
  const curPlace = loc ? locationLabel(loc) : "위치 확인 중";
  const isStaleLocation = !!loc && fresh?.status === "stale";
  const sheetName = isLocked
    ? childName
    : isRefreshingLocation
      ? `${childName} 위치 확인 중`
      : isStaleLocation
        ? `${childName} · 마지막 확인: ${curPlace}`
        : `${childName} · ${curPlace}`;
  const sheetZoneText = isLocked
    ? "안전 기능은 계속 쓸 수 있어요"
    : isRefreshingLocation
      ? "아이 기기에 요청을 보냈어요 · 새 위치를 기다리는 중"
      : fresh?.label ?? "위치 정보 없음";
  const refreshOverlayTitle =
    refreshState === "requesting" ? "아이 기기에 위치 요청을 보내는 중" : "새 위치를 기다리는 중";
  const refreshOverlaySub = loc
    ? "지도와 장소명은 마지막으로 확인된 위치예요."
    : "아이 기기에서 첫 위치 신호가 오면 바로 바뀌어요.";

  // 리뷰(지연) 티어 배지용 지연 분(마지막 픽스 기준). 타임스탬프 미상이면 null.
  const delayMin = useMemo(() => {
    if (!loc) return null;
    const d = parseServerTimestamp(loc.updated_at);
    if (!d) return null;
    return Math.max(1, Math.round((now.getTime() - d.getTime()) / 60000));
  }, [loc, now]);

  // ── 보기 모드: 실시간 위치 ↔ 오늘 이동경로(프리미엄) ──────────────────────
  const [view, setView] = useState<"live" | "history">(requestedView);
  useEffect(() => {
    setView(requestedView);
  }, [requestedView]);
  // 무료(잠금)에서는 항상 실시간 화면(잠금 오버레이). 토글은 잠금이 아닐 때만 노출.
  const activeView: "live" | "history" = isLocked ? "live" : view;
  useEffect(() => {
    if (activeView === "history") setScrubOffsetMinute(historyMaxOffsetMinute);
  }, [activeView, selected?.id, historyMaxOffsetMinute]);

  // 오늘경로는 오전 8시를 하루 시작으로 본다. 새벽(00~07시)은 전날 경로에 이어 붙인다.
  const historyRange = useMemo(() => {
    return { start: historyWindow.start.toISOString(), end: historyWindow.end.toISOString() };
  }, [historyWindow]);

  // 오늘경로는 프리미엄 전용(EXTENDED_HISTORY). 미확정(unknown)은 R9로 잠그지 않는다.
  const historyEnabled = activeView === "history" && premiumOpen;
  const {
    data: history,
    isFetching: historyFetching,
    isError: historyError,
  } = useLocationHistory(historyRange.start, historyRange.end, historyEnabled);

  const timedTrail = useMemo(
    () => buildTrailPoints(history, selected?.user_id ?? null),
    [history, selected?.user_id],
  );
  const effectiveScrubOffsetMinute = clampHistoryOffsetMinute(
    scrubOffsetMinute,
    historyMaxOffsetMinute,
  );
  const scrubMs = historyWindow.startMs + effectiveScrubOffsetMinute * 60_000;
  const trail = useMemo(
    () => timedTrail.filter((p) => p.ms <= scrubMs).map((p) => ({ lat: p.lat, lng: p.lng })),
    [scrubMs, timedTrail],
  );
  const scrubChildPoint = trail.length > 0 ? trail[trail.length - 1] : null;
  const historyChildPoint = scrubChildPoint ?? (loc ? { lat: loc.lat, lng: loc.lng } : null);
  // 출발 마커(첫 위치). 현재 마커는 지도의 child 아바타 오버레이가 담당.
  const trailStart: MapPlace[] = trail.length
    ? [{ lat: trail[0].lat, lng: trail[0].lng, name: "출발" }]
    : [];

  // ── 스테이포인트: 하루 이력에서 GPS 노이즈를 걸러 머무른 장소 + 체류시간을 검출. ──
  const stayPoints = useMemo<StayPoint[]>(
    () => detectStayPoints(toTimedPoints(history, selected?.user_id ?? null)),
    [history, selected?.user_id],
  );
  const selectedTodayEvents = useMemo(
    () =>
      filterEventsForChild(
        (events ?? []).filter((event) => event.date_key === historyDayKey),
        selected?.id ?? null,
      ),
    [events, historyDayKey, selected?.id],
  );
  const stayLabels = useMemo(
    () => stayPoints.map((s) => scheduleStayLabel(s, selectedTodayEvents) ?? stayPlaceLabel(s, places)),
    [stayPoints, selectedTodayEvents, places],
  );
  const visibleStayPoints = useMemo(
    () => stayPoints.filter((s) => s.arrivalMs <= scrubMs),
    [scrubMs, stayPoints],
  );
  const scheduleMapPlaces = useMemo<MapPlace[]>(
    () =>
      selectedTodayEvents
        .map((event) => {
          const point = eventPoint(event);
          if (!point) return null;
          return {
            lat: point.lat,
            lng: point.lng,
            name: `${event.time || ""} ${eventLabel(event)}`.trim(),
          };
        })
        .filter((p): p is MapPlace => p !== null),
    [selectedTodayEvents],
  );
  const historyPlaces = useMemo(
    () => [...trailStart, ...scheduleMapPlaces],
    [scheduleMapPlaces, trailStart],
  );
  // 목록에서 선택한 스테이포인트(지도 포커스 + 강조).
  const [selectedStayIdx, setSelectedStayIdx] = useState<number | null>(null);
  const [staysCollapsed, setStaysCollapsed] = useState(false);
  const staysDragStart = useRef<number | null>(null);
  const staysDragLast = useRef<number | null>(null);
  const staysDragged = useRef(false);
  const staysDragClickGuardUntil = useRef(0);
  // 아이 전환(전역 스위치·?child=) 시 선택 초기화 — 다른 아이의 스테이가 강조 잔존하지 않게.
  useEffect(() => {
    setSelectedStayIdx(null);
    setStaysCollapsed(false);
  }, [selected?.id]);
  useEffect(() => {
    setStaysCollapsed(false);
  }, [activeView, stayPoints.length]);
  const activeStayIdx =
    selectedStayIdx != null && selectedStayIdx < visibleStayPoints.length ? selectedStayIdx : null;
  // 지도용 스테이 마커(순번·체류시간·장소명·강조).
  const mapStays = useMemo<MapStay[]>(
    () =>
      visibleStayPoints.map((s, i) => ({
        lat: s.lat,
        lng: s.lng,
        order: i + 1,
        dwellLabel: formatDwell(s.dwellMs),
        placeName: stayLabels[i] ?? null,
        active: i === activeStayIdx,
      })),
    [visibleStayPoints, stayLabels, activeStayIdx],
  );
  // 목록 항목 선택 시 지도 중심을 그 스테이포인트로.
  const stayCenter =
    activeStayIdx != null ? { lat: visibleStayPoints[activeStayIdx].lat, lng: visibleStayPoints[activeStayIdx].lng } : null;

  const markStaysDragged = () => {
    staysDragged.current = true;
    staysDragClickGuardUntil.current = Date.now() + STAYS_DRAG_CLICK_GUARD_MS;
  };

  const beginStaysDrag = (clientY: number) => {
    staysDragStart.current = clientY;
    staysDragLast.current = clientY;
    staysDragged.current = false;
  };

  const updateStaysDrag = (clientY: number) => {
    const startY = staysDragStart.current;
    if (startY == null) return;
    staysDragLast.current = clientY;
    const dy = clientY - startY;
    if (Math.abs(dy) > STAYS_DRAG_CLICK_GUARD_PX) {
      markStaysDragged();
    }
    if (dy >= STAYS_DRAG_TOGGLE_PX) {
      setStaysCollapsed(true);
      staysDragStart.current = null;
      staysDragLast.current = null;
    } else if (dy <= -STAYS_DRAG_TOGGLE_PX) {
      setStaysCollapsed(false);
      staysDragStart.current = null;
      staysDragLast.current = null;
    }
  };

  const finishStaysDrag = () => {
    const startY = staysDragStart.current;
    const lastY = staysDragLast.current;
    if (startY != null && lastY != null) {
      const dy = lastY - startY;
      if (dy >= STAYS_DRAG_TOGGLE_PX) {
        setStaysCollapsed(true);
        markStaysDragged();
      } else if (dy <= -STAYS_DRAG_TOGGLE_PX) {
        setStaysCollapsed(false);
        markStaysDragged();
      } else if (Math.abs(dy) > STAYS_DRAG_CLICK_GUARD_PX) {
        markStaysDragged();
      }
    }
    staysDragStart.current = null;
    staysDragLast.current = null;
  };

  const cancelStaysDrag = () => {
    staysDragStart.current = null;
    staysDragLast.current = null;
  };

  const onStaysPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    beginStaysDrag(e.clientY);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // 일부 합성/비표준 pointer 이벤트에서는 active pointer 가 없어 실패할 수 있다.
    }
  };

  const onStaysPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    updateStaysDrag(e.clientY);
  };

  const onStaysPointerUp = () => {
    finishStaysDrag();
  };

  const onStaysPointerCancel = () => {
    cancelStaysDrag();
  };

  const onStaysTouchStart = (e: ReactTouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1) return;
    beginStaysDrag(e.touches[0].clientY);
  };

  const onStaysTouchMove = (e: ReactTouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1) return;
    updateStaysDrag(e.touches[0].clientY);
  };

  const onStaysTouchEnd = () => {
    finishStaysDrag();
  };

  const onStaysClickCapture = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!staysDragged.current) return;
    const shouldGuard = Date.now() <= staysDragClickGuardUntil.current;
    staysDragged.current = false;
    if (!shouldGuard) return;
    e.preventDefault();
    e.stopPropagation();
  };

  const histLocked = activeView === "history" && !premiumOpen;
  const histLoading = activeView === "history" && premiumOpen && historyFetching && timedTrail.length === 0;
  const histErrored = activeView === "history" && premiumOpen && historyError && timedTrail.length === 0;
  const histEmpty =
    activeView === "history" && premiumOpen && !historyFetching && !historyError && timedTrail.length === 0;

  // 프리미엄 유도(실시간·경로·주변소리 등 잠긴 액션 탭 시).
  const upsell = () => {
    show("실시간 위치·경로는 프리미엄 기능이에요", "👑");
    navigate("/subscription");
  };

  const mapZones: MapZone[] = (zones ?? []).map((z) => ({
    lat: z.lat,
    lng: z.lng,
    radiusM: z.radius_m,
    name: z.name,
  }));
  const mapPlaces: MapPlace[] = (places ?? [])
    .filter((p) => typeof p.location?.lat === "number" && typeof p.location?.lng === "number")
    .map((p) => ({ lat: p.location.lat, lng: p.location.lng, name: p.name, isHome: p.is_home }));

  // 새로고침 — 실제 리페치 결과에 따라 정직하게 안내(거짓 성공 금지).
  const refresh = async () => {
    if (isFetching || isRefreshingLocation) return;
    if (!familyId || !selected?.user_id) {
      show("아이 기기 정보가 없어 위치 요청을 보내지 못했어요", "⚠️");
      return;
    }
    const requestSeq = refreshSeq.current + 1;
    refreshSeq.current = requestSeq;
    const targetUserId = selected.user_id;
    const before = loc;
    setRefreshState("requesting");
    try {
      const requested = await requestLocationRefresh(familyId, targetUserId);
      if (refreshSeq.current !== requestSeq) return;
      if (!requested.ok) {
        show("아이 기기에 위치 요청을 보내지 못했어요", "⚠️");
        return;
      }
      setRefreshState("waiting");

      const deadline = Date.now() + LOCATION_REFRESH_TIMEOUT_MS;
      let lastError = false;
      while (Date.now() < deadline) {
        await wait(LOCATION_REFRESH_POLL_MS);
        if (refreshSeq.current !== requestSeq) return;
        const result = await refetch();
        if (refreshSeq.current !== requestSeq) return;
        if (result.isError) {
          lastError = true;
          continue;
        }
        const after = result.data?.find((l) => l.user_id === targetUserId) ?? null;
        if (hasNewerLocationUpdate(before, after)) {
          show("실시간 위치를 새로고침했어요", "📍");
          return;
        }
      }
      if (lastError) {
        show("위치 갱신 결과를 확인하지 못했어요", "⚠️");
        return;
      }
      show("아이 기기에 요청은 보냈지만 아직 새 위치가 도착하지 않았어요", "⚠️");
    } catch {
      show("위치 갱신에 실패했어요", "⚠️");
      return;
    } finally {
      if (refreshSeq.current === requestSeq) setRefreshState("idle");
    }
  };

  // 지도에 표시된 아이에게 전화. 번호 미등록이면 안내만.
  const callChild = () => {
    const number = selected?.phone;
    if (!number) {
      show(`${childName} 전화번호가 없어요`, "📞");
      return;
    }
    show(`${childName}에게 전화를 거는 중…`, "📞");
    void placePhoneCall(number);
  };

  return (
    <div className="pl-root">
      {/* 실 Kakao 지도 — 실시간(마커·구역·장소) ↔ 오늘경로(이동 폴리라인 + 출발/현재 마커). */}
      {activeView === "history" ? (
        <KakaoMap
          className="pl-map"
          child={
            historyChildPoint
              ? { lat: historyChildPoint.lat, lng: historyChildPoint.lng, name: childName, avatar: childAvatar }
              : null
          }
          route={trail}
          stays={mapStays}
          center={stayCenter}
          places={historyPlaces}
        />
      ) : (
        <KakaoMap
          className="pl-map"
          child={!isLocked && loc ? { lat: loc.lat, lng: loc.lng, name: childName, avatar: childAvatar } : null}
          zones={mapZones}
          places={mapPlaces}
        />
      )}

      {/* 오늘경로 — 프리미엄 잠금(무료/리뷰). 지도를 흐리게 덮고 프리미엄 유도. */}
      {histLocked && (
        <div className="pl-lock">
          <div className="pl-lock__ring">
            <Lock size={30} strokeWidth={2.2} color="var(--gold-600)" />
          </div>
          <div className="pl-lock__title">오늘 이동경로는 프리미엄이에요</div>
          <div className="pl-lock__sub">
            아이가 오늘 어디를 다녀왔는지 이동 경로로 확인할 수 있어요.
            <br />
            프리미엄을 시작하면 오늘 경로가 열려요.
          </div>
          <button
            type="button"
            className="pl-lock__cta hy-press"
            onClick={() => navigate("/subscription")}
          >
            프리미엄 시작하기
          </button>
        </div>
      )}

      {/* 오늘경로 — 로딩/실패/빈 상태(프리미엄, 정직 안내). */}
      {(histLoading || histErrored || histEmpty) && (
        <div className="pl-histmsg">
          {histErrored
            ? "이동 기록을 불러오지 못했어요"
            : histLoading
              ? "오늘 이동 기록을 불러오는 중…"
              : "오늘 이동 기록이 아직 없어요"}
        </div>
      )}

      {activeView === "history" && premiumOpen && !histLocked && timedTrail.length > 0 && (
        <div className="pl-scrub">
          <div className="pl-scrub__head">
            <span>시간대별 경로</span>
            <strong>{formatClockHM(scrubMs)}</strong>
          </div>
          <input
            className="pl-scrub__range"
            type="range"
            min={0}
            max={historyMaxOffsetMinute}
            value={effectiveScrubOffsetMinute}
            onChange={(e) => setScrubOffsetMinute(Number(e.target.value))}
            aria-label="오늘 경로 시간 선택"
          />
          <div className="pl-scrub__ticks" aria-hidden="true">
            <span>{formatClockHM(historyWindow.startMs)}</span>
            <span>{formatClockHM(historyWindow.endMs)}</span>
          </div>
          <div className="pl-scrub__legend">
            <span><i className="pl-scrub__line" /> 이동선</span>
            <span><i className="pl-scrub__dot" /> 머문 곳</span>
            {scheduleMapPlaces.length > 0 && <span>📍 일정</span>}
          </div>
        </div>
      )}

      {/* 잠금 오버레이(무료) — 지도를 흐리게 덮고 프리미엄 유도. 하단 시트(안전 액션)는 위에 남는다. */}
      {isLocked && (
        <div className="pl-lock">
          <div className="pl-lock__ring">
            <Lock size={30} strokeWidth={2.2} color="var(--gold-600)" />
          </div>
          <div className="pl-lock__title">실시간 위치는 프리미엄이에요</div>
          <div className="pl-lock__sub">
            무료 플랜에서는 아이 위치를 볼 수 없어요.
            <br />
            프리미엄을 시작하면 지금 위치를 실시간으로 확인할 수 있어요.
          </div>
          <button
            type="button"
            className="pl-lock__cta hy-press"
            onClick={() => navigate("/subscription")}
          >
            프리미엄 시작하기
          </button>
        </div>
      )}

      {/* 상단 오버레이(잠금 시 숨김) — 보기 토글 + (실시간에서만) 새로고침 */}
      {!isLocked && (
        <div className="pl-top">
          <div className="pl-viewtog" role="tablist" aria-label="위치 보기 전환">
            <button
              type="button"
              role="tab"
              aria-selected={activeView === "live"}
              className={`pl-viewtog__btn hy-press${activeView === "live" ? " pl-viewtog__btn--on" : ""}`}
              onClick={() => {
                setView("live");
                setSelectedStayIdx(null);
              }}
            >
              실시간
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeView === "history"}
              className={`pl-viewtog__btn hy-press${activeView === "history" ? " pl-viewtog__btn--on" : ""}`}
              onClick={() => setView("history")}
            >
              오늘 경로
            </button>
          </div>
          {activeView === "live" && (
            <button
              type="button"
              className={`pl-refresh${isRefreshingLocation ? " pl-refresh--loading" : ""}`}
              aria-label={isDelayed ? "실시간 새로고침은 프리미엄" : isRefreshingLocation ? refreshOverlayTitle : "새로고침"}
              aria-busy={isRefreshingLocation}
              onClick={refresh}
              disabled={isFetching || isDelayed || isRefreshingLocation}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6D6469" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                <path d="M21 3v5h-5" />
                <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                <path d="M21 21v-5h5" />
              </svg>
            </button>
          )}
        </div>
      )}

      {!isLocked && activeView === "live" && isRefreshingLocation && (
        <div className="pl-refreshing" role="status" aria-live="polite">
          <span className="pl-refreshing__spinner" aria-hidden="true" />
          <span className="pl-refreshing__title">{refreshOverlayTitle}</span>
          <span className="pl-refreshing__sub">{refreshOverlaySub}</span>
        </div>
      )}

      {/* 아이 표시 배지 — 실시간에서만 현재 보는 아이를 명시한다. */}
      {!isLocked && activeView === "live" && selected && (
        <div className="pl-chips">
          <div className="pl-chip pl-chip--active" aria-label={`현재 ${selected.name || "아이"} 위치 보기`}>
            <span className="pl-chip__avatar">
              <img src={avatarSrc(childAvatarPath(selected.photo_url))} alt="" />
            </span>
            <span className="pl-chip__name">{selected.name || "아이"}</span>
            <span className="pl-chip__dot" />
          </div>
        </div>
      )}

      {/* 하단 — 오늘 경로(스테이포인트 목록) */}
      {activeView === "history" && premiumOpen && stayPoints.length > 0 && (
        <>
        <div
          className={`pl-sheet pl-stays${staysCollapsed ? " pl-stays--collapsed" : ""}`}
          onPointerDown={onStaysPointerDown}
          onPointerMove={onStaysPointerMove}
          onPointerUp={onStaysPointerUp}
          onPointerCancel={onStaysPointerCancel}
          onTouchStart={onStaysTouchStart}
          onTouchMove={onStaysTouchMove}
          onTouchEnd={onStaysTouchEnd}
          onTouchCancel={cancelStaysDrag}
          onClickCapture={onStaysClickCapture}
        >
          <div
            className="pl-stays__grip"
            role="button"
            tabIndex={0}
            aria-label={staysCollapsed ? "오늘 머문 곳 펼치기" : "오늘 머문 곳 접기"}
            onClick={() => setStaysCollapsed((v) => !v)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setStaysCollapsed((v) => !v);
              }
            }}
          >
            <div className="pl-sheet__handle" />
          </div>
          <div className="pl-stays__head">
            <span className="pl-stays__title">오늘 머문 곳</span>
            <span className="pl-stays__count">{visibleStayPoints.length}/{stayPoints.length}곳</span>
          </div>
          <div className="pl-stays__list">
            {visibleStayPoints.map((s, i) => {
              const place = stayLabels[i];
              const on = i === activeStayIdx;
              return (
                <button
                  key={`${s.arrivalMs}-${i}`}
                  type="button"
                  className={`pl-stay hy-press${on ? " pl-stay--on" : ""}`}
                  onClick={() => setSelectedStayIdx(on ? null : i)}
                >
                  <span className="pl-stay__num">{i + 1}</span>
                  <span className="pl-stay__body">
                    <span className="pl-stay__place">{place ?? "머문 장소"}</span>
                    <span className="pl-stay__time">
                      {formatClockHM(s.arrivalMs)}–{formatClockHM(s.departureMs)}
                    </span>
                  </span>
                  <span className="pl-stay__dwell">{formatDwell(s.dwellMs)}</span>
                </button>
              );
            })}
          </div>
        </div>
        {staysCollapsed && (
          <button
            type="button"
            className="pl-stays-reopen hy-press"
            onClick={() => setStaysCollapsed(false)}
          >
            오늘 머문 곳 {visibleStayPoints.length}곳
          </button>
        )}
        </>
      )}

      {/* 하단 상세 카드 — 실시간(또는 경로에 스테이포인트가 없을 때) */}
      {!(activeView === "history" && premiumOpen && stayPoints.length > 0) && (
      <div className="pl-sheet">
        <div className="pl-sheet__handle" />
        <div className="pl-sheet__head">
          <div className="pl-sheet__avatar">
            <img src={avatarSrc(childAvatar)} alt="" />
          </div>
          <div className="pl-sheet__info">
            <div className="pl-sheet__name">{sheetName}</div>
            <div
              className={`pl-sheet__zone${isLocked ? " pl-sheet__zone--locked" : ""}${isStaleLocation ? " pl-sheet__zone--stale" : ""}${isRefreshingLocation ? " pl-sheet__zone--loading" : ""}`}
            >
              <span className="pl-sheet__zone-dot" />
              {sheetZoneText}
              {isDelayed && delayMin != null && (
                <span className="pl-delay-badge">약 {delayMin}분 지연</span>
              )}
            </div>
          </div>
          <span className={`pl-sheet__dur${isRefreshingLocation ? " pl-sheet__dur--loading" : ""}`}>
            {isRefreshingLocation ? "확인 중" : loc ? "" : "오프라인"}
          </span>
        </div>

        {/* 갱신 실패 / 위치 없음 → 상태 화면으로 (잠금 시엔 위치 부재가 아니라 잠금이므로 숨김) */}
        {!isLocked && (isError || !loc) && (
          <button
            type="button"
            className="pl-status hy-press"
            onClick={() =>
              navigate(
                selected?.user_id
                  ? `/location-status?child=${encodeURIComponent(selected.user_id)}`
                  : "/location-status",
                { state: { childUserId: selected?.user_id ?? null, childId: selected?.id ?? null } },
              )
            }
          >
            <span className="pl-status__dot" />
            {isError ? "위치 갱신에 실패했어요 · 상태 확인" : "위치 정보가 없어요 · 상태 확인"}
          </button>
        )}

        {/* 리뷰(지연) 티어 — 실시간 전환 유도 */}
        {isDelayed && (
          <button
            type="button"
            className="pl-upsell hy-press"
            onClick={() => navigate("/subscription")}
          >
            <Crown size={16} strokeWidth={2.2} color="var(--gold-600)" />
            프리미엄으로 실시간 위치 보기
          </button>
        )}

        <div className="pl-actions">
          <button type="button" className="pl-memo-btn" onClick={() => navigate("/parent/memo")}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 11.5a8.5 8.5 0 0 1-12.2 7.7L3 21l1.9-5.6A8.5 8.5 0 1 1 21 11.5Z" />
            </svg>
            메모 남기기
          </button>
          {/* 경로·주변소리는 프리미엄 전용 — 하위 티어에서는 유도. 잠금(무료)에서는 숨김. */}
          {!isLocked && (
            <>
              <button
                type="button"
                className="pl-route-btn hy-press"
                aria-label="경로 보기"
                onClick={() => (premiumOpen ? navigate("/route") : upsell())}
              >
                <Navigation size={21} strokeWidth={2.2} color="var(--blue-500)" />
              </button>
              <button
                type="button"
                className="pl-listen-btn"
                aria-label="주변 소리 듣기"
                onClick={() => (premiumOpen ? navigate("/remote-audio") : upsell())}
              >
                <img src={asset("ui/menu-remote-audio.webp")} alt="" />
              </button>
            </>
          )}
          <button type="button" className="pl-call-btn" aria-label="전화 걸기" onClick={callChild}>
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#23A876" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.1-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z" />
            </svg>
          </button>
        </div>
      </div>
      )}
    </div>
  );
}

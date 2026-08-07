import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import {
  AlertTriangle,
  Crown,
  MessageCircle,
  Navigation,
  Phone,
  RefreshCw,
} from "lucide-react";
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
  distanceMeters,
} from "@/transform/locationView";
import {
  toTimedPoints,
  detectStayPoints,
  stayPlaceLabel,
  formatDwell,
  formatClockHM,
  type StayPoint,
} from "@/transform/stayPoints";
import { TIERS, historyDaysFor, locationModeFor } from "@/transform/tierPolicy";
import {
  addDaysToDateKey,
  dateInputValueToDateKey,
  dateKeyToDateInputValue,
  parseAppDateKey,
} from "@/transform/dateKey";
import { filterEventsForChild } from "@/transform/eventScope";
import {
  clampHistoryDayKey,
  clampHistoryOffsetMinute,
  getHistoryDayKey,
  getHistoryDayKeyRange,
  getHistoryDayWindow,
  getHistoryDayWindowForKey,
} from "@/transform/locationHistoryWindow";
import { placePhoneCall } from "@/lib/native/phone";
import { requestLocationRefresh } from "@/lib/api/endpoints/remote";
import { waitForNewChildLocation } from "@/transform/locationRefreshWait";
import {
  buildTrailPoints,
  resolveHistoryMapCenter,
  resolveScrubWhereLabel,
} from "@/transform/locationHistoryScrub";
import type { CalendarEvent } from "@/lib/api/endpoints/schedule";
import { PremiumUpsell } from "@/components/PremiumUpsell";
import type { PremiumUpsellSource } from "@/transform/premiumUpsell";
import {
  browserPremiumReturnIntentStorage,
  savePremiumReturnIntent,
} from "@/transform/premiumReturnIntent";
import {
  getJourneyRecordedRange,
  resolveJourneyContentState,
} from "@/transform/locationJourneyView";
import { LocationHistoryToolbar } from "@/screens/parent/LocationHistoryToolbar";
import {
  LocationJourneyPanel,
  type StayTimelineItem,
} from "@/screens/parent/LocationJourneyPanel";
import "./ParentLocation.css";

function avatarSrc(path: string): string {
  return path.startsWith("http") || path.startsWith("blob:") ? path : asset(path);
}

const SCHEDULE_STAY_RADIUS_M = 220;
const MIN_SCHEDULE_STAY_OVERLAP_MS = 10 * 60 * 1000;
// 시간대·머문 곳 포커스 시 확대 단계(Kakao level — 작을수록 확대). 하루 전체 bounds 로 멀어진
// 화면에서도 그 시각 위치가 보이도록 동네 축척까지만 당긴다(이미 더 확대돼 있으면 그대로 둔다).
const HISTORY_FOCUS_MAP_LEVEL = 4;
type LocationRefreshState = "idle" | "requesting" | "waiting";

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
 * 계산은 `transform/locationHistoryScrub` 의 순수 함수가 담당한다(실측점만 · 8m 지터 압축).
 */
export function ParentLocation() {
  const navigate = useNavigate();
  const { show } = useToast();
  const { familyId } = useAuth();
  const { data: locations, refetch, isFetching, isFetched, isError } = useChildLocations();
  const { data: zones } = useDangerZones();
  const { data: places } = useSavedPlaces();
  const { data: events } = useEvents();
  const entitlement = useEntitlement();
  const [searchParams] = useSearchParams();

  // 위치 데이터는 조회 범위가 확정된 뒤에만 연다. 엔타이틀먼트 오류 때도
  // TanStack 캐시의 정확한 좌표·경로가 잠깐 노출되지 않도록 fail-closed 한다.
  const tierKnown = entitlement.tier !== TIERS.UNKNOWN;
  const mode = locationModeFor(entitlement.tier);
  const locationScopeError = entitlement.isError;
  const locationScopePending = entitlement.isError || !tierKnown;
  const canShowLocation = !locationScopePending && mode !== "locked";
  const canShowHistory = canShowLocation;
  const isLocked = !locationScopePending && mode === "locked";
  const isStandard = canShowLocation && mode === "standard";
  const premiumOpen = !locationScopePending && mode === "realtime";

  const now = useMemo(() => new Date(), [locations]);
  const historyTodayKey = useMemo(() => getHistoryDayKey(now), [now]);
  const premiumHistoryDays = historyDaysFor(TIERS.PREMIUM);
  const premiumHistoryRange = useMemo(
    () => getHistoryDayKeyRange(now, premiumHistoryDays),
    [now, premiumHistoryDays],
  );
  const requestedHistoryDayKey = dateInputValueToDateKey(searchParams.get("date") ?? "");
  const [rawHistoryDayKey, setRawHistoryDayKey] = useState(
    () => requestedHistoryDayKey ?? historyTodayKey,
  );
  // Free/reviewed는 URL이나 이전 상태에 과거 날짜가 남아 있어도 서버 요청 전에 오늘로 고정한다.
  const historyDayKey = premiumOpen
    ? clampHistoryDayKey(rawHistoryDayKey, now, premiumHistoryDays)
    : historyTodayKey;
  const historyWindow = useMemo(
    () => getHistoryDayWindowForKey(historyDayKey, now) ?? getHistoryDayWindow(now),
    [historyDayKey, now],
  );
  const historyMinDateValue = dateKeyToDateInputValue(premiumHistoryRange.minDateKey);
  const historyMaxDateValue = dateKeyToDateInputValue(premiumHistoryRange.maxDateKey);
  const historyDateValue = dateKeyToDateInputValue(historyDayKey);
  const historyDayLabel = useMemo(() => {
    if (historyDayKey === historyTodayKey) return "오늘";
    const date = parseAppDateKey(historyDayKey);
    return date?.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" }) ?? "선택한 날";
  }, [historyDayKey, historyTodayKey]);
  const historyMaxOffsetMinute = historyWindow.maxOffsetMinutes;
  // null = 최신 따라가기(기본). 숫자 = 부모가 직접 고른 시각.
  // 위치 폴링(30초)마다 `now` 가 갱신돼도 부모가 고른 시각을 최신으로 되돌리지 않는다.
  const [scrubOffsetMinute, setScrubOffsetMinute] = useState<number | null>(null);
  // 슬라이더를 움직일 때마다 값을 올려 같은 좌표라도 지도 중심을 다시 맞춘다.
  const [scrubFocusKey, setScrubFocusKey] = useState(0);

  // 대상 아이 = 전역 활성 아이(스위치는 부모 홈에서만 — 이 화면엔 전환 UI 없음).
  // 예외: 알림/SOS/도착에서 `?child=<user_id>` 로 진입하면 그 아이를 우선(위급 아이 — 안전 규칙).
  const { activeChild, childMembers } = useActiveChild();
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
  const cachedLoc = selected?.user_id
    ? locations?.find((l) => l.user_id === selected.user_id) ?? null
    : null;
  const loc = canShowLocation ? cachedLoc : null;
  const [refreshState, setRefreshState] = useState<LocationRefreshState>("idle");
  const [upsellSource, setUpsellSource] = useState<PremiumUpsellSource | null>(null);
  const [historyUpsellDayKey, setHistoryUpsellDayKey] = useState<string | null>(null);
  const refreshSeq = useRef(0);
  const refreshMounted = useRef(false);
  const refreshTargetKey =
    familyId && selected?.user_id ? `${familyId}:${selected.user_id}` : null;
  const refreshTargetKeyRef = useRef<string | null>(refreshTargetKey);
  const autoRefreshKeyRef = useRef<string | null>(null);
  const isRefreshingLocation = refreshState !== "idle";

  useEffect(() => {
    refreshMounted.current = true;
    return () => {
      refreshSeq.current += 1;
      autoRefreshKeyRef.current = null;
      refreshMounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (refreshTargetKeyRef.current === refreshTargetKey) return;
    refreshTargetKeyRef.current = refreshTargetKey;
    autoRefreshKeyRef.current = null;
    refreshSeq.current += 1;
    setRefreshState("idle");
  }, [refreshTargetKey]);

  const fresh = loc ? formatFreshness(loc.updated_at, now) : null;
  const accuracyM = loc?.accuracy_m != null && Number.isFinite(Number(loc.accuracy_m))
    ? Math.max(0, Math.round(Number(loc.accuracy_m)))
    : null;
  const isLowAccuracy = accuracyM != null && accuracyM > 150;
  const locationLabel = useLocationLabels(loc ? [loc] : [], places);
  const curPlace = loc ? locationLabel(loc) : "위치 확인 중";
  const isStaleLocation = !!loc && fresh?.status === "stale";
  const sheetName = locationScopeError
    ? `${childName} · 위치 조회 범위 확인 실패`
    : locationScopePending
    ? `${childName} · 조회 범위 확인 중`
    : isLocked
    ? childName
    : isRefreshingLocation
      ? `${childName} 위치 확인 중`
      : isStaleLocation
        ? `${childName} · 마지막 확인: ${curPlace}`
        : `${childName} · ${curPlace}`;
  const sheetZoneText = locationScopeError
    ? "구독 상태를 확인하지 못했어요"
    : locationScopePending
    ? "구독 상태를 확인하고 있어요"
    : isLocked
    ? "안전 기능은 계속 쓸 수 있어요"
    : isRefreshingLocation
      ? "위치 요청을 보냈어요"
      : isLowAccuracy
        ? `정확도가 낮아요 · 오차 약 ${accuracyM}m · ${fresh?.label ?? "확인 시각 없음"}`
        : `${fresh?.label ?? "위치 정보 없음"}${accuracyM != null ? ` · 오차 약 ${accuracyM}m` : ""}`;
  // 진행 단계를 나눠 설명하지 않는다 — 항상 간단한 한 줄만 보여준다(2026-08-02 TK 지시).
  const refreshOverlayTitle = "위치 요청을 보냈어요";

  // ── 보기 모드: 최근/실시간 위치 ↔ 오늘 이동 경로 ─────────────────────
  const [view, setView] = useState<"live" | "history">(requestedView);
  useEffect(() => {
    setView(requestedView);
  }, [requestedView]);
  // 조회 범위 미확정에서는 경로 캐시를 렌더링하지 않는다.
  const activeView: "live" | "history" = isLocked || locationScopePending ? "live" : view;
  // 보기 전환·아이 전환에서만 최신 따라가기로 돌아간다(폴링으로 되돌리지 않는다).
  useEffect(() => {
    setScrubOffsetMinute(null);
  }, [activeView, historyDayKey, selected?.id]);

  // 선택일 경로는 오전 8시부터 다음 날 오전 8시까지 24시간으로 고정한다.
  // 오늘의 끝도 queryEnd로 고정해 30초 폴링마다 쿼리 키가 바뀌지 않게 한다.
  const historyRange = useMemo(() => {
    return {
      start: historyWindow.start.toISOString(),
      end: historyWindow.queryEnd.toISOString(),
    };
  }, [historyWindow]);

  // 오늘 경로는 조회 범위가 확정된 모든 부모에게 제공한다.
  // 쿼리 키가 고정됐으므로 신선도는 화면이 열려 있는 동안의 배경 폴링(60초)으로 유지한다.
  const historyEnabled = activeView === "history" && canShowHistory;
  const {
    data: history,
    isFetching: historyFetching,
    isError: historyError,
    refetch: refetchHistory,
  } = useLocationHistory(historyRange.start, historyRange.end, historyEnabled, 60_000);
  const visibleHistory = canShowHistory ? history : undefined;

  const timedTrail = useMemo(
    () => buildTrailPoints(visibleHistory, selected?.user_id ?? null),
    [visibleHistory, selected?.user_id],
  );
  const followsLatest = scrubOffsetMinute == null;
  const effectiveScrubOffsetMinute = followsLatest
    ? historyMaxOffsetMinute
    : clampHistoryOffsetMinute(scrubOffsetMinute, historyMaxOffsetMinute);
  const scrubMs = historyWindow.startMs + effectiveScrubOffsetMinute * 60_000;
  const visibleTrail = useMemo(
    () => timedTrail.filter((p) => p.ms <= scrubMs),
    [scrubMs, timedTrail],
  );
  const trail = useMemo(
    () => visibleTrail.map((p) => ({ lat: p.lat, lng: p.lng })),
    [visibleTrail],
  );
  const scrubChildPoint = visibleTrail.length > 0 ? visibleTrail[visibleTrail.length - 1] : null;
  const historyChildPoint = scrubChildPoint ?? (loc ? { lat: loc.lat, lng: loc.lng } : null);
  // 출발 마커(첫 위치). 현재 마커는 지도의 child 아바타 오버레이가 담당.
  // 매 렌더 새 배열을 만들면 지도 오버레이가 통째로 다시 그려지므로 메모이즈한다.
  const trailStart = useMemo<MapPlace[]>(
    () => (trail.length ? [{ lat: trail[0].lat, lng: trail[0].lng, name: "출발" }] : []),
    [trail],
  );

  // ── 스테이포인트: 하루 이력에서 GPS 노이즈를 걸러 머무른 장소 + 체류시간을 검출. ──
  const stayPoints = useMemo<StayPoint[]>(
    () => detectStayPoints(toTimedPoints(visibleHistory, selected?.user_id ?? null)),
    [visibleHistory, selected?.user_id],
  );
  const selectedHistoryEvents = useMemo(
    () =>
      filterEventsForChild(
        (events ?? []).filter((event) => event.date_key === historyDayKey),
        selected?.id ?? null,
      ),
    [events, historyDayKey, selected?.id],
  );
  const stayLabels = useMemo(
    () => stayPoints.map((s) => scheduleStayLabel(s, selectedHistoryEvents) ?? stayPlaceLabel(s, places)),
    [stayPoints, selectedHistoryEvents, places],
  );
  const visibleStayPoints = useMemo(
    () => stayPoints.filter((s) => s.arrivalMs <= scrubMs),
    [scrubMs, stayPoints],
  );
  const scheduleMapPlaces = useMemo<MapPlace[]>(
    () =>
      selectedHistoryEvents
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
    [selectedHistoryEvents],
  );
  const historyPlaces = useMemo(
    () => [...trailStart, ...scheduleMapPlaces],
    [scheduleMapPlaces, trailStart],
  );
  // 목록에서 선택한 스테이포인트(지도 포커스 + 강조).
  const [selectedStayIdx, setSelectedStayIdx] = useState<number | null>(null);
  const [historyPanelExpanded, setHistoryPanelExpanded] = useState(true);
  const [historyWideLayout, setHistoryWideLayout] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 720px) and (orientation: landscape)");
    const sync = () => setHistoryWideLayout(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  // 아이·날짜·보기 전환에서만 선택을 초기화하고 패널을 펼친다.
  // 60초 이력 폴링과 시간 막대 조작은 사용자가 정한 패널 상태를 바꾸지 않는다.
  useEffect(() => {
    setSelectedStayIdx(null);
    setHistoryPanelExpanded(true);
  }, [activeView, historyDayKey, selected?.id]);
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
  // 부모가 시간대를 고르면 그 시각의 마지막 확인 위치를 지도 중심으로 잡는다.
  // 최신 따라가기 상태에서는 center 가 null 이라 하루 경로 전체가 보이는 bounds 를 유지한다.
  const historyCenter = useMemo(
    () => resolveHistoryMapCenter({ followsLatest, stayCenter, scrubChildPoint }),
    [followsLatest, stayCenter, scrubChildPoint],
  );
  // 지도 아바타 좌표(중심과 분리 — 머문 곳을 선택해도 아이는 실제 이력점에 남는다).
  const historyChildMarker = useMemo(
    () =>
      historyChildPoint
        ? {
            lat: historyChildPoint.lat,
            lng: historyChildPoint.lng,
            name: childName,
            avatar: childAvatar,
            caption: followsLatest ? undefined : formatClockHM(scrubMs),
          }
        : null,
    [historyChildPoint, childName, childAvatar, followsLatest, scrubMs],
  );

  const selectHistoryDay = (requestedDateKey: string): void => {
    const nextDateKey = clampHistoryDayKey(requestedDateKey, now, premiumHistoryDays);
    if (!premiumOpen) {
      if (requestedDateKey !== historyTodayKey) {
        setHistoryUpsellDayKey(nextDateKey);
        setUpsellSource("location_history");
      }
      return;
    }
    if (nextDateKey === historyDayKey) return;
    setRawHistoryDayKey(nextDateKey);
    setScrubOffsetMinute(null);
    setSelectedStayIdx(null);
    setHistoryPanelExpanded(true);
  };

  const selectPreviousHistoryDay = (): void => {
    selectHistoryDay(addDaysToDateKey(historyDayKey, -1));
  };

  const selectNextHistoryDay = (): void => {
    selectHistoryDay(addDaysToDateKey(historyDayKey, 1));
  };

  const historyAtMin = historyDayKey === premiumHistoryRange.minDateKey;
  const historyAtMax = historyDayKey === premiumHistoryRange.maxDateKey;

  // 시간대별 경로 조작 — 목록 강조를 해제해 슬라이더가 지도 중심을 잡게 한다.
  // 패널은 그대로 유지해 시각과 장소의 연결 문맥이 사라지지 않게 한다.
  const moveScrubTo = (rawValue: number) => {
    setScrubOffsetMinute(clampHistoryOffsetMinute(rawValue, historyMaxOffsetMinute));
    setSelectedStayIdx(null);
    setScrubFocusKey((key) => key + 1);
  };

  const followLatestAgain = () => {
    setScrubOffsetMinute(null);
    setSelectedStayIdx(null);
    setScrubFocusKey((key) => key + 1);
  };

  // 고른 시각에 아이가 어디였는지 — 머문 곳 창 안이면 그 장소명, 아니면 이동 중.
  const scrubWhere = resolveScrubWhereLabel({
    stays: stayPoints,
    stayLabels,
    scrubMs,
    lastPointMs: scrubChildPoint?.ms ?? null,
  });
  const journeyRange = useMemo(() => getJourneyRecordedRange(timedTrail), [timedTrail]);
  const journeyState = resolveJourneyContentState({
    isFetching: historyFetching,
    isError: historyError,
    pointCount: timedTrail.length,
    stayCount: stayPoints.length,
  });
  const journeyRangeLabel = journeyRange
    ? `${formatClockHM(journeyRange.startMs)}–${formatClockHM(journeyRange.endMs)}`
    : null;
  const journeyStayItems = useMemo<StayTimelineItem[]>(
    () =>
      visibleStayPoints.map((stay, index) => ({
        id: `${stay.arrivalMs}-${index}`,
        order: index + 1,
        placeLabel: stayLabels[index] ?? "확인되지 않은 장소",
        timeLabel: `${formatClockHM(stay.arrivalMs)}–${formatClockHM(stay.departureMs)}`,
        dwellLabel: formatDwell(stay.dwellMs),
        selected: index === activeStayIdx,
      })),
    [activeStayIdx, stayLabels, visibleStayPoints],
  );
  const historyMapPadding = useMemo(
    () =>
      historyWideLayout
        ? { top: 76, right: 24, bottom: 24, left: historyPanelExpanded ? 424 : 112 }
        : { top: 176, right: 24, bottom: historyPanelExpanded ? 392 : 112, left: 24 },
    [historyPanelExpanded, historyWideLayout],
  );

  const mapZones: MapZone[] = (zones ?? []).map((z) => ({
    lat: z.lat,
    lng: z.lng,
    radiusM: z.radius_m,
    name: z.name,
  }));
  const mapPlaces: MapPlace[] = (places ?? [])
    .filter((p) => typeof p.location?.lat === "number" && typeof p.location?.lng === "number")
    .map((p) => ({ lat: p.location.lat, lng: p.location.lng, name: p.name, isHome: p.is_home }));

  // 수동·화면 진입 새로고침의 단일 흐름. 서버 updated_at이 실제 증가해야 성공으로 본다.
  const refreshLocation = useCallback(async (announceSuccess: boolean) => {
    if (!canShowLocation || isFetching || isRefreshingLocation) return;
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
      if (!refreshMounted.current || refreshSeq.current !== requestSeq) return;
      if (!requested.ok) {
        if (announceSuccess && requested.status === 429) {
          setUpsellSource("location_request");
          return;
        }
        show("아이 기기에 위치 요청을 보내지 못했어요", "⚠️");
        return;
      }
      setRefreshState("waiting");

      const outcome = await waitForNewChildLocation({
        before,
        targetUserId,
        refetch,
        isCancelled: () => !refreshMounted.current || refreshSeq.current !== requestSeq,
      });
      if (outcome === "cancelled") return;
      if (outcome === "updated") {
        if (announceSuccess) show("아이의 새 위치를 확인했어요", "📍");
        return;
      }
      if (outcome === "error") {
        show("위치 갱신 결과를 확인하지 못했어요", "⚠️");
        return;
      }
      show("아이 기기에 요청은 보냈지만 아직 새 위치가 도착하지 않았어요", "⚠️");
    } catch {
      show("위치 갱신에 실패했어요", "⚠️");
      return;
    } finally {
      if (refreshMounted.current && refreshSeq.current === requestSeq) {
        setRefreshState("idle");
      }
    }
  }, [
    canShowLocation,
    familyId,
    isFetching,
    isRefreshingLocation,
    loc,
    refetch,
    selected?.user_id,
    show,
  ]);

  // Premium만 화면 진입 시 즉시 위치를 요청한다. Free는 아이 기기의 약 10분 자동 보고를
  // 그대로 표시하며, 사용자가 갱신 버튼을 누른 경우에만 하루 5회 수동 요청을 사용한다.
  useEffect(() => {
    if (
      activeView !== "live"
      || !canShowLocation
      || !premiumOpen
      || !refreshTargetKey
      || !isFetched
      || isFetching
      || isRefreshingLocation
    ) return;
    if (autoRefreshKeyRef.current === refreshTargetKey) return;
    autoRefreshKeyRef.current = refreshTargetKey;
    void refreshLocation(false);
  }, [
    activeView,
    canShowLocation,
    isFetched,
    isFetching,
    isRefreshingLocation,
    premiumOpen,
    refreshLocation,
    refreshTargetKey,
  ]);

  const refresh = () => {
    void refreshLocation(true);
  };

  // 지도에 표시된 아이에게 전화. 번호 미등록이면 안내만.
  const callChild = () => {
    const number = selected?.phone;
    if (!number) {
      show(`${childName} 전화번호가 없어요`, "📞");
      return;
    }
    show(`${childName}에게 전화를 거는 중…`, "📞");
    void placePhoneCall(number).then((r) => {
      if (!r.ok) show("전화를 걸 수 없어요. 전화 앱을 확인해 주세요", "⚠️");
    });
  };

  return (
    <div className="pl-root">
      {/* 실 Kakao 지도 — 실시간(마커·구역·장소) ↔ 오늘경로(이동 폴리라인 + 출발/현재 마커). */}
      {activeView === "history" ? (
        <KakaoMap
          className="pl-map"
          child={historyChildMarker}
          route={trail}
          stays={mapStays}
          center={historyCenter}
          centerLevel={HISTORY_FOCUS_MAP_LEVEL}
          recenterKey={scrubFocusKey}
          places={historyPlaces}
          viewportPadding={historyMapPadding}
        />
      ) : (
        <KakaoMap
          className="pl-map"
          child={!isLocked && loc ? { lat: loc.lat, lng: loc.lng, name: childName, avatar: childAvatar } : null}
          zones={mapZones}
          places={mapPlaces}
        />
      )}

      {locationScopePending && (
        <div
          className={`pl-lock${locationScopeError ? " pl-lock--error" : ""}`}
          role={locationScopeError ? "alert" : "status"}
          aria-live={locationScopeError ? "assertive" : "polite"}
        >
          <div className="pl-lock__ring">
            {locationScopeError ? (
              <AlertTriangle size={30} strokeWidth={2.2} color="var(--gold-text)" />
            ) : (
              <RefreshCw size={30} strokeWidth={2.2} color="var(--blue-500)" className="pl-lock__spin" />
            )}
          </div>
          <div className="pl-lock__title">
            {locationScopeError ? "위치 조회 범위 확인 실패" : "조회 범위 확인 중"}
          </div>
          <div className="pl-lock__sub">
            {locationScopeError ? "구독 상태를 확인하지 못했어요." : "구독 상태를 확인하고 있어요."}
            {" "}
            {locationScopeError
              ? "인터넷 연결을 확인한 뒤 다시 시도해 주세요."
              : "확인되면 볼 수 있는 위치 범위를 표시해 드려요."}
          </div>
          {locationScopeError && (
            <button
              type="button"
              className="pl-lock__retry hy-press hy-busy-quiet"
              onClick={() => void entitlement.refetch()}
              disabled={entitlement.isFetching} aria-busy={entitlement.isFetching}
            >
              <RefreshCw
                size={18}
                strokeWidth={2.4}
                className={entitlement.isFetching ? "pl-lock__spin" : undefined}
              />
              {entitlement.isFetching ? "다시 확인 중…" : "다시 시도"}
            </button>
          )}
        </div>
      )}

      {/* 잠금 오버레이(무료) — 지도를 흐리게 덮고 프리미엄 유도. 하단 시트(안전 액션)는 위에 남는다. */}
      {isLocked && (
        <div className="pl-lock">
          <div className="pl-lock__ring">
            <img src={asset("ui/lock-3d.webp")} alt="" className="pl-lock__icon" />
          </div>
          <div className="pl-lock__title">실시간 위치는 프리미엄이에요</div>
          <div className="pl-lock__sub">
            무료 플랜은 약 10분 간격으로 최근 위치와 오늘 경로를 볼 수 있어요.{" "}
            프리미엄은 지금 위치와 최근 30일 이동 기록을 확인할 수 있어요.
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
      {!isLocked && !locationScopePending && (
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
              {isStandard ? "최근 위치" : "실시간"}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeView === "history"}
              className={`pl-viewtog__btn hy-press${activeView === "history" ? " pl-viewtog__btn--on" : ""}`}
              onClick={() => setView("history")}
            >
              {premiumOpen ? "이동 기록" : "오늘 경로"}
            </button>
          </div>
          {activeView === "live" && (
            <button
              type="button"
              className={`pl-refresh hy-busy-quiet${isRefreshingLocation ? " pl-refresh--loading" : ""}`}
              aria-label={isRefreshingLocation ? refreshOverlayTitle : "지금 위치 요청"}
              aria-busy={isRefreshingLocation}
              onClick={refresh}
              disabled={isFetching || isRefreshingLocation}
            >
              <RefreshCw size={20} strokeWidth={2.2} color="var(--fg-muted)" aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      {!isLocked && !locationScopePending && activeView === "history" && selected && (
        <LocationHistoryToolbar
          childName={selected.name || "아이"}
          childAvatarSrc={avatarSrc(childAvatarPath(selected.photo_url))}
          dayLabel={historyDayLabel}
          dateValue={historyDateValue}
          minDateValue={historyMinDateValue}
          maxDateValue={historyMaxDateValue}
          premiumOpen={premiumOpen}
          previousDisabled={premiumOpen && historyAtMin}
          nextDisabled={historyAtMax}
          onPrevious={selectPreviousHistoryDay}
          onNext={selectNextHistoryDay}
          onDateChange={(value) => {
            const nextDateKey = dateInputValueToDateKey(value);
            if (nextDateKey) selectHistoryDay(nextDateKey);
          }}
        />
      )}

      {/* 아이 표시 배지 — 실시간에서만 현재 보는 아이를 명시한다. */}
      {!isLocked && !locationScopePending && activeView === "live" && selected && (
        <div className="pl-chips">
          <div
            className="pl-chip pl-chip--active"
            data-refreshing={isRefreshingLocation ? "true" : "false"}
            aria-label={`현재 ${selected.name || "아이"} 위치 보기`}
          >
            <span className="pl-chip__avatar">
              <img className="hy-network-avatar" src={avatarSrc(childAvatarPath(selected.photo_url))} alt="" loading="eager" decoding="async" />
            </span>
            <span className="pl-chip__main">
              <span className="pl-chip__name">{selected.name || "아이"}</span>
              {isRefreshingLocation && (
                <span className="pl-chip__status" role="status" aria-live="polite">
                  {refreshOverlayTitle}
                </span>
              )}
            </span>
            {isRefreshingLocation ? (
              <span className="pl-chip__spinner" aria-hidden="true" />
            ) : (
              <span className="pl-chip__dot" />
            )}
          </div>
        </div>
      )}

      {/* 오늘 경로는 로딩·오류·빈 기록·이동만 상태에서도 같은 타임라인 자리를 유지한다. */}
      {activeView === "history" && canShowHistory && (
        <LocationJourneyPanel
          childName={childName}
          dayLabel={historyDayLabel}
          state={journeyState}
          expanded={historyPanelExpanded}
          recordedRangeLabel={journeyRangeLabel}
          stayCount={visibleStayPoints.length}
          currentTimeLabel={formatClockHM(scrubMs)}
          currentWhere={scrubWhere}
          sliderMax={historyMaxOffsetMinute}
          sliderValue={effectiveScrubOffsetMinute}
          followsLatest={followsLatest}
          stays={journeyStayItems}
          onToggleExpanded={() => setHistoryPanelExpanded((value) => !value)}
          onSliderChange={moveScrubTo}
          onFollowLatest={followLatestAgain}
          onSelectStay={(index) => setSelectedStayIdx(activeStayIdx === index ? null : index)}
          onRetry={() => void refetchHistory()}
        />
      )}

      {/* 하단 상세 카드는 실시간 보기에서만 표시한다. */}
      {activeView === "live" && (
      <div className="pl-sheet">
        <div className="pl-sheet__handle" />
        <div className="pl-sheet__head">
          <div className="pl-sheet__avatar">
            <img className="hy-network-avatar" src={avatarSrc(childAvatar)} alt="" loading="eager" decoding="async" />
          </div>
          <div className="pl-sheet__info">
            <div className="pl-sheet__name">{sheetName}</div>
            <div
              className={`pl-sheet__zone${isLocked ? " pl-sheet__zone--locked" : ""}${isStaleLocation || isLowAccuracy ? " pl-sheet__zone--stale" : ""}${isRefreshingLocation ? " pl-sheet__zone--loading" : ""}`}
            >
              <span className="pl-sheet__zone-dot" />
              {sheetZoneText}
              {isStandard && <span className="pl-delay-badge">약 10분 간격 자동 확인</span>}
            </div>
          </div>
          {/* 상태 칩은 말할 내용이 있을 때만 렌더한다(정상일 때 빈 알약이 보이던 문제). */}
          {(() => {
            const durText = locationScopeError
              ? "오류"
              : locationScopePending || isRefreshingLocation
                ? "확인 중"
                : loc
                  ? ""
                  : "오프라인";
            if (!durText) return null;
            return (
              <span className={`pl-sheet__dur${isRefreshingLocation ? " pl-sheet__dur--loading" : ""}`}>
                {durText}
              </span>
            );
          })()}
        </div>

        {/* 갱신 실패 / 위치 없음 → 상태 화면으로 (잠금 시엔 위치 부재가 아니라 잠금이므로 숨김) */}
        {!isLocked && !locationScopePending && (isError || !loc) && (
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

        {/* Free — 최근 위치를 유지하면서 실시간·30일 이력 가치를 안내한다. */}
        {isStandard && (
          <button
            type="button"
            className="pl-upsell hy-press"
            onClick={() => {
              setHistoryUpsellDayKey(null);
              setUpsellSource("location_history");
            }}
          >
            <Crown size={16} strokeWidth={2.2} color="var(--gold-text)" />
            실시간 위치와 30일 이동 기록 보기
          </button>
        )}

        <div className="pl-actions">
          <button
            type="button"
            className="pl-memo-btn hy-press"
            aria-label="메모 남기기"
            onClick={() => navigate("/parent/memo")}
          >
            <MessageCircle size={22} strokeWidth={2.2} color="#fff" aria-hidden="true" />
            <span className="pl-actions__label">메모</span>
          </button>
          {/* 길찾기는 모든 티어에서 열고, 주변 소리는 대상 화면의 고지형 Premium gate를 사용한다. */}
          {!isLocked && !locationScopePending && (
            <>
              <button
                type="button"
                className="pl-route-btn hy-press"
                aria-label="다음 일정 길찾기"
                onClick={() => navigate("/route")}
              >
                <Navigation size={22} strokeWidth={2.2} color="var(--blue-500)" aria-hidden="true" />
                <span className="pl-actions__label">경로</span>
              </button>
              <button
                type="button"
                className="pl-listen-btn hy-press"
                aria-label="주변 소리 듣기"
                onClick={() => navigate("/remote-audio")}
              >
                <img src={asset("ui/menu-remote-audio.webp")} alt="" />
                <span className="pl-actions__label">주변소리</span>
              </button>
            </>
          )}
          <button type="button" className="pl-call-btn hy-press" aria-label="아이에게 전화 걸기" onClick={callChild}>
            <Phone size={22} strokeWidth={2.2} color="var(--mint-text)" aria-hidden="true" />
            <span className="pl-actions__label">전화</span>
          </button>
        </div>
      </div>
      )}
      {upsellSource && (
        <PremiumUpsell
          open
          source={upsellSource}
          tier={entitlement.tier}
          returnTo={(() => {
            const params = new URLSearchParams();
            if (childParam) params.set("child", childParam);
            if (upsellSource === "location_history") {
              params.set("view", "history");
              if (historyUpsellDayKey) {
                params.set("date", dateKeyToDateInputValue(historyUpsellDayKey));
              }
            }
            const query = params.toString();
            return `/parent/location${query ? `?${query}` : ""}`;
          })()}
          onClose={() => {
            setUpsellSource(null);
            setHistoryUpsellDayKey(null);
          }}
          onUpgrade={({ source, feature, returnTo }) => {
            const storage = browserPremiumReturnIntentStorage();
            const saved = storage && returnTo
              ? savePremiumReturnIntent(storage, { source, feature, returnTo })
              : false;
            if (!saved) throw new Error("결제 후 위치 화면으로 돌아올 경로를 안전하게 보관하지 못했어요. 잠시 후 다시 시도해 주세요.");
            setUpsellSource(null);
            setHistoryUpsellDayKey(null);
            navigate("/subscription");
          }}
        />
      )}
    </div>
  );
}

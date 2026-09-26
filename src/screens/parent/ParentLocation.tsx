import { useFamilyTimeZone } from "@/region/FamilyTimeZone";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useIntl, type IntlShape } from "react-intl";
import { useLocale } from "@/i18n/useLocale";
import { formatDateTime } from "@/i18n/format";
import { useNavigate, useSearchParams } from "react-router";
import {
  AlertTriangle,
  Crown,
  RefreshCw,
} from "lucide-react";
import { asset } from "@/lib/assets";
import { childAvatarPath } from "@/lib/avatar";
import { useToast } from "@/app/toast";
import { useAuth } from "@/auth/AuthContext";
import { useActiveChild } from "@/app/activeChild";
import { ChildSwitcher } from "@/components/ChildSwitcher";
import { useMyFamily } from "@/queries/useFamily";
import { FamilyMap, type MapZone, type MapPlace, type MapStay } from "@/maps/FamilyMap";
import {
  useChildLocations,
  useDangerZones,
  useSavedPlaces,
  useLocationHistory,
} from "@/queries/useLocation";
import { useEvents } from "@/queries/useSchedule";
import { useLocationLabels } from "@/queries/useLocationLabels";
import { stayLocationReference } from "@/transform/locationLabelReference";
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
  dateInputValueToDateKey,
  dateKeyToDateInputValue,
  dateToDateKeyInTimeZone,
  parseAppDateKey,
} from "@/transform/dateKey";
import { filterEventsForChild } from "@/transform/eventScope";
import {
  clampHistoryDayKey,
  getHistoryDayKey,
  getHistoryDayKeyRange,
  getHistoryDayWindow,
  getHistoryDayWindowForKey,
} from "@/transform/locationHistoryWindow";
import { placePhoneCall } from "@/lib/native/phone";
import { requestLocationRefresh } from "@/lib/api/endpoints/remote";
import { waitForNewChildLocation } from "@/transform/locationRefreshWait";
import { childDeviceSilentSince } from "@/transform/childDeviceSilence";
import {
  buildTrailPoints,
  findStayIndexAtMs,
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
  clampJourneyScrubMs,
  getJourneyRecordedRange,
  resolveJourneyContentState,
} from "@/transform/locationJourneyView";
import { LocationHistoryToolbar } from "@/screens/parent/LocationHistoryToolbar";
import {
  LocationJourneyPanel,
  type StayTimelineItem,
} from "@/screens/parent/LocationJourneyPanel";
import "./ParentLocation.css";
import "./ParentLocation.redesign.css";

function avatarSrc(path: string): string {
  return path.startsWith("http") || path.startsWith("blob:") ? path : asset(path);
}

function isUploadedPhoto(path: string | null | undefined): boolean {
  const value = path?.trim() ?? "";
  return value.startsWith("http") || value.startsWith("blob:");
}

const SCHEDULE_STAY_RADIUS_M = 220;
const MIN_SCHEDULE_STAY_OVERLAP_MS = 10 * 60 * 1000;
// 시간대·머문 곳 포커스 시 확대 단계(Kakao level — 작을수록 확대). 하루 전체 bounds 로 멀어진
// 화면에서도 그 시각 위치가 보이도록 동네 축척까지만 당긴다(이미 더 확대돼 있으면 그대로 둔다).
const HISTORY_FOCUS_MAP_LEVEL = 4;
const HISTORY_MAP_VIEWPORT_PADDING = Object.freeze({ top: 160, right: 24, bottom: 24, left: 24 });
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

function eventLabel(event: CalendarEvent, intl: IntlShape): string {
  return (event.title || event.location?.address || intl.formatMessage({ id: "parent.home.schedulePlace" })).trim();
}

function scheduleStayLabel(stay: StayPoint, events: CalendarEvent[], intl: IntlShape): string | null {
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
  return candidates[0] ? eventLabel(candidates[0].event, intl) : null;
}

/**
 * 하루 위치 이력 → 이동 경로 폴리라인 좌표.
 * 계산은 `transform/locationHistoryScrub` 의 순수 함수가 담당한다(실측점만 · 8m 지터 압축).
 */
export function ParentLocation() {
  const familyTimeZone = useFamilyTimeZone();
  const intl = useIntl();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const { show } = useToast();
  const { familyId } = useAuth();
  const { data: locations, refetch, isFetching, isFetched, isError } = useChildLocations();
  const { data: zones } = useDangerZones();
  const { data: places } = useSavedPlaces();
  const { data: events } = useEvents();
  const entitlement = useEntitlement();
  const [searchParams, setSearchParams] = useSearchParams();

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
  const historyTodayKey = useMemo(() => getHistoryDayKey(now, familyTimeZone), [familyTimeZone, now]);
  const premiumHistoryDays = historyDaysFor(TIERS.PREMIUM);
  const premiumHistoryRange = useMemo(
    () => getHistoryDayKeyRange(now, premiumHistoryDays, familyTimeZone),
    [familyTimeZone, now, premiumHistoryDays],
  );
  const requestedHistoryDayKey = dateInputValueToDateKey(searchParams.get("date") ?? "");
  const [rawHistoryDayKey, setRawHistoryDayKey] = useState(
    () => requestedHistoryDayKey ?? historyTodayKey,
  );
  // Free/reviewed는 URL이나 이전 상태에 과거 날짜가 남아 있어도 서버 요청 전에 오늘로 고정한다.
  const historyDayKey = premiumOpen
    ? clampHistoryDayKey(rawHistoryDayKey, now, premiumHistoryDays, familyTimeZone)
    : historyTodayKey;
  const historyWindow = useMemo(
    () => getHistoryDayWindowForKey(historyDayKey, now, familyTimeZone) ?? getHistoryDayWindow(now, familyTimeZone),
    [familyTimeZone, historyDayKey, now],
  );
  const historyMinDateValue = dateKeyToDateInputValue(premiumHistoryRange.minDateKey);
  const historyMaxDateValue = dateKeyToDateInputValue(premiumHistoryRange.maxDateKey);
  const historyDateValue = dateKeyToDateInputValue(historyDayKey);
  const historyDayLabel = useMemo(() => {
    if (historyDayKey === historyTodayKey) return intl.formatMessage({ id: "parent.location.today" });
    const date = parseAppDateKey(historyDayKey);
    return date
      ? formatDateTime(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12), {
          locale,
          // date_key 는 instant 가 아니라 고른 달력 날짜라 날짜 자체를 보존한다.
          timeZone: "UTC",
          dateStyle: "medium",
        })
      : intl.formatMessage({ id: "parent.parentLocation.copy001" });
  }, [historyDayKey, historyTodayKey]);
  // null = 최신 따라가기(기본). 숫자 = 부모가 직접 고른 실제 기록 시각(ms).
  // 위치 폴링(30초)마다 `now` 가 갱신돼도 부모가 고른 시각을 최신으로 되돌리지 않는다.
  const [scrubTimeMs, setScrubTimeMs] = useState<number | null>(null);
  // 지도 중심은 연속 드래그가 멈춘 뒤에만 갱신한다. 시각·마커 표시는 즉시 움직이되
  // 같은 장소에 setCenter→panBy를 반복해 지도가 떨리는 현상을 막는다.
  const [settledScrubTimeMs, setSettledScrubTimeMs] = useState<number | null>(null);

  // 대상 아이 = 전역 활성 아이. 다자녀면 지도 위 전환 알약으로 바로 바꾼다(홈과 같은 전역 선택).
  // 예외: 알림/SOS/도착에서 `?child=<user_id>` 로 진입하면 그 아이를 우선(위급 아이 — 안전 규칙).
  const { activeChild, childMembers } = useActiveChild();
  // 위치 요청은 서버가 주 보호자에게만 허용한다. 공동 보호자는 화면에 들어올 때마다
  // 거절 안내가 뜨지 않도록 자동 요청을 보내지 않는다(직접 누르면 이유를 알려 준다).
  const familyQuery = useMyFamily();
  const canAutoRequestLocation = familyQuery.data?.isPrimaryParent === true;
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
  const childName = selected?.name || intl.formatMessage({ id: "parent.location.childFallback" });
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

  const fresh = loc ? formatFreshness(loc.updated_at, now, locale, intl) : null;
  const accuracyM = loc?.accuracy_m != null && Number.isFinite(Number(loc.accuracy_m))
    ? Math.max(0, Math.round(Number(loc.accuracy_m)))
    : null;
  const isLowAccuracy = accuracyM != null && accuracyM > 150;
  const locationLabel = useLocationLabels(loc ? [loc] : [], places);
  const curPlace = loc ? locationLabel(loc) : intl.formatMessage({ id: "parent.location.checking" });
  const isStaleLocation = !!loc && fresh?.status === "stale";
  // 위치도 기기 상태 보고도 20분 넘게 멈췄으면 "폰이 연결되지 않음"을 그대로 말한다(서버 푸시는 계속 보내는 중).
  const deviceSilentSince = loc
    ? childDeviceSilentSince({
      locationUpdatedAt: loc.updated_at,
      deviceReportedAt: selected?.device_health?.lastReportedAt ?? selected?.device_health?.updatedAt ?? null,
      now,
    })
    : null;
  // 새로고침 콜백은 화면 진입 자동 요청 effect 의 의존성이라, 렌더마다 바뀌는 값은 ref 로만 읽는다.
  const deviceSilentRef = useRef<{ silent: boolean; childName: string }>({ silent: false, childName });
  deviceSilentRef.current = { silent: deviceSilentSince !== null, childName };
  const deviceSilentLabel = deviceSilentSince
    ? formatDateTime(deviceSilentSince, {
      locale,
      timeZone: familyTimeZone,
      ...(dateToDateKeyInTimeZone(deviceSilentSince, familyTimeZone) === dateToDateKeyInTimeZone(now, familyTimeZone)
        ? { timeStyle: "short" as const }
        : { dateStyle: "medium" as const, timeStyle: "short" as const }),
    })
    : null;
  const sheetName = locationScopeError
    ? intl.formatMessage({ id: "parent.location.scopeFailedForChild" }, { childName })
    : locationScopePending
    ? intl.formatMessage({ id: "parent.location.scopeLoadingForChild" }, { childName })
    : isLocked
    ? childName
    : isRefreshingLocation
      ? intl.formatMessage({ id: "parent.location.refreshingForChild" }, { childName })
      : isStaleLocation
        ? intl.formatMessage({ id: "parent.location.lastSeenAt" }, { childName, place: curPlace })
        : `${childName} · ${curPlace}`;
  const sheetZoneText = locationScopeError
    ? intl.formatMessage({ id: "parent.parentLocation.copy003" })
    : locationScopePending
    ? intl.formatMessage({ id: "parent.parentLocation.copy004" })
    : isLocked
    ? intl.formatMessage({ id: "parent.parentLocation.copy005" })
    : deviceSilentLabel && !isRefreshingLocation
    ? intl.formatMessage({ id: "parent.location.deviceSilentSince" }, { time: deviceSilentLabel })
    : isLowAccuracy
      ? intl.formatMessage({ id: "parent.location.lowAccuracy" }, { accuracy: accuracyM, freshness: fresh?.label ?? intl.formatMessage({ id: "parent.parentLocation.copy007" }) })
      : accuracyM != null
        ? intl.formatMessage({ id: "parent.location.freshnessAccuracy" }, { freshness: fresh?.label ?? intl.formatMessage({ id: "parent.parentLocation.copy008" }), accuracy: accuracyM })
        : (fresh?.label ?? intl.formatMessage({ id: "parent.parentLocation.copy008" }));
  // 진행 표시자는 상단 새로고침 버튼 하나뿐이다(2026-08-17 TK 제보).
  // 예전에는 아이 칩과 상세 카드가 "위치 요청을 보냈어요"를 각각 띄우고 칩 폭까지 늘려서,
  // 프로필 위에 문구가 겹치고 버튼과 별개로 움직이는 것처럼 보였다. 문구는 재도입하지 않는다.
  const refreshBusyLabel = intl.formatMessage(
    { id: "parent.location.refreshingForChild" },
    { childName },
  );

  // ── 보기 모드: 최근/실시간 위치 ↔ 오늘 이동 경로 ─────────────────────
  const [view, setView] = useState<"live" | "history">(requestedView);
  useEffect(() => {
    setView(requestedView);
  }, [requestedView]);
  // 조회 범위 미확정에서는 경로 캐시를 렌더링하지 않는다.
  const activeView: "live" | "history" = isLocked || locationScopePending ? "live" : view;
  // 보기 전환·아이 전환에서만 최신 따라가기로 돌아간다(폴링으로 되돌리지 않는다).
  useEffect(() => {
    setScrubTimeMs(null);
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

  const timedHistoryPoints = useMemo(
    () => toTimedPoints(visibleHistory, selected?.user_id ?? null),
    [visibleHistory, selected?.user_id],
  );
  const timedTrail = useMemo(
    () => buildTrailPoints(visibleHistory, selected?.user_id ?? null),
    [visibleHistory, selected?.user_id],
  );
  const journeyRange = useMemo(
    () => getJourneyRecordedRange(timedHistoryPoints),
    [timedHistoryPoints],
  );
  const followsLatest = scrubTimeMs == null;
  const scrubMs = journeyRange
    ? followsLatest
      ? journeyRange.endMs
      : clampJourneyScrubMs(scrubTimeMs, journeyRange)
    : historyWindow.endMs;
  const mapFocusMs = followsLatest
    ? null
    : settledScrubTimeMs ?? journeyRange?.endMs ?? historyWindow.endMs;
  const settledScrubChildPoint = useMemo(() => {
    if (mapFocusMs == null) return null;
    for (let index = timedTrail.length - 1; index >= 0; index -= 1) {
      if (timedTrail[index].ms <= mapFocusMs) return timedTrail[index];
    }
    return null;
  }, [mapFocusMs, timedTrail]);
  const visibleTrail = useMemo(
    () => timedTrail.filter((p) => p.ms <= scrubMs),
    [scrubMs, timedTrail],
  );
  const scrubEvidencePoint = useMemo(() => {
    for (let index = timedHistoryPoints.length - 1; index >= 0; index -= 1) {
      if (timedHistoryPoints[index].ms <= scrubMs) return timedHistoryPoints[index];
    }
    return null;
  }, [scrubMs, timedHistoryPoints]);
  const trail = useMemo(
    () => visibleTrail.map((p) => ({ lat: p.lat, lng: p.lng })),
    [visibleTrail],
  );
  const scrubChildPoint = visibleTrail.length > 0 ? visibleTrail[visibleTrail.length - 1] : null;
  const historyChildPoint =
    scrubChildPoint ?? (followsLatest && loc ? { lat: loc.lat, lng: loc.lng } : null);
  // 출발 마커(첫 위치). 현재 마커는 지도의 child 아바타 오버레이가 담당.
  // 매 렌더 새 배열을 만들면 지도 오버레이가 통째로 다시 그려지므로 메모이즈한다.
  const trailStart = useMemo<MapPlace[]>(
    () => (trail.length ? [{ lat: trail[0].lat, lng: trail[0].lng, name: intl.formatMessage({ id: "parent.location.departure" }) }] : []),
    [trail],
  );

  // ── 스테이포인트: 하루 이력에서 GPS 노이즈를 걸러 머무른 장소 + 체류시간을 검출. ──
  const stayPoints = useMemo<StayPoint[]>(
    () => detectStayPoints(timedHistoryPoints),
    [timedHistoryPoints],
  );
  const selectedHistoryEvents = useMemo(
    () =>
      filterEventsForChild(
        (events ?? []).filter((event) => event.date_key === historyDayKey),
        selected?.id ?? null,
      ),
    [events, historyDayKey, selected?.id],
  );
  const knownStayLabels = useMemo(
    () => stayPoints.map((s) => scheduleStayLabel(s, selectedHistoryEvents, intl) ?? stayPlaceLabel(s, places)),
    [stayPoints, selectedHistoryEvents, places],
  );
  const stayReferences = useMemo(
    () => stayPoints.map((stay, index) => knownStayLabels[index]
      ? null : stayLocationReference(stay, visibleHistory, selected?.user_id ?? null)),
    [stayPoints, knownStayLabels, visibleHistory, selected?.user_id],
  );
  const unresolvedStayLocations = useMemo(
    () => stayReferences.filter((reference) => reference !== null), [stayReferences],
  );
  const mapStayLabel = useLocationLabels(unresolvedStayLocations, undefined, { fallback: "" });
  const stayLabels = useMemo(
    () => stayPoints.map((_, index) => knownStayLabels[index]
      ?? (stayReferences[index] ? mapStayLabel(stayReferences[index]) || null : null)),
    [stayPoints, knownStayLabels, stayReferences, mapStayLabel],
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
            name: `${event.time || ""} ${eventLabel(event, intl)}`.trim(),
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
  const historyToolbarRef = useRef<HTMLElement | null>(null);
  const historyPanelRef = useRef<HTMLElement | null>(null);

  // 시간 막대는 제거했지만 날짜·아이 전환 때 중심값을 같은 렌더에서 정리해 지도 떨림을 막는다.
  useEffect(() => {
    if (scrubTimeMs == null) {
      setSettledScrubTimeMs(null);
      return;
    }
    const nextScrubTimeMs = journeyRange
      ? clampJourneyScrubMs(scrubTimeMs, journeyRange)
      : historyWindow.endMs;
    const timer = window.setTimeout(() => {
      setSettledScrubTimeMs(nextScrubTimeMs);
    }, 160);
    return () => window.clearTimeout(timer);
  }, [historyWindow.endMs, journeyRange, scrubTimeMs]);

  // 아이·날짜·보기 전환에서만 선택을 초기화하고 패널을 펼친다.
  // 60초 이력 폴링과 시간 막대 조작은 사용자가 정한 패널 상태를 바꾸지 않는다.
  useEffect(() => {
    setSelectedStayIdx(null);
    setHistoryPanelExpanded(true);
  }, [activeView, historyDayKey, selected?.id]);
  const scrubStayIdx = scrubChildPoint
    ? findStayIndexAtMs(stayPoints, Math.min(scrubMs, scrubChildPoint.ms))
    : null;
  const manuallySelectedStayIdx =
    selectedStayIdx != null && selectedStayIdx < visibleStayPoints.length ? selectedStayIdx : null;
  const activeStayIdx = manuallySelectedStayIdx ?? scrubStayIdx;
  const settledScrubStayIdx = settledScrubChildPoint
    ? findStayIndexAtMs(
        stayPoints,
        Math.min(mapFocusMs ?? settledScrubChildPoint.ms, settledScrubChildPoint.ms),
      )
    : null;
  // 지도용 스테이 마커(순번·체류시간·장소명·강조).
  const mapStays = useMemo<MapStay[]>(
    () =>
      visibleStayPoints.map((s, i) => ({
        lat: s.lat,
        lng: s.lng,
        order: i + 1,
        dwellLabel: formatDwell(s.dwellMs, locale),
        placeName: stayLabels[i] ?? null,
        active: i === activeStayIdx,
      })),
    [visibleStayPoints, stayLabels, activeStayIdx],
  );
  // 목록 항목 선택 시 지도 중심을 그 스테이포인트로.
  const stayCenter = manuallySelectedStayIdx != null
    ? {
        lat: visibleStayPoints[manuallySelectedStayIdx].lat,
        lng: visibleStayPoints[manuallySelectedStayIdx].lng,
      }
    : settledScrubStayIdx != null
      ? { lat: stayPoints[settledScrubStayIdx].lat, lng: stayPoints[settledScrubStayIdx].lng }
      : null;
  // 부모가 시간대를 고르면 그 시각의 마지막 확인 위치를 지도 중심으로 잡는다.
  // 최신 따라가기 상태에서는 center 가 null 이라 하루 경로 전체가 보이는 bounds 를 유지한다.
  const historyCenter = useMemo(
    () => resolveHistoryMapCenter({
      followsLatest,
      stayCenter,
      scrubChildPoint: settledScrubChildPoint,
    }),
    [followsLatest, settledScrubChildPoint, stayCenter],
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
            caption: followsLatest ? undefined : formatClockHM(scrubMs, locale, familyTimeZone),
          }
        : null,
    [familyTimeZone, historyChildPoint, childName, childAvatar, followsLatest, scrubMs],
  );

  const selectHistoryDay = (requestedDateKey: string): void => {
    const nextDateKey = clampHistoryDayKey(requestedDateKey, now, premiumHistoryDays, familyTimeZone);
    if (!premiumOpen) {
      if (requestedDateKey !== historyTodayKey) {
        setHistoryUpsellDayKey(nextDateKey);
        setUpsellSource("location_history");
      }
      return;
    }
    if (nextDateKey === historyDayKey) return;
    setRawHistoryDayKey(nextDateKey);
    setScrubTimeMs(null);
    setSelectedStayIdx(null);
    setHistoryPanelExpanded(true);
  };


  // 시간대별 경로 조작 — 수동 목록 선택을 해제해 고른 시각의 머문 곳을 자동 강조한다.
  // 드래그 도중 패널 높이를 바꾸면 지도 가시 영역도 바뀌어 한 번 더 흔들리므로 펼침 상태는 유지한다.
  const moveScrubTo = (rawValue: number) => {
    if (!journeyRange) return;
    setScrubTimeMs(clampJourneyScrubMs(rawValue, journeyRange));
    setSelectedStayIdx(null);
  };

  const followLatestAgain = () => {
    setScrubTimeMs(null);
    setSelectedStayIdx(null);
  };

  // 고른 시각에 아이가 어디였는지 — 머문 곳 창 안이면 그 장소명, 아니면 이동 중.
  const scrubWhere = resolveScrubWhereLabel({
    stays: stayPoints,
    stayLabels,
    scrubMs,
    lastPointMs: scrubEvidencePoint?.ms ?? null,
  });
  const journeyState = resolveJourneyContentState({
    isFetching: historyFetching,
    isError: historyError,
    pointCount: timedHistoryPoints.length,
    stayCount: stayPoints.length,
  });
  const journeyRangeLabel = journeyRange
    ? `${formatClockHM(journeyRange.startMs, locale, familyTimeZone)}–${formatClockHM(journeyRange.endMs, locale, familyTimeZone)}`
    : null;
  const journeyStayItems = useMemo<StayTimelineItem[]>(
    () =>
      visibleStayPoints.map((stay, index) => ({
        id: `${stay.arrivalMs}-${index}`,
        order: index + 1,
        placeLabel: stayLabels[index] ?? intl.formatMessage({ id: "shared.location.unverifiedPlace" }),
        timeLabel: `${formatClockHM(stay.arrivalMs, locale, familyTimeZone)}–${formatClockHM(stay.departureMs, locale, familyTimeZone)}`,
        dwellLabel: formatDwell(stay.dwellMs, locale),
        selected: index === activeStayIdx,
      })),
    [familyTimeZone, activeStayIdx, stayLabels, visibleStayPoints],
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
      show(intl.formatMessage({ id: "notifications.locationStatus.toast.deviceMissing" }), "⚠️");
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
        if (requested.error === "primary_parent_required") {
          show(intl.formatMessage({ id: "core.error.api.primaryParentRequired.formal" }), "🔒");
          return;
        }
        show(intl.formatMessage({ id: "notifications.locationStatus.toast.requestFailed" }), "⚠️");
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
        if (announceSuccess) show(intl.formatMessage({ id: "parent.parentLocation.copy011" }), "📍");
        return;
      }
      if (outcome === "error") {
        show(intl.formatMessage({ id: "parent.parentLocation.copy012" }), "⚠️");
        return;
      }
      // 폰이 이미 20분 넘게 연락이 없던 상태면, "아직 도착하지 않았어요" 대신 확인할 것을 알려 준다.
      show(
        deviceSilentRef.current.silent
          ? intl.formatMessage(
            { id: "notifications.locationStatus.toast.deviceSilent" },
            { childName: deviceSilentRef.current.childName },
          )
          : intl.formatMessage({ id: "notifications.locationStatus.toast.noUpdate" }),
        "⚠️",
      );
    } catch {
      show(intl.formatMessage({ id: "notifications.locationStatus.toast.refreshFailed" }), "⚠️");
      return;
    } finally {
      if (refreshMounted.current && refreshSeq.current === requestSeq) {
        setRefreshState("idle");
      }
    }
  }, [canShowLocation,
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
      || !canAutoRequestLocation
      || !refreshTargetKey
      || !isFetched
      || isFetching
      || isRefreshingLocation
    ) return;
    if (autoRefreshKeyRef.current === refreshTargetKey) return;
    autoRefreshKeyRef.current = refreshTargetKey;
    void refreshLocation(false);
  }, [activeView,
    canAutoRequestLocation,
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
      show(intl.formatMessage({ id: "parent.location.noPhone" }, { childName }), "📞");
      return;
    }
    show(intl.formatMessage({ id: "parent.location.calling" }, { childName }), "📞");
    void placePhoneCall(number).then((r) => {
      if (!r.ok) show(intl.formatMessage({ id: "parent.parentLocation.copy015" }), "⚠️");
    });
  };

  return (
    <div className={`pl-root${activeView === "history" ? " pl-root--history" : ""}`}>
      {/* 실 Kakao 지도 — 실시간(마커·구역·장소) ↔ 오늘경로(이동 폴리라인 + 출발/현재 마커). */}
      {activeView === "history" ? (
        <FamilyMap
          className="pl-map"
          child={historyChildMarker}
          route={trail}
          stays={mapStays}
          center={historyCenter}
          centerLevel={HISTORY_FOCUS_MAP_LEVEL}
          places={historyPlaces}
          viewportPadding={HISTORY_MAP_VIEWPORT_PADDING}
        />
      ) : (
        <FamilyMap
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
            {locationScopeError ? intl.formatMessage({ id: "parent.parentHome.copy014" }) : intl.formatMessage({ id: "parent.parentLocation.copy017" })}
          </div>
          <div className="pl-lock__sub">
            {locationScopeError ? intl.formatMessage({ id: "parent.parentLocation.copy018" }) : intl.formatMessage({ id: "parent.parentLocation.copy019" })}
            {" "}
            {locationScopeError
              ? intl.formatMessage({ id: "core.error.api.network.formal" })
              : intl.formatMessage({ id: "parent.parentLocation.copy021" })}
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
              {entitlement.isFetching ? intl.formatMessage({ id: "notifications.action.checkingAgain" }) : intl.formatMessage({ id: "core.action.retry" })}
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
          <div className="pl-lock__title">{intl.formatMessage({ id: "parent.parentLocation.copy028" })}</div>
          <div className="pl-lock__sub">
            {intl.formatMessage({ id: "parent.parentLocation.copy029" })}{" "}
            {intl.formatMessage({ id: "parent.parentLocation.copy030" })}
          </div>
          <button
            type="button"
            className="pl-lock__cta hy-press"
            onClick={() => navigate("/subscription")}
          >
            {intl.formatMessage({ id: "billing.trialLock.start" })}
          </button>
        </div>
      )}

      {/* 상단 오버레이(잠금 시 숨김) — 보기 토글 + (실시간에서만) 새로고침 */}
      {!isLocked && !locationScopePending && (
        <div className="pl-top">
          <div className="pl-viewtog" role="tablist" aria-label={intl.formatMessage({ id: "parent.parentLocation.copy032" })}>
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
              {isStandard ? intl.formatMessage({ id: "parent.parentLocation.copy033" }) : intl.formatMessage({ id: "parent.location.mode.realtime" })}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeView === "history"}
              className={`pl-viewtog__btn hy-press${activeView === "history" ? " pl-viewtog__btn--on" : ""}`}
              onClick={() => setView("history")}
            >
              {premiumOpen ? intl.formatMessage({ id: "parent.parentLocation.copy035" }) : intl.formatMessage({ id: "parent.parentLocation.copy036" })}
            </button>
          </div>
          {activeView === "live" && (
            <button
              type="button"
              className={`pl-refresh hy-busy-quiet${isRefreshingLocation ? " pl-refresh--loading" : ""}`}
              aria-label={isRefreshingLocation ? refreshBusyLabel : intl.formatMessage({ id: "parent.location.action.requestNow" })}
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
          containerRef={historyToolbarRef}
          childName={selected.name || intl.formatMessage({ id: "parent.location.childFallback" })}
          childAvatarSrc={avatarSrc(childAvatarPath(selected.photo_url))}
          dayLabel={historyDayLabel}
          dateValue={historyDateValue}
          minDateValue={historyMinDateValue}
          maxDateValue={historyMaxDateValue}
          premiumOpen={premiumOpen}
          onDateChange={(value) => {
            const nextDateKey = dateInputValueToDateKey(value);
            if (nextDateKey) selectHistoryDay(nextDateKey);
          }}
        />
      )}

      {/* 아이 표시 배지 — 실시간에서만 현재 보는 아이를 명시한다. */}
      {!isLocked && !locationScopePending && activeView === "live" && selected && childMembers.length > 1 && (
        <div className="pl-chips">
          {/* 알림 딥링크(?child=)로 들어온 뒤 직접 고르면 그 고정을 풀어 선택한 아이를 보여 준다. */}
          <ChildSwitcher
            className="pl-kidswitch"
            selectedId={selected.id}
            onChange={() => {
              if (!childParam) return;
              const next = new URLSearchParams(searchParams);
              next.delete("child");
              setSearchParams(next, { replace: true });
            }}
          />
        </div>
      )}
      {!isLocked && !locationScopePending && activeView === "live" && selected && childMembers.length <= 1 && (
        <div className="pl-chips">
          {/* 갱신 중에도 이 칩은 움직이지 않는다 — 진행은 상단 새로고침 버튼만 알린다. */}
          <div
            className="pl-chip pl-chip--active"
            aria-label={intl.formatMessage({ id: "parent.location.currentChildLocation" }, { childName: selected.name || intl.formatMessage({ id: "parent.location.childFallback" }) })}
          >
            <span className="pl-chip__avatar" data-photo={isUploadedPhoto(selected.photo_url)}>
              <img className="hy-network-avatar" src={avatarSrc(childAvatarPath(selected.photo_url))} alt="" loading="eager" decoding="async" />
            </span>
            <span className="pl-chip__main">
              <span className="pl-chip__name">{selected.name || intl.formatMessage({ id: "parent.location.childFallback" })}</span>
            </span>
            {/* 초록 점은 "연결됨"으로 읽힌다 — 폰이 20분 넘게 연락이 없거나 위치가 오래됐으면 주의 색으로 바꾼다. */}
            <span className="pl-chip__dot" data-state={deviceSilentSince ? "silent" : isStaleLocation ? "stale" : "live"} />
          </div>
        </div>
      )}

      {/* 오늘 경로는 로딩·오류·빈 기록·이동만 상태에서도 같은 타임라인 자리를 유지한다. */}
      {activeView === "history" && canShowHistory && (
        <LocationJourneyPanel
          containerRef={historyPanelRef}
          childName={childName}
          dayLabel={historyDayLabel}
          state={journeyState}
          expanded={historyPanelExpanded}
          recordedRangeLabel={journeyRangeLabel}
          stayCount={visibleStayPoints.length}
          currentTimeLabel={formatClockHM(scrubMs, locale, familyTimeZone)}
          currentWhere={scrubWhere}
          sliderMin={journeyRange?.startMs ?? 0}
          sliderMax={journeyRange?.endMs ?? 0}
          sliderValue={scrubMs}
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
        <div className="pl-sheet__head">
          <div className="pl-sheet__avatar" data-photo={isUploadedPhoto(selected?.photo_url)}>
            <img className="hy-network-avatar" src={avatarSrc(childAvatar)} alt="" loading="eager" decoding="async" />
          </div>
          <div className="pl-sheet__info">
            <div className="pl-sheet__name">{sheetName}</div>
            <div
              className={`pl-sheet__zone${isLocked ? " pl-sheet__zone--locked" : ""}${isStaleLocation || isLowAccuracy ? " pl-sheet__zone--stale" : ""}${isRefreshingLocation ? " pl-sheet__zone--loading" : ""}`}
            >
              <span className="pl-sheet__zone-dot" />
              {sheetZoneText}
              {isStandard && <span className="pl-delay-badge">{intl.formatMessage({ id: "parent.parentLocation.copy046" })}</span>}
            </div>
          </div>
          {/* 상태 칩은 말할 내용이 있을 때만 렌더한다(정상일 때 빈 알약이 보이던 문제). */}
          {(() => {
            // 부모 라우트는 child namespace 를 싣지 않는다 — parent 문구를 쓴다(원시 id 노출 방지).
            const durText = locationScopeError
              ? intl.formatMessage({ id: "parent.location.state.error" })
              : locationScopePending || isRefreshingLocation
                ? intl.formatMessage({ id: "parent.location.state.checking" })
                : loc
                  ? ""
                  : intl.formatMessage({ id: "parent.parentLocation.copy048" });
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
            {isError ? intl.formatMessage({ id: "parent.parentLocation.copy049" }) : intl.formatMessage({ id: "parent.parentLocation.copy050" })}
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
            {intl.formatMessage({ id: "parent.parentLocation.copy051" })}
          </button>
        )}

        <div className="pl-actions">
          <button
            type="button"
            className="pl-memo-btn hy-press"
            aria-label={intl.formatMessage({ id: "parent.parentLocation.copy052" })}
            onClick={() => navigate("/parent/memo")}
          >
            <img className="pl-actions__icon" src={asset("ui/chat-heart.webp")} alt="" />
            <span className="pl-actions__label">{intl.formatMessage({ id: "core.nav.chat" })}</span>
          </button>
          {/* 길찾기는 모든 티어에서 열고, 주변 소리는 대상 화면의 고지형 Premium gate를 사용한다. */}
          {!isLocked && !locationScopePending && (
            <>
              <button
                type="button"
                className="pl-route-btn hy-press"
                aria-label={intl.formatMessage({ id: "parent.parentLocation.copy053" })}
                onClick={() => navigate("/route")}
              >
                <img className="pl-actions__icon" src={asset("ui/clay/location.webp")} alt="" />
                <span className="pl-actions__label">{intl.formatMessage({ id: "parent.parentLocation.copy054" })}</span>
              </button>
              <button
                type="button"
                className="pl-listen-btn hy-press"
                aria-label={intl.formatMessage({ id: "parent.location.action.remoteAudio" })}
                onClick={() => navigate("/remote-audio")}
              >
                <img className="pl-actions__icon" src={asset("ui/clay/remote-audio.webp")} alt="" />
                <span className="pl-actions__label">{intl.formatMessage({ id: "parent.location.action.remoteAudio" })}</span>
              </button>
            </>
          )}
          <button type="button" className="pl-call-btn hy-press" aria-label={intl.formatMessage({ id: "parent.parentLocation.copy056" })} onClick={callChild}>
            <img className="pl-actions__icon" src={asset("ui/phone-lavender.webp")} alt="" />
            <span className="pl-actions__label">{intl.formatMessage({ id: "parent.parentLocation.copy057" })}</span>
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
            if (!saved) throw new Error(intl.formatMessage({ id: "parent.location.returnIntentFailed" }));
            setUpsellSource(null);
            setHistoryUpsellDayKey(null);
            navigate("/subscription");
          }}
        />
      )}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useIntl, type IntlShape } from "react-intl";
import { ChevronLeft, Home, Map, MapPin, Navigation, RotateCw } from "lucide-react";
import { useToast } from "@/app/toast";
import { childAvatarPath } from "@/lib/avatar";
import { FamilyMap, type MapPlace } from "@/maps/FamilyMap";
import { LoaderMark } from "@/components/ui/LoaderMark";
import { useAuth } from "@/auth/AuthContext";
import { useActiveChild } from "@/app/activeChild";
import { useMyFamily } from "@/queries/useFamily";
import { useChildLocations, useSavedPlaces } from "@/queries/useLocation";
import { useLocationLabels } from "@/queries/useLocationLabels";
import { useEvents } from "@/queries/useSchedule";
import { useWalkingRoute } from "@/queries/useRoute";
import { searchMapPlace } from "@/lib/mapActions";
import type { MapBiasRef } from "@/lib/api/endpoints/maps";
import { straightLineHint } from "@/transform/straightLineRoute";
import { openExternal } from "@/lib/native/browser";
import { isNativePlatform } from "@/lib/native/plugins";
import { straightDistanceM, type RoutePoint } from "@/lib/api/endpoints/route";
import { filterEventsForChild } from "@/transform/eventScope";
import {
  beginRouteDestinationScope,
  pickRouteEvent,
  resolveRouteDestination,
  selectRouteDestinationForChild,
  type OwnedRouteDestination,
} from "@/transform/routeDestinationScope";
import { formatDurationUnit, LEGACY_FAMILY_TIME_ZONE } from "@/i18n/format";
import { buildExternalMapUrl } from "@/transform/externalMapUrl";
import { useLocale } from "@/i18n/useLocale";
import "./RouteView.css";

// 도보 4km/h ≈ 67m/분 — 실 도보 경로의 '거리'만으로 소요시간을 보정할 때 쓴다
// (직선 근사가 아니라 서버가 준 실 경로 총거리 기준). 서버가 duration 을 주면 그 값 우선.
const WALK_M_PER_MIN = 67;
const SHORT_METER_FORMAT = {
  style: "unit",
  unit: "meter",
  unitDisplay: "short",
  maximumFractionDigits: 0,
} as const;
const SHORT_KILOMETER_FORMAT = {
  style: "unit",
  unit: "kilometer",
  unitDisplay: "short",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
} as const;
const UNSUPPORTED_MAP_PROVIDER = "unsupported" as const;
const DIRECTIONS_MAP_ACTION = "directions" as const;

type Step = { tone: "pink" | "mint"; text: string };
interface DestPick {
  name: string;
  point: RoutePoint;
  ref: MapBiasRef | null;
}

// 경로 표시 상태(모두 실데이터 기반 — 직선 근사·가짜 경로 없음).
type RouteState = "no-child" | "no-dest" | "no-origin" | "loading" | "error" | "ready";

function durationLabel(
  sec: number | null,
  locale: Parameters<typeof formatDurationUnit>[2],
  intl: IntlShape,
): string {
  if (sec == null) return intl.formatMessage({ id: "shared.routeView.walkOnly" });
  const min = Math.max(1, Math.round(sec / 60));
  return intl.formatMessage(
    { id: "shared.routeView.walkDuration" },
    { duration: formatDurationUnit(min, "minute", locale) },
  );
}

export function RouteView() {
  const intl = useIntl();
  const { locale } = useLocale();
  const distanceLabel = useCallback(
    (m: number) =>
      m < 1000
        ? intl.formatNumber(Math.round(m), SHORT_METER_FORMAT)
        : intl.formatNumber(m / 1000, SHORT_KILOMETER_FORMAT),
    [intl],
  );
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedEventId = searchParams.get("event")?.trim() || null;
  const { show } = useToast();
  const { role, userId, familyId } = useAuth();
  const isChild = role === "child";
  const homePath = isChild ? "/child/home" : "/parent/home";
  const { activeChild, familyLoading } = useActiveChild();
  const familyQuery = useMyFamily();
  const locationsQuery = useChildLocations();
  const placesQuery = useSavedPlaces();
  const eventsQuery = useEvents();
  const family = familyQuery.data;
  const locations = locationsQuery.data;
  const places = placesQuery.data;
  const events = eventsQuery.data;
  const sourceQueriesLoading = familyQuery.isLoading
    || locationsQuery.isLoading
    || placesQuery.isLoading
    || eventsQuery.isLoading;
  const sourceQueriesError = familyQuery.isError
    || locationsQuery.isError
    || placesQuery.isError
    || eventsQuery.isError;
  const retrySourceQueries = async () => {
    await Promise.all([
      familyQuery.refetch(),
      locationsQuery.refetch(),
      placesQuery.refetch(),
      eventsQuery.refetch(),
    ]);
  };

  const nowMs = useMemo(() => Date.now(), [events]);

  // 출발 = 아이 세션이면 본인, 부모 세션이면 전역 활성 아이. 첫째 폴백은 쓰지 않는다.
  const ownChild = family?.members.find((m) => m.role === "child" && m.user_id === userId) ?? null;
  const activeChildMember =
    activeChild && family?.members.some((m) => m.role === "child" && m.id === activeChild.id)
      ? activeChild
      : null;
  const childMember = isChild ? ownChild : activeChildMember;
  const childAvatar = childAvatarPath(childMember?.photo_url);
  const childName = childMember?.name || intl.formatMessage({ id: "shared.routeView.childFallback" });
  const loc = childMember
    ? locations?.find((l) => l.user_id === childMember.user_id) ?? null
    : null;
  const serverOrigin = useMemo<RoutePoint | null>(
    () => (loc ? { lat: loc.lat, lng: loc.lng } : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loc?.lat, loc?.lng],
  );
  const [deviceOrigin, setDeviceOrigin] = useState<RoutePoint | null>(null);
  const [deviceOriginStatus, setDeviceOriginStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [deviceOriginRetryNonce, setDeviceOriginRetryNonce] = useState(0);
  useEffect(() => {
    if (!isChild) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setDeviceOrigin(null);
      setDeviceOriginStatus("error");
      return;
    }
    let active = true;
    setDeviceOriginStatus("loading");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (!active) return;
        setDeviceOrigin({ lat: position.coords.latitude, lng: position.coords.longitude });
        setDeviceOriginStatus("ready");
      },
      () => {
        if (!active) return;
        setDeviceOrigin(null);
        setDeviceOriginStatus("error");
      },
      { enableHighAccuracy: true, timeout: 5_000, maximumAge: 60_000 },
    );
    return () => {
      active = false;
    };
  }, [deviceOriginRetryNonce, isChild]);
  const origin = isChild
    ? deviceOriginStatus === "ready"
      ? deviceOrigin
      : deviceOriginStatus === "error"
        ? serverOrigin
        : null
    : serverOrigin;

  // 도착 = 다음 일정 장소. 좌표가 없으면 ①저장장소 이름 매칭 ②Kakao 키워드/주소 검색으로 해석.
  // undefined = 해석 중(로딩), null = 안내할 곳 없음(정직한 빈 상태 — 직선 폴백 금지).
  const childEvents = useMemo(
    () => childMember ? filterEventsForChild(events ?? [], childMember.id) : [],
    [events, childMember?.id],
  );
  const nextEvent = useMemo(
    () => pickRouteEvent(childEvents, requestedEventId, nowMs, LEGACY_FAMILY_TIME_ZONE),
    [childEvents, nowMs, requestedEventId],
  );
  const [destinationState, setDestinationState] = useState<OwnedRouteDestination<DestPick> | null>(null);
  const destination = selectRouteDestinationForChild(destinationState, childMember?.id ?? null);
  useEffect(() => {
    const ownerChildMemberId = childMember?.id ?? null;
    if (!ownerChildMemberId) {
      setDestinationState(null);
      return;
    }
    setDestinationState(beginRouteDestinationScope<DestPick>(ownerChildMemberId));
    if (!events) return; // 일정 로딩 중
    const commit = (value: DestPick | null) => {
      setDestinationState((current) =>
        resolveRouteDestination(current, ownerChildMemberId, value),
      );
    };
    if (!nextEvent) {
      commit(null);
      return;
    }
    const evLoc = nextEvent.location;
    const name = nextEvent.title || intl.formatMessage({ id: "shared.routeView.nextEventFallback" });
    // ① 일정에 좌표가 직접 저장돼 있으면 그대로(지도 피커/저장장소 칩으로 등록된 일정).
    if (typeof evLoc?.lat === "number" && typeof evLoc?.lng === "number") {
      commit({ name, point: { lat: evLoc.lat, lng: evLoc.lng }, ref: { kind: "event", eventId: nextEvent.id } });
      return;
    }
    const label = (evLoc?.address ?? "").trim();
    if (!label) {
      commit(null);
      return;
    }
    // ② 저장장소 이름 매칭(장소관리에 등록된 곳이면 그 좌표).
    const saved = (places ?? []).find(
      (p) =>
        p.name &&
        (p.name === label || label.includes(p.name) || p.name.includes(label)) &&
        typeof p.location?.lat === "number" &&
        typeof p.location?.lng === "number",
    );
    if (saved) {
      commit({ name, point: { lat: saved.location.lat, lng: saved.location.lng }, ref: { kind: "saved_place", savedPlaceId: saved.id } });
      return;
    }
    // ③ 가족 국가 정책을 따르는 공통 장소 검색으로 좌표를 임시 해석한다.
    let cancelled = false;
    if (!familyId) {
      commit(null);
      return;
    }
    searchMapPlace(familyId, label, intl.locale)
      .then((selected) => {
        if (!cancelled) commit(selected ? { name, point: selected.point, ref: null } : null);
      })
      .catch(() => {
        if (!cancelled) commit(null);
      });
    return () => {
      cancelled = true;
    };
  }, [childMember?.id, events, familyId, intl, nextEvent, places]);

  // 실 도보 경로(출발·도착 모두 있을 때만 활성).
  const {
    data: routeData,
    isError: routeError,
    isFetching: routeFetching,
    refetch: routeRefetch,
  } = useWalkingRoute(
    origin,
    destination?.point ?? null,
    childMember?.user_id && destination?.ref
      ? { origin: { kind: "child_location", childUserId: childMember.user_id }, destination: destination.ref }
      : null,
  );

  const hasRoute = (routeData?.points?.length ?? 0) >= 2;

  // 상태 판정: 장소 해석 중 → 도착지 없음 → 출발지 없음 → 경로 준비 → 실패 → 로딩.
  const routeState: RouteState =
    !childMember
      // 가족 조회가 끝나기 전에는 '아이 없음'을 단정하지 않는다 — 조회 중은 로딩이다.
      ? (familyLoading ? "loading" : "no-child")
      : destination === undefined
      ? "loading"
      : destination === null
        ? "no-dest"
        : !origin
          ? "no-origin"
          : hasRoute
            ? "ready"
            : routeError && !routeFetching
              ? "error"
              : "loading";

  // 거리/시간은 실 도보 경로가 준비됐을 때만(직선 근사면 감춤).
  const distanceM = hasRoute ? (routeData?.distanceM ?? null) : null;
  const durationSec =
    hasRoute
      ? routeData?.durationSec ?? (distanceM != null ? Math.round((distanceM / WALK_M_PER_MIN) * 60) : null)
      : null;

  const routePoints = hasRoute && routeData ? routeData.points : [];

  const originChild = useMemo(
    () => (origin ? { lat: origin.lat, lng: origin.lng, name: childName, avatar: childAvatar } : null),
    [origin, childName, childAvatar],
  );
  const destMarker = useMemo<MapPlace | null>(
    () => (destination ? { lat: destination.point.lat, lng: destination.point.lng, name: destination.name } : null),
    [destination],
  );

  const locationLabel = useLocationLabels(loc ? [loc] : [], places);
  const curPlace = deviceOrigin
    ? intl.formatMessage({ id: "shared.routeView.currentLocationFallback" })
    : loc
      ? locationLabel(loc)
      : intl.formatMessage({ id: "shared.routeView.currentLocationFallback" });
  const title = destination
    ? intl.formatMessage({ id: "shared.routeView.directionsTitle" }, { destination: destination.name })
    : intl.formatMessage({ id: "shared.routeView.directionsTitleFallback" });
  const canStart = !!origin && !!destination;
  const audience = isChild ? "child" : "parent";
  const routeLoadingText = intl.formatMessage({ id: "shared.routeView.routeLoading" }, { audience });
  // 한국어 역할별 재시도 계약: 길을 못 찾았어 · 다시 시도 / 길을 찾지 못했어요 · 다시 시도
  const routeRetryText = intl.formatMessage({ id: "shared.routeView.routeRetry" }, { audience });
  // 상류 라우팅이 죽었을 때 쓸 직선 거리(경로가 아니라 참고값이다).
  const straight = straightLineHint(origin, destination?.point ?? null);
  const locationPendingText = intl.formatMessage(
    { id: "shared.routeView.locationPending" },
    { audience, childName },
  );
  const locationUnavailableText = intl.formatMessage({ id: "shared.memo.copy.locationUnavailable.child" });
  const sourceQueryErrorText = intl.formatMessage({
    id: isChild ? "core.error.api.network.child" : "core.error.api.network.formal",
  });
  const originUnavailable = routeState === "no-origin"
    && isChild
    && deviceOriginStatus === "error"
    && !serverOrigin;
  // 한국어 역할별 빈 상태 계약: 안내할 곳이 없어 / 안내할 곳이 없어요
  const emptyTitle =
    routeState === "no-child"
      ? intl.formatMessage({ id: "shared.routeView.emptyNoChildTitle" }, { audience })
      : intl.formatMessage({ id: "shared.routeView.emptyNoDestinationTitle" }, { audience });
  const emptyDescription =
    routeState === "no-child"
      ? intl.formatMessage({ id: "shared.routeView.emptyNoChildDescription" }, { audience })
      : nextEvent
        ? intl.formatMessage({ id: "shared.routeView.emptyUnresolvedDescription" }, { audience })
        : intl.formatMessage({ id: "shared.routeView.emptyNoScheduleDescription" }, { audience });

  // 안내 시작 — 외부 지도 앱(네이티브: 시스템 브라우저 / 웹: 새 탭)에서 도보 길안내를 연다.
  const startNavigation = async () => {
    if (!origin || !destination) return;
    const provider = family?.mapPolicy.provider ?? "unsupported";
    const url = buildExternalMapUrl(provider, "directions", destination.point, destination.name);
    if (!url) {
      show(intl.formatMessage({ id: "shared.map.providerUnavailable" }), "🗺️");
      return;
    }
    try {
      if (isNativePlatform()) {
        await openExternal(url);
      } else {
        const win = window.open(url, "_blank", "noopener,noreferrer");
        if (!win) {
          show(
            intl.formatMessage({ id: "shared.routeView.popupBlocked" }, { audience }),
            "🧭",
          );
          return;
        }
      }
      show(intl.formatMessage({ id: "shared.routeView.navigationOpened" }, { audience }), "🧭");
    } catch (error) {
      console.error("길안내 열기 실패:", error);
      show(intl.formatMessage({ id: "shared.routeView.navigationOpenFailed" }, { audience }), "⚠️");
    }
  };

  // 경로 API 불가 시 직선거리 기반 "대략" 안내(직선임을 명시 — 가짜 정밀도 금지).
  const straightM = useMemo(
    () => (origin && destination ? straightDistanceM(origin, destination.point) : null),
    [origin, destination],
  );
  const straightEta =
    straightM != null
      ? intl.formatMessage(
          { id: "shared.routeView.straightEstimate" },
          {
            distance: distanceLabel(straightM),
            duration: formatDurationUnit(
              Math.max(1, Math.round((straightM * 1.3) / WALK_M_PER_MIN)),
              "minute",
              locale,
            ),
          },
        )
      : null;
  // 한국어 정직한 강등 기준: `직선 ${distanceLabel(straightM)}`이며 실제 경로처럼 표시하지 않는다.

  // 소요시간·거리 요약(실 경로만 정확 수치 노출).
  const etaText =
    routeState === "ready" && distanceM != null
      ? `${durationLabel(durationSec, locale, intl)} · ${distanceLabel(distanceM)}`
      : routeState === "loading"
        ? routeLoadingText
        : routeState === "error"
          ? straightEta ?? intl.formatMessage({ id: "shared.routeView.routeUnavailable" }, { audience })
          : locationPendingText;

  // 경로 안내 단계 — 실 도보 경로의 턴바이턴(guides)을 아이가 따라갈 수 있게 나열.
  // 서버가 안내문을 안 주면 총거리 요약으로 폴백(가짜 안내 금지).
  const steps: Step[] = useMemo(() => {
    if (routeState !== "ready" || distanceM == null) return [];
    const out: Step[] = [
      {
        tone: "pink",
        text: intl.formatMessage({ id: "shared.routeView.stepStart" }, { audience, place: curPlace }),
      },
    ];
    const guides = routeData?.guides ?? [];
    if (guides.length > 0) {
      for (const g of guides.slice(0, 12)) {
        out.push({
          tone: "pink",
          text: g.distanceM != null ? `${g.text} · ${distanceLabel(g.distanceM)}` : g.text,
        });
      }
      if (guides.length > 12) {
        out.push({
          tone: "pink",
          text: intl.formatMessage(
            { id: "shared.routeView.stepRemaining" },
            { count: guides.length - 12 },
          ),
        });
      }
    } else {
      out.push({
        tone: "pink",
        text: intl.formatMessage(
          { id: "shared.routeView.stepWalk" },
          { audience, distance: distanceLabel(distanceM) },
        ),
      });
    }
    out.push({
      tone: "mint",
      text: intl.formatMessage(
        { id: "shared.routeView.stepArrival" },
        { destination: destination?.name ?? intl.formatMessage({ id: "shared.routeView.nextEventFallback" }) },
      ),
    });
    return out;
  }, [routeState, distanceM, curPlace, routeData?.guides, destination?.name, audience, distanceLabel, intl]);

  return (
    <div className="rv-screen">
      <div className="rv-header">
        <button
          type="button"
          className="rv-back hy-press"
          aria-label={intl.formatMessage({ id: "core.action.back" })}
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} strokeWidth={2.2} color="#4A4145" />
        </button>
        <span className="rv-title">{title}</span>
      </div>

      <div className="rv-content">
        {sourceQueriesError ? (
          <div className="rv-empty" role="alert">
            <span className="rv-empty__icon">
              <RotateCw size={34} strokeWidth={2} color="#23A876" />
            </span>
            <span className="rv-empty__title">{sourceQueryErrorText}</span>
            <button
              type="button"
              className="rv-empty__home hy-press"
              onClick={() => void retrySourceQueries()}
            >
              <RotateCw size={17} strokeWidth={2.4} color="#fff" />
              {intl.formatMessage({ id: "core.action.retry" })}
            </button>
          </div>
        ) : sourceQueriesLoading ? (
          <div className="rv-map rv-map--placeholder" role="status">
            <LoaderMark variant="location" />
            <span className="rv-ph__msg">{intl.formatMessage({ id: "core.state.loadingScreen" })}</span>
          </div>
        ) : routeState === "no-child" || routeState === "no-dest" || originUnavailable ? (
          // 유효한 아이나 다음 일정 장소가 없으면 query 결과를 대신 보여주지 않는다.
          <div className="rv-empty">
            <span className="rv-empty__icon">
              <MapPin size={34} strokeWidth={2} color="#23A876" />
            </span>
            <span className="rv-empty__title">{originUnavailable ? locationUnavailableText : emptyTitle}</span>
            {!originUnavailable && <span className="rv-empty__sub">{emptyDescription}</span>}
            <button
              type="button"
              className="rv-empty__home hy-press"
              onClick={() => {
                if (originUnavailable) {
                  setDeviceOriginRetryNonce((value) => value + 1);
                  return;
                }
                navigate(homePath);
              }}
            >
              {originUnavailable
                ? <RotateCw size={17} strokeWidth={2.4} color="#fff" />
                : <Home size={17} strokeWidth={2.4} color="#fff" />}
              {intl.formatMessage({ id: originUnavailable ? "core.action.retry" : "shared.routeView.homeButton" })}
            </button>
          </div>
        ) : (
          <>
            {/* 지도 — 출발·도착을 알면 **경로를 기다리지 않고 먼저 그린다**(지도가 뜨는 데만 3초를 기다리게 하지 않는다).
                폴리라인은 실 도보 경로가 도착하면 얹는다. 직선 경로선은 절대 그리지 않는다. */}
            {originChild && destMarker ? (
              <div className="rv-map-wrap">
                <FamilyMap
                  className="rv-map"
                  tone={isChild ? "child" : "formal"}
                  child={originChild}
                  route={routeState === "ready" ? routePoints : []}
                  destination={destMarker}
                />
                {routeState === "loading" && (
                  <span className="rv-map-chip">
                    <span className="rv-ph__spinner" aria-hidden="true" />
                    {routeLoadingText}
                  </span>
                )}
                {routeState === "error" && (
                  <button type="button" className="rv-map-chip rv-map-chip--retry hy-press" onClick={() => void routeRefetch()}>
                    <RotateCw size={15} strokeWidth={2.4} color="#23A876" />
                    {routeRetryText}
                  </button>
                )}
              </div>
            ) : (
              <div className="rv-map rv-map--placeholder">
                <LoaderMark variant="location" />
                <span className="rv-ph__msg">
                  {routeState === "no-origin"
                    ? locationPendingText
                    : intl.formatMessage({ id: "shared.routeView.destinationSearching" }, { audience })}
                </span>
              </div>
            )}

            {/* 인앱 도보 경로 불가(제휴 API 필요) — 카카오맵 앱의 상세 도보 안내로 연결(정직한 강등). */}
            {routeState === "error" && destination && (
              <div className="rv-fallback">
                {/* 경로를 못 받아도 좌표는 있다 — 직선 거리만이라도 정직하게 알린다(경로 아님을 명시). */}
                {straight && (
                  <span className="rv-fallback__msg">
                    {intl.formatMessage(
                      { id: "shared.routeView.straightLine" },
                      { audience, distance: straight.distanceM, minutes: straight.minutes },
                    )}
                  </span>
                )}
                <span className="rv-fallback__msg">
                  {intl.formatMessage({ id: "shared.routeView.fallbackDescription" }, { audience })}
                </span>
                <button
                  type="button"
                  className="rv-fallback__kakao hy-press"
                  onClick={() =>
                    {
                      const url = buildExternalMapUrl(
                        family?.mapPolicy.provider ?? UNSUPPORTED_MAP_PROVIDER,
                        DIRECTIONS_MAP_ACTION,
                        destination.point,
                        destination.name || intl.formatMessage({ id: "shared.routeView.destinationFallback" }),
                      );
                      if (!url) return;
                      openExternal(url).catch(() =>
                        show(intl.formatMessage({ id: "shared.routeView.kakaoOpenFailed" }, { audience }), "🗺️"),
                      );
                    }
                  }
                >
                  <Map size={18} strokeWidth={2.2} aria-hidden="true" />
                  {intl.formatMessage({ id: "shared.routeView.kakaoDirections" })}
                </button>
              </div>
            )}

            {/* 목적지 · 소요시간 */}
            <div className="rv-info">
              <span className="rv-info__icon">
                <MapPin size={28} strokeWidth={2.2} color="#087653" />
              </span>
              <span className="rv-info__main">
                <span className="rv-info__name">
                  {destination?.name ?? intl.formatMessage({ id: "shared.routeView.destinationFallback" })}
                </span>
                <span className="rv-info__eta">{etaText}</span>
              </span>
              {routeState === "ready" && (
                <span className="rv-info__tag">{intl.formatMessage({ id: "shared.routeView.walkingRouteTag" })}</span>
              )}
            </div>

            {/* 경로 안내 단계 */}
            {steps.length > 0 && (
              <div className="rv-steps">
                {steps.map((s, i) => (
                  <div key={i} className="rv-step">
                    <span className={`rv-step__num rv-step__num--${s.tone}`}>{i + 1}</span>
                    <span className="rv-step__text">{s.text}</span>
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              className="rv-start hy-press"
              disabled={!canStart}
              style={{ opacity: canStart ? 1 : 0.5 }}
              onClick={() => void startNavigation()}
            >
              <Navigation size={20} strokeWidth={2.2} aria-hidden="true" />
              {intl.formatMessage({ id: "shared.routeView.navigationStart" })}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

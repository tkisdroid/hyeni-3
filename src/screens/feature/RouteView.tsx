import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { ChevronLeft, Home, Map, MapPin, Navigation, RotateCw } from "lucide-react";
import { useToast } from "@/app/toast";
import { childAvatarPath } from "@/lib/avatar";
import { KakaoMap, type MapPlace } from "@/components/KakaoMap";
import { useAuth } from "@/auth/AuthContext";
import { useActiveChild } from "@/app/activeChild";
import { useMyFamily } from "@/queries/useFamily";
import { useChildLocations, useSavedPlaces } from "@/queries/useLocation";
import { useLocationLabels } from "@/queries/useLocationLabels";
import { useEvents } from "@/queries/useSchedule";
import { useWalkingRoute } from "@/queries/useRoute";
import { loadKakaoMaps } from "@/lib/kakaoMap";
import { openExternal } from "@/lib/native/browser";
import { isNativePlatform } from "@/lib/native/plugins";
import { straightDistanceM, type RoutePoint } from "@/lib/api/endpoints/route";
import type { CalendarEvent } from "@/lib/api/endpoints/schedule";
import { parseAppDateKey } from "@/transform/dateKey";
import { filterEventsForChild } from "@/transform/eventScope";
import {
  beginRouteDestinationScope,
  resolveRouteDestination,
  selectRouteDestinationForChild,
  type OwnedRouteDestination,
} from "@/transform/routeDestinationScope";
import "./RouteView.css";

// 도보 4km/h ≈ 67m/분 — 실 도보 경로의 '거리'만으로 소요시간을 보정할 때 쓴다
// (직선 근사가 아니라 서버가 준 실 경로 총거리 기준). 서버가 duration 을 주면 그 값 우선.
const WALK_M_PER_MIN = 67;

type Step = { tone: "pink" | "mint"; text: string };
interface DestPick {
  name: string;
  point: RoutePoint;
}

// 경로 표시 상태(모두 실데이터 기반 — 직선 근사·가짜 경로 없음).
type RouteState = "no-child" | "no-dest" | "no-origin" | "loading" | "error" | "ready";

function distanceLabel(m: number): string {
  if (m < 1000) return `${Math.round(m)}m`;
  return `${(m / 1000).toFixed(1)}km`;
}

function durationLabel(sec: number | null): string {
  if (sec == null) return "도보";
  const min = Math.max(1, Math.round(sec / 60));
  return `도보 ${min}분`;
}

// 외부 지도 도보 길안내 URL(구글맵 — 웹·안드로이드 모두 좌표 기반으로 열림).
function buildWalkDirectionsUrl(o: RoutePoint, d: RoutePoint): string {
  return `https://www.google.com/maps/dir/?api=1&origin=${o.lat},${o.lng}&destination=${d.lat},${d.lng}&travelmode=walking`;
}

// 카카오맵 길찾기 링크 — 앱 설치 시 카카오맵으로 연결(도보 안내 선택 가능), 미설치 시 웹.
function buildKakaoToUrl(name: string, d: RoutePoint): string {
  return `https://map.kakao.com/link/to/${encodeURIComponent(name || "도착지")},${d.lat},${d.lng}`;
}

// 일정의 시작 시각(ms). date_key + time("HH:MM") 조합. 무효 시 null.
function eventStartMs(ev: CalendarEvent): number | null {
  const d = parseAppDateKey(ev.date_key);
  if (!d) return null;
  let h = 0;
  let m = 0;
  if (ev.time && /^\d{1,2}:\d{2}$/.test(ev.time)) {
    const [hh, mm] = ev.time.split(":").map(Number);
    h = hh;
    m = mm;
  }
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime();
}

/** 다음 일정(장소 문자열이라도 있는 것) — 좌표 유무와 무관하게 시간순 선정. */
function pickNextEventWithPlace(
  events: CalendarEvent[] | undefined,
  nowMs: number,
): CalendarEvent | null {
  const upcoming = (events ?? [])
    .filter(
      (ev) =>
        (typeof ev.location?.lat === "number" && typeof ev.location?.lng === "number") ||
        !!ev.location?.address?.trim(),
    )
    .map((ev) => ({ ev, ms: eventStartMs(ev) }))
    .filter((x): x is { ev: CalendarEvent; ms: number } => x.ms != null && x.ms >= nowMs - 60 * 60 * 1000)
    .sort((a, b) => a.ms - b.ms);
  return upcoming[0]?.ev ?? null;
}

export function RouteView() {
  const navigate = useNavigate();
  const { show } = useToast();
  const { role, userId } = useAuth();
  const isChild = role === "child";
  const homePath = isChild ? "/child/home" : "/parent/home";
  const { activeChild, familyLoading } = useActiveChild();
  const { data: family } = useMyFamily();
  const { data: locations } = useChildLocations();
  const { data: places } = useSavedPlaces();
  const { data: events } = useEvents();

  const nowMs = useMemo(() => Date.now(), [events]);

  // 출발 = 아이 세션이면 본인, 부모 세션이면 전역 활성 아이. 첫째 폴백은 쓰지 않는다.
  const ownChild = family?.members.find((m) => m.role === "child" && m.user_id === userId) ?? null;
  const activeChildMember =
    activeChild && family?.members.some((m) => m.role === "child" && m.id === activeChild.id)
      ? activeChild
      : null;
  const childMember = isChild ? ownChild : activeChildMember;
  const childAvatar = childAvatarPath(childMember?.photo_url);
  const childName = childMember?.name || "아이";
  const loc = childMember
    ? locations?.find((l) => l.user_id === childMember.user_id) ?? null
    : null;
  const origin = useMemo<RoutePoint | null>(
    () => (loc ? { lat: loc.lat, lng: loc.lng } : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loc?.lat, loc?.lng],
  );

  // 도착 = 다음 일정 장소. 좌표가 없으면 ①저장장소 이름 매칭 ②Kakao 키워드/주소 검색으로 해석.
  // undefined = 해석 중(로딩), null = 안내할 곳 없음(정직한 빈 상태 — 직선 폴백 금지).
  const childEvents = useMemo(
    () => childMember ? filterEventsForChild(events ?? [], childMember.id) : [],
    [events, childMember?.id],
  );
  const nextEvent = useMemo(() => pickNextEventWithPlace(childEvents, nowMs), [childEvents, nowMs]);
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
    const name = nextEvent.title || "다음 일정";
    // ① 일정에 좌표가 직접 저장돼 있으면 그대로(지도 피커/저장장소 칩으로 등록된 일정).
    if (typeof evLoc?.lat === "number" && typeof evLoc?.lng === "number") {
      commit({ name, point: { lat: evLoc.lat, lng: evLoc.lng } });
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
      commit({ name, point: { lat: saved.location.lat, lng: saved.location.lng } });
      return;
    }
    // ③ Kakao 키워드 검색 → 주소 검색 순으로 좌표 해석(둘 다 실패 시 빈 상태).
    let cancelled = false;
    loadKakaoMaps()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then((maps: any) => {
        if (cancelled) return;
        if (!maps?.services) {
          commit(null);
          return;
        }
        const done = (lat: number, lng: number) => {
          if (!cancelled) commit({ name, point: { lat, lng } });
        };
        const fallbackAddress = () => {
          const geocoder = new maps.services.Geocoder();
          geocoder.addressSearch(
            label,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (res: any[], st: string) => {
              if (cancelled) return;
              if (st === "OK" && res[0]) done(Number(res[0].y), Number(res[0].x));
              else commit(null);
            },
          );
        };
        const placesSvc = new maps.services.Places();
        placesSvc.keywordSearch(
          label,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (data: any[], status: string) => {
            if (cancelled) return;
            if (status === "OK" && data[0]) done(Number(data[0].y), Number(data[0].x));
            else fallbackAddress();
          },
        );
      })
      .catch(() => {
        if (!cancelled) commit(null);
      });
    return () => {
      cancelled = true;
    };
  }, [childMember?.id, events, nextEvent, places]);

  // 실 도보 경로(출발·도착 모두 있을 때만 활성).
  const {
    data: routeData,
    isError: routeError,
    isFetching: routeFetching,
    refetch: routeRefetch,
  } = useWalkingRoute(origin, destination?.point ?? null);

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
  const curPlace = loc ? locationLabel(loc) : "현재 위치";
  const title = destination ? `${destination.name} 길찾기` : "길찾기";
  const canStart = !!origin && !!destination;
  const routeLoadingText = isChild ? "걸어가는 길을 찾는 중…" : "걸어가는 길을 찾는 중이에요…";
  const routeRetryText = isChild ? "길을 못 찾았어 · 다시 시도" : "길을 찾지 못했어요 · 다시 시도";
  const locationPendingText = isChild
    ? "네 위치를 확인하는 중…"
    : `${childName} 위치를 확인하는 중이에요…`;
  const emptyTitle =
    routeState === "no-child"
      ? isChild ? "내 정보를 찾지 못했어" : "길을 안내할 아이를 선택할 수 없어요"
      : isChild ? "안내할 곳이 없어" : "안내할 곳이 없어요";
  const emptyDescription =
    routeState === "no-child"
      ? isChild
        ? "가족 연결을 확인한 뒤 다시 들어와 줘."
        : "부모 홈에서 아이를 선택한 뒤 다시 시도해 주세요."
      : nextEvent
        ? isChild
          ? "다음 일정의 장소를 아직 못 찾았어.\n부모님께 지도로 장소를 정해 달라고 해 줘."
          : "다음 일정의 장소를 아직 찾지 못했어요.\n일정에서 지도 위치를 지정해 주세요."
        : isChild
          ? "오늘 남은 일정이 없어.\n일정이 생기면 길을 알려줄게."
          : "오늘 남은 일정이 없어요.\n일정을 추가하면 길을 안내해 드려요.";

  // 안내 시작 — 외부 지도 앱(네이티브: 시스템 브라우저 / 웹: 새 탭)에서 도보 길안내를 연다.
  const startNavigation = async () => {
    if (!origin || !destination) return;
    const url = buildWalkDirectionsUrl(origin, destination.point);
    try {
      if (isNativePlatform()) {
        await openExternal(url);
      } else {
        const win = window.open(url, "_blank", "noopener,noreferrer");
        if (!win) {
          show(
            isChild
              ? "지도를 못 열었어. 팝업 차단을 확인해 줘"
              : "지도를 열지 못했어요. 팝업 차단을 확인해 주세요",
            "🧭",
          );
          return;
        }
      }
      show(isChild ? "지도 앱에서 걷는 길 안내를 열었어" : "지도 앱에서 걷는 길 안내를 열었어요", "🧭");
    } catch (error) {
      console.error("길안내 열기 실패:", error);
      show(isChild ? "길 안내를 못 열었어" : "길 안내를 열지 못했어요", "⚠️");
    }
  };

  // 경로 API 불가 시 직선거리 기반 "대략" 안내(직선임을 명시 — 가짜 정밀도 금지).
  const straightM = useMemo(
    () => (origin && destination ? straightDistanceM(origin, destination.point) : null),
    [origin, destination],
  );
  const straightEta =
    straightM != null
      ? `직선 ${distanceLabel(straightM)} · 걸어서 ${Math.max(1, Math.round((straightM * 1.3) / WALK_M_PER_MIN))}분쯤`
      : null;

  // 소요시간·거리 요약(실 경로만 정확 수치 노출).
  const etaText =
    routeState === "ready" && distanceM != null
      ? `${durationLabel(durationSec)} · ${distanceLabel(distanceM)}`
      : routeState === "loading"
        ? routeLoadingText
        : routeState === "error"
          ? straightEta ?? (isChild ? "도보 경로를 못 찾았어" : "도보 경로를 찾지 못했어요")
          : locationPendingText;

  // 경로 안내 단계 — 실 도보 경로의 턴바이턴(guides)을 아이가 따라갈 수 있게 나열.
  // 서버가 안내문을 안 주면 총거리 요약으로 폴백(가짜 안내 금지).
  const steps: Step[] = useMemo(() => {
    if (routeState !== "ready" || distanceM == null) return [];
    const out: Step[] = [
      { tone: "pink", text: `출발 · ${curPlace}에서 ${isChild ? "시작해" : "시작해요"}` },
    ];
    const guides = routeData?.guides ?? [];
    if (guides.length > 0) {
      for (const g of guides.slice(0, 12)) {
        out.push({
          tone: "pink",
          text: g.distanceM != null ? `${g.text} · ${distanceLabel(g.distanceM)}` : g.text,
        });
      }
      if (guides.length > 12) out.push({ tone: "pink", text: `…남은 길 ${guides.length - 12}구간` });
    } else {
      out.push({
        tone: "pink",
        text: `길을 따라 약 ${distanceLabel(distanceM)} ${isChild ? "걸어가" : "걸어가세요"}`,
      });
    }
    out.push({ tone: "mint", text: `도착 · ${destination?.name ?? "다음 일정"}` });
    return out;
  }, [routeState, distanceM, curPlace, routeData?.guides, destination?.name, isChild]);

  return (
    <div className="rv-screen">
      <div className="rv-header">
        <button
          type="button"
          className="rv-back hy-press"
          aria-label="뒤로"
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} strokeWidth={2.2} color="#4A4145" />
        </button>
        <span className="rv-title">{title}</span>
      </div>

      <div className="rv-content">
        {routeState === "no-child" || routeState === "no-dest" ? (
          // 유효한 아이나 다음 일정 장소가 없으면 query 결과를 대신 보여주지 않는다.
          <div className="rv-empty">
            <span className="rv-empty__icon">
              <MapPin size={34} strokeWidth={2} color="#23A876" />
            </span>
            <span className="rv-empty__title">{emptyTitle}</span>
            <span className="rv-empty__sub">{emptyDescription}</span>
            <button
              type="button"
              className="rv-empty__home hy-press"
              onClick={() => navigate(homePath)}
            >
              <Home size={17} strokeWidth={2.4} color="#fff" />
              홈으로
            </button>
          </div>
        ) : (
          <>
            {/* 지도 — 출발·도착을 알면 **경로를 기다리지 않고 먼저 그린다**(지도가 뜨는 데만 3초를 기다리게 하지 않는다).
                폴리라인은 실 도보 경로가 도착하면 얹는다. 직선 경로선은 절대 그리지 않는다. */}
            {originChild && destMarker ? (
              <div className="rv-map-wrap">
                <KakaoMap
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
                <span className="rv-ph__spinner" aria-hidden="true" />
                <span className="rv-ph__msg">
                  {routeState === "no-origin"
                    ? locationPendingText
                    : isChild ? "갈 곳을 찾는 중…" : "갈 곳을 찾는 중이에요…"}
                </span>
              </div>
            )}

            {/* 인앱 도보 경로 불가(제휴 API 필요) — 카카오맵 앱의 상세 도보 안내로 연결(정직한 강등). */}
            {routeState === "error" && destination && (
              <div className="rv-fallback">
                <span className="rv-fallback__msg">
                  {isChild
                    ? "자세한 걷는 길은 카카오맵이 알려줄게!"
                    : "자세한 걷는 길은 카카오맵에서 확인해 주세요."}
                </span>
                <button
                  type="button"
                  className="rv-fallback__kakao hy-press"
                  onClick={() =>
                    openExternal(buildKakaoToUrl(destination.name, destination.point)).catch(() =>
                      show(isChild ? "카카오맵을 열 수 없어" : "카카오맵을 열 수 없어요", "🗺️"),
                    )
                  }
                >
                  <Map size={18} strokeWidth={2.2} aria-hidden="true" />
                  카카오맵에서 길찾기
                </button>
              </div>
            )}

            {/* 목적지 · 소요시간 */}
            <div className="rv-info">
              <span className="rv-info__icon">
                <MapPin size={28} strokeWidth={2.2} color="#087653" />
              </span>
              <span className="rv-info__main">
                <span className="rv-info__name">{destination?.name ?? "목적지"}</span>
                <span className="rv-info__eta">{etaText}</span>
              </span>
              {routeState === "ready" && <span className="rv-info__tag">도보 경로</span>}
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
              안내 시작
            </button>
          </>
        )}
      </div>
    </div>
  );
}

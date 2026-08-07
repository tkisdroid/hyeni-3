import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { ChevronLeft, LocateFixed } from "lucide-react";
import { useToast } from "@/app/toast";
import { KakaoMap } from "@/components/KakaoMap";
import { PremiumUpsell } from "@/components/PremiumUpsell";
import { ScreenQueryState } from "@/components/ui/ScreenQueryState";
import { loadKakaoMaps } from "@/lib/kakaoMap";
import { hasKakaoKey } from "@/config/env";
import { useChildLocations, useCreateSavedPlace, useSavedPlaces } from "@/queries/useLocation";
import { useEntitlement } from "@/queries/useEntitlement";
import { resolveMapCenter } from "@/transform/mapCenter";
import { placeLimitFor, TIERS } from "@/transform/tierPolicy";
import { resolveQueryTruthState } from "@/transform/queryTruthState";
import {
  browserPremiumReturnIntentStorage,
  clearPremiumReturnIntent,
  loadPremiumReturnIntent,
  savePremiumReturnIntent,
} from "@/transform/premiumReturnIntent";
import { ApiError } from "@/lib/api/errors";
import "./PlaceForm.css";

/** 장소 종류 — 선택 시 신호색으로 채워진다(집=민트/학원=라벤더/자주=파랑). 위험구역은 저장장소 API에 카테고리가 없어 별도 화면(위험구역 추가)에서 등록한다. */
// 선택 칩은 신호색 soft 채움 + 같은 계열 진한 라벨 + 테두리로 알린다.
// 이전에는 채도 높은 채움(#31C48D 등)에 흰 글자라 2.2~2.7:1 로 읽히지 않았다.
const PLACE_TYPES = [
  { id: "home", label: "집", activeBg: "var(--mint-soft)", activeColor: "var(--mint-text)", activeLine: "var(--mint-500)" },
  { id: "academy", label: "학원", activeBg: "var(--lav-soft)", activeColor: "var(--lav-text)", activeLine: "var(--lav-400)" },
  { id: "frequent", label: "자주", activeBg: "var(--blue-soft)", activeColor: "var(--blue-text)", activeLine: "var(--blue-500)" },
] as const;

type PlaceTypeId = (typeof PLACE_TYPES)[number]["id"];

interface LatLng {
  lat: number;
  lng: number;
}

interface PlaceFormDraft {
  placeName: string;
  address: string;
  placeType: PlaceTypeId;
  alertRadius: number;
  picked: LatLng | null;
  center: LatLng | null;
}

function validLatLng(value: unknown): LatLng | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const lat = Number(row.lat);
  const lng = Number(row.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return null;
  }
  return { lat, lng };
}

function parsePlaceFormDraft(value: unknown): PlaceFormDraft | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const placeType = row.placeType;
  const alertRadius = Number(row.alertRadius);
  if (placeType !== "home" && placeType !== "academy" && placeType !== "frequent") return null;
  if (alertRadius !== 30 && alertRadius !== 100 && alertRadius !== 150) return null;
  return {
    placeName: typeof row.placeName === "string" ? row.placeName.slice(0, 100) : "",
    address: typeof row.address === "string" ? row.address.slice(0, 300) : "",
    placeType,
    alertRadius,
    picked: row.picked == null ? null : validLatLng(row.picked),
    center: row.center == null ? null : validLatLng(row.center),
  };
}

function restoredPlaceFormDraft(routeDraft: unknown): PlaceFormDraft | null {
  const fromRoute = parsePlaceFormDraft(routeDraft);
  if (fromRoute) return fromRoute;
  const storage = browserPremiumReturnIntentStorage();
  const intent = storage ? loadPremiumReturnIntent(storage) : null;
  if (!intent || intent.source !== "saved_place" || intent.returnTo !== "/place-form") return null;
  return parsePlaceFormDraft(intent.draft);
}

// 미선택 칩 — EventForm 과 같은 토큰 정본(3.38:1 → 4.98:1).
const IDLE_BG = "var(--bg-chip-idle)";
const IDLE_COLOR = "var(--fg-tertiary)";

export function PlaceForm() {
  const navigate = useNavigate();
  const routeState = (useLocation().state ?? null) as { premiumReturnDraft?: unknown } | null;
  const { show } = useToast();
  const createPlace = useCreateSavedPlace();
  const placesQuery = useSavedPlaces();
  const entitlementQuery = useEntitlement();
  const { tier } = entitlementQuery;
  const places = placesQuery.data ?? [];
  const limit = placeLimitFor(tier);
  const placeFormQueryState = resolveQueryTruthState([
    { isLoading: placesQuery.isLoading, isError: placesQuery.isError },
    { isLoading: entitlementQuery.isLoading, isError: entitlementQuery.isError },
  ]);
  const placeFormDataMissing = placeFormQueryState === "ready" && tier === TIERS.UNKNOWN;
  const placeFormRefetching = placesQuery.isFetching || entitlementQuery.isFetching;
  const retryPlaceForm = async (): Promise<void> => {
    await Promise.all([placesQuery.refetch(), entitlementQuery.refetch()]);
  };
  // 지도 기본 중심: 현재 위치 > 집 > 아이 마지막 위치 > 서울(서울 밖 가족이 매번 지도를 끌던 문제).
  const childLocationsQuery = useChildLocations();
  const [initialDraft] = useState(() => restoredPlaceFormDraft(routeState?.premiumReturnDraft));
  const [upsellOpen, setUpsellOpen] = useState(false);

  const [placeName, setPlaceName] = useState(initialDraft?.placeName ?? "");
  const [address, setAddress] = useState(initialDraft?.address ?? "");
  const [placeType, setPlaceType] = useState<PlaceTypeId>(initialDraft?.placeType ?? "academy");
  // 도착/출발 알림 반경(m) — 기본 30(정밀). 학교류는 저장 안 해도 서버가 100m 기본 적용.
  const [alertRadius, setAlertRadius] = useState<number>(initialDraft?.alertRadius ?? 30);
  const ALERT_RADII = [
    { value: 30, label: "기본 30m" },
    { value: 100, label: "넓게 100m" },
    { value: 150, label: "아주 넓게 150m" },
  ] as const;
  const [picked, setPicked] = useState<LatLng | null>(initialDraft?.picked ?? null);
  const [center, setCenter] = useState<LatLng | null>(initialDraft?.center ?? null);
  const mapCenter = useMemo(
    () => resolveMapCenter({
      current: center,
      places,
      childLocations: childLocationsQuery.data ?? [],
    }),
    [center, places, childLocationsQuery.data],
  );
  // 지도 높이 — 하단 핸들을 아래로 드래그해 확대(160~520px).
  const [mapH, setMapH] = useState(260);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);
  const onHandleDown = (e: React.PointerEvent) => {
    dragRef.current = { startY: e.clientY, startH: mapH };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // 일부 환경(합성 이벤트 등)에서 캡처 실패해도 드래그 자체는 동작
    }
  };
  const onHandleMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setMapH(Math.min(520, Math.max(160, d.startH + (e.clientY - d.startY))));
  };
  const onHandleUp = () => {
    dragRef.current = null;
  };

  // 현재 위치 버튼 — 지도를 내 위치로 즉시 이동(선택 아님, 뷰 이동만).
  // KakaoMap 은 같은 좌표 재설정을 무시하므로 recenterKey 로 강제 재이동한다.
  const [recenterKey, setRecenterKey] = useState(0);
  const [locating, setLocating] = useState(false);
  const locateMe = () => {
    if (!navigator.geolocation) {
      show("이 기기에서 위치를 사용할 수 없어요", "📍");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setRecenterKey((k) => k + 1);
      },
      () => {
        setLocating(false);
        show("현재 위치를 가져오지 못했어요", "📍");
      },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 10_000 },
    );
  };

  // 기본 지도 중심 = 현재 위치(4초 제한) — 등록하려는 곳은 대개 지금 있는 곳 근처.
  // 실패 시 KakaoMap 내장 폴백(자녀 위치→서울) 그대로. 검색/선택으로 center 가 잡히면 덮지 않는다.
  useEffect(() => {
    if (!navigator.geolocation) return;
    let done = false;
    const timer = window.setTimeout(() => {
      done = true;
    }, 4000);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        setCenter((prev) => prev ?? { lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        done = true;
        window.clearTimeout(timer);
      },
      { enableHighAccuracy: false, timeout: 3500, maximumAge: 120_000 },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Kakao services(Geocoder) — 주소↔좌표 변환용. 키 미설정으로 로드 실패해도 화면은 동작.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const geocoderRef = useRef<any>(null);
  useEffect(() => {
    let cancelled = false;
    loadKakaoMaps()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then((maps: any) => {
        if (!cancelled && maps.services) geocoderRef.current = new maps.services.Geocoder();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // 지도 클릭 → 좌표 선택 + 역지오코딩으로 주소 자동 채움(모두 사용자 조작 기반).
  const handlePick = (lat: number, lng: number) => {
    setPicked({ lat, lng });
    const geocoder = geocoderRef.current;
    if (!geocoder) return;
    geocoder.coord2Address(
      lng,
      lat,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (results: any[], status: string) => {
        if (status !== "OK" || !results[0]) return;
        const road = results[0].road_address?.address_name;
        const jibun = results[0].address?.address_name;
        if (road || jibun) setAddress(road || jibun);
      },
    );
  };

  // 주소 검색(Enter) → 좌표 변환해 지도 이동 + 마커 표시. 읽기 동작이라 사용자 조작 시 실행.
  const searchAddress = () => {
    const geocoder = geocoderRef.current;
    const query = address.trim();
    if (!query) return;
    if (!geocoder) {
      show("주소 검색을 사용할 수 없어요", "🔍");
      return;
    }
    geocoder.addressSearch(
      query,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (results: any[], status: string) => {
        if (status === "OK" && results[0]) {
          const lat = Number(results[0].y);
          const lng = Number(results[0].x);
          setPicked({ lat, lng });
          setCenter({ lat, lng });
        } else {
          show("주소를 찾지 못했어요", "🔍");
        }
      },
    );
  };

  // 저장 — 사용자 onClick 에서만 실행. 이름·선택 위치 검증 후 useCreateSavedPlace 호출.
  const savePlace = () => {
    if (placeFormQueryState !== "ready" || tier === TIERS.UNKNOWN) {
      show("장소 한도를 확인한 뒤 다시 시도해 주세요", "⚠️");
      return;
    }
    if (!picked) {
      // 지도 미설정(키 없음)이면 위치를 고를 수 없으니 정직하게 안내.
      show(
        hasKakaoKey ? "지도를 눌러 위치를 선택해 주세요" : "지도 설정 전이라 위치를 저장할 수 없어요",
        "📍",
      );
      return;
    }
    const name = placeName.trim();
    if (!name) {
      show("장소 이름을 입력해 주세요", "✏️");
      return;
    }
    if (places.length >= limit) {
      setUpsellOpen(true);
      return;
    }
    createPlace.mutate(
      {
        name,
        location: {
          lat: picked.lat,
          lng: picked.lng,
          address: address.trim() || undefined,
          category: placeType,
          // 기본 30m 는 저장 생략(레거시 동일) — 넓힌 경우에만 기록.
          ...(alertRadius !== 30 ? { alertRadiusM: alertRadius } : {}),
        },
        is_home: placeType === "home",
      },
      {
        onSuccess: () => {
          const storage = browserPremiumReturnIntentStorage();
          if (storage) clearPremiumReturnIntent(storage);
          show(`‘${name}’ 장소를 저장했어요`, "📍");
          navigate(-1);
        },
        onError: (e) => show(e instanceof ApiError ? e.message : "장소 저장에 실패했어요", "⚠️"),
      },
    );
  };

  if (placeFormQueryState === "loading") {
    return (
      <ScreenQueryState
        screenTitle="장소 등록"
        state="loading"
        heading="장소 정보를 확인하고 있어요"
        description="저장된 장소 수와 현재 이용 한도를 불러오는 중이에요."
        onBack={() => navigate(-1)}
      />
    );
  }

  if (placeFormQueryState === "error" || placeFormDataMissing) {
    return (
      <ScreenQueryState
        screenTitle="장소 등록"
        state="error"
        heading="장소 등록 정보를 확인하지 못했어요"
        description="저장 한도가 확인되기 전에는 새 장소를 저장하지 않아요."
        onBack={() => navigate(-1)}
        onRetry={() => void retryPlaceForm()}
        retrying={placeFormRefetching}
      />
    );
  }

  return (
    <div className="pf-screen">
      <header className="pf-header">
        <button
          type="button"
          className="pf-back hy-press"
          aria-label="뒤로"
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} strokeWidth={2.2} color="#4A4145" />
        </button>
        <span className="pf-title">장소 등록</span>
      </header>

      <div className="pf-body">
        {places.length === 0 && (
          <div className="sqs-inline-empty">
            <span>아직 저장한 장소가 없어요. 첫 장소를 정확한 위치로 등록해 보세요.</span>
          </div>
        )}
        {/* 지도 — 눌러서 위치 선택(선택 좌표에 마커) */}
        <div className="pf-map" style={{ height: mapH }}>
          <KakaoMap
            className="pf-map__canvas"
            center={mapCenter}
            recenterKey={recenterKey}
            picked={picked}
            onPick={handlePick}
          />
          {!picked && (
            <span className="pf-map__hint">
              {hasKakaoKey ? "지도를 눌러 위치를 선택하세요" : "지도 기능 설정 전이에요"}
            </span>
          )}
          {/* 현재 위치로 빠른 이동(우측 하단) */}
          <button
            type="button"
            className={`pf-map-locate hy-press${locating ? " pf-map-locate--busy" : ""}`}
            aria-label="현재 위치로 이동"
            onClick={locateMe}
            disabled={locating} aria-busy={locating}
          >
            <LocateFixed size={19} strokeWidth={2.2} />
          </button>
        </div>
        {/* 지도 크기 조절 핸들 — 아래로 드래그하면 지도가 커진다 */}
        <div
          className="pf-map-handle"
          role="separator"
          aria-label="지도 크기 조절"
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onPointerCancel={onHandleUp}
        >
          <span className="pf-map-handle__bar" />
        </div>

        {/* 장소 이름 */}
        <div>
          <div className="pf-label">장소 이름</div>
          <input
            className="pf-input"
            aria-label="장소 이름"
            value={placeName}
            onChange={(e) => setPlaceName(e.target.value)}
            placeholder="예) 피아노 학원"
          />
        </div>

        {/* 주소 */}
        <div>
          <div className="pf-label">주소</div>
          <input
            className="pf-input"
            aria-label="주소"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                searchAddress();
              }
            }}
            placeholder="주소 검색"
          />
        </div>

        {/* 종류 */}
        <div>
          <div className="pf-label pf-label--types">종류</div>
          <div className="pf-types">
            {PLACE_TYPES.map((t) => {
              const active = placeType === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  className="pf-type hy-press"
                  style={{
                    background: active ? t.activeBg : IDLE_BG,
                    color: active ? t.activeColor : IDLE_COLOR,
                    boxShadow: active ? `inset 0 0 0 1.5px ${t.activeLine}` : "none",
                  }}
                  onClick={() => setPlaceType(t.id)}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
          {/* 위험구역은 저장장소가 아니라 지오펜스라 별도 경로에서 등록(오인 방지). */}
          <div className="pf-label" style={{ marginTop: 12, marginBottom: 0 }}>
            위험구역은 지도의 위험구역 추가에서 등록해요.
          </div>
        </div>

        {/* 알림 반경 — 도착/출발 판정 반경(location JSON alertRadiusM, 서버·네이티브 지오펜스 공용).
            학교처럼 부지가 넓은 곳은 넓게 잡아야 교문 도착이 제때 잡힌다. */}
        <div>
          <div className="pf-label pf-label--types">도착 알림 반경</div>
          <div className="pf-types">
            {ALERT_RADII.map((r) => {
              const active = alertRadius === r.value;
              return (
                <button
                  key={r.value}
                  type="button"
                  className="pf-type hy-press"
                  style={{
                    background: active ? "var(--mint-soft)" : IDLE_BG,
                    color: active ? "var(--mint-text)" : IDLE_COLOR,
                  }}
                  onClick={() => setAlertRadius(r.value)}
                >
                  {r.label}
                </button>
              );
            })}
          </div>
          <div className="pf-label" style={{ marginTop: 12, marginBottom: 0 }}>
            학교·놀이터처럼 넓은 곳은 ‘넓게’를 추천해요.
          </div>
        </div>

        {/* 저장 */}
        <button
          type="button"
          className="pf-save hy-press"
          onClick={savePlace}
          disabled={createPlace.isPending} aria-busy={createPlace.isPending}
        >
          {createPlace.isPending ? "저장 중…" : "저장하기"}
        </button>
      </div>
      <PremiumUpsell
        open={upsellOpen}
        source="saved_place"
        tier={tier}
        usage={{ used: places.length, limit }}
        returnTo="/place-form"
        onClose={() => setUpsellOpen(false)}
        onUpgrade={({ source, feature, returnTo }) => {
          const storage = browserPremiumReturnIntentStorage();
          const saved = storage && returnTo
            ? savePremiumReturnIntent(storage, {
                source,
                feature,
                returnTo,
                draft: { placeName, address, placeType, alertRadius, picked, center },
              })
            : false;
          if (!saved) throw new Error("작성 중인 장소를 안전하게 보관하지 못했어요. 잠시 후 다시 시도해 주세요.");
          navigate("/subscription");
        }}
      />
    </div>
  );
}

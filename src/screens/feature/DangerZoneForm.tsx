import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { ChevronLeft } from "lucide-react";
import { useToast } from "@/app/toast";
import { KakaoMap } from "@/components/KakaoMap";
import { PremiumUpsell } from "@/components/PremiumUpsell";
import { ScreenQueryState } from "@/components/ui/ScreenQueryState";
import { loadKakaoMaps } from "@/lib/kakaoMap";
import { hasKakaoKey } from "@/config/env";
import { useChildLocations, useCreateDangerZone, useDangerZones, useSavedPlaces, useUpdateDangerZone } from "@/queries/useLocation";
import { useEntitlement } from "@/queries/useEntitlement";
import { resolveMapCenter } from "@/transform/mapCenter";
import { dangerZoneLimitFor, TIERS } from "@/transform/tierPolicy";
import { resolveQueryTruthState } from "@/transform/queryTruthState";
import {
  browserPremiumReturnIntentStorage,
  clearPremiumReturnIntent,
  loadPremiumReturnIntent,
  savePremiumReturnIntent,
} from "@/transform/premiumReturnIntent";
import type { DangerZone } from "@/lib/api/endpoints/location";
import "./DangerZoneForm.css";
import { useIntl } from "react-intl";
import { localizeApiError } from "@/i18n/apiError";

interface LatLng {
  lat: number;
  lng: number;
}

interface DangerZoneDraft {
  name: string;
  address: string;
  radius: number;
  picked: LatLng | null;
  center: LatLng | null;
  entryAlert: boolean;
  exitAlert: boolean;
}

interface DangerZoneRouteState {
  zone?: DangerZone;
  premiumReturnDraft?: unknown;
}

/** 반경 범위(m) — 지오펜스 판정에 쓰는 안전 반경.
 * 위험구역은 최소한의 지역만 지정하는 것이 원칙(TK) — 20m 까지 축소 가능.
 * 단 GPS 오차(약 10~20m)로 아주 작은 반경은 진입 감지가 덜 민감할 수 있다(폼에 안내). */
const RADIUS_MIN = 20;
const RADIUS_MAX = 1000;
const RADIUS_STEP = 10;
const RADIUS_DEFAULT = 50;

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

function parseDangerZoneDraft(value: unknown): DangerZoneDraft | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const radius = Number(row.radius);
  if (!Number.isFinite(radius) || radius < RADIUS_MIN || radius > RADIUS_MAX || radius % RADIUS_STEP !== 0) {
    return null;
  }
  if (typeof row.entryAlert !== "boolean" || typeof row.exitAlert !== "boolean") return null;
  return {
    name: typeof row.name === "string" ? row.name.slice(0, 100) : "",
    address: typeof row.address === "string" ? row.address.slice(0, 300) : "",
    radius,
    picked: row.picked == null ? null : validLatLng(row.picked),
    center: row.center == null ? null : validLatLng(row.center),
    entryAlert: row.entryAlert,
    exitAlert: row.exitAlert,
  };
}

function restoredDangerZoneDraft(routeDraft: unknown): DangerZoneDraft | null {
  const fromRoute = parseDangerZoneDraft(routeDraft);
  if (fromRoute) return fromRoute;
  const storage = browserPremiumReturnIntentStorage();
  const intent = storage ? loadPremiumReturnIntent(storage) : null;
  if (!intent || intent.source !== "danger_zone" || intent.returnTo !== "/danger-zone-form") return null;
  return parseDangerZoneDraft(intent.draft);
}

/** P-17 위험구역 추가·편집. 지도 핀으로 중심 선택 + 반경 슬라이더 + 진입/이탈 알림 토글. */
export function DangerZoneForm() {
  const intl = useIntl();
  const navigate = useNavigate();
  const { show } = useToast();
  const routeState = (useLocation().state ?? null) as DangerZoneRouteState | null;
  const editing = routeState?.zone ?? null;
  const [initialDraft] = useState(() => editing ? null : restoredDangerZoneDraft(routeState?.premiumReturnDraft));
  const [upsellOpen, setUpsellOpen] = useState(false);

  const createZone = useCreateDangerZone();
  const updateZone = useUpdateDangerZone();
  const zonesQuery = useDangerZones();
  const entitlementQuery = useEntitlement();
  const { tier } = entitlementQuery;
  const zones = zonesQuery.data ?? [];
  const dangerZoneQueryState = resolveQueryTruthState([
    { isLoading: zonesQuery.isLoading, isError: zonesQuery.isError },
    { isLoading: entitlementQuery.isLoading, isError: entitlementQuery.isError },
  ]);
  const dangerZoneDataMissing = dangerZoneQueryState === "ready" && tier === TIERS.UNKNOWN;
  const dangerZoneRefetching = zonesQuery.isFetching || entitlementQuery.isFetching;
  const retryDangerZoneForm = async (): Promise<void> => {
    await Promise.all([zonesQuery.refetch(), entitlementQuery.refetch()]);
  };

  const [name, setName] = useState(editing?.name ?? initialDraft?.name ?? "");
  const [address, setAddress] = useState(initialDraft?.address ?? "");
  const [radius, setRadius] = useState(editing?.radius_m ?? initialDraft?.radius ?? RADIUS_DEFAULT);
  const [picked, setPicked] = useState<LatLng | null>(
    editing ? { lat: editing.lat, lng: editing.lng } : initialDraft?.picked ?? null,
  );
  const [center, setCenter] = useState<LatLng | null>(
    editing ? { lat: editing.lat, lng: editing.lng } : initialDraft?.center ?? null,
  );
  // 지도 기본 중심: 편집 좌표 > 집 > 아이 마지막 위치 > 서울(서울 밖 가족 배려).
  const savedPlacesQuery = useSavedPlaces();
  const childLocationsQuery = useChildLocations();
  const mapCenter = useMemo(
    () => resolveMapCenter({
      current: center,
      places: savedPlacesQuery.data ?? [],
      childLocations: childLocationsQuery.data ?? [],
    }),
    [center, savedPlacesQuery.data, childLocationsQuery.data],
  );
  const [entryAlert, setEntryAlert] = useState(editing?.alert_on_entry ?? initialDraft?.entryAlert ?? true);
  const [exitAlert, setExitAlert] = useState(editing?.alert_on_exit ?? initialDraft?.exitAlert ?? false);

  // Kakao Geocoder(주소↔좌표) — 키 미설정이면 로드 실패해도 화면은 동작.
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

  // 지도 클릭 → 중심 좌표 선택 + 역지오코딩으로 주소 자동 채움.
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

  // 주소 검색(Enter) → 좌표로 이동 + 마커.
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

  const saving = createZone.isPending || updateZone.isPending;

  // 저장 — 사용자 onClick 에서만. 편집이면 같은 구역을 부분수정(id·created_at 보존), 신규면 생성.
  const save = () => {
    if (saving) return;
    if (dangerZoneQueryState !== "ready" || tier === TIERS.UNKNOWN) {
      show("위험구역 이용 한도를 확인한 뒤 다시 시도해 주세요", "⚠️");
      return;
    }
    if (!picked) {
      show(
        hasKakaoKey ? "지도를 눌러 구역 중심을 선택해 주세요" : "지도 설정 전이라 구역을 저장할 수 없어요",
        "📍",
      );
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      show("구역 이름을 입력해 주세요", "✏️");
      return;
    }
    const limit = dangerZoneLimitFor(tier);
    if (!editing && zones.length >= limit) {
      setUpsellOpen(true);
      return;
    }
    const payload = {
      name: trimmed,
      lat: picked.lat,
      lng: picked.lng,
      radius_m: radius,
      zone_type: editing?.zone_type ?? "custom",
      alert_on_entry: entryAlert,
      alert_on_exit: exitAlert,
    };
    const handlers = {
      onSuccess: () => {
        const storage = browserPremiumReturnIntentStorage();
        if (storage) clearPremiumReturnIntent(storage);
        show(editing ? "위험구역을 수정했어요" : "위험구역을 추가했어요", "🛡️");
        navigate(-1);
      },
      onError: (e: Error) => show(localizeApiError(e, intl, "formal"), "⚠️"),
    };
    if (editing?.id) {
      updateZone.mutate({ id: editing.id, zone: payload }, handlers);
    } else {
      createZone.mutate(payload, handlers);
    }
  };

  if (dangerZoneQueryState === "loading") {
    return (
      <ScreenQueryState
        screenTitle={editing ? "위험구역 편집" : "위험구역 추가"}
        state="loading"
        heading="위험구역 정보를 확인하고 있어요"
        description="저장된 구역과 현재 이용 한도를 불러오는 중이에요."
        onBack={() => navigate(-1)}
      />
    );
  }

  if (dangerZoneQueryState === "error" || dangerZoneDataMissing) {
    return (
      <ScreenQueryState
        screenTitle={editing ? "위험구역 편집" : "위험구역 추가"}
        state="error"
        heading="위험구역 정보를 확인하지 못했어요"
        description="안전 구역과 이용 한도가 확인되기 전에는 저장하지 않아요."
        onBack={() => navigate(-1)}
        onRetry={() => void retryDangerZoneForm()}
        retrying={dangerZoneRefetching}
      />
    );
  }

  return (
    <div className="dzf-screen">
      <header className="dzf-header">
        <button type="button" className="dzf-back hy-press" aria-label="뒤로" onClick={() => navigate(-1)}>
          <ChevronLeft size={22} strokeWidth={2.2} color="#4A4145" />
        </button>
        <span className="dzf-title">{editing ? "위험구역 편집" : "위험구역 추가"}</span>
      </header>

      <div className="dzf-body">
        {!editing && zones.length === 0 && (
          <div className="sqs-inline-empty">
            <span>아직 등록한 위험구역이 없어요. 필요한 범위만 작게 지정해 주세요.</span>
          </div>
        )}
        {/* 지도 — 눌러서 구역 중심 선택(반경 원 미리보기) */}
        <div className="dzf-map">
          <KakaoMap
            className="dzf-map__canvas"
            center={mapCenter}
            picked={picked}
            zones={picked ? [{ lat: picked.lat, lng: picked.lng, radiusM: radius, name: name.trim() || "위험구역" }] : []}
            onPick={handlePick}
          />
          {!picked && (
            <span className="dzf-map__hint">
              {hasKakaoKey ? "지도를 눌러 구역 중심을 선택하세요" : "지도 기능 설정 전이에요"}
            </span>
          )}
        </div>

        {/* 구역 이름 */}
        <div>
          <div className="dzf-label">구역 이름</div>
          <input
            className="dzf-input"
            aria-label="구역 이름"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예) 공사장 인근"
          />
        </div>

        {/* 주소 */}
        <div>
          <div className="dzf-label">주소</div>
          <input
            className="dzf-input"
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

        {/* 반경 */}
        <div>
          <div className="dzf-radius-head">
            <span className="dzf-radius-label">안전 반경</span>
            <span className="dzf-radius-value">{radius}m</span>
          </div>
          <input
            className="dzf-range"
            type="range"
            aria-label="안전 반경"
            min={RADIUS_MIN}
            max={RADIUS_MAX}
            step={RADIUS_STEP}
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
          />
          {radius < 50 && (
            <p className="dzf-hint hy-explain">반경이 아주 작으면 GPS 오차로 감지가 조금 늦을 수 있어요</p>
          )}
        </div>

        {/* 진입/이탈 알림 */}
        <div className="dzf-toggles">
          <div className="dzf-toggle-row">
            <span id="danger-zone-entry-alert-label" className="dzf-toggle-label">
              진입 시 알림
            </span>
            <button
              type="button"
              className="dzf-toggle"
              role="switch"
              aria-labelledby="danger-zone-entry-alert-label"
              aria-checked={entryAlert}
              data-on={entryAlert}
              onClick={() => setEntryAlert((v) => !v)}
            >
              <span className="dzf-toggle__knob" />
            </button>
          </div>
          <div className="dzf-toggle-row">
            <span id="danger-zone-exit-alert-label" className="dzf-toggle-label">
              이탈 시 알림
            </span>
            <button
              type="button"
              className="dzf-toggle"
              role="switch"
              aria-labelledby="danger-zone-exit-alert-label"
              aria-checked={exitAlert}
              data-on={exitAlert}
              onClick={() => setExitAlert((v) => !v)}
            >
              <span className="dzf-toggle__knob" />
            </button>
          </div>
          <div className="dzf-toggle-note hy-explain">
            저장한 설정대로 아이가 위험구역에 들어가거나 벗어날 때 부모님께 알려드려요.
          </div>
        </div>

        {/* 저장 */}
        <button type="button" className="dzf-save hy-press" onClick={save} disabled={saving} aria-busy={saving}>
          {saving ? "저장 중…" : editing ? "구역 수정하기" : "구역 저장하기"}
        </button>
      </div>
      <PremiumUpsell
        open={upsellOpen}
        source="danger_zone"
        tier={tier}
        returnTo="/danger-zone-form"
        onClose={() => setUpsellOpen(false)}
        onUpgrade={({ source, feature, returnTo }) => {
          const storage = browserPremiumReturnIntentStorage();
          const saved = storage && returnTo
            ? savePremiumReturnIntent(storage, {
                source,
                feature,
                returnTo,
                draft: { name, address, radius, picked, center, entryAlert, exitAlert },
              })
            : false;
          if (!saved) throw new Error("작성 중인 위험구역을 안전하게 보관하지 못했어요. 잠시 후 다시 시도해 주세요.");
          navigate("/subscription");
        }}
      />
    </div>
  );
}

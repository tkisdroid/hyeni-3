import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { ChevronLeft } from "lucide-react";
import { useToast } from "@/app/toast";
import { FamilyMap } from "@/maps/FamilyMap";
import { MapSearchResults, type MapSearchResultsState } from "@/maps/MapSearchResults";
import { buildPersistedMapLocation } from "@/maps/persistence";
import { PremiumUpsell } from "@/components/PremiumUpsell";
import { ScreenQueryState } from "@/components/ui/ScreenQueryState";
import { hasKakaoKey } from "@/config/env";
import { findMapPlaces, reverseRawMapLabel, selectMapPlace } from "@/lib/mapActions";
import { confirmPinFromMapGesture, type EphemeralMapSearchCandidate, type UserConfirmedPin } from "@/lib/api/endpoints/maps";
import { useAuth } from "@/auth/AuthContext";
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
  const { familyId } = useAuth();
  const navigate = useNavigate();
  const { show } = useToast();
  const routeState = (useLocation().state ?? null) as DangerZoneRouteState | null;
  const editing = routeState?.zone ?? null;
  const screenTitle = intl.formatMessage({
    id: editing ? "notifications.dangerZoneForm.title.edit" : "notifications.dangerZoneForm.title.add",
  });
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
  const initialPicked = editing ? { lat: editing.lat, lng: editing.lng } : initialDraft?.picked ?? null;
  const [picked, setPicked] = useState<UserConfirmedPin | null>(
    initialPicked ? confirmPinFromMapGesture(initialPicked) : null,
  );
  const [center, setCenter] = useState<LatLng | null>(
    editing ? { lat: editing.lat, lng: editing.lng } : initialDraft?.center ?? null,
  );
  const [searchResults, setSearchResults] = useState<MapSearchResultsState | null>(null);
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

  // 지도 클릭 → 중심 좌표 선택 + 역지오코딩으로 주소 자동 채움.
  const handlePick = (lat: number, lng: number) => {
    setPicked(confirmPinFromMapGesture({ lat, lng }));
    setSearchResults(null);
    if (familyId) void reverseRawMapLabel(familyId, { lat, lng }, intl.locale, "picker_pin").then(setAddress).catch(() => undefined);
  };

  // 주소 검색(Enter) → 좌표로 이동 + 마커.
  const searchAddress = async () => {
    const query = address.trim();
    if (!query) return;
    if (!familyId) {
      show(intl.formatMessage({ id: "notifications.dangerZoneForm.addressSearchUnavailable" }), "🔍");
      return;
    }
    try {
      const result = await findMapPlaces(familyId, query, intl.locale);
      if (result.candidates.length === 0) throw new Error("map_search_failed");
      setSearchResults({ provider: result.session.provider, sessionHandle: result.session.sessionHandle, candidates: result.candidates });
    } catch {
      show(intl.formatMessage({ id: "notifications.dangerZoneForm.addressNotFound" }), "🔍");
    }
  };

  const selectSearchResult = async (candidate: EphemeralMapSearchCandidate) => {
    if (!familyId || !searchResults) return;
    try {
      const selected = await selectMapPlace(familyId, searchResults.sessionHandle, candidate);
      setPicked(null);
      setCenter(selected.point);
      setSearchResults(null);
    } catch {
      show(intl.formatMessage({ id: "notifications.dangerZoneForm.addressNotFound" }), "🔍");
    }
  };

  const saving = createZone.isPending || updateZone.isPending;

  // 저장 — 사용자 onClick 에서만. 편집이면 같은 구역을 부분수정(id·created_at 보존), 신규면 생성.
  const save = () => {
    if (saving) return;
    if (dangerZoneQueryState !== "ready" || tier === TIERS.UNKNOWN) {
      show(intl.formatMessage({ id: "notifications.dangerZoneForm.checkLimitFirst" }), "⚠️");
      return;
    }
    if (!picked) {
      show(
        intl.formatMessage({
          id: hasKakaoKey
            ? "notifications.dangerZoneForm.selectCenter"
            : "notifications.dangerZoneForm.mapNotConfiguredSave",
        }),
        "📍",
      );
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      show(intl.formatMessage({ id: "notifications.dangerZoneForm.nameRequired" }), "✏️");
      return;
    }
    const persisted = buildPersistedMapLocation({ label: trimmed, pin: picked });
    const limit = dangerZoneLimitFor(tier);
    if (!editing && zones.length >= limit) {
      setUpsellOpen(true);
      return;
    }
    const payload = {
      name: trimmed,
      lat: persisted.lat,
      lng: persisted.lng,
      radius_m: radius,
      zone_type: editing?.zone_type ?? "custom",
      alert_on_entry: entryAlert,
      alert_on_exit: exitAlert,
    };
    const handlers = {
      onSuccess: () => {
        const storage = browserPremiumReturnIntentStorage();
        if (storage) clearPremiumReturnIntent(storage);
        show(intl.formatMessage({
          id: editing
            ? "notifications.dangerZoneForm.updated"
            : "notifications.dangerZoneForm.created",
        }), "🛡️");
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
        screenTitle={screenTitle}
        state="loading"
        heading={intl.formatMessage({ id: "notifications.dangerZoneForm.loading.title" })}
        description={intl.formatMessage({ id: "notifications.dangerZoneForm.loading.description" })}
        onBack={() => navigate(-1)}
      />
    );
  }

  if (dangerZoneQueryState === "error" || dangerZoneDataMissing) {
    return (
      <ScreenQueryState
        screenTitle={screenTitle}
        state="error"
        heading={intl.formatMessage({ id: "notifications.dangerZoneForm.error.title" })}
        description={intl.formatMessage({ id: "notifications.dangerZoneForm.error.description" })}
        onBack={() => navigate(-1)}
        onRetry={() => void retryDangerZoneForm()}
        retrying={dangerZoneRefetching}
      />
    );
  }

  return (
    <div className="dzf-screen">
      <header className="dzf-header">
        <button
          type="button"
          className="dzf-back hy-press"
          aria-label={intl.formatMessage({ id: "notifications.action.back" })}
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} strokeWidth={2.2} color="#4A4145" />
        </button>
        <span className="dzf-title">{screenTitle}</span>
      </header>

      <div className="dzf-body">
        {!editing && zones.length === 0 && (
          <div className="sqs-inline-empty">
            <span>{intl.formatMessage({ id: "notifications.dangerZoneForm.empty" })}</span>
          </div>
        )}
        {/* 지도 — 눌러서 구역 중심 선택(반경 원 미리보기) */}
        <div className="dzf-map">
          <FamilyMap
            className="dzf-map__canvas"
            center={mapCenter}
            picked={picked}
            zones={picked ? [{
              lat: picked.lat,
              lng: picked.lng,
              radiusM: radius,
              name: name.trim() || intl.formatMessage({ id: "notifications.dangerZoneForm.fallbackName" }),
            }] : []}
            onPick={handlePick}
          />
          {!picked && (
            <span className="dzf-map__hint">
              {intl.formatMessage({
                id: hasKakaoKey
                  ? "notifications.dangerZoneForm.mapHint"
                  : "notifications.dangerZoneForm.mapNotConfigured",
              })}
            </span>
          )}
        </div>

        {/* 구역 이름 */}
        <div>
          <div className="dzf-label">{intl.formatMessage({ id: "notifications.dangerZoneForm.name" })}</div>
          <input
            className="dzf-input"
            aria-label={intl.formatMessage({ id: "notifications.dangerZoneForm.name" })}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={intl.formatMessage({ id: "notifications.dangerZoneForm.namePlaceholder" })}
          />
        </div>

        {/* 주소 */}
        <div>
          <div className="dzf-label">{intl.formatMessage({ id: "notifications.dangerZoneForm.address" })}</div>
          <input
            className="dzf-input"
            aria-label={intl.formatMessage({ id: "notifications.dangerZoneForm.address" })}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                searchAddress();
              }
            }}
            placeholder={intl.formatMessage({ id: "notifications.dangerZoneForm.addressPlaceholder" })}
          />
          <MapSearchResults result={searchResults} onSelect={selectSearchResult} />
        </div>

        {/* 반경 */}
        <div>
          <div className="dzf-radius-head">
            <span className="dzf-radius-label">
              {intl.formatMessage({ id: "notifications.dangerZoneForm.radius" })}
            </span>
            <span className="dzf-radius-value">
              {intl.formatMessage({ id: "notifications.dangerZoneForm.radiusValue" }, { radius })}
            </span>
          </div>
          <input
            className="dzf-range"
            type="range"
            aria-label={intl.formatMessage({ id: "notifications.dangerZoneForm.radius" })}
            min={RADIUS_MIN}
            max={RADIUS_MAX}
            step={RADIUS_STEP}
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
          />
          {radius < 50 && (
            <p className="dzf-hint hy-explain">
              {intl.formatMessage({ id: "notifications.dangerZoneForm.smallRadiusHint" })}
            </p>
          )}
        </div>

        {/* 진입/이탈 알림 */}
        {/* 접근성 정본: id="danger-zone-entry-alert-label">진입 시 알림 / id="danger-zone-exit-alert-label">이탈 시 알림 */}
        <div className="dzf-toggles">
          <div className="dzf-toggle-row">
            <span id="danger-zone-entry-alert-label" className="dzf-toggle-label">
              {intl.formatMessage({ id: "notifications.dangerZoneForm.entryAlert" })}
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
              {intl.formatMessage({ id: "notifications.dangerZoneForm.exitAlert" })}
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
            {intl.formatMessage({ id: "notifications.dangerZoneForm.alertNote" })}
          </div>
        </div>

        {/* 저장 */}
        <button type="button" className="dzf-save hy-press" onClick={save} disabled={saving} aria-busy={saving}>
          {intl.formatMessage({
            id: saving
              ? "notifications.dangerZoneForm.saving"
              : editing
                ? "notifications.dangerZoneForm.update"
                : "notifications.dangerZoneForm.save",
          })}
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
          if (!saved) {
            throw new Error(intl.formatMessage({ id: "notifications.dangerZoneForm.draftSaveFailed" }));
          }
          navigate("/subscription");
        }}
      />
    </div>
  );
}

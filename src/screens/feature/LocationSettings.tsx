import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { ChevronLeft, ChevronRight, MapPin, Check, Radar, BatteryCharging, History, Crown } from "lucide-react";
import { useToast } from "@/app/toast";
import { useAuth } from "@/auth/AuthContext";
import { useActiveChild } from "@/app/activeChild";
import { useEntitlement } from "@/queries/useEntitlement";
import { useLocationPreferences, useSaveLocationPreferences } from "@/queries/useLocation";
import { requestDeviceStatus } from "@/lib/api/endpoints/remote";
import type { LocationIntervalMode, LocationPreferences } from "@/lib/api/endpoints/location";
import { deviceLocationHealthView } from "@/transform/deviceNotificationHealth";
import { ScreenQueryState } from "@/components/ui/ScreenQueryState";
import { PremiumUpsell } from "@/components/PremiumUpsell";
import { resolveQueryTruthState } from "@/transform/queryTruthState";
import {
  browserPremiumReturnIntentStorage,
  savePremiumReturnIntent,
} from "@/transform/premiumReturnIntent";
import { TIERS } from "@/transform/tierPolicy";
import "./LocationSettings.css";

/**
 * P-31 위치·백그라운드 설정(부모).
 *
 * 서버 위치 prefs 를 가족 단위로 저장하고, 아이 안드로이드 기기가 주기적으로 읽어
 * LocationService 측위 간격에 반영한다. localStorage 는 서버 조회 전 화면 초기값용 캐시다.
 * 권한·서비스 상태는 활성 아이의 device_health 보고를 기준으로 표시한다.
 */

type UpdateInterval = LocationIntervalMode;
type SavingAction = "background" | "battery" | "return-live" | `interval:${UpdateInterval}`;

interface LocationPrefs {
  background: boolean;
  interval: UpdateInterval;
  batterySaverException: boolean;
}

interface LocationSettingsRouteState {
  premiumReturnSource?: string;
  premiumEntitlementConfirmed?: boolean;
  premiumReturnDraft?: unknown;
}

const PREFS_KEY = "hy.locationPrefs.v1";

const DEFAULT_PREFS: LocationPrefs = {
  background: true,
  interval: "balanced",
  batterySaverException: true,
};

const INTERVALS: { id: UpdateInterval; label: string }[] = [
  { id: "live", label: "실시간" },
  { id: "balanced", label: "균형" },
  { id: "saver", label: "절약" },
];

const INTERVAL_DESC: Record<UpdateInterval, string> = {
  live: "자주 보내 최신 위치를 보여줘요. 배터리는 더 써요.",
  balanced: "이동 중엔 자주, 멈춰 있을 땐 드물게 보내요.",
  saver: "배터리를 아끼고, 위치는 조금 늦게 와요.",
};

function restoredLiveIntervalIntent(state: LocationSettingsRouteState | null): boolean {
  if (
    state?.premiumReturnSource !== "location_live_interval"
    || state.premiumEntitlementConfirmed !== true
    || !state.premiumReturnDraft
    || typeof state.premiumReturnDraft !== "object"
  ) return false;
  return (state.premiumReturnDraft as Record<string, unknown>).interval === "live";
}

function loadPrefs(): LocationPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<LocationPrefs>;
    return {
      background: typeof parsed.background === "boolean" ? parsed.background : DEFAULT_PREFS.background,
      interval: (["live", "balanced", "saver"] as const).includes(parsed.interval as UpdateInterval)
        ? (parsed.interval as UpdateInterval)
        : DEFAULT_PREFS.interval,
      batterySaverException:
        typeof parsed.batterySaverException === "boolean"
          ? parsed.batterySaverException
          : DEFAULT_PREFS.batterySaverException,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function savePrefs(prefs: LocationPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch (error) {
    console.error("위치 설정 저장 실패:", error);
  }
}

function locationPreferencesHydrationKey(
  familyId: string | null,
  serverPrefs: LocationPreferences | undefined,
): string | null {
  if (!familyId || !serverPrefs || serverPrefs.family_id !== familyId) return null;
  return JSON.stringify([
    familyId,
    serverPrefs.background_enabled,
    serverPrefs.interval_mode,
    serverPrefs.battery_saver_exception,
  ]);
}

export function LocationSettings() {
  const navigate = useNavigate();
  const routeState = (useLocation().state ?? null) as LocationSettingsRouteState | null;
  const { show } = useToast();
  const { familyId } = useAuth();
  const { activeChild } = useActiveChild();
  const entitlementQuery = useEntitlement();
  const preferencesQuery = useLocationPreferences();
  const savePreferences = useSaveLocationPreferences();
  const { isPremium, tier } = entitlementQuery;
  const [prefs, setPrefs] = useState<LocationPrefs>(loadPrefs);
  const [hydratedFamilyId, setHydratedFamilyId] = useState<string | null>(null);
  const [hydratedPreferencesKey, setHydratedPreferencesKey] = useState<string | null>(null);
  const [savingAction, setSavingAction] = useState<SavingAction | null>(null);
  const [liveUpsellOpen, setLiveUpsellOpen] = useState(false);
  const [historyUpsellOpen, setHistoryUpsellOpen] = useState(false);
  const [restoredInterval, setRestoredInterval] = useState<UpdateInterval | null>(
    () => restoredLiveIntervalIntent(routeState) ? "live" : null,
  );
  const saving = savingAction !== null || savePreferences.isPending;
  const currentFamilyIdRef = useRef(familyId);
  currentFamilyIdRef.current = familyId;

  const locationSettingsQueryState = resolveQueryTruthState([
    { isLoading: preferencesQuery.isLoading, isError: preferencesQuery.isError },
    { isLoading: entitlementQuery.isLoading, isError: entitlementQuery.isError },
  ]);
  const serverPreferencesKey = locationPreferencesHydrationKey(familyId, preferencesQuery.data);
  const locationSettingsEmpty = locationSettingsQueryState === "ready" && !familyId;
  const locationSettingsDataMissing = locationSettingsQueryState === "ready"
    && !!familyId
    && (!serverPreferencesKey || !entitlementQuery.ready);
  const locationSettingsDataReady = locationSettingsQueryState === "ready"
    && !!familyId
    && !locationSettingsDataMissing
    && hydratedFamilyId === familyId
    && hydratedPreferencesKey === serverPreferencesKey;
  const locationSettingsHydrating = locationSettingsQueryState === "ready"
    && !!familyId
    && !locationSettingsDataMissing
    && !locationSettingsDataReady;
  const locationSettingsRefetching = preferencesQuery.isFetching || entitlementQuery.isFetching;
  const pendingInterval = tier === TIERS.PREMIUM ? restoredInterval : null;
  const selectedInterval = pendingInterval ?? prefs.interval;
  const retryLocationSettings = async (): Promise<void> => {
    await Promise.all([preferencesQuery.refetch(), entitlementQuery.refetch()]);
  };

  const childName = activeChild?.name?.trim() || "아이";
  const childLocationHealth = deviceLocationHealthView(activeChild?.device_health);
  const childLocationTone = childLocationHealth.state === "ready"
    ? "safe"
    : childLocationHealth.state === "attention"
      ? "caution"
      : "neutral";

  // 이 화면의 권한 대상은 부모 iPhone이 아니라 활성 아이 Android다.
  // 진입 시 아이 기기에 최신 상태 보고를 요청하고, 응답은 기존 family realtime으로 반영한다.
  useEffect(() => {
    if (!familyId || !activeChild?.user_id) return;
    void requestDeviceStatus(familyId, activeChild.user_id);
  }, [familyId, activeChild?.user_id]);

  useEffect(() => {
    setHydratedFamilyId(null);
    setHydratedPreferencesKey(null);
  }, [familyId]);

  useEffect(() => {
    const serverPrefs = preferencesQuery.data;
    if (!familyId || !serverPrefs || !serverPreferencesKey) return;
    const next: LocationPrefs = {
      background: serverPrefs.background_enabled,
      interval: serverPrefs.interval_mode,
      batterySaverException: serverPrefs.battery_saver_exception,
    };
    setPrefs(next);
    savePrefs(next);
    setRestoredInterval((current) => current === next.interval ? null : current);
    setHydratedFamilyId(familyId);
    setHydratedPreferencesKey(serverPreferencesKey);
  }, [familyId, preferencesQuery.data, serverPreferencesKey]);

  const update = async (
    action: SavingAction,
    patch: Partial<LocationPrefs>,
    message: string,
    icon: string,
  ): Promise<boolean> => {
    const updateFamilyId = familyId;
    if (!updateFamilyId || !locationSettingsDataReady || saving || savePreferences.isPending) {
      show("서버의 위치 설정을 확인한 뒤 다시 시도해 주세요", "⚠️");
      return false;
    }
    const next = { ...prefs, ...patch };
    setSavingAction(action);
    try {
      const saved = await savePreferences.mutateAsync({
        familyId: updateFamilyId,
        prefs: {
          background_enabled: next.background,
          interval_mode: next.interval,
          battery_saver_exception: next.batterySaverException,
        },
      });
      if (currentFamilyIdRef.current !== updateFamilyId) return false;
      const savedPreferencesKey = locationPreferencesHydrationKey(updateFamilyId, saved);
      if (!savedPreferencesKey) throw new Error("저장된 위치 설정의 가족 범위가 일치하지 않아요");
      const confirmed: LocationPrefs = {
        background: saved.background_enabled,
        interval: saved.interval_mode,
        batterySaverException: saved.battery_saver_exception,
      };
      setPrefs(confirmed);
      setHydratedFamilyId(updateFamilyId);
      setHydratedPreferencesKey(savedPreferencesKey);
      savePrefs(confirmed);
      show(message, icon);
      return true;
    } catch (error) {
      console.error("위치 설정 저장 실패:", error);
      show("위치 설정 저장에 실패했어요. 잠시 후 다시 시도해 주세요", "⚠️");
      return false;
    } finally {
      setSavingAction(null);
    }
  };

  const toggleBackground = () => {
    void update("background", { background: !prefs.background }, "아이 기기에 곧 반영돼요", "📍");
  };

  const toggleBatteryException = () => {
    void update("battery", { batterySaverException: !prefs.batterySaverException }, "배터리 설정 선호를 저장했어요", "🔋");
  };

  const pickInterval = (interval: UpdateInterval) => {
    if (interval === selectedInterval) return;
    if (interval === "live" && tier !== TIERS.PREMIUM) {
      setLiveUpsellOpen(true);
      return;
    }
    setRestoredInterval(null);
    void update(`interval:${interval}`, { interval }, "업데이트 주기를 저장했어요. 아이 기기에 곧 반영돼요", "⏱️");
  };

  const savePendingInterval = async (): Promise<void> => {
    if (pendingInterval !== "live") return;
    const saved = await update("return-live", { interval: "live" }, "실시간 모드를 저장했어요. 아이 기기에 곧 반영돼요", "⏱️");
    if (saved) setRestoredInterval(null);
  };

  const openLocationHistory = (): void => {
    if (tier === TIERS.PREMIUM) {
      navigate("/parent/location?view=history");
      return;
    }
    setHistoryUpsellOpen(true);
  };

  const retentionLabel = isPremium
    ? "최근 30일 (프리미엄 조회 범위)"
    : "오늘 (무료 조회 범위)";

  if (locationSettingsQueryState === "loading" || locationSettingsHydrating) {
    return (
      <ScreenQueryState
        screenTitle="위치 · 백그라운드"
        state="loading"
        heading="위치 설정을 확인하고 있어요"
        description="전송 주기와 이용 범위를 불러오고 있어요."
        onBack={() => navigate(-1)}
      />
    );
  }

  if (locationSettingsQueryState === "error" || locationSettingsDataMissing) {
    return (
      <ScreenQueryState
        screenTitle="위치 · 백그라운드"
        state="error"
        heading="위치 설정을 확인하지 못했어요"
        description="서버 설정을 지키려고 변경을 잠시 닫았어요."
        onBack={() => navigate(-1)}
        onRetry={() => void retryLocationSettings()}
        retrying={locationSettingsRefetching}
      />
    );
  }

  if (locationSettingsEmpty) {
    return (
      <ScreenQueryState
        screenTitle="위치 · 백그라운드"
        state="empty"
        heading="연결된 가족이 없어요"
        description="가족을 연결한 뒤 위치 설정을 관리할 수 있어요."
        onBack={() => navigate(-1)}
        onRetry={() => navigate("/parent/family")}
        retryLabel="가족 연결 확인"
      />
    );
  }

  return (
    <div className="lset-screen">
      <header className="lset-header">
        <button type="button" className="lset-back hy-press" aria-label="뒤로" onClick={() => navigate(-1)}>
          <ChevronLeft size={22} strokeWidth={2.2} color="#4A4145" />
        </button>
        <span className="lset-title">위치 · 백그라운드</span>
      </header>

      <div className="lset-body">
        {/* 활성 아이 Android의 실제 위치 권한·서비스 보고 상태 */}
        <div className="lset-row" aria-live="polite">
          <span className="lset-row__icon">
            <MapPin size={18} strokeWidth={2.2} color="#2E86C1" />
          </span>
          <span className="lset-row__main">
            <span className="lset-row__title">아이 기기 위치 상태</span>
            <span className="lset-row__sub">{childName} · {childLocationHealth.detail}</span>
          </span>
          <span className={`lset-chip lset-chip--${childLocationTone}`}>
            {childLocationHealth.shortLabel}
          </span>
        </div>

        {/* 백그라운드 위치 전송 */}
        <div className="lset-row">
          <span className="lset-row__icon">
            <Radar size={18} strokeWidth={2.2} color="#2E86C1" />
          </span>
          <span className="lset-row__main">
            <span className="lset-row__title">백그라운드 위치 전송</span>
            <span className="lset-row__sub">앱을 닫아도 위치를 보내요</span>
          </span>
          <button
            type="button"
            className="lset-toggle"
            role="switch"
            aria-checked={prefs.background}
            aria-label="백그라운드 위치 전송"
            data-on={prefs.background}
            onClick={toggleBackground}
            disabled={saving || !locationSettingsDataReady}
            aria-busy={savingAction === "background"}
          >
            <span className="lset-toggle__knob" />
          </button>
        </div>

        {/* 업데이트 주기 */}
        <div className="lset-field">
          <div className="lset-flabel">업데이트 주기</div>
          <div className="lset-seg">
            {INTERVALS.map((opt) => {
              const on = selectedInterval === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  className="lset-seg__item hy-press"
                  data-on={on}
                  aria-pressed={on}
                  aria-label={opt.id === "live" ? "실시간 위치 전송 (프리미엄)" : opt.label}
                  onClick={() => pickInterval(opt.id)}
                  disabled={saving || !locationSettingsDataReady}
                  aria-busy={savingAction === `interval:${opt.id}`}
                >
                  {on && <Check size={13} strokeWidth={3} className="lset-seg__check" />}
                  {opt.label}
                  {opt.id === "live" && <Crown size={13} strokeWidth={2.3} aria-hidden="true" />}
                </button>
              );
            })}
          </div>
          <p className="lset-desc">{INTERVAL_DESC[selectedInterval]}</p>
        </div>

        {pendingInterval === "live" && prefs.interval !== "live" && (
          <button
            type="button"
            className="lset-row hy-press"
            onClick={() => void savePendingInterval()}
            disabled={saving || !locationSettingsDataReady}
            aria-busy={savingAction === "return-live"}
          >
            <span className="lset-row__icon">
              <Radar size={18} strokeWidth={2.2} color="#2E86C1" />
            </span>
            <span className="lset-row__main">
              <span className="lset-row__title">실시간 모드 저장하기</span>
              <span className="lset-row__sub">결제 전 선택이에요. 아직 저장되지 않았어요.</span>
            </span>
            <ChevronRight size={18} strokeWidth={2.2} color="var(--fg-tertiary)" />
          </button>
        )}

        {/* 배터리 최적화 예외 */}
        <div className="lset-row">
          <span className="lset-row__icon">
            <BatteryCharging size={18} strokeWidth={2.2} color="#2E86C1" />
          </span>
          <span className="lset-row__main">
            <span className="lset-row__title">배터리 최적화 예외</span>
            <span className="lset-row__sub">아이 기기에서 직접 허용해야 적용돼요</span>
          </span>
          <button
            type="button"
            className="lset-toggle"
            role="switch"
            aria-checked={prefs.batterySaverException}
            aria-label="배터리 최적화 예외"
            data-on={prefs.batterySaverException}
            onClick={toggleBatteryException}
            disabled={saving || !locationSettingsDataReady}
            aria-busy={savingAction === "battery"}
          >
            <span className="lset-toggle__knob" />
          </button>
        </div>

        {/* 위치 기록 조회 범위 */}
        <button
          type="button"
          className="lset-row hy-press"
          onClick={openLocationHistory}
        >
          <span className="lset-row__icon">
            <History size={18} strokeWidth={2.2} color="#2E86C1" />
          </span>
          <span className="lset-row__main">
            <span className="lset-row__title">위치 기록 조회 범위</span>
            <span className="lset-row__sub">{retentionLabel}</span>
          </span>
          <ChevronRight size={18} strokeWidth={2.2} color="var(--fg-tertiary)" />
        </button>

        {/* 정직 안내 — 설명은 짧게 두 줄까지만(사실은 유지, 문장만 줄임). */}
        <p className="lset-note hy-explain">
          <span className="hy-explain__lines">
            <span className="hy-explain__line">{childName} 앱이 주기적으로 확인해서 반영해요.</span>
            <span className="hy-explain__line">권한·배터리 예외는 아이 기기에서 직접 허용해야 해요.</span>
          </span>
        </p>
      </div>
      <PremiumUpsell
        open={liveUpsellOpen}
        source="location_live_interval"
        tier={tier}
        returnTo="/location-settings"
        onClose={() => setLiveUpsellOpen(false)}
        onUpgrade={({ source, feature, returnTo }) => {
          const storage = browserPremiumReturnIntentStorage();
          const saved = storage && returnTo
            ? savePremiumReturnIntent(storage, {
                source,
                feature,
                returnTo,
                draft: { interval: "live" },
              })
            : false;
          if (!saved) throw new Error("선택한 위치 주기를 안전하게 보관하지 못했어요. 잠시 후 다시 시도해 주세요.");
          navigate("/subscription");
        }}
      />
      <PremiumUpsell
        open={historyUpsellOpen}
        source="location_history"
        tier={tier}
        returnTo="/parent/location?view=history"
        onClose={() => setHistoryUpsellOpen(false)}
        onUpgrade={({ source, feature, returnTo }) => {
          const storage = browserPremiumReturnIntentStorage();
          const saved = storage && returnTo
            ? savePremiumReturnIntent(storage, { source, feature, returnTo })
            : false;
          if (!saved) throw new Error("결제 후 위치 기록으로 돌아올 경로를 안전하게 보관하지 못했어요. 잠시 후 다시 시도해 주세요.");
          navigate("/subscription");
        }}
      />
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { ChevronLeft, ChevronRight, Check, Crown } from "lucide-react";
import { asset } from "@/lib/assets";
import { useIntl } from "react-intl";
import { useToast } from "@/app/toast";
import { useAuth } from "@/auth/AuthContext";
import { useActiveChild } from "@/app/activeChild";
import { useMyFamily } from "@/queries/useFamily";
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

const INTERVALS: { id: UpdateInterval; labelId: string }[] = [
  { id: "live", labelId: "notifications.locationSettings.interval.live" },
  { id: "balanced", labelId: "notifications.locationSettings.interval.balanced" },
  { id: "saver", labelId: "notifications.locationSettings.interval.saver" },
];

const INTERVAL_DESC_IDS: Record<UpdateInterval, string> = {
  live: "notifications.locationSettings.interval.liveDescription",
  balanced: "notifications.locationSettings.interval.balancedDescription",
  saver: "notifications.locationSettings.interval.saverDescription",
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
  const intl = useIntl();
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

  const childName = activeChild?.name?.trim() || intl.formatMessage({ id: "notifications.location.childFallback" });
  // i18n 회귀 불변식: deviceLocationHealthView(activeChild?.device_health)
  const childLocationHealth = deviceLocationHealthView(activeChild?.device_health, new Date(), intl);
  const childLocationTone = childLocationHealth.state === "ready"
    ? "safe"
    : childLocationHealth.state === "attention"
      ? "caution"
      : "neutral";

  // 이 화면의 권한 대상은 부모 iPhone이 아니라 활성 아이 Android다.
  // 진입 시 아이 기기에 최신 상태 보고를 요청하고, 응답은 기존 family realtime으로 반영한다.
  // 기기 상태 요청은 주 보호자만 보낼 수 있다(공동 보호자는 저장된 상태만 본다).
  const canRequestDeviceStatus = useMyFamily().data?.isPrimaryParent === true;
  useEffect(() => {
    if (!familyId || !activeChild?.user_id || !canRequestDeviceStatus) return;
    void requestDeviceStatus(familyId, activeChild.user_id);
  }, [familyId, activeChild?.user_id, canRequestDeviceStatus]);

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
      show(intl.formatMessage({ id: "notifications.locationSettings.toast.waitForServer" }), "⚠️");
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
      if (!savedPreferencesKey) {
        throw new Error(intl.formatMessage({ id: "notifications.locationSettings.error.familyScopeMismatch" }));
      }
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
      show(intl.formatMessage({ id: "notifications.locationSettings.toast.saveFailed" }), "⚠️");
      return false;
    } finally {
      setSavingAction(null);
    }
  };

  const toggleBackground = () => {
    void update(
      "background",
      { background: !prefs.background },
      intl.formatMessage({ id: "notifications.locationSettings.toast.appliesSoon" }),
      "📍",
    );
  };

  const toggleBatteryException = () => {
    void update(
      "battery",
      { batterySaverException: !prefs.batterySaverException },
      intl.formatMessage({ id: "notifications.locationSettings.toast.batterySaved" }),
      "🔋",
    );
  };

  const pickInterval = (interval: UpdateInterval) => {
    if (interval === selectedInterval) return;
    if (interval === "live" && tier !== TIERS.PREMIUM) {
      setLiveUpsellOpen(true);
      return;
    }
    setRestoredInterval(null);
    void update(`interval:${interval}`, { interval },
      intl.formatMessage({ id: "notifications.locationSettings.toast.intervalSaved" }),
      "⏱️",
    );
  };

  const savePendingInterval = async (): Promise<void> => {
    if (pendingInterval !== "live") return;
    const saved = await update("return-live", { interval: "live" },
      intl.formatMessage({ id: "notifications.locationSettings.toast.liveSaved" }),
      "⏱️",
    );
    if (saved) setRestoredInterval(null);
  };

  const openLocationHistory = (): void => {
    if (tier === TIERS.PREMIUM) {
      navigate("/parent/location?view=history");
      return;
    }
    setHistoryUpsellOpen(true);
  };

  // i18n 회귀 불변식: 최근 30일 (프리미엄 조회 범위) / 오늘 (무료 조회 범위)
  const retentionLabel = intl.formatMessage({
    id: isPremium
      ? "notifications.locationSettings.history.premiumRange"
      : "notifications.locationSettings.history.freeRange",
  });

  if (locationSettingsQueryState === "loading" || locationSettingsHydrating) {
    return (
      <ScreenQueryState
        screenTitle={intl.formatMessage({ id: "notifications.locationSettings.title" })}
        state="loading"
        heading={intl.formatMessage({ id: "notifications.locationSettings.loading.title" })}
        description={intl.formatMessage({ id: "notifications.locationSettings.loading.description" })}
        onBack={() => navigate(-1)}
      />
    );
  }

  if (locationSettingsQueryState === "error" || locationSettingsDataMissing) {
    return (
      <ScreenQueryState
        screenTitle={intl.formatMessage({ id: "notifications.locationSettings.title" })}
        state="error"
        heading={intl.formatMessage({ id: "notifications.locationSettings.error.title" })}
        description={intl.formatMessage({ id: "notifications.locationSettings.error.description" })}
        onBack={() => navigate(-1)}
        onRetry={() => void retryLocationSettings()}
        retrying={locationSettingsRefetching}
      />
    );
  }

  if (locationSettingsEmpty) {
    return (
      <ScreenQueryState
        screenTitle={intl.formatMessage({ id: "notifications.locationSettings.title" })}
        state="empty"
        heading={intl.formatMessage({ id: "notifications.locationSettings.empty.title" })}
        description={intl.formatMessage({ id: "notifications.locationSettings.empty.description" })}
        onBack={() => navigate(-1)}
        onRetry={() => navigate("/parent/family")}
        retryLabel={intl.formatMessage({ id: "notifications.locationSettings.empty.retry" })}
      />
    );
  }

  return (
    <div className="lset-screen">
      <header className="lset-header">
        <button type="button" className="lset-back hy-press" aria-label={intl.formatMessage({ id: "notifications.action.back" })} onClick={() => navigate(-1)}>
          <ChevronLeft size={22} strokeWidth={2.2} color="#4A4145" />
        </button>
        <span className="lset-title">{intl.formatMessage({ id: "notifications.locationSettings.title" })}</span>
      </header>

      <div className="lset-body">
        {/* 활성 아이 Android의 실제 위치 권한·서비스 보고 상태 */}
        <div className="lset-row" aria-live="polite">
          <span className="lset-row__icon">
            <img src={asset("ui/clay/background-location.webp")} alt="" />
          </span>
          <span className="lset-row__main">
            {/* i18n 회귀 불변식: 아이 기기 위치 상태 */}
            <span className="lset-row__title">{intl.formatMessage({ id: "notifications.locationSettings.deviceStatus" })}</span>
            <span className="lset-row__sub">
              {intl.formatMessage({ id: "notifications.locationSettings.childStatus" }, {
                childName,
                detail: childLocationHealth.detail,
              })}
            </span>
          </span>
          <span className={`lset-chip lset-chip--${childLocationTone}`}>
            {childLocationHealth.shortLabel}
          </span>
        </div>

        {/* 백그라운드 위치 전송 */}
        <div className="lset-row">
          <span className="lset-row__icon">
            <img src={asset("ui/clay/location.webp")} alt="" />
          </span>
          <span className="lset-row__main">
            <span className="lset-row__title">{intl.formatMessage({ id: "notifications.locationSettings.background.title" })}</span>
            <span className="lset-row__sub">{intl.formatMessage({ id: "notifications.locationSettings.background.description" })}</span>
          </span>
          <button
            type="button"
            className="lset-toggle"
            role="switch"
            aria-checked={prefs.background}
            aria-label={intl.formatMessage({ id: "notifications.locationSettings.background.title" })}
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
          <div className="lset-flabel">{intl.formatMessage({ id: "notifications.locationSettings.interval.title" })}</div>
          <div className="lset-seg">
            {INTERVALS.map((opt) => {
              const on = selectedInterval === opt.id;
              const optionLabel = intl.formatMessage({ id: opt.labelId });
              return (
                <button
                  key={opt.id}
                  type="button"
                  className="lset-seg__item hy-press"
                  data-on={on}
                  aria-pressed={on}
                  /* i18n 회귀 불변식: 실시간 위치 전송 (프리미엄) / 실시간 위치 전송 프리미엄 */
                  aria-label={opt.id === "live"
                    ? intl.formatMessage({ id: "notifications.locationSettings.interval.livePremiumAria" })
                    : optionLabel}
                  onClick={() => pickInterval(opt.id)}
                  disabled={saving || !locationSettingsDataReady}
                  aria-busy={savingAction === `interval:${opt.id}`}
                >
                  {on && <Check size={13} strokeWidth={3} className="lset-seg__check" />}
                  {optionLabel}
                  {opt.id === "live" && <Crown size={13} strokeWidth={2.3} aria-hidden="true" />}
                </button>
              );
            })}
          </div>
          <p className="lset-desc">{intl.formatMessage({ id: INTERVAL_DESC_IDS[selectedInterval] })}</p>
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
              <img src={asset("ui/clay/location.webp")} alt="" />
            </span>
            <span className="lset-row__main">
              <span className="lset-row__title">{intl.formatMessage({ id: "notifications.locationSettings.pendingLive.title" })}</span>
              {/* i18n 회귀 불변식: 아직 저장되지 않았어요 */}
              <span className="lset-row__sub">{intl.formatMessage({ id: "notifications.locationSettings.pendingLive.description" })}</span>
            </span>
            <ChevronRight size={18} strokeWidth={2.2} color="var(--fg-tertiary)" />
          </button>
        )}

        {/* 배터리 최적화 예외 */}
        <div className="lset-row">
          <span className="lset-row__icon">
            <img src={asset("ui/clay/battery.webp")} alt="" />
          </span>
          <span className="lset-row__main">
            <span className="lset-row__title">{intl.formatMessage({ id: "notifications.locationSettings.battery.title" })}</span>
            <span className="lset-row__sub">{intl.formatMessage({ id: "notifications.locationSettings.battery.description" })}</span>
          </span>
          <button
            type="button"
            className="lset-toggle"
            role="switch"
            aria-checked={prefs.batterySaverException}
            aria-label={intl.formatMessage({ id: "notifications.locationSettings.battery.title" })}
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
            <img src={asset("ui/clay/history.webp")} alt="" />
          </span>
          <span className="lset-row__main">
            {/* i18n 회귀 불변식: >위치 기록 조회 범위< */}
            <span className="lset-row__title">{intl.formatMessage({ id: "notifications.locationSettings.history.title" })}</span>
            <span className="lset-row__sub">{retentionLabel}</span>
          </span>
          <ChevronRight size={18} strokeWidth={2.2} color="var(--fg-tertiary)" />
        </button>

        {/* 정직 안내 — 설명은 짧게 두 줄까지만(사실은 유지, 문장만 줄임). */}
        <p className="lset-note hy-explain">
          <span className="hy-explain__lines">
            <span className="hy-explain__line">
              {intl.formatMessage({ id: "notifications.locationSettings.note.androidSync" }, { childName })}
            </span>
            {/* i18n 회귀 불변식: 아이 기기의 권한·배터리 예외는 아이 앱에서 직접 허용해야 해요 */}
            <span className="hy-explain__line">{intl.formatMessage({ id: "notifications.locationSettings.note.permissions" })}</span>
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
          if (!saved) throw new Error(intl.formatMessage({ id: "notifications.locationSettings.error.saveLiveReturn" }));
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
          if (!saved) throw new Error(intl.formatMessage({ id: "notifications.locationSettings.error.saveHistoryReturn" }));
          navigate("/subscription");
        }}
      />
    </div>
  );
}

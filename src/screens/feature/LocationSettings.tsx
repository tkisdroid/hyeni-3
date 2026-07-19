import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, MapPin, Check, Radar, BatteryCharging, History } from "lucide-react";
import { useToast } from "@/app/toast";
import { useAuth } from "@/auth/AuthContext";
import { useEntitlement } from "@/queries/useEntitlement";
import { useLocationPreferences, useSaveLocationPreferences } from "@/queries/useLocation";
import { isLocationTrackingSupported } from "@/lib/native/location";
import type { LocationIntervalMode, LocationPreferences } from "@/lib/api/endpoints/location";
import { ScreenQueryState } from "@/components/ui/ScreenQueryState";
import { resolveQueryTruthState } from "@/transform/queryTruthState";
import "./LocationSettings.css";

/**
 * P-31 위치·백그라운드 설정(부모).
 *
 * 서버 위치 prefs 를 가족 단위로 저장하고, 아이 안드로이드 기기가 주기적으로 읽어
 * LocationService 측위 간격에 반영한다. localStorage 는 서버 조회 전 화면 초기값용 캐시다.
 * 위치 권한 상태만 브라우저 Permissions API 로 실제 신호를 읽어 표시한다.
 */

type UpdateInterval = LocationIntervalMode;
type PermState = "granted" | "prompt" | "denied" | "unknown";

interface LocationPrefs {
  background: boolean;
  interval: UpdateInterval;
  batterySaverException: boolean;
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
  live: "실시간 모드: 위치를 가장 자주 전송해 가장 신선하지만 배터리 소모가 커요.",
  balanced: "균형 모드: 배터리와 정확도의 절충. 이동 시 자주, 정지 시 드물게 전송해요.",
  saver: "절약 모드: 배터리를 우선해 전송 간격을 늘려요. 위치가 다소 늦게 갱신될 수 있어요.",
};

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

const PERM_LABEL: Record<PermState, { text: string; tone: "safe" | "caution" | "neutral" }> = {
  granted: { text: "허용됨", tone: "safe" },
  prompt: { text: "요청 필요", tone: "caution" },
  denied: { text: "꺼짐", tone: "caution" },
  unknown: { text: "확인 불가", tone: "neutral" },
};

export function LocationSettings() {
  const navigate = useNavigate();
  const { show } = useToast();
  const { familyId } = useAuth();
  const entitlementQuery = useEntitlement();
  const preferencesQuery = useLocationPreferences();
  const savePreferences = useSaveLocationPreferences();
  const { isPremium } = entitlementQuery;
  const [prefs, setPrefs] = useState<LocationPrefs>(loadPrefs);
  const [hydratedFamilyId, setHydratedFamilyId] = useState<string | null>(null);
  const [hydratedPreferencesKey, setHydratedPreferencesKey] = useState<string | null>(null);
  const [perm, setPerm] = useState<PermState>("unknown");
  const [saving, setSaving] = useState(false);
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
  const retryLocationSettings = async (): Promise<void> => {
    await Promise.all([preferencesQuery.refetch(), entitlementQuery.refetch()]);
  };

  const nativeSupported = isLocationTrackingSupported();

  // 브라우저 Permissions API 로 위치 권한 상태 조회(실 신호). 미지원 시 unknown 유지.
  const refreshPermission = useCallback(() => {
    if (!("permissions" in navigator) || !navigator.permissions?.query) {
      setPerm("unknown");
      return;
    }
    navigator.permissions
      .query({ name: "geolocation" as PermissionName })
      .then((statusResult) => {
        setPerm(statusResult.state as PermState);
        statusResult.onchange = () => setPerm(statusResult.state as PermState);
      })
      .catch(() => setPerm("unknown"));
  }, []);

  useEffect(() => {
    refreshPermission();
  }, [refreshPermission]);

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
    setHydratedFamilyId(familyId);
    setHydratedPreferencesKey(serverPreferencesKey);
  }, [familyId, preferencesQuery.data, serverPreferencesKey]);

  const update = async (patch: Partial<LocationPrefs>, message: string, icon: string) => {
    const updateFamilyId = familyId;
    if (!updateFamilyId || !locationSettingsDataReady || saving || savePreferences.isPending) {
      show("서버의 위치 설정을 확인한 뒤 다시 시도해 주세요", "⚠️");
      return;
    }
    const next = { ...prefs, ...patch };
    setSaving(true);
    try {
      const saved = await savePreferences.mutateAsync({
        familyId: updateFamilyId,
        prefs: {
          background_enabled: next.background,
          interval_mode: next.interval,
          battery_saver_exception: next.batterySaverException,
        },
      });
      if (currentFamilyIdRef.current !== updateFamilyId) return;
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
    } catch (error) {
      console.error("위치 설정 저장 실패:", error);
      show("위치 설정 저장에 실패했어요. 잠시 후 다시 시도해 주세요", "⚠️");
    } finally {
      setSaving(false);
    }
  };

  const toggleBackground = () => {
    void update({ background: !prefs.background }, "아이 기기에 곧 반영돼요", "📍");
  };

  const toggleBatteryException = () => {
    void update({ batterySaverException: !prefs.batterySaverException }, "배터리 설정 선호를 저장했어요", "🔋");
  };

  const pickInterval = (interval: UpdateInterval) => {
    if (interval === prefs.interval) return;
    void update({ interval }, "업데이트 주기를 저장했어요. 아이 기기에 곧 반영돼요", "⏱️");
  };

  // 권한 요청: 웹은 getCurrentPosition 으로 OS 권한 프롬프트를 띄운다(실 동작).
  const requestPermission = () => {
    if (perm === "granted") return;
    if (!("geolocation" in navigator)) {
      show("이 기기에서는 위치 권한을 확인할 수 없어요", "📍");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      () => {
        refreshPermission();
        show("위치 권한을 허용했어요", "✅");
      },
      () => {
        refreshPermission();
        show("위치 권한이 거부됐어요. 기기 설정에서 허용해 주세요", "⚠️");
      },
      { enableHighAccuracy: false, timeout: 8000 },
    );
  };

  const permView = PERM_LABEL[perm];
  const retentionLabel = isPremium ? "30일 (프리미엄)" : "7일 (무료)";

  if (locationSettingsQueryState === "loading" || locationSettingsHydrating) {
    return (
      <ScreenQueryState
        screenTitle="위치 · 백그라운드"
        state="loading"
        heading="위치 설정을 확인하고 있어요"
        description="아이 기기에 적용할 전송 주기와 이용 범위를 불러오는 중이에요."
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
        description="기기에 남은 값이 서버 설정을 덮어쓰지 않도록 변경 기능을 닫았어요."
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
        description="가족을 연결한 뒤 아이 기기에 적용할 위치 설정을 관리할 수 있어요."
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
        {/* 위치 권한 */}
        <button
          type="button"
          className="lset-row hy-press"
          onClick={requestPermission}
          disabled={perm === "granted"}
        >
          <span className="lset-row__icon">
            <MapPin size={18} strokeWidth={2.2} color="#2E86C1" />
          </span>
          <span className="lset-row__main">
            <span className="lset-row__title">이 휴대폰의 위치 권한</span>
            <span className="lset-row__sub">
              {perm === "granted"
                ? "이 휴대폰에서 위치를 사용할 수 있어요"
                : perm === "unknown"
                  ? "이 기기에서 상태를 확인할 수 없어요"
                  : "탭하면 이 휴대폰의 권한을 요청해요"}
            </span>
          </span>
          <span className={`lset-chip lset-chip--${permView.tone}`}>{permView.text}</span>
        </button>

        {/* 백그라운드 위치 전송 */}
        <div className="lset-row">
          <span className="lset-row__icon">
            <Radar size={18} strokeWidth={2.2} color="#2E86C1" />
          </span>
          <span className="lset-row__main">
            <span className="lset-row__title">백그라운드 위치 전송</span>
            <span className="lset-row__sub">앱을 닫아도 위치를 전송해요</span>
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
          >
            <span className="lset-toggle__knob" />
          </button>
        </div>

        {/* 업데이트 주기 */}
        <div className="lset-field">
          <div className="lset-flabel">업데이트 주기</div>
          <div className="lset-seg">
            {INTERVALS.map((opt) => {
              const on = prefs.interval === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  className="lset-seg__item hy-press"
                  data-on={on}
                  onClick={() => pickInterval(opt.id)}
                  disabled={saving || !locationSettingsDataReady}
                >
                  {on && <Check size={13} strokeWidth={3} className="lset-seg__check" />}
                  {opt.label}
                </button>
              );
            })}
          </div>
          <p className="lset-desc">{INTERVAL_DESC[prefs.interval]}</p>
        </div>

        {/* 배터리 최적화 예외 */}
        <div className="lset-row">
          <span className="lset-row__icon">
            <BatteryCharging size={18} strokeWidth={2.2} color="#2E86C1" />
          </span>
          <span className="lset-row__main">
            <span className="lset-row__title">배터리 최적화 예외</span>
            <span className="lset-row__sub">아이 기기에서 직접 허용해야 최종 적용돼요</span>
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
          >
            <span className="lset-toggle__knob" />
          </button>
        </div>

        {/* 위치 히스토리 보관 */}
        <button
          type="button"
          className="lset-row hy-press"
          onClick={() => navigate("/subscription")}
        >
          <span className="lset-row__icon">
            <History size={18} strokeWidth={2.2} color="#2E86C1" />
          </span>
          <span className="lset-row__main">
            <span className="lset-row__title">위치 히스토리 보관</span>
            <span className="lset-row__sub">{retentionLabel}</span>
          </span>
          <ChevronRight size={18} strokeWidth={2.2} color="var(--fg-tertiary)" />
        </button>

        {/* 정직 안내 */}
        <p className="lset-note">
          {nativeSupported
            ? "저장한 주기·백그라운드 설정은 아이 안드로이드 앱이 주기적으로 확인해 반영해요."
            : "위치 전송은 아이 안드로이드 앱에서 동작해요. 저장한 설정은 아이 앱이 주기적으로 확인해 반영해요."}
          {" "}이 화면의 위치 권한은 현재 휴대폰 기준이며, 아이 기기 권한과 배터리 예외는 아이 앱에서 직접 허용해야 해요.
        </p>
      </div>
    </div>
  );
}

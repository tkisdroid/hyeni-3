import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, MapPin, Check } from "lucide-react";
import { useToast } from "@/app/toast";
import { useEntitlement } from "@/queries/useEntitlement";
import { isLocationTrackingSupported } from "@/lib/native/location";
import "./LocationSettings.css";

/**
 * P-31 위치·백그라운드 설정(부모).
 *
 * 서버에 위치 prefs 를 저장하는 엔드포인트가 없다(WIREFRAME 백엔드 부재 목록:
 * "위치 백그라운드 설정 서버저장"). → 설정은 이 기기 localStorage 에만 보관하고,
 * 아이 기기 반영/서버 동기화가 준비 중임을 정직하게 안내한다.
 * 위치 권한 상태만 브라우저 Permissions API 로 실제 신호를 읽어 표시한다.
 */

type UpdateInterval = "live" | "balanced" | "saver";
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

const PERM_LABEL: Record<PermState, { text: string; tone: "safe" | "caution" | "neutral" }> = {
  granted: { text: "항상 허용", tone: "safe" },
  prompt: { text: "요청 필요", tone: "caution" },
  denied: { text: "꺼짐", tone: "caution" },
  unknown: { text: "확인 불가", tone: "neutral" },
};

export function LocationSettings() {
  const navigate = useNavigate();
  const { show } = useToast();
  const { isPremium, ready } = useEntitlement();

  const [prefs, setPrefs] = useState<LocationPrefs>(loadPrefs);
  const [perm, setPerm] = useState<PermState>("unknown");

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

  // 로컬 저장(불변 업데이트) + 아이 기기 반영은 준비 중임을 정직 안내.
  const update = (patch: Partial<LocationPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      savePrefs(next);
      return next;
    });
  };

  const toggleBackground = () => {
    update({ background: !prefs.background });
    show("이 기기에 저장했어요 · 아이 기기 반영은 준비 중이에요", "📍");
  };

  const toggleBatteryException = () => {
    update({ batterySaverException: !prefs.batterySaverException });
    show("이 기기에 저장했어요", "🔋");
  };

  const pickInterval = (interval: UpdateInterval) => {
    if (interval === prefs.interval) return;
    update({ interval });
    show("업데이트 주기를 저장했어요 · 아이 기기 반영은 준비 중", "⏱️");
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
  const retentionLabel = !ready ? "확인 중" : isPremium ? "30일 (프리미엄)" : "7일 (무료)";

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
            <span className="lset-row__title">위치 권한</span>
            <span className="lset-row__sub">
              {perm === "granted"
                ? "항상 허용됨"
                : perm === "unknown"
                  ? "이 기기에서 상태를 확인할 수 없어요"
                  : "탭하면 권한을 요청해요"}
            </span>
          </span>
          <span className={`lset-chip lset-chip--${permView.tone}`}>{permView.text}</span>
        </button>

        {/* 백그라운드 위치 전송 */}
        <div className="lset-row">
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
          <span className="lset-row__main">
            <span className="lset-row__title">배터리 최적화 예외</span>
            <span className="lset-row__sub">권장 · 안정적 전송</span>
          </span>
          <button
            type="button"
            className="lset-toggle"
            role="switch"
            aria-checked={prefs.batterySaverException}
            aria-label="배터리 최적화 예외"
            data-on={prefs.batterySaverException}
            onClick={toggleBatteryException}
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
          <span className="lset-row__main">
            <span className="lset-row__title">위치 히스토리 보관</span>
            <span className="lset-row__sub">{retentionLabel}</span>
          </span>
          <ChevronRight size={18} strokeWidth={2.2} color="var(--fg-tertiary)" />
        </button>

        {/* 정직 안내 */}
        <p className="lset-note">
          {nativeSupported
            ? "주기·백그라운드 설정을 아이 기기에 자동 반영하는 서버 연동은 준비 중이에요. 지금은 이 기기에만 저장돼요."
            : "위치 전송은 아이 안드로이드 앱에서 동작해요. 이 화면의 설정은 이 기기에만 저장되며, 아이 기기 반영 서버 연동은 준비 중이에요."}
        </p>
      </div>
    </div>
  );
}

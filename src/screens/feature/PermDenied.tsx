import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { MapPin, Bell, BatteryCharging, Mic } from "lucide-react";
import type { ReactNode } from "react";
import { isNativePlatform } from "@/lib/native/plugins";
import {
  readPermissionState,
  requestOrOpenPermission,
  type PermissionKind,
  type PermissionState,
} from "@/lib/native/permissions";
import "./PermDenied.css";

// 아이콘 색은 토큰 사용(하드코딩 hex 금지 — 온보딩 신뢰 순간의 화면).
const COPY: Record<PermissionKind, { icon: ReactNode; title: string; sub: string }> = {
  loc: {
    icon: <MapPin size={24} strokeWidth={2.2} color="var(--blue-500)" />,
    title: "위치 권한이 필요해요",
    sub: "아이 위치와 도착·출발 알림에 사용해요.",
  },
  noti: {
    icon: <Bell size={24} strokeWidth={2.2} color="var(--gold-text)" />,
    title: "알림 권한이 필요해요",
    sub: "일정·도착·안전 소식을 알려드려요.",
  },
  battery: {
    icon: <BatteryCharging size={24} strokeWidth={2.2} color="var(--mint-600)" />,
    title: "백그라운드 실행이 필요해요",
    sub: "앱을 닫아도 위치 알림이 이어지도록 설정해 주세요.",
  },
  mic: {
    icon: <Mic size={24} strokeWidth={2.2} color="var(--lav-500)" />,
    title: "마이크 권한이 필요해요",
    sub: "주변 소리 듣기를 사용할 때 필요해요.",
  },
};

/** C-15 권한 없음(재요청). OS 설정에서 허용 안내 + 복귀 시 자동 재확인. */
export function PermDenied() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const kind: PermissionKind = (state as { kind?: PermissionKind } | null)?.kind ?? "loc";
  const c = COPY[kind];
  const [permission, setPermission] = useState<PermissionState | null>(null);
  const [busy, setBusy] = useState(false);

  const recheck = useCallback(async () => {
    const result = await readPermissionState(kind);
    setPermission(result);
    if (result.granted) navigate(-1);
    return result;
  }, [kind, navigate]);

  // 설정에서 복귀해도 실제 권한이 granted일 때만 이전 흐름으로 돌아간다.
  useEffect(() => {
    let disposed = false;
    let appListener: { remove(): Promise<void> } | null = null;
    const check = async () => {
      const result = await readPermissionState(kind);
      if (disposed) return;
      setPermission(result);
      if (result.granted) navigate(-1);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void check();
    };
    void check();
    document.addEventListener("visibilitychange", onVisibility);
    if (isNativePlatform()) {
      void import("@capacitor/app")
        .then(async ({ App }) => {
          const listener = await App.addListener("appStateChange", (next) => {
            if (next.isActive) void check();
          });
          if (disposed) await listener.remove();
          else appListener = listener;
        })
        .catch((error: unknown) => {
          console.error("[permission] 앱 복귀 권한 확인 등록 실패:", error);
        });
    }
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void appListener?.remove();
    };
  }, [kind, navigate]);

  const requestAccess = async () => {
    if (busy) return;
    setBusy(true);
    const result = await requestOrOpenPermission(kind);
    setPermission(result);
    setBusy(false);
    if (result.granted) navigate(-1);
  };

  return (
    <div className="pd-root">
      <div className="pd-card">
        <span className="pd-icon">{c.icon}</span>
        <div className="pd-title">{c.title}</div>
        <div className="pd-sub">{c.sub}</div>
        <div className="pd-steps">
          {kind === "battery" && isNativePlatform()
            ? "혜니캘린더 → 제한 없음(또는 최적화 안 함)"
            : isNativePlatform()
            ? "설정 → 앱 → 혜니캘린더 → 권한"
            : "주소창 자물쇠 → 사이트 설정 → 허용"}
        </div>
        {permission?.supported === false && !isNativePlatform() && (
          <div className="pd-steps">이 브라우저에서는 자동 확인이 어려워요.</div>
        )}
        <button
          type="button"
          className="pd-cta hy-press"
          onClick={requestAccess}
          disabled={busy}
        >
          {busy ? "확인 중…" : isNativePlatform() ? "설정 열기" : "권한 요청"}
        </button>
        <button type="button" className="pd-recheck hy-press" onClick={() => void recheck()}>
          다시 확인
        </button>
      </div>
    </div>
  );
}

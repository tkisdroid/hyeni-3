import { useCallback, useEffect, useState } from "react";
import { useIntl } from "react-intl";
import { useLocation, useNavigate } from "react-router";
import { MapPin, Bell, BatteryCharging, Mic } from "lucide-react";
import type { ReactNode } from "react";
import { useAuth } from "@/auth/AuthContext";
import { isNativePlatform } from "@/lib/native/plugins";
import {
  readPermissionState,
  requestOrOpenPermission,
  type PermissionKind,
  type PermissionState,
} from "@/lib/native/permissions";
import "./PermDenied.css";

// 아이콘 색은 토큰 사용(하드코딩 hex 금지 — 온보딩 신뢰 순간의 화면).
const PERMISSION_ICONS: Record<PermissionKind, ReactNode> = {
  loc: <MapPin size={24} strokeWidth={2.2} color="var(--blue-500)" />,
  noti: <Bell size={24} strokeWidth={2.2} color="var(--gold-text)" />,
  battery: <BatteryCharging size={24} strokeWidth={2.2} color="var(--mint-text)" />,
  mic: <Mic size={24} strokeWidth={2.2} color="var(--lav-500)" />,
};

const PERMISSION_COPY_IDS: Record<PermissionKind, {
  childTitle: string;
  formalTitle: string;
  childDescription: string;
  formalDescription: string;
}> = {
  loc: {
    childTitle: "shared.permDenied.loc.title.child",
    formalTitle: "shared.permDenied.loc.title.formal",
    childDescription: "shared.permDenied.loc.description.child",
    formalDescription: "shared.permDenied.loc.description.formal",
  },
  noti: {
    childTitle: "shared.permDenied.notification.title.child",
    formalTitle: "shared.permDenied.notification.title.formal",
    childDescription: "shared.permDenied.notification.description.child",
    formalDescription: "shared.permDenied.notification.description.formal",
  },
  battery: {
    childTitle: "shared.permDenied.battery.title.child",
    formalTitle: "shared.permDenied.battery.title.formal",
    childDescription: "shared.permDenied.battery.description.child",
    formalDescription: "shared.permDenied.battery.description.formal",
  },
  mic: {
    childTitle: "shared.permDenied.microphone.title.child",
    formalTitle: "shared.permDenied.microphone.title.formal",
    childDescription: "shared.permDenied.microphone.description.child",
    formalDescription: "shared.permDenied.microphone.description.formal",
  },
};

/** C-15 권한 없음(재요청). OS 설정에서 허용 안내 + 복귀 시 자동 재확인. */
export function PermDenied() {
  const intl = useIntl();
  const navigate = useNavigate();
  const { role } = useAuth();
  const { state } = useLocation();
  const kind: PermissionKind = (state as { kind?: PermissionKind } | null)?.kind ?? "loc";
  const childTone = role === "child";
  const copyIds = PERMISSION_COPY_IDS[kind];
  const nativePlatform = isNativePlatform();
  const message = (childId: string, formalId: string): string => intl.formatMessage({
    id: childTone ? childId : formalId,
  });
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
    if (nativePlatform) {
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
  }, [kind, nativePlatform, navigate]);

  const requestAccess = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await requestOrOpenPermission(kind);
      setPermission(result);
      if (result.granted) navigate(-1);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pd-root">
      <div
        className="pd-card"
        aria-label={message(
          "shared.permDenied.screenLabel.child",
          "shared.permDenied.screenLabel.formal",
        )}
      >
        <span className="pd-icon">{PERMISSION_ICONS[kind]}</span>
        <div className="pd-title">
          {message(copyIds.childTitle, copyIds.formalTitle)}
        </div>
        <div className="pd-sub">
          {message(copyIds.childDescription, copyIds.formalDescription)}
        </div>
        <div className="pd-steps">
          {intl.formatMessage({
            id: kind === "battery" && nativePlatform
              ? "shared.permDenied.steps.batteryNative"
              : nativePlatform
                ? "shared.permDenied.steps.permissionNative"
                : "shared.permDenied.steps.web",
          })}
        </div>
        <div className="pd-steps">
          {nativePlatform
            ? message(
                "shared.permDenied.limit.native.child",
                "shared.permDenied.limit.native.formal",
              )
            : message(
                "shared.permDenied.limit.web.child",
                "shared.permDenied.limit.web.formal",
              )}
        </div>
        {permission?.supported === false && !nativePlatform && (
          <div className="pd-steps">
            {message(
              "shared.permDenied.unsupportedBrowser.child",
              "shared.permDenied.unsupportedBrowser.formal",
            )}
          </div>
        )}
        <button
          type="button"
          className="pd-cta hy-press"
          onClick={requestAccess}
          disabled={busy} aria-busy={busy}
        >
          {busy
            ? message(
                "shared.permDenied.action.checking.child",
                "shared.permDenied.action.checking.formal",
              )
            : nativePlatform
              ? message(
                  "shared.permDenied.action.openSettings.child",
                  "shared.permDenied.action.openSettings.formal",
                )
              : message(
                  "shared.permDenied.action.request.child",
                  "shared.permDenied.action.request.formal",
                )}
        </button>
        <button type="button" className="pd-recheck hy-press" onClick={() => void recheck()}>
          {message(
            "shared.permDenied.action.recheck.child",
            "shared.permDenied.action.recheck.formal",
          )}
        </button>
      </div>
    </div>
  );
}

import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { MapPin, Bell, BatteryCharging, Mic } from "lucide-react";
import type { ReactNode } from "react";
import { isNativePlatform } from "@/lib/native/plugins";
import "./PermDenied.css";

type PermKind = "loc" | "noti" | "battery" | "mic";

const COPY: Record<PermKind, { icon: ReactNode; title: string; sub: string }> = {
  loc: {
    icon: <MapPin size={26} strokeWidth={2.2} color="#2E86C1" />,
    title: "위치 권한이 필요해요",
    sub: "우리 아이가 어디서 안전한지 확인하려면 위치 접근을 허용해 주세요.",
  },
  noti: {
    icon: <Bell size={26} strokeWidth={2.2} color="#B26A00" />,
    title: "알림 권한이 필요해요",
    sub: "등하교·도착·안전 소식을 제때 받으려면 알림을 허용해 주세요.",
  },
  battery: {
    icon: <BatteryCharging size={26} strokeWidth={2.2} color="#087653" />,
    title: "백그라운드 실행이 필요해요",
    sub: "앱이 꺼져 있어도 위치를 지키려면 배터리 최적화 예외를 허용해 주세요.",
  },
  mic: {
    icon: <Mic size={26} strokeWidth={2.2} color="#8b6bec" />,
    title: "마이크 권한이 필요해요",
    sub: "주변 소리 듣기 기능을 쓰려면 마이크 접근을 허용해 주세요.",
  },
};

/** C-15 권한 없음(재요청). OS 설정에서 허용 안내 + 복귀 시 자동 재확인. */
export function PermDenied() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const kind: PermKind = (state as { kind?: PermKind } | null)?.kind ?? "loc";
  const c = COPY[kind];

  // 설정에서 허용 후 앱으로 복귀하면 자동으로 이전 흐름으로 되돌아가 재확인시킨다.
  useEffect(() => {
    const recheck = () => {
      if (document.visibilityState === "visible") navigate(-1);
    };
    document.addEventListener("visibilitychange", recheck);
    return () => document.removeEventListener("visibilitychange", recheck);
  }, [navigate]);

  return (
    <div className="pd-root">
      <div className="pd-card">
        <span className="pd-icon">{c.icon}</span>
        <div className="pd-title">{c.title}</div>
        <div className="pd-sub">{c.sub}</div>
        <div className="pd-steps">
          {isNativePlatform()
            ? "휴대폰 설정 → 앱 → 혜니캘린더 → 권한 에서 허용으로 바꿔 주세요."
            : "브라우저 주소창의 자물쇠 아이콘 → 사이트 설정 에서 허용으로 바꿔 주세요."}
        </div>
        <button type="button" className="pd-cta hy-press" onClick={() => navigate(-1)}>
          허용했어요 · 다시 확인
        </button>
      </div>
    </div>
  );
}

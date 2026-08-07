import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import "./OfflineBanner.css";

/**
 * C-13 오프라인 배너. 네트워크가 끊기면 상단에 지속 배너로 알린다.
 * 앱 최상위에 1회 마운트(App). 온라인이면 아무것도 렌더하지 않는다.
 */
export function OfflineBanner() {
  const { role } = useAuth();
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  if (online) return null;

  return (
    <div className="ofb-root" role="status">
      <WifiOff size={16} strokeWidth={2.4} />
      <span className="ofb-text">
        {role === "child"
          ? "오프라인 상태야 · 연결 후 다시 시도해 줘"
          : "오프라인 상태예요 · 연결 후 다시 시도해 주세요"}
      </span>
    </div>
  );
}

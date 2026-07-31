import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronLeft, RefreshCw, TriangleAlert } from "lucide-react";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { useAuth } from "@/auth/AuthContext";
import { useChildLocations } from "@/queries/useLocation";
import { formatFreshness } from "@/transform/locationView";
import { Loading } from "@/components/ui/Loading";
import {
  isLocationTrackingSupported,
  requestImmediateLocation,
  startLocationTracking,
} from "@/lib/native/location";
import "./ChildLocationStatus.css";

/**
 * K-03 위치 전송 상태(아이). 반말 톤.
 *
 * "내 위치가 지금 부모님께 보내지고 있는지"를 아이가 안심할 수 있게 보여준다.
 * - 전송중(안심) · 꺼짐(켜기 유도) · 권한필요(켜기 안내) 3상태.
 * - 실 신호: useChildLocations(본인 행) 신선도 + 브라우저 위치 권한 상태.
 * - 켜기: 네이티브(안드로이드)면 즉시 위치요청 + 백그라운드 서비스 시작, 웹이면 권한 프롬프트.
 */

type PermState = "granted" | "prompt" | "denied" | "unknown";
type Kind = "sending" | "off" | "permission";

interface View {
  kind: Kind;
  tone: "mint" | "caution";
  mascot: string;
  title: string;
  desc: string;
}

export function ChildLocationStatus() {
  const navigate = useNavigate();
  const { show } = useToast();
  const { userId, familyId } = useAuth();
  const { data: locations, refetch, isFetching, isLoading, isError } = useChildLocations();

  const [perm, setPerm] = useState<PermState>("unknown");
  const [working, setWorking] = useState(false);

  const now = useMemo(() => new Date(), [locations]);
  const nativeSupported = isLocationTrackingSupported();

  // 내 위치 행(본인 user_id). 아이 세션에서도 가족 접근 권한으로 조회된다.
  const myLoc = useMemo(() => {
    if (!locations || !userId) return null;
    return locations.find((l) => l.user_id === userId) ?? null;
  }, [locations, userId]);
  const location = myLoc;
  const refetchLocation = async () => {
    await refetch();
  };

  const fresh = myLoc ? formatFreshness(myLoc.updated_at, now) : null;
  const isFreshEnough = fresh != null && fresh.status !== "stale";

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

  // 상태 판정: 최신 위치 있으면 전송중, 아니면 권한 거부→권한필요 / 그 외→꺼짐.
  const kind: Kind = isFreshEnough ? "sending" : perm === "denied" ? "permission" : "off";

  const views: Record<Kind, View> = {
    sending: {
      kind: "sending",
      tone: "mint",
      mascot: asset("status/safe.webp"),
      title: "위치 보내는 중",
      desc: "엄마·아빠가 네가 안전한지 볼 수 있어. 걱정 마!",
    },
    off: {
      kind: "off",
      tone: "caution",
      mascot: asset("mascot/thinking.webp"),
      title: "위치가 아직 안 보내지고 있어",
      desc: nativeSupported
        ? "아래 버튼을 누르면 지금 위치를 보낼 수 있어."
        : "휴대폰 앱에서 위치가 자동으로 보내져. 지금 한 번 확인해 볼래?",
    },
    permission: {
      kind: "permission",
      tone: "caution",
      mascot: asset("mascot/thinking.webp"),
      title: "위치 권한이 꺼져 있어",
      desc: "위치를 켜야 엄마·아빠가 네가 어디 있는지 알 수 있어.",
    },
  };
  const view = views[kind];

  // 위치 켜기 / 새로고침. 네이티브면 실제 전송·서비스 시작, 웹이면 권한 프롬프트.
  const turnOn = async () => {
    if (working) return;
    setWorking(true);
    try {
      const ctx = { familyId: familyId ?? "", userId: userId ?? "", role: "child" as const };
      if (nativeSupported) {
        await requestImmediateLocation(ctx);
        await startLocationTracking(ctx);
        await refetch();
        show("위치를 보냈어!", "📍");
      } else if ("geolocation" in navigator) {
        // 웹: OS 권한 프롬프트를 띄우고 상태를 갱신(백그라운드 전송은 앱에서 동작).
        await new Promise<void>((resolve) => {
          navigator.geolocation.getCurrentPosition(
            () => {
              show("위치를 확인했어!", "📍");
              resolve();
            },
            () => {
              show("위치를 못 켰어. 휴대폰 설정에서 위치를 켜 줘", "⚠️");
              resolve();
            },
            { enableHighAccuracy: true, timeout: 8000 },
          );
        });
        refreshPermission();
        await refetch();
      } else {
        show("이 기기에서는 위치를 켤 수 없어", "⚠️");
      }
    } catch (error) {
      console.error("위치 켜기 실패:", error);
      show("위치를 켜지 못했어. 다시 해 볼래?", "⚠️");
    } finally {
      setWorking(false);
    }
  };

  const busy = working || isFetching;
  const handlePrimaryAction = () => {
    if (view.kind === "permission") {
      navigate("/perm-denied", { state: { kind: "loc" } });
      return;
    }
    void turnOn();
  };

  return (
    <div className={`cls-screen cls-screen--${view.tone}`}>
      <header className="cls-header">
        <button type="button" className="cls-back hy-press" aria-label="뒤로" onClick={() => navigate(-1)}>
          <ChevronLeft size={22} strokeWidth={2.2} color="#4A4145" />
        </button>
        <span className="cls-title">내 위치</span>
      </header>

      {isLoading ? (
        <div className="cls-body" role="status">
          <div className="cls-heading"><Loading label="내 위치를 확인하는 중이야" /></div>
        </div>
      ) : isError ? (
        <div className="cls-body" role="alert">
          <div className="cls-heading">
            <div className="cls-heading__title">위치 상태를 못 불러왔어</div>
            <div className="cls-heading__desc">인터넷을 확인하고 다시 눌러줘.</div>
          </div>
          <button type="button" className="cls-cta hy-press" onClick={() => void refetchLocation()}>
            <RefreshCw size={18} strokeWidth={2.4} /> 다시 불러오기
          </button>
        </div>
      ) : (
      <div className="cls-body">
        {!location && <div className="cls-heading__desc" role="status">아직 보낸 위치가 없어.</div>}
        {location && <span className="sr-only">최근 위치 상태 확인됨</span>}
        {/* 상태 마스코트 */}
        <div className={`cls-orb cls-orb--${view.tone}`}>
          {view.kind === "sending" && <span className="cls-live" aria-hidden="true" />}
          <img className="cls-orb__img" src={view.mascot} alt="" />
        </div>

        {/* 제목 · 설명 */}
        <div className="cls-heading">
          <div className={`cls-heading__title cls-heading__title--${view.tone}`}>{view.title}</div>
          <div className="cls-heading__desc">{view.desc}</div>
        </div>

        {/* 상태 상세 행 */}
        <div className={`cls-detail cls-detail--${view.tone}`}>
          <span className="cls-detail__icon" aria-hidden="true">
            {view.kind === "sending"
              ? <Check size={18} strokeWidth={2.4} />
              : <TriangleAlert size={18} strokeWidth={2.4} />}
          </span>
          <div className="cls-detail__main">
            <div className="cls-detail__title">
              {view.kind === "sending" ? "위치 켜짐 · 배터리 아껴 전송" : "위치 전송을 켜 줘"}
            </div>
            <div className="cls-detail__sub">
              {view.kind === "sending"
                ? `${fresh?.label ?? "방금 전"} 업데이트`
                : myLoc
                  ? `마지막 확인 ${fresh?.label ?? "-"}`
                  : "아직 위치를 보낸 적이 없어"}
            </div>
          </div>
        </div>

        {/* 켜기 / 새로고침 */}
        <button type="button" className="cls-cta hy-press hy-busy-quiet" onClick={handlePrimaryAction} disabled={busy} aria-busy={busy}>
          <RefreshCw size={18} strokeWidth={2.4} className={busy ? "cls-spin" : undefined} />
          {busy ? "확인 중…" : view.kind === "sending" ? "지금 새로고침" : "위치 켜기"}
        </button>
      </div>
      )}
    </div>
  );
}

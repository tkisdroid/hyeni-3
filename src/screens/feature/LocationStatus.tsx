import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, RefreshCw, Check, AlertTriangle, MapPin } from "lucide-react";
import { useToast } from "@/app/toast";
import { useMyFamily } from "@/queries/useFamily";
import { useChildLocations, useSavedPlaces } from "@/queries/useLocation";
import { formatFreshness, placeLabel } from "@/transform/locationView";
import "./LocationStatus.css";

type StatusKind = "loading" | "success" | "error" | "permission";

interface StatusView {
  kind: StatusKind;
  icon: ReactNode;
  title: string;
  sub: string;
  tone: "mint" | "caution" | "neutral";
}

/** P-15 위치 갱신 상태. 갱신중 · 성공 · 실패(재시도) · 권한필요 4상태 + 마지막 known 위치 유지. */
export function LocationStatus() {
  const navigate = useNavigate();
  const { show } = useToast();
  const { data: family } = useMyFamily();
  const { data: locations, refetch, isFetching, isError } = useChildLocations();
  const { data: places } = useSavedPlaces();

  const [refreshing, setRefreshing] = useState(false);

  const now = useMemo(() => new Date(), [locations]);
  const childMember = family?.members.find((m) => m.role === "child") ?? null;
  const childName = childMember?.name || "아이";
  const loc = childMember?.user_id
    ? locations?.find((l) => l.user_id === childMember.user_id) ?? null
    : locations?.[0] ?? null;

  const fresh = loc ? formatFreshness(loc.updated_at, now) : null;
  const lastPlace = loc && places ? placeLabel(loc, places) : null;

  // 상태 판정: 수동 갱신중/최초로딩 → loading, 에러 → error, 최신 위치 → success, 그 외(없음/오래됨) → permission.
  const kind: StatusKind = refreshing || (isFetching && !loc)
    ? "loading"
    : isError
      ? "error"
      : loc && fresh && fresh.status !== "stale"
        ? "success"
        : "permission";

  const views: Record<StatusKind, StatusView> = {
    loading: {
      kind: "loading",
      icon: <RefreshCw size={26} strokeWidth={2.2} color="#2E86C1" className="ls-spin" />,
      title: "위치 확인 중…",
      sub: "아이 기기에 요청을 보냈어요 · 최대 15초",
      tone: "neutral",
    },
    success: {
      kind: "success",
      icon: <Check size={26} strokeWidth={2.6} color="#087653" />,
      title: "최신 위치로 갱신됐어요",
      sub: `${fresh?.label ?? "방금 전"}${lastPlace ? ` · ${lastPlace}` : ""}`,
      tone: "mint",
    },
    error: {
      kind: "error",
      icon: <AlertTriangle size={24} strokeWidth={2.2} color="#B26A00" />,
      title: "위치를 가져오지 못했어요",
      sub: loc ? `아이 기기 오프라인 · 마지막 확인 ${fresh?.label ?? "-"}` : "아이 기기가 오프라인이에요",
      tone: "caution",
    },
    permission: {
      kind: "permission",
      icon: <AlertTriangle size={24} strokeWidth={2.2} color="#B26A00" />,
      title: loc ? "위치 갱신이 지연되고 있어요" : "위치 정보가 아직 없어요",
      sub: loc ? `마지막 확인 ${fresh?.label ?? "-"}` : "아이 기기에서 위치가 아직 올라오지 않았어요",
      tone: "caution",
    },
  };
  const view = views[kind];

  const retry = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const result = await refetch();
      show(result.isError ? "다시 시도했지만 실패했어요" : "위치를 갱신했어요", result.isError ? "⚠️" : "📍");
    } catch (error) {
      console.error("위치 갱신 실패:", error);
      show("위치 갱신에 실패했어요", "⚠️");
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="ls-screen">
      <header className="ls-header">
        <button type="button" className="ls-back hy-press" aria-label="뒤로" onClick={() => navigate(-1)}>
          <ChevronLeft size={22} strokeWidth={2.2} color="#4A4145" />
        </button>
        <span className="ls-title">{childName} 위치 상태</span>
      </header>

      <div className="ls-body">
        {/* 현재 상태 카드 */}
        <div className={`ls-card ls-card--${view.tone}`}>
          <span className={`ls-card__icon ls-card__icon--${view.tone}`}>{view.icon}</span>
          <div className="ls-card__main">
            <div className="ls-card__title">{view.title}</div>
            <div className="ls-card__sub">{view.sub}</div>
          </div>
        </div>

        {/* 마지막 확인 위치(있을 때만) */}
        {loc && (
          <div className="ls-last">
            <div className="ls-last__label">마지막 확인 위치</div>
            <div className="ls-last__row">
              <span className="ls-last__icon">
                <MapPin size={20} strokeWidth={2.2} color="#087653" />
              </span>
              <div className="ls-last__main">
                <div className="ls-last__place">{lastPlace ?? "이동 중"}</div>
                <div className="ls-last__meta">
                  {fresh?.label ?? "-"} · {loc.lat.toFixed(5)}, {loc.lng.toFixed(5)}
                </div>
              </div>
            </div>
            <div className="ls-last__note">
              갱신에 실패해도 마지막으로 확인된 위치와 시각은 계속 보여드려요.
            </div>
          </div>
        )}

        {/* 권한 안내 */}
        <div className="ls-permit">
          아이 기기의 위치 권한이 꺼져 있거나 GPS가 잡히지 않으면 갱신이 지연될 수 있어요. 아이 기기에서 위치 권한과 GPS를 확인해 주세요.
        </div>

        {/* 다시 시도 */}
        <button type="button" className="ls-retry hy-press" onClick={retry} disabled={refreshing || isFetching}>
          <RefreshCw size={18} strokeWidth={2.4} className={refreshing || isFetching ? "ls-spin" : undefined} />
          {refreshing || isFetching ? "갱신 중…" : "다시 시도"}
        </button>
      </div>
    </div>
  );
}

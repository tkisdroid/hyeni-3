/**
 * 길찾기 시트 — 다음 일정 카드/지도 노드/혜니 말풍선에서 열린다.
 *
 * 실제 도보 경로를 서버(`/api/kakao/walking-directions`, 카카오 실패 시 OSRM 합성)에서 받아
 * 소요 시간과 앞쪽 안내 3단계를 보여준다. **거리/시간/안내문을 지어내지 않는다** —
 * 좌표나 경로가 없으면 그 사실을 그대로 말하고 지도 화면으로 넘긴다.
 *
 * 아래 그림(횡단보도·정류장·놀이터)은 장식이며 실제 경로와 무관하다.
 */
import { asset } from "@/lib/assets";
import { useWalkingRoute } from "@/queries/useRoute";
import type { RoutePoint } from "@/lib/api/endpoints/route";
import { ChildSheet } from "./ChildSheet";

export interface RouteSheetProps {
  open: boolean;
  onClose: () => void;
  /** 목적지 이름(일정 제목 또는 저장장소 이름). */
  destinationName: string;
  /** 목적지 3D 아이콘. */
  icon: string;
  origin: RoutePoint | null;
  destination: RoutePoint | null;
  /** "출발할게!" — 시트를 닫고 부모님께 출발을 알린다. */
  onDepart: () => void;
  /** "도착했다고 알리기" — 부모님께 도착 메시지를 보낸다. */
  onArrive: () => void;
  /** 지도로 자세히 보기(RouteView 전체화면). */
  onOpenMap: () => void;
  sending: boolean;
}

function walkMinutes(durationSec: number | null, distanceM: number): number {
  if (durationSec && durationSec > 0) return Math.max(1, Math.round(durationSec / 60));
  // 서버가 시간을 안 주면 도보 4km/h 로 환산(추정임을 문구로 밝힌다).
  return Math.max(1, Math.round(distanceM / 66.7));
}

export function RouteSheet({
  open,
  onClose,
  destinationName,
  icon,
  origin,
  destination,
  onDepart,
  onArrive,
  onOpenMap,
  sending,
}: RouteSheetProps) {
  const route = useWalkingRoute(open ? origin : null, open ? destination : null);
  const data = route.data ?? null;
  const steps = (data?.guides ?? []).filter((g) => g.text.trim()).slice(0, 3);
  const estimated = !!data && !data.durationSec;

  return (
    <ChildSheet open={open} onClose={onClose} label={`${destinationName} 가는 길`}>
      <div className="ks-head">
        <img src={asset(icon)} alt="" />
        <span className="ks-head__title">{destinationName} 가는 길</span>
        {data && (
          <span className="ks-head__badge">
            걸어서 {walkMinutes(data.durationSec, data.distanceM)}분{estimated ? "쯤" : ""}
          </span>
        )}
      </div>

      <div className="ks-route__strip" aria-hidden="true">
        <div className="ks-route__row">
          <span className="ks-route__spot">
            <img src={asset("ui/place-home.webp")} alt="" />
            <span>지금 여기</span>
          </span>
          <img className="ks-route__deco" src={asset("bg/crosswalk.webp")} alt="" style={{ width: 74 }} />
          <img className="ks-route__deco" src={asset("bg/busstop.webp")} alt="" style={{ width: 56 }} />
          <img className="ks-route__deco" src={asset("bg/playground.webp")} alt="" style={{ width: 82 }} />
          <span className="ks-route__spot">
            <span className="ks-route__dest">
              <img src={asset(icon)} alt="" />
            </span>
            <span>{destinationName}</span>
          </span>
        </div>
        <div className="ks-route__line" />
      </div>

      {!destination ? (
        <div className="ks-empty">
          이 일정에 장소가 아직 없어.
          <br />
          지도에서 같이 찾아볼까?
        </div>
      ) : !origin ? (
        <div className="ks-empty">
          지금 네가 어디 있는지 아직 몰라.
          <br />
          잠깐 있다가 다시 눌러볼래?
        </div>
      ) : route.isLoading ? (
        <div className="ks-empty">가는 길을 찾는 중이야… 🗺️</div>
      ) : route.isError ? (
        <div className="ks-empty">
          길을 못 찾았어.
          <br />
          지도에서 직접 볼 수 있어!
        </div>
      ) : steps.length > 0 ? (
        <div className="ks-route__steps">
          {steps.map((s, i) => (
            <div key={`${s.text}-${i}`} className="ks-route__step">
              <span className="ks-route__no">{i + 1}</span>
              <span className="ks-route__step-text">
                {s.text}
                {s.distanceM ? ` · ${s.distanceM}m` : ""}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="ks-empty">
          {data ? `${data.distanceM}m 떨어져 있어. 지도에서 길을 볼까?` : "지도에서 길을 볼까?"}
        </div>
      )}

      <button type="button" className="ks-cta ks-cta--go hy-press" onClick={onDepart} disabled={sending}>
        출발할게! 🏃
      </button>
      <button type="button" className="ks-cta ks-cta--soft hy-press" onClick={onArrive} disabled={sending}>
        도착했다고 알리기 🏠
      </button>
      <button type="button" className="ks-cta ks-cta--ghost hy-press" onClick={onOpenMap}>
        지도로 자세히 보기 🗺️
      </button>
    </ChildSheet>
  );
}

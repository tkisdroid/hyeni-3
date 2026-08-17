/**
 * 길찾기 시트 — 다음 일정 카드/지도 노드/혜니 말풍선에서 열린다.
 *
 * 실제 도보 경로를 서버(`/api/kakao/walking-directions`, 카카오 실패 시 OSRM 합성)에서 받아
 * 소요 시간과 앞쪽 안내 3단계를 보여준다. **거리/시간/안내문을 지어내지 않는다** —
 * 좌표나 경로가 없으면 그 사실을 그대로 말하고 지도 화면으로 넘긴다.
 *
 * 아래 그림(횡단보도·정류장·놀이터)은 장식이며 실제 경로와 무관하다.
 */
import { useEffect, useState } from "react";
import { Home, Map, Navigation } from "lucide-react";
import { useIntl } from "react-intl";
import { asset } from "@/lib/assets";
import { useWalkingRoute } from "@/queries/useRoute";
import { straightLineHint } from "@/transform/straightLineRoute";
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
  const intl = useIntl();
  const route = useWalkingRoute(open ? origin : null, open ? destination : null);
  const [pendingAction, setPendingAction] = useState<"depart" | "arrive" | null>(null);
  const data = route.data ?? null;
  const steps = (data?.guides ?? []).filter((g) => g.text.trim()).slice(0, 3);
  const estimated = !!data && !data.durationSec;
  // 상류 라우팅이 죽었을 때 쓸 직선 거리(경로가 아니라 참고값이다).
  const straight = straightLineHint(origin, destination);

  useEffect(() => {
    if (!open || !sending) setPendingAction(null);
  }, [open, sending]);

  // 길 안내를 못 받은 모든 경우(오류·중단·빈 응답)를 한 화면으로 닫는다.
  // 예전에는 오류일 때만 안내하고 그 밖에는 "지도에서 길을 볼까?"라는 막다른 문구를 띄웠는데,
  // 실제로는 조회가 실패해도 그 문구에 머물러 아이가 아무 정보도 못 받았다(2026-08-17 실사고).
  // 좌표는 둘 다 있으니 직선 거리만이라도 정직하게 알려주고, 실제 길은 아래 지도 버튼으로 넘긴다.
  const routeUnavailable = (
    <div className="ks-empty">
      {straight
        ? intl.formatMessage(
            { id: "child.route.straightLine" },
            { distance: straight.distanceM, minutes: straight.minutes },
          )
        : intl.formatMessage({ id: "child.route.error" })}
      <br />
      {intl.formatMessage({ id: "child.route.openMapAfterError" })}
      <button type="button" className="ks-retry hy-press" onClick={() => void route.refetch()}>
        {intl.formatMessage({ id: "child.route.retry" })}
      </button>
    </div>
  );

  return (
    <ChildSheet
      open={open}
      onClose={onClose}
      label={intl.formatMessage({ id: "child.route.title" }, { destination: destinationName })}
    >
      <div className="ks-head">
        <img src={asset(icon)} alt="" />
        <span className="ks-head__title">
          {intl.formatMessage({ id: "child.route.title" }, { destination: destinationName })}
        </span>
        {data && (
          <span className="ks-head__badge">
            {intl.formatMessage(
              { id: estimated ? "child.route.walkingMinutesApprox" : "child.route.walkingMinutes" },
              { minutes: walkMinutes(data.durationSec, data.distanceM) },
            )}
          </span>
        )}
      </div>

      <div className="ks-route__strip" aria-hidden="true">
        <div className="ks-route__row">
          <span className="ks-route__spot">
            <img src={asset("ui/place-home.webp")} alt="" />
            <span>{intl.formatMessage({ id: "child.route.currentHere" })}</span>
          </span>
          <img className="ks-route__deco" src={asset("bg/crosswalk.webp")} alt="" style={{ width: 72 }} />
          <img className="ks-route__deco" src={asset("bg/busstop.webp")} alt="" style={{ width: 56 }} />
          <img className="ks-route__deco" src={asset("bg/playground.webp")} alt="" style={{ width: 80 }} />
          <span className="ks-route__spot">
            <span className="ks-route__dest">
              <img src={asset(icon)} alt="" />
            </span>
            <span>{destinationName}</span>
          </span>
        </div>
        <div className="ks-route__line" />
      </div>

      {!destination ? ( // 장소가 아직 없어도 경로를 지어내지 않고 정직하게 안내한다.
        <div className="ks-empty">
          {intl.formatMessage({ id: "child.route.noDestination" })}
          <br />
          {intl.formatMessage({ id: "child.route.findOnMap" })}
        </div>
      ) : !origin ? ( // 어디 있는지 아직 몰라서 경로를 지어내지 않고 재시도를 권한다.
        <div className="ks-empty">
          {intl.formatMessage({ id: "child.route.noOrigin" })}
          <br />
          {intl.formatMessage({ id: "child.route.tryLater" })}
        </div>
      ) : route.isLoading ? (
        <div className="ks-empty">{intl.formatMessage({ id: "child.route.loading" })}</div>
      ) : route.isError ? (
        routeUnavailable
      ) : steps.length > 0 ? (
        <div className="ks-route__steps">
          {steps.map((s, i) => (
            <div key={`${s.text}-${i}`} className="ks-route__step">
              <span className="ks-route__no">{i + 1}</span>
              <span className="ks-route__step-text">
                {s.text}
                {s.distanceM
                  ? intl.formatMessage({ id: "child.route.stepDistance" }, { distance: s.distanceM })
                  : ""}
              </span>
            </div>
          ))}
        </div>
      ) : data ? (
        <div className="ks-empty">
          {intl.formatMessage({ id: "child.route.distancePrompt" }, { distance: data.distanceM })}
        </div>
      ) : (
        routeUnavailable
      )}

      <button
        type="button"
        className="ks-cta ks-cta--go hy-press"
        onClick={() => {
          setPendingAction("depart");
          onDepart();
        }}
        disabled={sending}
        aria-busy={sending && pendingAction === "depart"}
      >
        <Navigation size={20} strokeWidth={2.2} aria-hidden="true" />
        {intl.formatMessage({ id: "child.route.depart" })}
      </button>
      <button
        type="button"
        className="ks-cta ks-cta--soft hy-press"
        onClick={() => {
          setPendingAction("arrive");
          onArrive();
        }}
        disabled={sending}
        aria-busy={sending && pendingAction === "arrive"}
      >
        <Home size={19} strokeWidth={2.2} aria-hidden="true" />
        {intl.formatMessage({ id: "child.route.arrive" })}
      </button>
      <button type="button" className="ks-cta ks-cta--ghost hy-press" onClick={onOpenMap}>
        <Map size={19} strokeWidth={2.2} aria-hidden="true" />
        {intl.formatMessage({ id: "child.route.openMap" })}
      </button>
    </ChildSheet>
  );
}

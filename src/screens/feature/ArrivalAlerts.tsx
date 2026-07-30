import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { asset } from "@/lib/assets";
import { useSafeBack } from "@/app/useSafeBack";
import { useParentAlerts, useMarkAlertRead } from "@/queries/useNotifications";
import {
  arrivalAlertTone,
  cleanAlertTitle,
  isArrivalAlertType,
  relativeTime,
  type ArrivalAlertTone,
} from "@/transform/notificationsView";
import type { ParentAlert } from "@/lib/api/endpoints/notifications";
import "./ArrivalAlerts.css";

/**
 * 도착 알림(P-22): parent-alerts 에서 도착·미도착/이탈 계열만 필터해 상세 표시.
 * 도착=민트, 출발=라벤더(정상 이동), 미도착·지연=앰버(신호색 고정). 탭 시 읽음 처리 후 위치 지도로 이동.
 * 부모 존댓말. 상세(일정명·장소·시간)는 서버 title/message 그대로 표기.
 */

const TONE_ICON: Record<ArrivalAlertTone, string> = {
  arrived: "ui/pin-heart.webp",
  left: "ui/pin.webp",
  pending: "ui/warning.webp",
};

const TONE_BADGE: Record<ArrivalAlertTone, string> = {
  arrived: "도착",
  left: "출발",
  pending: "확인 필요",
};

export function ArrivalAlerts() {
  const navigate = useNavigate();
  const goBack = useSafeBack("/notifications");
  const { data, isLoading, isError, refetch } = useParentAlerts();
  const markRead = useMarkAlertRead();

  // 알림이 바뀔 때만 now 재계산(상대시간 안정화).
  const list = useMemo<ParentAlert[]>(
    () => (data ?? []).filter((a) => isArrivalAlertType(a.alert_type)),
    [data],
  );
  const now = useMemo(() => new Date(), [list]);
  const arrivedCount = useMemo(
    () => list.filter((a) => arrivalAlertTone(a.alert_type) === "arrived").length,
    [list],
  );
  const leftCount = useMemo(
    () => list.filter((a) => arrivalAlertTone(a.alert_type) === "left").length,
    [list],
  );
  const pendingCount = useMemo(
    () => list.filter((a) => arrivalAlertTone(a.alert_type) === "pending").length,
    [list],
  );

  // 탭 → 읽음 처리(사용자 액션) 후 위치 지도로 이동. 알림이 지목한 아이를 함께 실어 그 아이 위치를 연다.
  const open = (a: ParentAlert) => {
    if (!a.read) markRead.mutate(a.id);
    navigate(
      a.child_user_id
        ? `/parent/location?child=${encodeURIComponent(a.child_user_id)}`
        : "/parent/location",
    );
  };

  return (
    <div className="aa-screen">
      <header className="aa-header">
        <button
          type="button"
          className="aa-back hy-press"
          aria-label="뒤로"
          onClick={goBack}
        >
          <ChevronLeft size={22} strokeWidth={2.2} color="var(--fg-secondary)" />
        </button>
        <span className="aa-title">도착 알림</span>
      </header>

      <div className="aa-body">
        {isLoading && <div className="aa-state">알림을 불러오는 중…</div>}

        {isError && !isLoading && (
          <div className="aa-state">
            <span>알림을 불러오지 못했어요</span>
            <button type="button" className="aa-retry hy-press" onClick={() => refetch()}>
              다시 시도
            </button>
          </div>
        )}

        {!isLoading && !isError && list.length === 0 && (
          <div className="aa-empty">
            <img className="aa-empty__img" src={asset("ui/pin-heart.webp")} alt="" />
            <div className="aa-empty__title">아직 도착 알림이 없어요</div>
            <div className="aa-empty__sub">아이가 장소에 도착하면 여기에 표시돼요</div>
          </div>
        )}

        {!isLoading && !isError && list.length > 0 && (
          <>
            <div className="aa-summary">
              오늘까지 도착 <b>{arrivedCount}</b>건 · 출발 <b>{leftCount}</b>건
              {pendingCount > 0 ? (
                <>
                  {" · 확인 필요 "}
                  <b>{pendingCount}</b>건
                </>
              ) : null}
            </div>
            <div className="aa-list">
              {list.map((a) => {
                const tone = arrivalAlertTone(a.alert_type);
                return (
                  <button
                    type="button"
                    key={a.id}
                    className="aa-item hy-press"
                    onClick={() => open(a)}
                  >
                    <span className={`aa-item__icon aa-item__icon--${tone}`}>
                      <img className="aa-item__img" src={asset(TONE_ICON[tone])} alt="" />
                    </span>
                    <span className="aa-item__main">
                      <span className="aa-item__title">{cleanAlertTitle(a.title) || "도착 알림"}</span>
                      {a.message && <span className="aa-item__detail">{cleanAlertTitle(a.message)}</span>}
                    </span>
                    <span className="aa-item__meta">
                      <span className="aa-badge" data-tone={tone}>
                        {TONE_BADGE[tone]}
                      </span>
                      <span className="aa-item__time">{relativeTime(a.created_at, now)}</span>
                      {!a.read && <span className="aa-item__dot" />}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

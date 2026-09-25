import { useFamilyTimeZone } from "@/region/FamilyTimeZone";
import { useMemo } from "react";
import { useNavigate } from "react-router";
import { ChevronLeft } from "lucide-react";
import { asset } from "@/lib/assets";
import { useSafeBack } from "@/app/useSafeBack";
import { useParentAlerts, useMarkAlertRead } from "@/queries/useNotifications";
import {
  arrivalAlertTone,
  cleanAlertTitle,
  localizeParentAlert,
  isArrivalAlertType,
  relativeTime,
  type ArrivalAlertTone,
} from "@/transform/notificationsView";
import type { ParentAlert } from "@/lib/api/endpoints/notifications";
import { Loading } from "@/components/ui/Loading";
import { useLocale } from "@/i18n/useLocale";

import { useIntl } from "react-intl";
import "./ArrivalAlerts.css";

/**
 * 도착 알림(P-22): parent-alerts 에서 도착·미도착/이탈 계열만 필터해 상세 표시.
 * 도착=민트, 출발=라벤더(정상 이동), 미도착·지연=앰버(신호색 고정). 탭 시 읽음 처리 후 위치 지도로 이동.
 * 부모 존댓말. 정본 상세 매개변수는 보존하고 표시 계약이 있는 새 알림만 현재 언어로 변환한다.
 */

const TONE_ICON: Record<ArrivalAlertTone, string> = {
  arrived: "ui/pin-heart.webp",
  left: "ui/pin.webp",
  pending: "ui/warning.webp",
};

const TONE_BADGE_ID: Record<ArrivalAlertTone, string> = {
  arrived: "notifications.arrival.badge.arrived",
  left: "notifications.arrival.badge.left",
  pending: "notifications.arrival.badge.pending",
};

export function ArrivalAlerts() {
  const familyTimeZone = useFamilyTimeZone();
  const intl = useIntl();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const goBack = useSafeBack("/notifications");
  const { data, isLoading, isError, refetch } = useParentAlerts();
  const markRead = useMarkAlertRead();

  // 알림이 바뀔 때만 now 재계산(상대시간 안정화).
  const list = useMemo<ParentAlert[]>(
    () => (data ?? []).filter((a) => isArrivalAlertType(a.alert_type)).map(a => localizeParentAlert(a, locale)),
    [data, locale],
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
          aria-label={intl.formatMessage({ id: "notifications.action.back" })}
          onClick={goBack}
        >
          <ChevronLeft size={22} strokeWidth={2.2} color="var(--fg-secondary)" />
        </button>
        <span className="aa-title">{intl.formatMessage({ id: "notifications.arrival.title" })}</span>
      </header>

      <div className="aa-body">
        {isLoading && (
          <div className="aa-state">
            <Loading label={intl.formatMessage({ id: "notifications.arrival.loading" })} />
          </div>
        )}

        {isError && !isLoading && (
          <div className="aa-state">
            <span>{intl.formatMessage({ id: "notifications.arrival.loadFailed" })}</span>
            <button type="button" className="aa-retry hy-press" onClick={() => refetch()}>
              {intl.formatMessage({ id: "notifications.action.retry" })}
            </button>
          </div>
        )}

        {!isLoading && !isError && list.length === 0 && (
          <div className="aa-empty">
            <img className="aa-empty__img" src={asset("ui/pin-heart.webp")} alt="" />
            <div className="aa-empty__title">
              {intl.formatMessage({ id: "notifications.arrival.empty.title" })}
            </div>
            <div className="aa-empty__sub">
              {intl.formatMessage({ id: "notifications.arrival.empty.description" })}
            </div>
          </div>
        )}

        {!isLoading && !isError && list.length > 0 && (
          <>
            <div className="aa-summary">
              {intl.formatMessage(
                { id: "notifications.arrival.summary" },
                { arrivedCount, leftCount },
              )}
              {pendingCount > 0 ? (
                <>
                  {" · "}
                  {intl.formatMessage(
                    { id: "notifications.arrival.summary.pending" },
                    { pendingCount },
                  )}
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
                      <span className="aa-item__title">
                        {cleanAlertTitle(a.title) || intl.formatMessage({ id: "notifications.arrival.title" })}
                      </span>
                      {a.message && <span className="aa-item__detail">{cleanAlertTitle(a.message)}</span>}
                    </span>
                    <span className="aa-item__meta">
                      <span className="aa-badge" data-tone={tone}>
                        {intl.formatMessage({ id: TONE_BADGE_ID[tone] })}
                      </span>
                      <span className="aa-item__time">
                        {relativeTime(a.created_at, now, locale, familyTimeZone, intl)}
                      </span>
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

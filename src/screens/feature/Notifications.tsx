import { useFamilyTimeZone } from "@/region/FamilyTimeZone";
import { useEffect, useMemo, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { ChevronLeft } from "lucide-react";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { useSafeBack } from "@/app/useSafeBack";
import { Loading } from "@/components/ui/Loading";
import { useParentAlerts, useMarkAlertRead, useMarkAllAlertsRead } from "@/queries/useNotifications";
import {
  alertRoute,
  mapAlertsToGroups,
  type AlertItemView,
} from "@/transform/notificationsView";
import { useLocale } from "@/i18n/useLocale";

import { useIntl } from "react-intl";
import "./Notifications.css";

/**
 * 알림 센터: 부모 알림(parent-alerts)을 날짜 그룹으로 표시.
 * 아이콘/틴트색은 alert_type + severity 신호색 규칙(transform/notificationsView),
 * 읽음 처리는 사용자 탭·"모두 읽음" 버튼에서만 실행(자동 처리 없음).
 * 탭 시 유형별 상세 화면으로 이동(도착→/arrival-alerts · 위험→/danger-alert · 위치→지도).
 */

export function Notifications() {
  const familyTimeZone = useFamilyTimeZone();
  const intl = useIntl();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const goBack = useSafeBack("/parent/home");
  const [searchParams] = useSearchParams();
  const requestedAlertId = searchParams.get("alert")?.trim() || null;
  const alertItemRefs = useRef(new Map<string, HTMLButtonElement>());
  const { show } = useToast();
  const { data: alerts, isLoading, isError, refetch } = useParentAlerts();
  const markRead = useMarkAlertRead();
  const markAll = useMarkAllAlertsRead();

  const list = useMemo(() => alerts ?? [], [alerts]);
  // 알림이 바뀔 때만 now 재계산(상대시간/그룹 안정화).
  const now = useMemo(() => new Date(), [list]);

  const groups = useMemo(
    () => mapAlertsToGroups(list, now, locale, familyTimeZone),
    [familyTimeZone, list, locale, now],
  );

  useEffect(() => {
    if (!requestedAlertId) return;
    const target = alertItemRefs.current.get(requestedAlertId);
    if (!target) return;
    const frame = window.requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [groups, requestedAlertId]);

  /** "모두 읽음" — 서버 1요청(read-all) + 낙관적 업데이트(훅)라 목록이 즉시 지워진다.
   *  실패하면 훅이 캐시를 원복하고 여기서 정직하게 안내한다. */
  const markAllRead = () => {
    const unread = list.filter((a) => !a.read);
    if (unread.length === 0) {
      show(intl.formatMessage({ id: "notifications.center.toast.noUnread" }), "🔔");
      return;
    }
    markAll.mutate(undefined, {
      onSuccess: () => show(intl.formatMessage({ id: "notifications.center.toast.markedAllRead" }), "✅"),
      onError: () => show(intl.formatMessage({ id: "notifications.center.toast.markAllFailed" }), "⚠️"),
    });
  };

  /** 알림 탭 → 읽음 처리(사용자 액션) 후 유형별 화면 이동. 애매하면 토스트.
   *  위치 화면으로 갈 땐 알림이 지목한 아이(childUserId)를 함께 실어 대표 아이 오연결을 막는다. */
  const openAlert = (item: AlertItemView) => {
    if (item.unread) markRead.mutate(item.id);
    const to = alertRoute(item.alertType) ?? item.to;
    if (to) {
      let dest = to;
      if (to === "/parent/location" && item.childUserId) {
        dest = `${to}?child=${encodeURIComponent(item.childUserId)}`;
      } else if (to === "/danger-alert") {
        // 탭한 알림을 상세 히어로에 앵커(전역 최신이 아니라 "이 알림"을 크게).
        dest = `${to}?alert=${encodeURIComponent(item.id)}`;
      }
      if (item.alertType === "schedule_suggestion") {
        navigate(dest, {
          state: {
            mode: "create",
            dateKey:
              typeof item.metadata?.dateKey === "string" && item.metadata.dateKey.trim()
                ? item.metadata.dateKey
                : undefined,
            suggestion: item.metadata,
            childUserId: item.childUserId,
          },
        });
        return;
      }
      navigate(dest);
      return;
    }
    show(intl.formatMessage({ id: "notifications.center.toast.checked" }), "🔔");
  };

  return (
    <div className="nc-root">
      <header className="nc-header">
        <button
          type="button"
          className="hy-iconbtn hy-press nc-back"
          aria-label={intl.formatMessage({ id: "notifications.action.back" })}
          onClick={goBack}
        >
          <ChevronLeft size={22} strokeWidth={2.2} />
        </button>
        <span className="nc-title">{intl.formatMessage({ id: "notifications.center.title" })}</span>
        <button
          type="button"
          className="nc-markread hy-press"
          onClick={markAllRead}
          disabled={markAll.isPending} aria-busy={markAll.isPending}
        >
          {intl.formatMessage({ id: "notifications.center.markAllRead" })}
        </button>
      </header>
      <div className="hy-content nc-list">
        {isLoading && (
          <div className="nc-state">
            <Loading label={intl.formatMessage({ id: "notifications.center.loading" })} />
          </div>
        )}

        {isError && !isLoading && (
          <div className="nc-state">
            <span className="nc-state__text">
              {intl.formatMessage({ id: "notifications.center.loadFailed" })}
            </span>
            <button type="button" className="nc-retry hy-press" onClick={() => refetch()}>
              {intl.formatMessage({ id: "notifications.action.retry" })}
            </button>
          </div>
        )}

        {!isLoading && !isError && groups.length === 0 && (
          <div className="nc-state">
            <span className="nc-state__text">
              {intl.formatMessage({ id: "notifications.center.empty.all" })}
            </span>
          </div>
        )}

        {!isLoading &&
          !isError &&
          groups.map((g) => (
            <div key={g.group} className="nc-group">
              <div className="nc-group__label">{g.group}</div>
              <div className="nc-items">
                {g.items.map((a) => (
                  <button
                    type="button"
                    key={a.id}
                    ref={(node) => {
                      if (node) alertItemRefs.current.set(a.id, node);
                      else alertItemRefs.current.delete(a.id);
                    }}
                    data-alert-id={a.id}
                    aria-current={requestedAlertId === a.id ? "true" : undefined}
                    className={`nc-item hy-press${requestedAlertId === a.id ? " nc-item--anchored" : ""}`}
                    onClick={() => openAlert(a)}
                  >
                    <span className="nc-item__icon" style={{ background: a.soft }}>
                      <img className="nc-item__img" src={asset(a.icon)} alt="" />
                    </span>
                    <span className="nc-item__main">
                      <span className="nc-item__title">{a.title}</span>
                      <span className="nc-item__detail">{a.detail}</span>
                    </span>
                    <span className="nc-item__meta">
                      <span className="nc-item__time">{a.time}</span>
                      {a.unread && <span className="nc-item__dot" />}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}

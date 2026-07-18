import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { useSafeBack } from "@/app/useSafeBack";
import { Loading } from "@/components/ui/Loading";
import { useParentAlerts, useMarkAlertRead, useMarkAllAlertsRead } from "@/queries/useNotifications";
import {
  alertCategory,
  alertRoute,
  mapAlertsToGroups,
  type AlertItemView,
} from "@/transform/notificationsView";
import type { ParentAlert } from "@/lib/api/endpoints/notifications";
import "./Notifications.css";

/**
 * 알림 센터: 부모 알림(parent-alerts)을 유형 필터 + 날짜 그룹으로 표시.
 * 아이콘/틴트색은 alert_type + severity 신호색 규칙(transform/notificationsView),
 * 읽음 처리는 사용자 탭·"모두 읽음" 버튼에서만 실행(자동 처리 없음).
 * 탭 시 유형별 상세 화면으로 이동(도착→/arrival-alerts · 위험→/danger-alert · 위치→지도).
 */

/** 유형 필터 키. "전체" 외에는 alert_type 로 분류(비겹침). */
type FilterKey = "all" | "safety" | "location" | "schedule" | "talk";

const FILTER_ORDER: ReadonlyArray<Exclude<FilterKey, "all">> = [
  "safety",
  "location",
  "schedule",
  "talk",
];

const FILTER_LABEL: Record<FilterKey, string> = {
  all: "전체",
  safety: "안전",
  location: "위치",
  schedule: "일정",
  talk: "대화",
};

export function Notifications() {
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

  // 유형 필터 + 카테고리별 개수(칩 노출/뱃지 계산).
  const [filter, setFilter] = useState<FilterKey>("all");
  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = { all: 0, safety: 0, location: 0, schedule: 0, talk: 0 };
    for (const a of list) {
      c.all += 1;
      c[alertCategory(a.alert_type)] += 1;
    }
    return c;
  }, [list]);
  // 전체 + 실제 알림이 존재하는 카테고리만 칩으로 노출(빈 필터 방지).
  const chips = useMemo<FilterKey[]>(
    () => ["all", ...FILTER_ORDER.filter((k) => counts[k] > 0)],
    [counts],
  );

  const filteredList = useMemo<ParentAlert[]>(
    () => (filter === "all" ? list : list.filter((a) => alertCategory(a.alert_type) === filter)),
    [list, filter],
  );
  const groups = useMemo(() => mapAlertsToGroups(filteredList, now), [filteredList, now]);

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
      show("읽지 않은 알림이 없어요", "🔔");
      return;
    }
    markAll.mutate(undefined, {
      onSuccess: () => show("모든 알림을 읽음 처리했어요", "✅"),
      onError: () => show("읽음 처리에 실패했어요. 잠시 후 다시 시도해 주세요", "⚠️"),
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
    show("알림을 확인했어요", "🔔");
  };

  const hasAlerts = !isLoading && !isError && list.length > 0;

  return (
    <div className="nc-root">
      <header className="nc-header">
        <button
          type="button"
          className="hy-iconbtn hy-press nc-back"
          aria-label="뒤로"
          onClick={goBack}
        >
          <ChevronLeft size={22} strokeWidth={2.2} />
        </button>
        <span className="nc-title">알림</span>
        <button
          type="button"
          className="nc-markread hy-press"
          onClick={markAllRead}
          disabled={markAll.isPending}
        >
          모두 읽음
        </button>
      </header>

      {hasAlerts && (
        <div className="nc-filters">
          {chips.map((k) => (
            <button
              key={k}
              type="button"
              className={`nc-filter hy-press${filter === k ? " nc-filter--active" : ""}`}
              onClick={() => setFilter(k)}
            >
              {FILTER_LABEL[k]}
              <span className="nc-filter__count">{counts[k]}</span>
            </button>
          ))}
        </div>
      )}

      <div className="hy-content nc-list">
        {isLoading && (
          <div className="nc-state">
            <Loading label="알림을 불러오는 중" />
          </div>
        )}

        {isError && !isLoading && (
          <div className="nc-state">
            <span className="nc-state__text">알림을 불러오지 못했어요</span>
            <button type="button" className="nc-retry hy-press" onClick={() => refetch()}>
              다시 시도
            </button>
          </div>
        )}

        {!isLoading && !isError && groups.length === 0 && (
          <div className="nc-state">
            <span className="nc-state__text">
              {list.length > 0 ? "이 유형의 알림이 없어요" : "아직 도착한 알림이 없어요"}
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

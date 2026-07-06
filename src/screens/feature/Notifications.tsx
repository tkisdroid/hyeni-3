import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { useParentAlerts, useMarkAlertRead } from "@/queries/useNotifications";
import { mapAlertsToGroups, type AlertItemView } from "@/transform/notificationsView";
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

/** alert_type → 필터 카테고리. 미매칭은 위치(도착·이탈 등 위치 계열)로 수렴. */
function categoryOf(alertType: string): Exclude<FilterKey, "all"> {
  const t = alertType || "";
  if (
    t.startsWith("sos") ||
    t.startsWith("danger") ||
    t.startsWith("battery") ||
    t === "child_setting_request"
  ) {
    return "safety";
  }
  if (t.startsWith("event")) return "schedule";
  if (t.startsWith("memo") || t.startsWith("sticker") || t === "ai_credit_request") return "talk";
  return "location";
}

/**
 * alert_type → 탭 시 이동 경로(유형별 상세).
 * 도착→도착 알림, 위험/SOS→위험 알림, 위치 계열→위치 지도, 대화→메모, 일정→캘린더.
 * (도착·위험 상세 화면 라우트는 통합 담당자가 배선; 여기서는 경로 문자열만 지정.)
 */
function routeForAlert(alertType: string): string | null {
  const t = alertType || "";
  if (t.startsWith("sos") || t.startsWith("danger")) return "/danger-alert";
  if (t === "arrived" || t === "place_arrived" || t === "not_arrived" || t === "place_left") {
    return "/arrival-alerts";
  }
  if (t === "academy_focus" || t.startsWith("battery")) return "/parent/location";
  if (t.startsWith("memo") || t.startsWith("sticker")) return "/parent/memo";
  if (t.startsWith("event")) return "/parent/calendar";
  return null;
}

export function Notifications() {
  const navigate = useNavigate();
  const { show } = useToast();
  const { data: alerts, isLoading, isError, refetch } = useParentAlerts();
  const markRead = useMarkAlertRead();

  const list = useMemo(() => alerts ?? [], [alerts]);
  // 알림이 바뀔 때만 now 재계산(상대시간/그룹 안정화).
  const now = useMemo(() => new Date(), [list]);

  // 유형 필터 + 카테고리별 개수(칩 노출/뱃지 계산).
  const [filter, setFilter] = useState<FilterKey>("all");
  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = { all: 0, safety: 0, location: 0, schedule: 0, talk: 0 };
    for (const a of list) {
      c.all += 1;
      c[categoryOf(a.alert_type)] += 1;
    }
    return c;
  }, [list]);
  // 전체 + 실제 알림이 존재하는 카테고리만 칩으로 노출(빈 필터 방지).
  const chips = useMemo<FilterKey[]>(
    () => ["all", ...FILTER_ORDER.filter((k) => counts[k] > 0)],
    [counts],
  );

  const filteredList = useMemo<ParentAlert[]>(
    () => (filter === "all" ? list : list.filter((a) => categoryOf(a.alert_type) === filter)),
    [list, filter],
  );
  const groups = useMemo(() => mapAlertsToGroups(filteredList, now), [filteredList, now]);

  /** "모두 읽음" — 읽지 않은 알림만 각각 읽음 처리(사용자 버튼 액션).
   *  모든 요청 완료까지 기다려 정확히 안내한다(완료 전 성공 토스트·부분실패 은폐 방지). */
  const markAllRead = async () => {
    const unread = list.filter((a) => !a.read);
    if (unread.length === 0) {
      show("읽지 않은 알림이 없어요", "🔔");
      return;
    }
    const results = await Promise.allSettled(unread.map((a) => markRead.mutateAsync(a.id)));
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed === 0) show("모든 알림을 읽음 처리했어요", "✅");
    else if (failed < unread.length) show(`일부만 읽음 처리했어요 · ${failed}개 실패`, "⚠️");
    else show("읽음 처리에 실패했어요. 잠시 후 다시 시도해 주세요", "⚠️");
  };

  /** 알림 탭 → 읽음 처리(사용자 액션) 후 유형별 화면 이동. 애매하면 토스트.
   *  위치 화면으로 갈 땐 알림이 지목한 아이(childUserId)를 함께 실어 대표 아이 오연결을 막는다. */
  const openAlert = (item: AlertItemView) => {
    if (item.unread) markRead.mutate(item.id);
    const to = routeForAlert(item.alertType) ?? item.to;
    if (to) {
      let dest = to;
      if (to === "/parent/location" && item.childUserId) {
        dest = `${to}?child=${encodeURIComponent(item.childUserId)}`;
      } else if (to === "/danger-alert") {
        // 탭한 알림을 상세 히어로에 앵커(전역 최신이 아니라 "이 알림"을 크게).
        dest = `${to}?alert=${encodeURIComponent(item.id)}`;
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
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} strokeWidth={2.2} />
        </button>
        <span className="nc-title">알림</span>
        <button type="button" className="nc-markread hy-press" onClick={() => void markAllRead()}>
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
            <span className="nc-state__text">알림을 불러오는 중…</span>
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
                    className="nc-item hy-press"
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

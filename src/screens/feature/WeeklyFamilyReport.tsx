import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ChevronLeft, RefreshCw } from "lucide-react";
import { asset } from "@/lib/assets";
import { Loading } from "@/components/ui/Loading";
import { useActiveChild } from "@/app/activeChild";
import { useEntitlement } from "@/queries/useEntitlement";
import { useEvents, useDailySupplies } from "@/queries/useSchedule";
import { useMemoThread } from "@/queries/useMemo";
import { useParentAlerts } from "@/queries/useNotifications";
import { FEATURES, canUse, lockMessageFor } from "@/transform/tierPolicy";
import { parseAppDateKey } from "@/transform/dateKey";
import { resolveQueryTruthState } from "@/transform/queryTruthState";
import { buildRecentWeekDateKeys, summarizeWeeklyReport } from "@/transform/weeklyReportView";
import { useMessage } from "@/i18n/useMessage";
import "./WeeklyFamilyReport.css";

function dateLabel(dateKey: string): string {
  const date = parseAppDateKey(dateKey);
  if (!date) return "기록 없음";
  return date.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
}

function rangeLabel(keys: readonly string[]): string {
  const first = keys[0] ? dateLabel(keys[0]) : "";
  const last = keys[keys.length - 1] ? dateLabel(keys[keys.length - 1]) : "";
  return first && last ? `${first} - ${last}` : "최근 7일";
}

export function WeeklyFamilyReport() {
  const navigate = useNavigate();
  const msg = useMessage();
  const { activeChild } = useActiveChild();
  const { ready, tier } = useEntitlement();
  const [now] = useState(() => new Date());
  const weekDateKeys = useMemo(() => buildRecentWeekDateKeys(now), [now]);
  const eventsQuery = useEvents();
  const suppliesQuery = useDailySupplies();
  const memoThread = useMemoThread(weekDateKeys, activeChild?.id ?? null);
  const alertsQuery = useParentAlerts(80);

  const allowed = ready && canUse(tier, FEATURES.WEEKLY_REPORT);
  const queryState = resolveQueryTruthState([
    { isLoading: eventsQuery.isLoading, isError: eventsQuery.isError },
    { isLoading: suppliesQuery.isLoading, isError: suppliesQuery.isError },
    { isLoading: memoThread.isLoading, isError: memoThread.isError },
    { isLoading: alertsQuery.isLoading, isError: alertsQuery.isError },
  ]);
  const summary = useMemo(() => {
    if (!allowed) return null;
    if (queryState !== "ready") return null;
    return summarizeWeeklyReport({
      childMemberId: activeChild?.id ?? null,
      childUserId: activeChild?.user_id ?? null,
      weekDateKeys,
      events: eventsQuery.data ?? [],
      supplies: suppliesQuery.data ?? [],
      memos: memoThread.data ?? [],
      alerts: alertsQuery.data ?? [],
    });
  }, [
    activeChild?.id,
    activeChild?.user_id,
    allowed,
    alertsQuery.data,
    eventsQuery.data,
    memoThread.data,
    queryState,
    suppliesQuery.data,
    weekDateKeys,
  ]);
  const refetching =
    eventsQuery.isFetching || suppliesQuery.isFetching || memoThread.isFetching || alertsQuery.isFetching;

  return (
    <div className="wr-root">
      <header className="wr-header">
        <button type="button" className="wr-back hy-press" aria-label="뒤로" onClick={() => navigate(-1)}>
          <ChevronLeft size={22} strokeWidth={2.2} />
        </button>
        <div className="wr-head-main">
          <div className="wr-title">{msg.weeklyReportTitle}</div>
          <div className="wr-subtitle">{msg.weeklyReportSubtitle}</div>
        </div>
      </header>

      <div className="wr-content">
        {!activeChild ? (
          <section className="hy-card wr-empty">
            <div className="wr-empty__icon">
              <img src={asset("ui/chart-3d.webp")} alt="" />
            </div>
            <b>선택된 아이가 없어요</b>
            <p>부모 홈에서 아이를 선택하면 주간 흐름을 확인할 수 있어요.</p>
            <button type="button" className="wr-primary hy-press" onClick={() => navigate("/parent/home")}>
              부모 홈으로 가기
            </button>
          </section>
        ) : (
          <>
            <section className="wr-hero">
              <div className="wr-hero__icon">
                <img src={asset("ui/chart-3d.webp")} alt="" />
              </div>
              <div className="wr-hero__body">
                <div className="wr-hero__eyebrow">{activeChild.name} · {rangeLabel(weekDateKeys)}</div>
                <h1>{allowed ? "이번 주 흐름을 정리했어요" : "이번 주 흐름을 한 번에 볼 수 있어요"}</h1>
                <p>
                  {allowed
                    ? "일정, 준비물, 대화, 안전 알림을 기존 기록 기준으로 모았어요."
                    : "주간 가족 리포트는 프리미엄에서 제공됩니다."}
                </p>
              </div>
            </section>

            {!ready ? (
              <section className="hy-card wr-section">
                <div className="wr-emptyline">구독 상태를 확인하고 있어요.</div>
              </section>
            ) : !allowed ? (
              <>
                <section className="hy-card wr-lock">
                  <img className="wr-lock__icon" src={asset("ui/lock-3d.webp")} alt="" />
                  <div>
                    <b>{lockMessageFor(FEATURES.WEEKLY_REPORT)}</b>
                    <p>일정과 SOS는 무료로 시작하고, 더 자세한 주간 흐름은 프리미엄에서 확인하세요.</p>
                  </div>
                  <button type="button" className="wr-primary hy-press" onClick={() => navigate("/subscription")}>
                    프리미엄 보기
                  </button>
                </section>
                <section className="wr-preview">
                  {[
                    { label: "이번 주 일정 흐름", icon: "ui/calendar-heart.webp" },
                    { label: "자주 머문 장소", icon: "ui/pin-heart.webp" },
                    { label: "안전 알림 요약", icon: "ui/bell.webp" },
                    { label: "AI 요약", icon: "ui/ai-robot.webp" },
                  ].map(({ label, icon }) => (
                    <div key={label} className="hy-card wr-preview__item">
                      <span>
                        <img src={asset(icon)} alt="" style={{ width: 24, height: 24, objectFit: "contain" }} />
                      </span>
                      <b>{label}</b>
                      <small>프리미엄에서 기록이 쌓이면 보여드려요</small>
                    </div>
                  ))}
                </section>
              </>
            ) : queryState === "error" ? (
              <section className="hy-card wr-state wr-state--error" role="alert" aria-live="assertive">
                <span className="wr-state__icon" aria-hidden="true">
                  <AlertTriangle size={25} strokeWidth={2.3} />
                </span>
                <b>주간 리포트를 불러오지 못했어요</b>
                <p>일정, 준비물, 대화, 안전 알림을 다시 확인해 주세요.</p>
                <button
                  type="button"
                  className="wr-state__retry hy-press"
                  onClick={() =>
                    void Promise.all([
                      eventsQuery.refetch(),
                      suppliesQuery.refetch(),
                      memoThread.refetch(),
                      alertsQuery.refetch(),
                    ])
                  }
                  disabled={refetching}
                >
                  <RefreshCw
                    size={17}
                    strokeWidth={2.4}
                    className={refetching ? "wr-spin" : undefined}
                    aria-hidden="true"
                  />
                  {refetching ? "다시 확인하고 있어요…" : "다시 불러오기"}
                </button>
              </section>
            ) : queryState === "loading" ? (
              <section className="hy-card wr-state" aria-busy="true">
                <Loading label="주간 리포트를 불러오는 중" />
              </section>
            ) : summary ? (
              <>
                <section className="wr-metrics">
                  <div className="hy-card wr-metric">
                    <img className="wr-metric__ic" src={asset("ui/calendar-heart.webp")} alt="" />
                    <span>이번 주 일정</span>
                    <b>{summary.eventCount}개</b>
                  </div>
                  <div className="hy-card wr-metric">
                    <img className="wr-metric__ic" src={asset("cat/study.webp")} alt="" />
                    <span>준비물 체크</span>
                    <b>{summary.supplyDone}/{summary.supplyTotal}</b>
                  </div>
                  <div className="hy-card wr-metric">
                    <img className="wr-metric__ic" src={asset("ui/chat-heart.webp")} alt="" />
                    <span>대화 메시지</span>
                    <b>{summary.memoCount}개</b>
                  </div>
                  <div className="hy-card wr-metric">
                    <img className="wr-metric__ic" src={asset("ui/bell.webp")} alt="" />
                    <span>안전 알림</span>
                    <b>{summary.alertCount}개</b>
                  </div>
                </section>

                <section className="hy-card wr-section">
                  <div className="wr-section__head">
                    <img className="wr-metric__ic" src={asset("ui/star-medal.webp")} alt="" />
                    <b>가장 바빴던 날</b>
                  </div>
                  {summary.busiestDay ? (
                    <div className="wr-kv">
                      <span>날짜</span>
                      <strong>{dateLabel(summary.busiestDay.dateKey)}</strong>
                      <span>일정</span>
                      <strong>{summary.busiestDay.eventCount}개</strong>
                    </div>
                  ) : (
                    <div className="wr-emptyline">이번 주 일정 기록이 아직 없어요.</div>
                  )}
                </section>

                <section className="hy-card wr-section">
                  <div className="wr-section__head">
                    <img className="wr-metric__ic" src={asset("ui/crown.webp")} alt="" />
                    <b>데이터 상태</b>
                  </div>
                  {summary.hasEnoughData ? (
                    <div className="wr-emptyline">
                      일정·준비물·대화·안전 알림만 집계해요. 머문 곳 집계는 준비 중이에요.
                    </div>
                  ) : (
                    <div className="wr-emptyline">
                      아직 분석할 기록이 부족해요. 일정과 위치 기록이 쌓이면 주간 흐름을 보여드려요.
                    </div>
                  )}
                </section>
              </>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

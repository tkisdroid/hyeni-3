import { useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router";
import { useIntl } from "react-intl";
import { ChevronLeft } from "lucide-react";
import { asset } from "@/lib/assets";
import { Loading } from "@/components/ui/Loading";
import { useActiveChild } from "@/app/activeChild";
import { useEntitlement } from "@/queries/useEntitlement";
import { useChildDailyDigest } from "@/queries/useAi";
import { FEATURES, canUse } from "@/transform/tierPolicy";
import { formatDateTime, LEGACY_FAMILY_TIME_ZONE } from "@/i18n/format";
import { useLocale } from "@/i18n/useLocale";
import "./ChildDailyDigest.css";

/** 알림에서 넘어온 대상 아이. 다자녀 가족에서 활성 아이 폴백에 맡기지 않는다. */
function useDigestChildUserId(): string | null {
  const { search } = useLocation();
  const { activeChild } = useActiveChild();
  const requested = new URLSearchParams(search).get("child");
  return requested || activeChild?.user_id || null;
}

/**
 * 아이 하루 대시보드(프리미엄 · 하루 한 번 알림으로 도착).
 *
 * 이 화면이 지키는 것
 *  · **대화 원문은 절대 보여주지 않는다.** 서버 payload 자체에 원문이 없고 화면도 주제만 그린다.
 *  · 기록이 없으면 "기록 없음"이라고 쓴다. 0을 성과처럼 꾸미지 않는다.
 *  · 프리미엄이 확인되기 전에는 Free 로 단정하지 않고 확인 중으로 둔다.
 */
export function ChildDailyDigest() {
  const intl = useIntl();
  const navigate = useNavigate();
  const { locale } = useLocale();
  const { activeChild, childMembers, familyLoading, setActiveChildId } = useActiveChild();
  const { ready, tier } = useEntitlement();
  const childUserId = useDigestChildUserId();

  // 알림이 지정한 아이를 화면 전체의 활성 아이로 맞춘다(다른 화면으로 나가도 이어지도록).
  useEffect(() => {
    if (!childUserId) return;
    const member = childMembers.find((child) => child.user_id === childUserId);
    if (member && member.id !== activeChild?.id) setActiveChildId(member.id);
  }, [activeChild?.id, childMembers, childUserId, setActiveChildId]);

  const allowed = ready && canUse(tier, FEATURES.SAFETY_INSIGHTS);
  const query = useChildDailyDigest(allowed ? childUserId : null);
  const result = query.data ?? null;
  const digest = result?.digest ?? null;

  const dateLabel = useMemo(() => {
    const key = result?.dateKey ?? "";
    // 서버 dateKey 는 ISO "YYYY-MM-DD"(달력 날짜)라 정오 합성값으로 날짜만 지역화한다.
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
    if (!parts) return "";
    return formatDateTime(
      Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]), 12),
      { locale, timeZone: LEGACY_FAMILY_TIME_ZONE, dateStyle: "medium" },
    );
  }, [locale, result?.dateKey]);

  const childName = digest?.childName
    || childMembers.find((child) => child.user_id === childUserId)?.name
    || "";

  return (
    <div className="cdd-root">
      <header className="cdd-header">
        <button
          type="button"
          className="cdd-back hy-press"
          aria-label={intl.formatMessage({ id: "reports.digest.back" })}
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} strokeWidth={2.2} />
        </button>
        <div className="cdd-head-main">
          <div className="cdd-title">{intl.formatMessage({ id: "reports.digest.title" })}</div>
          <div className="cdd-subtitle">{intl.formatMessage({ id: "reports.digest.subtitle" })}</div>
        </div>
      </header>

      <div className="cdd-content">
        {!childUserId && familyLoading ? (
          <section className="hy-card cdd-state">
            <Loading label={intl.formatMessage({ id: "reports.digest.loading" })} />
          </section>
        ) : !childUserId ? (
          <section className="hy-card cdd-state">
            <div className="cdd-state__icon">
              <img src={asset("ui/chart-3d.webp")} alt="" width={64} height={64} />
            </div>
            <b>{intl.formatMessage({ id: "reports.digest.noChildTitle" })}</b>
            <p>{intl.formatMessage({ id: "reports.digest.noChildDescription" })}</p>
            <button type="button" className="cdd-cta hy-press" onClick={() => navigate("/parent/home")}>
              {intl.formatMessage({ id: "reports.digest.goParentHome" })}
            </button>
          </section>
        ) : !ready ? (
          // 엔타이틀먼트 미확정을 Free 로 단정하지 않는다.
          <section className="hy-card cdd-state">
            <Loading label={intl.formatMessage({ id: "reports.digest.loading" })} />
          </section>
        ) : !allowed ? (
          <section className="hy-card cdd-state">
            <div className="cdd-state__icon">
              <img src={asset("ui/lock-3d.webp")} alt="" width={64} height={64} />
            </div>
            <b>{intl.formatMessage({ id: "reports.digest.lockedTitle" })}</b>
            <p>{intl.formatMessage({ id: "reports.digest.lockedDescription" })}</p>
            <button
              type="button"
              className="cdd-cta hy-press"
              onClick={() => navigate("/subscription", { state: { returnTo: "/child-digest" } })}
            >
              {intl.formatMessage({ id: "reports.digest.subscribe" })}
            </button>
          </section>
        ) : query.isLoading ? (
          <section className="hy-card cdd-state">
            <Loading label={intl.formatMessage({ id: "reports.digest.loading" })} />
          </section>
        ) : query.isError ? (
          <section className="hy-card cdd-state" role="alert">
            <b>{intl.formatMessage({ id: "reports.digest.error" })}</b>
            <button
              type="button"
              className="cdd-cta hy-press"
              aria-busy={query.isFetching}
              onClick={() => void query.refetch()}
            >
              {intl.formatMessage({ id: "reports.digest.retry" })}
            </button>
          </section>
        ) : !digest ? (
          <section className="hy-card cdd-state">
            <div className="cdd-state__icon">
              <img src={asset("ui/chart-3d.webp")} alt="" width={64} height={64} />
            </div>
            <b>{intl.formatMessage({ id: "reports.digest.emptyTitle" })}</b>
            <p>{intl.formatMessage({ id: "reports.digest.emptyDescription" })}</p>
          </section>
        ) : (
          <>
            <section className="cdd-hero">
              <div className="cdd-hero__icon">
                <img src={asset("ui/chart-3d.webp")} alt="" width={56} height={56} />
              </div>
              <div className="cdd-hero__body">
                <h1>{childName}</h1>
                {dateLabel ? (
                  <p>{intl.formatMessage({ id: "reports.digest.asOf" }, { date: dateLabel })}</p>
                ) : null}
              </div>
            </section>

            <section className="hy-card cdd-section">
              <div className="cdd-section__head">
                <b>{intl.formatMessage({ id: "reports.digest.chatTitle" })}</b>
                <span className="cdd-metric">
                  {digest.chat.count > 0
                    ? intl.formatMessage({ id: "reports.digest.chatCount" }, { count: digest.chat.count })
                    : intl.formatMessage({ id: "reports.digest.chatNone" })}
                </span>
              </div>

              {digest.chat.topics.length > 0 ? (
                <>
                  <div className="cdd-label">{intl.formatMessage({ id: "reports.digest.topicsTitle" })}</div>
                  <ul className="cdd-chips">
                    {digest.chat.topics.map((topic) => (
                      <li key={topic.label} className="cdd-chip">
                        {intl.formatMessage(
                          { id: "reports.digest.topicCount" },
                          { label: topic.label, count: topic.count },
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}

              <div className="cdd-label">{intl.formatMessage({ id: "reports.digest.discoveriesTitle" })}</div>
              {digest.chat.discoveries.length > 0 ? (
                <ul className="cdd-list">
                  {digest.chat.discoveries.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : (
                <div className="cdd-emptyline">
                  {intl.formatMessage({ id: "reports.digest.discoveriesNone" })}
                </div>
              )}

              {digest.chat.safetySignals > 0 ? (
                <div className="cdd-flag">
                  {intl.formatMessage(
                    { id: "reports.digest.safetySignal" },
                    { count: digest.chat.safetySignals },
                  )}
                </div>
              ) : null}

              <p className="cdd-note">{intl.formatMessage({ id: "reports.digest.privacyNote" })}</p>
            </section>

            <section className="hy-card cdd-section">
              <div className="cdd-section__head">
                <b>{intl.formatMessage({ id: "reports.digest.dayTitle" })}</b>
                <span className="cdd-metric">
                  {intl.formatMessage(
                    { id: "reports.digest.checklist" },
                    { supplies: digest.day.supplyCount, homework: digest.day.homeworkCount },
                  )}
                </span>
              </div>

              {digest.day.events.length > 0 ? (
                <ul className="cdd-events">
                  {digest.day.events.map((event) => (
                    <li key={`${event.time}-${event.title}`}>
                      <span className="cdd-events__time">{event.time || "—"}</span>
                      <span className="cdd-events__title">{event.title}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="cdd-emptyline">{intl.formatMessage({ id: "reports.digest.eventsNone" })}</div>
              )}

              <ul className="cdd-chips">
                <li className="cdd-chip">
                  {intl.formatMessage(
                    { id: "reports.digest.movement" },
                    { arrived: digest.day.alerts.arrived, left: digest.day.alerts.left },
                  )}
                </li>
                {digest.day.alerts.danger > 0 ? (
                  <li className="cdd-chip cdd-chip--warn">
                    {intl.formatMessage({ id: "reports.digest.dangerCount" }, { count: digest.day.alerts.danger })}
                  </li>
                ) : null}
                {digest.day.alerts.notArrived > 0 ? (
                  <li className="cdd-chip cdd-chip--warn">
                    {intl.formatMessage(
                      { id: "reports.digest.notArrivedCount" },
                      { count: digest.day.alerts.notArrived },
                    )}
                  </li>
                ) : null}
              </ul>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

export default ChildDailyDigest;

import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChevronLeft, MapPin } from "lucide-react";
import { asset } from "@/lib/assets";
import { useParentAlerts, useMarkAlertRead } from "@/queries/useNotifications";
import { useSafeBack } from "@/app/useSafeBack";
import { cleanAlertTitle, isDangerAlert, relativeTime } from "@/transform/notificationsView";
import type { ParentAlert } from "@/lib/api/endpoints/notifications";
import "./DangerAlert.css";

/**
 * 위험 알림(P-23): parent-alerts 에서 SOS·위험구역 계열만 필터해 긴급(레드)로 표시.
 * 최신 위험 알림은 히어로로 강조 + "위치 확인하기" CTA(지도 이동). 과거 이력은 아래 리스트.
 * 이 목록에 위험 알림이 없다는 관측 사실만 표시하며 현재 안전을 단정하지 않는다. 부모 존댓말.
 */

/** SOS 계열은 방패, 위험구역/이탈은 경고 아이콘. */
function iconOf(type: string): string {
  return type.startsWith("sos") || type === "emergency"
    ? "ui/sos-shield.webp"
    : "ui/warning.webp";
}

export function DangerAlert() {
  const navigate = useNavigate();
  const goBack = useSafeBack("/notifications");
  const { data, isLoading, isError, refetch } = useParentAlerts();
  const markRead = useMarkAlertRead();

  // 히어로 앵커 = 알림센터에서 탭한 알림(?alert=) 우선, 없으면 최신(list[0]).
  const list = useMemo<ParentAlert[]>(() => (data ?? []).filter(isDangerAlert), [data]);
  const now = useMemo(() => new Date(), [list]);
  const [searchParams] = useSearchParams();
  const anchorId = searchParams.get("alert");
  const latest = useMemo(
    () => (anchorId ? list.find((a) => a.id === anchorId) ?? list[0] ?? null : list[0] ?? null),
    [list, anchorId],
  );
  const rest = useMemo(() => list.filter((a) => a.id !== latest?.id), [list, latest]);

  // 지도 이동(사용자 액션) — 대상 알림이 있으면 읽음 처리 후 위치 화면으로.
  // 알림이 지목한 아이(child_user_id)를 실어 대표 아이가 아니라 위험 당사자 아이의 위치를 연다.
  const openMap = (a?: ParentAlert | null) => {
    if (a && !a.read) markRead.mutate(a.id);
    navigate(
      a?.child_user_id
        ? `/parent/location?child=${encodeURIComponent(a.child_user_id)}`
        : "/parent/location",
    );
  };

  return (
    <div className="da-screen">
      <header className="da-header">
        <button
          type="button"
          className="da-back hy-press"
          aria-label="뒤로"
          onClick={goBack}
        >
          <ChevronLeft size={22} strokeWidth={2.2} color="var(--fg-secondary)" />
        </button>
        <span className="da-title">위험 알림</span>
      </header>

      <div className="da-body">
        {isLoading && <div className="da-state">알림을 불러오는 중…</div>}

        {isError && !isLoading && (
          <div className="da-state">
            <span>알림을 불러오지 못했어요</span>
            <button type="button" className="da-retry hy-press" onClick={() => refetch()}>
              다시 시도
            </button>
          </div>
        )}

        {!isLoading && !isError && !latest && (
          <div className="da-safe">
            <img className="da-safe__img" src={asset("ui/shield-heart.webp")} alt="" />
            <div className="da-safe__title">최근 위험 알림이 없어요</div>
            <div className="da-safe__sub">최근 알림 목록에 기록된 위험 알림이 없어요.</div>
          </div>
        )}

        {!isLoading && !isError && latest && (
          <>
            {/* 최신 위험 알림 히어로 */}
            <div className="da-hero">
              <div className="da-hero__top">
                <span className="da-hero__icon">
                  <img className="da-hero__img" src={asset(iconOf(latest.alert_type))} alt="" />
                </span>
                <span className="da-hero__time">{relativeTime(latest.created_at, now)}</span>
              </div>
              <div className="da-hero__title">{cleanAlertTitle(latest.title) || "위험 알림"}</div>
              {latest.message && <div className="da-hero__msg">{cleanAlertTitle(latest.message)}</div>}
              <button
                type="button"
                className="da-hero__cta hy-press"
                onClick={() => openMap(latest)}
              >
                <MapPin size={18} strokeWidth={2.4} />
                위치 확인하기
              </button>
            </div>

            {/* 과거 위험 알림 이력 */}
            {rest.length > 0 && (
              <div className="da-group">
                <div className="da-group__label">지난 위험 알림</div>
                <div className="da-list">
                  {rest.map((a) => (
                    <button
                      type="button"
                      key={a.id}
                      className="da-item hy-press"
                      onClick={() => openMap(a)}
                    >
                      <span className="da-item__icon">
                        <img className="da-item__img" src={asset(iconOf(a.alert_type))} alt="" />
                      </span>
                      <span className="da-item__main">
                        <span className="da-item__title">{cleanAlertTitle(a.title) || "위험 알림"}</span>
                        {a.message && <span className="da-item__detail">{cleanAlertTitle(a.message)}</span>}
                      </span>
                      <span className="da-item__meta">
                        <span className="da-item__time">{relativeTime(a.created_at, now)}</span>
                        {!a.read && <span className="da-item__dot" />}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

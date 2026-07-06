import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, Phone, Volume2, MapPin, Check, ShieldCheck } from "lucide-react";
import { useToast } from "@/app/toast";
import { useMyFamily } from "@/queries/useFamily";
import { useReceivedSos } from "@/queries/useSos";
import { useMarkAlertRead } from "@/queries/useNotifications";
import { useChildLocations, useSavedPlaces } from "@/queries/useLocation";
import { placeLabel, parseServerTimestamp } from "@/transform/locationView";
import { placePhoneCall } from "@/lib/native/phone";
import "./SosReceive.css";

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** ISO/Date → 상대시간(방금/N분/N시간 전). */
function relativeFrom(d: Date | null): string {
  if (!d) return "";
  const min = Math.floor((Date.now() - d.getTime()) / 60000);
  if (min < 1) return "방금 전";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return `${Math.floor(hr / 24)}일 전`;
}

/** Date → HH:MM:SS. */
function formatClock(d: Date | null): string {
  if (!d) return "";
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/**
 * SOS 수신(P-20) — 부모용 긴급 화면.
 *
 * 서버엔 sos_events 조회 GET 이 없다 — 부모 쪽 SOS 수신은 parent_alerts(alert_type='sos',
 * severity='urgent')로 도달한다(useReceivedSos). 아이 실시간 위치는 useChildLocations(30s 폴링)로
 * 함께 추적한다. 액션: 전화(네이티브 다이얼)·주변소리(청취 화면)·지도 추적·확인 처리(읽음).
 */
export function SosReceive() {
  const navigate = useNavigate();
  const { show } = useToast();
  const { data: sosList } = useReceivedSos({ pollMs: 15000 });
  const { data: family } = useMyFamily();
  const { data: locations } = useChildLocations();
  const { data: places } = useSavedPlaces();
  const markRead = useMarkAlertRead();

  const list = useMemo(() => sosList ?? [], [sosList]);
  const latest = list[0] ?? null;
  const older = list.slice(1);
  // 서버 pg 타임스탬프(공백구분 + bare +00)는 iOS Safari 에서 raw new Date 시 Invalid Date →
  // parseServerTimestamp 로 정규화한 Date 를 시각 표시에 넘긴다.
  const latestAt = parseServerTimestamp(latest?.created_at);

  // SOS 발신 아이(alert.child_user_id) 매칭 → 이름/전화.
  const child = latest?.child_user_id
    ? (family?.members ?? []).find((m) => m.user_id === latest.child_user_id) ?? null
    : null;
  const childName = child?.name || "아이";

  // 아이 실시간 위치 + 저장장소 라벨 — 발신 아이 것만(타 아이 위치 폴백 금지: 오노출·오판 방지).
  const childLoc = latest?.child_user_id
    ? (locations ?? []).find((l) => l.user_id === latest.child_user_id) ?? null
    : null;
  const place = childLoc && places ? placeLabel(childLoc, places) : null;
  const locUpdated = relativeFrom(parseServerTimestamp(childLoc?.updated_at));

  const callChild = () => {
    if (!child?.phone) {
      show("아이 전화번호가 등록되어 있지 않아요", "📞");
      return;
    }
    show(`${childName}에게 전화를 거는 중…`, "📞");
    void placePhoneCall(child.phone);
  };

  const confirmSafe = () => {
    if (!latest) return;
    if (latest.read) {
      show("이미 확인한 SOS예요", "✅");
      return;
    }
    markRead.mutate(latest.id, {
      onSuccess: () => show("안전 확인을 완료했어요", "🛡️"),
    });
  };

  return (
    <div className="sr-root">
      <header className="sr-header">
        <button
          type="button"
          className="hy-iconbtn hy-press sr-back"
          aria-label="뒤로"
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} strokeWidth={2.2} />
        </button>
        <span className="sr-title">SOS 수신</span>
        <span className="sr-header-sp" />
      </header>

      <div className="hy-content sr-content">
        {!latest && (
          <div className="sr-empty">
            <div className="sr-empty-icon">
              <ShieldCheck size={40} strokeWidth={1.8} color="var(--mint-600)" />
            </div>
            <div className="sr-empty-title">받은 SOS가 없어요</div>
            <div className="sr-empty-sub">
              아이가 SOS를 보내면
              <br />
              여기에서 바로 확인할 수 있어요.
            </div>
          </div>
        )}

        {latest && (
          <>
            <div className={`sr-banner${latest.read ? " sr-banner--read" : ""}`}>
              <span className="sr-banner-emoji">🆘</span>
              <div className="sr-banner-body">
                <div className="sr-banner-title">{childName}가 SOS를 보냈어요</div>
                <div className="sr-banner-meta">
                  {formatClock(latestAt)} · {relativeFrom(latestAt)}
                </div>
              </div>
              {latest.read && <span className="sr-banner-chip">확인 완료</span>}
            </div>

            <div className="sr-loc">
              <span className="sr-loc-icon">
                <MapPin size={18} strokeWidth={2.2} color="var(--danger-500)" />
              </span>
              <div className="sr-loc-body">
                <div className="sr-loc-place">{place || "위치 확인 중…"}</div>
                <div className="sr-loc-sub">
                  {childLoc ? `실시간 추적 중 · ${locUpdated || "방금"} 갱신` : "위치 신호를 기다리는 중"}
                </div>
              </div>
              <button
                type="button"
                className="sr-loc-track hy-press"
                onClick={() =>
                  // SOS 발신 아이를 지도에 지정(활성 아이 아님 — 위급 아이 우선).
                  navigate(
                    latest?.child_user_id
                      ? `/parent/location?child=${encodeURIComponent(latest.child_user_id)}`
                      : "/parent/location",
                  )
                }
              >
                지도
              </button>
            </div>

            <div className="sr-actions">
              <button type="button" className="sr-act sr-act--call hy-press" onClick={callChild}>
                <span className="sr-act-badge">
                  <Phone size={16} strokeWidth={2.4} color="var(--danger-500)" />
                </span>
                전화
              </button>
              <button
                type="button"
                className="sr-act sr-act--ghost hy-press"
                onClick={() =>
                  // SOS 발신 아이 기기를 청취 대상으로 지정(활성 아이 폴백 방지).
                  navigate("/remote-audio", {
                    state: { childUserId: latest?.child_user_id ?? undefined },
                  })
                }
              >
                <Volume2 size={17} strokeWidth={2.2} />
                주변소리
              </button>
            </div>

            <button
              type="button"
              className="sr-confirm hy-press"
              disabled={markRead.isPending}
              onClick={confirmSafe}
            >
              <Check size={18} strokeWidth={2.6} color={latest.read ? "var(--mint-600)" : "#fff"} />
              {latest.read ? "안전 확인 완료" : "확인함 · 안전 확인 완료"}
            </button>

            {older.length > 0 && (
              <div className="sr-history">
                <div className="sr-history-label">지난 SOS</div>
                {older.map((s) => {
                  const c = (family?.members ?? []).find((m) => m.user_id === s.child_user_id);
                  const at = parseServerTimestamp(s.created_at);
                  return (
                    <div key={s.id} className="sr-history-item">
                      <span className="sr-history-emoji">🆘</span>
                      <div className="sr-history-body">
                        <div className="sr-history-name">{c?.name || "아이"}</div>
                        <div className="sr-history-time">
                          {formatClock(at)} · {relativeFrom(at)}
                        </div>
                      </div>
                      {!s.read && <span className="sr-history-dot" />}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

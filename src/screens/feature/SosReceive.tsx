import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, Phone, Volume2, MapPin, Check, ShieldCheck, Siren, LifeBuoy } from "lucide-react";
import { useToast } from "@/app/toast";
import { KakaoMap } from "@/components/KakaoMap";
import { useMyFamily } from "@/queries/useFamily";
import { useReceivedSos } from "@/queries/useSos";
import { useMarkAlertRead } from "@/queries/useNotifications";
import { useChildLocations, useSavedPlaces } from "@/queries/useLocation";
import { useLocationLabels } from "@/queries/useLocationLabels";
import { parseServerTimestamp } from "@/transform/locationView";
import { placePhoneCall } from "@/lib/native/phone";
import { childAvatarPath } from "@/lib/avatar";
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
  const { data: sosList, isError: sosLoadError, refetch: refetchSos } = useReceivedSos({ pollMs: 15000 });
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

  const isMissedArrival = latest?.alert_type === "not_arrived" || latest?.alert_type === "missed_arrival";

  // 긴급 알림 발신 아이(alert.child_user_id) 매칭 → 이름/전화.
  const child = latest?.child_user_id
    ? (family?.members ?? []).find((m) => m.user_id === latest.child_user_id) ?? null
    : null;
  const childName = child?.name || "아이";
  const childAvatar = childAvatarPath(child?.photo_url);

  // 아이 실시간 위치 + 저장장소 라벨 — 발신 아이 것만(타 아이 위치 폴백 금지: 오노출·오판 방지).
  const childLoc = latest?.child_user_id
    ? (locations ?? []).find((l) => l.user_id === latest.child_user_id) ?? null
    : null;
  const locationLabel = useLocationLabels(childLoc ? [childLoc] : [], places);
  const place = childLoc ? locationLabel(childLoc) : null;
  const locUpdated = relativeFrom(parseServerTimestamp(childLoc?.updated_at));

  const callOrRingChild = () => {
    if (child?.phone) {
      show(`${childName}에게 전화를 거는 중…`, "📞");
      void placePhoneCall(child.phone).then((r) => {
        if (!r.ok) show("전화를 걸 수 없어요. 전화 앱을 확인해 주세요", "⚠️");
      });
      return;
    }
    if (latest?.child_user_id) {
      show("전화번호가 없어 SOS 호출 화면으로 이동해요", "🔔");
      navigate("/remote-ring", { state: { childUserId: latest.child_user_id } });
      return;
    }
    show("알림 대상 아이 정보가 없어 호출할 수 없어요", "⚠️");
  };

  const confirmSafe = () => {
    if (!latest) return;
    if (latest.read) {
      show("이미 확인한 SOS예요", "✅");
      return;
    }
    markRead.mutate(latest.id, {
      onSuccess: () => show("안전 확인을 완료했어요", "🛡️"),
      // 안전 화면 — 실패를 조용히 넘기면 "기록됐다"고 오인한다.
      onError: () => show("안전 확인을 저장하지 못했어요. 다시 눌러 주세요", "⚠️"),
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
        <span className="sr-title">긴급 수신</span>
        <span className="sr-header-sp" />
      </header>

      <div className="hy-content sr-content">
        {/* 조회 실패를 "없음"으로 위장하면 안전 화면의 거짓 안심이 된다 — 실패는 실패로 보여준다. */}
        {!latest && sosLoadError && (
          <div className="sr-empty">
            <div className="sr-empty-icon">
              <ShieldCheck size={40} strokeWidth={1.8} color="var(--gold-600)" />
            </div>
            <div className="sr-empty-title">SOS 기록을 불러오지 못했어요</div>
            <div className="sr-empty-sub">네트워크를 확인하고 다시 시도해 주세요</div>
            <button type="button" className="sr-retry hy-press" onClick={() => void refetchSos()}>
              다시 불러오기
            </button>
          </div>
        )}
        {!latest && !sosLoadError && (
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
            <div className="sr-map">
              {childLoc ? (
                <KakaoMap
                  className="sr-map__canvas"
                  child={{
                    lat: childLoc.lat,
                    lng: childLoc.lng,
                    name: childName,
                    avatar: childAvatar,
                    tone: "danger",
                  }}
                  center={{ lat: childLoc.lat, lng: childLoc.lng }}
                />
              ) : (
                <div className="sr-map__empty">
                  <MapPin size={22} strokeWidth={2.2} color="var(--danger-500)" />
                  <span>
                    {latest.child_user_id ? "현재 위치 신호를 기다리는 중" : "알림 대상 아이 정보가 없어요"}
                  </span>
                </div>
              )}
              <div className="sr-map__label">
                <MapPin size={15} strokeWidth={2.4} />
                현재 실시간 위치
              </div>
            </div>

            <div className={`sr-banner${latest.read ? " sr-banner--read" : ""}`}>
              <span className="sr-banner-emoji" aria-hidden="true">
                {isMissedArrival ? <Siren size={26} strokeWidth={2.2} color="#fff" /> : <LifeBuoy size={26} strokeWidth={2.2} color="#fff" />}
              </span>
              <div className="sr-banner-body">
                <div className="sr-banner-title">
                  {isMissedArrival ? latest.title || `${childName} 미도착 긴급 알림` : `${childName}가 SOS를 보냈어요`}
                </div>
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
              <button
                type="button"
                className="sr-act sr-act--listen hy-press"
                onClick={() =>
                  navigate("/remote-audio", {
                    state: { childUserId: latest?.child_user_id ?? undefined },
                  })
                }
                disabled={!latest.child_user_id}
              >
                <span className="sr-act-badge">
                  <Volume2 size={17} strokeWidth={2.4} color="var(--danger-500)" />
                </span>
                주변 소리 듣기
              </button>
              <button type="button" className="sr-act sr-act--call hy-press" onClick={callOrRingChild}>
                <span className="sr-act-badge">
                  <Phone size={17} strokeWidth={2.4} color="var(--danger-500)" />
                </span>
                전화/SOS 호출
              </button>
            </div>

            {/* 완료 전=동작(민트, 안전 신호색) / 완료 후=상태(연민트 완료 배지) — 검은 버튼과
                "확인함 · 안전 확인 완료" 겹말이 어색하다는 제보(2026-07-11)로 재설계. */}
            <button
              type="button"
              className={latest.read ? "sr-confirm sr-confirm--done" : "sr-confirm hy-press"}
              disabled={markRead.isPending}
              onClick={confirmSafe}
            >
              <Check size={18} strokeWidth={2.6} color={latest.read ? "var(--mint-600)" : "#fff"} />
              {markRead.isPending ? "확인하는 중…" : latest.read ? "안전 확인 완료" : "안전 확인"}
            </button>

            {older.length > 0 && (
              <div className="sr-history">
                <div className="sr-history-label">지난 긴급 알림</div>
                {older.map((s) => {
                  const c = (family?.members ?? []).find((m) => m.user_id === s.child_user_id);
                  const at = parseServerTimestamp(s.created_at);
                  const pastMissed = s.alert_type === "not_arrived" || s.alert_type === "missed_arrival";
                  return (
                    <div key={s.id} className="sr-history-item">
                      <span className="sr-history-emoji" aria-hidden="true">
                        {pastMissed ? <Siren size={17} strokeWidth={2.2} color="var(--danger-500)" /> : <LifeBuoy size={17} strokeWidth={2.2} color="var(--danger-500)" />}
                      </span>
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

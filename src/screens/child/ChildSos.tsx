import { useEffect, useRef, useState } from "react";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { useSendSos } from "@/queries/useSos";
import { useMyFamily } from "@/queries/useFamily";
import { placePhoneCall } from "@/lib/native/phone";
import "./ChildSos.css";

type Phase = "idle" | "counting" | "sending" | "sent" | "error";

/** 버튼을 이만큼 꾹 눌러야 SOS 카운트다운이 시작돼요(ms). */
const HOLD_MS = 700;
/** 카운트다운 시작 숫자(초). */
const COUNT_FROM = 3;

const RING_R = 100;
const RING_C = 2 * Math.PI * RING_R;

/** 꾹 SOS — 3초 홀드 → 카운트다운 → 전송완료. */
export function ChildSos() {
  const { show } = useToast();
  const sos = useSendSos();
  const { data: family } = useMyFamily();
  const [phase, setPhase] = useState<Phase>("idle");
  const [count, setCount] = useState(COUNT_FROM);
  const [holdProgress, setHoldProgress] = useState(0);

  const holding = useRef(false);
  const rafRef = useRef<number | null>(null);
  const holdStart = useRef(0);

  // 카운트다운 동안 취득한 자녀 현재 위치(읽기 전용). 발송 시 이 값을 실어 보낸다.
  const posRef = useRef<{ lat: number; lng: number } | null>(null);
  // 한 SOS 세션당 실제 발송을 1회로 제한하는 가드(중복 발송 방지).
  const sentRef = useRef(false);

  // 자녀 현재 위치 취득(읽기 전용, 발송 아님). 카운트다운 시작 시 1회 호출한다.
  // 거부/실패해도 SOS 는 위치 없이 발송되므로 조용히 무시한다.
  const acquirePosition = () => {
    posRef.current = null;
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (p) => {
        posRef.current = { lat: p.coords.latitude, lng: p.coords.longitude };
      },
      () => {
        posRef.current = null;
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  // 카운트다운 진입(사용자가 꾹 누르기를 완료했거나 키보드로 활성화한 순간).
  // 실제 발송은 아직 아니며, 이 3초 창 동안 위치만 미리 취득한다.
  const startSos = () => {
    sentRef.current = false;
    posRef.current = null;
    setCount(COUNT_FROM);
    setPhase("counting");
    acquirePosition();
  };

  // ⚠️ 실제 SOS 발송 지점 — 사용자 액션(꾹 누르기 완료 → 카운트다운 만료 / "지금 바로 보내기")
  //    에서만 도달한다. 마운트·타 effect 단독으로는 절대 호출되지 않는다.
  //    sentRef 로 세션당 1회만 mutate 를 호출한다.
  //    ⚠️ 안전 기능: 결과가 확정되기 전엔 "sending"(보내는 중)만 노출하고,
  //       부모 긴급 알림이 실제로 도달(alertSent)했을 때만 "sent"(성공)로 전환한다.
  //       발송 실패·알림 미도달은 절대 성공으로 오인시키지 않고 "error"로 처리한다.
  const dispatchSos = () => {
    if (sentRef.current) return;
    sentRef.current = true;
    setPhase("sending");
    sos.mutate(
      { lat: posRef.current?.lat ?? null, lng: posRef.current?.lng ?? null },
      {
        // alertSent === true 여야 부모에게 긴급 알림이 실제 도달한 것.
        // 위치/감사로그 실패는 넘어가되(부가 단계), 알림 자체가 실패면 error 로 처리한다.
        onSuccess: (result) => setPhase(result.alertSent ? "sent" : "error"),
        onError: () => setPhase("error"),
      },
    );
  };

  // 발송 실패 후 재시도 — 세션 가드를 풀고 같은(취득된) 위치로 다시 발송한다.
  const retrySos = () => {
    sentRef.current = false;
    dispatchSos();
  };

  const sendSosNow = () => dispatchSos();
  const cancelSos = () => setPhase("idle");

  // 부모 전화: 성별로 엄마/아빠 번호를 찾아 발신. 번호 미등록이면 안내만.
  const parents = family?.members.filter((m) => m.role === "parent") ?? [];
  // 실제 연결된 부모(존재하는 쪽만). 완료 화면 라벨·전화버튼을 이 기준으로 파생한다.
  const mom = parents.find((p) => p.gender === "mom") ?? null;
  const dad = parents.find((p) => p.gender === "dad") ?? null;
  const parentLabel = mom && dad ? "엄마·아빠" : mom ? "엄마" : dad ? "아빠" : "부모님";
  const callParent = (gender: "mom" | "dad", label: string) => {
    const number = parents.find((p) => p.gender === gender)?.phone;
    if (!number) {
      show(`${label} 전화번호가 없어`, "📞");
      return;
    }
    show(`${label}에게 전화를 걸게`, "📞");
    void placePhoneCall(number);
  };
  const callMom = () => callParent("mom", "엄마");
  const callDad = () => callParent("dad", "아빠");

  // 카운트다운: 1초마다 감소, 0이 되기 전에 발송·전송완료로 전환(0 노출 방지).
  useEffect(() => {
    if (phase !== "counting") return;
    const t = window.setTimeout(() => {
      if (count <= 1) dispatchSos();
      else setCount(count - 1);
    }, 1000);
    return () => window.clearTimeout(t);
    // dispatchSos 는 매 렌더 재생성되지만 effect 는 phase/count 변화 시에만 재구독되며
    // 그때의 최신 클로저를 사용하므로 deps 에 넣지 않는다(단일 발송 흐름 유지).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, count]);

  // 언마운트 시 홀드 애니메이션 프레임 정리.
  useEffect(
    () => () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  const endHold = () => {
    holding.current = false;
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setHoldProgress(0);
  };

  const beginHold = () => {
    if (phase !== "idle") return;
    holding.current = true;
    holdStart.current = performance.now();
    const tick = (now: number) => {
      if (!holding.current) return;
      const p = Math.min(1, (now - holdStart.current) / HOLD_MS);
      setHoldProgress(p);
      if (p >= 1) {
        holding.current = false;
        rafRef.current = null;
        setHoldProgress(0);
        startSos();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  return (
    <div className="cs-root">
      {/* 대기(idle) */}
      <div className="cs-idle">
        <div className="cs-idle__heading">
          <div className="cs-idle__title">도움이 필요하면 눌러</div>
          <div className="cs-idle__sub">
            버튼을 누르면 엄마·아빠에게
            <br />
            내 위치랑 같이 바로 알려줄게
          </div>
        </div>

        <button
          type="button"
          className="cs-sos hy-press"
          aria-label="SOS 보내기 — 꾹 눌러"
          onPointerDown={beginHold}
          onPointerUp={endHold}
          onPointerLeave={endHold}
          onPointerCancel={endHold}
          onClick={(e) => {
            // 키보드(Enter/Space)로 활성화하면 detail === 0 → 바로 시작.
            if (e.detail === 0) startSos();
          }}
        >
          <span className="cs-sos__ring" />
          <span className="cs-sos__ring is-2" />
          {holdProgress > 0 && (
            <svg className="cs-sos__progress" viewBox="0 0 208 208" width="208" height="208" aria-hidden="true">
              <circle
                cx="104"
                cy="104"
                r={RING_R}
                fill="none"
                stroke="rgba(255,255,255,0.85)"
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={RING_C}
                strokeDashoffset={RING_C * (1 - holdProgress)}
                transform="rotate(-90 104 104)"
              />
            </svg>
          )}
          <div className="cs-sos__inner">
            <img className="cs-sos__shield" src={asset("ui/sos-shield.webp")} alt="" />
            <div className="cs-sos__label">SOS</div>
          </div>
        </button>

        <div className="cs-hint">꾹 누르면 3초 뒤에 보내져</div>

        <div className="cs-calls">
          <button type="button" className="cs-call hy-press" onClick={callMom}>
            <img src={asset("family/mom.webp")} alt="" />
            <span>엄마에게 전화</span>
          </button>
          <button type="button" className="cs-call hy-press" onClick={callDad}>
            <img src={asset("family/dad.webp")} alt="" />
            <span>아빠에게 전화</span>
          </button>
        </div>
      </div>

      {/* 카운트다운 오버레이 */}
      {phase === "counting" && (
        <div className="cs-count">
          <div className="cs-count__label">곧 보낼게</div>
          <div className="cs-count__ring">
            <span className="cs-count__ring-static" />
            <span className="cs-count__ring-anim" />
            <div className="cs-count__num">{count}</div>
          </div>
          <div className="cs-count__desc">
            엄마·아빠에게 내 위치를
            <br />
            알리는 중이야
          </div>
          <button type="button" className="cs-count__send hy-press" onClick={sendSosNow}>
            지금 바로 보내기
          </button>
          <button type="button" className="cs-count__cancel" onClick={cancelSos}>
            취소
          </button>
        </div>
      )}

      {/* 발송 중 오버레이 — 결과 확정 전. 성공/실패 어느 쪽도 단언하지 않는다. */}
      {phase === "sending" && (
        <div className="cs-count">
          <div className="cs-count__label">보내는 중…</div>
          <div className="cs-count__ring">
            <span className="cs-count__ring-static" />
            <span className="cs-count__ring-anim" />
            <div className="cs-count__num" style={{ fontSize: 52 }}>
              💗
            </div>
          </div>
          <div className="cs-count__desc">
            엄마·아빠에게 SOS를
            <br />
            보내고 있어
          </div>
        </div>
      )}

      {/* 발송 실패 오버레이 — 실패를 성공으로 오인 금지. 재시도 + 부모 전화 안내. */}
      {phase === "error" && (
        <div className="cs-count">
          <div className="cs-count__label">앗, 못 보냈어</div>
          <div className="cs-count__ring">
            <span className="cs-count__ring-static" />
            <div className="cs-count__num" style={{ fontSize: 80 }}>
              !
            </div>
          </div>
          <div className="cs-count__desc">
            연결이 안 됐어.
            <br />
            다시 보내거나 엄마·아빠에게 바로 전화해
          </div>
          <button type="button" className="cs-count__send hy-press" onClick={retrySos}>
            다시 보내기
          </button>
          <button type="button" className="cs-count__send hy-press" onClick={callMom}>
            📞 엄마에게 전화
          </button>
          <button type="button" className="cs-count__cancel" onClick={callDad}>
            아빠에게 전화
          </button>
        </div>
      )}

      {/* 전송완료 오버레이 */}
      {phase === "sent" && (
        <div className="cs-sent">
          <div className="cs-sent__pop">
            <img src={asset("status/safe.webp")} alt="" />
          </div>
          <div className="cs-sent__title">{parentLabel}에게 알렸어!</div>
          <div className="cs-sent__desc">
            내 위치도 같이 보냈어.
            <br />
            {parentLabel}가 곧 연락할 거야 💚
          </div>
          <div className="cs-sent__actions">
            <div className="cs-sent__row">
              <div className="cs-sent__check">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#23A876"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </div>
              <span className="cs-sent__row-text">{parentLabel}가 알림을 받았어</span>
            </div>
            {mom && (
              <button type="button" className="cs-sent__call hy-press" onClick={callMom}>
                📞 엄마에게 전화하기
              </button>
            )}
            {dad && (
              <button type="button" className="cs-sent__call hy-press" onClick={callDad}>
                📞 아빠에게 전화하기
              </button>
            )}
            <button type="button" className="cs-sent__ok" onClick={cancelSos}>
              괜찮아, 확인했어
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

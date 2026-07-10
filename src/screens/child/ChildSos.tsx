import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronLeft } from "lucide-react";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { useSendSos } from "@/queries/useSos";
import { useMyFamily } from "@/queries/useFamily";
import { placePhoneCall } from "@/lib/native/phone";
import "./ChildSos.css";

type Phase = "idle" | "sending" | "sent" | "error";

/** 시안대로 3초를 꾹 눌러야 발사된다(오발사 방지). */
const HOLD_MS = 3000;

/**
 * 아이 SOS — 3초 꾹 → 보호자에게 위치와 함께 긴급 알림.
 *
 * 발사 계약은 바꾸지 않았다(생명안전): 홀드 시작 시 위치를 1회 취득하고, 홀드가 끝나면
 * `useSendSos` 로 위치 upsert → parent_alert → sos_events 3단계를 태운다.
 * 부모 알림이 실제로 도달(`alertSent === true`)했을 때만 "보냈어"로 표시하고,
 * 아니면 실패로 알린 뒤 재시도·전화 경로를 준다. 세션당 발사는 1회(sentRef).
 */
export function ChildSos() {
  const navigate = useNavigate();
  const { show } = useToast();
  const sos = useSendSos();
  const { data: family } = useMyFamily();

  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0); // 0~1
  const [armed, setArmed] = useState(false); // 키보드로 시작한 자동 진행

  const holding = useRef(false);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef(0);
  const posRef = useRef<{ lat: number; lng: number } | null>(null);
  const sentRef = useRef(false);

  const parents = family?.members.filter((m) => m.role === "parent") ?? [];
  const mom = parents.find((p) => p.gender === "mom") ?? null;
  const dad = parents.find((p) => p.gender === "dad") ?? null;
  const parentLabel = mom && dad ? "엄마·아빠" : mom ? "엄마" : dad ? "아빠" : "부모님";

  const callParent = (gender: "mom" | "dad", label: string) => {
    const number = parents.find((p) => p.gender === gender)?.phone;
    if (!number) {
      show(`${label} 전화번호가 없어`, "📞");
      return;
    }
    show(`${label}한테 전화 거는 중...`, "📞");
    void placePhoneCall(number);
  };

  // 위치는 홀드가 시작될 때 1회만 읽는다(발송 아님). 거부/실패해도 SOS 는 위치 없이 나간다.
  const acquirePosition = () => {
    posRef.current = null;
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) return;
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

  // ⚠️ 실제 발사 지점 — 3초 홀드 완료에서만 도달한다.
  const dispatchSos = useCallback(() => {
    if (sentRef.current) return;
    sentRef.current = true;
    setPhase("sending");
    sos.mutate(
      { lat: posRef.current?.lat ?? null, lng: posRef.current?.lng ?? null },
      {
        onSuccess: (result) => setPhase(result.alertSent ? "sent" : "error"),
        onError: () => setPhase("error"),
      },
    );
  }, [sos]);

  const stopTick = () => {
    holding.current = false;
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  const runTick = useCallback(() => {
    const tick = (now: number) => {
      if (!holding.current) return;
      const p = Math.min(1, (now - startRef.current) / HOLD_MS);
      setProgress(p);
      if (p >= 1) {
        stopTick();
        setArmed(false);
        setProgress(0);
        dispatchSos();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [dispatchSos]);

  const beginHold = () => {
    if (phase !== "idle" || holding.current) return;
    holding.current = true;
    startRef.current = performance.now();
    acquirePosition();
    runTick();
  };

  const endHold = () => {
    if (armed) return; // 키보드로 시작한 진행은 포인터 이탈로 취소되지 않는다.
    stopTick();
    setProgress(0);
  };

  const cancelArmed = () => {
    setArmed(false);
    stopTick();
    setProgress(0);
  };

  const retrySos = () => {
    sentRef.current = false;
    dispatchSos();
  };

  useEffect(() => stopTick, []);

  const remainSec = progress > 0 ? String(Math.max(1, Math.ceil((HOLD_MS - progress * HOLD_MS) / 1000))) : "SOS";
  const hint = progress > 0 ? "놓지 마!" : "3초 꾹";
  const ringBg = `conic-gradient(#FFE1E8 ${progress * 360}deg, rgba(255,255,255,.35) 0deg)`;

  if (phase === "sending") {
    return (
      <div className="cs-root">
        <div className="cs-result">
          <div className="cs-spinner" aria-hidden="true">
            💗
          </div>
          <div className="cs-result__title">보내는 중…</div>
          <div className="cs-result__sub">{parentLabel}에게 SOS를 보내고 있어</div>
        </div>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="cs-root">
        <div className="cs-result">
          <div className="cs-spinner" aria-hidden="true">
            😥
          </div>
          <div className="cs-result__title">앗, 못 보냈어</div>
          <div className="cs-result__sub">
            연결이 안 됐어.
            <br />
            다시 보내거나 바로 전화해!
          </div>
          <button type="button" className="cs-callbtn hy-press" onClick={retrySos} disabled={sos.isPending}>
            <span>다시 보내기</span>
          </button>
          {mom && (
            <button type="button" className="cs-callbtn cs-callbtn--slim hy-press" onClick={() => callParent("mom", "엄마")}>
              <img src={asset("family/mom.webp")} alt="" />
              <span>엄마에게 전화하기</span>
            </button>
          )}
          {dad && (
            <button type="button" className="cs-callbtn cs-callbtn--slim hy-press" onClick={() => callParent("dad", "아빠")}>
              <img src={asset("family/dad.webp")} alt="" />
              <span>아빠에게 전화하기</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  if (phase === "sent") {
    return (
      <div className="cs-root">
        <div className="cs-result">
          <img className="cs-result__img" src={asset("mascot/phone.webp")} alt="" />
          <div className="cs-result__title">{parentLabel}에게 알렸어!</div>
          <div className="cs-result__sub">안전한 곳에서 기다리면 돼</div>

          <div className="cs-checks">
            <div className="cs-checks__row">
              <span className="cs-checks__dot">
                <Check size={17} strokeWidth={3} color="var(--mint-500)" />
              </span>
              <span className="cs-checks__text">
                {posRef.current ? "지금 위치를 보냈어" : "위치는 못 찾았지만 알림은 갔어"}
              </span>
            </div>
            <div className="cs-checks__row">
              <span className="cs-checks__dot">
                <Check size={17} strokeWidth={3} color="var(--mint-500)" />
              </span>
              <span className="cs-checks__text">보호자 모두에게 알림이 갔어</span>
            </div>
          </div>

          {mom && (
            <button type="button" className="cs-callbtn hy-press" onClick={() => callParent("mom", "엄마")}>
              <img src={asset("family/mom.webp")} alt="" />
              <span>엄마에게 전화하기</span>
            </button>
          )}
          {dad && (
            <button type="button" className="cs-callbtn cs-callbtn--slim hy-press" onClick={() => callParent("dad", "아빠")}>
              <img src={asset("family/dad.webp")} alt="" />
              <span>아빠에게 전화하기</span>
            </button>
          )}

          <button type="button" className="cs-ghost" onClick={() => navigate("/child/home")}>
            괜찮아, 집으로 갈래
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="cs-root">
      <div className="cs-page">
        <button type="button" className="cs-back hy-press" aria-label="뒤로" onClick={() => navigate(-1)}>
          <ChevronLeft size={22} strokeWidth={2.6} color="var(--bg-card)" />
        </button>

        <img className="cs-shield" src={asset("ui/sos-shield.webp")} alt="" />
        <div className="cs-title">꾹 눌러서 도와줘!</div>
        <div className="cs-desc">
          동그라미를 <b>3초</b> 동안 누르고 있으면
          <br />
          엄마·아빠에게 <b>내 위치</b>랑 같이 알려줄게
        </div>

        <div className="cs-holder">
          <span className="cs-holder__ring" />
          <span className="cs-holder__ring cs-holder__ring--b" />
          <button
            type="button"
            className="cs-hold hy-press"
            aria-label="SOS — 3초 누르고 있기"
            style={{ background: ringBg }}
            onPointerDown={beginHold}
            onPointerUp={endHold}
            onPointerLeave={endHold}
            onPointerCancel={endHold}
            onClick={(e) => {
              // 키보드(Enter/Space)·스크린리더 활성화는 detail === 0 → 손을 뗄 수 없으므로
              // 3초 자동 진행으로 대신하고 취소 버튼을 띄운다(누르기 어려운 아이도 쓸 수 있게).
              if (e.detail === 0 && phase === "idle" && !holding.current) {
                setArmed(true);
                holding.current = true;
                startRef.current = performance.now();
                acquirePosition();
                runTick();
              }
            }}
          >
            <span className="cs-hold__inner">
              <span className="cs-hold__num">{remainSec}</span>
              <span className="cs-hold__hint">{hint}</span>
            </span>
          </button>
        </div>

        {armed && (
          <button type="button" className="cs-cancel" onClick={cancelArmed}>
            취소
          </button>
        )}

        <div className="cs-foot">장난으로 누르면 엄마·아빠가 깜짝 놀랄 수 있어 🙏</div>
      </div>
    </div>
  );
}

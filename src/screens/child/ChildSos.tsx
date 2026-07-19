import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronLeft } from "lucide-react";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { useAuth } from "@/auth/AuthContext";
import { useSendSos } from "@/queries/useSos";
import { useMyFamily } from "@/queries/useFamily";
import { placePhoneCall } from "@/lib/native/phone";
import { ScreenQueryState } from "@/components/ui/ScreenQueryState";
import { resolveQueryTruthState } from "@/transform/queryTruthState";
import "./ChildSos.css";

type Phase = "idle" | "sending" | "sent" | "error";

/** 시안대로 3초를 꾹 눌러야 발사된다(오발사 방지). */
const HOLD_MS = 3000;

/**
 * 아이 SOS — 3초 꾹 → 보호자에게 위치와 함께 긴급 알림.
 *
 * 발사 계약은 바꾸지 않았다(생명안전): 홀드 시작 시 위치를 1회 취득하고, 홀드가 끝나면
 * `useSendSos` 로 위치 upsert → parent_alert → sos_events 3단계를 태운다.
 * parent_alerts 접수(`alertSent === true`)까지 성공했을 때만 전송 시작으로 표시하고,
 * 기기 표시 완료를 단정하지 않는다. 실패하면 재시도·전화 경로를 준다. 세션당 발사는 1회(sentRef).
 */
export function ChildSos() {
  const navigate = useNavigate();
  const { show } = useToast();
  const { familyId } = useAuth();
  const sos = useSendSos();
  const familyQuery = useMyFamily();
  const family = familyQuery.data;
  const sosFamilyQueryState = resolveQueryTruthState([
    { isLoading: familyQuery.isLoading, isError: familyQuery.isError },
  ]);
  const sosFamilyDataMissing = sosFamilyQueryState === "ready" && family === undefined;
  const retrySosFamily = async (): Promise<void> => {
    await familyQuery.refetch();
  };

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
    void placePhoneCall(number).then((r) => {
      if (!r.ok) show("전화를 걸 수 없어. 전화 앱을 확인해 줘", "⚠️");
    });
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

  if (!familyId) {
    return (
      <ScreenQueryState
        screenTitle="SOS"
        state="empty"
        heading="연결된 가족 정보가 없어"
        description="SOS를 받을 가족을 다시 연결한 뒤 사용할 수 있어."
        onBack={() => navigate(-1)}
        onRetry={() => navigate("/onboarding")}
        retryLabel="연결 화면으로 가기"
      />
    );
  }

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
          <div className="cs-result__title">SOS를 접수했어!</div>
          <div className="cs-result__sub">보호자에게 전송을 시작했어. 안전한 곳에서 기다려</div>

          <div className="cs-checks">
            <div className="cs-checks__row">
              <span className="cs-checks__dot">
                <Check size={17} strokeWidth={3} color="var(--mint-500)" />
              </span>
              <span className="cs-checks__text">
                {posRef.current ? "지금 위치도 SOS에 담았어" : "위치는 못 찾았지만 SOS는 접수했어"}
              </span>
            </div>
            <div className="cs-checks__row">
              <span className="cs-checks__dot">
                <Check size={17} strokeWidth={3} color="var(--mint-500)" />
              </span>
              <span className="cs-checks__text">보호자에게 알림 전송을 시작했어</span>
            </div>
          </div>

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

          <button type="button" className="cs-ghost hy-press" onClick={() => navigate("/child/home")}>
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
          엄마·아빠에게 SOS를 보내고 찾은 <b>내 위치</b>도 함께 담을게
        </div>

        {sosFamilyQueryState === "loading" && (
          <div className="cs-query-note" aria-live="polite">
            가족 정보를 확인 중이야. 기다리지 않고 SOS를 보낼 수 있어.
          </div>
        )}

        {(sosFamilyQueryState === "error" || sosFamilyDataMissing) && (
          <div className="cs-query-note cs-query-note--error" role="alert">
            <span>가족 이름과 전화번호는 못 불러왔지만 SOS 알림은 보낼 수 있어.</span>
            <button
              type="button"
              className="cs-query-retry hy-press"
              onClick={() => void retrySosFamily()}
              disabled={familyQuery.isFetching}
            >
              {familyQuery.isFetching ? "다시 확인 중…" : "가족 정보 다시 확인"}
            </button>
          </div>
        )}

        {sosFamilyQueryState === "ready" && !sosFamilyDataMissing && parents.length === 0 && (
          <div className="cs-query-note">
            전화할 보호자 번호는 아직 없지만 SOS 알림은 그대로 보낼 수 있어.
          </div>
        )}

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
          <button type="button" className="cs-cancel hy-press" onClick={cancelArmed}>
            취소
          </button>
        )}

        <div className="cs-foot">장난으로 누르면 엄마·아빠가 깜짝 놀랄 수 있어 🙏</div>
      </div>
    </div>
  );
}

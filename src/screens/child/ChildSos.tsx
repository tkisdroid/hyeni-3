import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useNavigate } from "react-router";
import { Check, ChevronLeft } from "lucide-react";
import { FormattedMessage, useIntl } from "react-intl";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { useSafeBack } from "@/app/useSafeBack";
import { useAuth } from "@/auth/AuthContext";
import { useSendSos } from "@/queries/useSos";
import { useMyFamily } from "@/queries/useFamily";
import { placePhoneCall } from "@/lib/native/phone";
import { ScreenQueryState } from "@/components/ui/ScreenQueryState";
import { resolveQueryTruthState } from "@/transform/queryTruthState";
import "@/styles/jua.css";
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
  const intl = useIntl();
  const navigate = useNavigate();
  const goBack = useSafeBack("/child/home");
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
  const posRef = useRef<{ lat: number; lng: number; capturedAtMs: number } | null>(null);
  const sentRef = useRef(false);

  const parents = family?.members.filter((m) => m.role === "parent") ?? [];
  const mom = parents.find((p) => p.gender === "mom") ?? null;
  const dad = parents.find((p) => p.gender === "dad") ?? null;
  const momLabel = intl.formatMessage({ id: "child.family.mom" });
  const dadLabel = intl.formatMessage({ id: "child.family.dad" });
  const parentLabel = mom && dad
    ? intl.formatMessage({ id: "child.family.parents" })
    : mom
      ? momLabel
      : dad
        ? dadLabel
        : intl.formatMessage({ id: "child.family.guardians" });

  const callParent = (gender: "mom" | "dad", label: string) => {
    const number = parents.find((p) => p.gender === gender)?.phone;
    if (!number) {
      show(intl.formatMessage({ id: "child.sos.phoneMissing" }, { name: label }), "📞");
      return;
    }
    show(intl.formatMessage({ id: "child.sos.calling" }, { name: label }), "📞");
    void placePhoneCall(number).then((r) => {
      if (!r.ok) show(intl.formatMessage({ id: "child.sos.callFailed" }), "⚠️");
    });
  };

  // 위치는 홀드가 시작될 때 1회만 읽는다(발송 아님). 거부/실패해도 SOS 는 위치 없이 나간다.
  const acquirePosition = () => {
    posRef.current = null;
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (p) => {
        posRef.current = {
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          capturedAtMs: p.timestamp,
        };
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
      {
        lat: posRef.current?.lat ?? null,
        lng: posRef.current?.lng ?? null,
        capturedAtMs: posRef.current?.capturedAtMs ?? null,
      },
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

  const beginPointerHold = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (phase !== "idle" || holding.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    beginHold();
  };

  const endPointerHold = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    endHold();
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
  const hint = intl.formatMessage({ id: progress > 0 ? "child.sos.keepHolding" : "child.sos.hintHold" });
  const ringBg = `conic-gradient(#FFE1E8 ${progress * 360}deg, rgba(255,255,255,.35) 0deg)`;

  if (!familyId) {
    return (
      <ScreenQueryState
        screenTitle={intl.formatMessage({ id: "child.sos.title" })}
        state="empty"
        heading={intl.formatMessage({ id: "child.familyConnection.missing" })}
        description={intl.formatMessage({ id: "child.sos.familyMissingDescription" })}
        onBack={goBack}
        onRetry={() => navigate("/onboarding")}
        retryLabel={intl.formatMessage({ id: "child.action.goToConnection" })}
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
          <div className="cs-result__title">{intl.formatMessage({ id: "child.sos.sending" })}</div>
          <div className="cs-result__sub">
            {intl.formatMessage({ id: "child.sos.sendingTo" }, { name: parentLabel })}
          </div>
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
          <div className="cs-result__title">{intl.formatMessage({ id: "child.sos.sendFailed" })}</div>
          <div className="cs-result__sub">
            <FormattedMessage id="child.sos.sendFailedDescription" values={{ br: () => <br /> }} />
          </div>
          <button type="button" className="cs-callbtn hy-press" onClick={retrySos} disabled={sos.isPending} aria-busy={sos.isPending}>
            <span>{intl.formatMessage({ id: "child.sos.sendAgain" })}</span>
          </button>
          {mom && (
            <button type="button" className="cs-callbtn cs-callbtn--slim hy-press" onClick={() => callParent("mom", momLabel)}>
              <img src={asset("family/mom.webp")} alt="" />
              <span>{intl.formatMessage({ id: "child.sos.callTo" }, { name: momLabel })}</span>
            </button>
          )}
          {dad && (
            <button type="button" className="cs-callbtn cs-callbtn--slim hy-press" onClick={() => callParent("dad", dadLabel)}>
              <img src={asset("family/dad.webp")} alt="" />
              <span>{intl.formatMessage({ id: "child.sos.callTo" }, { name: dadLabel })}</span>
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
          <div className="cs-result__title">{intl.formatMessage({ id: "child.sos.accepted" })}</div>
          <div className="cs-result__sub">{intl.formatMessage({ id: "child.sos.acceptedDescription" })}</div>

          <div className="cs-checks">
            <div className="cs-checks__row">
              <span className="cs-checks__dot">
                <Check size={17} strokeWidth={3} color="var(--mint-500)" />
              </span>
              <span className="cs-checks__text">
                {intl.formatMessage({
                  id: posRef.current ? "child.sos.locationIncluded" : "child.sos.locationMissing",
                })}
              </span>
            </div>
            <div className="cs-checks__row">
              <span className="cs-checks__dot">
                <Check size={17} strokeWidth={3} color="var(--mint-500)" />
              </span>
              <span className="cs-checks__text">{intl.formatMessage({ id: "child.sos.notificationStarted" })}</span>
            </div>
          </div>

          {mom && (
            <button type="button" className="cs-callbtn cs-callbtn--slim hy-press" onClick={() => callParent("mom", momLabel)}>
              <img src={asset("family/mom.webp")} alt="" />
              <span>{intl.formatMessage({ id: "child.sos.callTo" }, { name: momLabel })}</span>
            </button>
          )}
          {dad && (
            <button type="button" className="cs-callbtn cs-callbtn--slim hy-press" onClick={() => callParent("dad", dadLabel)}>
              <img src={asset("family/dad.webp")} alt="" />
              <span>{intl.formatMessage({ id: "child.sos.callTo" }, { name: dadLabel })}</span>
            </button>
          )}

          <button type="button" className="cs-ghost hy-press" onClick={() => navigate("/child/home")}>
            {intl.formatMessage({ id: "child.sos.goHome" })}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="cs-root">
      <div className="cs-page">
        <button type="button" className="cs-back hy-press" aria-label={intl.formatMessage({ id: "child.action.back" })} onClick={goBack}>
          <ChevronLeft size={22} strokeWidth={2.6} color="var(--bg-card)" />
        </button>

        <img className="cs-shield" src={asset("ui/sos-shield.webp")} alt="" />
        <div className="cs-title">{intl.formatMessage({ id: "child.sos.mainTitle" })}</div>
        <div className="cs-desc">
          <FormattedMessage
            id="child.sos.mainDescription"
            values={{ strong: (chunks) => <b>{chunks}</b>, br: () => <br /> }}
          />
        </div>

        {sosFamilyQueryState === "loading" && (
          <div className="cs-query-note" aria-live="polite">
            {intl.formatMessage({ id: "child.sos.familyLoading" })}
          </div>
        )}

        {(sosFamilyQueryState === "error" || sosFamilyDataMissing) && (
          <div className="cs-query-note cs-query-note--error" role="alert">
            <span>{intl.formatMessage({ id: "child.sos.familyLoadFailed" })}</span>
            <button
              type="button"
              className="cs-query-retry hy-press"
              onClick={() => void retrySosFamily()}
              disabled={familyQuery.isFetching} aria-busy={familyQuery.isFetching}
            >
              {intl.formatMessage({
                id: familyQuery.isFetching ? "child.action.checkingAgain" : "child.sos.checkFamilyAgain",
              })}
            </button>
          </div>
        )}

        {sosFamilyQueryState === "ready" && !sosFamilyDataMissing && parents.length === 0 && (
          <div className="cs-query-note">
            {intl.formatMessage({ id: "child.sos.noGuardianPhone" })}
          </div>
        )}

        <div className="cs-holder">
          <span className="cs-holder__ring" />
          <span className="cs-holder__ring cs-holder__ring--b" />
          <button
            type="button"
            className="cs-hold hy-press"
            aria-label={intl.formatMessage({ id: "child.sos.holdAria" })}
            style={{ background: ringBg }}
            onPointerDown={beginPointerHold}
            onPointerUp={endPointerHold}
            onPointerCancel={endPointerHold}
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
            {intl.formatMessage({ id: "child.action.cancel" })}
          </button>
        )}

        <div className="cs-foot">{intl.formatMessage({ id: "child.sos.warning" })}</div>
      </div>
    </div>
  );
}

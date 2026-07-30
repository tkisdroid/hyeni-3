import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, RefreshCw, Share2, Copy } from "lucide-react";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { useMyFamily, useRegeneratePairCode } from "@/queries/useFamily";
import { QrCode } from "@/components/ui/QrCode";
import { buildPairLink } from "@/transform/pairLink";
import type { FamilyMember } from "@/lib/api/endpoints/family";
import {
  advanceChildInviteConnection,
  type ChildInviteConnectionState,
} from "@/transform/childInviteConnection";
import "./ChildInvite.css";

/** 만료까지 남은 시간 표시 + 만료 여부. 무기한(expiresAt 없음)이면 null. */
function useCountdown(expiresAt: Date | null): { text: string; expired: boolean } | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  if (!expiresAt) return null;
  const left = Math.max(0, Math.floor((expiresAt.getTime() - now) / 1000));
  if (left === 0) return { text: "만료됨", expired: true };
  // 다일/다시간 만료는 mm:ss 오버플로 방지 — 큰 값은 일·시간·분 단위로.
  if (left >= 86400) {
    const d = Math.floor(left / 86400);
    const h = Math.floor((left % 86400) / 3600);
    return { text: h > 0 ? `${d}일 ${h}시간` : `${d}일`, expired: false };
  }
  if (left >= 3600) {
    const h = Math.floor(left / 3600);
    const m = Math.floor((left % 3600) / 60);
    return { text: `${h}시간 ${m}분`, expired: false };
  }
  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");
  return { text: `${mm}:${ss}`, expired: false };
}

/**
 * 아이 초대/연결 (와이어프레임 P-05 초대코드·QR).
 * 실 페어링 코드 + QR 표시 · 공유 · 복사 · 재발급 · 만료 타이머 ·
 * 아이 연결 감지 폴링 → 연결되면 자동으로 가족 화면으로 안내.
 */
export function ChildInvite() {
  const navigate = useNavigate();
  const { show } = useToast();
  // 대기 화면이므로 6초 폴링으로 아이 연결을 감지한다.
  const {
    data: family,
    isLoading,
    isError,
    isSuccess,
    refetch: refetchFamily,
  } = useMyFamily({ pollMs: 6000 });
  const regen = useRegeneratePairCode();

  const pairCode = family?.pairCode ?? "";
  const expiresAt = family?.pairCodeExpiresAt ?? null;
  const countdown = useCountdown(expiresAt);
  const expired = countdown?.expired ?? false;

  const pairLink = useMemo(() => (pairCode ? buildPairLink(pairCode) : ""), [pairCode]);

  // 연결 감지 — "연결된 자녀 uid 집합"에 baseline 에 없던 uid 가 나타나면 성공.
  // 개수 비교는 supersede 페어링(기기 교체·무료 슬롯 대체: 서버가 옛 행을 제외해 N→N)을
  // 영원히 못 잡으므로, 집합 변화(새 uid 등장)로 판정한다.
  const childUids = useMemo(
    () =>
      (family?.members ?? [])
        .filter((m: FamilyMember) => m.role === "child" && !!m.user_id)
        .map((m) => m.user_id as string)
        .sort(),
    [family],
  );
  const connectionRef = useRef<ChildInviteConnectionState>({ baseline: null, notified: false });
  useEffect(() => {
    const status = isSuccess && family ? "success" : isError ? "error" : "loading";
    const result = advanceChildInviteConnection(connectionRef.current, { status, childUids });
    connectionRef.current = result.state;
    if (result.newChildUid) {
      show("아이가 연결됐어요! 🎉", "🔗");
      const t = setTimeout(() => navigate("/parent/family"), 1200);
      return () => clearTimeout(t);
    }
  }, [childUids, family, isError, isSuccess, navigate, show]);

  const copyCode = () => {
    if (!pairCode) return;
    const clip = navigator.clipboard;
    if (!clip?.writeText) {
      show(`복사를 지원하지 않아요 · 코드 ${pairCode}`, "✏️");
      return;
    }
    clip.writeText(pairCode).then(
      () => show("연결 코드를 복사했어요", "📋"),
      () => show(`복사를 못 했어요 · 코드 ${pairCode}`, "✏️"),
    );
  };

  const shareLink = async () => {
    if (!pairCode) return;
    const text = `혜니캘린더 아이 연결\n연결 코드: ${pairCode}\n${pairLink}`;
    // Web Share API 우선(모바일 네이티브 공유 시트). 미지원 시 링크 복사로 대체.
    if (navigator.share) {
      try {
        await navigator.share({ title: "혜니캘린더 아이 연결", text });
        return;
      } catch {
        // 사용자가 공유 취소 → 조용히 종료(성공 단언 금지).
        return;
      }
    }
    const clip = navigator.clipboard;
    if (clip?.writeText) {
      clip.writeText(text).then(
        () => show("연결 링크를 복사했어요", "🔗"),
        () => show(`코드 ${pairCode} 를 직접 전달해 주세요`, "✏️"),
      );
    } else {
      show(`코드 ${pairCode} 를 직접 전달해 주세요`, "✏️");
    }
  };

  const regenerate = () => {
    if (regen.isPending) return;
    connectionRef.current = { ...connectionRef.current, notified: false };
    regen.mutate(undefined, {
      onSuccess: () => show("새 연결 코드를 발급했어요", "🔄"),
      onError: (e) => show(e instanceof Error ? e.message : "재발급에 실패했어요", "⚠️"),
    });
  };

  return (
    <div className="ci-screen">
      <div className="ci-header">
        <button type="button" className="ci-back hy-press" aria-label="뒤로" onClick={() => navigate(-1)}>
          <ChevronLeft size={22} strokeWidth={2.2} color="#4A4145" />
        </button>
        <span className="ci-title">아이 초대</span>
      </div>

      <div className="ci-content">
        <div className="ci-headline">아이 기기에서 스캔</div>
        <div className="ci-lead">
          아이 휴대폰 카메라로 QR을 찍거나
          <br />
          아래 코드를 직접 입력하면 연결돼요
        </div>

        {/* QR 카드 */}
        <div className="ci-qr-card">
          {isLoading ? (
            <div className="ci-qr-skeleton">불러오는 중…</div>
          ) : isError ? (
            <div className="ci-qr-skeleton ci-qr-skeleton--error" role="alert">
              <span>연결 코드를 불러오지 못했어요</span>
              <button type="button" className="ci-regen hy-press" onClick={() => void refetchFamily()}>
                다시 시도
              </button>
            </div>
          ) : pairLink && !expired ? (
            <QrCode value={pairLink} size={212} label="아이 연결 QR 코드" />
          ) : !pairCode ? (
            <div className="ci-qr-skeleton" role="status">사용할 수 있는 연결 코드가 없어요</div>
          ) : (
            <div className="ci-qr-skeleton">
              코드가 만료됐어요{"\n"}새 코드를 발급해 주세요
            </div>
          )}
        </div>

        {/* 코드 + 만료 타이머 */}
        <div className="ci-code-row">
          <span className={expired ? "ci-code ci-code--expired" : "ci-code"}>
            {isLoading ? "불러오는 중…" : pairCode || "코드 없음"}
          </span>
          {countdown && (
            <span className={expired ? "ci-timer ci-timer--expired" : "ci-timer"}>
              {expired ? "만료됨" : `${countdown.text} 남음`}
            </span>
          )}
        </div>

        {/* 액션 */}
        <div className="ci-actions">
          <button type="button" className="ci-btn ci-btn--copy hy-press" onClick={copyCode} disabled={!pairCode}>
            <Copy size={16} strokeWidth={2.4} style={{ verticalAlign: "-3px", marginRight: 4 }} />
            코드 복사
          </button>
          <button type="button" className="ci-btn ci-btn--share hy-press" onClick={shareLink} disabled={!pairCode}>
            <Share2 size={16} strokeWidth={2.4} style={{ verticalAlign: "-3px", marginRight: 4 }} />
            공유하기
          </button>
        </div>

        <button
          type="button"
          className="ci-regen hy-press"
          onClick={regenerate}
          disabled={regen.isPending} aria-busy={regen.isPending}
        >
          <RefreshCw size={15} strokeWidth={2.4} style={{ verticalAlign: "-2px", marginRight: 4 }} />
          {regen.isPending ? "발급 중…" : "새 코드 발급"}
        </button>

        {/* 연결 대기 상태 */}
        <div className="ci-wait">
          <span className="ci-wait__dot" />
          아이가 연결되면 자동으로 넘어가요
        </div>

        <img className="ci-mascot" src={asset("mascot/phone.webp")} alt="" />
      </div>
    </div>
  );
}

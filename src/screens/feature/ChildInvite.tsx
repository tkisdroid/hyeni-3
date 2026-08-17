import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useIntl } from "react-intl";
import { localizeApiError } from "@/i18n/apiError";
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
import { useLocale } from "@/i18n/useLocale";
import { formatCountdownDuration } from "@/i18n/format";
import "./ChildInvite.css";

/** 만료까지 남은 시간 표시 + 만료 여부. 무기한(expiresAt 없음)이면 null. */
function useCountdown(
  expiresAt: Date | null,
  locale: Parameters<typeof formatCountdownDuration>[1],
): { text: string; expired: boolean } | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  if (!expiresAt) return null;
  const left = Math.max(0, Math.floor((expiresAt.getTime() - now) / 1000));
  return formatCountdownDuration(left, locale);
}

/**
 * 아이 초대/연결 (와이어프레임 P-05 초대코드·QR).
 * 실 페어링 코드 + QR 표시 · 공유 · 복사 · 재발급 · 만료 타이머 ·
 * 아이 연결 감지 폴링 → 연결되면 자동으로 가족 화면으로 안내.
 */
export function ChildInvite() {
  const { locale } = useLocale();
  const intl = useIntl();
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
  const countdown = useCountdown(expiresAt, locale);
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
      show(intl.formatMessage({ id: "parent.childInvite.connected" }), "🔗");
      const t = setTimeout(() => navigate("/parent/family"), 1200);
      return () => clearTimeout(t);
    }
  }, [childUids, family, isError, isSuccess, navigate, show]);

  const copyCode = () => {
    if (!pairCode) return;
    const clip = navigator.clipboard;
    if (!clip?.writeText) {
      show(intl.formatMessage(
        { id: "parent.childInvite.copyUnsupported" },
        { pairCode },
      ), "✏️");
      return;
    }
    clip.writeText(pairCode).then(
      () => show(intl.formatMessage({ id: "parent.childInvite.copied" }), "📋"),
      () => show(intl.formatMessage(
        { id: "parent.childInvite.copyFailed" },
        { pairCode },
      ), "✏️"),
    );
  };

  const shareLink = async () => {
    if (!pairCode) return;
    const text = intl.formatMessage(
      { id: "parent.childInvite.shareText" },
      { pairCode, pairLink },
    );
    // Web Share API 우선(모바일 네이티브 공유 시트). 미지원 시 링크 복사로 대체.
    if (navigator.share) {
      try {
        await navigator.share({
          title: intl.formatMessage({ id: "parent.childInvite.shareTitle" }),
          text,
        });
        return;
      } catch {
        // 사용자가 공유 취소 → 조용히 종료(성공 단언 금지).
        return;
      }
    }
    const clip = navigator.clipboard;
    if (clip?.writeText) {
      clip.writeText(text).then(
        () => show(intl.formatMessage({ id: "parent.childInvite.linkCopied" }), "🔗"),
        () => show(intl.formatMessage(
          { id: "parent.childInvite.shareFallback" },
          { pairCode },
        ), "✏️"),
      );
    } else {
      show(intl.formatMessage(
        { id: "parent.childInvite.shareFallback" },
        { pairCode },
      ), "✏️");
    }
  };

  const regenerate = () => {
    if (regen.isPending) return;
    connectionRef.current = { ...connectionRef.current, notified: false };
    regen.mutate(undefined, {
      onSuccess: () => show(intl.formatMessage({ id: "parent.childInvite.regenerated" }), "🔄"),
      onError: (e) => show(localizeApiError(e, intl, "formal"), "⚠️"),
    });
  };

  return (
    <div className="ci-screen">
      <div className="ci-header">
        <button
          type="button"
          className="ci-back hy-press"
          aria-label={intl.formatMessage({ id: "parent.childInvite.back" })}
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} strokeWidth={2.2} color="#4A4145" />
        </button>
        <span className="ci-title">
          {intl.formatMessage({ id: "parent.childInvite.screenTitle" })}
        </span>
      </div>

      <div className="ci-content">
        <div className="ci-headline">
          {intl.formatMessage({ id: "parent.childInvite.headline" })}
        </div>
        <div className="ci-lead">
          {intl.formatMessage({ id: "parent.childInvite.lead1" })}
          <br />
          {intl.formatMessage({ id: "parent.childInvite.lead2" })}
        </div>

        {/* QR 카드 */}
        <div className="ci-qr-card">
          {isLoading ? (
            <div className="ci-qr-skeleton">
              {intl.formatMessage({ id: "parent.childInvite.loading" })}
            </div>
          ) : isError ? (
            <div className="ci-qr-skeleton ci-qr-skeleton--error" role="alert">
              <span>{intl.formatMessage({ id: "parent.childInvite.loadError" })}</span>
              <button type="button" className="ci-regen hy-press" onClick={() => void refetchFamily()}>
                {intl.formatMessage({ id: "parent.childInvite.retry" })}
              </button>
            </div>
          ) : pairLink && !expired ? (
            <QrCode
              value={pairLink}
              size={212}
              label={intl.formatMessage({ id: "parent.childInvite.qrLabel" })}
            />
          ) : !pairCode ? (
            <div className="ci-qr-skeleton" role="status">
              {intl.formatMessage({ id: "parent.childInvite.noCode" })}
            </div>
          ) : (
            <div className="ci-qr-skeleton">
              {intl.formatMessage({ id: "parent.childInvite.expiredLine1" })}
              {"\n"}
              {intl.formatMessage({ id: "parent.childInvite.expiredLine2" })}
            </div>
          )}
        </div>

        {/* 코드 + 만료 타이머 */}
        <div className="ci-code-row">
          <span className={expired ? "ci-code ci-code--expired" : "ci-code"}>
            {isLoading
              ? intl.formatMessage({ id: "parent.childInvite.loading" })
              : pairCode || intl.formatMessage({ id: "parent.childInvite.codeNone" })}
          </span>
          {countdown && (
            <span className={expired ? "ci-timer ci-timer--expired" : "ci-timer"}>
              {expired
                ? intl.formatMessage({ id: "parent.childInvite.expiredStatus" })
                : intl.formatMessage(
                    { id: "core.time.remaining" },
                    { duration: countdown.text },
                  )}
            </span>
          )}
        </div>

        {/* 액션 — 코드가 만료되면 복사·공유는 의미가 없으므로 잠그고, 재발급을 주 CTA 로 올린다. */}
        <div className="ci-actions">
          <button
            type="button"
            className="ci-btn ci-btn--copy hy-press"
            onClick={copyCode}
            disabled={!pairCode || expired}
          >
            <Copy size={16} strokeWidth={2.4} style={{ verticalAlign: "-3px", marginRight: 4 }} />
            {intl.formatMessage({ id: "parent.childInvite.copyAction" })}
          </button>
          <button
            type="button"
            className="ci-btn ci-btn--share hy-press"
            onClick={shareLink}
            disabled={!pairCode || expired}
          >
            <Share2 size={16} strokeWidth={2.4} style={{ verticalAlign: "-3px", marginRight: 4 }} />
            {intl.formatMessage({ id: "parent.childInvite.shareAction" })}
          </button>
        </div>

        <button
          type="button"
          className={expired ? "ci-regen ci-regen--primary hy-press" : "ci-regen hy-press"}
          onClick={regenerate}
          disabled={regen.isPending} aria-busy={regen.isPending}
        >
          <RefreshCw size={15} strokeWidth={2.4} style={{ verticalAlign: "-2px", marginRight: 4 }} />
          {intl.formatMessage({
            id: regen.isPending
              ? "parent.childInvite.issuing"
              : expired
                ? "parent.childInvite.issueExpired"
                : "parent.childInvite.issue",
          })}
        </button>

        {/* 연결 대기 상태 */}
        <div className="ci-wait">
          <span className="ci-wait__dot" />
          {intl.formatMessage({ id: "parent.childInvite.waiting" })}
        </div>

        <img className="ci-mascot" src={asset("mascot/phone.webp")} alt="" />
      </div>
    </div>
  );
}

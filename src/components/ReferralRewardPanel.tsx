import { useEffect, useId, useRef, useState } from "react";
import { CheckCircle2, Copy, Gift, RefreshCw, Share2, X } from "lucide-react";
import { useToast } from "@/app/toast";
import { PUBLIC_WEB_BASE } from "@/config/env";
import { useDialogFocusLifecycle } from "./useDialogFocusLifecycle";
import { useEnsureReferralCode, useReferralStatus } from "@/queries/useReferrals";
import { buildReferralLink } from "@/transform/referralLink";
import "./ReferralRewardPanel.css";
import { useIntl } from "react-intl";
import { localizeApiError } from "@/i18n/apiError";

export interface ReferralEligibleChild {
  userId: string;
  name: string;
}

export function ReferralRewardPanel({
  open,
  onClose,
  eligibleChildren,
}: {
  open: boolean;
  onClose: () => void;
  eligibleChildren: readonly ReferralEligibleChild[];
}) {
  const { show } = useToast();
  const intl = useIntl();
  const titleId = useId();
  const descriptionId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const statusQuery = useReferralStatus(open);
  const ensureCode = useEnsureReferralCode();
  const status = statusQuery.data;
  const [selectedChild, setSelectedChild] = useState("");
  const selectionTouchedRef = useRef(false);
  const busy = ensureCode.isPending;
  const dialogRef = useDialogFocusLifecycle<HTMLDivElement>({
    open,
    onClose,
    initialFocusRef: closeRef,
    canClose: () => !busy,
  });

  useEffect(() => {
    if (!open) {
      selectionTouchedRef.current = false;
      setSelectedChild("");
      return;
    }
    const preferred = status?.rewardChildUserId;
    const validPreferred = eligibleChildren.some((child) => child.userId === preferred);
    const validSelected = eligibleChildren.some((child) => child.userId === selectedChild);
    if (!selectionTouchedRef.current && validPreferred && selectedChild !== preferred) {
      setSelectedChild(preferred as string);
      return;
    }
    if (!validSelected) {
      selectionTouchedRef.current = false;
      setSelectedChild(validPreferred ? preferred as string : eligibleChildren[0]?.userId ?? "");
    }
  }, [eligibleChildren, open, selectedChild, status?.rewardChildUserId]);

  if (!open) return null;

  const saveCode = () => {
    if (!selectedChild || busy) return;
    ensureCode.mutate(selectedChild, {
      onSuccess: (next) => {
        show(next.code ? intl.formatMessage({ id: "parent.referralRewardPanel.copy001" }) : intl.formatMessage({ id: "parent.referralRewardPanel.copy002" }), "🎁");
      },
      onError: (error) => show(localizeApiError(error, intl, "formal"), "⚠️"),
    });
  };

  const invitationText = status?.code
    ? intl.formatMessage(
      { id: "parent.referralRewardPanel.shareBody" },
      { link: buildReferralLink(PUBLIC_WEB_BASE, status.code) },
    )
    : "";

  const copyInvitation = async () => {
    if (!invitationText || !status?.code) return;
    if (!navigator.clipboard?.writeText) {
      show(intl.formatMessage(
        { id: "parent.referralRewardPanel.clipboardUnsupported" },
        { code: status.code },
      ), "✏️");
      return;
    }
    try {
      await navigator.clipboard.writeText(invitationText);
      show(intl.formatMessage({ id: "parent.referralRewardPanel.copy003" }), "📋");
    } catch {
      show(intl.formatMessage(
        { id: "parent.referralRewardPanel.clipboardFailed" },
        { code: status.code },
      ), "✏️");
    }
  };

  const shareInvitation = async () => {
    if (!invitationText || !status?.code) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: intl.formatMessage({ id: "parent.referralRewardPanel.copy004" }), text: invitationText });
        return;
      } catch {
        // 공유 시트 취소는 실패로 알리지 않는다.
        return;
      }
    }
    await copyInvitation();
  };

  return (
    <div className="rrp" role="presentation">
      <button
        type="button"
        className="rrp__scrim"
        tabIndex={-1}
        aria-label={intl.formatMessage({ id: "parent.referralRewardPanel.copy005" })}
        onClick={() => !busy && onClose()}
      />
      <div
        ref={dialogRef}
        className="rrp__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        <header className="rrp__header">
          <span className="rrp__header-icon" aria-hidden="true"><Gift size={22} /></span>
          <div className="rrp__header-copy">
            <h2 id={titleId}>{intl.formatMessage({ id: "parent.referralRewardPanel.copy006" })}</h2>
            <p id={descriptionId}>{intl.formatMessage({ id: "parent.referralRewardPanel.copy007" })}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="rrp__close hy-press"
            aria-label={intl.formatMessage({ id: "parent.parentSettings.copy027" })}
            onClick={onClose}
            disabled={busy}
            aria-busy={busy}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <div className="rrp__body">
          <section className="rrp__policy" aria-label={intl.formatMessage({ id: "parent.referralRewardPanel.copy008" })}>
            <div className="rrp__reward">{intl.formatMessage({ id: "parent.referralRewardPanel.copy009" })}</div>
            <p>{intl.formatMessage({ id: "parent.referralRewardPanel.copy010" })}</p>
            <ol>
              <li>{intl.formatMessage({ id: "parent.referralRewardPanel.copy011" })}</li>
              <li>{intl.formatMessage({ id: "parent.referralRewardPanel.copy012" })}</li>
              <li>{intl.formatMessage({ id: "parent.referralRewardPanel.copy013" })}</li>
            </ol>
            <small>{intl.formatMessage({ id: "parent.referralRewardPanel.copy014" })}</small>
          </section>

          {statusQuery.isLoading ? (
            <div className="rrp__state" role="status">{intl.formatMessage({ id: "parent.referralRewardPanel.copy015" })}</div>
          ) : statusQuery.isError ? (
            <div className="rrp__state" role="alert">
              <span>{intl.formatMessage({ id: "parent.referralRewardPanel.copy016" })}</span>
              <button type="button" className="rrp__retry hy-press" onClick={() => void statusQuery.refetch()}>
                <RefreshCw size={17} aria-hidden="true" /> {intl.formatMessage({ id: "parent.parentHome.copy017" })}
              </button>
            </div>
          ) : eligibleChildren.length === 0 ? (
            <div className="rrp__state" role="status">
              {intl.formatMessage({ id: "parent.referralRewardPanel.copy017" })}
            </div>
          ) : status ? (
            <>
              <section className="rrp__progress" aria-label={intl.formatMessage({ id: "parent.referralRewardPanel.copy018" })}>
                <span><CheckCircle2 size={18} aria-hidden="true" /> {intl.formatMessage({ id: "parent.referralRewardPanel.copy019" })} {status.successfulCount}/{status.successCap}</span>
                <span>{intl.formatMessage({ id: "parent.parentHome.copy033" })} {status.pendingCount}{intl.formatMessage({ id: "parent.category.family" })}</span>
              </section>

              <label className="rrp__field" htmlFor="referral-reward-child">
                <span>{intl.formatMessage({ id: "parent.referralRewardPanel.copy020" })}</span>
                <select
                  id="referral-reward-child"
                  value={selectedChild}
                  onChange={(event) => {
                    selectionTouchedRef.current = true;
                    setSelectedChild(event.target.value);
                  }}
                  disabled={busy}
                >
                  {eligibleChildren.map((child) => (
                    <option key={child.userId} value={child.userId}>{child.name}</option>
                  ))}
                </select>
              </label>

              {status.code ? (
                <div
                  className="rrp__code"
                  aria-label={intl.formatMessage(
                    { id: "parent.referralRewardPanel.inviteCodeAria" },
                    { code: status.code },
                  )}
                >
                  {status.code}
                </div>
              ) : (
                <div className="rrp__code rrp__code--empty">{intl.formatMessage({ id: "parent.referralRewardPanel.copy021" })}</div>
              )}

              {status.rewardChildUserId !== selectedChild || !status.code ? (
                <button
                  type="button"
                  className="rrp__save hy-press"
                  onClick={saveCode}
                  disabled={!selectedChild || busy || !status.canInvite}
                  aria-busy={busy}
                >
                  {busy ? intl.formatMessage({ id: "parent.referralRewardPanel.copy022" }) : status.code ? intl.formatMessage({ id: "parent.referralRewardPanel.copy023" }) : intl.formatMessage({ id: "parent.referralRewardPanel.copy024" })}
                </button>
              ) : null}

              <div className="rrp__actions">
                <button
                  type="button"
                  className="rrp__action rrp__action--copy hy-press"
                  onClick={() => void copyInvitation()}
                  disabled={!status.code || !status.canInvite}
                >
                  <Copy size={18} aria-hidden="true" /> {intl.formatMessage({ id: "parent.referralRewardPanel.copy025" })}
                </button>
                <button
                  type="button"
                  className="rrp__action rrp__action--share hy-press"
                  onClick={() => void shareInvitation()}
                  disabled={!status.code || !status.canInvite}
                >
                  <Share2 size={18} aria-hidden="true" /> {intl.formatMessage({ id: "parent.referralRewardPanel.copy026" })}
                </button>
              </div>
              {!status.canInvite && (
                <p className="rrp__complete" role="status">{intl.formatMessage({ id: "parent.referralRewardPanel.copy027" })}</p>
              )}
            </>
          ) : (
            <div className="rrp__state" role="status">{intl.formatMessage({ id: "parent.referralRewardPanel.copy028" })}</div>
          )}
        </div>
      </div>
    </div>
  );
}

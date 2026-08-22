import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useIntl } from "react-intl";
import { ChevronLeft, ChevronRight, Copy, RefreshCw, Share2, Smartphone, UserPlus } from "lucide-react";
import { localizeApiError } from "@/i18n/apiError";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { useMyFamily, useRegeneratePairCode } from "@/queries/useFamily";
import { QrCode } from "@/components/ui/QrCode";
import { buildPairLink, type PairInviteRole } from "@/transform/pairLink";
import type { FamilyMember } from "@/lib/api/endpoints/family";
import {
  advanceChildInviteConnection,
  type ChildInviteConnectionState,
} from "@/transform/childInviteConnection";
import { useLocale } from "@/i18n/useLocale";
import { formatCountdownDuration } from "@/i18n/format";
import "./ChildInvite.css";

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

function InviteRoleChoice() {
  const intl = useIntl();
  const navigate = useNavigate();
  const familyQuery = useMyFamily();
  const family = familyQuery.data;
  const coParent = family?.members.find(
    (member) =>
      member.role === "parent"
      && member.user_id
      && member.user_id !== family.primaryParentId,
  );
  const canInviteCoParent = Boolean(family?.isPrimaryParent && !coParent);
  const guardianName = coParent?.name || intl.formatMessage({ id: "parent.familyConnection.guardianFallback" });

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
          {intl.formatMessage({ id: "parent.parentFamily.connectionTargetTitle" })}
        </span>
      </div>

      <div className="ci-content">
        <div className="ci-headline">
          {intl.formatMessage({ id: "parent.familyInvite.choice.headline" })}
        </div>
        <div className="ci-lead">
          {intl.formatMessage({ id: "parent.parentFamily.connectionTargetDescription" })}
        </div>

        {familyQuery.isLoading ? (
          <div className="ci-role-state" role="status">
            {intl.formatMessage({ id: "parent.childInvite.loading" })}
          </div>
        ) : familyQuery.isError ? (
          <div className="ci-role-state ci-role-state--error" role="alert">
            <span>{intl.formatMessage({ id: "parent.childInvite.loadError" })}</span>
            <button type="button" className="ci-regen hy-press" onClick={() => void familyQuery.refetch()}>
              {intl.formatMessage({ id: "parent.childInvite.retry" })}
            </button>
          </div>
        ) : (
          <div className="ci-role-list">
            <button
              type="button"
              className="ci-role-card hy-press"
              onClick={() => navigate("/child-invite?role=child", { replace: true })}
            >
              <span className="ci-role-card__icon ci-role-card__icon--child">
                <Smartphone size={24} strokeWidth={2.2} />
              </span>
              <span className="ci-role-card__main">
                <span className="ci-role-card__title">
                  {intl.formatMessage({ id: "parent.familyInvite.choice.childTitle" })}
                </span>
                <span className="ci-role-card__description">
                  {intl.formatMessage({ id: "parent.familyInvite.choice.childDescription" })}
                </span>
              </span>
              <ChevronRight size={20} strokeWidth={2.4} color="var(--fg-disabled)" />
            </button>

            <button
              type="button"
              className="ci-role-card hy-press"
              onClick={() => navigate(canInviteCoParent ? "/child-invite?role=parent" : "/family-connection", { replace: true })}
            >
              <span className="ci-role-card__icon ci-role-card__icon--parent">
                <UserPlus size={24} strokeWidth={2.2} />
              </span>
              <span className="ci-role-card__main">
                <span className="ci-role-card__title">
                  {intl.formatMessage({
                    id: canInviteCoParent
                      ? "parent.familyInvite.choice.parentTitle"
                      : "parent.parentFamily.guardianSlotOccupied",
                  })}
                </span>
                <span className="ci-role-card__description">
                  {intl.formatMessage(
                    {
                      id: canInviteCoParent
                        ? "parent.familyInvite.choice.parentDescription"
                        : "parent.parentFamily.guardianSlotOccupiedDescription",
                    },
                    { guardianName },
                  )}
                </span>
              </span>
              <ChevronRight size={20} strokeWidth={2.4} color="var(--fg-disabled)" />
            </button>
          </div>
        )}

        <img className="ci-mascot" src={asset("mascot/family.webp")} alt="" />
      </div>
    </div>
  );
}

function RoleSpecificInvite({ inviteRole }: { inviteRole: PairInviteRole }) {
  const { locale } = useLocale();
  const intl = useIntl();
  const navigate = useNavigate();
  const { show } = useToast();
  const parentInvite = inviteRole === "parent";
  const connectedMessageId = parentInvite
    ? "parent.familyConnection.coParentConnected"
    : "parent.childInvite.connected";
  const {
    data: family,
    isLoading,
    isError,
    isSuccess,
    refetch: refetchFamily,
  } = useMyFamily({ pollMs: 6000 });
  const regen = useRegeneratePairCode();

  const coParent = family?.members.find(
    (member) =>
      member.role === "parent"
      && member.user_id
      && member.user_id !== family.primaryParentId,
  );
  const canInviteCoParent = Boolean(family?.isPrimaryParent && !coParent);
  const parentInviteBlocked = Boolean(parentInvite && isSuccess && family && !canInviteCoParent);
  const guardianName = coParent?.name || intl.formatMessage({ id: "parent.familyConnection.guardianFallback" });
  const pairCode = parentInviteBlocked ? "" : family?.pairCode ?? "";
  const expiresAt = family?.pairCodeExpiresAt ?? null;
  const countdown = useCountdown(expiresAt, locale);
  const expired = countdown?.expired ?? false;
  const pairLink = useMemo(
    () => (pairCode ? buildPairLink(pairCode, inviteRole) : ""),
    [inviteRole, pairCode],
  );

  const memberUids = useMemo(
    () =>
      (family?.members ?? [])
        .filter((member: FamilyMember) => member.role === inviteRole && !!member.user_id)
        .map((member) => member.user_id as string)
        .sort(),
    [family, inviteRole],
  );
  const connectionRef = useRef<ChildInviteConnectionState>({ baseline: null, notified: false });
  useEffect(() => {
    connectionRef.current = { baseline: null, notified: false };
  }, [inviteRole]);
  useEffect(() => {
    const status = isSuccess && family ? "success" : isError ? "error" : "loading";
    const result = advanceChildInviteConnection(connectionRef.current, { status, childUids: memberUids });
    connectionRef.current = result.state;
    if (result.newChildUid) {
      show(intl.formatMessage({ id: connectedMessageId }), "🔗");
      const timer = setTimeout(() => navigate("/parent/family"), 1200);
      return () => clearTimeout(timer);
    }
  }, [connectedMessageId, family, isError, isSuccess, memberUids, navigate, show]);

  const copyCode = () => {
    if (!pairCode) return;
    const clipboard = navigator.clipboard;
    if (!clipboard?.writeText) {
      show(intl.formatMessage({ id: "parent.childInvite.copyUnsupported" }, { pairCode }), "✏️");
      return;
    }
    clipboard.writeText(pairCode).then(
      () => show(intl.formatMessage({ id: "parent.childInvite.copied" }), "📋"),
      () => show(intl.formatMessage({ id: "parent.childInvite.copyFailed" }, { pairCode }), "✏️"),
    );
  };

  const shareLink = async () => {
    if (!pairCode) return;
    const text = intl.formatMessage(
      { id: parentInvite ? "parent.familyInvite.parent.shareText" : "parent.childInvite.shareText" },
      { pairCode, pairLink },
    );
    if (navigator.share) {
      try {
        await navigator.share({
          title: intl.formatMessage({
            id: parentInvite
              ? "parent.familyConnection.inviteCoParent"
              : "parent.childInvite.shareTitle",
          }),
          text,
        });
        return;
      } catch {
        return;
      }
    }
    const clipboard = navigator.clipboard;
    if (clipboard?.writeText) {
      clipboard.writeText(text).then(
        () => show(intl.formatMessage({ id: "parent.childInvite.linkCopied" }), "🔗"),
        () => show(intl.formatMessage({ id: "parent.childInvite.shareFallback" }, { pairCode }), "✏️"),
      );
    } else {
      show(intl.formatMessage({ id: "parent.childInvite.shareFallback" }, { pairCode }), "✏️");
    }
  };

  const regenerate = () => {
    if (regen.isPending) return;
    connectionRef.current = { ...connectionRef.current, notified: false };
    regen.mutate(undefined, {
      onSuccess: () => show(intl.formatMessage({ id: "parent.childInvite.regenerated" }), "🔄"),
      onError: (error) => show(localizeApiError(error, intl, "formal"), "⚠️"),
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
          {intl.formatMessage({
            id: parentInvite
              ? "parent.familyConnection.inviteCoParent"
              : "parent.childInvite.screenTitle",
          })}
        </span>
      </div>

      <div className="ci-content">
        <div className="ci-headline">
          {intl.formatMessage({
            id: parentInvite
              ? "parent.familyConnection.inviteCoParent"
              : "parent.childInvite.headline",
          })}
        </div>
        <div className="ci-lead">
          {intl.formatMessage({
            id: parentInvite ? "parent.familyInvite.parent.lead1" : "parent.childInvite.lead1",
          })}
          <br />
          {intl.formatMessage({
            id: parentInvite ? "parent.familyInvite.parent.lead2" : "parent.childInvite.lead2",
          })}
        </div>

        {parentInviteBlocked ? (
          <div className="ci-occupied" role="alert">
            <span className="ci-occupied__icon"><UserPlus size={28} strokeWidth={2.1} /></span>
            <strong>{intl.formatMessage({ id: "parent.parentFamily.guardianSlotOccupied" })}</strong>
            <p>
              {intl.formatMessage(
                { id: "parent.parentFamily.guardianSlotOccupiedDescription" },
                { guardianName },
              )}
            </p>
            <button type="button" className="ci-btn ci-btn--manage hy-press" onClick={() => navigate("/family-connection", { replace: true })}>
              {intl.formatMessage({ id: "parent.parentFamily.manageGuardian" })}
            </button>
          </div>
        ) : (
          <>
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
                  label={intl.formatMessage({
                    id: parentInvite
                      ? "parent.familyConnection.viewCode"
                      : "parent.childInvite.qrLabel",
                  })}
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
                    : intl.formatMessage({ id: "core.time.remaining" }, { duration: countdown.text })}
                </span>
              )}
            </div>

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
              disabled={regen.isPending}
              aria-busy={regen.isPending}
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

            <div className="ci-wait">
              <span className="ci-wait__dot" />
              {intl.formatMessage({
                id: parentInvite
                  ? "parent.familyInvite.parent.waiting"
                  : "parent.childInvite.waiting",
              })}
            </div>
          </>
        )}

        <img
          className="ci-mascot"
          src={asset(parentInvite ? "mascot/family.webp" : "mascot/phone.webp")}
          alt=""
        />
      </div>
    </div>
  );
}

/** 역할 선택 뒤에만 아이 또는 공동 보호자 전용 QR을 발급한다. */
export function ChildInvite() {
  const [searchParams] = useSearchParams();
  const requestedRole = searchParams.get("role");
  const roleChoiceInvite = requestedRole !== "child" && requestedRole !== "parent";
  if (roleChoiceInvite) return <InviteRoleChoice />;
  const inviteRole: PairInviteRole = requestedRole;
  return <RoleSpecificInvite inviteRole={inviteRole} />;
}

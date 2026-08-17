import { useState } from "react";
import { useIntl, type IntlShape } from "react-intl";
import { ChevronLeft, MapPin, Check, PartyPopper } from "lucide-react";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import {
  usePendingPlaydateInvites,
  useActivePlaydateSession,
  useAcceptPlaydateInvite,
  useDeclinePlaydateInvite,
} from "@/queries/usePlaydate";
import type { PlaydateInvite } from "@/lib/api/endpoints/playdate";
import { hasJongseong } from "@/transform/adventureMap";
import { useSafeBack } from "@/app/useSafeBack";
import { Loading } from "@/components/ui/Loading";
import { useLocale } from "@/i18n/useLocale";
import { formatRelativeMinutes } from "@/i18n/format";
import type { SupportedLocale } from "@/i18n/locale";
import "./PlaydateAccept.css";
import { isApiError } from "@/lib/api/errors";

/** 친구 아바타(도메인엔 이름만 있어 index 파생). */
const FRIEND_ANIMALS = ["animal/bear.webp", "animal/fox.webp", "animal/cat.webp", "animal/rabbit.webp"];

/** 서버 에러코드 → 아이 눈높이 안내(반말). */
function friendlyError(e: unknown, intl: IntlShape): string {
  const m = isApiError(e) ? e.code : null;
  if (m === "forbidden") return intl.formatMessage({ id: "shared.playdateAccept.errorForbidden" });
  if (m === "invite_expired") return intl.formatMessage({ id: "shared.playdateAccept.errorExpired" });
  if (m === "invite_not_pending") return intl.formatMessage({ id: "shared.playdateAccept.errorHandled" });
  if (m === "already_active") return intl.formatMessage({ id: "shared.playdateAccept.errorActive" });
  return intl.formatMessage({ id: "shared.playdateAccept.errorDefault" });
}

/** expires_at(ISO) → "N분 후 만료" 라벨(만료면 null). */
function expiresLabel(
  expiresAt: string | null,
  locale: SupportedLocale,
  intl: IntlShape,
): string | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (Number.isNaN(ms) || ms <= 0) return null;
  const mins = Math.max(1, Math.round(ms / 60000));
  return intl.formatMessage(
    { id: "shared.playdateAccept.expires" },
    { relative: formatRelativeMinutes(mins, "future", locale) },
  );
}

export function PlaydateAccept() {
  const { locale } = useLocale();
  const intl = useIntl();
  const goBack = useSafeBack("/child/home");
  const { show } = useToast();
  const [busyAction, setBusyAction] = useState<{ inviteId: string; action: "accept" | "decline" } | null>(null);

  const pendingQ = usePendingPlaydateInvites();
  const activeQ = useActivePlaydateSession();
  const accept = useAcceptPlaydateInvite();
  const decline = useDeclinePlaydateInvite();

  const active = activeQ.data ?? null;
  const incoming = (pendingQ.data ?? []).filter(
    (i) => i.direction === "incoming" && i.status === "pending",
  );
  const playdateLoading = pendingQ.isLoading || activeQ.isLoading;
  const playdateError = pendingQ.isError || activeQ.isError;
  const retryPlaydates = async () => {
    await Promise.all([pendingQ.refetch(), activeQ.refetch()]);
  };

  const onAccept = async (invite: PlaydateInvite) => {
    setBusyAction({ inviteId: invite.id, action: "accept" });
    try {
      await accept.mutateAsync(invite.id);
      show(intl.formatMessage({ id: "shared.playdateAccept.toastAccepted" }), "🎈");
      await Promise.all([pendingQ.refetch(), activeQ.refetch()]);
    } catch (e) {
      show(friendlyError(e, intl), "🎈");
    } finally {
      setBusyAction(null);
    }
  };

  const onDecline = async (invite: PlaydateInvite) => {
    setBusyAction({ inviteId: invite.id, action: "decline" });
    try {
      await decline.mutateAsync(invite.id);
      show(intl.formatMessage({ id: "shared.playdateAccept.toastDeclined" }), "🎈");
      await pendingQ.refetch();
    } catch (e) {
      show(friendlyError(e, intl), "🎈");
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="pa-screen">
      <div className="pa-header">
        <button
          type="button"
          className="pa-back hy-press"
          aria-label={intl.formatMessage({ id: "shared.playdateAccept.back" })}
          onClick={goBack}
        >
          <ChevronLeft size={22} strokeWidth={2.2} color="var(--fg-secondary)" />
        </button>
        <span className="pa-header__title">
          {intl.formatMessage({ id: "shared.playdateAccept.screenTitle" })}
        </span>
      </div>

      <div className="pa-content">
        <p className="pa-intro">
          {intl.formatMessage({ id: "shared.playdateAccept.introBefore" })}{" "}
          <b>{intl.formatMessage({ id: "shared.playdateAccept.introAccept" })}</b>
          {intl.formatMessage({ id: "shared.playdateAccept.introAfter" })}
        </p>

        {/* 진행 중 세션(연결됨) */}
        {active ? (
          <div className="pa-active">
            <span className="pa-active__badge">
              <Check size={14} strokeWidth={2.6} color="var(--mint-text)" />
              {intl.formatMessage({ id: "shared.playdateAccept.activeBadge" })}
            </span>
            <span className="pa-active__text">
              {intl.formatMessage(
                {
                  id: active.place_name?.trim()
                    ? "shared.playdateAccept.activeWithPlace"
                    : "shared.playdateAccept.active",
                },
                {
                  friend: locale === "ko"
                    ? `${active.friend_child_name?.trim()
                      || intl.formatMessage({ id: "shared.playdateAccept.friendFallback" })}${
                      hasJongseong(active.friend_child_name?.trim()
                        || intl.formatMessage({ id: "shared.playdateAccept.friendFallback" }))
                        ? "과"
                        : "와"
                    }`
                    : active.friend_child_name?.trim()
                      || intl.formatMessage({ id: "shared.playdateAccept.friendFallback" }),
                  place: active.place_name?.trim() || "",
                },
              )}
            </span>
          </div>
        ) : null}

        {playdateLoading ? (
          <div className="pa-empty" role="status">
            <div className="pa-empty__title">
              <Loading label={intl.formatMessage({ id: "shared.playdateAccept.loading" })} />
            </div>
          </div>
        ) : playdateError ? (
          <div className="pa-empty" role="alert">
            <div className="pa-empty__title">
              {intl.formatMessage({ id: "shared.playdateAccept.loadErrorTitle" })}
            </div>
            <div className="pa-empty__sub">
              {intl.formatMessage({ id: "shared.playdateAccept.loadErrorDescription" })}
            </div>
            <button type="button" className="pa-btn-accept hy-press" onClick={() => void retryPlaydates()}>
              {intl.formatMessage({ id: "shared.playdateAccept.retry" })}
            </button>
          </div>
        ) : incoming.length === 0 ? (
          <div className="pa-empty">
            <img className="pa-empty__img" src={asset("ui/menu-friend-playdate.webp")} alt="" />
            <div className="pa-empty__title">
              {intl.formatMessage({ id: "shared.playdateAccept.emptyTitle" })}
            </div>
            <div className="pa-empty__sub">
              {intl.formatMessage({ id: "shared.playdateAccept.emptyDescription" })}
            </div>
          </div>
        ) : (
          incoming.map((r, i) => {
            const expires = expiresLabel(r.expires_at, locale, intl);
            const friendName = r.friend_child_name?.trim()
              || intl.formatMessage({ id: "shared.playdateAccept.friendFallback" });
            const busy = busyAction?.inviteId === r.id;
            const accepting = busy && busyAction.action === "accept";
            const declining = busy && busyAction.action === "decline";
            return (
              <div key={r.id} className="hy-card pa-card">
                <div className="pa-card__head">
                  <span className="pa-avatars">
                    <span className="pa-avatar">
                      <img
                        src={asset(FRIEND_ANIMALS[i % FRIEND_ANIMALS.length])}
                        alt=""
                      />
                    </span>
                  </span>
                  <span className="pa-who">
                    <span className="pa-who__name">
                      {intl.formatMessage(
                        { id: "shared.playdateAccept.friendLabel" },
                        { friendName },
                      )}
                    </span>
                    <span className="pa-who__when">
                      {intl.formatMessage(
                        {
                          id: expires
                            ? "shared.playdateAccept.whenWithExpiry"
                            : "shared.playdateAccept.when",
                        },
                        { expires: expires || "" },
                      )}
                    </span>
                  </span>
                </div>

                <div className="pa-place">
                  <MapPin size={14} strokeWidth={2} color="var(--fg-muted)" />
                  {r.place_name?.trim()
                    || intl.formatMessage({ id: "shared.playdateAccept.placeFallback" })}
                </div>

                <div className="pa-note">
                  {intl.formatMessage(
                    { id: "shared.playdateAccept.inviteNote" },
                    {
                      friend: locale === "ko"
                        ? `${friendName}${hasJongseong(friendName) ? "이랑" : "랑"}`
                        : friendName,
                    },
                  )}
                </div>

                <div className="pa-actions">
                  <button
                    type="button"
                    className="pa-btn-decline hy-press"
                    onClick={() => onDecline(r)}
                    disabled={busy}
                    aria-busy={declining}
                  >
                    {intl.formatMessage({ id: "shared.playdateAccept.decline" })}
                  </button>
                  <button
                    type="button"
                    className="pa-btn-accept hy-press"
                    onClick={() => onAccept(r)}
                    disabled={busy}
                    aria-busy={accepting}
                  >
                    <PartyPopper size={18} strokeWidth={2.2} aria-hidden="true" />
                    {intl.formatMessage({
                      id: accepting
                        ? "shared.playdateAccept.accepting"
                        : "shared.playdateAccept.accept",
                    })}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

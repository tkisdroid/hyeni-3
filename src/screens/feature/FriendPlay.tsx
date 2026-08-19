import { ChevronLeft } from "lucide-react";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { useAuth } from "@/auth/AuthContext";
import {
  usePlaydateCandidates,
  usePendingPlaydateInvites,
  useActivePlaydateSession,
  useCreatePlaydateInvite,
  useEndPlaydate,
  usePlaydateEnabled,
  useSetPlaydateEnabled,
} from "@/queries/usePlaydate";
import type { PlaydateCandidate } from "@/lib/api/endpoints/playdate";
import { playdateCandidateNotice } from "@/transform/playdateNotice";
import { hasJongseong } from "@/transform/adventureMap";
import { useSafeBack } from "@/app/useSafeBack";
import { Loading } from "@/components/ui/Loading";
import { useIntl } from "react-intl";
import { localizeApiError } from "@/i18n/apiError";
import { useLocale } from "@/i18n/useLocale";
import "./FriendPlay.css";

/** 친구 놀이요청 진행 단계 안내. */
const STEP_IDS = [
  "shared.friendPlay.child.step1",
  "shared.friendPlay.child.step2",
  "shared.friendPlay.child.step3",
] as const;

/** 후보에 캐릭터/배경색 부여(도메인엔 이름만 있어 표현은 index 파생). */
const FRIEND_ANIMALS = ["animal/rabbit.webp", "animal/bear.webp", "animal/fox.webp", "animal/cat.webp"];
const FRIEND_SOFTS = ["#FDE7F1", "#E7F8F0", "#FFF3D6", "#E6F2FB"];

function ParentPlaydateQueryState({
  loading,
  onBack,
  onRetry,
}: {
  loading: boolean;
  onBack: () => void;
  onRetry: () => void;
}) {
  const intl = useIntl();
  return (
    <div className="fp-screen">
      <div className="fp-header">
        <button
          type="button"
          className="fp-back hy-press"
          aria-label={intl.formatMessage({ id: "shared.friendPlay.back" })}
          onClick={onBack}
        >
          <ChevronLeft size={22} strokeWidth={2.2} color="var(--fg-secondary)" />
        </button>
        <span className="fp-header__title">
          {intl.formatMessage({ id: "shared.friendPlay.parent.screenTitle" })}
        </span>
      </div>
      <div className="fp-content">
        <div className="fp-empty" role={loading ? "status" : "alert"}>
          {loading
            ? <Loading label={intl.formatMessage({ id: "shared.friendPlay.parent.loading" })} />
            : <span>{intl.formatMessage({ id: "shared.friendPlay.parent.loadError" })}</span>}
          {!loading && (
            <button type="button" className="fp-cta hy-press" onClick={onRetry}>
              {intl.formatMessage({ id: "shared.friendPlay.retry" })}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** 후보 soft error → 아이 눈높이 안내(반말). */

export function FriendPlay() {
  const { show } = useToast();
  const intl = useIntl();
  const { locale } = useLocale();
  const { role } = useAuth();

  const isParent = role === "parent";
  const goBack = useSafeBack(isParent ? "/parent/home" : "/child/home");
  const candidatesQ = usePlaydateCandidates(!isParent);
  const pendingQ = usePendingPlaydateInvites();
  const activeQ = useActivePlaydateSession();
  const createInvite = useCreatePlaydateInvite();
  const endPlaydate = useEndPlaydate();
  const enabledQ = usePlaydateEnabled();
  const setEnabled = useSetPlaydateEnabled();

  const active = activeQ.data ?? null;
  const candidates = candidatesQ.data?.candidates ?? [];
  const softError = candidatesQ.data?.error;
  const outgoing = (pendingQ.data ?? []).filter(
    (i) => i.direction === "outgoing" && i.status === "pending",
  );

  const canSend = role === "child";
  const sending = createInvite.isPending;

  const playdateEnabled = enabledQ.data?.playdate_enabled === true;
  const parentPlaydateReady = enabledQ.isSuccess && activeQ.isSuccess && pendingQ.isSuccess;
  const parentPlaydateLoading = enabledQ.isLoading || activeQ.isLoading || pendingQ.isLoading;
  const parentPlaydateError = enabledQ.isError
    || activeQ.isError
    || pendingQ.isError
    || (!parentPlaydateLoading && !parentPlaydateReady);
  const retryParentPlaydate = async () => {
    await Promise.all([
      enabledQ.refetch(),
      activeQ.refetch(),
      pendingQ.refetch(),
    ]);
  };

  const togglePlaydateEnabled = () => {
    if (!isParent || parentPlaydateLoading || parentPlaydateError || !enabledQ.data || setEnabled.isPending) return;
    const next = !playdateEnabled;
    setEnabled.mutate(next, {
      onSuccess: () => show(intl.formatMessage({
        id: next
          ? "shared.friendPlay.parent.toastEnabled"
          : "shared.friendPlay.parent.toastDisabled",
      }), "🎈"),
      onError: () => show(
        intl.formatMessage({ id: "shared.friendPlay.parent.toastSaveError" }),
        "⚠️",
      ),
    });
  };

  const onSend = async () => {
    if (candidates.length === 0) return;
    try {
      const results = await Promise.allSettled(
        candidates.map((c: PlaydateCandidate) => createInvite.mutateAsync(c)),
      );
      const ok = results.filter((r) => r.status === "fulfilled").length;
      if (ok > 0) {
        show(intl.formatMessage({ id: "shared.friendPlay.child.sentCount" }, { count: ok }), "🎈");
        await pendingQ.refetch();
      } else {
        const first = results.find((r) => r.status === "rejected") as
          | PromiseRejectedResult
          | undefined;
        show(localizeApiError(first?.reason, intl, "child"), "😢");
      }
    } catch (e) {
      show(localizeApiError(e, intl, "child"), "😢");
    }
  };

  const onEnd = async () => {
    if (!active) return;
    try {
      await endPlaydate.mutateAsync({
        sessionId: active.id,
        reason: role === "child" ? "child_end" : "parent_end",
      });
      show(
        intl.formatMessage({
          id: isParent
            ? "shared.friendPlay.parent.toastEnded"
            : "shared.friendPlay.child.toastEnded",
        }),
        "👋",
      );
    } catch (e) {
      show(
        isParent
          ? intl.formatMessage({ id: "shared.friendPlay.parent.toastEndError" })
          : localizeApiError(e, intl, "child"),
        "😢",
      );
    }
  };

  const notice = playdateCandidateNotice(
    softError,
    candidates.length === 0,
    candidatesQ.isError,
    intl,
  );

  if (role === "parent") {
    if (parentPlaydateLoading) {
      return <ParentPlaydateQueryState loading onBack={goBack} onRetry={() => undefined} />;
    }
    if (parentPlaydateError) {
      return (
        <ParentPlaydateQueryState
          loading={false}
          onBack={goBack}
          onRetry={() => void retryParentPlaydate()}
        />
      );
    }
    return (
      <div className="fp-screen">
        <div className="fp-header">
          <button
            type="button"
            className="fp-back hy-press"
            aria-label={intl.formatMessage({ id: "shared.friendPlay.back" })}
            onClick={goBack}
          >
            <ChevronLeft size={22} strokeWidth={2.2} color="var(--fg-secondary)" />
          </button>
          <span className="fp-header__title">
            {intl.formatMessage({ id: "shared.friendPlay.parent.screenTitle" })}
          </span>
        </div>

        <div className="fp-content">
          <div className="fp-hero fp-hero--parent">
            <img className="fp-hero__mascot" src={asset("ui/menu-friend-playdate.webp")} alt="" />
            <div className="fp-hero__title">
              {intl.formatMessage({ id: "shared.friendPlay.parent.screenTitle" })}
            </div>
            <div className="fp-hero__sub">
              {intl.formatMessage({ id: "shared.friendPlay.parent.heroDescription" })}
              <br />
              {intl.formatMessage({ id: "shared.friendPlay.parent.heroConditions" })}
            </div>
          </div>

          <button
            type="button"
            className="fp-setting hy-press"
            aria-pressed={playdateEnabled}
            onClick={togglePlaydateEnabled}
            disabled={enabledQ.isLoading || setEnabled.isPending} aria-busy={enabledQ.isLoading || setEnabled.isPending}
          >
            <span className="fp-setting__icon" aria-hidden="true">
              <img src={asset("ui/clay/playdate.webp")} alt="" />
            </span>
            <span className="fp-setting__main">
              <span className="fp-setting__title">
                {intl.formatMessage({ id: "shared.friendPlay.parent.settingTitle" })}
              </span>
              <span className="fp-setting__sub">
                {intl.formatMessage({
                  id: playdateEnabled
                    ? "shared.friendPlay.parent.settingEnabled"
                    : "shared.friendPlay.parent.settingDisabled",
                })}
              </span>
            </span>
            <span className="fp-setting__switch" data-on={playdateEnabled}>
              <span className="fp-setting__knob" />
            </span>
          </button>

          <div className="fp-parent-card">
            <div className="fp-parent-card__title">
              {intl.formatMessage({ id: "shared.friendPlay.parent.criteriaTitle" })}
            </div>
            <div className="fp-parent-rule">
              <span>{intl.formatNumber(1)}</span>
              {intl.formatMessage({ id: "shared.friendPlay.parent.criteria1" })}
            </div>
            <div className="fp-parent-rule">
              <span>{intl.formatNumber(2)}</span>
              {intl.formatMessage({ id: "shared.friendPlay.parent.criteria2" })}
            </div>
            <div className="fp-parent-rule">
              <span>{intl.formatNumber(3)}</span>
              {intl.formatMessage({ id: "shared.friendPlay.parent.criteria3" })}
            </div>
          </div>

          {active ? (
            <div className="fp-connected fp-connected--parent">
              <div className="fp-connected__badge">
                {intl.formatMessage({ id: "shared.friendPlay.parent.activeBadge" })}
              </div>
              <div className="fp-connected__friend">
                {active.friend_child_name?.trim()
                  || intl.formatMessage({ id: "shared.friendPlay.friendFallback" })}
              </div>
              {active.place_name ? (
                <div className="fp-connected__place">
                  <img src={asset("ui/clay/location.webp")} alt="" />
                  {active.place_name}
                </div>
              ) : null}
              <button
                type="button"
                className="fp-end hy-press"
                onClick={onEnd}
                disabled={endPlaydate.isPending} aria-busy={endPlaydate.isPending}
              >
                {intl.formatMessage({ id: "shared.friendPlay.parent.end" })}
              </button>
            </div>
          ) : (
            <div className="fp-note fp-note--parent">
              {intl.formatMessage({ id: "shared.friendPlay.parent.empty" })}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fp-screen">
      <div className="fp-header">
        <button
          type="button"
          className="fp-back hy-press"
          aria-label={intl.formatMessage({ id: "shared.friendPlay.back" })}
          onClick={goBack}
        >
          <ChevronLeft size={22} strokeWidth={2.2} color="var(--fg-secondary)" />
        </button>
        <span className="fp-header__title">
          {intl.formatMessage({ id: "shared.friendPlay.child.screenTitle" })}
        </span>
      </div>

      <div className="fp-content">
        {/* 히어로 */}
        <div className="fp-hero">
          <img className="fp-hero__mascot" src={asset("ui/menu-friend-playdate.webp")} alt="" />
          <div className="fp-hero__title">
            {intl.formatMessage({
              id: active
                ? "shared.friendPlay.child.heroActive"
                : "shared.friendPlay.child.heroIdle",
            })}
          </div>
          <div className="fp-hero__sub">
            {active ? (
              <>
                {intl.formatMessage(
                  { id: "shared.friendPlay.child.activeMeeting" },
                  {
                    friend: locale === "ko"
                      ? `${active.friend_child_name?.trim()
                        || intl.formatMessage({ id: "shared.friendPlay.friendFallback" })}${
                        hasJongseong(active.friend_child_name?.trim()
                          || intl.formatMessage({ id: "shared.friendPlay.friendFallback" }))
                          ? "이랑"
                          : "랑"
                      }`
                      : active.friend_child_name?.trim()
                        || intl.formatMessage({ id: "shared.friendPlay.friendFallback" }),
                  },
                )}
                <br />
                {intl.formatMessage({ id: "shared.friendPlay.child.activeHelp" })}
              </>
            ) : (
              <>
                {intl.formatMessage({ id: "shared.friendPlay.child.idleLine1" })}
                <br />
                {intl.formatMessage({ id: "shared.friendPlay.child.idleLine2" })}
              </>
            )}
          </div>
        </div>

        {active ? (
          /* ── 연결됨 상태 ─────────────────────────────── */
          <div className="fp-connected">
            <div className="fp-connected__badge">
              <img src={asset("ui/clay/playdate.webp")} alt="" />
              {intl.formatMessage({ id: "shared.friendPlay.child.connected" })}
            </div>
            <div className="fp-connected__friend">
              {active.friend_child_name?.trim()
                || intl.formatMessage({ id: "shared.friendPlay.friendFallback" })}
            </div>
            {active.place_name ? (
              <div className="fp-connected__place">
                <img src={asset("ui/clay/location.webp")} alt="" />
                {active.place_name}
              </div>
            ) : null}
            <button
              type="button"
              className="fp-end hy-press"
              onClick={onEnd}
              disabled={endPlaydate.isPending} aria-busy={endPlaydate.isPending}
            >
              {intl.formatMessage({ id: "shared.friendPlay.child.end" })}
            </button>
          </div>
        ) : (
          <>
            {/* 근처 친구 */}
            <div className="fp-card">
              <div className="fp-card__title">
                {intl.formatMessage(
                  { id: "shared.friendPlay.child.nearbyCount" },
                  { count: candidates.length },
                )}
              </div>
              {candidatesQ.isLoading ? (
                <div className="fp-empty">
                  {intl.formatMessage({ id: "shared.friendPlay.child.finding" })}
                </div>
              ) : candidatesQ.isError ? (
                <div className="fp-empty" role="alert">
                  <span>{notice ?? intl.formatMessage({ id: "shared.friendPlay.child.findError" })}</span>
                  <button type="button" className="fp-cta hy-press" onClick={() => void candidatesQ.refetch()}>
                    {intl.formatMessage({ id: "shared.friendPlay.retry" })}
                  </button>
                </div>
              ) : candidates.length > 0 ? (
                <div className="fp-friends">
                  {candidates.map((f, i) => (
                    <div key={f.child_user_id} className="fp-friend">
                      <div
                        className="fp-friend__avatar"
                        style={{ background: FRIEND_SOFTS[i % FRIEND_SOFTS.length] }}
                      >
                        <img src={asset(FRIEND_ANIMALS[i % FRIEND_ANIMALS.length])} alt="" />
                      </div>
                      <div className="fp-friend__name">{f.child_name}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="fp-empty">
                  {notice ?? intl.formatMessage({ id: "shared.friendPlay.child.findingShort" })}
                </div>
              )}
            </div>

            {/* 진행 안내 */}
            <div className="fp-steps">
              {STEP_IDS.map((id, index) => (
                <div key={id} className="fp-step">
                  <span className="fp-step__num">{index + 1}</span>
                  <span className="fp-step__text">{intl.formatMessage({ id })}</span>
                </div>
              ))}
            </div>

            {/* 발신 상태 / 보내기 */}
            {outgoing.length > 0 ? (
              <div className="fp-waiting">
                <img src={asset("ui/clay/playdate.webp")} alt="" />
                {intl.formatMessage({ id: "shared.friendPlay.child.waiting" })}
              </div>
            ) : !canSend ? (
              <div className="fp-note">
                {intl.formatMessage({ id: "shared.friendPlay.parent.childDeviceOnly" })}
              </div>
            ) : (
              <button
                type="button"
                className="fp-cta hy-press"
                onClick={onSend}
                disabled={sending || candidates.length === 0} aria-busy={sending}
              >
                <img className="fp-cta__icon" src={asset("ui/clay/playdate.webp")} alt="" />
                {intl.formatMessage({
                  id: sending
                    ? "shared.friendPlay.child.sending"
                    : "shared.friendPlay.child.send",
                })}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

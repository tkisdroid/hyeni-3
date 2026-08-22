import { useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { ChevronLeft, ChevronRight, UserPlus, Link2Off, Wifi } from "lucide-react";
import { asset } from "@/lib/assets";
import { DEFAULT_CHILD_AVATAR, parentAvatarPath } from "@/lib/avatar";
import { useToast } from "@/app/toast";
import { useDialogFocusLifecycle } from "@/components/useDialogFocusLifecycle";
import { useMyFamily, useUnpairChild } from "@/queries/useFamily";
import { useChildLocations } from "@/queries/useLocation";
import { mapFamilyToView } from "@/transform/familyView";
import { resolveDeviceLabel } from "@/transform/deviceLabel";
import { formatFreshness } from "@/transform/locationView";
import { useLocale } from "@/i18n/useLocale";
import { resolveFamilyConnectionChildSubject } from "@/transform/familyConnectionSubject";
import { Loading } from "@/components/ui/Loading";
import "./FamilyConnection.css";
import { useIntl } from "react-intl";
import { localizeApiError } from "@/i18n/apiError";

// 자녀 사진은 인증 fetch로 만든 blob URL, 기본 아바타는 asset 경로.
function avatarSrc(path: string): string {
  return path.startsWith("http") || path.startsWith("blob:") ? path : asset(path);
}

interface UnpairTarget {
  memberId: string;
  userId: string;
  name: string;
}

/**
 * 연결 상태 · 해제 (와이어프레임 P-06).
 * 실 가족 데이터로 연결된 아이 기기 상태 표시 + (주 보호자) 연결 해제(확인 모달) +
 * 공동 보호자 초대(연결 코드 공유). 데이터·권한은 모두 서버 /api/family/mine 기준.
 */
export function FamilyConnection() {
  const { locale } = useLocale();
  const intl = useIntl();
  const navigate = useNavigate();
  const { show } = useToast();
  const now = useMemo(() => new Date(), []);

  const familyQuery = useMyFamily();
  const locationsQuery = useChildLocations();
  const family = familyQuery.data;
  const locations = locationsQuery.data;
  const connectionLoading = familyQuery.isLoading || locationsQuery.isLoading;
  const connectionError = familyQuery.isError || locationsQuery.isError;
  const connectionErrorValue = familyQuery.error ?? locationsQuery.error;
  const retryFamilyConnection = async () => {
    await Promise.all([familyQuery.refetch(), locationsQuery.refetch()]);
  };
  const unpair = useUnpairChild();

  const [confirm, setConfirm] = useState<UnpairTarget | null>(null);
  const confirmTitleId = useId();
  const confirmDescriptionId = useId();
  const confirmCancelRef = useRef<HTMLButtonElement>(null);
  const confirmDialogRef = useDialogFocusLifecycle<HTMLDivElement>({
    open: confirm !== null,
    onClose: () => setConfirm(null),
    initialFocusRef: confirmCancelRef,
    canClose: () => !unpair.isPending,
  });

  const members = useMemo(() => family?.members ?? [], [family]);
  const view = useMemo(() => mapFamilyToView(members, null), [members]);

  // 연결된 아이(user_id 존재) vs 대기 중(placeholder).
  const children = useMemo(() => members.filter((m) => m.role === "child"), [members]);
  const connected = useMemo(() => children.filter((c) => c.user_id), [children]);
  const pending = useMemo(() => children.filter((c) => !c.user_id), [children]);

  // 공동 보호자 = 주 보호자 아닌 부모 멤버.
  const coParents = useMemo(
    () =>
      members.filter(
        (m) => m.role === "parent" && m.user_id && m.user_id !== family?.primaryParentId,
      ),
    [members, family],
  );

  const isPrimary = family?.isPrimaryParent ?? false;

  const avatarFor = (memberId: string): { avatar: string; soft: string } => {
    const c = view.children.find((v) => v.id === memberId);
    return { avatar: c?.avatar ?? DEFAULT_CHILD_AVATAR, soft: c?.soft ?? "var(--hy-accent-soft)" };
  };

  const statusFor = (userId: string | null): { label: string; tone: "safe" | "warn" | "muted" } => {
    if (!userId) {
      return {
        label: intl.formatMessage({ id: "parent.familyConnection.statusPending" }),
        tone: "muted",
      };
    }
    const loc = (locations ?? []).find((l) => l.user_id === userId);
    if (!loc) {
      return {
        label: intl.formatMessage({ id: "parent.familyConnection.statusNoLocation" }),
        tone: "muted",
      };
    }
    const fresh = formatFreshness(loc.updated_at, now, locale, intl);
    if (fresh.status === "live") {
      return {
        label: intl.formatMessage(
          { id: "parent.familyConnection.statusOnline" },
          { freshness: fresh.label },
        ),
        tone: "safe",
      };
    }
    if (fresh.status === "recent") return { label: fresh.label, tone: "safe" };
    return { label: fresh.label, tone: "warn" };
  };

  const doUnpair = () => {
    if (!confirm || unpair.isPending) return;
    unpair.mutate(confirm.userId, {
      onSuccess: () => {
        show(intl.formatMessage(
          { id: "parent.familyConnection.unpaired" },
          { childName: confirm.name },
        ), "🔗");
        setConfirm(null);
      },
      onError: (e) => show(localizeApiError(e, intl, "formal"), "⚠️"),
    });
  };

  const childFallback = intl.formatMessage({ id: "parent.familyConnection.childFallback" });
  const guardianFallback = intl.formatMessage({ id: "parent.familyConnection.guardianFallback" });
  const singleChildSubject = resolveFamilyConnectionChildSubject({
    childName: connected[0]?.name,
    locale,
    childFallback,
    particleConsonant: intl.formatMessage({ id: "parent.familyConnection.particleConsonant" }),
    particleVowel: intl.formatMessage({ id: "parent.familyConnection.particleVowel" }),
  });

  return (
    <div className="fc-root">
      <header className="fc-header">
        <button
          type="button"
          className="hy-iconbtn hy-press fc-back"
          aria-label={intl.formatMessage({ id: "parent.familyConnection.back" })}
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} strokeWidth={2.2} />
        </button>
        <span className="fc-title">
          {intl.formatMessage({ id: "parent.familyConnection.screenTitle" })}
        </span>
      </header>

      <div className="fc-content">
        {connectionLoading && !connectionError && (
          <div className="fc-state">
            <Loading label={intl.formatMessage({ id: "parent.familyConnection.loading" })} />
          </div>
        )}
        {connectionError && (
          <div className="fc-state fc-state--error" role="alert">
            {intl.formatMessage({ id: "parent.familyConnection.loadError" })}
            {connectionErrorValue ? ` (${localizeApiError(connectionErrorValue, intl, "formal")})` : ""}
            <button type="button" className="fc-ghost hy-press" onClick={() => void retryFamilyConnection()}>
              {intl.formatMessage({ id: "parent.familyConnection.retry" })}
            </button>
          </div>
        )}

        {!connectionLoading && !connectionError && (
          <>
            {/* 히어로 — 연결 요약 */}
            <div className={connected.length ? "fc-hero fc-hero--ok" : "fc-hero"}>
              <img
                className="fc-hero__img"
                src={asset(connected.length ? "mascot/cheer.webp" : "mascot/thinking.webp")}
                alt=""
              />
              <div className="fc-hero__main">
                <div className="fc-hero__title">
                  {connected.length === 0
                    ? intl.formatMessage({ id: "parent.familyConnection.heroEmpty" })
                    : connected.length === 1
                      ? intl.formatMessage(
                          { id: "parent.familyConnection.heroOne" },
                          { childName: singleChildSubject },
                        )
                      : intl.formatMessage(
                          { id: "parent.familyConnection.heroMany" },
                          { count: intl.formatNumber(connected.length) },
                        )}
                </div>
                <div className="fc-hero__sub">
                  {connected.length
                    ? intl.formatMessage({ id: "parent.familyConnection.heroConnectedSub" })
                    : intl.formatMessage({ id: "parent.familyConnection.heroEmptySub" })}
                </div>
              </div>
            </div>

            {/* 연결된 아이 기기 */}
            {connected.length > 0 && (
              <section className="fc-sec">
                <div className="fc-label">
                  {intl.formatMessage({ id: "parent.familyConnection.connectedDevices" })}
                </div>
                {connected.map((c) => {
                  const { avatar, soft } = avatarFor(c.id);
                  const st = statusFor(c.user_id);
                  return (
                    <div key={c.id} className="fc-device">
                      <span className="fc-device__avatar" style={{ background: soft }}>
                        <img className="hy-network-avatar" src={avatarSrc(avatar)} alt="" loading="lazy" decoding="async" />
                      </span>
                      <span className="fc-device__main">
                        <span className="fc-device__name">{c.name || childFallback}</span>
                        <span className="fc-device__sub">
                          <Wifi size={12} strokeWidth={2.4} />
                          {resolveDeviceLabel({
                            deviceLabel: c.device_label,
                            manufacturer: c.device_health?.manufacturer,
                            model: c.device_health?.model,
                          }) || intl.formatMessage({ id: "parent.familyConnection.deviceFallback" })}
                        </span>
                      </span>
                      <span className={`fc-chip fc-chip--${st.tone}`}>
                        <span className="fc-chip__dot" />
                        {st.label}
                      </span>
                    </div>
                  );
                })}
              </section>
            )}

            {/* 대기 중(미청구 placeholder) */}
            {pending.length > 0 && (
              <section className="fc-sec">
                <div className="fc-label">
                  {intl.formatMessage({ id: "parent.familyConnection.pendingTitle" })}
                </div>
                {pending.map((c) => (
                  <div key={c.id} className="fc-device fc-device--pending">
                    <span className="fc-device__avatar fc-device__avatar--muted">
                      <img className="hy-network-avatar" src={avatarSrc(avatarFor(c.id).avatar)} alt="" loading="lazy" decoding="async" />
                    </span>
                    <span className="fc-device__main">
                      <span className="fc-device__name">{c.name || childFallback}</span>
                      <span className="fc-device__sub">
                        {intl.formatMessage({ id: "parent.familyConnection.pendingDescription" })}
                      </span>
                    </span>
                  </div>
                ))}
                <button type="button" className="fc-ghost hy-press" onClick={() => navigate("/child-invite")}>
                  {intl.formatMessage({ id: "parent.familyConnection.viewCode" })}
                </button>
              </section>
            )}

            {/* 공동 보호자 */}
            <section className="fc-sec">
              <div className="fc-label">
                {intl.formatMessage({ id: "parent.familyConnection.coParents" })}
              </div>
              {coParents.length > 0 ? (
                coParents.map((p) => (
                  <div key={p.id} className="fc-device">
                    <span className="fc-device__avatar" style={{ background: "var(--cream-soft, #FFF3D6)" }}>
                      <img src={avatarSrc(parentAvatarPath(p.photo_url, p.gender))} alt="" />
                    </span>
                    <span className="fc-device__main">
                      <span className="fc-device__name">{p.name || guardianFallback}</span>
                      <span className="fc-device__sub">
                        {intl.formatMessage({ id: "parent.familyConnection.coParentConnected" })}
                      </span>
                    </span>
                    <span className="fc-chip fc-chip--safe">
                      <span className="fc-chip__dot" />
                      {intl.formatMessage({ id: "parent.familyConnection.connectedStatus" })}
                    </span>
                  </div>
                ))
              ) : (
                <button type="button" className="fc-invite hy-press" onClick={() => navigate("/child-invite?role=parent")}>
                  <span className="fc-invite__icon">
                    <UserPlus size={20} strokeWidth={2.2} />
                  </span>
                  <span className="fc-invite__main">
                    <span className="fc-invite__title">
                      {intl.formatMessage({ id: "parent.familyConnection.inviteCoParent" })}
                    </span>
                    <span className="fc-invite__sub">
                      {intl.formatMessage({ id: "parent.familyConnection.inviteCoParentDescription" })}
                    </span>
                  </span>
                  <ChevronRight size={20} strokeWidth={2.4} color="var(--fg-disabled)" />
                </button>
              )}
            </section>

            {/* 연결 해제 */}
            {connected.length > 0 && (
              <section className="fc-sec">
                <div className="fc-label">
                  {intl.formatMessage({ id: "parent.familyConnection.unpairSection" })}
                </div>
                {isPrimary ? (
                  connected.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="fc-unpair hy-press"
                      onClick={() =>
                        setConfirm({ memberId: c.id, userId: c.user_id as string, name: c.name || childFallback })
                      }
                    >
                      <Link2Off size={18} strokeWidth={2.2} />
                      {intl.formatMessage(
                        { id: "parent.familyConnection.unpairAction" },
                        { childName: c.name || childFallback },
                      )}
                    </button>
                  ))
                ) : (
                  <p className="fc-note hy-explain">
                    {intl.formatMessage({ id: "parent.familyConnection.primaryOnly" })}
                  </p>
                )}
              </section>
            )}
          </>
        )}
      </div>

      {/* 연결 해제 확인 모달 */}
      {confirm && (
        <div
          ref={confirmDialogRef}
          className="fc-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby={confirmTitleId}
          aria-describedby={confirmDescriptionId}
        >
          <button
            type="button"
            className="fc-modal__scrim"
            tabIndex={-1}
            aria-label={intl.formatMessage({ id: "parent.familyConnection.close" })}
            onClick={() => !unpair.isPending && setConfirm(null)}
          />
          <div className="fc-modal__card">
            <div id={confirmTitleId} className="fc-modal__title">
              {intl.formatMessage(
                { id: "parent.familyConnection.unpairConfirmTitle" },
                { childName: confirm.name },
              )}
            </div>
            <div id={confirmDescriptionId} className="fc-modal__body">
              {intl.formatMessage({ id: "parent.familyConnection.unpairDescription1" })}
              {" "}
              {intl.formatMessage({ id: "parent.familyConnection.unpairDescription2" })}
            </div>
            <div className="fc-modal__actions">
              <button
                ref={confirmCancelRef}
                type="button"
                className="fc-modal__btn fc-modal__btn--ghost hy-press"
                onClick={() => setConfirm(null)}
                disabled={unpair.isPending}
                data-progress-owner="confirm-action"
              >
                {intl.formatMessage({ id: "parent.familyConnection.cancel" })}
              </button>
              <button
                type="button"
                className="fc-modal__btn fc-modal__btn--danger hy-press"
                onClick={doUnpair}
                disabled={unpair.isPending} aria-busy={unpair.isPending}
              >
                {intl.formatMessage({
                  id: unpair.isPending
                    ? "parent.familyConnection.unpairing"
                    : "parent.familyConnection.unpair",
                })}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

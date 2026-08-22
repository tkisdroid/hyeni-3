import { useMemo, useState } from "react";
import { Battery, ChevronLeft, ChevronRight, Copy, Lock, Plus, QrCode as QrIcon, Smartphone, UserPlus } from "lucide-react";
import { useNavigate } from "react-router";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { useMyFamily } from "@/queries/useFamily";
import { useChildLocations, useSavedPlaces } from "@/queries/useLocation";
import { useLocationLabels } from "@/queries/useLocationLabels";
import { useAuth } from "@/auth/AuthContext";
import { useEntitlement } from "@/queries/useEntitlement";
import { mapFamilyToView } from "@/transform/familyView";
import { FEATURES, lockMessageFor } from "@/transform/tierPolicy";
import { resolveChildAddGate } from "@/transform/secondChildGate";
import {
  browserPremiumReturnIntentStorage,
  savePremiumReturnIntent,
} from "@/transform/premiumReturnIntent";
import { QrCode } from "@/components/ui/QrCode";
import { PremiumUpsell } from "@/components/PremiumUpsell";
import { buildPairLink } from "@/transform/pairLink";
import { useSafeBack } from "@/app/useSafeBack";
import { Loading } from "@/components/ui/Loading";
import "./ParentFamily.css";
import { useIntl } from "react-intl";
import { localizeApiError } from "@/i18n/apiError";

// 자녀 사진은 인증 fetch로 만든 blob URL, 기본 아바타는 asset 경로.
function avatarSrc(path: string): string {
  return path.startsWith("http") || path.startsWith("blob:") ? path : asset(path);
}

export function ParentFamily() {
  const navigate = useNavigate();
  const goBack = useSafeBack("/parent/home");
  const { show } = useToast();
  const intl = useIntl();
  const { userId } = useAuth();
  const { data: family, isLoading, isError, error, refetch: refetchFamily } = useMyFamily();
  const { data: locations } = useChildLocations();
  const { data: places } = useSavedPlaces();
  const locationLabel = useLocationLabels(locations, places);
  const entitlementQuery = useEntitlement();
  const { tier, ready } = entitlementQuery;
  const [upsellOpen, setUpsellOpen] = useState(false);

  const view = useMemo(
    () => mapFamilyToView(family?.members ?? [], userId, intl),
    [family, userId, intl],
  );
  const childPlaceByUserId = useMemo(() => {
    const map = new Map<string, string>();
    for (const loc of locations ?? []) {
      map.set(loc.user_id, locationLabel(loc));
    }
    return map;
  }, [locations, locationLabel]);

  // /family/mine은 비활성 자녀를 제외하므로 view.children.length가 현재 활성 자녀 수의 정본이다.
  const addDecision = resolveChildAddGate({
    ready,
    isError: entitlementQuery.isError,
    tier,
    activeChildCount: view.children.length,
    requestedChildCount: 1,
  });
  const addLocked = addDecision.status !== "allowed";
  const addLockMessage = addDecision.status === "limit_reached"
    ? intl.formatMessage({ id: "parent.parentFamily.copy001" })
    : addDecision.status === "unavailable"
      ? intl.formatMessage({ id: "parent.parentFamily.copy002" })
      : lockMessageFor(FEATURES.MULTI_CHILD, intl);

  // 연결 코드 + QR 딥링크(아이 재연결·선생님 학생추가 시 이 코드로 다시 연결).
  const pairCode = family?.pairCode ?? "";
  const pairLink = useMemo(() => (pairCode ? buildPairLink(pairCode) : ""), [pairCode]);
  const canInviteCoParent = Boolean(
    family?.isPrimaryParent
    && !family.members.some(
      (member) =>
        member.role === "parent"
        && member.user_id
        && member.user_id !== family.primaryParentId,
    ),
  );

  const inviteChild = () => {
    navigate("/child-invite");
  };
  const inviteCoParent = () => {
    navigate("/child-invite?role=parent");
  };
  const addChild = () => {
    if (addDecision.status === "allowed") {
      navigate("/pairing-wizard");
      return;
    }
    if (addDecision.status === "premium_required") {
      setUpsellOpen(true);
      return;
    }
    show(
      addDecision.status === "limit_reached"
        ? intl.formatMessage({ id: "parent.parentFamily.copy001" })
        : intl.formatMessage({ id: "parent.parentFamily.copy003" }),
      addDecision.status === "unavailable" ? "⏳" : "🔒",
    );
  };
  const copyCode = () => {
    if (!pairCode) return;
    const clip = navigator.clipboard;
    if (!clip?.writeText) {
      show(intl.formatMessage({ id: "parent.family.copyUnsupported" }, { code: pairCode }), "✏️");
      return;
    }
    clip.writeText(pairCode).then(
      () => show(intl.formatMessage({ id: "parent.parentFamily.copy004" }), "📋"),
      () => show(intl.formatMessage({ id: "parent.family.copyFailed" }, { code: pairCode }), "✏️"),
    );
  };

  return (
    <div className="hy-rise-in">
      <header className="pf-header">
        <button
          type="button"
          className="hy-iconbtn hy-backbtn hy-press"
          aria-label={intl.formatMessage({ id: "parent.parentSettings.copy017" })}
          onClick={goBack}
        >
          <ChevronLeft size={22} strokeWidth={2.2} />
        </button>
        <span className="pf-header__title">{intl.formatMessage({ id: "parent.parentFamily.copy005" })}</span>
        {canInviteCoParent ? (
          <button
            type="button"
            className="pf-invite-btn hy-press"
            aria-label={intl.formatMessage({ id: "parent.parentFamily.copy006" })}
            onClick={inviteCoParent}
          >
            <UserPlus size={21} strokeWidth={1.9} color="#4A4145" />
          </button>
        ) : (
          <span className="pf-header__spacer" aria-hidden="true" />
        )}
      </header>

      <div className="hy-content">
        {isLoading && <div className="pf-state"><Loading label={intl.formatMessage({ id: "parent.parentFamily.copy007" })} /></div>}
        {isError && (
          <div className="pf-state pf-state--error">
            {intl.formatMessage({ id: "parent.eventForm.copy005" })}
            {` (${localizeApiError(error, intl, "formal")})`}
            <button type="button" className="hy-section-action hy-press" onClick={() => void refetchFamily()}>
              {intl.formatMessage({ id: "parent.parentHome.copy017" })}
            </button>
          </div>
        )}

        {!isLoading && !isError && (
          <>
            {/* 보호자 */}
            <section>
              <div className="pf-label">{intl.formatMessage({ id: "parent.parentSettings.copy003" })}</div>
              <div className="pf-parents">
                {view.parents.map((p) => (
                  <div key={p.id} className="pf-parent">
                    <span className="pf-parent__avatar">
                      <img src={avatarSrc(p.avatar)} alt="" loading="lazy" decoding="async" />
                    </span>
                    <span className="pf-parent__main">
                      <span className="pf-parent__name-row">
                        <span className="pf-parent__name">{p.name}</span>
                        {p.isMe && <span className="pf-parent__badge">{intl.formatMessage({ id: "parent.parentFamily.copy008" })}</span>}
                      </span>
                      <span className="pf-parent__role">{p.roleLabel}</span>
                    </span>
                  </div>
                ))}
              </div>
            </section>

            {/* 아이 */}
            <section>
              <div className="pf-label">{intl.formatMessage({ id: "parent.parentHome.copy004" })}</div>
              <div className="pf-children">
                {view.children.length === 0 && (
                  <div className="pf-children__empty">{intl.formatMessage({ id: "parent.parentFamily.copy009" })}</div>
                )}
                {view.children.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="pf-child hy-press"
                    onClick={() => navigate("/child-detail", { state: { childId: c.id } })}
                  >
                    <span className="pf-child__avatar" style={{ background: c.soft }}>
                      <img src={avatarSrc(c.avatar)} alt="" loading="lazy" decoding="async" />
                    </span>
                    <span className="pf-child__main">
                      <span className="pf-child__name">{c.name}</span>
                      <span className="pf-child__device">
                        <Smartphone size={12} strokeWidth={2.2} />
                        {c.deviceLabel ?? intl.formatMessage({ id: "parent.parentHome.copy032" })}
                      </span>
                      {c.info && <span className="pf-child__info">{c.info}</span>}
                      <span className="pf-child__chips">
                        {c.battery != null && (
                          <span className="pf-chip" style={{ background: "#E7F8F0", color: "#087653" }}>
                            <Battery size={12} strokeWidth={2.2} aria-hidden="true" />
                            {c.battery}%
                          </span>
                        )}
                        <span className="pf-chip pf-chip--place">
                          <span className="pf-chip__dot" />
                          {(c.userId ? childPlaceByUserId.get(c.userId) : null) ?? c.place ?? intl.formatMessage({ id: "parent.parentFamily.copy010" })}
                        </span>
                      </span>
                    </span>
                    <ChevronRight
                      className="pf-child__chev"
                      size={20}
                      strokeWidth={2.4}
                      color="#C9BFC4"
                    />
                  </button>
                ))}
                {addLocked ? (
                  <button
                    type="button"
                    className="pf-add pf-add--locked hy-press"
                    onClick={addChild}
                  >
                    <Lock size={17} strokeWidth={2.4} color="var(--gold-text)" />
                    <span className="pf-add__lock">
                      <span className="pf-add__lock-title">
                        {addLockMessage}
                      </span>
                      <span className="pf-add__lock-sub">
                        {addDecision.status === "premium_required"
                          ? intl.formatMessage({ id: "parent.parentFamily.copy011" })
                          : intl.formatMessage({ id: "parent.parentFamily.copy012" })}
                      </span>
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="pf-add hy-press"
                    onClick={addChild}
                  >
                    <Plus size={19} strokeWidth={2.4} color="#B0477A" />
                    {intl.formatMessage({ id: "parent.parentFamily.copy013" })}
                  </button>
                )}
              </div>
            </section>

            {/* 연결 상태 · 관리 */}
            <button
              type="button"
              className="pf-conn hy-press"
              onClick={() => navigate("/family-connection")}
            >
              <span className="pf-conn__icon">
                <img src={asset("ui/clay/data-sync.webp")} alt="" />
              </span>
              <span className="pf-conn__main">
                <span className="pf-conn__title">{intl.formatMessage({ id: "parent.parentFamily.copy014" })}</span>
                <span className="pf-conn__sub">{intl.formatMessage({ id: "parent.parentFamily.copy015" })}</span>
              </span>
              <ChevronRight className="pf-conn__chev" size={20} strokeWidth={2.4} color="#C9BFC4" />
            </button>

            {/* 연결 코드 · QR — 아이 재연결·선생님 학생추가 시 이 코드로 다시 연결 */}
            <section className="pf-paircode">
              <div className="pf-paircode__label">{intl.formatMessage({ id: "parent.parentFamily.copy016" })}</div>
              <div className="pf-paircode__card">
                <div className="pf-paircode__row">
                  <button
                    type="button"
                    className="pf-paircode__qr hy-press"
                    aria-label={intl.formatMessage({ id: "parent.parentFamily.copy017" })}
                    onClick={inviteChild}
                  >
                    {pairLink ? (
                      <QrCode value={pairLink} size={96} label={intl.formatMessage({ id: "parent.parentFamily.copy018" })} />
                    ) : (
                      <span className="pf-paircode__qr-skel">…</span>
                    )}
                  </button>
                  <div className="pf-paircode__main">
                    <div className="pf-paircode__code">{pairCode || intl.formatMessage({ id: "parent.parentFamily.copy019" })}</div>
                    <div className="pf-paircode__btns">
                      <button
                        type="button"
                        className="pf-paircode__btn hy-press"
                        onClick={copyCode}
                        disabled={!pairCode}
                      >
                        <Copy size={15} strokeWidth={2.2} />
                        {intl.formatMessage({ id: "parent.parentFamily.copy020" })}
                      </button>
                      <button
                        type="button"
                        className="pf-paircode__btn pf-paircode__btn--accent hy-press"
                        onClick={inviteChild}
                      >
                        <QrIcon size={15} strokeWidth={2.2} />
                        {intl.formatMessage({ id: "parent.parentFamily.copy021" })}
                      </button>
                    </div>
                  </div>
                </div>
                <div className="pf-paircode__hint">
                  {intl.formatMessage({ id: "parent.parentFamily.copy022" })}
                </div>
              </div>
            </section>

            {/* 공동 보호자 초대 */}
            {canInviteCoParent && (
              <button type="button" className="pf-invite-card hy-press" onClick={inviteCoParent}>
                <img
                  className="pf-invite-card__img"
                  src={asset("ui/friend-pair.webp")}
                  alt=""
                />
                <span className="pf-invite-card__main">
                  <span className="pf-invite-card__title">{intl.formatMessage({ id: "parent.parentFamily.copy023" })}</span>
                  <span className="pf-invite-card__sub">{intl.formatMessage({ id: "parent.parentFamily.copy024" })}</span>
                </span>
                <ChevronRight
                  className="pf-invite-card__chev"
                  size={20}
                  strokeWidth={2.4}
                  color="#B79DE0"
                />
              </button>
            )}
          </>
        )}
      </div>
      <PremiumUpsell
        open={upsellOpen}
        source="second_child"
        tier={tier}
        returnTo="/pairing-wizard"
        onClose={() => setUpsellOpen(false)}
        onUpgrade={({ source, feature, returnTo }) => {
          const storage = browserPremiumReturnIntentStorage();
          const saved = storage && returnTo
            ? savePremiumReturnIntent(storage, { source, feature, returnTo })
            : false;
          if (!saved) throw new Error(intl.formatMessage({ id: "parent.family.returnIntentFailed" }));
          setUpsellOpen(false);
          navigate("/subscription");
        }}
      />
    </div>
  );
}

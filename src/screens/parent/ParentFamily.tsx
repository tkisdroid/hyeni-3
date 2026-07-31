import { useMemo } from "react";
import { Battery, ChevronLeft, ChevronRight, Copy, Link2, Lock, Plus, QrCode as QrIcon, Smartphone, UserPlus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { useMyFamily } from "@/queries/useFamily";
import { useChildLocations, useSavedPlaces } from "@/queries/useLocation";
import { useLocationLabels } from "@/queries/useLocationLabels";
import { useAuth } from "@/auth/AuthContext";
import { useEntitlement } from "@/queries/useEntitlement";
import { mapFamilyToView } from "@/transform/familyView";
import { TIERS, FEATURES, canAddChild, lockMessageFor } from "@/transform/tierPolicy";
import { QrCode } from "@/components/ui/QrCode";
import { buildPairLink } from "@/transform/pairLink";
import { useSafeBack } from "@/app/useSafeBack";
import { Loading } from "@/components/ui/Loading";
import "./ParentFamily.css";

// 자녀 사진은 proxy URL(http…), 기본 아바타는 asset 경로.
function avatarSrc(path: string): string {
  return path.startsWith("http") ? path : asset(path);
}

export function ParentFamily() {
  const navigate = useNavigate();
  const goBack = useSafeBack("/parent/home");
  const { show } = useToast();
  const { userId } = useAuth();
  const { data: family, isLoading, isError, error, refetch: refetchFamily } = useMyFamily();
  const { data: locations } = useChildLocations();
  const { data: places } = useSavedPlaces();
  const locationLabel = useLocationLabels(locations, places);
  const { tier } = useEntitlement();

  const view = useMemo(
    () => mapFamilyToView(family?.members ?? [], userId),
    [family, userId],
  );
  const childPlaceByUserId = useMemo(() => {
    const map = new Map<string, string>();
    for (const loc of locations ?? []) {
      map.set(loc.user_id, locationLabel(loc));
    }
    return map;
  }, [locations, locationLabel]);

  // 아이 추가 게이트: 티어 확정(unknown 아님) + 상한 도달 시에만 잠금(R9 — 미확정이면 잠그지 않음).
  const addLocked = tier !== TIERS.UNKNOWN && !canAddChild(tier, view.children.length);
  const addLockMessage =
    tier === TIERS.PREMIUM && addLocked
      ? "프리미엄은 아이 2명까지 연결할 수 있어요"
      : lockMessageFor(FEATURES.MULTI_CHILD);

  // 연결 코드 + QR 딥링크(아이 재연결·선생님 학생추가 시 이 코드로 다시 연결).
  const pairCode = family?.pairCode ?? "";
  const pairLink = useMemo(() => (pairCode ? buildPairLink(pairCode) : ""), [pairCode]);

  const invite = () => {
    if (addLocked) {
      show(addLockMessage, "🔒");
      navigate("/subscription");
      return;
    }
    navigate("/child-invite");
  };
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

  return (
    <div className="hy-rise-in">
      <header className="pf-header">
        <button
          type="button"
          className="hy-iconbtn hy-press"
          aria-label="뒤로"
          onClick={goBack}
        >
          <ChevronLeft size={22} strokeWidth={2.2} />
        </button>
        <span className="pf-header__title">우리 가족</span>
        <button
          type="button"
          className="pf-invite-btn hy-press"
          aria-label="가족 초대"
          onClick={invite}
        >
          <UserPlus size={21} strokeWidth={1.9} color="#4A4145" />
        </button>
      </header>

      <div className="hy-content">
        {isLoading && <div className="pf-state"><Loading label="가족 정보를 불러오는 중" /></div>}
        {isError && (
          <div className="pf-state pf-state--error">
            가족 정보를 불러오지 못했어요
            {error instanceof Error ? ` (${error.message})` : ""}
            <button type="button" className="hy-section-action hy-press" onClick={() => void refetchFamily()}>
              다시 시도
            </button>
          </div>
        )}

        {!isLoading && !isError && (
          <>
            {/* 보호자 */}
            <section>
              <div className="pf-label">보호자</div>
              <div className="pf-parents">
                {view.parents.map((p) => (
                  <div key={p.id} className="pf-parent">
                    <span className="pf-parent__avatar">
                      <img src={avatarSrc(p.avatar)} alt="" loading="lazy" decoding="async" />
                    </span>
                    <span className="pf-parent__main">
                      <span className="pf-parent__name-row">
                        <span className="pf-parent__name">{p.name}</span>
                        {p.isMe && <span className="pf-parent__badge">나</span>}
                      </span>
                      <span className="pf-parent__role">{p.roleLabel}</span>
                    </span>
                  </div>
                ))}
              </div>
            </section>

            {/* 아이 */}
            <section>
              <div className="pf-label">아이</div>
              <div className="pf-children">
                {view.children.length === 0 && (
                  <div className="pf-children__empty">아직 연결된 아이가 없어요. ‘아이 추가’를 눌러 연결을 시작해 주세요.</div>
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
                        {c.deviceLabel ?? "기기 연결 대기 중"}
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
                          {(c.userId ? childPlaceByUserId.get(c.userId) : null) ?? c.place ?? "위치 연동 예정"}
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
                    onClick={() => navigate("/subscription")}
                  >
                    <Lock size={17} strokeWidth={2.4} color="var(--gold-text)" />
                    <span className="pf-add__lock">
                      <span className="pf-add__lock-title">
                        {addLockMessage}
                      </span>
                      <span className="pf-add__lock-sub">프리미엄으로 전환하기</span>
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="pf-add hy-press"
                    onClick={() => navigate("/pairing-wizard")}
                  >
                    <Plus size={19} strokeWidth={2.4} color="#B0477A" />
                    아이 추가하기
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
                <Link2 size={20} strokeWidth={2.2} color="#087653" />
              </span>
              <span className="pf-conn__main">
                <span className="pf-conn__title">연결 상태</span>
                <span className="pf-conn__sub">기기 연결·공동 보호자·연결 해제 관리</span>
              </span>
              <ChevronRight className="pf-conn__chev" size={20} strokeWidth={2.4} color="#C9BFC4" />
            </button>

            {/* 연결 코드 · QR — 아이 재연결·선생님 학생추가 시 이 코드로 다시 연결 */}
            <section className="pf-paircode">
              <div className="pf-paircode__label">연결 코드 · QR</div>
              <div className="pf-paircode__card">
                <div className="pf-paircode__row">
                  <button
                    type="button"
                    className="pf-paircode__qr hy-press"
                    aria-label="QR 코드 크게 보기"
                    onClick={invite}
                  >
                    {pairLink ? (
                      <QrCode value={pairLink} size={96} label="아이 연결 QR 코드" />
                    ) : (
                      <span className="pf-paircode__qr-skel">…</span>
                    )}
                  </button>
                  <div className="pf-paircode__main">
                    <div className="pf-paircode__code">{pairCode || "코드 불러오는 중…"}</div>
                    <div className="pf-paircode__btns">
                      <button
                        type="button"
                        className="pf-paircode__btn hy-press"
                        onClick={copyCode}
                        disabled={!pairCode}
                      >
                        <Copy size={15} strokeWidth={2.2} />
                        복사
                      </button>
                      <button
                        type="button"
                        className="pf-paircode__btn pf-paircode__btn--accent hy-press"
                        onClick={invite}
                      >
                        <QrIcon size={15} strokeWidth={2.2} />
                        크게 보기 · 공유
                      </button>
                    </div>
                  </div>
                </div>
                <div className="pf-paircode__hint">
                  아이 연결이 끊겼거나 선생님이 학생을 추가할 때 이 코드나 QR로 다시 연결해요.
                </div>
              </div>
            </section>

            {/* 공동 보호자 초대 */}
            <button type="button" className="pf-invite-card hy-press" onClick={invite}>
              <img
                className="pf-invite-card__img"
                src={asset("ui/friend-pair.webp")}
                alt=""
              />
              <span className="pf-invite-card__main">
                <span className="pf-invite-card__title">배우자 초대하기</span>
                <span className="pf-invite-card__sub">같은 코드로 공동 보호자도 연결할 수 있어요</span>
              </span>
              <ChevronRight
                className="pf-invite-card__chev"
                size={20}
                strokeWidth={2.4}
                color="#B79DE0"
              />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

import { useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { ChevronLeft, ChevronRight, UserPlus, Link2Off, Wifi } from "lucide-react";
import { asset } from "@/lib/assets";
import { DEFAULT_CHILD_AVATAR } from "@/lib/avatar";
import { useToast } from "@/app/toast";
import { useDialogFocusLifecycle } from "@/components/useDialogFocusLifecycle";
import { useMyFamily, useUnpairChild } from "@/queries/useFamily";
import { useChildLocations } from "@/queries/useLocation";
import { mapFamilyToView } from "@/transform/familyView";
import { formatFreshness } from "@/transform/locationView";
import { useLocale } from "@/i18n/useLocale";
import { hasJongseong } from "@/transform/adventureMap";
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
    if (!userId) return { label: "연결 대기 중", tone: "muted" };
    const loc = (locations ?? []).find((l) => l.user_id === userId);
    if (!loc) return { label: "위치 정보 없음", tone: "muted" };
    const fresh = formatFreshness(loc.updated_at, now, locale);
    if (fresh.status === "live") return { label: `온라인 · ${fresh.label}`, tone: "safe" };
    if (fresh.status === "recent") return { label: fresh.label, tone: "safe" };
    return { label: fresh.label, tone: "warn" };
  };

  const doUnpair = () => {
    if (!confirm || unpair.isPending) return;
    unpair.mutate(confirm.userId, {
      onSuccess: () => {
        show(`‘${confirm.name}’ 기기 연결을 해제했어요`, "🔗");
        setConfirm(null);
      },
      onError: (e) => show(localizeApiError(e, intl, "formal"), "⚠️"),
    });
  };

  return (
    <div className="fc-root">
      <header className="fc-header">
        <button type="button" className="hy-iconbtn hy-press fc-back" aria-label="뒤로" onClick={() => navigate(-1)}>
          <ChevronLeft size={22} strokeWidth={2.2} />
        </button>
        <span className="fc-title">연결 상태</span>
      </header>

      <div className="fc-content">
        {connectionLoading && !connectionError && <div className="fc-state"><Loading label="연결 정보를 불러오는 중" /></div>}
        {connectionError && (
          <div className="fc-state fc-state--error" role="alert">
            연결 정보를 불러오지 못했어요
            {connectionErrorValue ? ` (${localizeApiError(connectionErrorValue, intl, "formal")})` : ""}
            <button type="button" className="fc-ghost hy-press" onClick={() => void retryFamilyConnection()}>
              다시 시도
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
                    ? "아직 연결된 아이가 없어요"
                    : connected.length === 1
                      ? `${connected[0].name || "아이"}${hasJongseong(connected[0].name || "아이") ? "과" : "와"} 연결 완료!`
                      : `아이 ${connected.length}명과 연결됨`}
                </div>
                <div className="fc-hero__sub">
                  {connected.length
                    ? "아이 기기와 실시간으로 연결돼 있어요"
                    : "연결 코드로 아이 기기를 연결해 주세요"}
                </div>
              </div>
            </div>

            {/* 연결된 아이 기기 */}
            {connected.length > 0 && (
              <section className="fc-sec">
                <div className="fc-label">연결된 기기</div>
                {connected.map((c) => {
                  const { avatar, soft } = avatarFor(c.id);
                  const st = statusFor(c.user_id);
                  return (
                    <div key={c.id} className="fc-device">
                      <span className="fc-device__avatar" style={{ background: soft }}>
                        <img className="hy-network-avatar" src={avatarSrc(avatar)} alt="" loading="lazy" decoding="async" />
                      </span>
                      <span className="fc-device__main">
                        <span className="fc-device__name">{c.name || "아이"}</span>
                        <span className="fc-device__sub">
                          <Wifi size={12} strokeWidth={2.4} />
                          {c.device_label || "연결된 기기"}
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
                <div className="fc-label">연결 대기 중</div>
                {pending.map((c) => (
                  <div key={c.id} className="fc-device fc-device--pending">
                    <span className="fc-device__avatar fc-device__avatar--muted">
                      <img className="hy-network-avatar" src={avatarSrc(avatarFor(c.id).avatar)} alt="" loading="lazy" decoding="async" />
                    </span>
                    <span className="fc-device__main">
                      <span className="fc-device__name">{c.name || "아이"}</span>
                      <span className="fc-device__sub">아이 기기에서 연결 코드를 입력하면 연결돼요</span>
                    </span>
                  </div>
                ))}
                <button type="button" className="fc-ghost hy-press" onClick={() => navigate("/child-invite")}>
                  연결 코드 보기
                </button>
              </section>
            )}

            {/* 공동 보호자 */}
            <section className="fc-sec">
              <div className="fc-label">공동 보호자</div>
              {coParents.length > 0 ? (
                coParents.map((p) => (
                  <div key={p.id} className="fc-device">
                    <span className="fc-device__avatar" style={{ background: "var(--cream-soft, #FFF3D6)" }}>
                      <img src={asset(p.gender === "dad" ? "family/dad.webp" : "family/mom.webp")} alt="" />
                    </span>
                    <span className="fc-device__main">
                      <span className="fc-device__name">{p.name || "보호자"}</span>
                      <span className="fc-device__sub">공동 보호자로 연결됨</span>
                    </span>
                    <span className="fc-chip fc-chip--safe">
                      <span className="fc-chip__dot" />
                      연결됨
                    </span>
                  </div>
                ))
              ) : (
                <button type="button" className="fc-invite hy-press" onClick={() => navigate("/child-invite")}>
                  <span className="fc-invite__icon">
                    <UserPlus size={20} strokeWidth={2.2} />
                  </span>
                  <span className="fc-invite__main">
                    <span className="fc-invite__title">공동 보호자 초대하기</span>
                    <span className="fc-invite__sub">연결 코드를 공유해 배우자를 연결해요</span>
                  </span>
                  <ChevronRight size={20} strokeWidth={2.4} color="var(--fg-disabled)" />
                </button>
              )}
            </section>

            {/* 연결 해제 */}
            {connected.length > 0 && (
              <section className="fc-sec">
                <div className="fc-label">연결 해제</div>
                {isPrimary ? (
                  connected.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="fc-unpair hy-press"
                      onClick={() =>
                        setConfirm({ memberId: c.id, userId: c.user_id as string, name: c.name || "아이" })
                      }
                    >
                      <Link2Off size={18} strokeWidth={2.2} />
                      {c.name || "아이"} 연결 해제
                    </button>
                  ))
                ) : (
                  <p className="fc-note hy-explain">주 보호자만 아이 연결을 해제할 수 있어요.</p>
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
            aria-label="닫기"
            onClick={() => !unpair.isPending && setConfirm(null)}
          />
          <div className="fc-modal__card">
            <div id={confirmTitleId} className="fc-modal__title">‘{confirm.name}’ 기기 연결을 해제할까요?</div>
            <div id={confirmDescriptionId} className="fc-modal__body">
              연결을 해제하면 이 아이의 위치·알림 연동이 중단되고, 아이 기기의 연결이 풀려요.
              다시 연결하려면 연결 코드가 필요해요.
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
                취소
              </button>
              <button
                type="button"
                className="fc-modal__btn fc-modal__btn--danger hy-press"
                onClick={doUnpair}
                disabled={unpair.isPending} aria-busy={unpair.isPending}
              >
                {unpair.isPending ? "해제 중…" : "연결 해제"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

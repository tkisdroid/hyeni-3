import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, LogOut, ShieldAlert } from "lucide-react";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { useAuth } from "@/auth/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { qk } from "@/queries/keys";
import { useAccount, useDeleteAccount } from "@/queries/useAccount";
import { useUpdateProfile } from "@/queries/useFamily";
import "./ParentAccount.css";

/** P-30 계정·프로필 — 프로필 편집·로그인 정보·로그아웃·회원 탈퇴. */
export function ParentAccount() {
  const navigate = useNavigate();
  const { show } = useToast();
  const qc = useQueryClient();
  const { logout, familyId, user } = useAuth();
  const { account, me, providerLabel, isLoading } = useAccount();
  const updateProfile = useUpdateProfile();
  const deleteAccount = useDeleteAccount();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [seeded, setSeeded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // me 가 도착하면 편집 폼을 1회 seed(이후 사용자가 입력 중이면 덮어쓰지 않음).
  useEffect(() => {
    if (seeded) return;
    if (me || account) {
      setName(me?.name ?? account?.myName ?? "");
      setPhone(me?.phone ?? "");
      setSeeded(true);
    }
  }, [me, account, seeded]);

  const roleLabel = account?.isPrimaryParent
    ? "대표 보호자"
    : account?.isCoParent
      ? "공동 보호자"
      : "보호자";
  const avatarSrc =
    me?.gender === "dad" ? "family/dad.webp" : "family/mom.webp";

  const dirty = seeded && (name.trim() !== (me?.name ?? account?.myName ?? "") || phone.trim() !== (me?.phone ?? ""));

  const saveProfile = () => {
    if (!name.trim()) {
      show("이름을 입력해 주세요", "✏️");
      return;
    }
    updateProfile.mutate(
      { name: name.trim(), phone: phone.trim() },
      {
        onSuccess: () => {
          void qc.invalidateQueries({ queryKey: qk.family(familyId) });
          void qc.invalidateQueries({ queryKey: ["account", familyId ?? "me"] });
          show("프로필을 저장했어요", "✅");
        },
        onError: (e) => {
          console.error("프로필 저장 실패:", e);
          show("저장에 실패했어요. 다시 시도해 주세요", "⚠️");
        },
      },
    );
  };

  const handleLogout = async () => {
    try {
      await logout();
      show("로그아웃되었어요", "👋");
      navigate("/onboarding");
    } catch (e) {
      console.error("로그아웃 실패:", e);
      show("로그아웃에 실패했어요. 다시 시도해 주세요", "⚠️");
    }
  };

  const handleDelete = () => {
    deleteAccount.mutate(undefined, {
      onSuccess: () => {
        show("계정이 삭제되었어요", "🗑️");
        navigate("/onboarding");
      },
      onError: (e) => {
        console.error("계정 삭제 실패:", e);
        setConfirmDelete(false);
        show("계정 삭제에 실패했어요. 잠시 후 다시 시도해 주세요", "⚠️");
      },
    });
  };

  const isPrimary = account?.isPrimaryParent === true;

  return (
    <div className="pa-root hy-rise-in">
      <header className="pa-head">
        <button
          type="button"
          className="pa-back hy-press"
          aria-label="뒤로"
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} strokeWidth={2.2} color="var(--fg-secondary)" />
        </button>
        <span className="pa-head-title">계정 · 프로필</span>
      </header>

      <div className="pa-content">
        {/* 프로필 미리보기 */}
        <div className="pa-profile">
          <div className="pa-profile__avatar">
            <img src={asset(avatarSrc)} alt="" />
          </div>
          <div className="pa-profile__info">
            <div className="pa-profile__name">{name.trim() || account?.myName || "보호자"}</div>
            <div className="pa-profile__meta">
              {providerLabel} · {roleLabel}
            </div>
          </div>
        </div>

        {/* 프로필 편집 */}
        <div className="pa-group">
          <div className="pa-group__label">프로필</div>
          <div className="pa-card">
            <label className="pa-field">
              <span className="pa-field__k">이름</span>
              <input
                className="pa-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="이름"
                disabled={isLoading}
              />
            </label>
            <div className="pa-divider" />
            <label className="pa-field">
              <span className="pa-field__k">전화번호</span>
              <input
                className="pa-input"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="010-0000-0000"
                inputMode="tel"
                disabled={isLoading}
              />
            </label>
          </div>
          <button
            type="button"
            className="pa-save hy-press"
            onClick={saveProfile}
            disabled={!dirty || updateProfile.isPending}
          >
            {updateProfile.isPending ? "저장 중…" : "프로필 저장"}
          </button>
        </div>

        {/* 로그인 정보 */}
        <div className="pa-group">
          <div className="pa-group__label">로그인 정보</div>
          <div className="pa-card">
            <div className="pa-row">
              <span className="pa-row__k">로그인 방식</span>
              <span className="pa-row__v">{providerLabel}</span>
            </div>
            <div className="pa-divider" />
            <div className="pa-row pa-row--muted">
              <span className="pa-row__k">비밀번호 변경</span>
              <span className="pa-row__hint">준비 중이에요</span>
            </div>
          </div>
          <div className="pa-note">
            연동된 소셜 계정은 해당 서비스에서 관리돼요. 추가 계정 연동은 준비 중이에요.
          </div>
        </div>

        {/* 계정 액션 */}
        <div className="pa-group">
          <button type="button" className="pa-action hy-press" onClick={() => void handleLogout()}>
            <span className="pa-action__ic pa-action__ic--neutral">
              <LogOut size={18} strokeWidth={2.2} />
            </span>
            <span className="pa-action__label">로그아웃</span>
          </button>

          <button
            type="button"
            className="pa-action hy-press"
            onClick={() => setConfirmDelete(true)}
          >
            <span className="pa-action__ic pa-action__ic--danger">
              <ShieldAlert size={18} strokeWidth={2.2} />
            </span>
            <span className="pa-action__label pa-action__label--danger">회원 탈퇴</span>
          </button>
        </div>

        <div className="pa-uid">계정 ID · {user?.id?.slice(0, 8) ?? "-"}</div>
      </div>

      {/* 회원 탈퇴 확인 모달 */}
      {confirmDelete && (
        <div className="pa-modal" role="dialog" aria-modal="true">
          <button
            type="button"
            className="pa-modal__scrim"
            aria-label="닫기"
            onClick={() => !deleteAccount.isPending && setConfirmDelete(false)}
          />
          <div className="pa-modal__card">
            <div className="pa-modal__emoji">🗑️</div>
            <div className="pa-modal__title">정말 탈퇴하시겠어요?</div>
            <p className="pa-modal__body">
              {isPrimary
                ? "가족의 일정·위치 이력·대화·아이 계정이 모두 영구 삭제되며 복구할 수 없어요."
                : "내 계정과 이 가족에서의 정보가 삭제돼요. 가족의 다른 데이터는 유지돼요."}
            </p>
            <div className="pa-modal__btns">
              <button
                type="button"
                className="pa-modal__btn pa-modal__btn--ghost hy-press"
                onClick={() => setConfirmDelete(false)}
                disabled={deleteAccount.isPending}
              >
                취소
              </button>
              <button
                type="button"
                className="pa-modal__btn pa-modal__btn--danger hy-press"
                onClick={handleDelete}
                disabled={deleteAccount.isPending}
              >
                {deleteAccount.isPending ? "삭제 중…" : "탈퇴하기"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

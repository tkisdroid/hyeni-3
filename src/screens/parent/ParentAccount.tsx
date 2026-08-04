import { useEffect, useId, useState, useRef } from "react";
import { useNavigate } from "react-router";
import { ChevronLeft, KeyRound, LogOut, ShieldAlert, Trash2 } from "lucide-react";
import { asset } from "@/lib/assets";
import { formatPhoneDisplay } from "@/transform/phoneFormat";
import { useToast } from "@/app/toast";
import { useAuth } from "@/auth/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { qk } from "@/queries/keys";
import { useAccount, useChangePassword, useDeleteAccount } from "@/queries/useAccount";
import { useUpdateProfile } from "@/queries/useFamily";
import { SocialLinks } from "./SocialLinks";
import { useDialogFocusLifecycle } from "@/components/useDialogFocusLifecycle";
import { Loading } from "@/components/ui/Loading";
import { usePwaUpdateCriticalSection } from "@/lib/usePwaUpdateCriticalSection";
import "./ParentAccount.css";

/** P-30 계정·프로필 — 프로필 편집·로그인 정보·로그아웃·회원 탈퇴. */
export function ParentAccount() {
  const navigate = useNavigate();
  const { show } = useToast();
  const qc = useQueryClient();
  const { logout, familyId, user } = useAuth();
  const {
    account,
    me,
    providerLabel,
    isLoading,
    isError: accountIsError,
    refetch: refetchAccount,
  } = useAccount();
  const updateProfile = useUpdateProfile();
  const deleteAccount = useDeleteAccount();
  const changePassword = useChangePassword();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [seeded, setSeeded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [logoutBusy, setLogoutBusy] = useState(false);
  const deleteTitleId = useId();
  const deleteDescriptionId = useId();
  const passwordTitleId = useId();
  const passwordDescriptionId = useId();
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const currentPasswordRef = useRef<HTMLInputElement>(null);
  const deleteDialogRef = useDialogFocusLifecycle<HTMLDivElement>({
    open: confirmDelete,
    onClose: () => setConfirmDelete(false),
    initialFocusRef: deleteCancelRef,
    canClose: () => !deleteAccount.isPending,
  });
  const passwordDialogRef = useDialogFocusLifecycle<HTMLDivElement>({
    open: passwordOpen,
    onClose: () => closePassword(),
    initialFocusRef: currentPasswordRef,
    canClose: () => !changePassword.isPending,
  });

  // me 가 도착하면 편집 폼을 1회 seed(이후 사용자가 입력 중이면 덮어쓰지 않음).
  useEffect(() => {
    if (seeded) return;
    if (me || account) {
      setName(me?.name ?? account?.myName ?? "");
      setPhone(formatPhoneDisplay(me?.phone ?? ""));
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

  // 전화번호는 표시 포맷("010-0000-0000")으로 통일해 비교한다 —
  // 저장값이 하이픈 없이 들어와도 화면에 들어온 것만으로 '변경됨'이 되지 않게 한다.
  const dirty = seeded && (
    name.trim() !== (me?.name ?? account?.myName ?? "")
    || phone.trim() !== formatPhoneDisplay(me?.phone ?? "")
  );
  const accountReady = !isLoading && !accountIsError && account !== null;
  usePwaUpdateCriticalSection(
    dirty
    || updateProfile.isPending
    || changePassword.isPending
    || deleteAccount.isPending
    || logoutBusy
    || currentPassword.length > 0
    || newPassword.length > 0
    || newPasswordConfirm.length > 0,
  );

  const saveProfile = () => {
    if (!accountReady) {
      show("계정 정보를 확인한 뒤 다시 시도해 주세요", "⚠️");
      return;
    }
    if (!name.trim()) {
      show("이름을 입력해 주세요", "✏️");
      return;
    }
    updateProfile.mutate(
      { name: name.trim(), phone: phone.trim() },
      {
        onSuccess: () => {
          void qc.invalidateQueries({ queryKey: qk.family(familyId) });
          void qc.invalidateQueries({ queryKey: qk.account(familyId) });
          show("프로필을 저장했어요", "✅");
        },
        onError: (e) => {
          console.error("프로필 저장 실패:", e);
          show("저장에 실패했어요. 다시 시도해 주세요", "⚠️");
        },
      },
    );
  };

  const logoutBusyRef = useRef(false);
  const handleLogout = async () => {
    if (logoutBusyRef.current) return; // 이중 탭 가드
    logoutBusyRef.current = true;
    setLogoutBusy(true);
    try {
      await logout();
      show("로그아웃되었어요", "👋");
      navigate("/onboarding");
    } catch (e) {
      console.error("로그아웃 실패:", e);
      show("로그아웃에 실패했어요. 다시 시도해 주세요", "⚠️");
    } finally {
      logoutBusyRef.current = false;
      setLogoutBusy(false);
    }
  };

  const handleDelete = () => {
    if (!accountReady) {
      show("계정 정보를 확인한 뒤 다시 시도해 주세요", "⚠️");
      return;
    }
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

  const closePassword = (force = false) => {
    if (!force && changePassword.isPending) return;
    setPasswordOpen(false);
    setCurrentPassword("");
    setNewPassword("");
    setNewPasswordConfirm("");
  };

  const handlePasswordChange = () => {
    if (!currentPassword) {
      show("현재 비밀번호를 입력해 주세요", "🔐");
      return;
    }
    if (newPassword.length < 6) {
      show("새 비밀번호는 6자 이상이어야 해요", "🔐");
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      show("새 비밀번호 확인이 일치하지 않아요", "🔐");
      return;
    }
    changePassword.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          show("비밀번호를 변경했어요", "✅");
          closePassword(true);
        },
        onError: (e) => show(e instanceof Error ? e.message : "비밀번호 변경에 실패했어요", "⚠️"),
      },
    );
  };

  const accountLoadError = accountIsError || (!isLoading && account === null);
  if (isLoading || accountLoadError || !account) {
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
          <div className="pa-account-state" role={accountLoadError ? "alert" : "status"}>
            {accountLoadError
              ? <span>계정 정보를 불러오지 못했어요</span>
              : <Loading label="계정 정보를 불러오는 중" />}
            {accountLoadError && (
              <button type="button" className="pa-save hy-press" onClick={() => void refetchAccount()}>
                다시 시도
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const isPrimary = account.isPrimaryParent;

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
                onChange={(e) => setPhone(formatPhoneDisplay(e.target.value))}
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
            disabled={!dirty || updateProfile.isPending} aria-busy={updateProfile.isPending}
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
            <button
              type="button"
              className="pa-row pa-row-btn hy-press"
              onClick={() => setPasswordOpen(true)}
            >
              <span className="pa-row__k">비밀번호 변경</span>
              <span className="pa-row__hint">변경</span>
            </button>
          </div>
          <div className="pa-note hy-explain">
            소셜 로그인은 아래에서 연결하거나 해제할 수 있어요.
          </div>
        </div>

        <SocialLinks />

        {/* 계정 액션 */}
        <div className="pa-group">
          <button
            type="button"
            className="pa-action hy-press"
            onClick={() => void handleLogout()}
            disabled={logoutBusy}
            aria-busy={logoutBusy}
          >
            <span className="pa-action__ic pa-action__ic--neutral">
              <LogOut size={18} strokeWidth={2.2} />
            </span>
            <span className="pa-action__label">{logoutBusy ? "로그아웃 중…" : "로그아웃"}</span>
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
        <div
          ref={deleteDialogRef}
          className="pa-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby={deleteTitleId}
          aria-describedby={deleteDescriptionId}
          tabIndex={-1}
        >
          <button
            type="button"
            className="pa-modal__scrim"
            tabIndex={-1}
            aria-label="닫기"
            onClick={() => !deleteAccount.isPending && setConfirmDelete(false)}
          />
          <div className="pa-modal__card">
            <div className="pa-modal__emoji" aria-hidden="true">
              <Trash2 size={34} strokeWidth={2.2} />
            </div>
            <div id={deleteTitleId} className="pa-modal__title">정말 탈퇴하시겠어요?</div>
            <p id={deleteDescriptionId} className="pa-modal__body">
              {isPrimary
                ? "가족의 일정·위치 이력·대화·아이 계정이 모두 영구 삭제되며 복구할 수 없어요."
                : "내 계정과 이 가족에서의 정보가 삭제돼요. 가족의 다른 데이터는 유지돼요."}
            </p>
            <div className="pa-modal__btns">
              <button
                ref={deleteCancelRef}
                type="button"
                className="pa-modal__btn pa-modal__btn--ghost hy-press"
                onClick={() => setConfirmDelete(false)}
                disabled={deleteAccount.isPending}
                data-progress-owner="confirm-action"
              >
                취소
              </button>
              <button
                type="button"
                className="pa-modal__btn pa-modal__btn--danger hy-press"
                onClick={handleDelete}
                disabled={deleteAccount.isPending} aria-busy={deleteAccount.isPending}
              >
                {deleteAccount.isPending ? "삭제 중…" : "탈퇴하기"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 비밀번호 변경 모달 */}
      {passwordOpen && (
        <div
          ref={passwordDialogRef}
          className="pa-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby={passwordTitleId}
          aria-describedby={passwordDescriptionId}
          tabIndex={-1}
        >
          <button
            type="button"
            className="pa-modal__scrim"
            tabIndex={-1}
            aria-label="닫기"
            onClick={() => closePassword()}
          />
          <div className="pa-modal__card">
            <div className="pa-modal__emoji">
              <KeyRound size={34} strokeWidth={2.2} />
            </div>
            <div id={passwordTitleId} className="pa-modal__title">비밀번호 변경</div>
            <div id={passwordDescriptionId} className="pa-modal__fields">
              <input
                ref={currentPasswordRef}
                className="pa-modal__input"
                type="password"
                aria-label="현재 비밀번호"
                autoComplete="current-password"
                placeholder="현재 비밀번호"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
              <input
                className="pa-modal__input"
                type="password"
                aria-label="새 비밀번호"
                autoComplete="new-password"
                placeholder="새 비밀번호 (6자 이상)"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <input
                className="pa-modal__input"
                type="password"
                aria-label="새 비밀번호 확인"
                autoComplete="new-password"
                placeholder="새 비밀번호 확인"
                value={newPasswordConfirm}
                onChange={(e) => setNewPasswordConfirm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handlePasswordChange();
                }}
              />
            </div>
            <div className="pa-modal__btns">
              <button
                type="button"
                className="pa-modal__btn pa-modal__btn--ghost hy-press"
                onClick={() => closePassword()}
                disabled={changePassword.isPending}
                data-progress-owner="confirm-action"
              >
                취소
              </button>
              <button
                type="button"
                className="pa-modal__btn pa-modal__btn--primary hy-press"
                onClick={handlePasswordChange}
                disabled={changePassword.isPending} aria-busy={changePassword.isPending}
              >
                {changePassword.isPending ? "변경 중…" : "변경하기"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

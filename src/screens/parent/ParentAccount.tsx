import { useEffect, useId, useState, useRef } from "react";
import type { ChangeEvent } from "react";
import { useNavigate } from "react-router";
import { ChevronLeft, KeyRound, LogOut, ShieldAlert, Trash2 } from "lucide-react";
import { asset } from "@/lib/assets";
import { resizeImageFileSafe } from "@/lib/imageResize";
import { formatPhoneDisplay } from "@/transform/phoneFormat";
import { useToast } from "@/app/toast";
import { useAuth } from "@/auth/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { qk } from "@/queries/keys";
import { useAccount, useChangePassword, useDeleteAccount } from "@/queries/useAccount";
import { useUpdateProfile, useUploadMyPhoto } from "@/queries/useFamily";
import { SocialLinks } from "./SocialLinks";
import { useDialogFocusLifecycle } from "@/components/useDialogFocusLifecycle";
import { Loading } from "@/components/ui/Loading";
import { usePwaUpdateCriticalSection } from "@/lib/usePwaUpdateCriticalSection";
import "./ParentAccount.css";
import { useIntl } from "react-intl";
import { localizeApiError } from "@/i18n/apiError";

/** P-30 계정·프로필 — 프로필 편집·로그인 정보·로그아웃·회원 탈퇴. */
export function ParentAccount() {
  const navigate = useNavigate();
  const { show } = useToast();
  const intl = useIntl();
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
  const uploadMyPhoto = useUploadMyPhoto();
  const deleteAccount = useDeleteAccount();
  const changePassword = useChangePassword();

  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [photoProcessing, setPhotoProcessing] = useState(false);
  const photoFileRef = useRef<HTMLInputElement | null>(null);
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
    ? intl.formatMessage({ id: "parent.parentAccount.copy001" })
    : account?.isCoParent
      ? intl.formatMessage({ id: "parent.parentSettings.copy004" })
      : intl.formatMessage({ id: "parent.parentSettings.copy003" });
  // 프로필 사진 — 방금 고른 사진 > 저장된 사진(표시용 blob URL) > 성별 기본 캐릭터.
  const defaultAvatarSrc = asset(me?.gender === "dad" ? "family/dad.webp" : "family/mom.webp");
  const savedPhoto = me?.photo_url
    && (me.photo_url.startsWith("http") || me.photo_url.startsWith("blob:"))
    ? me.photo_url
    : null;
  const avatarSrc = photoDataUrl ?? savedPhoto ?? defaultAvatarSrc;
  const hasOwnPhoto = !!(photoDataUrl ?? savedPhoto);
  const photoBusy = photoProcessing || uploadMyPhoto.isPending;

  // 전화번호는 표시 포맷("010-0000-0000")으로 통일해 비교한다 —
  // 저장값이 하이픈 없이 들어와도 화면에 들어온 것만으로 '변경됨'이 되지 않게 한다.
  const dirty = seeded && (
    name.trim() !== (me?.name ?? account?.myName ?? "")
    || phone.trim() !== formatPhoneDisplay(me?.phone ?? "")
  );
  const accountReady = !isLoading && !accountIsError && account !== null;
  usePwaUpdateCriticalSection(
    dirty
    || photoBusy
    || updateProfile.isPending
    || changePassword.isPending
    || deleteAccount.isPending
    || logoutBusy
    || currentPassword.length > 0
    || newPassword.length > 0
    || newPasswordConfirm.length > 0,
  );

  /**
   * 내 프로필 사진 등록·변경. 대상은 내 멤버 행이고 서버가 소유권을 다시 확인한다.
   * 고른 즉시 업로드하고, 서버 사진이 표시용 URL로 도착할 때까지 방금 고른 사진을 보여준다.
   */
  const onPickPhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // 같은 파일 재선택 허용
    if (!file || photoBusy) return;
    if (!accountReady || !me) {
      show(intl.formatMessage({ id: "parent.parentAccount.copy002" }), "⚠️");
      return;
    }
    setPhotoProcessing(true);
    let dataUrl: string | null = null;
    try {
      dataUrl = await resizeImageFileSafe(file, { maxEdge: 512, quality: 0.85 });
    } catch (error) {
      console.error("프로필 사진 준비 실패:", error);
    } finally {
      setPhotoProcessing(false);
    }
    if (!dataUrl) {
      show(intl.formatMessage({ id: "parent.profileEdit.error.photoLoad" }), "⚠️");
      return;
    }
    setPhotoDataUrl(dataUrl);
    try {
      await uploadMyPhoto.mutateAsync({ memberId: me.id, dataUrl });
      show(intl.formatMessage({ id: "parent.parentAccount.copy004" }), "✅");
    } catch (error) {
      console.error("프로필 사진 저장 실패:", error);
      setPhotoDataUrl(null); // 저장 실패를 저장된 것처럼 보여주지 않는다.
      show(localizeApiError(error, intl, "formal"), "⚠️");
    }
  };

  const saveProfile = () => {
    if (!accountReady) {
      show(intl.formatMessage({ id: "parent.parentAccount.copy002" }), "⚠️");
      return;
    }
    if (!name.trim()) {
      show(intl.formatMessage({ id: "parent.parentAccount.copy003" }), "✏️");
      return;
    }
    updateProfile.mutate(
      { name: name.trim(), phone: phone.trim() },
      {
        onSuccess: () => {
          void qc.invalidateQueries({ queryKey: qk.family(familyId) });
          void qc.invalidateQueries({ queryKey: qk.account(familyId) });
          show(intl.formatMessage({ id: "parent.parentAccount.copy004" }), "✅");
        },
        onError: (e) => {
          console.error("프로필 저장 실패:", e);
          show(intl.formatMessage({ id: "parent.parentAccount.copy005" }), "⚠️");
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
      show(intl.formatMessage({ id: "parent.parentSettings.copy005" }), "👋");
      navigate("/onboarding");
    } catch (e) {
      console.error("로그아웃 실패:", e);
      show(intl.formatMessage({ id: "parent.parentSettings.copy006" }), "⚠️");
    } finally {
      logoutBusyRef.current = false;
      setLogoutBusy(false);
    }
  };

  const handleDelete = () => {
    if (!accountReady) {
      show(intl.formatMessage({ id: "parent.parentAccount.copy002" }), "⚠️");
      return;
    }
    deleteAccount.mutate(undefined, {
      onSuccess: () => {
        show(intl.formatMessage({ id: "parent.parentSettings.copy008" }), "🗑️");
        navigate("/onboarding");
      },
      onError: (e) => {
        console.error("계정 삭제 실패:", e);
        setConfirmDelete(false);
        show(intl.formatMessage({ id: "parent.parentSettings.copy009" }), "⚠️");
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
      show(intl.formatMessage({ id: "parent.parentAccount.copy006" }), "🔐");
      return;
    }
    if (newPassword.length < 6) {
      show(intl.formatMessage({ id: "parent.parentAccount.copy007" }), "🔐");
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      show(intl.formatMessage({ id: "parent.parentAccount.copy008" }), "🔐");
      return;
    }
    changePassword.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          show(intl.formatMessage({ id: "parent.parentAccount.copy009" }), "✅");
          closePassword(true);
        },
        onError: (e) => show(localizeApiError(e, intl, "formal"), "⚠️"),
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
            aria-label={intl.formatMessage({ id: "parent.parentSettings.copy017" })}
            onClick={() => navigate(-1)}
          >
            <ChevronLeft size={22} strokeWidth={2.2} color="var(--fg-secondary)" />
          </button>
          <span className="pa-head-title">{intl.formatMessage({ id: "parent.parentAccount.copy010" })}</span>
        </header>
        <div className="pa-content">
          <div className="pa-account-state" role={accountLoadError ? "alert" : "status"}>
            {accountLoadError
              ? <span>{intl.formatMessage({ id: "parent.parentAccount.copy011" })}</span>
              : <Loading label={intl.formatMessage({ id: "parent.parentAccount.copy012" })} />}
            {accountLoadError && (
              <button type="button" className="pa-save hy-press" onClick={() => void refetchAccount()}>
                {intl.formatMessage({ id: "parent.parentHome.copy017" })}
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
          aria-label={intl.formatMessage({ id: "parent.parentSettings.copy017" })}
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} strokeWidth={2.2} color="var(--fg-secondary)" />
        </button>
        <span className="pa-head-title">{intl.formatMessage({ id: "parent.parentAccount.copy010" })}</span>
      </header>

      <div className="pa-content">
        {/* 프로필 미리보기 + 내 사진 등록(2026-08-17 TK 요청) */}
        <div className="pa-profile">
          <button
            type="button"
            className="pa-profile__avatar pa-profile__avatar--edit hy-busy-center hy-press"
            data-photo={hasOwnPhoto ? "true" : "false"}
            onClick={() => photoFileRef.current?.click()}
            disabled={!accountReady || !me || photoBusy}
            aria-busy={photoBusy}
            aria-label={intl.formatMessage({
              id: hasOwnPhoto ? "parent.parentAccount.photo.change" : "parent.parentAccount.photo.set",
            })}
          >
            <img src={avatarSrc} alt="" loading="eager" decoding="async" />
            {/* 사진 = 카메라 3D 아이콘. 설정 화면의 아이콘 언어를 따른다(2026-08-18 TK 지시). */}
            <span className="pa-profile__avatar-edit" aria-hidden="true">
              <img src={asset("ui/camera-3d.webp")} alt="" />
            </span>
          </button>
          <input
            ref={photoFileRef}
            type="file"
            accept="image/*"
            hidden
            disabled={!accountReady || !me || photoBusy}
            onChange={(event) => void onPickPhoto(event)}
          />
          <div className="pa-profile__info">
            <div className="pa-profile__name">{name.trim() || account?.myName || intl.formatMessage({ id: "parent.parentSettings.copy003" })}</div>
            <div className="pa-profile__meta">
              {providerLabel} · {roleLabel}
            </div>
            <div className="pa-profile__hint">
              {photoBusy
                ? intl.formatMessage({ id: "parent.profileEdit.photo.processing" })
                : intl.formatMessage({ id: "parent.parentAccount.photo.hint" })}
            </div>
          </div>
        </div>

        {/* 프로필 편집 */}
        <div className="pa-group">
          <div className="pa-group__label">{intl.formatMessage({ id: "parent.parentAccount.copy013" })}</div>
          <div className="pa-card">
            <label className="pa-field">
              <span className="pa-field__k">{intl.formatMessage({ id: "parent.parentAccount.copy014" })}</span>
              <input
                className="pa-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={intl.formatMessage({ id: "parent.parentAccount.copy014" })}
                disabled={isLoading}
              />
            </label>
            <div className="pa-divider" />
            <label className="pa-field">
              <span className="pa-field__k">{intl.formatMessage({ id: "parent.parentAccount.copy015" })}</span>
              <span className="pa-field__control">
                <input
                  className="pa-input"
                  value={phone}
                  onChange={(e) => setPhone(formatPhoneDisplay(e.target.value))}
                  placeholder={intl.formatMessage({ id: "parent.parentAccount.phonePlaceholder" })}
                  inputMode="tel"
                  disabled={isLoading}
                />
                <span className="pa-field__help">
                  {intl.formatMessage({ id: "parent.parentAccount.phoneKoreanOnlyHelp" })}
                </span>
              </span>
            </label>
          </div>
          <button
            type="button"
            className="pa-save hy-press"
            onClick={saveProfile}
            disabled={!dirty || updateProfile.isPending} aria-busy={updateProfile.isPending}
          >
            {updateProfile.isPending ? intl.formatMessage({ id: "parent.parentAccount.copy016" }) : intl.formatMessage({ id: "parent.parentAccount.copy017" })}
          </button>
        </div>

        {/* 로그인 정보 */}
        <div className="pa-group">
          <div className="pa-group__label">{intl.formatMessage({ id: "parent.parentAccount.copy018" })}</div>
          <div className="pa-card">
            <div className="pa-row">
              <span className="pa-row__k">{intl.formatMessage({ id: "parent.parentAccount.copy019" })}</span>
              <span className="pa-row__v">{providerLabel}</span>
            </div>
            <div className="pa-divider" />
            <button
              type="button"
              className="pa-row pa-row-btn hy-press"
              onClick={() => setPasswordOpen(true)}
            >
              <span className="pa-row__k">{intl.formatMessage({ id: "parent.parentAccount.copy020" })}</span>
              <span className="pa-row__hint">{intl.formatMessage({ id: "parent.parentAccount.copy021" })}</span>
            </button>
          </div>
          <div className="pa-note hy-explain">
            {intl.formatMessage({ id: "parent.parentAccount.copy022" })}
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
            <span className="pa-action__label">{logoutBusy ? intl.formatMessage({ id: "parent.parentAccount.copy023" }) : intl.formatMessage({ id: "parent.parentSettings.copy023" })}</span>
          </button>

          <button
            type="button"
            className="pa-action hy-press"
            onClick={() => setConfirmDelete(true)}
          >
            <span className="pa-action__ic pa-action__ic--danger">
              <ShieldAlert size={18} strokeWidth={2.2} />
            </span>
            <span className="pa-action__label pa-action__label--danger">{intl.formatMessage({ id: "parent.parentSettings.copy024" })}</span>
          </button>
        </div>

        <div className="pa-uid">
          {intl.formatMessage(
            { id: "parent.account.id" },
            { accountId: user?.id?.slice(0, 8) ?? "-" },
          )}
        </div>
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
            aria-label={intl.formatMessage({ id: "parent.parentSettings.copy027" })}
            onClick={() => !deleteAccount.isPending && setConfirmDelete(false)}
          />
          <div className="pa-modal__card">
            <div className="pa-modal__emoji" aria-hidden="true">
              <Trash2 size={34} strokeWidth={2.2} />
            </div>
            <div id={deleteTitleId} className="pa-modal__title">{intl.formatMessage({ id: "parent.parentSettings.copy028" })}</div>
            <p id={deleteDescriptionId} className="pa-modal__body">
              {isPrimary
                ? intl.formatMessage({ id: "parent.parentSettings.copy029" })
                : intl.formatMessage({ id: "parent.parentAccount.copy025" })}
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
                {intl.formatMessage({ id: "parent.parentSettings.copy031" })}
              </button>
              <button
                type="button"
                className="pa-modal__btn pa-modal__btn--danger hy-press"
                onClick={handleDelete}
                disabled={deleteAccount.isPending} aria-busy={deleteAccount.isPending}
              >
                {deleteAccount.isPending ? intl.formatMessage({ id: "parent.parentSettings.copy032" }) : intl.formatMessage({ id: "parent.parentSettings.copy033" })}
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
            aria-label={intl.formatMessage({ id: "parent.parentSettings.copy027" })}
            onClick={() => closePassword()}
          />
          <div className="pa-modal__card">
            <div className="pa-modal__emoji">
              <KeyRound size={34} strokeWidth={2.2} />
            </div>
            <div id={passwordTitleId} className="pa-modal__title">{intl.formatMessage({ id: "parent.parentAccount.copy020" })}</div>
            <div id={passwordDescriptionId} className="pa-modal__fields">
              <input
                ref={currentPasswordRef}
                className="pa-modal__input"
                type="password"
                aria-label={intl.formatMessage({ id: "parent.parentAccount.copy026" })}
                autoComplete="current-password"
                placeholder={intl.formatMessage({ id: "parent.parentAccount.copy026" })}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
              <input
                className="pa-modal__input"
                type="password"
                aria-label={intl.formatMessage({ id: "parent.parentAccount.copy027" })}
                autoComplete="new-password"
                placeholder={intl.formatMessage({ id: "parent.parentAccount.copy028" })}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <input
                className="pa-modal__input"
                type="password"
                aria-label={intl.formatMessage({ id: "parent.parentAccount.copy029" })}
                autoComplete="new-password"
                placeholder={intl.formatMessage({ id: "parent.parentAccount.copy029" })}
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
                {intl.formatMessage({ id: "parent.parentSettings.copy031" })}
              </button>
              <button
                type="button"
                className="pa-modal__btn pa-modal__btn--primary hy-press"
                onClick={handlePasswordChange}
                disabled={changePassword.isPending} aria-busy={changePassword.isPending}
              >
                {changePassword.isPending ? intl.formatMessage({ id: "parent.parentAccount.copy030" }) : intl.formatMessage({ id: "parent.parentAccount.copy031" })}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

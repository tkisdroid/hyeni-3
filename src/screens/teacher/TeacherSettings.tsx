import { useId, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useIntl } from "react-intl";
import { Bell, ChevronLeft, ChevronRight, Lock, LogOut, MessageCircleQuestion, Trash2, TriangleAlert } from "lucide-react";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { ScreenQueryState } from "@/components/ui/ScreenQueryState";
import { APP_VERSION } from "@/config/version";
import { useAuth } from "@/auth/AuthContext";
import { useAccount, useDeleteAccount } from "@/queries/useAccount";
import { useDialogFocusLifecycle } from "@/components/useDialogFocusLifecycle";
import { useTeacherClasses } from "@/queries/useTeacher";
import { openExternal } from "@/lib/native/browser";
import { isNativePlatform } from "@/lib/native/plugins";
import { PRIVACY_POLICY_URL } from "@/lib/api/endpoints/account";
import { resolveQueryTruthState } from "@/transform/queryTruthState";
// 설정 화면 공통 스타일(ps-*) 재사용 — 부모/선생님 설정이 동일 레이아웃.
import "../parent/ParentSettings.css";

/** 선생님 반 관리 네비게이션 행. */
const CLASS_ROWS = [
  { id: "timetable", icon: "cat/study.webp", labelId: "shared.teacherSettings.classRow.timetable", route: "/teacher/timetable" },
  { id: "students", icon: "family/son.webp", labelId: "shared.teacherSettings.classRow.students", route: "/teacher/students" },
  { id: "notice", icon: "ui/megaphone.webp", labelId: "shared.teacherSettings.classRow.notice", route: "/teacher/notice" },
] as const;

/** T-04 선생님 설정 — 프로필 + 반 관리 + 알림 + 약관·계정. */
export function TeacherSettings() {
  const intl = useIntl();
  const navigate = useNavigate();
  const { show } = useToast();
  const { logout } = useAuth();
  const accountQuery = useAccount();
  const { account, providerLabel } = accountQuery;
  const deleteAccount = useDeleteAccount();
  const classesQ = useTeacherClasses();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteTitleId = useId();
  const deleteDescriptionId = useId();
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const teacherSettingsQueryState = resolveQueryTruthState([
    { isLoading: accountQuery.isLoading, isError: accountQuery.isError },
    { isLoading: classesQ.isLoading, isError: classesQ.isError },
  ]);
  const teacherSettingsDataMissing = teacherSettingsQueryState === "ready" && !account;
  const deleteDialogVisible = confirmDelete && teacherSettingsQueryState === "ready" && !teacherSettingsDataMissing;
  const deleteDialogRef = useDialogFocusLifecycle<HTMLDivElement>({
    open: deleteDialogVisible,
    onClose: () => setConfirmDelete(false),
    initialFocusRef: deleteCancelRef,
    canClose: () => !deleteAccount.isPending,
  });
  const noTeacherClasses = teacherSettingsQueryState === "ready" && classesQ.data?.length === 0;
  const teacherSettingsRefetching = accountQuery.isFetching || classesQ.isFetching;
  const retryTeacherSettings = async (): Promise<void> => {
    await Promise.all([accountQuery.refetch(), classesQ.refetch()]);
  };

  const displayName = account?.myName
    || intl.formatMessage({ id: "shared.teacherSettings.nameFallback" });
  const className = classesQ.data?.[0]?.className
    ?? intl.formatMessage({ id: "shared.teacherSettings.classFallback" });

  const logoutBusyRef = useRef(false);
  const handleLogout = async () => {
    if (logoutBusyRef.current) return; // 이중 탭 가드
    logoutBusyRef.current = true;
    try {
      await logout();
      navigate("/onboarding");
    } catch (e) {
      console.error("로그아웃 실패:", e);
      show(intl.formatMessage({ id: "shared.teacherSettings.logout.error" }), "⚠️");
    } finally {
      logoutBusyRef.current = false;
    }
  };

  const handleDelete = () => {
    deleteAccount.mutate(undefined, {
      onSuccess: () => {
        show(intl.formatMessage({ id: "shared.teacherSettings.delete.success" }), "🗑️");
        navigate("/onboarding");
      },
      onError: (e) => {
        console.error("계정 삭제 실패:", e);
        show(intl.formatMessage({ id: "shared.teacherSettings.delete.error" }), "⚠️");
      },
    });
  };

  const openPrivacy = () => {
    if (isNativePlatform())
      openExternal(PRIVACY_POLICY_URL).catch(() => show(
        intl.formatMessage({ id: "shared.teacherSettings.privacy.error" }),
        "⚠️",
      ));
    else window.open(PRIVACY_POLICY_URL, "_blank", "noopener");
  };

  if (teacherSettingsQueryState === "loading") {
    return (
      <ScreenQueryState
        screenTitle={intl.formatMessage({ id: "shared.teacherSettings.screenTitle" })}
        state="loading"
        heading={intl.formatMessage({ id: "shared.teacherSettings.loading.heading" })}
        description={intl.formatMessage({ id: "shared.teacherSettings.loading.description" })}
        onBack={() => navigate(-1)}
      />
    );
  }

  if (teacherSettingsQueryState === "error" || teacherSettingsDataMissing) {
    return (
      <ScreenQueryState
        screenTitle={intl.formatMessage({ id: "shared.teacherSettings.screenTitle" })}
        state="error"
        heading={intl.formatMessage({ id: "shared.teacherSettings.error.heading" })}
        description={intl.formatMessage({ id: "shared.teacherSettings.error.description" })}
        onBack={() => navigate(-1)}
        onRetry={() => void retryTeacherSettings()}
        retrying={teacherSettingsRefetching}
      />
    );
  }

  return (
    <div className="hy-rise-in">
      <header className="ps-head">
        <button
          type="button"
          className="ps-back hy-press"
          aria-label={intl.formatMessage({ id: "shared.teacherSettings.back" })}
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} strokeWidth={2.2} color="#4A4145" />
        </button>
        <span className="ps-head-title">
          {intl.formatMessage({ id: "shared.teacherSettings.title" })}
        </span>
      </header>

      <div className="ps-content">
        {noTeacherClasses && (
          <div className="sqs-inline-empty">
            <span>{intl.formatMessage({ id: "shared.teacherSettings.empty.description" })}</span>
            <button type="button" className="hy-press" onClick={() => void retryTeacherSettings()}>
              {intl.formatMessage({ id: "shared.teacherSettings.empty.retry" })}
            </button>
          </div>
        )}
        {/* 프로필 (선생님) */}
        <div className="ps-profile">
          <div className="ps-profile__avatar">
            <img src={asset("cat/study.webp")} alt="" />
          </div>
          <div className="ps-profile__info">
            <div className="ps-profile__name">
              {displayName} · {intl.formatMessage({ id: "shared.teacherSettings.profileName" })}
            </div>
            <div className="ps-profile__meta">
              {providerLabel} · {className}
            </div>
          </div>
        </div>

        {/* 반 관리 */}
        <div className="ps-group">
          <div className="ps-group__label">
            {intl.formatMessage({ id: "shared.teacherSettings.group.class" })}
          </div>
          <div className="ps-list">
            {CLASS_ROWS.map((r) => (
              <button
                key={r.id}
                type="button"
                className="ps-feature hy-press"
                onClick={() => navigate(r.route)}
              >
                <span className="ps-feature__icon">
                  <img src={asset(r.icon)} alt="" />
                </span>
                <span className="ps-feature__label">
                  {intl.formatMessage({ id: r.labelId })}
                </span>
                <ChevronRight className="ps-feature__chev" size={18} strokeWidth={2.4} color="#C9BFC4" />
              </button>
            ))}
          </div>
        </div>

        {/* 설정 */}
        <div className="ps-group">
          <div className="ps-group__label">
            {intl.formatMessage({ id: "shared.teacherSettings.group.settings" })}
          </div>
          <div className="ps-list">
            <button
              type="button"
              className="ps-nav hy-press"
              onClick={() => navigate("/notification-settings")}
            >
              <span className="ps-nav__chip" data-tone="rose"><Bell size={18} strokeWidth={2.3} /></span>
              <span className="ps-nav__label">
                {intl.formatMessage({ id: "shared.teacherSettings.notification" })}
              </span>
              <ChevronRight className="ps-nav__chev" size={18} strokeWidth={2.4} color="#C9BFC4" />
            </button>
          </div>
        </div>

        {/* 약관 · 계정 */}
        <div className="ps-group">
          <div className="ps-group__label">
            {intl.formatMessage({ id: "shared.teacherSettings.group.legalAccount" })}
          </div>
          <div className="ps-list">
            <button type="button" className="ps-account hy-press" onClick={openPrivacy}>
              <span className="ps-account__chip" data-tone="neutral"><Lock size={18} strokeWidth={2.3} /></span>
              <span className="ps-account__label">
                {intl.formatMessage({ id: "shared.teacherSettings.privacy" })}
              </span>
              <ChevronRight className="ps-nav__chev" size={18} strokeWidth={2.4} color="#C9BFC4" />
            </button>
            <button type="button" className="ps-account hy-press" onClick={() => navigate("/feedback")}>
              <span className="ps-account__chip" data-tone="blue"><MessageCircleQuestion size={18} strokeWidth={2.3} /></span>
              <span className="ps-account__label">
                {intl.formatMessage({ id: "shared.teacherSettings.feedback" })}
              </span>
              <ChevronRight className="ps-nav__chev" size={18} strokeWidth={2.4} color="#C9BFC4" />
            </button>
            <button type="button" className="ps-account hy-press" onClick={() => void handleLogout()}>
              <span className="ps-account__chip" data-tone="danger"><LogOut size={18} strokeWidth={2.3} /></span>
              <span className="ps-account__label">
                {intl.formatMessage({ id: "shared.teacherSettings.logout.action" })}
              </span>
            </button>
            <button type="button" className="ps-account hy-press" onClick={() => setConfirmDelete(true)}>
              <span className="ps-account__chip" data-tone="danger"><TriangleAlert size={18} strokeWidth={2.3} /></span>
              <span className="ps-account__label" style={{ color: "var(--danger-text)" }}>
                {intl.formatMessage({ id: "shared.teacherSettings.delete.action" })}
              </span>
            </button>
          </div>
        </div>

        <div className="ps-version">
          {intl.formatMessage(
            { id: "shared.teacherSettings.version" },
            { version: APP_VERSION },
          )}
        </div>
      </div>

      {/* 회원 탈퇴 확인 모달 */}
      {deleteDialogVisible && (
        <div
          ref={deleteDialogRef}
          className="ps-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby={deleteTitleId}
          aria-describedby={deleteDescriptionId}
        >
          <button
            type="button"
            className="ps-modal__scrim"
            tabIndex={-1}
            aria-label={intl.formatMessage({ id: "shared.teacherSettings.delete.close" })}
            onClick={() => !deleteAccount.isPending && setConfirmDelete(false)}
          />
          <div className="ps-modal__card">
            <div className="ps-modal__emoji" aria-hidden="true">
              <Trash2 size={24} strokeWidth={2.2} />
            </div>
            <div id={deleteTitleId} className="ps-modal__title">
              {intl.formatMessage({ id: "shared.teacherSettings.delete.dialogTitle" })}
            </div>
            <p id={deleteDescriptionId} className="ps-modal__body">
              {intl.formatMessage({ id: "shared.teacherSettings.delete.dialogDescription" })}
            </p>
            <div className="ps-modal__btns">
              <button
                ref={deleteCancelRef}
                type="button"
                className="ps-modal__btn ps-modal__btn--ghost hy-press"
                onClick={() => setConfirmDelete(false)}
                disabled={deleteAccount.isPending}
                data-progress-owner="confirm-action"
              >
                {intl.formatMessage({ id: "shared.teacherSettings.delete.cancel" })}
              </button>
              <button
                type="button"
                className="ps-modal__btn ps-modal__btn--danger hy-press"
                onClick={handleDelete}
                disabled={deleteAccount.isPending} aria-busy={deleteAccount.isPending}
              >
                {deleteAccount.isPending
                  ? intl.formatMessage({ id: "shared.teacherSettings.delete.pending" })
                  : intl.formatMessage({ id: "shared.teacherSettings.delete.confirm" })}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

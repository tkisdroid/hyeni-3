import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, Bell, Lock, MessageCircle, LogOut, TriangleAlert } from "lucide-react";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { ScreenQueryState } from "@/components/ui/ScreenQueryState";
import { APP_VERSION } from "@/config/version";
import { useAuth } from "@/auth/AuthContext";
import { useAccount, useDeleteAccount } from "@/queries/useAccount";
import { useTeacherClasses } from "@/queries/useTeacher";
import { openExternal } from "@/lib/native/browser";
import { isNativePlatform } from "@/lib/native/plugins";
import { PRIVACY_POLICY_URL } from "@/lib/api/endpoints/account";
import { resolveQueryTruthState } from "@/transform/queryTruthState";
// 설정 화면 공통 스타일(ps-*) 재사용 — 부모/선생님 설정이 동일 레이아웃.
import "../parent/ParentSettings.css";

/** 선생님 반 관리 네비게이션 행. */
const CLASS_ROWS = [
  { id: "timetable", icon: "cat/study.webp", label: "반 시간표", route: "/teacher/timetable" },
  { id: "students", icon: "family/son.webp", label: "학생 관리", route: "/teacher/students" },
  { id: "notice", icon: "ui/megaphone.webp", label: "알림장 보내기", route: "/teacher/notice" },
] as const;

/** T-04 선생님 설정 — 프로필 + 반 관리 + 알림 + 약관·계정. */
export function TeacherSettings() {
  const navigate = useNavigate();
  const { show } = useToast();
  const { logout } = useAuth();
  const accountQuery = useAccount();
  const { account, providerLabel } = accountQuery;
  const deleteAccount = useDeleteAccount();
  const classesQ = useTeacherClasses();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const teacherSettingsQueryState = resolveQueryTruthState([
    { isLoading: accountQuery.isLoading, isError: accountQuery.isError },
    { isLoading: classesQ.isLoading, isError: classesQ.isError },
  ]);
  const teacherSettingsDataMissing = teacherSettingsQueryState === "ready" && !account;
  const noTeacherClasses = teacherSettingsQueryState === "ready" && classesQ.data?.length === 0;
  const teacherSettingsRefetching = accountQuery.isFetching || classesQ.isFetching;
  const retryTeacherSettings = async (): Promise<void> => {
    await Promise.all([accountQuery.refetch(), classesQ.refetch()]);
  };

  const displayName = account?.myName || "선생님";
  const className = classesQ.data?.[0]?.className ?? "연결된 반 없음";

  const logoutBusyRef = useRef(false);
  const handleLogout = async () => {
    if (logoutBusyRef.current) return; // 이중 탭 가드
    logoutBusyRef.current = true;
    try {
      await logout();
      navigate("/onboarding");
    } catch (e) {
      console.error("로그아웃 실패:", e);
      show("로그아웃에 실패했어요. 잠시 후 다시 시도해 주세요", "⚠️");
    } finally {
      logoutBusyRef.current = false;
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
        show("계정 삭제에 실패했어요. 잠시 후 다시 시도해 주세요", "⚠️");
      },
    });
  };

  const openPrivacy = () => {
    if (isNativePlatform())
      openExternal(PRIVACY_POLICY_URL).catch(() => show("브라우저를 열 수 없어요", "⚠️"));
    else window.open(PRIVACY_POLICY_URL, "_blank", "noopener");
  };

  if (teacherSettingsQueryState === "loading") {
    return (
      <ScreenQueryState
        screenTitle="선생님 설정"
        state="loading"
        heading="설정을 불러오고 있어요"
        description="계정과 연결된 반을 확인하는 중이에요."
        onBack={() => navigate(-1)}
      />
    );
  }

  if (teacherSettingsQueryState === "error" || teacherSettingsDataMissing) {
    return (
      <ScreenQueryState
        screenTitle="선생님 설정"
        state="error"
        heading="설정을 불러오지 못했어요"
        description="계정과 반 정보를 다시 확인해 주세요."
        onBack={() => navigate(-1)}
        onRetry={() => void retryTeacherSettings()}
        retrying={teacherSettingsRefetching}
      />
    );
  }

  return (
    <div className="hy-rise-in">
      <header className="ps-head">
        <button type="button" className="ps-back hy-press" aria-label="뒤로" onClick={() => navigate(-1)}>
          <ChevronLeft size={22} strokeWidth={2.2} color="#4A4145" />
        </button>
        <span className="ps-head-title">설정</span>
      </header>

      <div className="ps-content">
        {noTeacherClasses && (
          <div className="sqs-inline-empty">
            <span>아직 연결된 반이 없어요. 반을 만든 뒤 시간표와 학생 관리를 시작할 수 있어요.</span>
            <button type="button" className="hy-press" onClick={() => void retryTeacherSettings()}>
              다시 확인하기
            </button>
          </div>
        )}
        {/* 프로필 (선생님) */}
        <div className="ps-profile">
          <div className="ps-profile__avatar">
            <img src={asset("cat/study.webp")} alt="" />
          </div>
          <div className="ps-profile__info">
            <div className="ps-profile__name">{displayName} 선생님</div>
            <div className="ps-profile__meta">
              {providerLabel} · {className}
            </div>
          </div>
        </div>

        {/* 반 관리 */}
        <div className="ps-group">
          <div className="ps-group__label">반 관리</div>
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
                <span className="ps-feature__label">{r.label}</span>
                <ChevronRight className="ps-feature__chev" size={18} strokeWidth={2.4} color="#C9BFC4" />
              </button>
            ))}
          </div>
        </div>

        {/* 설정 */}
        <div className="ps-group">
          <div className="ps-group__label">설정</div>
          <div className="ps-list">
            <button
              type="button"
              className="ps-nav hy-press"
              onClick={() => navigate("/notification-settings")}
            >
              <span className="ps-nav__chip" data-tone="rose"><Bell size={18} strokeWidth={2.3} /></span>
              <span className="ps-nav__label">알림 설정</span>
              <ChevronRight className="ps-nav__chev" size={18} strokeWidth={2.4} color="#C9BFC4" />
            </button>
          </div>
        </div>

        {/* 약관 · 계정 */}
        <div className="ps-group">
          <div className="ps-group__label">약관 · 계정</div>
          <div className="ps-list">
            <button type="button" className="ps-account hy-press" onClick={openPrivacy}>
              <span className="ps-account__chip" data-tone="neutral"><Lock size={18} strokeWidth={2.3} /></span>
              <span className="ps-account__label">개인정보 처리방침</span>
              <ChevronRight className="ps-nav__chev" size={18} strokeWidth={2.4} color="#C9BFC4" />
            </button>
            <button type="button" className="ps-account hy-press" onClick={() => navigate("/feedback")}>
              <span className="ps-account__chip" data-tone="blue"><MessageCircle size={18} strokeWidth={2.3} /></span>
              <span className="ps-account__label">도움말 · 피드백</span>
              <ChevronRight className="ps-nav__chev" size={18} strokeWidth={2.4} color="#C9BFC4" />
            </button>
            <button type="button" className="ps-account hy-press" onClick={() => void handleLogout()}>
              <span className="ps-account__chip" data-tone="danger"><LogOut size={18} strokeWidth={2.3} /></span>
              <span className="ps-account__label">로그아웃</span>
            </button>
            <button type="button" className="ps-account hy-press" onClick={() => setConfirmDelete(true)}>
              <span className="ps-account__chip" data-tone="danger"><TriangleAlert size={18} strokeWidth={2.3} /></span>
              <span className="ps-account__label" style={{ color: "var(--danger-text)" }}>
                회원 탈퇴
              </span>
            </button>
          </div>
        </div>

        <div className="ps-version">혜니캘린더 v{APP_VERSION} · 선생님 모드</div>
      </div>

      {/* 회원 탈퇴 확인 모달 */}
      {confirmDelete && (
        <div className="ps-modal" role="dialog" aria-modal="true">
          <button
            type="button"
            className="ps-modal__scrim"
            aria-label="닫기"
            onClick={() => !deleteAccount.isPending && setConfirmDelete(false)}
          />
          <div className="ps-modal__card">
            <div className="ps-modal__emoji">🗑️</div>
            <div className="ps-modal__title">정말 탈퇴하시겠어요?</div>
            <p className="ps-modal__body">
              내 선생님 계정과 만든 반·학생 연결 정보가 삭제돼요. 복구할 수 없어요.
            </p>
            <div className="ps-modal__btns">
              <button
                type="button"
                className="ps-modal__btn ps-modal__btn--ghost hy-press"
                onClick={() => setConfirmDelete(false)}
                disabled={deleteAccount.isPending}
              >
                취소
              </button>
              <button
                type="button"
                className="ps-modal__btn ps-modal__btn--danger hy-press"
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

import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, Bell, Lock, MessageCircle, LogOut, TriangleAlert } from "lucide-react";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { useAuth } from "@/auth/AuthContext";
import { useAccount, useDeleteAccount } from "@/queries/useAccount";
import { useTeacherClasses } from "@/queries/useTeacher";
import { openExternal } from "@/lib/native/browser";
import { isNativePlatform } from "@/lib/native/plugins";
import { PRIVACY_POLICY_URL } from "@/lib/api/endpoints/account";
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
  const { account, providerLabel } = useAccount();
  const deleteAccount = useDeleteAccount();
  const classesQ = useTeacherClasses();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const displayName = account?.myName || "선생님";
  const className = classesQ.data?.[0]?.className ?? "우리 반";

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
    if (isNativePlatform()) void openExternal(PRIVACY_POLICY_URL);
    else window.open(PRIVACY_POLICY_URL, "_blank", "noopener");
  };

  return (
    <div className="hy-rise-in">
      <header className="ps-head">
        <button type="button" className="ps-back hy-press" aria-label="뒤로" onClick={() => navigate(-1)}>
          <ChevronLeft size={22} strokeWidth={2.2} color="#4A4145" />
        </button>
        <span className="ps-head-title">설정</span>
      </header>

      <div className="ps-content">
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

        <div className="ps-version">혜니캘린더 v2.0.0 · 선생님 모드</div>
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

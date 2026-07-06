import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { useAuth } from "@/auth/AuthContext";
import { useEntitlement } from "@/queries/useEntitlement";
import { useAccount, useDeleteAccount } from "@/queries/useAccount";
import { openExternal } from "@/lib/native/browser";
import { isNativePlatform } from "@/lib/native/plugins";
import { PRIVACY_POLICY_URL } from "@/lib/api/endpoints/account";
import "./ParentSettings.css";

/* ── 행 정의 (결합 회피: 화면 자체 정의) ─────────────────────────────── */

type NavRow = { id: string; emoji: string; chipBg: string; label: string; route: string; badge?: boolean };

const settingsRows: NavRow[] = [
  { id: "account", emoji: "👤", chipBg: "#EDE9FF", label: "계정 · 프로필", route: "/account" },
  { id: "notif", emoji: "🔔", chipBg: "#FDE7F1", label: "알림 설정", route: "/notification-settings" },
  { id: "location", emoji: "📍", chipBg: "#E6F2FB", label: "위치 · 백그라운드", route: "/location-settings" },
  { id: "data", emoji: "🔄", chipBg: "#F1ECFF", label: "데이터 · 동기화", route: "/data-sync" },
  { id: "subscription", emoji: "👑", chipBg: "#FFF3D6", label: "구독 관리", route: "/subscription", badge: true },
];

type FeatureRow = { id: string; icon: string; label: string; route: string };

const featureRows: FeatureRow[] = [
  { id: "child", icon: "ui/menu-child-tracker.webp", label: "아이 관리", route: "/parent/family" },
  { id: "place", icon: "ui/menu-place-manager.webp", label: "장소 관리", route: "/place-manager" },
  { id: "friend", icon: "ui/menu-friend-playdate.webp", label: "친구 · 놀이 약속", route: "/friend-play" },
  { id: "audio", icon: "ui/menu-remote-audio.webp", label: "원격 소리 듣기", route: "/remote-audio" },
  { id: "reward", icon: "ui/menu-sticker.webp", label: "스티커 · 보상", route: "/sticker-send" },
  { id: "ai", icon: "ui/menu-ai-schedule.webp", label: "AI 친구 · 크레딧", route: "/ai-credit" },
];

export function ParentSettings() {
  const navigate = useNavigate();
  const { show } = useToast();
  const { logout } = useAuth();
  const { account, providerLabel } = useAccount();
  const deleteAccount = useDeleteAccount();
  const [confirmDelete, setConfirmDelete] = useState(false);
  // 티어 배지는 ready 일 때만 노출(미확정/조회실패 시 미표시 — R9: free 강등 금지).
  const { ready, view } = useEntitlement();

  const displayName = account?.myName || "보호자";
  const roleLabel = account?.isCoParent ? "공동 보호자" : "보호자";

  const handleLogout = async () => {
    try {
      await logout();
      show("로그아웃되었어요", "👋");
      navigate("/onboarding");
    } catch (error) {
      console.error("로그아웃 실패:", error);
      show("로그아웃에 실패했어요. 다시 시도해 주세요", "⚠️");
    }
  };

  // 개인정보 처리방침 — Worker 가 서빙하는 실제 공개 페이지.
  // 네이티브는 시스템 브라우저, 웹은 새 탭(앱을 벗어나지 않게)으로 연다.
  const openPrivacy = () => {
    if (isNativePlatform()) {
      void openExternal(PRIVACY_POLICY_URL).catch((error) => {
        console.error("개인정보 처리방침 열기 실패:", error);
        show("브라우저를 열 수 없어요", "⚠️");
      });
      return;
    }
    window.open(PRIVACY_POLICY_URL, "_blank", "noopener");
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

  return (
    <div className="hy-rise-in">
      <header className="ps-head">
        <button
          type="button"
          className="ps-back hy-press"
          aria-label="뒤로"
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} strokeWidth={2.2} color="#4A4145" />
        </button>
        <span className="ps-head-title">설정</span>
      </header>

      <div className="ps-content">
        {/* 프로필 (실 로그인 사용자) */}
        <div className="ps-profile">
          <div className="ps-profile__avatar">
            <img src={asset("family/mom.webp")} alt="" />
          </div>
          <div className="ps-profile__info">
            <div className="ps-profile__name">{displayName}</div>
            <div className="ps-profile__meta">
              {providerLabel} · {roleLabel}
            </div>
          </div>
          <button
            type="button"
            className="ps-profile__edit hy-press"
            onClick={() => navigate("/account")}
          >
            편집
          </button>
        </div>

        {/* 설정 (신규 화면 배선) */}
        <div className="ps-group">
          <div className="ps-group__label">설정</div>
          <div className="ps-list">
            {settingsRows.map((r) => (
              <button
                key={r.id}
                type="button"
                className="ps-nav hy-press"
                onClick={() => navigate(r.route)}
              >
                <span className="ps-nav__chip" style={{ background: r.chipBg }}>
                  {r.emoji}
                </span>
                <span className="ps-nav__label">{r.label}</span>
                {r.badge && ready && view && (
                  <span className="ps-account__badge" data-premium={view.isPremium}>
                    {view.tierLabel}
                  </span>
                )}
                <ChevronRight className="ps-nav__chev" size={18} strokeWidth={2.4} color="#C9BFC4" />
              </button>
            ))}
          </div>
        </div>

        {/* 가족 · 안전 */}
        <div className="ps-group">
          <div className="ps-group__label">가족 · 안전</div>
          <div className="ps-list">
            {featureRows.map((f) => (
              <button
                key={f.id}
                type="button"
                className="ps-feature hy-press"
                onClick={() => navigate(f.route)}
              >
                <span className="ps-feature__icon">
                  <img src={asset(f.icon)} alt="" />
                </span>
                <span className="ps-feature__label">{f.label}</span>
                <ChevronRight className="ps-feature__chev" size={19} strokeWidth={2.4} color="#C9BFC4" />
              </button>
            ))}
          </div>
        </div>

        {/* 약관 · 계정 */}
        <div className="ps-group">
          <div className="ps-group__label">약관 · 계정</div>
          <div className="ps-list">
            <button type="button" className="ps-account hy-press" onClick={openPrivacy}>
              <span className="ps-account__chip" style={{ background: "#F7F3F5" }}>🔒</span>
              <span className="ps-account__label">개인정보 처리방침</span>
              <ChevronRight className="ps-nav__chev" size={18} strokeWidth={2.4} color="#C9BFC4" />
            </button>
            <button type="button" className="ps-account hy-press" onClick={() => navigate("/feedback")}>
              <span className="ps-account__chip" style={{ background: "#E6F2FB" }}>💬</span>
              <span className="ps-account__label">도움말 · 피드백</span>
              <ChevronRight className="ps-nav__chev" size={18} strokeWidth={2.4} color="#C9BFC4" />
            </button>
            <button type="button" className="ps-account hy-press" onClick={() => void handleLogout()}>
              <span className="ps-account__chip" style={{ background: "#FFECEE" }}>🚪</span>
              <span className="ps-account__label">로그아웃</span>
            </button>
            <button type="button" className="ps-account hy-press" onClick={() => setConfirmDelete(true)}>
              <span className="ps-account__chip" style={{ background: "#FFECEE" }}>⚠️</span>
              <span className="ps-account__label" style={{ color: "var(--danger-text)" }}>
                회원 탈퇴
              </span>
            </button>
          </div>
        </div>

        <div className="ps-version">혜니캘린더 v2.0.0 · 함께 보는 우리 가족 일정</div>
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
              {account?.isPrimaryParent
                ? "가족의 일정·위치 이력·대화·아이 계정이 모두 영구 삭제되며 복구할 수 없어요."
                : "내 계정과 이 가족에서의 정보가 삭제돼요."}
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

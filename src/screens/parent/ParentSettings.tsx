import { useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  AlertTriangle,
  Bell,
  ChevronLeft,
  ChevronRight,
  Crown,
  DatabaseZap,
  Gift,
  LogOut,
  MapPin,
  MessageCircleQuestion,
  ShieldCheck,
  Star,
  Trash2,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { ScreenQueryState } from "@/components/ui/ScreenQueryState";
import { ReferralRewardPanel } from "@/components/ReferralRewardPanel";
import { APP_VERSION } from "@/config/version";
import { useAuth } from "@/auth/AuthContext";
import { useEntitlement } from "@/queries/useEntitlement";
import { useAccount, useDeleteAccount } from "@/queries/useAccount";
import { useDialogFocusLifecycle } from "@/components/useDialogFocusLifecycle";
import { openExternal } from "@/lib/native/browser";
import { isNativePlatform } from "@/lib/native/plugins";
import { PRIVACY_POLICY_URL } from "@/lib/api/endpoints/account";
import { getTierLabel, TIERS } from "@/transform/tierPolicy";
import { resolveQueryTruthState } from "@/transform/queryTruthState";
import "./ParentSettings.css";

/* ── 행 정의 (결합 회피: 화면 자체 정의) ─────────────────────────────── */

type Tone = "lav" | "rose" | "blue" | "mint" | "gold" | "neutral" | "danger";
type NavRow = { id: string; Icon: LucideIcon; tone: Tone; label: string; route: string; badge?: boolean };

const settingsRows: NavRow[] = [
  { id: "account", Icon: UserRound, tone: "lav", label: "계정 · 프로필", route: "/account" },
  { id: "notif", Icon: Bell, tone: "rose", label: "알림 설정", route: "/notification-settings" },
  { id: "location", Icon: MapPin, tone: "blue", label: "위치 · 백그라운드", route: "/location-settings" },
  { id: "data", Icon: DatabaseZap, tone: "mint", label: "데이터 · 동기화", route: "/data-sync" },
  { id: "subscription", Icon: Crown, tone: "gold", label: "구독 관리", route: "/subscription", badge: true },
];

type FeatureRow = { id: string; icon: string; tone: Tone; label: string; route: string };

const featureRows: FeatureRow[] = [
  { id: "child", icon: "ui/menu-child-tracker.webp", tone: "blue", label: "아이 관리", route: "/parent/family" },
  { id: "place", icon: "ui/menu-place-manager.webp", tone: "mint", label: "장소 관리", route: "/place-manager" },
  { id: "friend", icon: "ui/menu-friend-playdate.webp", tone: "gold", label: "친구 · 놀이 약속", route: "/friend-play" },
  { id: "audio", icon: "ui/menu-remote-audio.webp", tone: "rose", label: "원격 소리 듣기", route: "/remote-audio" },
  { id: "audio-audit", icon: "ui/menu-remote-audio.webp", tone: "neutral", label: "주변 소리 듣기 기록", route: "/remote-audio-audit" },
  { id: "reward", icon: "ui/menu-sticker.webp", tone: "gold", label: "스티커 · 보상", route: "/sticker-send" },
  { id: "ai", icon: "ui/menu-ai-schedule.webp", tone: "lav", label: "AI 친구 · 크레딧", route: "/ai-credit" },
];

type AccountRow = {
  id: string;
  Icon: LucideIcon;
  tone: Tone;
  label: string;
  onClick: () => void;
  danger?: boolean;
  chevron?: boolean;
};

function SettingsIcon({ Icon, tone }: { Icon: LucideIcon; tone: Tone }) {
  return (
    <span className="ps-nav__chip" data-tone={tone}>
      <Icon size={18} strokeWidth={2.3} />
    </span>
  );
}

function AccountIcon({ Icon, tone }: { Icon: LucideIcon; tone: Tone }) {
  return (
    <span className="ps-account__chip" data-tone={tone}>
      <Icon size={18} strokeWidth={2.3} />
    </span>
  );
}

const chevronIcon = <ChevronRight className="ps-nav__chev" size={18} strokeWidth={2.4} />;
const featureChevronIcon = <ChevronRight className="ps-feature__chev" size={18} strokeWidth={2.4} />;

export function ParentSettings() {
  const navigate = useNavigate();
  const { show } = useToast();
  const { logout, user } = useAuth();
  const accountQuery = useAccount();
  const { account, me, providerLabel } = accountQuery;
  const deleteAccount = useDeleteAccount();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [referralOpen, setReferralOpen] = useState(false);
  const deleteTitleId = useId();
  const deleteDescriptionId = useId();
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  // 티어 배지는 ready 일 때만 노출(미확정/조회실패 시 미표시 — R9: free 강등 금지).
  const entitlementQuery = useEntitlement();
  const { ready, tier } = entitlementQuery;
  const settingsQueryState = resolveQueryTruthState([
    { isLoading: accountQuery.isLoading, isError: accountQuery.isError },
    { isLoading: entitlementQuery.isLoading, isError: entitlementQuery.isError },
  ]);
  const settingsDataEmpty = settingsQueryState === "ready" && (!account || !entitlementQuery.view);
  const deleteDialogVisible = confirmDelete && settingsQueryState === "ready" && !settingsDataEmpty;
  const deleteDialogRef = useDialogFocusLifecycle<HTMLDivElement>({
    open: deleteDialogVisible,
    onClose: () => setConfirmDelete(false),
    initialFocusRef: deleteCancelRef,
    canClose: () => !deleteAccount.isPending,
  });
  const settingsRefetching = accountQuery.isFetching || entitlementQuery.isFetching;
  const retryParentSettings = async (): Promise<void> => {
    await Promise.all([accountQuery.refetch(), entitlementQuery.refetch()]);
  };
  const reviewRewardNotice = !ready
    ? null
    : tier === TIERS.REVIEWED
      ? "기존에 받은 스토어 방문 혜택은 그대로 유지돼요"
      : tier === TIERS.FREE
        ? "스토어 방문 혜택의 신규 지급은 종료되었어요"
        : null;
  const referralEligibleChildren = useMemo(() => (
    (account?.members ?? []).flatMap((member) => (
      member.role === "child" && member.user_id
        ? [{ userId: member.user_id, name: member.name?.trim() || "아이" }]
        : []
    ))
  ), [account?.members]);

  const displayName = account?.myName || "보호자";
  const roleLabel = account?.isCoParent ? "공동 보호자" : "보호자";
  // 프로필 아바타 — 업로드 사진 > 성별 매칭 3D 캐릭터(아빠 계정에 엄마 캐릭터가 뜨지 않게).
  // 멤버 행 gender 가 비어 있으면 가입 메타(user_metadata.gender)를 본다.
  const genderHint = String(me?.gender ?? user?.user_metadata?.gender ?? "");
  const isDad = /dad|father|male|남/i.test(genderHint);
  const profileAvatar = me?.photo_url || asset(isDad ? "family/dad.webp" : "family/mom.webp");

  const logoutBusyRef = useRef(false);
  const handleLogout = async () => {
    if (logoutBusyRef.current) return; // 이중 탭 가드
    logoutBusyRef.current = true;
    try {
      await logout();
      show("로그아웃되었어요", "👋");
      navigate("/onboarding");
    } catch (error) {
      console.error("로그아웃 실패:", error);
      show("로그아웃에 실패했어요. 다시 시도해 주세요", "⚠️");
    } finally {
      logoutBusyRef.current = false;
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

  if (settingsQueryState === "loading") {
    return (
      <ScreenQueryState
        screenTitle="설정"
        state="loading"
        heading="설정을 불러오고 있어요"
        description="계정과 구독 상태를 안전하게 확인하는 중이에요."
        onBack={() => navigate(-1)}
      />
    );
  }

  if (settingsQueryState === "error") {
    return (
      <ScreenQueryState
        screenTitle="설정"
        state="error"
        heading="설정을 불러오지 못했어요"
        description="계정이나 구독 상태를 확인하지 못해 설정 변경을 잠시 닫았어요."
        onBack={() => navigate(-1)}
        onRetry={() => void retryParentSettings()}
        retrying={settingsRefetching}
      />
    );
  }

  if (settingsDataEmpty) {
    return (
      <ScreenQueryState
        screenTitle="설정"
        state="empty"
        heading="확인할 설정 정보가 없어요"
        description="계정 연결 상태를 다시 확인해 주세요."
        onBack={() => navigate(-1)}
        onRetry={() => void retryParentSettings()}
        retrying={settingsRefetching}
        retryLabel="다시 확인하기"
      />
    );
  }

  return (
    <div className="hy-rise-in">
      <header className="ps-head">
        <button
          type="button"
          className="ps-back hy-press"
          aria-label="뒤로"
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} strokeWidth={2.2} />
        </button>
        <span className="ps-head-title">설정</span>
      </header>

      <div className="ps-content">
        {/* 프로필 (실 로그인 사용자) */}
        <div className="ps-profile">
          <div className="ps-profile__avatar">
            <img className="hy-network-avatar" src={profileAvatar} alt="" loading="eager" decoding="async" />
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
                <SettingsIcon Icon={r.Icon} tone={r.tone} />
                <span className="ps-nav__label">{r.label}</span>
                {r.badge && ready && (
                  <span className="ps-account__badge" data-premium={tier === TIERS.PREMIUM}>
                    {getTierLabel(tier)}
                  </span>
                )}
                {chevronIcon}
              </button>
            ))}
            {account?.isPrimaryParent && (
              <button
                type="button"
                className="ps-nav hy-press"
                onClick={() => setReferralOpen(true)}
              >
                <SettingsIcon Icon={Gift} tone="gold" />
                <span className="ps-nav__label">친구 초대 · 서로 AI 대화 10회</span>
                {chevronIcon}
              </button>
            )}
            {reviewRewardNotice && (
              <div className="ps-nav" role="status">
                <SettingsIcon Icon={Star} tone="gold" />
                <span className="ps-nav__label">{reviewRewardNotice}</span>
              </div>
            )}
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
                <span className="ps-feature__icon" data-tone={f.tone}>
                  <img src={asset(f.icon)} alt="" />
                </span>
                <span className="ps-feature__label">{f.label}</span>
                {featureChevronIcon}
              </button>
            ))}
          </div>
        </div>

        {/* 약관 · 계정 */}
        <div className="ps-group">
          <div className="ps-group__label">약관 · 계정</div>
          <div className="ps-list">
            {([
              { id: "privacy", Icon: ShieldCheck, tone: "neutral", label: "개인정보 처리방침", onClick: openPrivacy, chevron: true },
              { id: "feedback", Icon: MessageCircleQuestion, tone: "blue", label: "문제 신고 · 문의", onClick: () => navigate("/feedback"), chevron: true },
              { id: "logout", Icon: LogOut, tone: "danger", label: "로그아웃", onClick: () => void handleLogout() },
              { id: "delete", Icon: AlertTriangle, tone: "danger", label: "회원 탈퇴", onClick: () => setConfirmDelete(true), danger: true },
            ] satisfies AccountRow[]).map((r) => (
              <button key={r.id} type="button" className="ps-account hy-press" onClick={r.onClick}>
                <AccountIcon Icon={r.Icon} tone={r.tone} />
                <span className="ps-account__label" data-danger={r.danger ? "true" : undefined}>
                  {r.label}
                </span>
                {r.chevron && chevronIcon}
              </button>
            ))}
          </div>
        </div>

        <div className="ps-version">혜니캘린더 v{APP_VERSION}</div>
      </div>

      <ReferralRewardPanel
        open={referralOpen && account?.isPrimaryParent === true}
        onClose={() => setReferralOpen(false)}
        eligibleChildren={referralEligibleChildren}
      />

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
            aria-label="닫기"
            onClick={() => !deleteAccount.isPending && setConfirmDelete(false)}
          />
          <div className="ps-modal__card">
            <div className="ps-modal__emoji" aria-hidden="true">
              <Trash2 size={24} strokeWidth={2.2} />
            </div>
            <div id={deleteTitleId} className="ps-modal__title">정말 탈퇴하시겠어요?</div>
            <p id={deleteDescriptionId} className="ps-modal__body">
              {account?.isPrimaryParent
                ? "가족의 일정·위치 이력·대화·아이 계정이 모두 영구 삭제되며 복구할 수 없어요."
                : "내 계정과 이 가족에서의 정보가 삭제돼요."}
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
                취소
              </button>
              <button
                type="button"
                className="ps-modal__btn ps-modal__btn--danger hy-press"
                onClick={handleDelete}
                disabled={deleteAccount.isPending} aria-busy={deleteAccount.isPending}
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

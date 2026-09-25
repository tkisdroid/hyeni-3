import { TimeZoneSelect, suggestedTimeZone } from "@/region/TimeZoneSelect";
import { useIntl } from "react-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { asset } from "@/lib/assets";
import { parentAvatarPath } from "@/lib/avatar";
import { useToast } from "@/app/toast";
import { LoaderMark } from "@/components/ui/LoaderMark";
import { ScreenQueryState } from "@/components/ui/ScreenQueryState";
import { ReferralRewardPanel } from "@/components/ReferralRewardPanel";
import { LanguageSelector, languageNativeName } from "@/components/LanguageSelector";
import { useLocale } from "@/i18n/useLocale";
import { APP_VERSION } from "@/config/version";
import { useAuth } from "@/auth/AuthContext";
import { useEntitlement } from "@/queries/useEntitlement";
import { useAccount } from "@/queries/useAccount";
import { openExternal } from "@/lib/native/browser";
import { isNativePlatform } from "@/lib/native/plugins";
import { PRIVACY_POLICY_URL } from "@/lib/api/endpoints/account";
import { getTierLabel, TIERS } from "@/transform/tierPolicy";
import { REFERRAL_REWARD_CREDITS_DISPLAY } from "@/transform/referralReward";
import { resolveQueryTruthState } from "@/transform/queryTruthState";
import { useMyFamily, useUpdateFamilyRegion } from "@/queries/useFamily";
import { formatFamilyCountryName } from "@/transform/familyCountryDisplay";
import { localizeApiError } from "@/i18n/apiError";
import "./ParentSettings.css";

/* ── 행 정의 (결합 회피: 화면 자체 정의) ─────────────────────────────── */

type Tone = "lav" | "rose" | "blue" | "mint" | "gold" | "neutral" | "danger";
// 설정 행 아이콘도 기능 행과 같은 소프트 3D webp 를 쓴다(2026-08-18 TK 지시).
// 로그아웃·탈퇴 같은 계정 유틸리티 행만 lucide 로 남긴다(대응하는 3D 자산이 없다).
type NavRow = { id: string; icon: string; tone: Tone; labelId: string; route: string; badge?: boolean };

const settingsRows: NavRow[] = [
  { id: "account", icon: "ui/clay/account.webp", tone: "lav", labelId: "parent.settings.account", route: "/account" },
  { id: "notif", icon: "ui/clay/notification.webp", tone: "rose", labelId: "parent.settings.notifications", route: "/notification-settings" },
  { id: "location", icon: "ui/clay/location.webp", tone: "blue", labelId: "parent.settings.location", route: "/location-settings" },
  { id: "data", icon: "ui/clay/data-sync.webp", tone: "mint", labelId: "parent.settings.dataSync", route: "/data-sync" },
  { id: "subscription", icon: "ui/clay/subscription.webp", tone: "gold", labelId: "parent.settings.subscription", route: "/subscription", badge: true },
];

type FeatureRow = { id: string; icon: string; tone: Tone; labelId: string; route: string };

const featureRows: FeatureRow[] = [
  { id: "child", icon: "ui/clay/children.webp", tone: "blue", labelId: "parent.settings.children", route: "/parent/family" },
  { id: "place", icon: "ui/clay/places.webp", tone: "mint", labelId: "parent.settings.places", route: "/place-manager" },
  { id: "friend", icon: "ui/clay/playdate.webp", tone: "gold", labelId: "parent.settings.playdates", route: "/friend-play" },
  { id: "audio", icon: "ui/clay/remote-audio.webp", tone: "rose", labelId: "parent.location.action.remoteAudio", route: "/remote-audio" },
  { id: "audio-audit", icon: "ui/clay/remote-audio-history.webp", tone: "neutral", labelId: "parent.settings.remoteAudioAudit", route: "/remote-audio-audit" },
  { id: "reward", icon: "ui/clay/sticker.webp", tone: "gold", labelId: "parent.settings.stickers", route: "/sticker-send" },
  { id: "ai", icon: "ui/clay/ai-credit.webp", tone: "lav", labelId: "parent.settings.aiCredits", route: "/ai-credit" },
];

type AccountRow = {
  id: string;
  icon: string;
  tone: Tone;
  label: string;
  onClick: () => void;
  chevron?: boolean;
};

function SettingsIcon({ icon, tone }: { icon: string; tone: Tone }) {
  return (
    <span className="ps-nav__chip" data-tone={tone}>
      <img src={asset(icon)} alt="" aria-hidden="true" />
    </span>
  );
}

function AccountIcon({ icon, tone }: { icon: string; tone: Tone }) {
  return (
    <span className="ps-account__chip" data-tone={tone}>
      <img src={asset(icon)} alt="" aria-hidden="true" />
    </span>
  );
}

const chevronIcon = <ChevronRight className="ps-nav__chev" size={18} strokeWidth={2.4} />;
const featureChevronIcon = <ChevronRight className="ps-feature__chev" size={18} strokeWidth={2.4} />;

export function ParentSettings() {
  const intl = useIntl();
  const navigate = useNavigate();
  const { show } = useToast();
  const { logout, user } = useAuth();
  const accountQuery = useAccount();
  const { account, me, providerLabel } = accountQuery;
  const [referralOpen, setReferralOpen] = useState(false);
  // 언어는 계정 프로필 바로 아래 한 줄이고, 그 줄을 펼쳐서 고른다(2026-08-17 TK 지시).
  const [languageOpen, setLanguageOpen] = useState(false);
  const [countryOpen, setCountryOpen] = useState(false);
  const { locale } = useLocale();
  const familyQuery = useMyFamily();
  const updateFamilyRegion = useUpdateFamilyRegion();
  const [countryDraft, setCountryDraft] = useState("");
  const [timeZoneDraft, setTimeZoneDraft] = useState(suggestedTimeZone);
  // 티어 배지는 ready 일 때만 노출(미확정/조회실패 시 미표시 — R9: free 강등 금지).
  const entitlementQuery = useEntitlement();
  const { ready, tier } = entitlementQuery;
  const settingsQueryState = resolveQueryTruthState([
    { isLoading: accountQuery.isLoading, isError: accountQuery.isError && !account },
  ]);
  const settingsDataEmpty = settingsQueryState === "ready" && !account;
  const settingsRefetching = accountQuery.isFetching || entitlementQuery.isFetching;
  const retryParentSettings = async (): Promise<void> => {
    await Promise.all([accountQuery.refetch(), entitlementQuery.refetch()]);
  };
  const reviewRewardNotice = !ready
    ? null
    : tier === TIERS.REVIEWED
      ? intl.formatMessage({ id: "parent.parentSettings.copy001" })
      : tier === TIERS.FREE
        ? intl.formatMessage({ id: "parent.parentSettings.copy002" })
        : null;
  const referralEligibleChildren = useMemo(() => (
    (account?.members ?? []).flatMap((member) => (
      member.role === "child" && member.user_id
        ? [{ userId: member.user_id, name: member.name?.trim() || intl.formatMessage({ id: "parent.parentHome.copy004" }) }]
        : []
    ))
  ), [account?.members, intl]);

  const displayName = account?.myName || intl.formatMessage({ id: "parent.parentSettings.copy003" });
  const roleLabel = account?.isCoParent ? intl.formatMessage({ id: "parent.parentSettings.copy004" }) : intl.formatMessage({ id: "parent.parentSettings.copy003" });
  // 프로필 아바타 — 업로드 사진 > 성별 매칭 3D 캐릭터(아빠 계정에 엄마 캐릭터가 뜨지 않게).
  // 멤버 행 gender 가 비어 있으면 가입 메타(user_metadata.gender)를 본다.
  const genderHint = String(me?.gender ?? user?.user_metadata?.gender ?? "");
  const isDad = /dad|father|male|남/i.test(genderHint);
  const profileAvatarPath = parentAvatarPath(me?.photo_url, isDad ? "dad" : "mom");
  const hasProfilePhoto = profileAvatarPath.startsWith("http") || profileAvatarPath.startsWith("blob:");
  const profileAvatar = hasProfilePhoto ? profileAvatarPath : asset(profileAvatarPath);
  const familyCountryCode = familyQuery.data?.countryCode ?? "ZZ";
  const familyCountryName = formatFamilyCountryName(familyCountryCode, locale);

  const saveFamilyCountry = async () => {
    try {
      await updateFamilyRegion.mutateAsync({ countryCode: countryDraft, timeZone: timeZoneDraft });
      setCountryOpen(false);
      show(intl.formatMessage({ id: "study.country.confirmed" }), "🌍");
    } catch (error) {
      show(localizeApiError(error, intl, "formal"), "⚠️");
    }
  };

  const logoutBusyRef = useRef(false);
  // 로그아웃은 설정 맨 아래라 스크롤 중 잘못 눌리기 쉽다. 첫 탭은 확인 상태로만 바꾸고 두 번째 탭에 로그아웃한다.
  const [logoutArmed, setLogoutArmed] = useState(false);
  useEffect(() => {
    if (!logoutArmed) return;
    const timer = window.setTimeout(() => setLogoutArmed(false), 5_000);
    return () => window.clearTimeout(timer);
  }, [logoutArmed]);
  const handleLogout = async () => {
    if (!logoutArmed) {
      setLogoutArmed(true);
      return;
    }
    if (logoutBusyRef.current) return; // 이중 탭 가드
    logoutBusyRef.current = true;
    try {
      await logout();
      show(intl.formatMessage({ id: "parent.parentSettings.copy005" }), "👋");
      navigate("/onboarding");
    } catch (error) {
      console.error("로그아웃 실패:", error);
      show(intl.formatMessage({ id: "parent.parentSettings.copy006" }), "⚠️");
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
        show(intl.formatMessage({ id: "parent.parentSettings.copy007" }), "⚠️");
      });
      return;
    }
    window.open(PRIVACY_POLICY_URL, "_blank", "noopener");
  };

  return (
    <div className="hy-rise-in">
      <header className="ps-head">
        <button
          type="button"
          className="ps-back hy-press"
          aria-label={intl.formatMessage({ id: "parent.parentSettings.copy017" })}
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} strokeWidth={2.2} />
        </button>
        <span className="ps-head-title">{intl.formatMessage({ id: "parent.parentHome.copy009" })}</span>
      </header>

      <div className="ps-content">
        {/* 설정 메뉴는 즉시 열고, 프로필 조회 상태만 이 자리에 표시한다. */}
        {settingsQueryState === "loading" ? (
          <section className="ps-profile-pending" role="status" aria-live="polite" aria-busy="true">
            <div className="ps-profile-pending__preview" aria-hidden="true">
              <span className="ps-profile-pending__avatar" />
              <span className="ps-profile-pending__lines"><span /><span /></span>
            </div>
            <div className="ps-profile-pending__status">
              <LoaderMark />
              <span>{intl.formatMessage({ id: "parent.parentSettings.copy010" })}</span>
            </div>
          </section>
        ) : settingsQueryState === "error" || settingsDataEmpty ? (
          <ScreenQueryState
            embedded
            screenTitle={intl.formatMessage({ id: "parent.parentHome.copy009" })}
            state={settingsQueryState === "error" ? "error" : "empty"}
            heading={intl.formatMessage({ id: settingsQueryState === "error" ? "parent.parentSettings.copy012" : "parent.parentSettings.copy014" })}
            description={intl.formatMessage({ id: "parent.parentSettings.copy015" })}
            onRetry={() => void retryParentSettings()}
            retrying={settingsRefetching}
          />
        ) : (
          <div className="ps-profile">
            <div className="ps-profile__avatar" data-photo={hasProfilePhoto ? "true" : "false"}>
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
              {intl.formatMessage({ id: "parent.parentHome.copy051" })}
            </button>
          </div>
        )}

        {/* 언어 — 계정 프로필 바로 아래 한 줄. 지금 언어를 보여주고 눌러서 펼친다. */}
        <div className="ps-list ps-language">
          <button
            type="button"
            className="ps-nav hy-press"
            aria-expanded={languageOpen}
            onClick={() => setLanguageOpen((open) => !open)}
          >
            <SettingsIcon icon="ui/clay/language.webp" tone="blue" />
            <span className="ps-nav__label">{intl.formatMessage({ id: "core.language.rowLabel" })}</span>
            <span className="ps-nav__value" lang={locale}>{languageNativeName(locale)}</span>
            <ChevronRight
              className="ps-language__chevron"
              size={18}
              strokeWidth={2.2}
              color="var(--fg-placeholder)"
              aria-hidden="true"
            />
          </button>
          {languageOpen && (
            <div className="ps-language__panel">
              <LanguageSelector tone="formal" compact />
            </div>
          )}
        </div>

        {/* 지도·위치 공급자 선택에 쓰는 가족 국가. locale과 별개이며 주 보호자만 바꾼다. */}
        <div className="ps-list ps-language">
          <button
            type="button"
            className="ps-nav hy-press"
            aria-expanded={countryOpen}
            onClick={() => {
              if (!familyQuery.data?.isPrimaryParent) return;
              setTimeZoneDraft(familyQuery.data.timeZone);
              setCountryDraft(familyCountryCode === "ZZ" ? "" : familyCountryCode);
              setCountryOpen((open) => !open);
            }}
          >
            <SettingsIcon icon="ui/clay/location.webp" tone="mint" />
            <span className="ps-nav__label">{intl.formatMessage({ id: "core.familyRegion.label" })}</span>
            <span className="ps-nav__value ps-region-value"><span>{familyCountryName}</span><small>{familyQuery.data?.timeZone}</small></span>
            {familyQuery.data?.isPrimaryParent ? chevronIcon : null}
          </button>
          {countryOpen && familyQuery.data?.isPrimaryParent && (
            <div className="ps-language__panel">
              <label htmlFor="family-map-country">{intl.formatMessage({ id: "study.country.inputLabel" })}</label>
              <input
                id="family-map-country"
                value={countryDraft}
                inputMode="text"
                autoCapitalize="characters"
                maxLength={2}
                pattern="[A-Za-z]{2}"
                disabled={updateFamilyRegion.isPending}
                onChange={(event) => setCountryDraft(
                  event.target.value.replace(/[^A-Za-z]/gu, "").slice(0, 2).toUpperCase(),
                )}
              />
              <small>{intl.formatMessage({ id: "study.country.inputHelp" })}</small>
              <TimeZoneSelect value={timeZoneDraft} onChange={setTimeZoneDraft} disabled={updateFamilyRegion.isPending} />
              <button
                type="button"
                className="hy-btn hy-btn--primary"
                aria-busy={updateFamilyRegion.isPending}
                disabled={updateFamilyRegion.isPending || !/^[A-Z]{2}$/u.test(countryDraft)}
                onClick={() => void saveFamilyCountry()}
              >
                {intl.formatMessage({
                  id: updateFamilyRegion.isPending ? "study.country.confirming" : "study.country.confirm",
                })}
              </button>
            </div>
          )}
        </div>

        {/* 설정 (신규 화면 배선) */}
        <div className="ps-group">
          <div className="ps-group__label">{intl.formatMessage({ id: "parent.parentHome.copy009" })}</div>
          <div className="ps-list">
            {settingsRows.map((r) => (
              <button
                key={r.id}
                type="button"
                className="ps-nav hy-press"
                onClick={() => navigate(r.route)}
              >
                <SettingsIcon icon={r.icon} tone={r.tone} />
                <span className="ps-nav__label">{intl.formatMessage({ id: r.labelId })}</span>
                {r.badge && ready && (
                  <span className="ps-account__badge" data-premium={tier === TIERS.PREMIUM}>
                    {getTierLabel(tier, intl)}
                  </span>
                )}
                {chevronIcon}
              </button>
            ))}
            {/* 공동 보호자도 가족의 초대 코드를 보고 공유할 수 있다(만들기는 주 보호자 전용). */}
            {account?.myRole === "parent" && (
              <button
                type="button"
                className="ps-nav hy-press"
                onClick={() => setReferralOpen(true)}
              >
                <SettingsIcon icon="ui/clay/referral.webp" tone="gold" />
                <span className="ps-nav__label">
                  {intl.formatMessage(
                    { id: "parent.parentSettings.copy018" },
                    { count: REFERRAL_REWARD_CREDITS_DISPLAY },
                  )}
                </span>
                {chevronIcon}
              </button>
            )}
            {entitlementQuery.isError && !ready && (
              <div className="ps-entitlement-retry" role="status">
                <span>{intl.formatMessage({ id: "parent.daySummary.entitlementErrorTitle" })}</span>
                <button type="button" className="hy-press" onClick={() => void entitlementQuery.refetch()} disabled={entitlementQuery.isFetching} aria-busy={entitlementQuery.isFetching}>
                  {intl.formatMessage({ id: "core.action.reload" })}
                </button>
              </div>
            )}
            {reviewRewardNotice && (
              <div className="ps-nav" role="status">
                <SettingsIcon icon="ui/clay/sticker.webp" tone="gold" />
                <span className="ps-nav__label">{reviewRewardNotice}</span>
              </div>
            )}
          </div>
        </div>

        {/* 가족 · 안전 */}
        <div className="ps-group">
          <div className="ps-group__label">{intl.formatMessage({ id: "parent.parentSettings.copy019" })}</div>
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
                <span className="ps-feature__label">{intl.formatMessage({ id: f.labelId })}</span>
                {featureChevronIcon}
              </button>
            ))}
          </div>
        </div>

        {/* 약관 · 계정 */}
        <div className="ps-group">
          <div className="ps-group__label">{intl.formatMessage({ id: "parent.parentSettings.copy020" })}</div>
          <div className="ps-list">
            {([
              { id: "privacy", icon: "ui/clay/privacy.webp", tone: "neutral", label: intl.formatMessage({ id: "parent.parentSettings.copy021" }), onClick: openPrivacy, chevron: true },
              { id: "feedback", icon: "ui/clay/feedback.webp", tone: "blue", label: intl.formatMessage({ id: "parent.parentSettings.copy022" }), onClick: () => navigate("/feedback"), chevron: true },
              { id: "logout", icon: "ui/clay/logout.webp", tone: "danger", label: intl.formatMessage({ id: logoutArmed ? "parent.parentSettings.logoutConfirm" : "parent.parentSettings.copy023" }), onClick: () => void handleLogout() },
            ] satisfies AccountRow[]).map((r) => (
              <button key={r.id} type="button" className="ps-account hy-press" onClick={r.onClick}>
                <AccountIcon icon={r.icon} tone={r.tone} />
                <span className="ps-account__label">
                  {r.label}
                </span>
                {r.chevron && chevronIcon}
              </button>
            ))}
          </div>
        </div>

        <div className="ps-version">
          {intl.formatMessage({ id: "parent.settings.version" }, { version: APP_VERSION })}
        </div>
      </div>

      <ReferralRewardPanel
        open={referralOpen && account?.myRole === "parent"}
        onClose={() => setReferralOpen(false)}
        eligibleChildren={referralEligibleChildren}
      />
    </div>
  );
}

import { useFamilyTimeZone } from "@/region/FamilyTimeZone";
import { useNavigate } from "react-router";
import { useIntl, type IntlShape } from "react-intl";
import { ChevronLeft, Crown, Gift } from "lucide-react";
import { asset } from "@/lib/assets";
import { useEntitlement } from "@/queries/useEntitlement";
import { Loading } from "@/components/ui/Loading";
import type { SupportedLocale } from "@/i18n/locale";
import { useLocale } from "@/i18n/useLocale";
import { formatDateTime, formatRelativeTime } from "@/i18n/format";
import "./TrialLock.css";

const PREMIUM_PERKS = [
  { icon: "ui/pin-heart.webp", id: "location" },
  { icon: "ui/ai-robot.webp", id: "ai" },
  { icon: "ui/menu-child-tracker.webp", id: "children" },
] as const;
const TRIAL_LOCK_DATE_STYLE = "medium" as const;

function formatDate(d: Date | null, locale: SupportedLocale, familyTimeZone: string): string {
  if (!d) return "";
  return formatDateTime(d, {
    locale,
    timeZone: familyTimeZone,
    dateStyle: TRIAL_LOCK_DATE_STYLE,
  });
}

/** S-03 체험 종료 · 잠금 — useEntitlement 기준 잠금/체험 상태 안내 + 구독 유도. */
export function TrialLock() {
  const familyTimeZone = useFamilyTimeZone();
  const intl = useIntl();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const { ready, isPremium, reviewed, view, isLoading } = useEntitlement();

  const goSubscribe = () => navigate("/subscription");

  return (
    <div className="tl-root">
      <header className="tl-head">
        <button
          type="button"
          className="tl-back hy-press"
          aria-label={intl.formatMessage({ id: "billing.common.back" })}
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} strokeWidth={2.2} color="var(--fg-secondary)" />
        </button>
        <span className="tl-head-title">{intl.formatMessage({ id: "billing.trialLock.title" })}</span>
      </header>

      {/* 티어 미확정: 잠금/무료 단정 금지(R9) — 중립 로딩만. */}
      {!ready && (
        <div className="tl-content">
          <div className="tl-loading">
            {isLoading
              ? <Loading label={intl.formatMessage({ id: "billing.trialLock.loading" })} />
              : intl.formatMessage({ id: "billing.trialLock.loadFailed" })}
          </div>
        </div>
      )}

      {/* 무료 체험 중: 부드러운 안내(잠금 아님) + 유지 유도. */}
      {ready && view?.isTrial && (
        <div className="tl-content">
          <div className="tl-hero tl-hero--trial">
            <div className="tl-hero__badge">
              <Crown size={30} strokeWidth={2} color="#fff" />
            </div>
            <div className="tl-hero__dday">
              {view.trialDaysLeft != null
                ? intl.formatMessage(
                    { id: "billing.trialLock.trialRemaining" },
                    { remaining: formatRelativeTime(view.trialDaysLeft, "day", locale) },
                  )
                : intl.formatMessage({ id: "billing.trialLock.trialActive" })}
            </div>
            <div className="tl-hero__title">
              {intl.formatMessage({ id: "billing.trialLock.premiumActive" })}
            </div>
            {view.trialEndsAt && (
              <div className="tl-hero__sub">
                {intl.formatMessage(
                  { id: "billing.trialLock.trialEnds" },
                  { date: formatDate(view.trialEndsAt, locale, familyTimeZone) },
                )}
              </div>
            )}
          </div>
          <PerkList intl={intl} />
          <button type="button" className="tl-cta hy-press" onClick={goSubscribe}>
            {intl.formatMessage({ id: "billing.trialLock.continueTrial" })}
          </button>
          <button type="button" className="tl-ghost hy-press" onClick={() => navigate(-1)}>
            {intl.formatMessage({ id: "billing.trialLock.later" })}
          </button>
        </div>
      )}

      {/* 이미 프리미엄(체험 아님): 상태만 안내. */}
      {ready && isPremium && !view?.isTrial && (
        <div className="tl-content">
          <div className="tl-hero tl-hero--active">
            <div className="tl-hero__badge">
              <Crown size={30} strokeWidth={2} color="#fff" />
            </div>
            <div className="tl-hero__title">
              {intl.formatMessage({ id: "billing.trialLock.active" })}
            </div>
            {view?.periodEnd && (
              <div className="tl-hero__sub">
                {intl.formatMessage(
                  { id: "billing.trialLock.activeUntil" },
                  { date: formatDate(view.periodEnd, locale, familyTimeZone) },
                )}
              </div>
            )}
          </div>
          <PerkList intl={intl} />
          <button type="button" className="tl-ghost hy-press" onClick={() => navigate(-1)}>
            {intl.formatMessage({ id: "billing.trialLock.back" })}
          </button>
        </div>
      )}

      {/* 무료/만료: 잠금 화면 + 구독 유도. */}
      {ready && !isPremium && (
        <div className="tl-content">
          <div className="tl-lock">
            <div className="tl-lock__ring">
              <img src={asset("ui/crown.webp")} alt="" style={{ width: 44, height: 44, objectFit: "contain" }} />
            </div>
            <div className="tl-lock__title">
              {view?.status === "expired"
                ? intl.formatMessage({ id: "billing.trialLock.expired" })
                : intl.formatMessage({ id: "billing.trialLock.feature" })}
            </div>
            <div className="tl-lock__sub">
              {intl.formatMessage({ id: "billing.trialLock.unlockDescription" })}
              <br />
              {intl.formatMessage({ id: "billing.trialLock.safetyFree" })}
            </div>
            {reviewed && (
              <div className="tl-lock__reviewed">
                <Gift size={14} strokeWidth={2.2} aria-hidden="true" />
                {intl.formatMessage({ id: "billing.trialLock.reviewed" })}
              </div>
            )}
          </div>
          <PerkList intl={intl} />
          <button type="button" className="tl-cta hy-press" onClick={goSubscribe}>
            {intl.formatMessage({ id: "billing.trialLock.start" })}
          </button>
          <button type="button" className="tl-ghost hy-press" onClick={() => navigate(-1)}>
            {intl.formatMessage({ id: "billing.trialLock.freeContinue" })}
          </button>
        </div>
      )}
    </div>
  );
}

function PerkList({ intl }: { intl: IntlShape }) {
  return (
    <div className="tl-perks">
      {PREMIUM_PERKS.map((p) => (
        <div key={p.id} className="tl-perk">
          <span className="tl-perk__ic">
            <img src={asset(p.icon)} alt="" style={{ width: 22, height: 22, objectFit: "contain" }} />
          </span>
          <span className="tl-perk__label">
            {intl.formatMessage({ id: `billing.trialLock.perk.${p.id}` })}
          </span>
        </div>
      ))}
    </div>
  );
}

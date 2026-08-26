import { useEffect, useState } from "react";
import { ChevronLeft, ShieldAlert } from "lucide-react";
import { useIntl } from "react-intl";
import { useToast } from "@/app/toast";
import { useSafeBack } from "@/app/useSafeBack";
import type { MessageId } from "@/i18n/generated/messageIds";
import { isApiError } from "@/lib/api/errors";
import {
  useAdminAiPrompt,
  useAdminCommerceControls,
  useAdminStatus,
  useSaveAdminAiPrompt,
  useAdminHeroCarousel,
  useSaveAdminCommerceControls,
  useSaveAdminHeroCarousel,
} from "@/queries/useAdmin";
import { usePwaUpdateCriticalSection } from "@/lib/usePwaUpdateCriticalSection";
import {
  MAX_HERO_AUTOPLAY_MS,
  MAX_PARENT_HOME_HERO_SLIDES,
  MIN_HERO_AUTOPLAY_MS,
} from "@/transform/parentHomeHeroCarousel";
import "./AdminAiPrompt.css";

/** 숫자 입력은 빈 문자열·문자를 0 으로 읽어 NaN 을 화면에 흘리지 않는다. */
function readHeroNumber(raw: string): number {
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

/**
 * 운영자 전용 — 아이 AI 친구 전역 지침.
 *
 * 여기서 저장한 문장은 **모든 가족의 아이 대화**에 함께 들어간다. 서버는 이 지침을
 * 안전 규칙보다 앞에 배치하고 정책 우선순위에서 안전·부모 설정 아래에 두므로,
 * 안전 규칙이나 부모 설정을 무시하게 만들 수는 없다.
 *
 * 메뉴에는 노출하지 않는 숨은 라우트(#/admin/ai-prompt)이며, 운영자 계정이 아니면
 * 안내만 보여준다(서버도 404로 닫는다).
 */
export function AdminAiPrompt() {
  const intl = useIntl();
  const goBack = useSafeBack();
  const { show } = useToast();
  const adminStatus = useAdminStatus();
  const isAdmin = adminStatus.data?.isAdmin === true;
  const promptQuery = useAdminAiPrompt(isAdmin);
  const commerceQuery = useAdminCommerceControls(isAdmin);
  const savePrompt = useSaveAdminAiPrompt();
  const saveCommerceControls = useSaveAdminCommerceControls();
  const heroQuery = useAdminHeroCarousel(isAdmin);
  const saveHero = useSaveAdminHeroCarousel();

  const [draft, setDraft] = useState("");
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [subscriptionEnabled, setSubscriptionEnabled] = useState(false);
  const [aiCreditEnabled, setAiCreditEnabled] = useState(false);
  const [commerceLoadedKey, setCommerceLoadedKey] = useState<string | null>(null);
  // 히어로 캐러셀: 구독/비구독에 각각 몇 장을 보여줄지와 자동 전환 간격(초).
  const [heroFree, setHeroFree] = useState(3);
  const [heroPremium, setHeroPremium] = useState(2);
  const [heroAutoPlaySec, setHeroAutoPlaySec] = useState(6);
  const [heroLoadedKey, setHeroLoadedKey] = useState<string | null>(null);

  const [commerceFeedback, setCommerceFeedback] = useState<
    { tone: "success" | "error"; messageId: MessageId } | null
  >(null);

  // 서버 값이 도착하면 1회만 편집창에 넣는다(입력 중 덮어쓰지 않도록).
  const serverPrompt = promptQuery.data?.prompt ?? null;
  const serverUpdatedAt = promptQuery.data?.updatedAt ?? null;
  useEffect(() => {
    if (serverPrompt === null) return;
    const key = `${serverUpdatedAt ?? ""}:${serverPrompt.length}`;
    if (loadedKey === key) return;
    setDraft(serverPrompt);
    setLoadedKey(key);
  }, [serverPrompt, serverUpdatedAt, loadedKey]);

  const serverCommerceControls = commerceQuery.data ?? null;
  useEffect(() => {
    if (serverCommerceControls === null) return;
    const key = [
      serverCommerceControls.configured,
      serverCommerceControls.webSubscriptionNewCheckoutsEnabled,
      serverCommerceControls.webAiCreditNewCheckoutsEnabled,
    ].join(":");
    if (commerceLoadedKey === key) return;
    setSubscriptionEnabled(serverCommerceControls.webSubscriptionNewCheckoutsEnabled);
    setAiCreditEnabled(serverCommerceControls.webAiCreditNewCheckoutsEnabled);
    setCommerceLoadedKey(key);
    setCommerceFeedback(null);
  }, [serverCommerceControls, commerceLoadedKey]);

  const serverHero = heroQuery.data ?? null;
  useEffect(() => {
    if (serverHero === null) return;
    const key = [serverHero.configured, serverHero.freeVisibleCount, serverHero.premiumVisibleCount, serverHero.autoPlayMs].join(":");
    if (heroLoadedKey === key) return;
    setHeroFree(serverHero.freeVisibleCount);
    setHeroPremium(serverHero.premiumVisibleCount);
    setHeroAutoPlaySec(Math.round(serverHero.autoPlayMs / 1000));
    setHeroLoadedKey(key);
  }, [serverHero, heroLoadedKey]);

  const maxLength = promptQuery.data?.maxLength ?? 4000;
  const dirty = serverPrompt !== null && draft !== serverPrompt;
  const commerceDirty = serverCommerceControls !== null && (
    !serverCommerceControls.configured ||
    subscriptionEnabled !== serverCommerceControls.webSubscriptionNewCheckoutsEnabled ||
    aiCreditEnabled !== serverCommerceControls.webAiCreditNewCheckoutsEnabled
  );
  const heroDirty = serverHero !== null && (
    !serverHero.configured
    || heroFree !== serverHero.freeVisibleCount
    || heroPremium !== serverHero.premiumVisibleCount
    || heroAutoPlaySec * 1000 !== serverHero.autoPlayMs
  );
  const commerceStorageUnavailable =
    isApiError(commerceQuery.error) && commerceQuery.error.status === 503;
  const heroStorageUnavailable =
    isApiError(heroQuery.error) && heroQuery.error.status === 503;
  // 서버가 알려준 상한을 쓰고, 아직 못 읽었으면 클라이언트 정본 상한으로 화면을 막지 않는다.
  const heroMaxSlides = serverHero?.maxSlides ?? MAX_PARENT_HOME_HERO_SLIDES;
  // 서버가 400 으로 거절할 값을 저장 버튼으로 보내지 않는다(같은 범위를 화면에서도 검사).
  const heroValuesValid =
    Number.isSafeInteger(heroFree) && heroFree >= 0 && heroFree <= heroMaxSlides
    && Number.isSafeInteger(heroPremium) && heroPremium >= 0 && heroPremium <= heroMaxSlides
    && Number.isSafeInteger(heroAutoPlaySec)
    && (heroAutoPlaySec === 0
      || (heroAutoPlaySec * 1000 >= MIN_HERO_AUTOPLAY_MS
        && heroAutoPlaySec * 1000 <= MAX_HERO_AUTOPLAY_MS));
  usePwaUpdateCriticalSection(
    dirty || commerceDirty || heroDirty || savePrompt.isPending || saveCommerceControls.isPending || saveHero.isPending,
  );

  const handleSave = async () => {
    if (savePrompt.isPending) return;
    try {
      const saved = await savePrompt.mutateAsync(draft);
      setDraft(saved.prompt);
      setLoadedKey(`${saved.updatedAt ?? ""}:${saved.prompt.length}`);
      show(intl.formatMessage({
        id: saved.prompt
          ? "shared.adminAiPrompt.toast.promptSaved"
          : "shared.adminAiPrompt.toast.promptCleared",
      }));
    } catch {
      show(intl.formatMessage({ id: "shared.adminAiPrompt.toast.promptSaveFailed" }));
    }
  };

  const handleCommerceSave = async () => {
    if (saveCommerceControls.isPending || !commerceDirty) return;
    setCommerceFeedback(null);
    try {
      const saved = await saveCommerceControls.mutateAsync({
        webSubscriptionNewCheckoutsEnabled: subscriptionEnabled,
        webAiCreditNewCheckoutsEnabled: aiCreditEnabled,
      });
      setSubscriptionEnabled(saved.webSubscriptionNewCheckoutsEnabled);
      setAiCreditEnabled(saved.webAiCreditNewCheckoutsEnabled);
      setCommerceLoadedKey([
        true,
        saved.webSubscriptionNewCheckoutsEnabled,
        saved.webAiCreditNewCheckoutsEnabled,
      ].join(":"));
      setCommerceFeedback({
        tone: "success",
        messageId: "shared.adminAiPrompt.commerce.feedback.success",
      });
      show(intl.formatMessage({ id: "shared.adminAiPrompt.toast.commerceSaved" }));
    } catch {
      setCommerceFeedback({
        tone: "error",
        messageId: "shared.adminAiPrompt.commerce.feedback.error",
      });
      show(intl.formatMessage({ id: "shared.adminAiPrompt.toast.commerceSaveFailed" }));
    }
  };

  const handleHeroSave = async () => {
    if (saveHero.isPending || !heroDirty) return;
    try {
      // 자동 전환은 초 단위로 입력받고 ms 로 보낸다. 0 은 '자동 전환 끄기'다.
      const saved = await saveHero.mutateAsync({
        freeVisibleCount: heroFree,
        premiumVisibleCount: heroPremium,
        autoPlayMs: heroAutoPlaySec === 0 ? 0 : heroAutoPlaySec * 1000,
      });
      setHeroFree(saved.freeVisibleCount);
      setHeroPremium(saved.premiumVisibleCount);
      setHeroAutoPlaySec(Math.round(saved.autoPlayMs / 1000));
      setHeroLoadedKey([true, saved.freeVisibleCount, saved.premiumVisibleCount, saved.autoPlayMs].join(":"));
      show(intl.formatMessage({ id: "shared.adminAiPrompt.hero.toast.saved" }));
    } catch {
      show(intl.formatMessage({ id: "shared.adminAiPrompt.hero.toast.saveFailed" }));
    }
  };

  return (
    <div className="aap-root hy-content">
      <div className="aap-header">
        <button
          type="button"
          className="aap-back hy-press"
          aria-label={intl.formatMessage({ id: "shared.adminAiPrompt.back" })}
          onClick={goBack}
        >
          <ChevronLeft size={22} strokeWidth={2.2} />
        </button>
        <h1 className="aap-title">
          {intl.formatMessage({ id: "shared.adminAiPrompt.title" })}
        </h1>
      </div>

      {adminStatus.isLoading ? (
        <p className="aap-state" role="status">
          {intl.formatMessage({ id: "shared.adminAiPrompt.status.checking" })}
        </p>
      ) : !isAdmin ? (
        <div className="aap-state aap-state--denied" role="alert">
          <ShieldAlert size={18} strokeWidth={2.2} aria-hidden="true" />
          <span>{intl.formatMessage({ id: "shared.adminAiPrompt.status.denied" })}</span>
        </div>
      ) : (
        <>
          <section className="aap-section" aria-labelledby="aap-commerce-title">
            <div className="aap-section-head">
              <div>
                <h2 id="aap-commerce-title">
                  {intl.formatMessage({ id: "shared.adminAiPrompt.commerce.title" })}
                </h2>
                <p>{intl.formatMessage({ id: "shared.adminAiPrompt.commerce.description" })}</p>
              </div>
              {commerceQuery.data && (
                <span
                  className={
                    commerceQuery.data.configured && !commerceDirty
                      ? "aap-badge"
                      : "aap-badge aap-badge--off"
                  }
                >
                  {intl.formatMessage({
                    id: !commerceQuery.data.configured
                      ? "shared.adminAiPrompt.commerce.badge.safetyStop"
                      : commerceDirty
                        ? "shared.adminAiPrompt.commerce.badge.unsaved"
                        : "shared.adminAiPrompt.commerce.badge.saved",
                  })}
                </span>
              )}
            </div>

            <div className="aap-commerce-note">
              <strong>
                {intl.formatMessage({ id: "shared.adminAiPrompt.commerce.note.heading" })}
              </strong>
              <span>
                {intl.formatMessage({ id: "shared.adminAiPrompt.commerce.note.description" })}
              </span>
            </div>

            {commerceQuery.isLoading ? (
              <p className="aap-state" role="status">
                {intl.formatMessage({ id: "shared.adminAiPrompt.commerce.loading" })}
              </p>
            ) : commerceQuery.isError ? (
              <div className="aap-state aap-state--error aap-state--stack" role="alert">
                <span>
                  {intl.formatMessage({
                    id: commerceStorageUnavailable
                      ? "shared.adminAiPrompt.commerce.error.storage"
                      : "shared.adminAiPrompt.commerce.error.general",
                  })}
                </span>
                <button
                  type="button"
                  className="aap-retry hy-press"
                  onClick={() => void commerceQuery.refetch()}
                >
                  {intl.formatMessage({ id: "shared.adminAiPrompt.retry" })}
                </button>
              </div>
            ) : serverCommerceControls ? (
              <>
                {!serverCommerceControls.configured && (
                  <p className="aap-commerce-unconfigured" role="alert">
                    {intl.formatMessage({ id: "shared.adminAiPrompt.commerce.unconfigured" })}
                  </p>
                )}

                <div className="aap-commerce-fields">
                  <fieldset className="aap-commerce-field" disabled={saveCommerceControls.isPending}>
                    <legend>
                      {intl.formatMessage({ id: "shared.adminAiPrompt.commerce.subscription.legend" })}
                    </legend>
                    <div className="aap-commerce-options">
                      <label className="aap-commerce-option">
                        <input
                          type="radio"
                          name="web-subscription-checkouts"
                          checked={!subscriptionEnabled}
                          onChange={() => {
                            setSubscriptionEnabled(false);
                            setCommerceFeedback(null);
                          }}
                        />
                        <span>
                          <strong>{intl.formatMessage({ id: "shared.adminAiPrompt.commerce.option.stop" })}</strong>
                          <small>{intl.formatMessage({ id: "shared.adminAiPrompt.commerce.subscription.stopDescription" })}</small>
                        </span>
                      </label>
                      <label className="aap-commerce-option">
                        <input
                          type="radio"
                          name="web-subscription-checkouts"
                          checked={subscriptionEnabled}
                          onChange={() => {
                            setSubscriptionEnabled(true);
                            setCommerceFeedback(null);
                          }}
                        />
                        <span>
                          <strong>{intl.formatMessage({ id: "shared.adminAiPrompt.commerce.option.allow" })}</strong>
                          <small>{intl.formatMessage({ id: "shared.adminAiPrompt.commerce.option.allowDescription" })}</small>
                        </span>
                      </label>
                    </div>
                  </fieldset>

                  <fieldset className="aap-commerce-field" disabled={saveCommerceControls.isPending}>
                    <legend>
                      {intl.formatMessage({ id: "shared.adminAiPrompt.commerce.credit.legend" })}
                    </legend>
                    <div className="aap-commerce-options">
                      <label className="aap-commerce-option">
                        <input
                          type="radio"
                          name="web-ai-credit-checkouts"
                          checked={!aiCreditEnabled}
                          onChange={() => {
                            setAiCreditEnabled(false);
                            setCommerceFeedback(null);
                          }}
                        />
                        <span>
                          <strong>{intl.formatMessage({ id: "shared.adminAiPrompt.commerce.option.stop" })}</strong>
                          <small>{intl.formatMessage({ id: "shared.adminAiPrompt.commerce.credit.stopDescription" })}</small>
                        </span>
                      </label>
                      <label className="aap-commerce-option">
                        <input
                          type="radio"
                          name="web-ai-credit-checkouts"
                          checked={aiCreditEnabled}
                          onChange={() => {
                            setAiCreditEnabled(true);
                            setCommerceFeedback(null);
                          }}
                        />
                        <span>
                          <strong>{intl.formatMessage({ id: "shared.adminAiPrompt.commerce.option.allow" })}</strong>
                          <small>{intl.formatMessage({ id: "shared.adminAiPrompt.commerce.option.allowDescription" })}</small>
                        </span>
                      </label>
                    </div>
                  </fieldset>
                </div>

                <button
                  type="button"
                  className="aap-commerce-save hy-press"
                  onClick={() => void handleCommerceSave()}
                  disabled={saveCommerceControls.isPending || !commerceDirty}
                  aria-busy={saveCommerceControls.isPending}
                >
                  {intl.formatMessage({
                    id: saveCommerceControls.isPending
                      ? "shared.adminAiPrompt.commerce.save.pending"
                      : commerceDirty
                        ? "shared.adminAiPrompt.commerce.save.action"
                        : "shared.adminAiPrompt.commerce.save.saved",
                  })}
                </button>

                {commerceFeedback?.tone === "success" && (
                  <p className="aap-feedback aap-feedback--success" role="status" aria-live="polite">
                    {intl.formatMessage({ id: commerceFeedback.messageId })}
                  </p>
                )}
                {commerceFeedback?.tone === "error" && (
                  <p className="aap-feedback aap-feedback--error" role="alert" aria-live="polite">
                    {intl.formatMessage({ id: commerceFeedback.messageId })}
                  </p>
                )}
              </>
            ) : null}
          </section>

          <section className="aap-section" aria-labelledby="aap-hero-title">
            <div className="aap-section-head">
              <div>
                <h2 id="aap-hero-title">
                  {intl.formatMessage({ id: "shared.adminAiPrompt.hero.title" })}
                </h2>
                <p>{intl.formatMessage({ id: "shared.adminAiPrompt.hero.description" })}</p>
              </div>
              {serverHero && (
                <span
                  className={
                    serverHero.configured && !heroDirty ? "aap-badge" : "aap-badge aap-badge--off"
                  }
                >
                  {intl.formatMessage({
                    id: !serverHero.configured
                      ? "shared.adminAiPrompt.hero.badge.default"
                      : heroDirty
                        ? "shared.adminAiPrompt.hero.badge.unsaved"
                        : "shared.adminAiPrompt.hero.badge.saved",
                  })}
                </span>
              )}
            </div>

            <div className="aap-notice">
              <strong>
                {intl.formatMessage({ id: "shared.adminAiPrompt.hero.note.heading" })}
              </strong>
              <span>
                {intl.formatMessage({ id: "shared.adminAiPrompt.hero.note.description" })}
              </span>
            </div>

            {heroQuery.isLoading ? (
              <p className="aap-state" role="status">
                {intl.formatMessage({ id: "shared.adminAiPrompt.hero.loading" })}
              </p>
            ) : heroQuery.isError ? (
              <div className="aap-state aap-state--error aap-state--stack" role="alert">
                <span>
                  {intl.formatMessage({
                    id: heroStorageUnavailable
                      ? "shared.adminAiPrompt.hero.error.storage"
                      : "shared.adminAiPrompt.hero.error.general",
                  })}
                </span>
                <button
                  type="button"
                  className="aap-retry hy-press"
                  onClick={() => void heroQuery.refetch()}
                >
                  {intl.formatMessage({ id: "shared.adminAiPrompt.retry" })}
                </button>
              </div>
            ) : serverHero ? (
              <>
                {!serverHero.configured && (
                  <p className="aap-commerce-unconfigured" role="status">
                    {intl.formatMessage({ id: "shared.adminAiPrompt.hero.unconfigured" })}
                  </p>
                )}

                <div className="aap-hero-fields">
                  <label className="aap-hero-field">
                    <span className="aap-hero-field__label">
                      {intl.formatMessage({ id: "shared.adminAiPrompt.hero.free.label" })}
                    </span>
                    <input
                      className="aap-hero-input"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={heroMaxSlides}
                      step={1}
                      value={heroFree}
                      disabled={saveHero.isPending}
                      onChange={(e) => setHeroFree(readHeroNumber(e.target.value))}
                    />
                    <small>
                      {intl.formatMessage(
                        { id: "shared.adminAiPrompt.hero.free.hint" },
                        { max: heroMaxSlides },
                      )}
                    </small>
                  </label>

                  <label className="aap-hero-field">
                    <span className="aap-hero-field__label">
                      {intl.formatMessage({ id: "shared.adminAiPrompt.hero.premium.label" })}
                    </span>
                    <input
                      className="aap-hero-input"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={heroMaxSlides}
                      step={1}
                      value={heroPremium}
                      disabled={saveHero.isPending}
                      onChange={(e) => setHeroPremium(readHeroNumber(e.target.value))}
                    />
                    <small>
                      {intl.formatMessage(
                        { id: "shared.adminAiPrompt.hero.premium.hint" },
                        { max: heroMaxSlides },
                      )}
                    </small>
                  </label>

                  <label className="aap-hero-field">
                    <span className="aap-hero-field__label">
                      {intl.formatMessage({ id: "shared.adminAiPrompt.hero.autoPlay.label" })}
                    </span>
                    <input
                      className="aap-hero-input"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={MAX_HERO_AUTOPLAY_MS / 1000}
                      step={1}
                      value={heroAutoPlaySec}
                      disabled={saveHero.isPending}
                      onChange={(e) => setHeroAutoPlaySec(readHeroNumber(e.target.value))}
                    />
                    <small>
                      {intl.formatMessage(
                        { id: "shared.adminAiPrompt.hero.autoPlay.hint" },
                        {
                          min: MIN_HERO_AUTOPLAY_MS / 1000,
                          max: MAX_HERO_AUTOPLAY_MS / 1000,
                        },
                      )}
                    </small>
                  </label>
                </div>

                {!heroValuesValid && (
                  <p className="aap-feedback aap-feedback--error" role="alert" aria-live="polite">
                    {intl.formatMessage({ id: "shared.adminAiPrompt.hero.invalid" })}
                  </p>
                )}

                <button
                  type="button"
                  className="aap-commerce-save hy-press"
                  onClick={() => void handleHeroSave()}
                  disabled={saveHero.isPending || !heroDirty || !heroValuesValid}
                  aria-busy={saveHero.isPending}
                >
                  {intl.formatMessage({
                    id: saveHero.isPending
                      ? "shared.adminAiPrompt.hero.save.pending"
                      : heroDirty
                        ? "shared.adminAiPrompt.hero.save.action"
                        : "shared.adminAiPrompt.hero.save.saved",
                  })}
                </button>
              </>
            ) : null}
          </section>

          <section className="aap-section" aria-labelledby="aap-prompt-title">
            <div className="aap-section-head">
              <div>
                <h2 id="aap-prompt-title">
                  {intl.formatMessage({ id: "shared.adminAiPrompt.prompt.title" })}
                </h2>
                <p>{intl.formatMessage({ id: "shared.adminAiPrompt.prompt.description" })}</p>
              </div>
            </div>

            <div className="aap-notice">
              <strong>
                {intl.formatMessage({ id: "shared.adminAiPrompt.prompt.notice.heading" })}
              </strong>
              <span>
                {intl.formatMessage({ id: "shared.adminAiPrompt.prompt.notice.description" })}
              </span>
            </div>

            {promptQuery.isLoading ? (
              <p className="aap-state" role="status">
                {intl.formatMessage({ id: "shared.adminAiPrompt.prompt.loading" })}
              </p>
            ) : promptQuery.isError ? (
              <div className="aap-state aap-state--error" role="alert">
                <span>{intl.formatMessage({ id: "shared.adminAiPrompt.prompt.error" })}</span>
                <button type="button" className="aap-retry hy-press" onClick={() => void promptQuery.refetch()}>
                  {intl.formatMessage({ id: "shared.adminAiPrompt.retry" })}
                </button>
              </div>
            ) : (
              <>
                <label className="aap-label" htmlFor="aap-textarea">
                  {intl.formatMessage({ id: "shared.adminAiPrompt.prompt.label" })}
                </label>
                <textarea
                  id="aap-textarea"
                  className="aap-textarea"
                  value={draft}
                  maxLength={maxLength}
                  rows={12}
                  placeholder={intl.formatMessage({ id: "shared.adminAiPrompt.prompt.placeholder" })}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <div className="aap-meta">
                  <span>
                    {draft.length} / {maxLength}
                    {intl.formatMessage({ id: "shared.adminAiPrompt.prompt.meta.characterUnit" })}
                  </span>
                  {promptQuery.data?.updatedAt && (
                    <span>
                      {intl.formatMessage({ id: "shared.adminAiPrompt.prompt.meta.lastSaved" })}
                      {promptQuery.data.updatedAt.slice(0, 16).replace("T", " ")}
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  className="aap-save hy-press"
                  onClick={() => void handleSave()}
                  disabled={savePrompt.isPending || !dirty}
                  aria-busy={savePrompt.isPending}
                >
                  {intl.formatMessage({
                    id: savePrompt.isPending
                      ? "shared.adminAiPrompt.prompt.save.pending"
                      : dirty
                        ? "shared.adminAiPrompt.prompt.save.action"
                        : "shared.adminAiPrompt.prompt.save.saved",
                  })}
                </button>
                <p className="aap-hint">
                  {intl.formatMessage({ id: "shared.adminAiPrompt.prompt.hint" })}
                </p>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}

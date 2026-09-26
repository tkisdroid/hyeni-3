/**
 * 계정 · 소셜 로그인 연결 (P-30 내부 섹션).
 *
 * 왜 필요한가: 전화(ID/PW)로 가입한 계정은 서버에 이메일이 없어, 같은 사람이 소셜로 로그인해도
 * 서버가 "다른 계정"으로 판단한다(가족이 없는 빈 계정으로 들어가거나 409 로 막힘).
 * 로그인한 상태에서 한 번 연결해 두면, 이후 그 소셜 로그인은 항상 이 계정으로 들어온다.
 *
 * 계정 교체는 "새 계정 연결 → 옛 계정 해제" 순서로 한다(먼저 해제하면 로그인 수단이 사라질 수 있다).
 * 해제 가능 여부는 서버가 최종 판정하지만(409 last_login_method), 버튼도 미리 잠가 오조작을 막는다.
 *
 * 네이티브 전용: 웹은 OAuth 복귀가 온보딩 화면 경유라 연결 흐름을 받을 곳이 없다 → 안내만 한다.
 */
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2 } from "lucide-react";
import { useToast } from "@/app/toast";
import { qk } from "@/queries/keys";
import {
  fetchOAuthLinks,
  abandonPendingOAuth,
  hasLocalOAuthContext,
  LINKABLE_PROVIDERS,
  startWorkerOAuth,
  unlinkOAuthAccount,
  type OAuthLink,
} from "@/lib/api/endpoints/auth";
import { OAUTH_DEEP_LINK_ACTIVITY_EVENT, OAUTH_LINK_EVENT } from "@/lib/native/oauthDeepLink";
import { isNativePlatform } from "@/lib/native/plugins";
import type { OAuthProvider } from "@/transform/oauthProvider";
import "./SocialLinks.css";
import { useIntl, type IntlShape } from "react-intl";
import type { MessageId } from "@/i18n/generated/messageIds";
import { localizeApiError } from "@/i18n/apiError";
import {
  OAUTH_CALLBACK_DELIVERY_GRACE_MS,
  shouldReleaseOAuthBusyOnResume,
} from "@/transform/asyncUiState";

/** 제공자 이름은 locale catalog 가 정본이다(다른 언어에서 카카오·네이버가 한국어로 남지 않게). */
const PROVIDER_LABEL_ID: Record<string, string> = {
  kakao: "parent.socialLinks.provider.kakao",
  google: "parent.socialLinks.provider.google",
  naver: "parent.socialLinks.provider.naver",
};

function providerLabel(intl: IntlShape, provider: string | null | undefined): string | null {
  const id = PROVIDER_LABEL_ID[String(provider ?? "")];
  return id ? intl.formatMessage({ id: id as MessageId }) : null;
}

interface LinkEventDetail {
  provider?: string;
  already?: boolean;
  failed?: boolean;
  cancelled?: boolean;
}

function linkKey(link: OAuthLink): string {
  return `${link.provider}:${link.providerId}`;
}

export function SocialLinks() {
  const intl = useIntl();
  const qc = useQueryClient();
  const { show } = useToast();
  const native = isNativePlatform();
  const oauthExternalPendingRef = useRef(false);
  const oauthResumeReleaseTimerRef = useRef<number | null>(null);
  const actionPendingRef = useRef(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: qk.oauthLinks,
    queryFn: fetchOAuthLinks,
    staleTime: 60_000,
    enabled: native,
  });

  useEffect(() => {
    const onLinked = (event: Event) => {
      const detail = (event as CustomEvent<LinkEventDetail>).detail ?? {};
      if (oauthResumeReleaseTimerRef.current !== null) {
        window.clearTimeout(oauthResumeReleaseTimerRef.current);
        oauthResumeReleaseTimerRef.current = null;
      }
      oauthExternalPendingRef.current = false;
      actionPendingRef.current = false;
      setBusy(null);
      if (detail.cancelled) {
        show(intl.formatMessage({ id: "onboarding.toast.socialCancelled" }));
        return;
      }
      if (detail.failed) {
        show(intl.formatMessage({ id: "core.error.api.unknown.formal" }));
        return;
      }
      const label = providerLabel(intl, detail.provider)
        ?? intl.formatMessage({ id: "parent.socialLinks.copy001" });
      show(intl.formatMessage(
        { id: detail.already ? "parent.social.alreadyLinked" : "parent.social.linked" },
        { provider: label },
      ));
      void qc.invalidateQueries({ queryKey: qk.oauthLinks });
    };
    window.addEventListener(OAUTH_LINK_EVENT, onLinked);
    return () => window.removeEventListener(OAUTH_LINK_EVENT, onLinked);
  }, [intl, qc, show]);

  useEffect(() => {
    const clearResumeReleaseTimer = () => {
      if (oauthResumeReleaseTimerRef.current === null) return;
      window.clearTimeout(oauthResumeReleaseTimerRef.current);
      oauthResumeReleaseTimerRef.current = null;
    };
    const releaseOAuthBusy = () => {
      if (document.visibilityState !== "visible" || !oauthExternalPendingRef.current) return;
      clearResumeReleaseTimer();
      // appUrlOpen보다 foreground가 먼저 와도 진행 중 callback의 action gate를 열지 않는다.
      // Worker의 전체 재시도 창 뒤에도 context가 남아 있을 때만 브라우저 중단으로 확정한다.
      oauthResumeReleaseTimerRef.current = window.setTimeout(() => {
        oauthResumeReleaseTimerRef.current = null;
        if (!shouldReleaseOAuthBusyOnResume({
          documentVisible: document.visibilityState === "visible",
          oauthExternalPending: oauthExternalPendingRef.current,
          oauthContextPending: hasLocalOAuthContext(),
        })) return;
        abandonPendingOAuth();
        oauthExternalPendingRef.current = false;
        actionPendingRef.current = false;
        setBusy(null);
      }, OAUTH_CALLBACK_DELIVERY_GRACE_MS);
    };
    const keepLockedForCallback = (event: Event) => {
      const detail = (event as CustomEvent<{ mode?: string }>).detail;
      if (detail?.mode !== "link") return;
      clearResumeReleaseTimer();
    };
    document.addEventListener("visibilitychange", releaseOAuthBusy);
    window.addEventListener("pageshow", releaseOAuthBusy);
    window.addEventListener(OAUTH_DEEP_LINK_ACTIVITY_EVENT, keepLockedForCallback);
    return () => {
      clearResumeReleaseTimer();
      document.removeEventListener("visibilitychange", releaseOAuthBusy);
      window.removeEventListener("pageshow", releaseOAuthBusy);
      window.removeEventListener(OAUTH_DEEP_LINK_ACTIVITY_EVENT, keepLockedForCallback);
    };
  }, []);

  const links = data?.links ?? [];
  // 남는 로그인 수단이 하나도 없으면 해제 금지(서버도 409 로 막지만 버튼부터 잠근다).
  const canUnlink = (data?.hasPasswordLogin ?? false) || links.length > 1;

  const startLink = async (provider: OAuthProvider) => {
    if (actionPendingRef.current) return;
    actionPendingRef.current = true;
    abandonPendingOAuth();
    setBusy(provider);
    setConfirming(null);
    try {
      await startWorkerOAuth(provider, "link", {
        onExternalOpen: () => {
          oauthExternalPendingRef.current = true;
        },
      });
    } catch (error) {
      oauthExternalPendingRef.current = false;
      actionPendingRef.current = false;
      setBusy(null);
      show(localizeApiError(error, intl, "formal"));
    }
  };

  const unlink = async (link: OAuthLink) => {
    if (actionPendingRef.current) return;
    const key = linkKey(link);
    if (confirming !== key) {
      setConfirming(key);
      return;
    }
    actionPendingRef.current = true;
    setConfirming(null);
    setBusy(key);
    try {
      await unlinkOAuthAccount({ provider: link.provider, providerId: link.providerId });
      show(intl.formatMessage(
        { id: "parent.social.unlinked" },
        { provider: providerLabel(intl, link.provider) ?? intl.formatMessage({ id: "parent.socialLinks.copy001" }) },
      ));
      await qc.invalidateQueries({ queryKey: qk.oauthLinks });
    } catch (error) {
      show(localizeApiError(error, intl, "formal"));
    } finally {
      actionPendingRef.current = false;
      setBusy(null);
    }
  };

  return (
    <div className="pa-group">
      <div className="pa-group__label">{intl.formatMessage({ id: "parent.socialLinks.copy002" })}</div>

      <div className="pa-card">
        {native && isLoading && (
          <div className="sl-state" aria-busy="true">{intl.formatMessage({ id: "parent.socialLinks.copy003" })}</div>
        )}

        {native && isError && (
          <div className="sl-state sl-state--error" role="alert" aria-live="assertive">
            <span>{intl.formatMessage({ id: "parent.socialLinks.copy004" })}</span>
            <button
              type="button"
              className="sl-retry hy-press"
              onClick={() => void refetch()}
              disabled={isFetching} aria-busy={isFetching}
            >
              {isFetching ? intl.formatMessage({ id: "parent.parentLocation.copy022" }) : intl.formatMessage({ id: "parent.socialLinks.copy005" })}
            </button>
          </div>
        )}

        {native && !isLoading && !isError && links.length === 0 && (
          <div className="sl-empty">{intl.formatMessage({ id: "parent.socialLinks.copy006" })}</div>
        )}

        {!isError && links.map((link, index) => {
          const key = linkKey(link);
          const isConfirming = confirming === key;
          return (
            <div key={key}>
              {index > 0 && <div className="pa-divider" />}
              <div className="pa-row">
                <span className="sl-acct">
                  <Link2 size={15} strokeWidth={2.2} color="var(--fg-faint)" />
                  <span className="sl-acct__name">{providerLabel(intl, link.provider) ?? link.provider}</span>
                  <span className="sl-acct__email">{link.email || intl.formatMessage({ id: "parent.socialLinks.copy007" })}</span>
                </span>
                <button
                  type="button"
                  className={`sl-unlink hy-press${isConfirming ? " sl-unlink--confirm" : ""}`}
                  disabled={!canUnlink || busy !== null} aria-busy={busy === key}
                  onClick={() => void unlink(link)}
                >
                  {busy === key ? intl.formatMessage({ id: "parent.socialLinks.copy008" }) : isConfirming ? intl.formatMessage({ id: "parent.socialLinks.copy009" }) : intl.formatMessage({ id: "parent.socialLinks.copy010" })}
                </button>
              </div>
            </div>
          );
        })}

        {(!native || (!isLoading && !isError)) && LINKABLE_PROVIDERS.map((provider) => {
          const hasAny = links.some((l) => l.provider === provider);
          return (
            <div key={`add-${provider}`}>
              <div className="pa-divider" />
              <button
                type="button"
                className="pa-row pa-row-btn hy-press"
                disabled={!native || isLoading || busy !== null} aria-busy={isLoading || busy === provider}
                onClick={() => startLink(provider)}
              >
                <span className="pa-row__k">
                  {providerLabel(intl, provider)} {intl.formatMessage({ id: "parent.socialLinks.copy011" })} {hasAny ? intl.formatMessage({ id: "parent.eventForm.copy058" }) : intl.formatMessage({ id: "parent.socialLinks.copy012" })}
                </span>
                <span className="pa-row__hint">
                  {!native ? intl.formatMessage({ id: "parent.socialLinks.copy013" }) : busy === provider ? intl.formatMessage({ id: "parent.socialLinks.copy014" }) : hasAny ? intl.formatMessage({ id: "parent.socialLinks.copy015" }) : intl.formatMessage({ id: "parent.socialLinks.copy016" })}
                </span>
              </button>
            </div>
          );
        })}
      </div>

      {/* 해제 안내는 연결된 소셜 계정이 있을 때만 — 하나도 없는데 "이 소셜 계정이 유일한 로그인 수단"이라고
          말하던 모순을 없앤다(2026-09-26). 웹은 앱에서 연결하라는 안내를 그대로 둔다. */}
      {(!native || links.length > 0) && (
      <div className="pa-note hy-explain">
        {native
          ? canUnlink
            ? (
              <span className="hy-explain__lines">
                <span className="hy-explain__line">{intl.formatMessage({ id: "parent.socialLinks.copy017" })}</span>
                <span className="hy-explain__line">{intl.formatMessage({ id: "parent.socialLinks.copy018" })}</span>
              </span>
            )
            : (
              <span className="hy-explain__lines">
                <span className="hy-explain__line">{intl.formatMessage({ id: "parent.socialLinks.copy019" })}</span>
                <span className="hy-explain__line">{intl.formatMessage({ id: "parent.socialLinks.copy020" })}</span>
              </span>
            )
          : (
            <span className="hy-explain__lines">
              <span className="hy-explain__line">{intl.formatMessage({ id: "parent.socialLinks.copy021" })}</span>
            </span>
          )}
      </div>
      )}
    </div>
  );
}

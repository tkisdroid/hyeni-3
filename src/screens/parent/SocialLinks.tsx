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
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2 } from "lucide-react";
import { useToast } from "@/app/toast";
import { qk } from "@/queries/keys";
import {
  fetchOAuthLinks,
  LINKABLE_PROVIDERS,
  startWorkerOAuth,
  unlinkOAuthAccount,
  type OAuthLink,
} from "@/lib/api/endpoints/auth";
import { OAUTH_LINK_EVENT } from "@/lib/native/oauthDeepLink";
import { isNativePlatform } from "@/lib/native/plugins";
import type { OAuthProvider } from "@/transform/oauthProvider";
import "./SocialLinks.css";

const PROVIDER_LABEL: Record<string, string> = { kakao: "카카오", google: "Google", naver: "네이버" };

interface LinkEventDetail {
  provider?: string;
  already?: boolean;
  error?: string;
}

function linkKey(link: OAuthLink): string {
  return `${link.provider}:${link.providerId}`;
}

export function SocialLinks() {
  const qc = useQueryClient();
  const { show } = useToast();
  const native = isNativePlatform();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: qk.oauthLinks,
    queryFn: fetchOAuthLinks,
    staleTime: 60_000,
    enabled: native,
  });

  useEffect(() => {
    const onLinked = (event: Event) => {
      const detail = (event as CustomEvent<LinkEventDetail>).detail ?? {};
      setBusy(null);
      if (detail.error) {
        show(`연결하지 못했어요. ${detail.error}`);
        return;
      }
      const label = PROVIDER_LABEL[detail.provider ?? ""] ?? "소셜";
      show(detail.already ? `이미 연결된 ${label} 계정이에요.` : `${label} 계정을 연결했어요.`);
      void qc.invalidateQueries({ queryKey: qk.oauthLinks });
    };
    window.addEventListener(OAUTH_LINK_EVENT, onLinked);
    return () => window.removeEventListener(OAUTH_LINK_EVENT, onLinked);
  }, [qc, show]);

  const links = data?.links ?? [];
  // 남는 로그인 수단이 하나도 없으면 해제 금지(서버도 409 로 막지만 버튼부터 잠근다).
  const canUnlink = (data?.hasPasswordLogin ?? false) || links.length > 1;

  const startLink = async (provider: OAuthProvider) => {
    setBusy(provider);
    setConfirming(null);
    try {
      await startWorkerOAuth(provider, "link");
    } catch (error) {
      setBusy(null);
      show(error instanceof Error ? error.message : "연결을 시작하지 못했어요.");
    }
  };

  const unlink = async (link: OAuthLink) => {
    const key = linkKey(link);
    if (confirming !== key) {
      setConfirming(key);
      return;
    }
    setConfirming(null);
    setBusy(key);
    try {
      await unlinkOAuthAccount({ provider: link.provider, providerId: link.providerId });
      show(`${PROVIDER_LABEL[link.provider] ?? "소셜"} 연결을 해제했어요.`);
      await qc.invalidateQueries({ queryKey: qk.oauthLinks });
    } catch (error) {
      show(error instanceof Error ? error.message : "해제하지 못했어요.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="pa-group">
      <div className="pa-group__label">소셜 로그인 연결</div>

      <div className="pa-card">
        {native && !isLoading && links.length === 0 && (
          <div className="sl-empty">아직 연결된 소셜 계정이 없어요.</div>
        )}

        {links.map((link, index) => {
          const key = linkKey(link);
          const isConfirming = confirming === key;
          return (
            <div key={key}>
              {index > 0 && <div className="pa-divider" />}
              <div className="pa-row">
                <span className="sl-acct">
                  <Link2 size={15} strokeWidth={2.2} color="var(--fg-faint)" />
                  <span className="sl-acct__name">{PROVIDER_LABEL[link.provider] ?? link.provider}</span>
                  <span className="sl-acct__email">{link.email || "계정 연결됨"}</span>
                </span>
                <button
                  type="button"
                  className={`sl-unlink hy-press${isConfirming ? " sl-unlink--confirm" : ""}`}
                  disabled={!canUnlink || busy === key}
                  onClick={() => void unlink(link)}
                >
                  {busy === key ? "해제 중…" : isConfirming ? "정말 해제할까요?" : "해제"}
                </button>
              </div>
            </div>
          );
        })}

        {LINKABLE_PROVIDERS.map((provider) => {
          const hasAny = links.some((l) => l.provider === provider);
          return (
            <div key={`add-${provider}`}>
              <div className="pa-divider" />
              <button
                type="button"
                className="pa-row pa-row-btn hy-press"
                disabled={!native || isLoading || busy === provider}
                onClick={() => startLink(provider)}
              >
                <span className="pa-row__k">
                  {PROVIDER_LABEL[provider]} 계정 {hasAny ? "추가" : "연결"}
                </span>
                <span className="pa-row__hint">
                  {!native ? "앱에서" : busy === provider ? "연결 중…" : hasAny ? "다른 계정 연결" : "연결하기"}
                </span>
              </button>
            </div>
          );
        })}
      </div>

      <div className="pa-note">
        {native
          ? canUnlink
            ? "계정을 바꾸려면 새 계정을 먼저 연결한 뒤 예전 계정을 해제하세요. 해제해도 가족·일정 데이터는 그대로예요."
            : "지금은 이 소셜 계정이 유일한 로그인 수단이라 해제할 수 없어요. 다른 로그인 방법을 먼저 추가해 주세요."
          : "소셜 계정 연결은 안드로이드 앱에서 할 수 있어요."}
      </div>
    </div>
  );
}

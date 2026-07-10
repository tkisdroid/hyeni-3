/**
 * 계정 · 소셜 로그인 연결 (P-30 내부 섹션).
 *
 * 왜 필요한가: 전화(ID/PW)로 가입한 계정은 서버에 이메일이 없어, 같은 사람이 소셜로 로그인해도
 * 서버가 "다른 계정"으로 판단한다(가족이 없는 빈 계정으로 들어가거나 409 로 막힘).
 * 로그인한 상태에서 한 번 연결해 두면, 이후 그 소셜 로그인은 항상 이 계정으로 들어온다.
 *
 * 네이티브 전용: 웹은 OAuth 복귀가 온보딩 화면 경유라 연결 흐름을 받을 곳이 없다 → 안내만 한다.
 */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2 } from "lucide-react";
import { useToast } from "@/app/toast";
import { qk } from "@/queries/keys";
import { fetchOAuthLinks, LINKABLE_PROVIDERS, startWorkerOAuth } from "@/lib/api/endpoints/auth";
import { OAUTH_LINK_EVENT } from "@/lib/native/oauthDeepLink";
import { isNativePlatform } from "@/lib/native/plugins";
import type { OAuthProvider } from "@/transform/oauthProvider";

const PROVIDER_LABEL: Record<string, string> = { kakao: "카카오", google: "Google", naver: "네이버" };

interface LinkEventDetail {
  provider?: string;
  already?: boolean;
  error?: string;
}

export function SocialLinks() {
  const qc = useQueryClient();
  const { show } = useToast();
  const native = isNativePlatform();
  const [busy, setBusy] = useState<OAuthProvider | null>(null);

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

  const linked = new Set((data?.links ?? []).map((l) => l.provider));

  const start = (provider: OAuthProvider) => {
    setBusy(provider);
    try {
      startWorkerOAuth(provider, "link");
    } catch (error) {
      setBusy(null);
      show(error instanceof Error ? error.message : "연결을 시작하지 못했어요.");
    }
  };

  return (
    <div className="pa-group">
      <div className="pa-group__label">소셜 로그인 연결</div>
      <div className="pa-card">
        {LINKABLE_PROVIDERS.map((provider, index) => {
          const isLinked = linked.has(provider);
          const email = (data?.links ?? []).find((l) => l.provider === provider)?.email;
          return (
            <div key={provider}>
              {index > 0 && <div className="pa-divider" />}
              <button
                type="button"
                className="pa-row pa-row-btn hy-press"
                disabled={!native || isLoading || busy === provider}
                onClick={() => start(provider)}
              >
                <span className="pa-row__k">
                  <Link2 size={15} strokeWidth={2.2} style={{ verticalAlign: "-2px", marginRight: 6 }} />
                  {PROVIDER_LABEL[provider]}
                </span>
                <span className="pa-row__hint">
                  {!native
                    ? "앱에서"
                    : busy === provider
                      ? "연결 중…"
                      : isLinked
                        ? email
                          ? `연결됨 · ${email}`
                          : "연결됨"
                        : "연결하기"}
                </span>
              </button>
            </div>
          );
        })}
      </div>
      <div className="pa-note">
        {native
          ? "연결해 두면 다음부터 그 소셜 계정으로도 이 가족 계정에 바로 들어올 수 있어요. 이미 연결된 항목을 다시 누르면 다른 소셜 계정을 추가로 연결합니다."
          : "소셜 계정 연결은 안드로이드 앱에서 할 수 있어요."}
      </div>
    </div>
  );
}

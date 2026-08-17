import { asset } from "@/lib/assets";
import "./Splash.css";
import { FormattedMessage, useIntl } from "react-intl";

/**
 * C-01 스플래시 — hyeni-1 "포근한 로즈" 시안 이식.
 * 크림·로즈 그라데이션 + 블러 블롭 배경, 후광 위 손 흔드는 혜니(플로팅),
 * 워드마크·슬로건 + 하단 점 3개 로딩 인디케이터.
 * 라우팅/전환은 상위(App 부트 게이트)가 담당 — 이 컴포넌트는 표시 전용.
 */
export function Splash({ exiting = false }: { exiting?: boolean }) {
  const intl = useIntl();
  return (
    <div className={`sp-root${exiting ? " sp-root--exit" : ""}`} role="status" aria-live="polite">
      {/* 배경 블롭(장식) */}
      <span className="sp-blob sp-blob--1" aria-hidden="true" />
      <span className="sp-blob sp-blob--2" aria-hidden="true" />
      <span className="sp-blob sp-blob--3" aria-hidden="true" />

      <div className="sp-center">
        <div className="sp-halo">
          <img
            className="sp-mascot"
            src={asset("mascot/wave.webp")}
            alt={intl.formatMessage({ id: "core.splash.mascotAlt" })}
            loading="eager"
            decoding="async"
            fetchPriority="high"
          />
        </div>
        <div className="sp-title">
          <FormattedMessage id="core.brand.nameRich" values={{ strong: (chunks) => <strong>{chunks}</strong> }} />
        </div>
        <div className="sp-sub">
          <FormattedMessage id="core.splash.tagline" values={{ br: () => <br /> }} />
        </div>
      </div>

      <div className="sp-loadwrap" aria-label={intl.formatMessage({ id: "core.state.loading" })}>
        <span className="sp-dots" aria-hidden="true">
          <span className="sp-dot" />
          <span className="sp-dot" />
          <span className="sp-dot" />
        </span>
        <span className="sp-loadtext">{intl.formatMessage({ id: "core.splash.loadingFamily" })}</span>
      </div>
    </div>
  );
}

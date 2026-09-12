import { BookOpen, Calculator, ChevronLeft, ChevronRight } from "lucide-react";
import { useIntl } from "react-intl";
import { Navigate, useNavigate } from "react-router";
import { useAuth } from "@/auth/AuthContext";
import { MINI_APP_COPY } from "@/features/miniapps/miniAppCopy";
import { isMiniAppsMarket, resolveMathMiniAppDestination, resolveVocabularyMiniAppDestination } from "@/features/miniapps/miniAppNavigation";
import { useLocale } from "@/i18n/useLocale";
import { asset } from "@/lib/assets";
import "./mini-apps.css";

export function MiniApps() {
  const intl = useIntl();
  const auth = useAuth();
  const { accessCountry } = useLocale();
  const navigate = useNavigate();
  const isChild = auth.role === "child";
  const homePath = isChild ? "/child/home" : "/parent/home";
  const mathPath = auth.role ? resolveMathMiniAppDestination(auth.role) : null;
  const vocabularyPath = auth.role ? resolveVocabularyMiniAppDestination(auth.role) : null;

  if (!mathPath || !isMiniAppsMarket(accessCountry)) return <Navigate to={homePath} replace />;

  return (
    <section className="mini-apps-screen" aria-labelledby="mini-apps-title">
      <header className="mini-apps-header">
        <button
          type="button"
          className="mini-apps-back hy-press"
          onClick={() => navigate(homePath)}
          aria-label={MINI_APP_COPY.back}
        >
          <ChevronLeft aria-hidden="true" />
        </button>
        <div>
          <p className="mini-apps-eyebrow">HYENI MINI APPS</p>
          <h1 id="mini-apps-title">{MINI_APP_COPY.title}</h1>
          <p>{MINI_APP_COPY.subtitle}</p>
        </div>
      </header>

      <section className="mini-apps-grid" aria-label={MINI_APP_COPY.title}>
        <button
          type="button"
          className="mini-app-card mini-app-card--math hy-press"
          onClick={() => navigate(mathPath)}
        >
          <span className="mini-app-card__art" aria-hidden="true">
            <img src={asset("mascot/diary.webp")} alt="" />
            <span><Calculator /></span>
          </span>
          <span className="mini-app-card__copy">
            <span className="mini-app-card__badge">{MINI_APP_COPY.mathBadge}</span>
            <strong>{MINI_APP_COPY.mathTitle}</strong>
            <span>{MINI_APP_COPY.mathDescription}</span>
          </span>
          <ChevronRight className="mini-app-card__arrow" aria-hidden="true" />
        </button>
        {vocabularyPath && <button type="button" className="mini-app-card mini-app-card--vocabulary hy-press" onClick={() => navigate(vocabularyPath)}>
          <span className="mini-app-card__art" aria-hidden="true"><BookOpen /></span>
          <span className="mini-app-card__copy">
            <span className="mini-app-card__badge">{intl.formatMessage({ id: "study.vocabulary.miniBadge" })}</span>
            <strong>{intl.formatMessage({ id: "study.vocabulary.title" })}</strong>
            <span>{intl.formatMessage({ id: isChild ? "study.vocabulary.miniChild" : "study.vocabulary.miniParent" })}</span>
          </span>
          <ChevronRight className="mini-app-card__arrow" aria-hidden="true" />
        </button>}
      </section>
    </section>
  );
}

export default MiniApps;

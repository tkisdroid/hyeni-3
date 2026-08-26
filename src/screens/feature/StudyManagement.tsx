import { ChevronLeft, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router";
import { STUDY_COPY_KO } from "@/components/study/studyCopy.ko";
import { useStudyChildren, useStudyStatus } from "@/queries/useStudy";
import "./StudyManagement.css";

export function StudyManagement() {
  const navigate = useNavigate();
  const statusQuery = useStudyStatus();
  const featureState = statusQuery.isError ? "unavailable" : statusQuery.data?.state;
  const childrenQuery = useStudyChildren(featureState);
  const studyChildren = childrenQuery.data?.children ?? [];
  const studyManagementLoading = statusQuery.isLoading
    || (featureState === "ready" && childrenQuery.isLoading);
  const studyManagementError = statusQuery.isError
    || featureState === "unavailable"
    || childrenQuery.isError;

  const retryStudyManagement = async () => {
    const statusResult = await statusQuery.refetch();
    if (statusResult.data?.state === "ready") await childrenQuery.refetch();
  };

  return (
    <main className="study-management hy-screen">
      <header className="study-management__header">
        <button
          type="button"
          className="study-management__back hy-press"
          aria-label={STUDY_COPY_KO.screen.back}
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} aria-hidden="true" />
        </button>
        <h1>{STUDY_COPY_KO.screen.title}</h1>
      </header>

      <div className="study-management__content">
        <section className="study-management__intro">
          <span className="study-management__symbol" aria-hidden="true">÷</span>
          <div>
            <h2>{STUDY_COPY_KO.screen.introTitle}</h2>
            <p>{STUDY_COPY_KO.screen.introDescription}</p>
          </div>
        </section>

        {studyManagementLoading ? (
          <section className="study-management__state" aria-live="polite">
            <span className="study-management__spinner" aria-hidden="true" />
            <p>{STUDY_COPY_KO.screen.loading}</p>
          </section>
        ) : studyManagementError ? (
          <section className="study-management__state" role="alert">
            <h2>{STUDY_COPY_KO.screen.unavailableTitle}</h2>
            <p>{STUDY_COPY_KO.screen.unavailableDescription}</p>
            <button type="button" className="study-management__retry hy-press" onClick={() => void retryStudyManagement()}>
              <RefreshCw size={17} aria-hidden="true" />
              {STUDY_COPY_KO.screen.retry}
            </button>
          </section>
        ) : featureState === "disabled" ? (
          <section className="study-management__state">
            <h2>{STUDY_COPY_KO.screen.disabledTitle}</h2>
            <p>{STUDY_COPY_KO.screen.disabledDescription}</p>
          </section>
        ) : studyChildren.length === 0 ? (
          <section className="study-management__state">
            <h2>{STUDY_COPY_KO.screen.emptyTitle}</h2>
            <p>{STUDY_COPY_KO.screen.emptyDescription}</p>
          </section>
        ) : (
          <section className="study-management__children" aria-label={STUDY_COPY_KO.screen.introTitle}>
            {studyChildren.map((child) => (
              <article className="study-management__child" key={child.memberId}>
                <span className="study-management__child-avatar" aria-hidden="true">
                  {child.displayName.trim().slice(0, 1) || "아"}
                </span>
                <span className="study-management__child-copy">
                  <strong>{child.displayName}</strong>
                  <small>
                    {child.linked ? STUDY_COPY_KO.screen.linked : STUDY_COPY_KO.screen.unlinked}
                  </small>
                </span>
              </article>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}

import { useIntl } from "react-intl";
import type { StudyMissionDto } from "./contracts";

export function StudyMissionResult({
  mission,
  onContinue,
  onChooseGrade,
  continueBusy,
  continueError,
  onHome,
}: Readonly<{
  mission: StudyMissionDto;
  onContinue: () => void;
  onChooseGrade: (() => void) | null;
  continueBusy: boolean;
  continueError: boolean;
  onHome: () => void;
}>) {
  const intl = useIntl();
  return (
    <section className="study-mission-result" aria-labelledby="study-mission-complete-title">
      <span className="study-complete-icon" aria-hidden="true">✓</span>
      <h2 id="study-mission-complete-title" tabIndex={-1}>{intl.formatMessage({ id: "study.child.complete.title" })}</h2>
      <p>{intl.formatMessage({ id: "study.child.complete.summary" }, { count: mission.progress.total })}</p>
      <p>{intl.formatMessage({ id: "study.child.complete.saved" })}</p>
      <div className="study-result-actions">
        <button type="button" disabled={continueBusy} aria-busy={continueBusy} onClick={onContinue}>
          {intl.formatMessage({ id: continueBusy ? "study.child.start.starting" : "study.child.start.button" })}
        </button>
        {onChooseGrade && (
          <button type="button" className="is-secondary" disabled={continueBusy} aria-busy={continueBusy} onClick={onChooseGrade}>
            {intl.formatMessage({ id: "study.child.gradeHelp" })}
          </button>
        )}
        <button type="button" className="is-secondary" disabled={continueBusy} aria-busy={continueBusy} onClick={onHome}>
          {intl.formatMessage({ id: "study.child.complete.home" })}
        </button>
      </div>
      {continueError && <p role="alert">{intl.formatMessage({ id: "study.child.start.error" })}</p>}
    </section>
  );
}

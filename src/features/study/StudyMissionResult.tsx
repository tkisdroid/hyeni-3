import { useIntl } from "react-intl";
import type { StudyMissionDto } from "./contracts";

export function StudyMissionResult({
  mission,
  onHome,
}: Readonly<{ mission: StudyMissionDto; onHome: () => void }>) {
  const intl = useIntl();
  return (
    <section className="study-mission-result" aria-labelledby="study-mission-complete-title">
      <span className="study-complete-icon" aria-hidden="true">✓</span>
      <h2 id="study-mission-complete-title" tabIndex={-1}>{intl.formatMessage({ id: "study.child.complete.title" })}</h2>
      <p>{intl.formatMessage({ id: "study.child.complete.summary" }, { count: mission.progress.total })}</p>
      <p>{intl.formatMessage({ id: "study.child.complete.saved" })}</p>
      <button type="button" onClick={onHome}>{intl.formatMessage({ id: "study.child.complete.home" })}</button>
    </section>
  );
}

import { useIntl } from "react-intl";
import type { StudyReportDto } from "./contracts";

export function StudyReport({ report }: Readonly<{ report: StudyReportDto }>) {
  const intl = useIntl();
  return (
    <section className="study-report" aria-labelledby="study-report-title">
      <h2 id="study-report-title">{intl.formatMessage({ id: "study.parent.report.title" })}</h2>
      {report.conceptMastery.length === 0 ? (
        <p>{intl.formatMessage({ id: "study.parent.report.empty" })}</p>
      ) : (
        <ul className="study-mastery-list">
          {report.conceptMastery.map((concept) => (
            <li key={concept.conceptId}>
              <span>{concept.label}</span>
              <progress max={100} value={concept.mastery} aria-label={intl.formatMessage({ id: "study.parent.report.masteryLabel" }, { concept: concept.label, mastery: Math.round(concept.mastery) })} />
              <b>{Math.round(concept.mastery)}%</b>
            </li>
          ))}
        </ul>
      )}
      <h3>{intl.formatMessage({ id: "study.parent.report.recent" })}</h3>
      {report.recentSessions.length === 0 ? (
        <p>{intl.formatMessage({ id: "study.parent.report.noSessions" })}</p>
      ) : (
        <ul className="study-session-list">
          {report.recentSessions.map((session) => (
            <li key={session.sessionId}>
              <span>{intl.formatDate(new Date(session.startedAt), { dateStyle: "medium" })}</span>
              <span>{intl.formatMessage({ id: "study.parent.report.problemCount" }, { count: session.problemCount })}</span>
              <span>{session.accuracy === null ? "—" : `${Math.round(session.accuracy)}%`}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

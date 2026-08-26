import type { StudyChildDto, StudyReportDto } from "@/lib/api/endpoints/study";
import { STUDY_COPY_KO } from "./studyCopy.ko";

function formatStudyDate(value: string | null): string {
  if (!value) return STUDY_COPY_KO.report.noRecord;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return STUDY_COPY_KO.report.noRecord;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatAccuracy(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)}%`;
}

export function StudyReportPanel({
  child,
  report,
}: Readonly<{ child: StudyChildDto; report: StudyReportDto }>) {
  return (
    <section className="study-report" aria-labelledby="study-report-title">
      <div className="study-report__heading">
        <div>
          <h2 id="study-report-title">{STUDY_COPY_KO.report.title}</h2>
          <p>{child.displayName} · {report.grade ? `${report.grade}학년` : STUDY_COPY_KO.report.gradeUnset}</p>
        </div>
        <span className="study-report__range">{STUDY_COPY_KO.report.range7d}</span>
      </div>

      <dl className="study-report__metrics">
        <div>
          <dt>{STUDY_COPY_KO.report.todayProblems}</dt>
          <dd>{report.todayProblemCount}{STUDY_COPY_KO.report.problemUnit}</dd>
        </div>
        <div>
          <dt>{STUDY_COPY_KO.report.accuracy}</dt>
          <dd>{formatAccuracy(report.accuracy)}</dd>
        </div>
        <div>
          <dt>{STUDY_COPY_KO.report.reviewDue}</dt>
          <dd>{report.reviewDueCount}{STUDY_COPY_KO.report.problemUnit}</dd>
        </div>
      </dl>

      <p className="study-report__last">
        <span>{STUDY_COPY_KO.report.lastStudied}</span>
        <strong>{formatStudyDate(report.lastStudiedAt)}</strong>
      </p>

      <div className="study-report__section">
        <h3>{STUDY_COPY_KO.report.mastery}</h3>
        {report.conceptMastery.length === 0 ? (
          <p className="study-report__empty">{STUDY_COPY_KO.report.noMastery}</p>
        ) : (
          <ul className="study-report__mastery">
            {report.conceptMastery.map((concept) => (
              <li key={concept.conceptId}>
                <span>{concept.label}</span>
                <strong>{Math.round(concept.mastery)}%</strong>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="study-report__section">
        <h3>{STUDY_COPY_KO.report.recentSessions}</h3>
        {report.recentSessions.length === 0 ? (
          <p className="study-report__empty">{STUDY_COPY_KO.report.noSessions}</p>
        ) : (
          <ul className="study-report__sessions">
            {report.recentSessions.map((session) => (
              <li key={session.sessionId}>
                <span>{formatStudyDate(session.startedAt)}</span>
                <span>{session.problemCount}{STUDY_COPY_KO.report.problemUnit} · {formatAccuracy(session.accuracy)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

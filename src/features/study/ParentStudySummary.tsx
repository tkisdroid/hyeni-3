import { useIntl } from "react-intl";
import type { StudyReportDto } from "./contracts";

export function ParentStudySummary({ report }: Readonly<{ report: StudyReportDto }>) {
  const intl = useIntl();
  return (
    <section className="parent-study-summary" aria-labelledby="parent-study-summary-title">
      <h2 id="parent-study-summary-title">{intl.formatMessage({ id: "study.parent.summary.title" })}</h2>
      <dl>
        <div><dt>{intl.formatMessage({ id: "study.parent.summary.today" })}</dt><dd>{report.todayProblemCount}</dd></div>
        <div><dt>{intl.formatMessage({ id: "study.parent.summary.completed" })}</dt><dd>{intl.formatMessage({ id: report.completedToday ? "study.common.yes" : "study.common.no" })}</dd></div>
        <div><dt>{intl.formatMessage({ id: "study.parent.summary.accuracy" })}</dt><dd>{report.accuracy === null ? "—" : `${Math.round(report.accuracy)}%`}</dd></div>
        <div><dt>{intl.formatMessage({ id: "study.parent.summary.reviewDue" })}</dt><dd>{report.reviewDueCount}</dd></div>
      </dl>
      <p>
        {report.lastStudiedAt
          ? intl.formatMessage(
              { id: "study.parent.summary.lastStudied" },
              { date: intl.formatDate(new Date(report.lastStudiedAt), { dateStyle: "medium", timeStyle: "short" }) },
            )
          : intl.formatMessage({ id: "study.parent.summary.noHistory" })}
      </p>
    </section>
  );
}

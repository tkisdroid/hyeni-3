import { useEffect, useState } from "react";
import { useIntl } from "react-intl";
import type { StudyGrade, StudyResolvedGrade } from "./contracts";

type Props = Readonly<{
  grade: StudyResolvedGrade | null;
  rowVersion: number | null;
  busy: boolean;
  conflict?: boolean;
  saveFailed?: boolean;
  onChange: (grade: StudyGrade | null) => void | Promise<void>;
}>;

export function StudyGradeEditor({ grade, rowVersion, busy, conflict = false, saveFailed = false, onChange }: Props) {
  const intl = useIntl();
  const [selected, setSelected] = useState<StudyGrade>(grade?.grade ?? 3);
  useEffect(() => setSelected(grade?.grade ?? 3), [grade?.grade]);
  const sourceId = grade?.source === "parent_override"
    ? "study.parent.grade.guardianSource"
    : "study.parent.grade.birthSource";
  return (
    <section className="study-grade-editor" aria-labelledby="study-grade-title">
      <h2 id="study-grade-title">{intl.formatMessage({ id: "study.parent.grade.title" })}</h2>
      {grade && <p>{intl.formatMessage({ id: sourceId }, { grade: grade.grade, year: grade.academicYear })}</p>}
      {!grade && <p>{intl.formatMessage({ id: "study.parent.grade.unavailable" })}</p>}
      <div className="study-grade-actions">
        <label>
          {intl.formatMessage({ id: "study.parent.grade.select" })}
          <select value={selected} disabled={busy} onChange={(event) => setSelected(Number(event.currentTarget.value) as StudyGrade)}>
            {([3, 4, 5, 6] as const).map((value) => (
              <option key={value} value={value}>{intl.formatMessage({ id: "study.parent.grade.option" }, { grade: value })}</option>
            ))}
          </select>
        </label>
        <button type="button" disabled={busy || rowVersion === null} aria-busy={busy} onClick={() => void onChange(selected)}>
          {intl.formatMessage({ id: busy ? "study.parent.grade.saving" : "study.parent.grade.save" })}
        </button>
        {grade?.source === "parent_override" && (
          <button type="button" className="study-secondary-button" disabled={busy || rowVersion === null} aria-busy={busy} onClick={() => void onChange(null)}>
            {intl.formatMessage({ id: "study.parent.grade.reset" })}
          </button>
        )}
      </div>
      <p className="study-grade-note">{intl.formatMessage({ id: "study.parent.grade.nextMission" })}</p>
      {rowVersion === null && <p role="alert">{intl.formatMessage({ id: "study.parent.grade.versionUnavailable" })}</p>}
      {conflict && <p role="alert">{intl.formatMessage({ id: "study.parent.grade.changed" })}</p>}
      {saveFailed && <p role="alert">{intl.formatMessage({ id: "study.parent.grade.error" })}</p>}
    </section>
  );
}

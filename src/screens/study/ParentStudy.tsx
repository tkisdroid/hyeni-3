import { useEffect, useState } from "react";
import { useIntl } from "react-intl";
import { useNavigate, useSearchParams } from "react-router";
import { useActiveChild } from "@/app/activeChild";
import { ApiError } from "@/lib/api/errors";
import { useStudyReport, useUpdateStudyGrade } from "@/queries/useStudy";
import { StudyAccessGate } from "@/features/study/StudyAccessGate";
import { ParentStudySummary } from "@/features/study/ParentStudySummary";
import { StudyGradeEditor } from "@/features/study/StudyGradeEditor";
import { StudyReport } from "@/features/study/StudyReport";
import { buildStudyGradeCommand, resolveParentStudyTarget } from "@/features/study/parentStudyModel";
import type { StudyGrade, StudyRange } from "@/features/study/contracts";
import "@/features/study/parent-study.css";

export function ParentStudy() {
  const intl = useIntl();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { selectedActiveChild, childMembers, familyLoading, setActiveChildId } = useActiveChild();
  const requestedId = params.get("member")?.trim() || null;
  const target = resolveParentStudyTarget(childMembers, selectedActiveChild?.id ?? null, requestedId);
  const memberId = target.kind === "ready" ? target.child.id : null;
  const [range, setRange] = useState<StudyRange>("30d");
  const [gradeError, setGradeError] = useState<string | null>(null);
  const report = useStudyReport(memberId, range);
  const gradeMutation = useUpdateStudyGrade();

  useEffect(() => {
    if (target.kind === "ready" && target.fromDeepLink && target.child.id !== selectedActiveChild?.id) {
      setActiveChildId(target.child.id);
    }
  }, [selectedActiveChild?.id, setActiveChildId, target]);

  const saveGrade = async (grade: StudyGrade | null) => {
    if (target.kind !== "ready") return;
    const rowVersion = target.child.learning_grade_row_version;
    if (!Number.isSafeInteger(rowVersion) || Number(rowVersion) < 1) return;
    setGradeError(null);
    try {
      await gradeMutation.mutateAsync(buildStudyGradeCommand({
        memberId: target.child.id,
        grade,
        rowVersion: Number(rowVersion),
        requestId: crypto.randomUUID(),
      }));
    } catch (error) {
      setGradeError(error instanceof ApiError ? error.code : "study_grade_error");
    }
  };

  return (
    <StudyAccessGate deniedPath="/parent/home" onBack={() => navigate("/parent/home")}>
      <div className="parent-study-screen">
        <header className="parent-study-header">
          <button type="button" className="study-back-button" onClick={() => navigate("/parent/home")} aria-label={intl.formatMessage({ id: "study.common.back" })}>←</button>
          <div><h1>{intl.formatMessage({ id: "study.parent.title" })}</h1><p>{intl.formatMessage({ id: "study.parent.subtitle" })}</p></div>
        </header>

        {familyLoading ? (
          <p role="status">{intl.formatMessage({ id: "study.parent.loadingFamily" })}</p>
        ) : target.kind === "invalid" ? (
          <section className="study-parent-state" role="alert">
            <p>{intl.formatMessage({ id: "study.parent.invalidChild" })}</p>
            <button type="button" onClick={() => setParams({})}>{intl.formatMessage({ id: "study.parent.chooseChild" })}</button>
          </section>
        ) : target.kind === "select" ? (
          <section className="study-parent-state">
            <h2>{intl.formatMessage({ id: "study.parent.chooseChild" })}</h2>
            <div className="study-child-list">{childMembers.map((child) => <button type="button" key={child.id} onClick={() => setActiveChildId(child.id)}>{child.name || intl.formatMessage({ id: "study.parent.childFallback" })}</button>)}</div>
          </section>
        ) : (
          <>
            <section className="study-selected-child">
              <span>{intl.formatMessage({ id: "study.parent.currentChild" })}</span>
              <strong>{target.child.name || intl.formatMessage({ id: "study.parent.childFallback" })}</strong>
            </section>
            {report.isPending ? (
              <p role="status">{intl.formatMessage({ id: "study.parent.loadingReport" })}</p>
            ) : report.isError || !report.data ? (
              <section className="study-parent-state" role="alert"><p>{intl.formatMessage({ id: "study.parent.reportError" })}</p><button type="button" onClick={() => void report.refetch()}>{intl.formatMessage({ id: "study.unavailable.retry" })}</button></section>
            ) : (
              <>
                <ParentStudySummary report={report.data} />
                <StudyGradeEditor
                  grade={report.data.grade}
                  rowVersion={Number.isSafeInteger(target.child.learning_grade_row_version) ? Number(target.child.learning_grade_row_version) : null}
                  busy={gradeMutation.isPending}
                  errorCode={gradeError}
                  onChange={saveGrade}
                />
                {report.data.state === "grade_unavailable" && (
                  <button type="button" className="study-profile-link" onClick={() => navigate("/profile-edit", { state: { childId: target.child.id } })}>{intl.formatMessage({ id: "study.parent.editBirthdate" })}</button>
                )}
                <label className="study-range-select">{intl.formatMessage({ id: "study.parent.range" })}<select value={range} onChange={(event) => setRange(event.currentTarget.value as StudyRange)}><option value="7d">{intl.formatMessage({ id: "study.parent.range7d" })}</option><option value="30d">{intl.formatMessage({ id: "study.parent.range30d" })}</option><option value="term">{intl.formatMessage({ id: "study.parent.rangeTerm" })}</option></select></label>
                <StudyReport report={report.data} />
              </>
            )}
          </>
        )}
      </div>
    </StudyAccessGate>
  );
}

export default ParentStudy;

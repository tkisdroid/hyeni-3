import { useEffect, useState } from "react";
import { useIntl } from "react-intl";
import { useNavigate } from "react-router";
import { StudyAccessGate } from "@/features/study/StudyAccessGate";
import { isLearningGradeUnavailable, resolveChildStudyEntry } from "@/features/study/childStudyModel";
import { StudyMissionPlayer } from "@/features/study/StudyMissionPlayer";
import { useStartStudyMission, useStudyLearnerState, useStudyMission } from "@/queries/useStudy";
import { resolveQueryTruthState } from "@/transform/queryTruthState";
import "@/features/study/child-study.css";

export function ChildStudy() {
  const intl = useIntl();
  const navigate = useNavigate();
  const learner = useStudyLearnerState();
  const start = useStartStudyMission();
  const [missionId, setMissionId] = useState<string | null>(null);
  const mission = useStudyMission(missionId);
  const gradeUnavailable = isLearningGradeUnavailable(learner.error);
  const childStudyQueryState = resolveQueryTruthState([
    { isLoading: learner.isLoading, isError: learner.isError },
    { isLoading: mission.isLoading, isError: mission.isError },
  ]);
  const retryChildStudy = async (): Promise<void> => {
    const retries: Promise<unknown>[] = [learner.refetch()];
    if (missionId) retries.push(mission.refetch());
    await Promise.all(retries);
  };

  useEffect(() => {
    if (!missionId && learner.data?.activeMissionId) setMissionId(learner.data.activeMissionId);
  }, [learner.data?.activeMissionId, missionId]);

  const goHome = () => navigate("/child/home");
  return (
    <StudyAccessGate deniedPath="/child/home" onBack={goHome}>
      <div className="child-study-screen">
        <header className="child-study-header">
          <button type="button" onClick={goHome} aria-label={intl.formatMessage({ id: "study.common.back" })}>←</button>
          <div><h1>{intl.formatMessage({ id: "study.child.title" })}</h1><p>{intl.formatMessage({ id: "study.child.subtitle" })}</p></div>
        </header>
        {childStudyQueryState === "loading" && learner.isLoading ? (
          <p role="status">{intl.formatMessage({ id: "study.child.loading" })}</p>
        ) : gradeUnavailable ? (
          <section className="child-study-state">
            <p>{intl.formatMessage({ id: "study.child.gradeHelp" })}</p>
            <button type="button" onClick={goHome}>{intl.formatMessage({ id: "study.child.askGuardian" })}</button>
          </section>
        ) : childStudyQueryState === "error" || !learner.data ? (
          <section className="child-study-state" role="alert"><p>{intl.formatMessage({ id: learner.isError ? "study.child.loadError" : "study.child.missionError" })}</p><button type="button" onClick={() => void retryChildStudy()}>{intl.formatMessage({ id: "study.unavailable.retry" })}</button></section>
        ) : (
          <ChildStudyContent
            entry={resolveChildStudyEntry(learner.data)}
            grade={learner.data.profile.grade.grade}
            missionId={missionId}
            mission={mission}
            startBusy={start.isPending}
            startError={start.isError}
            onStart={async () => {
              try {
                const created = await start.mutateAsync({ mode: "daily", idempotencyKey: crypto.randomUUID() });
                setMissionId(created.missionId);
              } catch {
                // mutation 상태가 동일 카드에 복구 액션을 표시한다. 세션은 503으로 지우지 않는다.
              }
            }}
            onHome={goHome}
          />
        )}
      </div>
    </StudyAccessGate>
  );
}

function ChildStudyContent({
  entry,
  grade,
  missionId,
  mission,
  startBusy,
  startError,
  onStart,
  onHome,
}: Readonly<{
  entry: ReturnType<typeof resolveChildStudyEntry>;
  grade: number;
  missionId: string | null;
  mission: ReturnType<typeof useStudyMission>;
  startBusy: boolean;
  startError: boolean;
  onStart: () => Promise<void>;
  onHome: () => void;
}>) {
  const intl = useIntl();
  if (entry.kind === "unavailable") {
    return <section className="child-study-state"><p>{intl.formatMessage({ id: "study.child.gradeHelp" })}</p><button type="button" onClick={onHome}>{intl.formatMessage({ id: "study.child.askGuardian" })}</button></section>;
  }
  if (!missionId && entry.kind === "start") {
    return (
      <section className="child-study-start">
        <span>{intl.formatMessage({ id: "study.child.gradeLabel" }, { grade })}</span>
        <h2>{intl.formatMessage({ id: "study.child.start.title" })}</h2>
        <p>{intl.formatMessage({ id: "study.child.start.description" })}</p>
        <button type="button" disabled={startBusy} aria-busy={startBusy} onClick={() => void onStart()}>{intl.formatMessage({ id: startBusy ? "study.child.start.starting" : "study.child.start.button" })}</button>
        {startError && <p role="alert">{intl.formatMessage({ id: "study.child.start.error" })}</p>}
      </section>
    );
  }
  if (mission.isPending || !mission.data) {
    return <p role="status">{intl.formatMessage({ id: "study.child.loadingMission" })}</p>;
  }
  return <StudyMissionPlayer key={mission.data.missionId} mission={mission.data} onHome={onHome} onForbidden={onHome} />;
}

export default ChildStudy;

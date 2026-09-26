import { useEffect, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { useNavigate } from "react-router";
import { StudyAccessGate } from "@/features/study/StudyAccessGate";
import {
  groupStudyConcepts,
  isSelectedGradeLoading,
  missionToAbandonBeforeSelection,
  resolveChildStudyLaunch,
  STUDY_GRADE_CHOICES,
  resolveChildStudyEntry,
  startInputForSelection,
  type StudyTopicSelection,
} from "@/features/study/childStudyModel";
import type { StudyConceptCatalogDto, StudyGrade } from "@/features/study/contracts";
import { StudyMissionPlayer } from "@/features/study/StudyMissionPlayer";
import { STUDY_TOPIC_COPY } from "@/features/study/studyTopicCopy";
import {
  useAbandonStudyMission,
  useStartStudyMission,
  useStudyConcepts,
  useStudyLearnerState,
  useStudyMission,
} from "@/queries/useStudy";
import { resolveQueryTruthState } from "@/transform/queryTruthState";
import "@/features/study/study-learning.css";
import "@/features/study/child-study.css";

export function ChildStudy() {
  const navigate = useNavigate();
  const learner = useStudyLearnerState();
  const start = useStartStudyMission();
  const abandon = useAbandonStudyMission();
  const [missionId, setMissionId] = useState<string | null>(null);
  const [choosingGrade, setChoosingGrade] = useState(false);
  const [catalogGrade, setCatalogGrade] = useState<StudyGrade | null>(null);
  const [startingTopic, setStartingTopic] = useState<string | null>(null);
  const mission = useStudyMission(missionId);
  const concepts = useStudyConcepts(catalogGrade);
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
    if (missionId || choosingGrade || catalogGrade !== null) return;
    const grade = learner.data?.profile.grade;
    if (grade && grade.source !== "learner_selected") setCatalogGrade(grade.grade);
  }, [catalogGrade, choosingGrade, learner.data?.profile.grade, missionId]);

  const goHome = () => navigate("/child/home");
  const startSelection = async (grade: StudyGrade, selection: StudyTopicSelection): Promise<void> => {
    const selectionInput = startInputForSelection(grade, selection);
    setStartingTopic(selection.kind === "concept" ? selection.conceptId : "adaptive");
    try {
      const created = await start.mutateAsync({
        mode: "daily",
        ...selectionInput,
        idempotencyKey: crypto.randomUUID(),
      });
      setChoosingGrade(false);
      setCatalogGrade(created.grade);
      setMissionId(created.missionId);
    } catch {
      // 동일 주제 카드에서 재시도할 수 있도록 mutation 상태를 유지한다.
    } finally {
      setStartingTopic(null);
    }
  };
  const leaveMission = async (next: "topics" | "grades"): Promise<void> => {
    const activeMissionId = missionToAbandonBeforeSelection({
      localMissionId: missionId,
      activeMissionId: learner.data?.activeMissionId,
      localMissionCompleted: mission.data?.status === "completed",
    });
    if (activeMissionId) {
      try {
        await abandon.mutateAsync({ missionId: activeMissionId, idempotencyKey: crypto.randomUUID() });
      } catch {
        return;
      }
    }
    start.reset();
    setMissionId(null);
    if (next === "grades") {
      setCatalogGrade(null);
      setChoosingGrade(true);
    } else if (mission.data?.grade) {
      setCatalogGrade(mission.data.grade);
      setChoosingGrade(false);
    } else if (!learner.data?.profile.grade || learner.data.profile.grade.source === "learner_selected") {
      setCatalogGrade(null);
      setChoosingGrade(true);
    } else {
      setCatalogGrade(learner.data.profile.grade.grade ?? catalogGrade);
      setChoosingGrade(false);
    }
  };
  return (
    <StudyAccessGate deniedPath="/child/home" onBack={goHome}>
      <div className="child-study-screen">
        <header className="child-study-header">
          <button type="button" className="child-study-back hy-press" onClick={goHome} aria-label={STUDY_TOPIC_COPY.back}><ChevronLeft aria-hidden="true" /></button>
          <div><h1>{STUDY_TOPIC_COPY.screenTitle}</h1><p>{STUDY_TOPIC_COPY.screenSubtitle}</p></div>
        </header>
        {childStudyQueryState === "loading" && learner.isLoading ? (
          <p role="status">{STUDY_TOPIC_COPY.learnerLoading}</p>
        ) : childStudyQueryState === "error" || !learner.data ? (
          <section className="child-study-state" role="alert"><p>{STUDY_TOPIC_COPY.learnerLoadError}</p><button type="button" onClick={() => void retryChildStudy()}>{STUDY_TOPIC_COPY.retry}</button></section>
        ) : (
          <ChildStudyContent
            entry={choosingGrade ? { kind: "select_grade" } : resolveChildStudyEntry(learner.data)}
            catalogGrade={catalogGrade}
            concepts={concepts}
            missionId={missionId}
            mission={mission}
            startBusy={start.isPending}
            startError={start.isError}
            startingTopic={startingTopic}
            onResume={setMissionId}
            onSelectGrade={(grade) => {
              start.reset();
              setCatalogGrade(grade);
              setChoosingGrade(true);
            }}
            onStart={startSelection}
            canChooseGrade={learner.data.profile.grade?.source === "learner_selected"}
            onChooseGrade={() => void leaveMission("grades")}
            onChooseTopic={() => void leaveMission("topics")}
            abandonBusy={abandon.isPending}
            abandonError={abandon.isError}
            onHome={goHome}
          />
        )}
      </div>
    </StudyAccessGate>
  );
}

function ChildStudyContent({
  entry,
  catalogGrade,
  concepts,
  missionId,
  mission,
  startBusy,
  startError,
  startingTopic,
  onResume,
  onSelectGrade,
  onStart,
  canChooseGrade,
  onChooseGrade,
  onChooseTopic,
  abandonBusy,
  abandonError,
  onHome,
}: Readonly<{
  entry: ReturnType<typeof resolveChildStudyEntry>;
  catalogGrade: StudyGrade | null;
  concepts: ReturnType<typeof useStudyConcepts>;
  missionId: string | null;
  mission: ReturnType<typeof useStudyMission>;
  startBusy: boolean;
  startError: boolean;
  startingTopic: string | null;
  onResume: (missionId: string) => void;
  onSelectGrade: (grade: StudyGrade) => void;
  onStart: (grade: StudyGrade, selection: StudyTopicSelection) => Promise<void>;
  canChooseGrade: boolean;
  onChooseGrade: () => void;
  onChooseTopic: () => void;
  abandonBusy: boolean;
  abandonError: boolean;
  onHome: () => void;
}>) {
  if (entry.kind === "unavailable") {
    return <section className="child-study-state"><p>{STUDY_TOPIC_COPY.learnerLoadError}</p><button type="button" onClick={onHome}>{STUDY_TOPIC_COPY.backHome}</button></section>;
  }
  const launch = resolveChildStudyLaunch(entry, missionId);
  if (launch.kind === "resume_choice") {
    return (
      <StudyResumeChoice
        busy={abandonBusy}
        error={abandonError}
        onResume={() => onResume(launch.missionId)}
        onChooseDifferent={onChooseTopic}
      />
    );
  }
  const needsGradeChoice = entry.kind === "select_grade";
  const selectedGradePending = catalogGrade !== null && concepts.isPending;
  if (launch.kind === "selection" && needsGradeChoice && (catalogGrade === null || selectedGradePending || concepts.isError)) {
    return (
      <section className="child-study-start">
        <h2>{STUDY_TOPIC_COPY.chooseGradeTitle}</h2>
        <p>{STUDY_TOPIC_COPY.chooseGradeHelp}</p>
        <div className="child-study-grade-options">
          {STUDY_GRADE_CHOICES.map((choice) => (
            <button
              key={choice}
              type="button"
              className={catalogGrade === choice ? "is-selected" : undefined}
              disabled={concepts.isFetching}
              aria-busy={isSelectedGradeLoading(choice, catalogGrade, concepts.isFetching)}
              onClick={() => onSelectGrade(choice)}
            >
              <span>{STUDY_TOPIC_COPY.gradeLabel(choice)}</span>
              {isSelectedGradeLoading(choice, catalogGrade, concepts.isFetching) && (
                <span className="child-study-grade-loader" aria-hidden="true" />
              )}
            </button>
          ))}
        </div>
        {concepts.isError && <p role="alert">{STUDY_TOPIC_COPY.gradeRetry}</p>}
      </section>
    );
  }
  if (launch.kind === "selection" && catalogGrade !== null && concepts.data) {
    return (
      <StudyTopicPicker
        grade={catalogGrade}
        catalog={concepts.data}
        startingTopic={startingTopic}
        startBusy={startBusy}
        startError={startError}
        canChooseGrade={canChooseGrade}
        onChooseGrade={onChooseGrade}
        onStart={onStart}
      />
    );
  }
  if (launch.kind === "selection" && (entry.kind === "start" || catalogGrade !== null)) {
    return <p role="status">{STUDY_TOPIC_COPY.topicLoading}</p>;
  }
  if (mission.isPending || !mission.data) {
    return <p role="status">{STUDY_TOPIC_COPY.missionLoading}</p>;
  }
  return (
    <StudyMissionPlayer
      key={mission.data.missionId}
      mission={mission.data}
      onContinue={() => onStart(mission.data.grade, mission.data.selection)}
      onChangeTopic={onChooseTopic}
      changeTopicBusy={abandonBusy}
      changeTopicError={abandonError}
      continueError={startError}
      onHome={onHome}
      onForbidden={onHome}
    />
  );
}

function StudyResumeChoice({
  busy,
  error,
  onResume,
  onChooseDifferent,
}: Readonly<{
  busy: boolean;
  error: boolean;
  onResume: () => void;
  onChooseDifferent: () => void;
}>) {
  return (
    <section className="child-study-resume" aria-labelledby="study-resume-title">
      <div>
        <h2 id="study-resume-title">{STUDY_TOPIC_COPY.resumeTitle}</h2>
        <p>{STUDY_TOPIC_COPY.resumeDescription}</p>
      </div>
      <div className="child-study-resume-actions">
        <button type="button" disabled={busy} aria-busy={busy} onClick={onResume}>{STUDY_TOPIC_COPY.resumeAction}</button>
        <button type="button" className="is-secondary" disabled={busy} aria-busy={busy} onClick={onChooseDifferent}>
          {STUDY_TOPIC_COPY.differentAction}
        </button>
      </div>
      {error && <p role="alert">{STUDY_TOPIC_COPY.abandonError}</p>}
    </section>
  );
}

function StudyTopicPicker({
  grade,
  catalog,
  startingTopic,
  startBusy,
  startError,
  canChooseGrade,
  onChooseGrade,
  onStart,
}: Readonly<{
  grade: StudyGrade;
  catalog: StudyConceptCatalogDto;
  startingTopic: string | null;
  startBusy: boolean;
  startError: boolean;
  canChooseGrade: boolean;
  onChooseGrade: () => void;
  onStart: (grade: StudyGrade, selection: StudyTopicSelection) => Promise<void>;
}>) {
  const groups = groupStudyConcepts(catalog.concepts);
  return (
    <section className="child-study-topics" aria-labelledby="study-topic-title">
      <div className="child-study-topic-heading">
        <span>{STUDY_TOPIC_COPY.gradeLabel(grade)}</span>
        <h2 id="study-topic-title">{STUDY_TOPIC_COPY.chooseTopicTitle}</h2>
        <p>{STUDY_TOPIC_COPY.chooseTopicHelp}</p>
      </div>
      <button
        type="button"
        className="child-study-adaptive-topic"
        disabled={startBusy}
        aria-busy={startBusy && startingTopic === "adaptive"}
        onClick={() => void onStart(grade, { kind: "adaptive" })}
      >
        <strong>{STUDY_TOPIC_COPY.adaptiveTitle}</strong>
        <span>{STUDY_TOPIC_COPY.adaptiveDescription}</span>
        {startBusy && startingTopic === "adaptive" && <span className="child-study-topic-loader" aria-hidden="true" />}
      </button>
      {groups.map((group) => (
        <section key={group.unitKey} className="child-study-topic-unit">
          <h3>{group.unitKey}</h3>
          <div className="child-study-topic-list">
            {group.concepts.map((concept) => (
              <button
                key={concept.conceptId}
                type="button"
                disabled={startBusy}
                aria-busy={startBusy && startingTopic === concept.conceptId}
                onClick={() => void onStart(grade, {
                  kind: "concept",
                  conceptId: concept.conceptId,
                  title: concept.title,
                })}
              >
                <strong>{concept.title}</strong>
                <span>{STUDY_TOPIC_COPY.conceptProblemCount(concept.problemCount)}</span>
                {startBusy && startingTopic === concept.conceptId && <span className="child-study-topic-loader" aria-hidden="true" />}
              </button>
            ))}
          </div>
        </section>
      ))}
      {canChooseGrade && <button type="button" className="child-study-change-grade" onClick={onChooseGrade}>{STUDY_TOPIC_COPY.changeGrade}</button>}
      {startError && <p role="alert">{STUDY_TOPIC_COPY.startError}</p>}
    </section>
  );
}

export default ChildStudy;

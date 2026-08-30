import { useEffect, useReducer, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { ApiError } from "@/lib/api/errors";
import { useSubmitStudyAnswer } from "@/queries/useStudy";
import type { StudyAttemptResultDto, StudyMissionDto, SubmitStudyAnswerCommand } from "./contracts";
import { isRetryableStudyFailure } from "./childStudyModel";
import { STUDY_TOPIC_COPY } from "./studyTopicCopy";
import { StudyProblemRenderer } from "./player/StudyProblemRenderer";
import { initialStudyAnswer } from "./player/StudyAnswerInput";
import { createStudyPlayerState, reduceStudyPlayer } from "./player/studyPlayerState";

type Props = Readonly<{
  mission: StudyMissionDto;
  onContinue: () => Promise<void>;
  onChangeTopic: () => void;
  changeTopicBusy: boolean;
  changeTopicError: boolean;
  continueError: boolean;
  onHome: () => void;
  onForbidden: () => void;
}>;

export function StudyMissionPlayer({
  mission,
  onContinue,
  onChangeTopic,
  changeTopicBusy,
  changeTopicError,
  continueError,
  onHome,
  onForbidden,
}: Props) {
  const intl = useIntl();
  const submit = useSubmitStudyAnswer();
  const [state, dispatch] = useReducer(reduceStudyPlayer, mission, createStudyPlayerState);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const inFlight = useRef(false);
  const continued = useRef(false);
  const item = state.problemId ? mission.items.find((candidate) => candidate.problemId === state.problemId) ?? null : null;

  useEffect(() => {
    if (state.phase !== "completed" || continued.current) return;
    continued.current = true;
    void onContinue();
  }, [onContinue, state.phase]);

  const execute = async (command: SubmitStudyAnswerCommand) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setErrorCode(null);
    try {
      const result = await submit.mutateAsync(command);
      dispatch({ type: "SUCCEEDED", result });
    } catch (error) {
      const retryable = isRetryableStudyFailure(error);
      dispatch({ type: "FAILED", retryable });
      const code = error instanceof ApiError ? error.code : retryable ? "study_transient_error" : "study_submit_error";
      setErrorCode(code);
      if (error instanceof ApiError && error.status === 403) onForbidden();
    } finally {
      inFlight.current = false;
    }
  };

  if (state.phase === "completed" || !item) {
    return (
      <section className="study-continuous-loading" role="status">
        <strong>{mission.selection.kind === "concept" ? mission.selection.title : STUDY_TOPIC_COPY.adaptiveTitle}</strong>
        <span>{STUDY_TOPIC_COPY.nextLoading}</span>
        <span className="study-continuous-loader" aria-hidden="true" />
        {continueError && <button type="button" onClick={() => void onContinue()}>{STUDY_TOPIC_COPY.retry}</button>}
      </section>
    );
  }

  const draft = state.draft ?? initialStudyAnswer(item);
  const result = state.phase === "revealed" ? state.result as StudyAttemptResultDto : null;
  const startSubmit = (answer: string) => {
    if (inFlight.current || state.phase !== "ready") return;
    const command: SubmitStudyAnswerCommand = {
      missionId: mission.missionId,
      problemId: item.problemId,
      answer,
      idempotencyKey: crypto.randomUUID(),
    };
    dispatch({ type: "SUBMIT", command });
    void execute(command);
  };
  const retry = () => {
    if (inFlight.current || state.phase !== "retryable" || !state.retryCommand) return;
    const command = state.retryCommand;
    dispatch({ type: "RETRY" });
    void execute(command);
  };

  return (
    <section className="study-mission-player">
      <div className="study-mission-context">
        <div>
          <strong>{mission.selection.kind === "concept" ? mission.selection.title : STUDY_TOPIC_COPY.adaptiveTitle}</strong>
          <span>{STUDY_TOPIC_COPY.continuous}</span>
        </div>
        <button type="button" disabled={changeTopicBusy} aria-busy={changeTopicBusy} onClick={onChangeTopic}>
          {STUDY_TOPIC_COPY.changeTopic}
        </button>
      </div>
      {changeTopicError && <p className="study-topic-change-error" role="alert">{STUDY_TOPIC_COPY.abandonError}</p>}
      <StudyProblemRenderer
        item={item}
        draft={draft}
        onDraftChange={(next) => dispatch({ type: "SET_DRAFT", draft: next })}
        onSubmit={startSubmit}
        disabled={state.phase === "submitting"}
        result={result}
        onTryAgain={() => dispatch({ type: "TRY_AGAIN" })}
        onNext={() => dispatch({ type: "NEXT" })}
      />
      {state.phase === "retryable" && (
        <div className="study-retry-panel" role="alert">
          <p>{intl.formatMessage({ id: "study.child.retry.sameAnswer" })}</p>
          <button type="button" disabled={submit.isPending} aria-busy={submit.isPending} onClick={retry}>{intl.formatMessage({ id: "study.unavailable.retry" })}</button>
        </div>
      )}
      {errorCode && state.phase !== "retryable" && (
        <div className="study-retry-panel" role="alert">
          <p>{intl.formatMessage({ id: errorCode === "study_submit_error" ? "study.child.error.content" : "study.child.error.session" })}</p>
          <button type="button" onClick={onHome}>{intl.formatMessage({ id: "study.child.complete.home" })}</button>
        </div>
      )}
    </section>
  );
}

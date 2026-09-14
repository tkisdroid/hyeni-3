import { useEffect, useRef } from "react";
import { useIntl } from "react-intl";
import type { StudyAttemptResultDto, StudyMissionItemDto } from "../contracts";
import { StudyAnswerInput } from "./StudyAnswerInput";
import { serializeStudyAnswer, type StudyAnswerDraft } from "./studyPlayerState";
import { StudyProblemVisual } from "./StudyProblemVisual";
import "./study-player.css";

type Props = Readonly<{
  item: StudyMissionItemDto;
  draft: StudyAnswerDraft;
  onDraftChange: (draft: StudyAnswerDraft) => void;
  onSubmit: (answer: string) => void;
  result?: StudyAttemptResultDto | null;
  onNext?: () => void;
  onTryAgain?: () => void;
  disabled?: boolean;
}>;

function ResultPanel({ result, onNext, onTryAgain }: Readonly<{
  result: StudyAttemptResultDto;
  onNext?: () => void;
  onTryAgain?: () => void;
}>) {
  const intl = useIntl();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const feedback = result.outcome.feedback;
  useEffect(() => headingRef.current?.focus(), [result.requestId]);
  const correct = result.outcome.isCorrect === true;
  const headingId = correct ? "study.result.correct" : "study.result.tryAgain";
  const detail = feedback.kind === "correct"
    ? feedback.shortReason
    : feedback.kind === "retry" || feedback.kind === "explanation_ready"
      ? feedback.feedback
      : intl.formatMessage({ id: "study.result.selfCheck" });
  return (
    <section className={correct ? "study-result is-correct" : "study-result is-review"} aria-live="polite">
      <h3 ref={headingRef} tabIndex={-1}><span aria-hidden="true">{correct ? "✓" : "!"}</span>{intl.formatMessage({ id: headingId })}</h3>
      <p>{detail}</p>
      <p>{result.outcome.encouragement}</p>
      {feedback.kind === "correct" && <p><strong>{intl.formatMessage({ id: "study.result.answer" })}</strong> {feedback.finalAnswer}</p>}
      {feedback.kind === "retry" && <p><strong>{intl.formatMessage({ id: "study.result.hint" })}</strong> {feedback.hint.text}</p>}
      {feedback.kind === "explanation_ready" && <ol>{feedback.explanation.steps.map((step) => <li key={step}>{step}</li>)}</ol>}
      {onNext && feedback.next === "continue" && <button type="button" className="study-submit" onClick={onNext}>{intl.formatMessage({ id: "study.result.next" })}</button>}
      {onTryAgain && feedback.next === "retry" && <button type="button" className="study-submit" onClick={onTryAgain}>{intl.formatMessage({ id: "study.result.retryAnswer" })}</button>}
    </section>
  );
}

export function StudyProblemRenderer({
  item,
  draft,
  onDraftChange,
  onSubmit,
  result = null,
  onNext,
  onTryAgain,
  disabled = false,
}: Props) {
  const intl = useIntl();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const answer = serializeStudyAnswer(draft);
  useEffect(() => {
    if (!result) headingRef.current?.focus();
  }, [item.problemId, result]);
  return (
    <article className="study-problem" data-problem-id={item.problemId}>
      <header className="study-problem-meta">
        <span>{item.domainLabel}</span>
        <span>{item.conceptTitle}</span>
      </header>
      <h2 ref={headingRef} tabIndex={-1}>{item.prompt}</h2>
      <p className="study-problem-objective">{intl.formatMessage({ id: "study.problem.objective" }, { objective: item.childObjective })}</p>
      <StudyProblemVisual item={item} />
      <StudyAnswerInput item={item} value={draft} onChange={onDraftChange} disabled={disabled || !!result} />
      {!result && (
        <button
          type="button"
          className="study-submit"
          disabled={disabled || answer === null}
          onClick={() => { if (answer !== null) onSubmit(answer); }}
        >
          {intl.formatMessage({ id: disabled ? "study.answer.submitting" : "study.answer.submit" })}
        </button>
      )}
      {result && <ResultPanel result={result} onNext={onNext} onTryAgain={onTryAgain} />}
    </article>
  );
}

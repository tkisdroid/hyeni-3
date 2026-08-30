import { useEffect, useRef } from "react";
import { useIntl } from "react-intl";
import type { StudyAttemptResultDto, StudyMissionItemDto } from "../contracts";
import { StudyAnswerInput } from "./StudyAnswerInput";
import { serializeStudyAnswer, type StudyAnswerDraft } from "./studyPlayerState";
import { BarModelVisual } from "./visuals/BarModelVisual";
import { FractionVisual } from "./visuals/FractionVisual";
import { GenericStudyVisual } from "./visuals/GenericStudyVisual";
import { NumberLineVisual } from "./visuals/NumberLineVisual";
import { supportsStudyVisual } from "./visuals/visualRegistry";
import "./study-player.css";

type Props = Readonly<{
  item: StudyMissionItemDto;
  draft: StudyAnswerDraft;
  onDraftChange: (draft: StudyAnswerDraft) => void;
  onSubmit: (answer: string) => void;
  result?: StudyAttemptResultDto | null;
  onNext?: () => void;
  disabled?: boolean;
}>;

function ProblemVisual({ item }: Readonly<{ item: StudyMissionItemDto }>) {
  const intl = useIntl();
  if (!item.visual) return null;
  if (!supportsStudyVisual(item.visual)) {
    return <p className="study-content-error" role="alert">{intl.formatMessage({ id: "study.problem.unsupportedVisual" })}</p>;
  }
  const ariaLabel = intl.formatMessage(
    { id: "study.problem.visualDescription" },
    { domain: item.domainLabel, concept: item.conceptTitle },
  );
  switch (item.visual.kind) {
    case "fraction_bar": return <FractionVisual visual={item.visual} ariaLabel={ariaLabel} />;
    case "number_line": return <NumberLineVisual visual={item.visual} ariaLabel={ariaLabel} />;
    case "line_diagram": return <BarModelVisual visual={item.visual} ariaLabel={ariaLabel} />;
    default: return <GenericStudyVisual visual={item.visual} ariaLabel={ariaLabel} />;
  }
}

function ResultPanel({ result, onNext }: Readonly<{ result: StudyAttemptResultDto; onNext?: () => void }>) {
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
      <ProblemVisual item={item} />
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
      {result && <ResultPanel result={result} onNext={onNext} />}
    </article>
  );
}

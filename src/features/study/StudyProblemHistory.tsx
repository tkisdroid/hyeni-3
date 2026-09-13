import { useIntl } from "react-intl";
import { useStudyProblemHistory } from "@/queries/useStudyLearning";
import type { HistoryRange, ProblemHistoryItemDto } from "./learningExtrasContracts";
import { studyAttemptAnswerText } from "./studyAttemptView";
import { StudyProblemVisual } from "./player/StudyProblemVisual";
import "./study-learning.css";

function Attempt({ item }: { item: ProblemHistoryItemDto }) {
  const intl = useIntl();
  const resultId = item.skipped ? "study.history.skipped"
    : item.answer?.kind === "self_check" ? "study.history.selfCheck"
      : !item.isScored || item.isCorrect === null ? "study.history.unscored"
        : item.isCorrect ? "study.history.correct" : "study.history.incorrect";
  const label = (id: string) => intl.formatMessage({ id });
  const answerText = studyAttemptAnswerText(item, {
    skipped: label("study.history.noSubmission"), missing: label("study.history.missingAnswer"),
    true: label("study.history.true"), false: label("study.history.false"),
  });
  return (
    <details className="study-attempt" data-attempt-id={item.id}>
      <summary>
        <span className="study-attempt__top"><time dateTime={item.studiedAt}>{intl.formatDate(item.studiedAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time><span className="study-attempt__result">{label(resultId)}</span></span>
        <strong>{item.problem?.prompt ?? label("study.history.missingProblem")}</strong>
        <span className="study-attempt__expand">{label("study.history.open")}</span>
      </summary>
      <div className="study-attempt__body">
        {item.detailsStatus === "details_unavailable" && <p className="study-learning-note">{label("study.history.detailsUnavailable")}</p>}
        {item.problem && <>
          <p className="study-learning-note">{item.problem.domainLabel} · {item.problem.conceptTitle}</p>
          <StudyProblemVisual item={item.problem} audience="parent" />
          {item.problem.choices && <ol className="study-history-choices">{item.problem.choices.map(option => <li key={option.id}>{option.text}</li>)}</ol>}
        </>}
        <dl className="study-answer-comparison">
          <div><dt>{label("study.history.childAnswer")}</dt><dd>{answerText}</dd></div>
          {item.explanation && <div><dt>{label(item.answer?.kind === "self_check" ? "study.history.exampleAnswer" : "study.history.answer")}</dt><dd>{item.explanation.answer}</dd></div>}
        </dl>
        <p className="study-learning-note">{intl.formatMessage({ id: "study.history.metadata" }, { seconds: item.responseTimeSeconds, hints: item.hintLevel })}{item.attemptOrdinal !== null && <> · {intl.formatMessage({ id: "study.history.ordinal" }, { count: item.attemptOrdinal })}</>}</p>
        {item.explanation && <section className="study-history-explanation">
          <h3>{label("study.history.explanation")}</h3><p>{item.explanation.concept}</p>
          <ol>{item.explanation.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>
          <p><strong>{label("study.history.commonMistake")}</strong> {item.explanation.commonMistake}</p>
          {item.explanation.alternative && <ol>{item.explanation.alternative.map((step, index) => <li key={index}>{step}</li>)}</ol>}
        </section>}
      </div>
    </details>
  );
}

export function StudyProblemHistory({ memberId, range }: { memberId: string; range: HistoryRange }) {
  const intl = useIntl();
  const history = useStudyProblemHistory(memberId, range);
  const items = history.data?.pages.flatMap(page => page.items) ?? [];
  return <section className="study-history-section" aria-labelledby="study-history-title">
    <header><h2 id="study-history-title">{intl.formatMessage({ id: "study.history.title" })}</h2><p>{intl.formatMessage({ id: "study.history.subtitle" })}</p></header>
    {history.isPending && <p role="status">{intl.formatMessage({ id: "study.history.loading" })}</p>}
    {history.isError && <div className="study-learning-state" role="alert"><p>{intl.formatMessage({ id: "study.history.error" })}</p><button type="button" onClick={() => void (history.isFetchNextPageError ? history.fetchNextPage() : history.refetch())}>{intl.formatMessage({ id: "study.unavailable.retry" })}</button></div>}
    {!history.isPending && !history.isError && items.length === 0 && <p>{intl.formatMessage({ id: "study.history.empty" })}</p>}
    <div className="study-attempt-list">{items.map(item => <Attempt key={item.id} item={item} />)}</div>
    {history.hasNextPage && !history.isError && <button className="study-learning-button is-secondary" type="button" disabled={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>
      {intl.formatMessage({ id: history.isFetchingNextPage ? "study.history.loading" : "study.history.more" })}
    </button>}
  </section>;
}

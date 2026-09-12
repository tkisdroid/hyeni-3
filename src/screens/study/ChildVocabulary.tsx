import { useEffect, useReducer, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { useNavigate } from "react-router";
import { BookOpen, Check, ChevronLeft, RotateCcw } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { useSaveVocabularyReview, useVocabularyDeck, useVocabularyOverview } from "@/queries/useStudyLearning";
import { StudyAccessGate } from "@/features/study/StudyAccessGate";
import { VOCABULARY_LEVEL_IDS, VocabularySources } from "@/features/study/VocabularyShared";
import { initialVocabularyLearningState, vocabularyLearningReducer, type VocabularyReviewCommand } from "@/features/study/vocabularyLearning";
import type { VocabularyLevel, VocabularyMode, VocabularyRating } from "@/features/study/learningExtrasContracts";
import "@/features/study/study-learning.css";

type Run = { level: VocabularyLevel; mode: VocabularyMode; id: string };

function VocabularyRun({ run, memberId, onBack }: { run: Run; memberId: string; onBack: () => void }) {
  const intl = useIntl();
  const deck = useVocabularyDeck(memberId, run.level, run.mode, run.id);
  const mutation = useSaveVocabularyReview(memberId);
  const [state, dispatch] = useReducer(vocabularyLearningReducer, initialVocabularyLearningState);
  const saving = useRef(false);
  const cardRef = useRef<HTMLButtonElement>(null);
  const cards = deck.data?.pages.flatMap(page => page.cards) ?? [];
  const card = cards[state.index];
  const catalogVersion = deck.data?.pages[0]?.catalogVersion;
  const label = (id: string) => intl.formatMessage({ id });

  useEffect(() => {
    if (deck.data && state.index >= cards.length && deck.hasNextPage && !deck.isFetchingNextPage && !deck.isError) {
      void deck.fetchNextPage();
    }
  }, [cards.length, deck.data, deck.hasNextPage, deck.isFetchingNextPage, deck.isError, deck.fetchNextPage, state.index]);
  useEffect(() => { cardRef.current?.focus(); }, [card?.id]);

  const persist = async (command: VocabularyReviewCommand) => {
    if (saving.current) return;
    saving.current = true;
    try {
      const receipt = await mutation.mutateAsync(command);
      dispatch({ type: "saved", requestId: receipt.requestId });
    } catch {
      dispatch({ type: "failed", requestId: command.requestId });
    } finally { saving.current = false; }
  };
  const rate = (rating: VocabularyRating) => {
    if (!card || !catalogVersion || !state.flipped || state.status !== "ready" || saving.current) return;
    const command: VocabularyReviewCommand = { catalogVersion, wordId: card.id, level: run.level, rating, requestId: crypto.randomUUID() };
    dispatch({ type: "submit", command });
    void persist(command);
  };
  const retry = () => {
    if (!state.pending || saving.current) return;
    dispatch({ type: "retry" });
    void persist(state.pending);
  };

  return <div className="vocabulary-screen vocabulary-run">
    <header className="study-learning-header">
      <button className="study-learning-back" type="button" disabled={state.status === "saving"} onClick={onBack} aria-label={label("study.vocabulary.chooseLevel")}><ChevronLeft aria-hidden="true" /></button>
      <div><h1>{label(VOCABULARY_LEVEL_IDS[run.level])}</h1><p>{intl.formatMessage({ id: "study.vocabulary.sessionCount" }, { count: state.index })}</p></div>
    </header>
    {deck.isPending || (!card && deck.isFetchingNextPage) ? <p role="status">{label("study.vocabulary.loading")}</p> : deck.isError ? (
      <div className="study-learning-state" role="alert"><p>{label("study.vocabulary.loadError")}</p><button type="button" onClick={() => void (deck.isFetchNextPageError ? deck.fetchNextPage() : deck.refetch())}>{label("study.unavailable.retry")}</button></div>
    ) : !card && !deck.hasNextPage ? (
      <section className="vocabulary-complete" role="status">
        <BookOpen aria-hidden="true" /><h2>{label(state.index > 0 ? "study.vocabulary.complete" : "study.vocabulary.noCards")}</h2>
        <p>{label(run.mode === "review" ? "study.vocabulary.reviewEmpty" : "study.vocabulary.nextLevelHint")}</p>
        <button className="study-learning-button" type="button" onClick={onBack}>{label("study.vocabulary.chooseLevel")}</button>
      </section>
    ) : card ? <>
      <button ref={cardRef} type="button" className={`vocabulary-card${state.flipped ? " is-flipped" : ""}`}
        onClick={() => dispatch({ type: "flip" })} disabled={state.status !== "ready"} aria-pressed={state.flipped}
        aria-describedby="vocabulary-flip-hint" data-word-id={card.id}>
        <span className="vocabulary-card__inner">
          <span className="vocabulary-card__face vocabulary-card__front" aria-hidden={state.flipped}>
            <span className="vocabulary-card__eyebrow">{intl.formatMessage({ id: "study.vocabulary.levelNumber" }, { level: run.level })}</span>
            <strong lang="en">{card.word}</strong><span>{label("study.vocabulary.flip")}</span>
          </span>
          <span className="vocabulary-card__face vocabulary-card__back" aria-hidden={!state.flipped}>
            <span lang="en" className="vocabulary-card__word">{card.word}</span><span className="vocabulary-card__pos">{card.partOfSpeech}</span>
            <strong>{card.meaning}</strong><span>{label("study.vocabulary.flipBack")}</span>
          </span>
        </span>
      </button>
      <p id="vocabulary-flip-hint" className="vocabulary-flip-hint">{label(state.flipped ? "study.vocabulary.rateHint" : "study.vocabulary.flipHint")}</p>
      <div className="vocabulary-rating-actions">
        <button type="button" disabled={!state.flipped || state.status !== "ready"} onClick={() => rate("again")}><RotateCcw aria-hidden="true" />{label("study.vocabulary.again")}</button>
        <button type="button" disabled={!state.flipped || state.status !== "ready"} onClick={() => rate("known")}><Check aria-hidden="true" />{label("study.vocabulary.known")}</button>
      </div>
      {state.status === "saving" && <p role="status">{label("study.vocabulary.saving")}</p>}
      {state.status === "failed" && <div className="study-learning-state" role="alert"><p>{label("study.vocabulary.saveError")}</p><button type="button" onClick={retry}>{label("study.vocabulary.retrySave")}</button></div>}
    </> : <p role="status">{label("study.vocabulary.loading")}</p>}
  </div>;
}

function VocabularyHome() {
  const intl = useIntl();
  const navigate = useNavigate();
  const overview = useVocabularyOverview();
  const [mode, setMode] = useState<VocabularyMode>("new");
  const [run, setRun] = useState<Run | null>(null);
  const label = (id: string) => intl.formatMessage({ id });
  if (run && overview.data) return <VocabularyRun key={run.id} run={run} memberId={overview.data.memberId} onBack={() => { setRun(null); void overview.refetch(); }} />;
  const total = overview.data?.levels.reduce((sum, level) => sum + level.total, 0) ?? 0;
  return <div className="vocabulary-screen">
    <header className="study-learning-header">
      <button type="button" className="study-learning-back" onClick={() => navigate("/miniapps")} aria-label={label("study.common.back")}><ChevronLeft aria-hidden="true" /></button>
      <div><h1>{label("study.vocabulary.title")}</h1><p>{label("study.vocabulary.subtitle")}</p></div>
    </header>
    {overview.isPending ? <p role="status">{label("study.vocabulary.loading")}</p> : overview.isError || !overview.data ? (
      <div className="study-learning-state" role="alert"><p>{label("study.vocabulary.loadError")}</p><button type="button" onClick={() => void overview.refetch()}>{label("study.unavailable.retry")}</button></div>
    ) : <>
      <section className="vocabulary-intro"><BookOpen aria-hidden="true" /><strong>{intl.formatMessage({ id: "study.vocabulary.total" }, { count: total })}</strong><p>{label("study.vocabulary.levelNote")}</p></section>
      <div className="vocabulary-modes" role="group" aria-label={label("study.vocabulary.mode")}>
        {(["new", "review", "all"] as const).map(value => <button type="button" key={value} aria-pressed={mode === value} onClick={() => setMode(value)}>
          {label(value === "new" ? "study.vocabulary.newMode" : value === "review" ? "study.vocabulary.reviewMode" : "study.vocabulary.allMode")}
        </button>)}
      </div>
      <div className="vocabulary-levels">
        {overview.data.levels.map(level => <button type="button" className="vocabulary-level" key={level.level}
          onClick={() => setRun({ level: level.level, mode, id: crypto.randomUUID() })}>
          <span className="vocabulary-level__number" aria-hidden="true">{level.level}</span>
          <span className="vocabulary-level__copy"><strong>{label(VOCABULARY_LEVEL_IDS[level.level])}</strong>
            <span>{intl.formatMessage({ id: "study.vocabulary.progress" }, { studied: level.studied, total: level.total })}</span>
            <progress value={level.studied} max={Math.max(1, level.total)} aria-label={label(VOCABULARY_LEVEL_IDS[level.level])} />
          </span>
          <span className="vocabulary-level__review">{intl.formatMessage({ id: "study.vocabulary.reviewCount" }, { count: level.again })}</span>
        </button>)}
      </div>
    </>}
    <VocabularySources />
  </div>;
}

export function ChildVocabulary() {
  const navigate = useNavigate();
  const { familyId, userId } = useAuth();
  return <StudyAccessGate deniedPath="/child/home" onBack={() => navigate("/miniapps")}>
    <VocabularyHome key={`${familyId}:${userId}`} />
  </StudyAccessGate>;
}
export default ChildVocabulary;

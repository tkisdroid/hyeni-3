import { useIntl } from "react-intl";
import { useNavigate, useSearchParams } from "react-router";
import { ChevronLeft } from "lucide-react";
import { useActiveChild } from "@/app/activeChild";
import { useChildVocabularyProgress } from "@/queries/useStudyLearning";
import { StudyAccessGate } from "@/features/study/StudyAccessGate";
import { resolveParentStudyTarget } from "@/features/study/parentStudyModel";
import { VOCABULARY_LEVEL_IDS, VocabularySources } from "@/features/study/VocabularyShared";
import "@/features/study/study-learning.css";

function VocabularyProgress({ memberId }: { memberId: string }) {
  const intl = useIntl();
  const query = useChildVocabularyProgress(memberId);
  const first = query.data?.pages[0];
  const reviews = query.data?.pages.flatMap(page => page.reviews) ?? [];
  const label = (id: string) => intl.formatMessage({ id });
  return <>
    {query.isPending && <p role="status">{label("study.vocabulary.parentLoading")}</p>}
    {query.isError && <div className="study-learning-state" role="alert"><p>{label("study.vocabulary.parentError")}</p><button type="button" onClick={() => void (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch())}>{label("study.unavailable.retry")}</button></div>}
    {first && <>
      <p className="vocabulary-self-report-note">{label("study.vocabulary.selfReportNote")}</p>
      <div className="vocabulary-parent-levels">{first.levels.map(level => <section key={level.level}>
        <h2>{label(VOCABULARY_LEVEL_IDS[level.level])}</h2>
        <p>{intl.formatMessage({ id: "study.vocabulary.parentProgress" }, { studied: level.studied, total: level.total, again: level.again })}</p>
        <progress value={level.studied} max={Math.max(level.total, 1)} aria-label={label(VOCABULARY_LEVEL_IDS[level.level])} />
      </section>)}</div>
      <section className="vocabulary-review-history"><h2>{label("study.vocabulary.historyTitle")}</h2>
        {!query.isError && reviews.length === 0 && <p>{label("study.vocabulary.parentEmpty")}</p>}
        {reviews.map(review => <article key={review.reviewId} className="vocabulary-review">
          <div><strong lang="en">{review.word}</strong><span>{label(review.rating === "known" ? "study.vocabulary.parentKnown" : "study.vocabulary.parentAgain")}</span></div>
          <p>{review.meaning}</p>
          <small>{label(VOCABULARY_LEVEL_IDS[review.level])} · <time dateTime={review.reviewedAt}>{intl.formatDate(review.reviewedAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time></small>
        </article>)}
        {query.hasNextPage && !query.isError && <button type="button" className="study-learning-button is-secondary" disabled={query.isFetchingNextPage} aria-busy={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>{label(query.isFetchingNextPage ? "study.vocabulary.parentLoading" : "study.history.more")}</button>}
      </section>
    </>}
  </>;
}

export function ParentVocabulary() {
  const intl = useIntl();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { selectedActiveChild, childMembers, familyLoading } = useActiveChild();
  const target = resolveParentStudyTarget(childMembers, selectedActiveChild?.id ?? null, params.get("member")?.trim() || null);
  const label = (id: string) => intl.formatMessage({ id });
  return <StudyAccessGate deniedPath="/parent/home" onBack={() => navigate("/miniapps")}>
    <div className="vocabulary-screen">
      <header className="study-learning-header"><button type="button" className="study-learning-back hy-press" onClick={() => navigate("/miniapps")} aria-label={label("study.common.back")}><ChevronLeft aria-hidden="true" /></button>
        <div><h1>{label("study.vocabulary.parentTitle")}</h1><p>{target.kind === "ready" ? target.child.name : label("study.vocabulary.parentSubtitle")}</p></div>
      </header>
      {familyLoading ? <p role="status">{label("study.parent.loadingFamily")}</p> : target.kind !== "ready" && childMembers.length === 0 ? (
        <div className="study-learning-state"><p>{label("study.parent.noChildTitle")}</p><button type="button" onClick={() => navigate("/child-invite?role=child")}>{label("study.parent.connectChild")}</button></div>
      ) : target.kind !== "ready" ? (
        <div className="study-learning-state"><p>{label("study.vocabulary.selectChildAtHome")}</p><button type="button" onClick={() => navigate("/parent/home")}>{label("study.vocabulary.parentHome")}</button></div>
      ) : <VocabularyProgress key={target.child.id} memberId={target.child.id} />}
      <VocabularySources />
    </div>
  </StudyAccessGate>;
}
export default ParentVocabulary;

import type { VocabularyReviewInput } from "./learningExtrasContracts";

export type VocabularyReviewCommand = Omit<VocabularyReviewInput, "memberId">;
export type VocabularyLearningState = Readonly<{
  index: number; flipped: boolean; status: "ready" | "saving" | "failed"; pending: VocabularyReviewCommand | null;
}>;
export const initialVocabularyLearningState: VocabularyLearningState = { index: 0, flipped: false, status: "ready", pending: null };
type Event =
  | { type: "flip" }
  | { type: "submit"; command: VocabularyReviewCommand }
  | { type: "retry" }
  | { type: "saved" | "failed"; requestId: string };

export function vocabularyLearningReducer(state: VocabularyLearningState, event: Event): VocabularyLearningState {
  switch (event.type) {
    case "flip": return state.status === "ready" ? { ...state, flipped: !state.flipped } : state;
    case "submit": return state.status === "ready" && state.flipped ? { ...state, status: "saving", pending: event.command } : state;
    case "retry": return state.status === "failed" && state.pending ? { ...state, status: "saving" } : state;
    case "failed": return state.status === "saving" && state.pending?.requestId === event.requestId ? { ...state, status: "failed" } : state;
    case "saved": return state.status === "saving" && state.pending?.requestId === event.requestId
      ? { index: state.index + 1, flipped: false, status: "ready", pending: null } : state;
  }
}

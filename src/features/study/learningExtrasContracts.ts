/** 부모 풀이 조회와 영단어 학습에 한정된 표시 계약이다. */
export type HistoryRange = "7d" | "30d" | "term";
export type StudyHistoryAnswer =
  | { kind: "single_choice" | "integer" | "decimal" | "text"; value: string }
  | { kind: "multiple_choice" | "ordering"; values: readonly string[] }
  | { kind: "fraction"; numerator: string; denominator: string }
  | { kind: "measurement"; value: string; unit: string }
  | { kind: "coordinate"; x: string; y: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "self_check"; selections: readonly string[] };
export type StudyHistoryProblem = Readonly<{
  id: string; prompt: string; type: string; conceptTitle: string; domainLabel: string; childObjective: string;
  gradeTarget: number; gradeBand: string; domain: string; conceptId: string; difficulty: number; difficultyBand: string; standardCode: string;
  choices?: readonly { id: string; text: string }[];
  input: Readonly<Record<string, unknown>>; visual?: Readonly<Record<string, unknown>>;
}>;
export type StudyHistoryExplanation = Readonly<{
  question: string; concept: string; steps: readonly string[]; answer: string; commonMistake: string; alternative?: readonly string[];
}>;
export type ChildProblemHistoryInput = Readonly<{ memberId: string; requestId: string; range: HistoryRange; cursor?: string }>;
export type ProblemHistoryItemDto = Readonly<{
  id: string; missionId: string; problemId: string; studiedAt: string; detailsStatus: "available" | "details_unavailable";
  problem: StudyHistoryProblem | null; answer: StudyHistoryAnswer | null; explanation: StudyHistoryExplanation | null;
  isCorrect: boolean | null; skipped: boolean; isScored: boolean;
  hintLevel: number; responseTimeSeconds: number; attemptOrdinal: number | null;
}>;
export type ChildProblemHistoryDto = Readonly<{
  apiVersion: "2026-08-27"; memberId: string; range: HistoryRange;
  items: readonly ProblemHistoryItemDto[]; nextCursor: string | null;
}>;
export type VocabularyLevel = 1 | 2 | 3 | 4 | 5;
export type VocabularyRating = "known" | "again";
export type VocabularyMode = "new" | "review" | "all";
export type VocabularyWordDto = Readonly<{
  id: string; word: string; meaning: string; partOfSpeech: string; level: VocabularyLevel; sourceUrl: string;
}>;
export type VocabularyLevelProgressDto = Readonly<{
  level: VocabularyLevel; total: number; studied: number; known: number; again: number;
}>;
export type VocabularyDeckInput = Readonly<{
  memberId: string; requestId: string; level?: VocabularyLevel; mode?: VocabularyMode; cursor?: string;
}>;
export type VocabularyDeckDto = Readonly<{
  apiVersion: "2026-08-27"; catalogVersion: string; memberId: string;
  levels: readonly VocabularyLevelProgressDto[]; level: VocabularyLevel | null; mode: VocabularyMode;
  cards: readonly (VocabularyWordDto & { lastRating: VocabularyRating | null })[]; nextCursor: string | null;
}>;
export type VocabularyReviewInput = Readonly<{
  memberId: string; requestId: string; catalogVersion: string; wordId: string; level: VocabularyLevel; rating: VocabularyRating;
}>;
export type VocabularyReviewDto = Readonly<{
  apiVersion: "2026-08-27"; memberId: string; requestId: string;
  wordId: string; level: VocabularyLevel; rating: VocabularyRating; reviewedAt: string;
}>;
export type ChildVocabularyProgressInput = Readonly<{ memberId: string; requestId: string; cursor?: string }>;
export type ChildVocabularyProgressDto = Readonly<{
  apiVersion: "2026-08-27"; catalogVersion: string; memberId: string; levels: readonly VocabularyLevelProgressDto[];
  lastStudiedAt: string | null;
  reviews: readonly (VocabularyWordDto & { reviewId: string; rating: VocabularyRating; reviewedAt: string })[];
  nextCursor: string | null;
}>;

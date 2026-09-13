import { apiGet, apiRequest } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import type {
  ChildProblemHistoryDto, ChildVocabularyProgressDto, HistoryRange, ProblemHistoryItemDto,
  StudyHistoryAnswer, StudyHistoryExplanation, StudyHistoryProblem, VocabularyDeckDto,
  VocabularyLevel, VocabularyLevelProgressDto, VocabularyMode, VocabularyRating, VocabularyReviewDto, VocabularyWordDto,
} from "@/features/study/learningExtrasContracts";
import type { VocabularyReviewCommand } from "@/features/study/vocabularyLearning";

const VERSION = "2026-08-27" as const;
function invalid(): never { throw new ApiError("invalid_study_response", 502); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): void {
  if (required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) invalid();
}
function text(value: unknown, max = 4000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) invalid();
  return value;
}
function id(value: unknown): string {
  const result = text(value, 160);
  if (!/^[A-Za-z0-9._:-]+$/u.test(result)) invalid();
  return result;
}
function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) invalid();
  return value as number;
}
function bool(value: unknown): boolean { if (typeof value !== "boolean") invalid(); return value; }
function choice<T extends string>(value: unknown, values: readonly T[]): T {
  if (typeof value !== "string" || !values.includes(value as T)) invalid();
  return value as T;
}
function timestamp(value: unknown): string {
  const result = text(value, 80);
  if (!Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result) invalid();
  return result;
}
function array(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) invalid();
  return value;
}
function strings(value: unknown, max = 64): string[] { return array(value, max).map(item => text(item, 2000)); }
function level(value: unknown): VocabularyLevel { return integer(value, 1, 5) as VocabularyLevel; }
function rating(value: unknown): VocabularyRating { return choice(value, ["known", "again"]); }
function cursor(value: unknown): string | null { return value === null ? null : text(value, 2048); }
function envelope(value: unknown, required: readonly string[]) {
  const result = object(value);
  exact(result, ["apiVersion", "memberId", ...required]);
  if (result.apiVersion !== VERSION) invalid();
  id(result.memberId);
  return result;
}
function safeJson(value: unknown, depth = 0, count = { value: 0 }): void {
  if (++count.value > 2000 || depth > 10) invalid();
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") { if (value.length > 4000) invalid(); return; }
  if (typeof value === "number") { if (!Number.isFinite(value)) invalid(); return; }
  if (Array.isArray(value)) { if (value.length > 512) invalid(); value.forEach(item => safeJson(item, depth + 1, count)); return; }
  const row = object(value);
  if (Object.keys(row).length > 64 || Object.keys(row).some(key => ["answer", "answerSpec", "canonicalAnswer", "solution"].includes(key))) invalid();
  Object.values(row).forEach(item => safeJson(item, depth + 1, count));
}
function problem(value: unknown): StudyHistoryProblem {
  const row = object(value);
  exact(row, ["id", "prompt", "type", "conceptTitle", "domainLabel", "childObjective", "gradeTarget", "gradeBand", "domain",
    "conceptId", "difficulty", "difficultyBand", "standardCode", "input"], ["choices", "visual"]);
  const input = object(row.input);
  safeJson(input);
  if (row.type !== input.kind) invalid();
  if (row.visual !== undefined) safeJson(row.visual);
  const choices = row.choices === undefined ? undefined : array(row.choices, 12).map(value => {
    const option = object(value); exact(option, ["id", "text"]); return { id: text(option.id, 120), text: text(option.text, 1000) };
  });
  return { id: id(row.id), prompt: text(row.prompt), type: text(row.type, 40), conceptTitle: text(row.conceptTitle, 240),
    domainLabel: text(row.domainLabel, 40), childObjective: text(row.childObjective, 1000), gradeTarget: integer(row.gradeTarget, 3, 6),
    gradeBand: text(row.gradeBand, 10), domain: text(row.domain, 100), conceptId: id(row.conceptId),
    difficulty: integer(row.difficulty, 1, 5), difficultyBand: text(row.difficultyBand, 30), standardCode: text(row.standardCode, 40),
    input, ...(choices === undefined ? {} : { choices }), ...(row.visual === undefined ? {} : { visual: object(row.visual) }) };
}
function answer(value: unknown): StudyHistoryAnswer {
  const row = object(value);
  switch (row.kind) {
    case "single_choice": case "integer": case "decimal": case "text":
      exact(row, ["kind", "value"]); return { kind: row.kind, value: text(row.value, 2000) };
    case "multiple_choice": case "ordering":
      exact(row, ["kind", "values"]); return { kind: row.kind, values: strings(row.values) };
    case "fraction":
      exact(row, ["kind", "numerator", "denominator"]); return { kind: "fraction", numerator: text(row.numerator, 160), denominator: text(row.denominator, 160) };
    case "measurement":
      exact(row, ["kind", "value", "unit"]); return { kind: "measurement", value: text(row.value, 160), unit: text(row.unit, 24) };
    case "coordinate":
      exact(row, ["kind", "x", "y"]); return { kind: "coordinate", x: text(row.x, 160), y: text(row.y, 160) };
    case "boolean":
      exact(row, ["kind", "value"]); return { kind: "boolean", value: bool(row.value) };
    case "self_check":
      exact(row, ["kind", "selections"]); return { kind: "self_check", selections: strings(row.selections, 16) };
    default: return invalid();
  }
}
function explanation(value: unknown): StudyHistoryExplanation {
  const row = object(value);
  exact(row, ["question", "concept", "steps", "answer", "commonMistake"], ["alternative"]);
  return { question: text(row.question), concept: text(row.concept), steps: strings(row.steps, 24),
    answer: text(row.answer), commonMistake: text(row.commonMistake),
    ...(row.alternative === undefined ? {} : { alternative: strings(row.alternative, 12) }) };
}
function attempt(value: unknown): ProblemHistoryItemDto {
  const row = object(value);
  exact(row, ["id", "missionId", "problemId", "studiedAt", "detailsStatus", "problem", "answer", "explanation",
    "isCorrect", "skipped", "isScored", "hintLevel", "responseTimeSeconds", "attemptOrdinal"]);
  const result: ProblemHistoryItemDto = {
    id: id(row.id), missionId: id(row.missionId), problemId: id(row.problemId), studiedAt: timestamp(row.studiedAt),
    detailsStatus: choice(row.detailsStatus, ["available", "details_unavailable"]),
    problem: row.problem === null ? null : problem(row.problem), answer: row.answer === null ? null : answer(row.answer),
    explanation: row.explanation === null ? null : explanation(row.explanation), isCorrect: row.isCorrect === null ? null : bool(row.isCorrect),
    skipped: bool(row.skipped), isScored: bool(row.isScored), hintLevel: integer(row.hintLevel, 0, 2),
    responseTimeSeconds: integer(row.responseTimeSeconds), attemptOrdinal: row.attemptOrdinal === null ? null : integer(row.attemptOrdinal, 1),
  };
  if (result.detailsStatus === "available" && (!result.problem || !result.explanation || (!result.skipped && !result.answer))) invalid();
  if (result.problem && result.problem.id !== result.problemId) invalid();
  return result;
}
function word(value: Record<string, unknown>): VocabularyWordDto {
  const sourceUrl = text(value.sourceUrl, 1000);
  if (!sourceUrl.startsWith("https://ko.wiktionary.org/wiki/")) invalid();
  return { id: id(value.id), word: text(value.word, 100), meaning: text(value.meaning, 2000),
    partOfSpeech: text(value.partOfSpeech, 160), level: level(value.level), sourceUrl };
}
const WORD_KEYS = ["id", "word", "meaning", "partOfSpeech", "level", "sourceUrl"];
function progress(value: unknown): VocabularyLevelProgressDto[] {
  const result = array(value, 5).map(value => {
    const row = object(value); exact(row, ["level", "total", "studied", "known", "again"]);
    const item = { level: level(row.level), total: integer(row.total), studied: integer(row.studied), known: integer(row.known), again: integer(row.again) };
    if (item.studied !== item.known + item.again || item.studied > item.total) invalid();
    return item;
  });
  if (result.length !== 5 || result.some((item, index) => item.level !== index + 1)) invalid();
  return result;
}
export function parseChildProblemHistory(value: unknown): ChildProblemHistoryDto {
  const row = envelope(value, ["range", "items", "nextCursor"]);
  return { apiVersion: VERSION, memberId: id(row.memberId), range: choice(row.range, ["7d", "30d", "term"]),
    items: array(row.items, 20).map(attempt), nextCursor: cursor(row.nextCursor) };
}
export function parseVocabularyDeck(value: unknown): VocabularyDeckDto {
  const row = envelope(value, ["catalogVersion", "levels", "level", "mode", "cards", "nextCursor"]);
  const result: VocabularyDeckDto = { apiVersion: VERSION, catalogVersion: id(row.catalogVersion), memberId: id(row.memberId),
    levels: progress(row.levels), level: row.level === null ? null : level(row.level), mode: choice(row.mode, ["new", "review", "all"]),
    cards: array(row.cards, 40).map(value => {
      const card = object(value); exact(card, [...WORD_KEYS, "lastRating"]);
      return { ...word(card), lastRating: card.lastRating === null ? null : rating(card.lastRating) };
    }), nextCursor: cursor(row.nextCursor) };
  if (result.cards.some(card => card.level !== result.level) || new Set(result.cards.map(card => card.id)).size !== result.cards.length) invalid();
  return result;
}
export function parseChildVocabularyProgress(value: unknown): ChildVocabularyProgressDto {
  const row = envelope(value, ["catalogVersion", "levels", "lastStudiedAt", "reviews", "nextCursor"]);
  return { apiVersion: VERSION, catalogVersion: id(row.catalogVersion), memberId: id(row.memberId),
    levels: progress(row.levels), lastStudiedAt: row.lastStudiedAt === null ? null : timestamp(row.lastStudiedAt),
    reviews: array(row.reviews, 20).map(value => {
      const review = object(value); exact(review, [...WORD_KEYS, "reviewId", "rating", "reviewedAt"]);
      return { ...word(review), reviewId: id(review.reviewId), rating: rating(review.rating), reviewedAt: timestamp(review.reviewedAt) };
    }), nextCursor: cursor(row.nextCursor) };
}
function parseReview(value: unknown): VocabularyReviewDto {
  const row = envelope(value, ["requestId", "wordId", "level", "rating", "reviewedAt"]);
  return { apiVersion: VERSION, memberId: id(row.memberId), requestId: id(row.requestId), wordId: id(row.wordId),
    level: level(row.level), rating: rating(row.rating), reviewedAt: timestamp(row.reviewedAt) };
}
function query(values: Record<string, string | number | null | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== null && value !== undefined) params.set(key, String(value));
  return params.size ? `?${params}` : "";
}
export async function fetchChildProblemHistory(memberId: string, range: HistoryRange, next?: string | null): Promise<ChildProblemHistoryDto> {
  const value = parseChildProblemHistory(await apiGet<unknown>(`/api/study/children/${encodeURIComponent(id(memberId))}/history${query({ range, cursor: next })}`));
  if (value.memberId !== memberId || value.range !== range) invalid();
  return value;
}
export async function fetchVocabularyDeck(selectedLevel: VocabularyLevel | null, mode: VocabularyMode, next?: string | null, memberId?: string | null): Promise<VocabularyDeckDto> {
  const value = parseVocabularyDeck(await apiGet<unknown>(`/api/study/learner/vocabulary${query({ level: selectedLevel, mode, cursor: next })}`));
  if ((memberId && value.memberId !== memberId) || value.level !== selectedLevel || value.mode !== mode) invalid();
  return value;
}
export async function fetchChildVocabularyProgress(memberId: string, next?: string | null): Promise<ChildVocabularyProgressDto> {
  const value = parseChildVocabularyProgress(await apiGet<unknown>(`/api/study/children/${encodeURIComponent(id(memberId))}/vocabulary${query({ cursor: next })}`));
  if (value.memberId !== memberId) invalid();
  return value;
}
export async function saveVocabularyReview(command: VocabularyReviewCommand, memberId: string): Promise<VocabularyReviewDto> {
  const value = parseReview(await apiRequest<unknown>("/api/study/learner/vocabulary/reviews", {
    method: "POST", headers: { "Idempotency-Key": id(command.requestId) },
    body: JSON.stringify({ catalogVersion: id(command.catalogVersion), wordId: id(command.wordId), level: level(command.level), rating: rating(command.rating) }),
  }));
  if (value.memberId !== memberId || value.requestId !== command.requestId || value.wordId !== command.wordId
    || value.rating !== command.rating || value.level !== command.level) invalid();
  return value;
}

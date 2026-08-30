import { apiGet, apiRequest } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import {
  STUDY_API_VERSION,
  type StudyAttemptResultDto,
  type StudyChildOverviewDto,
  type StudyChildrenOverviewDto,
  type StudyGrade,
  type StudyGradeMutationResult,
  type StudyLearnerStateDto,
  type StudyMissionDto,
  type StudyMissionItemDto,
  type StudyMissionMode,
  type StudyProblemInput,
  type StudyProblemType,
  type StudyRange,
  type StudyReportDto,
  type StudyResolvedGrade,
  type StudySubmissionFeedback,
  type SubmitStudyAnswerCommand,
  type UpdateStudyGradeCommand,
} from "@/features/study/contracts";

export { fetchStudyStatus, parseStudyStatus } from "./studyStatus";

const GRADES = new Set([3, 4, 5, 6]);
const RANGES = new Set(["7d", "30d", "term"]);
const MODES = new Set(["daily", "review", "focus"]);
const MISSION_STATUSES = new Set(["ready", "started", "completed"]);
const TYPES = new Set([
  "single_choice", "multiple_choice", "integer_input", "decimal_input", "fraction_input",
  "measurement_input", "ordering", "coordinate_input", "true_false", "text_input", "self_check",
]);
const BANDS = new Set(["foundation", "standard", "challenge"]);
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/u;
const MAX_ID_LENGTH = 128;

function invalid(): never {
  throw new ApiError("invalid_study_response", 502);
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): void {
  const allowed = new Set([...required, ...optional]);
  if (Object.keys(value).some((key) => !allowed.has(key))) invalid();
  if (required.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) invalid();
}

function string(value: unknown, maximum = 4_000): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) invalid();
  return value;
}

function bool(value: unknown): boolean {
  if (typeof value !== "boolean") invalid();
  return value;
}

function integer(value: unknown, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) invalid();
  return value as number;
}

function percentage(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) invalid();
  return value;
}

function id(value: unknown): string {
  return string(value, MAX_ID_LENGTH);
}

function version(value: unknown): void {
  if (value !== STUDY_API_VERSION) invalid();
}

function grade(value: unknown): StudyGrade {
  if (typeof value !== "number" || !GRADES.has(value)) invalid();
  return value as StudyGrade;
}

function timestamp(value: unknown): string {
  const parsed = string(value, 80);
  if (!Number.isFinite(Date.parse(parsed))) invalid();
  return parsed;
}

function resolvedGrade(value: unknown): StudyResolvedGrade {
  const record = object(value);
  exact(record, ["grade", "source", "academicYear"]);
  if (record.source !== "hyeni_birth_year" && record.source !== "parent_override") invalid();
  return {
    grade: grade(record.grade),
    source: record.source,
    academicYear: integer(record.academicYear, 2_000, 3_000),
  };
}

function boundedJson(value: unknown, depth = 0, budget = { nodes: 0 }): void {
  budget.nodes += 1;
  if (budget.nodes > 2_000 || depth > 10) invalid();
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    if (value.length > 4_000) invalid();
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalid();
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 512) invalid();
    for (const entry of value) boundedJson(entry, depth + 1, budget);
    return;
  }
  const record = object(value);
  const keys = Object.keys(record);
  if (keys.length > 64 || keys.some((key) => ["answer", "answerSpec", "canonicalAnswer", "solution"].includes(key))) invalid();
  for (const entry of Object.values(record)) boundedJson(entry, depth + 1, budget);
}

function problemInput(value: unknown, expectedType: StudyProblemType): StudyProblemInput {
  const record = object(value);
  boundedJson(record);
  if (record.kind !== expectedType) invalid();
  if (expectedType === "measurement_input") {
    exact(record, ["kind", "units"]);
    if (!Array.isArray(record.units) || record.units.length < 1 || record.units.length > 16) invalid();
    record.units.forEach((unit) => string(unit, 24));
  } else if (expectedType === "ordering") {
    exact(record, ["kind", "itemCount", "items"]);
    const itemCount = integer(record.itemCount, 2, 64);
    if (!Array.isArray(record.items) || record.items.length !== itemCount) invalid();
    const items = record.items.map((item) => string(item, 240));
    if (new Set(items).size !== items.length) invalid();
  } else if (expectedType === "self_check") {
    exact(record, ["kind", "items"]);
    if (!Array.isArray(record.items) || record.items.length < 1 || record.items.length > 16) invalid();
    record.items.forEach((entry) => {
      const item = object(entry);
      exact(item, ["id", "text"]);
      id(item.id);
      string(item.text, 240);
    });
  } else {
    exact(record, ["kind"]);
  }
  return record as StudyProblemInput;
}

function missionItem(value: unknown): StudyMissionItemDto {
  const record = object(value);
  exact(record, [
    "problemId", "position", "prompt", "childObjective", "domainLabel", "conceptTitle",
    "difficulty", "difficultyBand", "type", "input", "opened", "resolved", "revealedHints",
    "nextHintLevel", "allowedActions",
  ], ["choices", "visual"]);
  if (typeof record.type !== "string" || !TYPES.has(record.type)) invalid();
  if (typeof record.difficultyBand !== "string" || !BANDS.has(record.difficultyBand)) invalid();
  const type = record.type as StudyProblemType;
  let choices: readonly Readonly<{ id: string; text: string }>[] | undefined;
  if (record.choices !== undefined) {
    if (!Array.isArray(record.choices) || record.choices.length < 2 || record.choices.length > 12) invalid();
    choices = record.choices.map((entry) => {
      const choice = object(entry);
      exact(choice, ["id", "text"]);
      return { id: id(choice.id), text: string(choice.text, 1_000) };
    });
  }
  const choiceType = type === "single_choice" || type === "multiple_choice";
  if (choiceType !== (choices !== undefined)) invalid();
  let visual: StudyMissionItemDto["visual"];
  if (record.visual !== undefined) {
    boundedJson(record.visual);
    const visualRecord = object(record.visual);
    string(visualRecord.kind, 80);
    visual = visualRecord as StudyMissionItemDto["visual"];
  }
  if (!Array.isArray(record.revealedHints) || record.revealedHints.length > 2) invalid();
  const revealedHints = record.revealedHints.map((entry) => {
    const hint = object(entry);
    exact(hint, ["level", "text"], ["representation"]);
    const level = integer(hint.level, 1, 2) as 1 | 2;
    return {
      level,
      text: string(hint.text, 2_000),
      ...(hint.representation === undefined ? {} : { representation: string(hint.representation, 1_000) }),
    };
  });
  if (record.nextHintLevel !== null && record.nextHintLevel !== 1 && record.nextHintLevel !== 2) invalid();
  const actions = object(record.allowedActions);
  exact(actions, ["canSubmit", "canRequestHint", "canRequestExplanation", "canSkip"]);
  return {
    problemId: id(record.problemId),
    position: integer(record.position, 0, 11),
    prompt: string(record.prompt),
    childObjective: string(record.childObjective, 1_000),
    domainLabel: string(record.domainLabel, 40),
    conceptTitle: string(record.conceptTitle, 240),
    difficulty: integer(record.difficulty, 1, 5),
    difficultyBand: record.difficultyBand as StudyMissionItemDto["difficultyBand"],
    type,
    ...(choices === undefined ? {} : { choices }),
    input: problemInput(record.input, type),
    ...(visual === undefined ? {} : { visual }),
    opened: bool(record.opened),
    resolved: bool(record.resolved),
    revealedHints,
    nextHintLevel: record.nextHintLevel as 1 | 2 | null,
    allowedActions: {
      canSubmit: bool(actions.canSubmit),
      canRequestHint: bool(actions.canRequestHint),
      canRequestExplanation: bool(actions.canRequestExplanation),
      canSkip: bool(actions.canSkip),
    },
  };
}

function childOverview(value: unknown): StudyChildOverviewDto {
  const record = object(value);
  exact(record, [
    "memberId", "state", "grade", "hasStudyData", "todayProblemCount", "completedToday", "lastStudiedAt",
  ]);
  if (record.state !== "ready" && record.state !== "grade_unavailable") invalid();
  return {
    memberId: id(record.memberId),
    state: record.state,
    grade: record.grade === null ? null : resolvedGrade(record.grade),
    hasStudyData: bool(record.hasStudyData),
    todayProblemCount: integer(record.todayProblemCount, 0, 100_000),
    completedToday: bool(record.completedToday),
    lastStudiedAt: record.lastStudiedAt === null ? null : timestamp(record.lastStudiedAt),
  };
}

function feedback(value: unknown): StudySubmissionFeedback {
  const record = object(value);
  switch (record.kind) {
    case "correct":
      exact(record, ["kind", "shortReason", "finalAnswer", "next"]);
      if (record.next !== "continue") invalid();
      return { kind: "correct", shortReason: string(record.shortReason, 2_000), finalAnswer: string(record.finalAnswer, 2_000), next: "continue" };
    case "retry": {
      exact(record, ["kind", "feedback", "hint", "next"]);
      if (record.next !== "retry") invalid();
      const hint = object(record.hint);
      exact(hint, ["level", "text"], ["representation"]);
      return {
        kind: "retry",
        feedback: string(record.feedback, 2_000),
        hint: {
          level: integer(hint.level, 1, 2) as 1 | 2,
          text: string(hint.text, 2_000),
          ...(hint.representation === undefined ? {} : { representation: string(hint.representation, 1_000) }),
        },
        next: "retry",
      };
    }
    case "explanation_ready": {
      exact(record, ["kind", "feedback", "explanation", "next"]);
      if (record.next !== "continue") invalid();
      const explanation = object(record.explanation);
      exact(explanation, ["question", "concept", "steps", "answer", "commonMistake"], ["alternative"]);
      if (!Array.isArray(explanation.steps) || explanation.steps.length < 1 || explanation.steps.length > 24) invalid();
      if (explanation.alternative !== undefined && (!Array.isArray(explanation.alternative) || explanation.alternative.length > 12)) invalid();
      return {
        kind: "explanation_ready",
        feedback: string(record.feedback, 2_000),
        explanation: {
          question: string(explanation.question, 2_000),
          concept: string(explanation.concept, 2_000),
          steps: explanation.steps.map((step) => string(step, 2_000)),
          answer: string(explanation.answer, 2_000),
          commonMistake: string(explanation.commonMistake, 2_000),
          ...(explanation.alternative === undefined
            ? {}
            : { alternative: explanation.alternative.map((item) => string(item, 2_000)) }),
        },
        next: "continue",
      };
    }
    case "self_check": {
      exact(record, ["kind", "rubric", "next"]);
      if (record.next !== "continue" || !Array.isArray(record.rubric) || record.rubric.length < 1 || record.rubric.length > 16) invalid();
      return {
        kind: "self_check",
        rubric: record.rubric.map((entry) => {
          const item = object(entry);
          exact(item, ["id", "text"]);
          return { id: id(item.id), text: string(item.text, 2_000) };
        }),
        next: "continue",
      };
    }
    default:
      invalid();
  }
}

export function parseStudyChildren(value: unknown): StudyChildrenOverviewDto {
  const record = object(value);
  exact(record, ["apiVersion", "children"]);
  version(record.apiVersion);
  if (!Array.isArray(record.children) || record.children.length > 32) invalid();
  return { apiVersion: STUDY_API_VERSION, children: record.children.map(childOverview) };
}

export function parseStudyReport(value: unknown): StudyReportDto {
  const record = object(value);
  exact(record, [
    "apiVersion", "memberId", "state", "grade", "hasStudyData", "todayProblemCount", "completedToday",
    "lastStudiedAt", "range", "accuracy", "conceptMastery", "reviewDueCount", "recentSessions",
  ]);
  version(record.apiVersion);
  if (typeof record.range !== "string" || !RANGES.has(record.range)) invalid();
  if (!Array.isArray(record.conceptMastery) || record.conceptMastery.length > 512) invalid();
  if (!Array.isArray(record.recentSessions) || record.recentSessions.length > 512) invalid();
  const base = childOverview({
    memberId: record.memberId,
    state: record.state,
    grade: record.grade,
    hasStudyData: record.hasStudyData,
    todayProblemCount: record.todayProblemCount,
    completedToday: record.completedToday,
    lastStudiedAt: record.lastStudiedAt,
  });
  return {
    apiVersion: STUDY_API_VERSION,
    ...base,
    range: record.range as StudyRange,
    accuracy: percentage(record.accuracy),
    conceptMastery: record.conceptMastery.map((entry) => {
      const mastery = object(entry);
      exact(mastery, ["conceptId", "label", "mastery"]);
      return { conceptId: id(mastery.conceptId), label: string(mastery.label, 240), mastery: percentage(mastery.mastery) ?? invalid() };
    }),
    reviewDueCount: integer(record.reviewDueCount, 0, 100_000),
    recentSessions: record.recentSessions.map((entry) => {
      const session = object(entry);
      exact(session, ["sessionId", "startedAt", "problemCount", "accuracy"]);
      return {
        sessionId: id(session.sessionId),
        startedAt: timestamp(session.startedAt),
        problemCount: integer(session.problemCount, 0, 100_000),
        accuracy: percentage(session.accuracy),
      };
    }),
  };
}

export function parseStudyLearnerState(value: unknown): StudyLearnerStateDto {
  const record = object(value);
  exact(record, ["apiVersion", "memberId", "status", "grade", "profile", "activeMissionId"]);
  version(record.apiVersion);
  if (record.status !== "available" && record.status !== "inactive_or_missing") invalid();
  const gradeRecord = object(record.grade);
  exact(gradeRecord, ["grade", "source"]);
  if (gradeRecord.grade !== null) grade(gradeRecord.grade);
  if (gradeRecord.source !== "study" && gradeRecord.source !== "manual_required") invalid();
  const profile = object(record.profile);
  exact(profile, ["memberId", "grade"]);
  return {
    apiVersion: STUDY_API_VERSION,
    memberId: id(record.memberId),
    status: record.status,
    grade: { grade: gradeRecord.grade as StudyGrade | null, source: gradeRecord.source },
    profile: { memberId: id(profile.memberId), grade: resolvedGrade(profile.grade) },
    activeMissionId: record.activeMissionId === null ? null : id(record.activeMissionId),
  };
}

export function parseStudyMission(value: unknown): StudyMissionDto {
  const record = object(value);
  exact(record, ["apiVersion", "missionId", "status", "grade", "items", "progress"]);
  version(record.apiVersion);
  if (typeof record.status !== "string" || !MISSION_STATUSES.has(record.status)) invalid();
  if (!Array.isArray(record.items) || record.items.length < 1 || record.items.length > 12) invalid();
  const items = record.items.map(missionItem);
  if (new Set(items.map((item) => item.problemId)).size !== items.length) invalid();
  if (items.some((item, index) => item.position !== index)) invalid();
  const progress = object(record.progress);
  exact(progress, ["completed", "total"]);
  const total = integer(progress.total, 1, 12);
  const completed = integer(progress.completed, 0, total);
  if (total !== items.length) invalid();
  return {
    apiVersion: STUDY_API_VERSION,
    missionId: id(record.missionId),
    status: record.status as StudyMissionDto["status"],
    grade: grade(record.grade),
    items,
    progress: { completed, total },
  };
}

export function parseStudyAttempt(value: unknown): StudyAttemptResultDto {
  const record = object(value);
  exact(record, ["apiVersion", "missionId", "problemId", "requestId", "result", "outcome"]);
  version(record.apiVersion);
  if (record.result !== "accepted" && record.result !== "rejected") invalid();
  const outcome = object(record.outcome);
  exact(outcome, ["isCorrect", "resolutionCode", "feedback", "encouragement"]);
  if (outcome.isCorrect !== null && typeof outcome.isCorrect !== "boolean") invalid();
  if (outcome.resolutionCode !== null && outcome.resolutionCode !== "submitted" && outcome.resolutionCode !== "skipped") invalid();
  return {
    apiVersion: STUDY_API_VERSION,
    missionId: id(record.missionId),
    problemId: id(record.problemId),
    requestId: id(record.requestId),
    result: record.result,
    outcome: {
      isCorrect: outcome.isCorrect,
      resolutionCode: outcome.resolutionCode,
      feedback: feedback(outcome.feedback),
      encouragement: string(outcome.encouragement, 2_000),
    },
  };
}

function requestId(value: string): string {
  if (!IDEMPOTENCY_KEY.test(value)) throw new ApiError("invalid_request", 400);
  return value;
}

export async function fetchStudyChildren(): Promise<StudyChildrenOverviewDto> {
  return parseStudyChildren(await apiGet<unknown>("/api/study/children"));
}

export async function fetchStudyChildOverview(memberId: string): Promise<StudyReportDto> {
  return parseStudyReport(await apiGet<unknown>(`/api/study/children/${encodeURIComponent(id(memberId))}/overview`));
}

export async function fetchStudyReport(memberId: string, range: StudyRange): Promise<StudyReportDto> {
  if (!RANGES.has(range)) throw new ApiError("invalid_request", 400);
  return parseStudyReport(await apiGet<unknown>(
    `/api/study/children/${encodeURIComponent(id(memberId))}/report?range=${encodeURIComponent(range)}`,
  ));
}

export async function fetchStudyLearnerState(): Promise<StudyLearnerStateDto> {
  return parseStudyLearnerState(await apiGet<unknown>("/api/study/learner/me"));
}

export async function startStudyMission(input: {
  mode: StudyMissionMode;
  idempotencyKey: string;
}): Promise<StudyMissionDto> {
  if (!MODES.has(input.mode)) throw new ApiError("invalid_request", 400);
  return parseStudyMission(await apiRequest<unknown>("/api/study/learner/missions", {
    method: "POST",
    headers: { "Idempotency-Key": requestId(input.idempotencyKey) },
    body: JSON.stringify({ mode: input.mode }),
  }));
}

export async function fetchStudyMission(missionId: string): Promise<StudyMissionDto> {
  return parseStudyMission(await apiGet<unknown>(
    `/api/study/learner/missions/${encodeURIComponent(id(missionId))}`,
  ));
}

export async function submitStudyAnswer(
  command: SubmitStudyAnswerCommand,
  _options: Readonly<{ retry?: boolean }> = {},
): Promise<StudyAttemptResultDto> {
  return parseStudyAttempt(await apiRequest<unknown>(
    `/api/study/learner/missions/${encodeURIComponent(id(command.missionId))}/submissions`,
    {
      method: "POST",
      headers: { "Idempotency-Key": requestId(command.idempotencyKey) },
      body: JSON.stringify({ problemId: id(command.problemId), answer: command.answer }),
    },
  ));
}

export async function updateStudyGrade(command: UpdateStudyGradeCommand): Promise<StudyGradeMutationResult> {
  const raw = await apiRequest<unknown>(`/api/study/children/${encodeURIComponent(id(command.memberId))}/grade`, {
    method: "PUT",
    headers: { "Idempotency-Key": requestId(command.requestId) },
    body: JSON.stringify({
      grade: command.grade === null ? null : grade(command.grade),
      rowVersion: command.rowVersion,
      requestId: command.requestId,
    }),
  });
  const record = object(raw);
  exact(record, ["memberId", "grade", "rowVersion"]);
  return {
    memberId: id(record.memberId),
    grade: resolvedGrade(record.grade),
    rowVersion: integer(record.rowVersion, 1, Number.MAX_SAFE_INTEGER),
  };
}

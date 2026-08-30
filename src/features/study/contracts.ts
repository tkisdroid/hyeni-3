export const STUDY_API_VERSION = "2026-08-27" as const;

export type StudyGrade = 3 | 4 | 5 | 6;
export type StudyRange = "7d" | "30d" | "term";
export type StudyMissionMode = "daily" | "review" | "focus";

export type StudyResolvedGrade = Readonly<{
  grade: StudyGrade;
  source: "hyeni_birth_year" | "parent_override";
  academicYear: number;
}>;

export type StudyStatusDto =
  | Readonly<{
      state: "enabled";
      market: "KR";
      role: "parent" | "child";
      managementEnabled: boolean;
      learnerEnabled: boolean;
    }>
  | Readonly<{ state: "not_confirmed"; inferredCountry: string | null; canConfirm: boolean }>
  | Readonly<{ state: "outside_market" | "feature_disabled" | "unavailable" | "no_family" }>;

export type StudyProblemType =
  | "single_choice"
  | "multiple_choice"
  | "integer_input"
  | "decimal_input"
  | "fraction_input"
  | "measurement_input"
  | "ordering"
  | "coordinate_input"
  | "true_false"
  | "text_input"
  | "self_check";

export type StudyProblemInput = Readonly<Record<string, unknown> & { kind: StudyProblemType }>;
export type StudyProblemVisual = Readonly<Record<string, unknown> & { kind: string }>;

export type StudyMissionItemDto = Readonly<{
  problemId: string;
  position: number;
  prompt: string;
  childObjective: string;
  domainLabel: string;
  conceptTitle: string;
  difficulty: number;
  difficultyBand: "foundation" | "standard" | "challenge";
  type: StudyProblemType;
  choices?: readonly Readonly<{ id: string; text: string }>[];
  input: StudyProblemInput;
  visual?: StudyProblemVisual;
  opened: boolean;
  resolved: boolean;
  revealedHints: readonly Readonly<{ level: 1 | 2; text: string; representation?: string }>[];
  nextHintLevel: 1 | 2 | null;
  allowedActions: Readonly<{
    canSubmit: boolean;
    canRequestHint: boolean;
    canRequestExplanation: boolean;
    canSkip: boolean;
  }>;
}>;

export type StudyLearnerStateDto = Readonly<{
  apiVersion: typeof STUDY_API_VERSION;
  memberId: string;
  status: "available" | "inactive_or_missing";
  grade: Readonly<{ grade: StudyGrade | null; source: "study" | "manual_required" }>;
  profile: Readonly<{ memberId: string; grade: StudyResolvedGrade }>;
  activeMissionId: string | null;
}>;

export type StudyMissionDto = Readonly<{
  apiVersion: typeof STUDY_API_VERSION;
  missionId: string;
  status: "ready" | "started" | "completed";
  grade: StudyGrade;
  items: readonly StudyMissionItemDto[];
  progress: Readonly<{ completed: number; total: number }>;
}>;

export type StudyHintDto = Readonly<{ level: 1 | 2; text: string; representation?: string }>;
export type StudyExplanationDto = Readonly<{
  question: string;
  concept: string;
  steps: readonly string[];
  answer: string;
  commonMistake: string;
  alternative?: readonly string[];
}>;

export type StudySubmissionFeedback =
  | Readonly<{ kind: "correct"; shortReason: string; finalAnswer: string; next: "continue" }>
  | Readonly<{ kind: "retry"; feedback: string; hint: StudyHintDto; next: "retry" }>
  | Readonly<{
      kind: "explanation_ready";
      feedback: string;
      explanation: StudyExplanationDto;
      next: "continue";
    }>
  | Readonly<{
      kind: "self_check";
      rubric: readonly Readonly<{ id: string; text: string }>[];
      next: "continue";
    }>;

export type StudyAttemptResultDto = Readonly<{
  apiVersion: typeof STUDY_API_VERSION;
  missionId: string;
  problemId: string;
  requestId: string;
  result: "accepted" | "rejected";
  outcome: Readonly<{
    isCorrect: boolean | null;
    resolutionCode: "submitted" | "skipped" | null;
    feedback: StudySubmissionFeedback;
    encouragement: string;
  }>;
}>;

export type StudyChildOverviewDto = Readonly<{
  memberId: string;
  state: "ready" | "grade_unavailable";
  grade: StudyResolvedGrade | null;
  hasStudyData: boolean;
  todayProblemCount: number;
  completedToday: boolean;
  lastStudiedAt: string | null;
}>;

export type StudyChildrenOverviewDto = Readonly<{
  apiVersion: typeof STUDY_API_VERSION;
  children: readonly StudyChildOverviewDto[];
}>;

export type StudyReportDto = Readonly<StudyChildOverviewDto & {
  apiVersion: typeof STUDY_API_VERSION;
  range: StudyRange;
  accuracy: number | null;
  conceptMastery: readonly Readonly<{ conceptId: string; label: string; mastery: number }>[];
  reviewDueCount: number;
  recentSessions: readonly Readonly<{
    sessionId: string;
    startedAt: string;
    problemCount: number;
    accuracy: number | null;
  }>[];
}>;

export type SubmitStudyAnswerCommand = Readonly<{
  missionId: string;
  problemId: string;
  answer: string;
  idempotencyKey: string;
}>;

export type UpdateStudyGradeCommand = Readonly<{
  memberId: string;
  grade: StudyGrade;
  rowVersion: number;
  requestId: string;
}>;

export type StudyGradeMutationResult = Readonly<{
  memberId: string;
  grade: StudyResolvedGrade;
  rowVersion: number;
}>;

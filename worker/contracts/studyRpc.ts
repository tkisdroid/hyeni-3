/** Calendar와 Study Worker가 공유하는 RPC 경계의 첫 버전이다. */
export const STUDY_API_VERSION = "2026-08-27" as const;

export const CALENDAR_STUDY_ROLES = ["guardian", "primary", "learner", "system_cleanup"] as const;

export type CalendarStudyRole = (typeof CALENDAR_STUDY_ROLES)[number];

export type StudyGrade = 3 | 4 | 5 | 6;
export type GradeSource = "hyeni_birth_year" | "parent_override" | "learner_selected";
export type ResolvedLearningGrade = Readonly<{
  grade: StudyGrade;
  source: GradeSource;
  academicYear: number;
}>;

/** Study가 Calendar로부터 받는 국가 힌트다. 위치나 IP는 이 계약에 포함하지 않는다. */
export type CalendarCountryDto = Readonly<{
  country: string;
}>;

/** 학년 판정은 Calendar가 소유하며 Study는 전달받은 결과 snapshot만 사용한다. */
export type CalendarGradeDto = Readonly<{
  grade: 3 | 4 | 5 | 6 | null;
  source: "study" | "manual_required";
}>;

/** Calendar가 HMAC으로 서명해 Study RPC에 붙이는 locked V2 인증 문맥이다. */
export type CalendarStudyAuthorizationV2 = Readonly<{
  apiVersion: typeof STUDY_API_VERSION;
  role: CalendarStudyRole;
  operation: string;
  actorRef: string;
  familyId: string;
  memberId: string | null;
  studyMarket: "KR";
  grade: ResolvedLearningGrade | null;
  issuedAt: string;
  requestId: string;
  fingerprint: string;
  expiresAt: string;
  nonce: string;
  signature: string;
}>;

/** family ID와 생년은 binding에 싣지 않고, 활성 자녀의 요청 시점 grade만 전달한다. */
export type StudyChildGradeContext = Readonly<{
  memberId: string;
  grade: ResolvedLearningGrade | null;
}>;

export type ParentOverviewInput = Readonly<{
  children: readonly StudyChildGradeContext[];
  requestId: string;
}>;

export type ChildReportInput = Readonly<{
  memberId: string;
  grade: ResolvedLearningGrade | null;
  range: "7d" | "30d" | "term";
  requestId: string;
}>;

export type LearnerStateInput = Readonly<{
  memberId: string;
  requestId: string;
}>;

export type ListCalendarConceptsInput = Readonly<{
  memberId: string;
  grade: StudyGrade;
  requestId: string;
}>;

export type StartCalendarMissionInput = Readonly<{
  memberId: string;
  mode: "daily" | "review" | "focus";
  grade?: StudyGrade;
  conceptId?: string;
  requestId: string;
}>;

export type CalendarMissionInput = Readonly<{
  memberId: string;
  missionId: string;
  requestId: string;
}>;

export type SubmitCalendarAnswerInput = Readonly<{
  memberId: string;
  missionId: string;
  problemId: string;
  answer: string;
  requestId: string;
}>;

export type CalendarParentChildOverviewDto = Readonly<{
  memberId: string;
  state: "ready" | "grade_unavailable";
  grade: ResolvedLearningGrade | null;
  hasStudyData: boolean;
  todayProblemCount: number;
  completedToday: boolean;
  lastStudiedAt: string | null;
}>;

export type ChildrenOverviewDto = Readonly<{
  apiVersion: typeof STUDY_API_VERSION;
  children: readonly CalendarParentChildOverviewDto[];
}>;

export type ChildReportDto = Readonly<CalendarParentChildOverviewDto & {
  apiVersion: typeof STUDY_API_VERSION;
  range: "7d" | "30d" | "term";
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

export type CalendarLearnerStateDto = Readonly<{
  apiVersion: typeof STUDY_API_VERSION;
  memberId: string;
  status: "available" | "inactive_or_missing";
  grade: CalendarGradeDto;
  profile: Readonly<{ memberId: string; grade: ResolvedLearningGrade | null }>;
  activeMissionId: string | null;
}>;

export type CalendarMissionItemDto = Readonly<{
  problemId: string;
  position: number;
  prompt: string;
  childObjective: string;
  domainLabel: string;
  conceptTitle: string;
  difficulty: number;
  difficultyBand: "foundation" | "standard" | "challenge";
  type: string;
  choices?: readonly Readonly<{ id: string; text: string }>[];
  input: Readonly<Record<string, unknown>>;
  visual?: Readonly<Record<string, unknown>>;
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

export type CalendarMissionDto = Readonly<{
  apiVersion: typeof STUDY_API_VERSION;
  missionId: string;
  status: "ready" | "started" | "completed";
  grade: StudyGrade;
  selection:
    | Readonly<{ kind: "adaptive" }>
    | Readonly<{ kind: "concept"; conceptId: string; title: string }>;
  items: readonly CalendarMissionItemDto[];
  progress: Readonly<{ completed: number; total: number }>;
}>;

export type CalendarConceptCatalogDto = Readonly<{
  apiVersion: typeof STUDY_API_VERSION;
  grade: StudyGrade;
  concepts: readonly Readonly<{
    conceptId: string;
    unitKey: string;
    title: string;
    problemCount: number;
  }>[];
}>;

export type CalendarMissionAbandonDto = Readonly<{
  apiVersion: typeof STUDY_API_VERSION;
  missionId: string;
  status: "abandoned";
}>;

export type CalendarAttemptResultDto = Readonly<{
  apiVersion: typeof STUDY_API_VERSION;
  missionId: string;
  problemId: string;
  requestId: string;
  result: "accepted" | "rejected";
  outcome: Readonly<{
    isCorrect: boolean | null;
    resolutionCode: "submitted" | "skipped" | null;
    feedback: Readonly<Record<string, unknown>>;
    encouragement: string;
  }>;
}>;

export type StudyReadinessDto = Readonly<{
  apiVersion: typeof STUDY_API_VERSION;
  status: "ready" | "not_ready";
  schemaVersion: number;
  problemCount: number;
  contentDigest: string;
}>;

export interface CalendarStudyServiceBinding {
  getChildrenOverview(input: ParentOverviewInput, auth: CalendarStudyAuthorizationV2): Promise<ChildrenOverviewDto>;
  getChildReport(input: ChildReportInput, auth: CalendarStudyAuthorizationV2): Promise<ChildReportDto>;
  getLearnerState(input: LearnerStateInput, auth: CalendarStudyAuthorizationV2): Promise<CalendarLearnerStateDto>;
  listCalendarConcepts(input: ListCalendarConceptsInput, auth: CalendarStudyAuthorizationV2): Promise<CalendarConceptCatalogDto>;
  startCalendarMission(input: StartCalendarMissionInput, auth: CalendarStudyAuthorizationV2): Promise<CalendarMissionDto>;
  getCalendarMission(input: CalendarMissionInput, auth: CalendarStudyAuthorizationV2): Promise<CalendarMissionDto>;
  abandonCalendarMission(input: CalendarMissionInput, auth: CalendarStudyAuthorizationV2): Promise<CalendarMissionAbandonDto>;
  submitCalendarAnswer(input: SubmitCalendarAnswerInput, auth: CalendarStudyAuthorizationV2): Promise<CalendarAttemptResultDto>;
  readiness(): Promise<StudyReadinessDto>;
}

export type CalendarChildProjectionDto = Readonly<
  | { apiVersion: typeof STUDY_API_VERSION; status: "active"; memberId: string; displayName: string; hasAvatar: boolean; revision: string }
  | { apiVersion: typeof STUDY_API_VERSION; status: "inactive_or_missing"; memberId: string }
>;

export interface CalendarProfileServiceBinding {
  getActiveChildProjection(familyId: string, memberId: string): Promise<CalendarChildProjectionDto>;
}

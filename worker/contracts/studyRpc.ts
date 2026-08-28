/** Calendar와 Study Worker가 공유하는 RPC 경계의 첫 버전이다. */
export const STUDY_API_VERSION = "2026-08-27" as const;

export const CALENDAR_STUDY_ROLES = ["guardian", "primary", "learner", "system_cleanup"] as const;

export type CalendarStudyRole = (typeof CALENDAR_STUDY_ROLES)[number];

/** Study가 Calendar로부터 받는 국가 힌트다. 위치나 IP는 이 계약에 포함하지 않는다. */
export type CalendarCountryDto = Readonly<{
  country: string;
}>;

/** 학년 판정은 Study가 소유하며 Calendar는 추정 생년월일을 넘기지 않는다. */
export type CalendarGradeDto = Readonly<{
  grade: 3 | 4 | 5 | 6 | null;
  source: "study" | "manual_required";
}>;

/** Calendar가 HMAC으로 서명해 Study RPC에 붙이는 최소 인증 문맥이다. */
export type CalendarStudyAuthorizationV2 = Readonly<{
  apiVersion: typeof STUDY_API_VERSION;
  role: CalendarStudyRole;
  familyId: string;
  issuedAt: string;
  requestId: string;
  signature: string;
}>;

export type ParentOverviewInput = Readonly<{
  familyId: string;
}>;

export type ChildReportInput = Readonly<{
  familyId: string;
  memberId: string;
}>;

export type LearnerStateInput = ChildReportInput;

export type StartCalendarMissionInput = Readonly<{
  familyId: string;
  memberId: string;
  missionId: string;
}>;

export type CalendarMissionInput = Readonly<{
  familyId: string;
  memberId: string;
  missionId: string;
}>;

export type SubmitCalendarAnswerInput = Readonly<{
  familyId: string;
  memberId: string;
  missionId: string;
  answer: string;
}>;

export type ChildrenOverviewDto = Readonly<{
  apiVersion: typeof STUDY_API_VERSION;
  children: readonly CalendarChildProjectionDto[];
}>;

export type ChildReportDto = Readonly<{
  apiVersion: typeof STUDY_API_VERSION;
  memberId: string;
  status: "available" | "inactive_or_missing";
}>;

export type CalendarLearnerStateDto = Readonly<{
  apiVersion: typeof STUDY_API_VERSION;
  memberId: string;
  status: "available" | "inactive_or_missing";
  grade: CalendarGradeDto;
}>;

export type CalendarMissionDto = Readonly<{
  apiVersion: typeof STUDY_API_VERSION;
  missionId: string;
  status: "ready" | "started" | "completed";
}>;

export type CalendarAttemptResultDto = Readonly<{
  apiVersion: typeof STUDY_API_VERSION;
  missionId: string;
  result: "accepted" | "rejected";
}>;

export type StudyReadinessDto = Readonly<{
  apiVersion: typeof STUDY_API_VERSION;
  status: "ready" | "not_ready";
}>;

export interface CalendarStudyServiceBinding {
  getChildrenOverview(input: ParentOverviewInput, auth: CalendarStudyAuthorizationV2): Promise<ChildrenOverviewDto>;
  getChildReport(input: ChildReportInput, auth: CalendarStudyAuthorizationV2): Promise<ChildReportDto>;
  getLearnerState(input: LearnerStateInput, auth: CalendarStudyAuthorizationV2): Promise<CalendarLearnerStateDto>;
  startCalendarMission(input: StartCalendarMissionInput, auth: CalendarStudyAuthorizationV2): Promise<CalendarMissionDto>;
  getCalendarMission(input: CalendarMissionInput, auth: CalendarStudyAuthorizationV2): Promise<CalendarMissionDto>;
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

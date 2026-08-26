export const STUDY_API_VERSION = "2026-08-24" as const;

export type StudyRange = "7d" | "30d" | "term";
export type Grade = 3 | 4 | 5 | 6;

export type ChildProjectionDto = Readonly<
  | {
      apiVersion: typeof STUDY_API_VERSION;
      status: "active";
      memberId: string;
      displayName: string;
      hasAvatar: boolean;
      avatarFingerprint: string | null;
    }
  | {
      apiVersion: typeof STUDY_API_VERSION;
      status: "inactive_or_missing";
      memberId: string;
    }
>;

export type ChallengeDto = Readonly<{
  apiVersion: typeof STUDY_API_VERSION;
  purpose: "claim_guest_profile" | "attach_child_device";
  qrUrl: string;
  expiresAt: string;
}>;

export type ChildrenOverviewDto = Readonly<{
  apiVersion: typeof STUDY_API_VERSION;
  children: readonly {
    memberId: string;
    linked: boolean;
    grade: Grade | null;
    todayProblemCount: number;
    completedToday: boolean;
    lastStudiedAt: string | null;
  }[];
}>;

export type ChildReportDto = Readonly<{
  apiVersion: typeof STUDY_API_VERSION;
  memberId: string;
  linked: boolean;
  grade: Grade | null;
  range: StudyRange;
  todayProblemCount: number;
  completedToday: boolean;
  lastStudiedAt: string | null;
  accuracy: number | null;
  conceptMastery: readonly {
    conceptId: string;
    label: string;
    mastery: number;
  }[];
  reviewDueCount: number;
  recentSessions: readonly {
    sessionId: string;
    startedAt: string;
    problemCount: number;
    accuracy: number | null;
  }[];
}>;

export type LearnerDeviceDto = Readonly<{
  deviceSessionId: string;
  sessionKind: "paired";
  createdAt: string;
  lastUsedAt: string;
}>;

export type MutationReceiptDto = Readonly<{
  apiVersion: typeof STUDY_API_VERSION;
  requestId: string;
  status: "completed";
}>;

export type LinkResultDto = Readonly<{
  apiVersion: typeof STUDY_API_VERSION;
  requestId: string;
  status: "linked" | "merged";
  learnerState: "needs_grade" | "ready";
  preservedAttemptCount: number;
}>;

/** Study Worker의 named RPC entrypoint와 구조적으로 맞추는 Calendar 측 계약입니다. */
export interface StudyServiceEntrypoint {
  getChildrenOverview(
    familyId: string,
    memberIds: string[],
    requestId: string,
  ): Promise<ChildrenOverviewDto>;
  getChildReport(
    familyId: string,
    memberId: string,
    range: StudyRange,
    requestId: string,
  ): Promise<ChildReportDto>;
  createAttachChallenge(
    familyId: string,
    memberId: string,
    actorRef: string,
    requestId: string,
  ): Promise<ChallengeDto>;
  consumeGuestClaim(
    familyId: string,
    memberId: string,
    claimToken: string,
    actorRef: string,
    requestId: string,
  ): Promise<LinkResultDto>;
  listLearnerDevices(
    familyId: string,
    memberId: string,
    requestId: string,
  ): Promise<LearnerDeviceDto[]>;
  revokeLearnerDevice(
    familyId: string,
    memberId: string,
    deviceSessionId: string,
    actorRef: string,
    requestId: string,
  ): Promise<MutationReceiptDto>;
  deactivateCalendarChildLink(
    familyId: string,
    memberId: string,
    reason: string,
    requestId: string,
  ): Promise<MutationReceiptDto>;
}

export interface CalendarProfileServiceContract {
  getActiveChildProjection(
    familyId: string,
    memberId: string,
  ): Promise<ChildProjectionDto>;
  fetchActiveChildAvatar(
    familyId: string,
    memberId: string,
    variant: "study-128",
  ): Promise<Response>;
}

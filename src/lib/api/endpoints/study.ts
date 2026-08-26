import { apiRequest } from "../client";

export const STUDY_API_VERSION = "2026-08-24" as const;

export type StudyFeatureState = "disabled" | "ready" | "unavailable";
export type StudyRange = "7d" | "30d" | "term";
export type StudyGrade = 3 | 4 | 5 | 6;

export type StudyChildDto = Readonly<{
  memberId: string;
  displayName: string;
  photoAvailable: boolean;
  linked: boolean;
  grade: StudyGrade | null;
  canManageLinks: boolean;
}>;

export type StudyChildOverviewDto = Readonly<{
  memberId: string;
  linked: boolean;
  grade: StudyGrade | null;
  todayProblemCount: number;
  completedToday: boolean;
  lastStudiedAt: string | null;
}>;

export type StudyReportDto = Readonly<{
  apiVersion: typeof STUDY_API_VERSION;
  memberId: string;
  linked: boolean;
  grade: StudyGrade | null;
  range: StudyRange;
  todayProblemCount: number;
  completedToday: boolean;
  lastStudiedAt: string | null;
  accuracy: number | null;
  conceptMastery: readonly Readonly<{
    conceptId: string;
    label: string;
    mastery: number;
  }>[];
  reviewDueCount: number;
  recentSessions: readonly Readonly<{
    sessionId: string;
    startedAt: string;
    problemCount: number;
    accuracy: number | null;
  }>[];
}>;

export type StudyDeviceDto = Readonly<{
  deviceSessionId: string;
  sessionKind: "paired";
  createdAt: string;
  lastUsedAt: string;
}>;

export type StudyPermissions = Readonly<{ canManageLinks: boolean }>;

export type StudyStatusResponse = Readonly<{ state: StudyFeatureState }>;
export type StudyChildrenResponse = Readonly<{ children: readonly StudyChildDto[] }>;
export type StudyOverviewResponse = Readonly<{
  child: Pick<StudyChildDto, "memberId" | "displayName" | "photoAvailable">;
  overview: StudyChildOverviewDto | null;
  permissions: StudyPermissions;
}>;
export type StudyReportResponse = Readonly<{
  child: Pick<StudyChildDto, "memberId" | "displayName" | "photoAvailable">;
  report: StudyReportDto;
  permissions: StudyPermissions;
}>;
export type StudyDevicesResponse = Readonly<{
  devices: readonly StudyDeviceDto[];
  permissions: StudyPermissions;
}>;
export type StudyChallengeResponse = Readonly<{
  challenge: Readonly<{
    apiVersion: typeof STUDY_API_VERSION;
    purpose: "claim_guest_profile" | "attach_child_device";
    qrUrl: string;
    expiresAt: string;
  }>;
  permissions: StudyPermissions;
}>;
export type StudyClaimResponse = Readonly<{
  result: Readonly<{
    apiVersion: typeof STUDY_API_VERSION;
    requestId: string;
    status: "linked" | "merged";
    learnerState: "needs_grade" | "ready";
    preservedAttemptCount: number;
  }>;
  permissions: StudyPermissions;
}>;
export type StudyRevokeDeviceResponse = Readonly<{
  receipt: Readonly<{
    apiVersion: typeof STUDY_API_VERSION;
    requestId: string;
    status: "completed";
  }>;
  permissions: StudyPermissions;
}>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requiredMemberId(raw: string): string {
  const memberId = String(raw ?? "").trim();
  if (!memberId) throw new Error("study_member_required");
  return memberId;
}

function mutationHeaders(requestId: string): HeadersInit {
  if (!UUID_PATTERN.test(requestId)) throw new Error("study_request_id_required");
  return { "Idempotency-Key": requestId };
}

export function getStudyStatus(): Promise<StudyStatusResponse> {
  return apiRequest<StudyStatusResponse>("/api/study/status");
}

export function getStudyChildren(): Promise<StudyChildrenResponse> {
  return apiRequest<StudyChildrenResponse>("/api/study/children");
}

export function getStudyOverview(memberId: string): Promise<StudyOverviewResponse> {
  const selectedMemberId = requiredMemberId(memberId);
  return apiRequest<StudyOverviewResponse>(
    `/api/study/children/${encodeURIComponent(selectedMemberId)}/overview`,
  );
}

export function getStudyReport(
  memberId: string,
  range: StudyRange,
): Promise<StudyReportResponse> {
  memberId = requiredMemberId(memberId);
  return apiRequest<StudyReportResponse>(
    `/api/study/children/${encodeURIComponent(memberId)}/report?range=${encodeURIComponent(range)}`,
  );
}

export function getStudyDevices(memberId: string): Promise<StudyDevicesResponse> {
  const selectedMemberId = requiredMemberId(memberId);
  return apiRequest<StudyDevicesResponse>(
    `/api/study/children/${encodeURIComponent(selectedMemberId)}/devices`,
  );
}

export function createStudyAttachChallenge(
  memberId: string,
  requestId: string,
): Promise<StudyChallengeResponse> {
  const selectedMemberId = requiredMemberId(memberId);
  return apiRequest<StudyChallengeResponse>(
    `/api/study/children/${encodeURIComponent(selectedMemberId)}/attach-challenges`,
    { method: "POST", body: "{}", headers: mutationHeaders(requestId) },
  );
}

export function claimStudyProfile(
  memberId: string,
  claimToken: string,
  requestId: string,
): Promise<StudyClaimResponse> {
  const selectedMemberId = requiredMemberId(memberId);
  return apiRequest<StudyClaimResponse>(
    `/api/study/children/${encodeURIComponent(selectedMemberId)}/claim`,
    {
      method: "POST",
      body: JSON.stringify({ claimToken }),
      headers: mutationHeaders(requestId),
    },
  );
}

export function revokeStudyDevice(
  memberId: string,
  deviceSessionId: string,
  requestId: string,
): Promise<StudyRevokeDeviceResponse> {
  const selectedMemberId = requiredMemberId(memberId);
  const selectedDeviceSessionId = String(deviceSessionId ?? "").trim();
  if (!selectedDeviceSessionId) throw new Error("study_device_session_required");
  return apiRequest<StudyRevokeDeviceResponse>(
    `/api/study/children/${encodeURIComponent(selectedMemberId)}/devices/${encodeURIComponent(selectedDeviceSessionId)}`,
    { method: "DELETE", headers: mutationHeaders(requestId) },
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthContext";
import {
  claimStudyProfile,
  createStudyAttachChallenge,
  getStudyChildren,
  getStudyDevices,
  getStudyOverview,
  getStudyReport,
  getStudyStatus,
  revokeStudyDevice,
  type StudyFeatureState,
  type StudyRange,
} from "@/lib/api/endpoints/study";
import type { StudyMutationRequest } from "@/lib/api/studyMutationRequest";
import type { StudyClaimContext } from "@/transform/studyClaimContext";
import { qk } from "./keys";

function exactStudyInvalidations(
  familyId: string,
  memberId: string,
): readonly (readonly unknown[])[] {
  return [
    qk.studyChildren(familyId),
    qk.studyOverview(familyId, memberId),
    qk.studyReport(familyId, memberId, "7d"),
    qk.studyReport(familyId, memberId, "30d"),
    qk.studyReport(familyId, memberId, "term"),
    qk.studyDevices(familyId, memberId),
  ];
}

export function useStudyStatus() {
  const { familyId, status } = useAuth();
  return useQuery({
    queryKey: qk.studyStatus(familyId ?? ""),
    queryFn: getStudyStatus,
    enabled: status === "authenticated" && Boolean(familyId),
  });
}

export function useStudyChildren(featureState: StudyFeatureState | undefined) {
  const { familyId, status } = useAuth();
  return useQuery({
    queryKey: qk.studyChildren(familyId ?? ""),
    queryFn: getStudyChildren,
    enabled: status === "authenticated" && Boolean(familyId) && featureState === "ready",
  });
}

export function useStudyOverview(
  memberId: string,
  featureState: StudyFeatureState | undefined,
) {
  const { familyId } = useAuth();
  return useQuery({
    queryKey: qk.studyOverview(familyId ?? "", memberId),
    queryFn: () => getStudyOverview(memberId),
    enabled: Boolean(familyId && memberId && featureState === "ready"),
  });
}

export function useStudyReport(
  memberId: string,
  range: StudyRange,
  featureState: StudyFeatureState | undefined,
) {
  const { familyId } = useAuth();
  return useQuery({
    queryKey: qk.studyReport(familyId ?? "", memberId, range),
    queryFn: () => getStudyReport(memberId, range),
    enabled: Boolean(familyId && memberId && featureState === "ready"),
  });
}

export function useStudyDevices(
  memberId: string,
  featureState: StudyFeatureState | undefined,
) {
  const { familyId } = useAuth();
  return useQuery({
    queryKey: qk.studyDevices(familyId ?? "", memberId),
    queryFn: () => getStudyDevices(memberId),
    enabled: Boolean(familyId && memberId && featureState === "ready"),
  });
}

function useInvalidateExactStudyChild() {
  const client = useQueryClient();
  const { familyId } = useAuth();
  return (memberId: string) => {
    if (!familyId) return;
    for (const queryKey of exactStudyInvalidations(familyId, memberId)) {
      void client.invalidateQueries({ queryKey });
    }
  };
}

export function useCreateStudyAttachChallenge() {
  const invalidate = useInvalidateExactStudyChild();
  return useMutation({
    mutationFn: (request: StudyMutationRequest) => request.run(({ memberId, requestId }) =>
      createStudyAttachChallenge(memberId, requestId)),
    onSuccess: (_result, request) => invalidate(request.memberId),
  });
}

export function useClaimStudyProfile() {
  const invalidate = useInvalidateExactStudyChild();
  return useMutation({
    mutationFn: (input: Readonly<{ request: StudyMutationRequest; claim: StudyClaimContext }>) =>
      input.claim.consume((claimToken) => input.request.run(({ memberId, requestId }) =>
        claimStudyProfile(memberId, claimToken, requestId))),
    onSuccess: (_result, input) => invalidate(input.request.memberId),
    retry: false,
  });
}

export function useRevokeStudyDevice() {
  const invalidate = useInvalidateExactStudyChild();
  return useMutation({
    mutationFn: (input: Readonly<{ request: StudyMutationRequest; deviceSessionId: string }>) =>
      input.request.run(({ memberId, requestId }) =>
        revokeStudyDevice(memberId, input.deviceSessionId, requestId)),
    onSuccess: (_result, input) => invalidate(input.request.memberId),
  });
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthContext";
import { ApiError } from "@/lib/api/errors";
import {
  fetchStudyChildOverview,
  fetchStudyChildren,
  fetchStudyLearnerState,
  fetchStudyMission,
  fetchStudyReport,
  startStudyMission,
  submitStudyAnswer,
  updateStudyGrade,
} from "@/lib/api/endpoints/study";
import type {
  StudyGrade,
  StudyLearnerStateDto,
  StudyMissionMode,
  StudyRange,
  SubmitStudyAnswerCommand,
  UpdateStudyGradeCommand,
} from "@/features/study/contracts";
import { qk } from "./keys";
import { refreshStudyAfterAnswer } from "./studyQueryRefresh";

function stableFamilyId(value: string | null): string {
  return value ?? "none";
}

function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

export function useStudyChildren() {
  const { familyId, role, status } = useAuth();
  return useQuery({
    queryKey: qk.study.children(stableFamilyId(familyId)),
    queryFn: fetchStudyChildren,
    enabled: status === "authenticated" && role === "parent" && !!familyId,
    retry: shouldRetry,
  });
}

export function useStudyChildOverview(memberId: string | null) {
  const { familyId, role, status } = useAuth();
  return useQuery({
    queryKey: qk.study.overview(stableFamilyId(familyId), memberId ?? "none"),
    queryFn: () => fetchStudyChildOverview(memberId ?? ""),
    enabled: status === "authenticated" && role === "parent" && !!familyId && !!memberId,
    retry: shouldRetry,
  });
}

export function useStudyReport(memberId: string | null, range: StudyRange) {
  const { familyId, role, status } = useAuth();
  return useQuery({
    queryKey: qk.study.report(stableFamilyId(familyId), memberId ?? "none", range),
    queryFn: () => fetchStudyReport(memberId ?? "", range),
    enabled: status === "authenticated" && role === "parent" && !!familyId && !!memberId,
    retry: shouldRetry,
  });
}

export function useStudyLearnerState() {
  const { familyId, role, status } = useAuth();
  return useQuery({
    queryKey: qk.study.learner(stableFamilyId(familyId)),
    queryFn: fetchStudyLearnerState,
    enabled: status === "authenticated" && role === "child" && !!familyId,
    retry: shouldRetry,
  });
}

export function useStudyMission(missionId: string | null) {
  const { familyId, role, status } = useAuth();
  return useQuery({
    queryKey: qk.study.mission(stableFamilyId(familyId), missionId ?? "none"),
    queryFn: () => fetchStudyMission(missionId ?? ""),
    enabled: status === "authenticated" && role === "child" && !!familyId && !!missionId,
    retry: shouldRetry,
  });
}

export function useStartStudyMission() {
  const client = useQueryClient();
  const { familyId } = useAuth();
  const keyFamilyId = stableFamilyId(familyId);
  return useMutation({
    mutationFn: (input: { mode: StudyMissionMode; grade?: StudyGrade; idempotencyKey: string }) => startStudyMission(input),
    meta: { silentError: true },
    onSuccess: (mission) => {
      client.setQueryData(qk.study.mission(keyFamilyId, mission.missionId), mission);
      void client.invalidateQueries({ queryKey: qk.study.learner(keyFamilyId), exact: true });
    },
  });
}

export function useSubmitStudyAnswer() {
  const client = useQueryClient();
  const { familyId } = useAuth();
  const keyFamilyId = stableFamilyId(familyId);
  return useMutation({
    mutationFn: (command: SubmitStudyAnswerCommand) => submitStudyAnswer(command),
    meta: { silentError: true },
    onSuccess: (result) => {
      const learner = client.getQueryData<StudyLearnerStateDto>(qk.study.learner(keyFamilyId));
      refreshStudyAfterAnswer(client, {
        familyId: keyFamilyId,
        learnerMemberId: learner?.memberId ?? null,
        missionId: result.missionId,
      });
    },
  });
}

export function useUpdateStudyGrade() {
  const client = useQueryClient();
  const { familyId } = useAuth();
  const keyFamilyId = stableFamilyId(familyId);
  return useMutation({
    mutationFn: (command: UpdateStudyGradeCommand) => updateStudyGrade(command),
    onSuccess: async (result) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: qk.family(familyId), exact: true }),
        client.invalidateQueries({ queryKey: qk.study.children(keyFamilyId), exact: true }),
        client.invalidateQueries({ queryKey: qk.study.overview(keyFamilyId, result.memberId), exact: true }),
        client.invalidateQueries({ queryKey: ["study", "report", keyFamilyId, result.memberId] }),
      ]);
    },
  });
}

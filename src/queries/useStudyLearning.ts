import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthContext";
import { ApiError } from "@/lib/api/errors";
import { fetchChildProblemHistory, fetchChildVocabularyProgress, fetchVocabularyDeck, saveVocabularyReview } from "@/lib/api/endpoints/studyLearning";
import type { HistoryRange, VocabularyLevel, VocabularyMode } from "@/features/study/learningExtrasContracts";
import type { VocabularyReviewCommand } from "@/features/study/vocabularyLearning";
import { qk } from "./keys";

function retry(failures: number, error: unknown): boolean {
  return !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failures < 2;
}

export function useStudyProblemHistory(memberId: string, range: HistoryRange) {
  const { familyId, userId, role, status } = useAuth();
  return useInfiniteQuery({
    queryKey: qk.study.history(familyId ?? "none", userId ?? "none", memberId, range),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => fetchChildProblemHistory(memberId, range, pageParam),
    getNextPageParam: page => page.nextCursor ?? undefined,
    enabled: status === "authenticated" && role === "parent" && !!familyId && !!memberId,
    retry,
  });
}

export function useChildVocabularyProgress(memberId: string) {
  const { familyId, userId, role, status } = useAuth();
  return useInfiniteQuery({
    queryKey: qk.study.vocabularyProgress(familyId ?? "none", userId ?? "none", memberId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => fetchChildVocabularyProgress(memberId, pageParam),
    getNextPageParam: page => page.nextCursor ?? undefined,
    enabled: status === "authenticated" && role === "parent" && !!familyId && !!memberId,
    retry,
  });
}

export function useVocabularyOverview() {
  const { familyId, userId, role, status } = useAuth();
  return useQuery({
    queryKey: qk.study.vocabulary(familyId ?? "none", userId ?? "none", "self", null, "new", "overview"),
    queryFn: () => fetchVocabularyDeck(null, "new"),
    enabled: status === "authenticated" && role === "child" && !!familyId && !!userId,
    retry,
  });
}

export function useVocabularyDeck(memberId: string, level: VocabularyLevel, mode: VocabularyMode, runId: string) {
  const { familyId, userId, role, status } = useAuth();
  return useInfiniteQuery({
    queryKey: qk.study.vocabulary(familyId ?? "none", userId ?? "none", memberId, level, mode, runId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => fetchVocabularyDeck(level, mode, pageParam, memberId),
    getNextPageParam: page => page.nextCursor ?? undefined,
    enabled: status === "authenticated" && role === "child" && !!familyId && !!userId && !!memberId,
    // 이번에 내려받은 카드 순서는 평가 뒤에도 유지한다. 새 학습을 시작할 때 최신 목록을 받는다.
    staleTime: Infinity, gcTime: 0, refetchOnWindowFocus: false, refetchOnReconnect: false,
    retry,
  });
}

export function useSaveVocabularyReview(memberId: string) {
  const { familyId, userId } = useAuth();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (command: VocabularyReviewCommand) => saveVocabularyReview(command, memberId),
    retry: false,
    meta: { silentError: true },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: qk.study.vocabulary(familyId ?? "none", userId ?? "none", "self", null, "new", "overview"), refetchType: "none" });
      void client.invalidateQueries({ queryKey: ["study", "vocabularyProgress", familyId ?? "none"], refetchType: "none" });
    },
  });
}

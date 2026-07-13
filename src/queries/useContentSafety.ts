import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthContext";
import { qk } from "./keys";
import {
  blockMemoUser,
  fetchMemoBlocks,
  reportAiMessage,
  reportMemoReply,
  unblockMemoUser,
  type AiContentReportReason,
  type MemoContentReportReason,
} from "@/lib/api/endpoints/contentSafety";

export function useMemoBlocks() {
  const { familyId, status } = useAuth();
  return useQuery({
    queryKey: qk.memoBlocks(familyId ?? ""),
    queryFn: () => fetchMemoBlocks(familyId as string),
    enabled: status === "authenticated" && !!familyId,
  });
}

export function useReportAiMessage() {
  return useMutation({
    meta: { silentError: true },
    mutationFn: (input: { messageId: string; reason: AiContentReportReason; detail: string }) =>
      reportAiMessage(input.messageId, input.reason, input.detail),
  });
}

export function useReportMemoReply() {
  return useMutation({
    meta: { silentError: true },
    mutationFn: (input: { replyId: string; reason: MemoContentReportReason; detail: string }) =>
      reportMemoReply(input.replyId, input.reason, input.detail),
  });
}

export function useBlockMemoUser() {
  const qc = useQueryClient();
  const { familyId } = useAuth();
  return useMutation({
    meta: { silentError: true },
    mutationFn: (targetUserId: string) => {
      if (!familyId) throw new Error("가족 정보가 없어요");
      return blockMemoUser(familyId, targetUserId);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.memoBlocks(familyId ?? "") });
      void qc.invalidateQueries({ queryKey: ["memoReplies", familyId ?? ""] });
    },
  });
}

export function useUnblockMemoUser() {
  const qc = useQueryClient();
  const { familyId } = useAuth();
  return useMutation({
    meta: { silentError: true },
    mutationFn: (targetUserId: string) => {
      if (!familyId) throw new Error("가족 정보가 없어요");
      return unblockMemoUser(familyId, targetUserId);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.memoBlocks(familyId ?? "") });
      void qc.invalidateQueries({ queryKey: ["memoReplies", familyId ?? ""] });
    },
  });
}

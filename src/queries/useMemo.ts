/**
 * 메모/대화(memo_replies) 도메인 TanStack Query 훅.
 * 컴포넌트는 이 훅만 import(endpoints/memo 직접 호출 금지).
 * 실시간 INSERT 는 useFamilyRealtime 이 memo_replies → ["memoReplies", familyId] 무효화로 반영.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "./keys";
import { useAuth } from "@/auth/AuthContext";
import {
  fetchMemoReplies,
  sendMemoReply,
  markReplyRead,
} from "@/lib/api/endpoints/memo";
import { todayDateKey } from "@/transform/dateKey";

/** 선택 date_key 들의 대화 스레드. childId(member id) 지정 시 그 아이 스레드만(아이별 분리). */
export function useMemoThread(dateKeys: string[], childId?: string | null) {
  const { familyId, status } = useAuth();
  const keys = [...new Set(dateKeys.filter(Boolean))];
  return useQuery({
    queryKey: qk.memoReplies(familyId ?? "", keys.join(","), childId ?? null),
    queryFn: () => fetchMemoReplies(familyId as string, keys, childId ?? null),
    enabled: status === "authenticated" && !!familyId && keys.length > 0,
  });
}

export interface SendMemoVars {
  content: string;
  dateKey?: string; // 기본값 = 오늘
  childId?: string | null;
  origin?: string;
}

/** 대화 전송 → 대화 캐시 무효화. 화면 버튼에서 사용자가 눌러야 실행(자동 실행 금지). */
export function useSendMemo() {
  const qc = useQueryClient();
  const { familyId, userId, role } = useAuth();
  return useMutation({
    mutationFn: (vars: SendMemoVars) => {
      if (!familyId) throw new Error("가족 정보가 없어요");
      if (!userId) throw new Error("로그인이 필요해요");
      const userRole: "parent" | "child" = role === "child" ? "child" : "parent";
      return sendMemoReply({
        familyId,
        dateKey: vars.dateKey ?? todayDateKey(),
        userId,
        userRole,
        content: vars.content,
        childId: vars.childId ?? null,
        origin: vars.origin,
      });
    },
    // date_key 별로 키가 갈리므로 familyId 접두로 전 스레드 무효화(useFamilyRealtime 과 동일 범위).
    onSuccess: () => qc.invalidateQueries({ queryKey: ["memoReplies", familyId ?? ""] }),
  });
}

/** 읽음 처리(뷰포트 read-receipt) → 대화 캐시 무효화. 자동 실행은 화면에서 하지 않음. */
export function useMarkRead() {
  const qc = useQueryClient();
  const { familyId, userId } = useAuth();
  return useMutation({
    mutationFn: (replyId: string) => {
      if (!userId) throw new Error("로그인이 필요해요");
      return markReplyRead(replyId, userId);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["memoReplies", familyId ?? ""] }),
  });
}

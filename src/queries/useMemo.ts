/**
 * 메모/대화(memo_replies) 도메인 TanStack Query 훅.
 * 컴포넌트는 이 훅만 import(endpoints/memo 직접 호출 금지).
 * 실시간 INSERT 는 useFamilyRealtime 이 memo_replies → ["memoReplies", familyId] 무효화로 반영.
 */
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "./keys";
import { useAuth } from "@/auth/AuthContext";
import {
  fetchMemoReplies,
  sendMemoReply,
  markReplyRead,
  type MemoReply,
} from "@/lib/api/endpoints/memo";
import {
  commitSentMemoReply,
  insertPendingMemoReply,
  markMemoReplyRead,
  reconcilePendingMemoReply,
  removeMemoReply,
  PENDING_MEMO_ID_PREFIX,
} from "./memoCache";

/** 선택 date_key 들의 대화 스레드. childId(member id) 지정 시 그 아이 스레드만(아이별 분리). */
export function useMemoThread(dateKeys: string[], childId?: string | null) {
  const { familyId, status } = useAuth();
  const keys = [...new Set(dateKeys.filter(Boolean))];
  return useQuery({
    queryKey: qk.memoReplies(familyId ?? "", keys.join(","), childId ?? null),
    queryFn: () => fetchMemoReplies(familyId as string, keys, childId as string),
    enabled: status === "authenticated" && !!familyId && !!childId && keys.length > 0,
  });
}

/** 부모 탭의 미읽음 점: 모든 아이의 실제 memo_replies.read_by를 조회한다. */
export function useUnreadMemoForChildren(dateKeys: string[], childIds: string[]): boolean {
  const { familyId, userId, status } = useAuth();
  const keys = [...new Set(dateKeys.filter(Boolean))];
  const scopedChildIds = [...new Set(childIds.filter(Boolean))];
  const enabled = status === "authenticated" && !!familyId && !!userId && keys.length > 0;
  const queries = useQueries({
    queries: scopedChildIds.map((childId) => ({
      queryKey: qk.memoReplies(familyId ?? "", keys.join(","), childId),
      queryFn: () => fetchMemoReplies(familyId as string, keys, childId),
      enabled,
    })),
  });

  if (!enabled || !userId) return false;
  return queries.some((query) =>
    ((query.data ?? []) as MemoReply[]).some(
      (r) =>
        r.user_id !== userId
        && (r.content ?? "").trim().length > 0
        && !(r.read_by ?? []).includes(userId),
    ),
  );
}

export interface SendMemoVars {
  content: string;
  dateKey: string;
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
      if (!vars.dateKey) throw new Error("대화 날짜를 확인할 수 없어요");
      const userRole: "parent" | "child" = role === "child" ? "child" : "parent";
      return sendMemoReply({
        familyId,
        dateKey: vars.dateKey,
        userId,
        userRole,
        content: vars.content,
        childId: vars.childId ?? null,
        origin: vars.origin,
      });
    },
    // 보낸 즉시 말풍선을 세운다 — 서버 왕복을 기다리면 화면이 멈춘 것처럼 보인다.
    onMutate: (vars: SendMemoVars) => {
      if (!familyId || !userId || !vars.dateKey) return undefined;
      const pendingId = `${PENDING_MEMO_ID_PREFIX}${crypto.randomUUID()}`;
      insertPendingMemoReply(qc, familyId, {
        id: pendingId,
        family_id: familyId,
        date_key: vars.dateKey,
        child_id: vars.childId ?? null,
        user_id: userId,
        user_role: role === "child" ? "child" : "parent",
        content: vars.content,
        origin: vars.origin ?? null,
        read_by: [],
        created_at: new Date().toISOString(),
      });
      return { pendingId };
    },
    // 서버가 반환한 저장 행은 즉시 표시하고, 정본 재조회는 전송 완료를 막지 않게 백그라운드로 실행한다.
    onSuccess: (saved, _vars, context) => {
      // 임시 행은 '지우고 다시 넣기'가 아니라 제자리 교체다 — 응답이 이상해도 말풍선이 사라지지 않는다.
      if (context?.pendingId) reconcilePendingMemoReply(qc, familyId ?? "", context.pendingId, saved);
      commitSentMemoReply(qc, familyId ?? "", saved);
    },
    // 실패하면 임시 말풍선을 반드시 걷는다 — '보낸 척'이 남으면 안 된다.
    onError: (_error, _vars, context) => {
      if (context?.pendingId) removeMemoReply(qc, familyId ?? "", context.pendingId);
    },
  });
}

/** 읽음 처리(뷰포트 read-receipt) → 대화 캐시 무효화. 자동 실행은 화면에서 하지 않음. */
export function useMarkRead() {
  const qc = useQueryClient();
  const { familyId, userId } = useAuth();
  return useMutation({
    retry: 2,
    retryDelay: (attempt) => Math.min(500 * 2 ** attempt, 2_000),
    mutationFn: (replyId: string) => {
      if (!userId) throw new Error("로그인이 필요해요");
      return markReplyRead(replyId, userId);
    },
    // 캐시만 갱신한다. 재조회를 걸면 미읽음 N개가 7일치 스레드를 N번 다시 받는다.
    onSuccess: (_data, replyId) => markMemoReplyRead(qc, familyId ?? "", replyId, userId ?? ""),
  });
}

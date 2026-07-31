/**
 * 피드백 도메인 TanStack Query 훅.
 * 컴포넌트는 이 훅만 import(endpoints/feedback 직접 호출 금지).
 */
import { useMutation } from "@tanstack/react-query";
import {
  sendFeedback,
  type FeedbackInput,
  type FeedbackResult,
} from "@/lib/api/endpoints/feedback";

/** 문제 신고·문의·기능 제안 전송. 조회 캐시가 없어 무효화 불필요. */
export function useSendFeedback() {
  return useMutation<FeedbackResult, Error, FeedbackInput>({
    mutationFn: (input) => sendFeedback(input),
  });
}

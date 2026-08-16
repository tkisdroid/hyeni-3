import { isApiError } from "@/lib/api/errors";
import {
  resolveAiLimitExhaustionReason,
  type AiCreditPublicStatus,
} from "@/transform/aiCreditPublicStatus";

/** 전송 실패 코드(Worker 가 비-2xx { error } 로 응답)를 아이 톤 안내로. */
export function childAiChatFriendlyError(err: unknown, status: AiCreditPublicStatus | null): string {
  const code = isApiError(err) ? err.message : "";
  switch (code) {
    case "daily_limit_reached": {
      const reason = resolveAiLimitExhaustionReason(status);
      if (reason === "parent_safety_limit") {
        return "부모님이 정한 오늘 대화 횟수를 다 썼어! 내일 또 만나자 💜";
      }
      if (reason === "free_included_limit") {
        return "무료로 오늘 5번 다 이야기했어! 더 이야기하고 싶으면 부모님께 프리미엄을 부탁해 줘 💜";
      }
      if (reason === "premium_allowance_limit") {
        return "오늘 이야기할 수 있는 횟수를 다 썼어! 더 필요하면 부모님께 알려줘 💜";
      }
      return "오늘 이야기할 수 있는 횟수를 다 썼어! 부모님께 알려줘 💜";
    }
    case "feature_disabled":
      return "나 지금 잠깐 쉬는 중이야. 부모님께 켜 달라고 부탁해 줘 🙏";
    case "not_child":
    case "no_family":
      return "지금은 이야기할 수 없어. 부모님께 알려줘!";
    case "message_too_long":
      return "조금만 짧게 다시 말해 줄래? 😊";
    case "ai_request_in_progress":
      return "지금 바로 앞 말을 생각하고 있어. 잠깐만 기다려 줄래?";
    case "ai_credit_consumption_unavailable":
    case "family_entitlement_unavailable":
      return "지금은 횟수를 확인하지 못했어. 잠시 뒤에 다시 말해 줄래?";
    case "server_misconfigured":
      return "지금은 나를 켤 준비가 안 됐어. 부모님께 알려줘!";
    case "schedule_delete_parent_only":
      return "일정 지우는 건 부모님만 할 수 있어. 엄마나 아빠에게 말해 줄까?";
    case "schedule_actions_disabled":
      return "지금은 일정 기능이 꺼져 있어. 부모님께 켜 달라고 해 줘.";
    case "ai_failure":
    case "lookup_failed":
      return "지금은 생각이 잘 안 나. 조금 있다 다시 말해 줄래?";
    default:
      return "잠깐 연결이 안 됐어. 다시 말해 줄래? 💜";
  }
}

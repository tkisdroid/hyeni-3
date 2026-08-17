/**
 * AI 도메인 뷰모델 매퍼(순수).
 * 도메인 데이터(크레딧 상태·채팅 메시지)를 화면이 바로 쓰는 표현 형태로 변환한다.
 * 표현 데이터(캐릭터 이모지·색)는 화면이 유지하고, 여기서는 숫자/역할만 파생.
 */
import type { AiCreditStatus, AiChatMessage } from "@/lib/api/endpoints/ai";

/**
 * 크레딧 히어로에 표시할 "대화 가능한 남은 횟수".
 * 서버가 실제 남은 수(availableRemaining)를 주면 그 값을, 아니면 (오늘 남은 포함 + 구매 잔액)으로 파생.
 */
export function creditHeroAmount(status: AiCreditStatus): number {
  if (status.availableRemaining != null) return status.availableRemaining;
  return status.dailyIncludedRemaining + status.purchasedCredits;
}

/** 채팅 말풍선 역할(화면 CSS 클래스와 1:1: me = 아이, ai = AI 친구). */
export type ChatBubbleRole = "me" | "ai";

export interface ChatBubble {
  id: string;
  role: ChatBubbleRole;
  text: string;
  reportable?: boolean;
  /**
   * 오늘 대화를 다 써서 막힌 말풍선. 아이가 그 자리에서 부모에게 부탁할 수 있게
   * 말풍선 아래 버튼을 붙인다(설명만 하고 길을 안 주면 아이가 할 수 있는 게 없다).
   */
  creditExhausted?: boolean;
}

/** 도메인 메시지 → 말풍선. assistant → ai, 그 외(user) → me. */
export function messageToBubble(message: AiChatMessage): ChatBubble {
  return {
    id: message.id,
    role: message.role === "assistant" ? "ai" : "me",
    text: message.content,
    reportable: message.role === "assistant",
  };
}

/** 메시지 목록 → 말풍선 목록. */
export function messagesToBubbles(messages: AiChatMessage[]): ChatBubble[] {
  return messages.map(messageToBubble);
}

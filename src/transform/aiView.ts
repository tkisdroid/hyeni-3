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

/**
 * AI 답변의 마크다운 강조를 지운다.
 *
 * 말풍선은 `white-space: pre-wrap` 인 순수 텍스트라 마크다운을 해석하지 않는다.
 * 그래서 모델이 `**축구 연습**` 처럼 답하면 아이 화면에 별표가 그대로 보인다
 * (2026-08-17 실측: "혜니는 **레고**를 좋아한다고 말해줬어"). 아이에게 별표는 아무 뜻도 없다.
 *
 * 강조 기호만 벗기고 글자는 그대로 둔다. 수식·곱셈처럼 짝이 맞지 않는 별표는 건드리지 않는다.
 */
export function stripChatMarkdownEmphasis(text: string): string {
  if (typeof text !== "string" || !text) return "";
  return text
    .replace(/\*\*\*(?=\S)([\s\S]*?\S)\*\*\*/g, "$1")
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "$1")
    .replace(/(^|[\s(])\*(?=\S)([^*\n]*?\S)\*(?=[\s).,!?]|$)/g, "$1$2")
    .replace(/(^|[\s(])__(?=\S)([\s\S]*?\S)__(?=[\s).,!?]|$)/g, "$1$2");
}

/** 도메인 메시지 → 말풍선. assistant → ai, 그 외(user) → me. */
export function messageToBubble(message: AiChatMessage): ChatBubble {
  const isAssistant = message.role === "assistant";
  return {
    id: message.id,
    role: isAssistant ? "ai" : "me",
    text: isAssistant ? stripChatMarkdownEmphasis(message.content) : message.content,
    reportable: isAssistant,
  };
}

/** 메시지 목록 → 말풍선 목록. */
export function messagesToBubbles(messages: AiChatMessage[]): ChatBubble[] {
  return messages.map(messageToBubble);
}

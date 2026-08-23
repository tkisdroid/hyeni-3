import { AI_BUDDY_VOICE_HINT_LINE } from "./aiBuddyVoiceHint.ts";
import { DEFAULT_AI_FRIEND_NAME } from "./aiFriendName.ts";

/** 아이 홈에서 친구가 조용히 기다릴 때 보여 주는 기본 탭 안내(아이 모드 반말). */
export function aiBuddyHomeChatHintLine(friendName?: string | null): string {
  const name = friendName?.trim() || DEFAULT_AI_FRIEND_NAME;
  return `${name}를 눌러서 이야기해 봐!`;
}

export const AI_BUDDY_HOME_CHAT_HINT_LINE = aiBuddyHomeChatHintLine(DEFAULT_AI_FRIEND_NAME);

export interface AiBuddyFabBubbleInput {
  canPrompt: boolean;
  voiceHint: boolean;
  attentionStage: "grow" | "full" | null;
  attentionLine: string | null;
  wanderLine: string | null;
  friendName?: string | null;
}

export interface AiBuddyFabSettingsSnapshot {
  ai_enabled?: boolean | null;
  ai_friend_name?: string | null;
}

/** 설정이 아직 불확실하거나 부모가 껐으면 잘못된 화면을 열지 않는다. 캐시가 있으면 재조회 오류에도 유지한다. */
export function resolveAiBuddyFabTarget(input: {
  settings: AiBuddyFabSettingsSnapshot | null | undefined;
  loading: boolean;
  error: boolean;
}): "/child/ai-friend" | "/child/ai-friend-setup" | null {
  if (input.settings === undefined) return null;
  if (input.settings?.ai_enabled === false) return null;
  return input.settings?.ai_friend_name?.trim()
    ? "/child/ai-friend"
    : "/child/ai-friend-setup";
}

/**
 * 홈 말풍선 우선순위 정본.
 * 기능 안내와 지금 알아야 할 상황을 먼저 말하고, 아무 말도 없을 때만 탭 안내를 보여 준다.
 */
export function resolveAiBuddyFabBubbleLine(input: AiBuddyFabBubbleInput): string | null {
  if (!input.canPrompt) return null;
  if (input.voiceHint) return AI_BUDDY_VOICE_HINT_LINE;
  if (input.attentionStage === "grow" && input.attentionLine) return input.attentionLine;
  return input.wanderLine ?? aiBuddyHomeChatHintLine(input.friendName);
}

/**
 * 아이 AI 친구의 3D 표정. 대기 FAB 과 대화 화면이 같은 정본을 쓴다.
 * 서버가 emotion 을 주면 그걸 쓰고, 없으면 아이 말·답변·의도에서 고른다.
 */
export const CHILD_AI_EMOTIONS = [
  "idle",
  "listening",
  "thinking",
  "happy",
  "love",
  "celebrate",
  "sad",
  "worried",
  "pondering",
] as const;

export type ChildAiEmotion = (typeof CHILD_AI_EMOTIONS)[number];

const EMOTION_ASSETS: Record<ChildAiEmotion, string> = {
  idle: "mascot-status/status-happy.webp",
  listening: "mascot-status/status-pondering.webp",
  thinking: "mascot-status/status-busy.webp",
  happy: "mascot-status/status-happy.webp",
  love: "mascot-status/status-love.webp",
  celebrate: "mascot-status/status-celebrate.webp",
  sad: "mascot-status/status-sad.webp",
  worried: "mascot-status/status-danger.webp",
  pondering: "mascot-status/status-pondering.webp",
};

const EMOTION_SET = new Set<string>(CHILD_AI_EMOTIONS);

export function isChildAiEmotion(value: unknown): value is ChildAiEmotion {
  return typeof value === "string" && EMOTION_SET.has(value);
}

export function childAiEmotionAsset(emotion: ChildAiEmotion): string {
  return EMOTION_ASSETS[emotion];
}

export function parseChildAiEmotion(value: unknown, fallback: ChildAiEmotion = "idle"): ChildAiEmotion {
  return isChildAiEmotion(value) ? value : fallback;
}

function compact(text: unknown): string {
  return String(text || "").replace(/\s+/g, " ").trim();
}

export function inferChildAiEmotion(input: {
  userText?: string;
  reply?: string;
  intent?: string;
  toolName?: string | null;
  listening?: boolean;
  thinking?: boolean;
}): ChildAiEmotion {
  if (input.listening) return "listening";
  if (input.thinking) return "thinking";

  const intent = String(input.intent || "");
  const toolName = String(input.toolName || "");
  const blob = `${compact(input.userText)} ${compact(input.reply)}`;

  if (intent === "safety_risk" || /위험|무서|걱정되는 일/.test(blob)) return "worried";
  if (intent === "emotional_support") {
    if (/슬프|속상|외로|울었|화났|짜증/.test(blob)) return "sad";
    return "love";
  }
  if (
    toolName === "createSchedule"
    || toolName === "createDailyItem"
    || toolName === "setChildAccent"
    || intent === "schedule_create"
    || intent === "daily_item_create"
    || intent === "settings_accent"
  ) {
    return "celebrate";
  }
  if (intent === "schedule_delete_parent_only" || intent === "parent_locked_setting") return "pondering";
  if (/사랑|보고 싶|고마워|최고/.test(blob)) return "love";
  if (/슬프|속상|외로|울었/.test(blob)) return "sad";
  if (/신나|축하|해냈다|완료|추가했어/.test(blob)) return "celebrate";
  if (/안녕|반가|좋아|재밌/.test(blob)) return "happy";
  return "happy";
}

export function childAiEmotionStorageKey(familyId?: string | null, userId?: string | null): string {
  if (!familyId || !userId) return "";
  return `hyeni-child-ai-emotion-v1:${familyId}:${userId}`;
}

export function readStoredChildAiEmotion(
  storage: Pick<Storage, "getItem"> | null | undefined,
  familyId?: string | null,
  userId?: string | null,
): ChildAiEmotion {
  const key = childAiEmotionStorageKey(familyId, userId);
  if (!key || !storage) return "idle";
  try {
    return parseChildAiEmotion(storage.getItem(key), "idle");
  } catch {
    return "idle";
  }
}

export function writeStoredChildAiEmotion(
  storage: Pick<Storage, "setItem"> | null | undefined,
  familyId: string | null | undefined,
  userId: string | null | undefined,
  emotion: ChildAiEmotion,
): void {
  const key = childAiEmotionStorageKey(familyId, userId);
  if (!key || !storage) return;
  try {
    storage.setItem(key, emotion);
  } catch {
    /* 기기 저장 실패는 표정을 기억하지 못할 뿐 */
  }
}

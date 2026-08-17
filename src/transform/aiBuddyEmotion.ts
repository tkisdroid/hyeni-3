/**
 * 아이모드 AI 친구의 표정 정본.
 *
 * 플로팅 버튼(AiBuddyFab)과 대화 화면(AiFriendChat)이 같은 얼굴을 쓰도록 판정을 한 곳에 모은다.
 * 화면마다 자기 규칙을 두면 같은 순간에 버튼과 아바타가 다른 표정을 지어 "살아 있는 친구"가 깨진다.
 *
 * 설계 원칙
 *  · 아이가 속상할 때 친구는 같이 슬퍼하지 않고 다독인다(caring). 곁에 있어 주는 얼굴이 먼저다.
 *  · sad 는 "네 부탁을 못 들어줬어"처럼 친구 자신의 실패를 정직하게 알릴 때만 쓴다(가짜 웃음 금지).
 *  · 판정은 순수 함수다. localStorage·시계·DOM 을 읽지 않고 호출부가 값을 넘긴다.
 */

export const AI_BUDDY_EMOTIONS = [
  "idle",
  "happy",
  "excited",
  "thinking",
  "caring",
  "sad",
  "sleepy",
  "cheer",
] as const;

export type AiBuddyEmotion = (typeof AI_BUDDY_EMOTIONS)[number];

/** 표정을 바꾼 뒤 대기 얼굴로 돌아오기까지. 너무 짧으면 감정이 안 읽히고 길면 굳어 보인다. */
export const AI_BUDDY_EMOTION_HOLD_MS = 12_000;

/** 눈 깜빡임 간격(대기 중 살아 있는 느낌). */
export const AI_BUDDY_BLINK_INTERVAL_MS = 4_200;
export const AI_BUDDY_BLINK_DURATION_MS = 160;

export function isAiBuddyEmotion(value: unknown): value is AiBuddyEmotion {
  return typeof value === "string" && (AI_BUDDY_EMOTIONS as readonly string[]).includes(value);
}

/** 표정 webp 경로(asset() 접두 전). blink 는 감정이 아니라 대기 애니메이션 프레임이다. */
export function aiBuddyFaceAsset(emotion: AiBuddyEmotion | "blink"): string {
  return `ai-buddy/${emotion}.webp`;
}

/** 스크린리더용 표정 설명 — 얼굴만으로는 전달되지 않는다. */
const EMOTION_LABEL: Record<AiBuddyEmotion, string> = {
  idle: "기다리는 표정",
  happy: "웃는 표정",
  excited: "신난 표정",
  thinking: "생각하는 표정",
  caring: "걱정하며 다독이는 표정",
  sad: "미안해하는 표정",
  sleepy: "졸린 표정",
  cheer: "응원하는 표정",
};

export function aiBuddyEmotionLabel(emotion: AiBuddyEmotion): string {
  return EMOTION_LABEL[emotion];
}

/**
 * 대화 화면 헤더에 보이는 한 줄(반말).
 * 화면에는 "신난 표정" 같은 설명이 아니라 친구가 하는 말이 보여야 유대감이 생긴다.
 * 설명문(EMOTION_LABEL)은 스크린리더 전용으로 남긴다.
 */
const EMOTION_STATUS: Record<AiBuddyEmotion, string> = {
  idle: "이야기할 준비됐어!",
  happy: "너랑 얘기하니까 좋아",
  excited: "우와, 신난다!",
  thinking: "생각하는 중이야…",
  caring: "네 얘기 듣고 있어",
  sad: "미안, 그건 잘 안 됐어",
  sleepy: "조금 졸려…",
  cheer: "완전 잘했어!",
};

export function aiBuddyStatusLine(emotion: AiBuddyEmotion): string {
  return EMOTION_STATUS[emotion];
}

function hasAny(text: string, words: readonly string[]): boolean {
  return words.some((word) => text.includes(word));
}

/** 아이가 속상함을 드러내는 말 — 다독이는 표정으로 간다. */
const UPSET_WORDS = [
  "슬퍼", "슬프", "속상", "우울", "눈물", "울었", "울고", "외로", "힘들", "서운",
  "무서", "걱정", "짜증", "화나", "화가", "싫어", "미워", "아파", "아팠", "다쳤",
  "혼났", "혼나", "실수했", "망했",
] as const;

/** 즐거움·웃음 신호. */
const JOY_WORDS = [
  "ㅋㅋ", "ㅎㅎ", "재밌", "재미있", "재미", "좋아", "좋았", "신나", "신남", "행복",
  "기뻐", "기쁘", "하하", "야호", "우와", "와아", "히히",
] as const;

/** 칭찬·축하·응원 신호. */
const CHEER_WORDS = [
  "축하", "잘했", "잘 했", "대단", "최고", "멋지", "멋있", "훌륭", "파이팅", "화이팅",
  "응원", "해냈", "성공", "1등", "일등", "상 받", "상 탔", "칭찬",
  "100점", "만점", "이겼", "우승", "합격", "다 맞", "붙었",
] as const;

export interface AiBuddyEmotionInput {
  /**
   * idle  = 그냥 떠 있는 상태
   * thinking = 답을 기다리는 중
   * reply = 방금 답이 도착함
   */
  phase: "idle" | "thinking" | "reply";
  /** 아이가 방금 보낸 말. */
  childText?: string | null;
  /** AI 친구의 답. */
  replyText?: string | null;
  /** 도구 실행 결과(일정 등록·알림 변경·부모 메시지 등). */
  toolResult?: { ok?: unknown; confirmationRequired?: unknown } | null;
  /** 서버 안전 판정(none|low|medium|high). */
  safetyRiskLevel?: string | null;
  /** 대기 표정용 KST 시각(0~23). 모르면 null — 졸린 표정을 지어내지 않는다. */
  hourOfDay?: number | null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * 아이가 조용히 앱을 보고 있을 때의 표정.
 * 밤(22~05시)에는 졸린 얼굴로 "이제 잘 시간"을 은근히 알린다. 시각을 모르면 기본 대기 얼굴.
 */
export function aiBuddyIdleEmotion(hourOfDay?: number | null): AiBuddyEmotion {
  if (typeof hourOfDay !== "number" || !Number.isFinite(hourOfDay)) return "idle";
  const hour = Math.floor(hourOfDay);
  if (hour < 0 || hour > 23) return "idle";
  return hour >= 22 || hour < 6 ? "sleepy" : "idle";
}

export function resolveAiBuddyEmotion(input: AiBuddyEmotionInput): AiBuddyEmotion {
  // 답을 기다리는 동안은 무조건 생각하는 얼굴 — 대기 중인지 아이가 알아야 한다.
  if (input.phase === "thinking") return "thinking";

  const risk = text(input.safetyRiskLevel);
  // 안전 신호가 잡히면 어떤 즐거운 단어가 섞여 있어도 다독이는 얼굴이 먼저다.
  if (risk === "medium" || risk === "high") return "caring";

  const child = text(input.childText);
  const reply = text(input.replyText);

  if (input.phase === "reply") {
    const tool = input.toolResult;
    if (tool) {
      // 부탁을 실제로 해냈을 때만 신난 얼굴. 확인이 남았으면 아직 해낸 게 아니다.
      if (tool.ok === true && tool.confirmationRequired !== true) return "excited";
      if (tool.ok === false) return "sad";
    }
    if (hasAny(child, UPSET_WORDS)) return "caring";
    if (hasAny(reply, CHEER_WORDS) || hasAny(child, CHEER_WORDS)) return "cheer";
    if (hasAny(child, JOY_WORDS) || hasAny(reply, JOY_WORDS)) return "happy";
    // 답이 도착했으면 기본은 웃는 얼굴 — 친구가 반겨 주는 느낌을 유지한다.
    return "happy";
  }

  // idle 단계에서도 아이가 방금 한 말은 반영한다(전송 직후 버튼이 먼저 반응).
  if (hasAny(child, UPSET_WORDS)) return "caring";
  if (hasAny(child, CHEER_WORDS)) return "cheer";
  if (hasAny(child, JOY_WORDS)) return "happy";
  return aiBuddyIdleEmotion(input.hourOfDay);
}

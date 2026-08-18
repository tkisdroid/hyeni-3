/**
 * 아이 AI 친구의 음성 대화 설정.
 *
 * 아이는 타자보다 말이 빠르다. 마이크로 말을 걸고 답을 귀로 들으면 "글 쓰는 앱"이 아니라
 * "친구와 이야기하는" 경험이 된다. 읽어주기는 서버 컬럼이 없어 내 색깔(accent)과 같은 방식으로
 * 가족+아이 키의 localStorage 에만 저장한다(기기별 설정).
 */
import type { SupportedLocale } from "@/i18n/locale";

/** 앱 locale → 음성 인식·합성 언어 태그. AiSchedule 과 같은 표를 쓴다. */
export const SPEECH_LOCALE: Record<SupportedLocale, string> = {
  ko: "ko-KR",
  en: "en-US",
  ja: "ja-JP",
  "zh-CN": "zh-CN",
  "zh-TW": "zh-TW",
  vi: "vi-VN",
  th: "th-TH",
  id: "id-ID",
  ms: "ms-MY",
  fil: "fil-PH",
};

export type AiChatTurnSource =
  | "composer"
  | "voice"
  | "confirm"
  | `suggestion:${string}`;

export function shouldSpeakAiReply({
  source,
  persistentEnabled,
  hasReply,
}: {
  source: AiChatTurnSource;
  persistentEnabled: boolean;
  hasReply: boolean;
}): boolean {
  return hasReply && (source === "voice" || persistentEnabled);
}

const VOICE_REPLY_PREFIX = "hyeni-child-voice-reply-";

function storageKey(familyId: string | null, userId: string | null): string {
  return `${VOICE_REPLY_PREFIX}${familyId ?? "nofamily"}:${userId ?? "nouser"}`;
}

/**
 * 읽어주기 켜짐 여부. 기본값은 **꺼짐**이다 —
 * 교실·도서관에서 앱을 열었을 때 아이 동의 없이 소리가 나면 안 된다.
 */
export function readChildVoiceReplyEnabled(
  familyId: string | null,
  userId: string | null,
): boolean {
  try {
    return window.localStorage.getItem(storageKey(familyId, userId)) === "on";
  } catch {
    return false;
  }
}

export function writeChildVoiceReplyEnabled(
  familyId: string | null,
  userId: string | null,
  enabled: boolean,
): void {
  try {
    window.localStorage.setItem(storageKey(familyId, userId), enabled ? "on" : "off");
  } catch {
    /* 저장 실패(프라이빗 모드 등)는 세션 내 선택만 유지 */
  }
}

/**
 * 읽어줄 때 화면 표시용 마커를 빼고 읽는다.
 * 사진·위치 마커를 그대로 읽으면 "이미지 콜론 에프 나누기…"처럼 들린다.
 */
export function speakableReplyText(text: string): string {
  if (typeof text !== "string" || !text) return "";
  return text
    .replace(/\[\[img:[^\]]*\]\]/g, " ")
    .replace(/\[\[loc:[^|\]]*\|([^\]]*)\]\]/g, "$1")
    .replace(/\[\[loc:[^\]]*\]\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 플로팅 AI 친구 버튼의 "꾹 누르면 바로 말할 수 있어" 안내 정본(순수 계산).
 *
 * 왜 필요한가(2026-08-19 TK 지시): 길게 누르면 마이크가 바로 켜져 말로 대화할 수 있는데,
 * 아이는 그런 기능이 있는지 알 방법이 없다. 버튼이 스스로 알려 줘야 한다.
 *
 * 원칙
 *  · **한 번 써 본 아이에게는 다시 알리지 않는다.** 아는 걸 계속 알려 주면 잔소리다.
 *  · 아직 안 써 본 아이에게도 하루 한 번, 최대 세 번까지만 말한다.
 *  · 판정은 순수 함수다. 시계·저장소는 호출부가 넘긴다(테스트가 시간을 고정할 수 있게).
 */

/** 이만큼 누르고 있으면 "말하기"로 본다. 탭(열기)과 확실히 구분되는 길이. */
export const AI_BUDDY_VOICE_LONG_PRESS_MS = 550;

/** 안내 말풍선이 보이는 시간(ms). 배회 말풍선보다 조금 길게 — 읽고 이해해야 한다. */
export const AI_BUDDY_VOICE_HINT_MS = 3_400;

/** 화면에 뜨자마자 말을 걸면 놀란다. 이만큼 지나고 나서 알린다. */
export const AI_BUDDY_VOICE_HINT_DELAY_MS = 3_000;

/** 아직 안 써 본 아이에게 알려 주는 최대 횟수. */
export const AI_BUDDY_VOICE_HINT_MAX_SHOWN = 3;

/** 같은 안내를 다시 하기까지의 최소 간격(하루). */
export const AI_BUDDY_VOICE_HINT_MIN_GAP_MS = 20 * 60 * 60 * 1_000;

/** 아이에게 보여 주는 한 마디(반말). 무엇을 하면 무엇이 되는지 한 문장으로만 말한다. */
export const AI_BUDDY_VOICE_HINT_LINE = "꾹 누르면 바로 말할 수 있어!";

export interface AiBuddyVoiceHintState {
  /** 지금까지 알려 준 횟수. */
  shownCount: number;
  /** 마지막으로 알려 준 시각(ms). 알린 적 없으면 null. */
  lastShownAtMs: number | null;
  /** 아이가 실제로 길게 눌러 말하기를 써 봤는지. */
  used: boolean;
}

export const EMPTY_AI_BUDDY_VOICE_HINT_STATE: AiBuddyVoiceHintState = {
  shownCount: 0,
  lastShownAtMs: null,
  used: false,
};

/**
 * 저장된 값을 믿지 않고 좁힌다. `Number(null) === 0` 함정을 피하려 typeof 로 먼저 막는다
 * (숫자가 아닌 값이 0 으로 둔갑하면 "방금 알렸다"가 "1970년에 알렸다"가 된다).
 */
export function normalizeAiBuddyVoiceHintState(raw: unknown): AiBuddyVoiceHintState {
  if (!raw || typeof raw !== "object") return EMPTY_AI_BUDDY_VOICE_HINT_STATE;
  const record = raw as Record<string, unknown>;
  const shownCount = typeof record.shownCount === "number" && Number.isFinite(record.shownCount)
    ? Math.max(0, Math.floor(record.shownCount))
    : 0;
  const lastShownAtMs = typeof record.lastShownAtMs === "number" && Number.isFinite(record.lastShownAtMs)
    ? record.lastShownAtMs
    : null;
  return { shownCount, lastShownAtMs, used: record.used === true };
}

/** 지금 안내를 띄워도 되는지. 하나라도 걸리면 조용히 있는다. */
export function shouldShowAiBuddyVoiceHint(
  state: AiBuddyVoiceHintState,
  nowMs: number,
): boolean {
  if (state.used) return false;
  if (state.shownCount >= AI_BUDDY_VOICE_HINT_MAX_SHOWN) return false;
  if (state.lastShownAtMs === null) return true;
  return nowMs - state.lastShownAtMs >= AI_BUDDY_VOICE_HINT_MIN_GAP_MS;
}

/** 알린 뒤의 상태. */
export function markAiBuddyVoiceHintShown(
  state: AiBuddyVoiceHintState,
  nowMs: number,
): AiBuddyVoiceHintState {
  return { ...state, shownCount: state.shownCount + 1, lastShownAtMs: nowMs };
}

/** 아이가 실제로 써 본 뒤의 상태 — 이제 더 알리지 않는다. */
export function markAiBuddyVoiceHintUsed(state: AiBuddyVoiceHintState): AiBuddyVoiceHintState {
  return { ...state, used: true };
}

/** 저장 키 — 가족·아이별로 분리해 기기를 같이 쓰는 형제끼리 섞이지 않게 한다. */
export function aiBuddyVoiceHintStorageKey(
  familyId: string | null,
  userId: string | null,
): string {
  return `hyeni-ai-buddy-voice-hint-v1:${familyId ?? "nofamily"}:${userId ?? "nouser"}`;
}

export function readAiBuddyVoiceHintState(key: string): AiBuddyVoiceHintState {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return EMPTY_AI_BUDDY_VOICE_HINT_STATE;
    return normalizeAiBuddyVoiceHintState(JSON.parse(raw));
  } catch {
    return EMPTY_AI_BUDDY_VOICE_HINT_STATE;
  }
}

export function writeAiBuddyVoiceHintState(key: string, state: AiBuddyVoiceHintState): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // 저장 실패는 기능을 막지 않는다(이번 세션 안내만 유지).
  }
}

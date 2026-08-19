/**
 * 플로팅 AI 친구가 스스로 아이를 부르는 순간의 정본(순수 계산, 2026-08-19 TK 지시).
 *
 * 왜 필요한가: 아이는 구석의 작은 버튼을 그냥 지나친다. 친구가 가끔 **커졌다가 화면을 채우고
 * 다시 작아지면서** 말을 걸어야 "저게 뭐지?" 하고 눌러 본다. 다만 이건 아이 화면을 잠깐
 * 가리는 동작이라, 자주 하면 방해가 되고 부모가 끌 수 없으면 안 된다.
 *
 * 원칙
 *  · **부모가 끌 수 있다.** `enabled=false` 면 어떤 경우에도 부르지 않는다(서버 설정 정본).
 *  · 하루 횟수와 최소 간격을 둔다. 계속 튀어나오면 아이가 앱을 싫어하게 된다.
 *  · 화면을 채우는 큰 동작은 몇 번에 한 번뿐이고, 나머지는 살짝 커졌다 작아진다.
 *  · 움직임 줄이기·화면 숨김·드래그 직후·대화 감정 표시 중에는 부르지 않는다(배회와 같은 게이트).
 *  · 판정은 순수 함수다. 시계·저장소는 호출부가 넘긴다(테스트가 시간을 고정할 수 있게).
 */

/** 부르는 방식. grow=살짝 커졌다 작아짐, full=화면을 채우고 말을 건 뒤 제자리로. */
export type AiBuddyAttentionStage = "grow" | "full";

/** 부를 때가 됐는지 확인하는 주기(ms). 판정은 가볍고 실제 부름은 간격 제한이 막는다. */
export const AI_BUDDY_ATTENTION_TICK_MS = 15_000;

/** 화면에 들어온 뒤 첫 부름까지. 들어오자마자 튀어나오면 놀란다. */
export const AI_BUDDY_ATTENTION_FIRST_DELAY_MS = 20_000;
/** 다시 부르기까지의 최소 간격. */
export const AI_BUDDY_ATTENTION_MIN_GAP_MS = 5 * 60 * 1_000;
/** 하루에 부를 수 있는 최대 횟수(가족+아이 기준). */
export const AI_BUDDY_ATTENTION_MAX_PER_DAY = 8;
/** 몇 번에 한 번 화면을 채우는가. 나머지는 살짝 커졌다 작아진다. */
export const AI_BUDDY_ATTENTION_FULL_EVERY = 3;
/** 커졌다 작아지는 동작이 이어지는 시간(ms). */
export const AI_BUDDY_ATTENTION_GROW_MS = 2_600;
/** 화면을 채우고 말을 거는 시간(ms). 이 시간이 지나면 스스로 물러난다. */
export const AI_BUDDY_ATTENTION_FULL_MS = 3_800;

export interface AiBuddyAttentionState {
  /** 이 상태가 기록된 날(Asia/Seoul 기준 YYYY-MM-DD). 날이 바뀌면 횟수를 다시 센다. */
  dayKey: string;
  /** 오늘 부른 횟수. */
  shownToday: number;
  /** 마지막으로 부른 시각(ms). 부른 적 없으면 null. */
  lastAtMs: number | null;
  /** 지금까지 부른 총 횟수 — 커지기/화면 채우기를 번갈아 고르는 데 쓴다. */
  totalShown: number;
}

export const EMPTY_AI_BUDDY_ATTENTION_STATE: AiBuddyAttentionState = {
  dayKey: "",
  shownToday: 0,
  lastAtMs: null,
  totalShown: 0,
};

/** Asia/Seoul 기준 날짜 키. 하루 횟수는 아이가 사는 시간대로 센다. */
export function aiBuddyAttentionDayKey(nowMs: number): string {
  if (!Number.isFinite(nowMs)) return "";
  const kst = new Date(nowMs + 9 * 60 * 60 * 1_000);
  const month = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const day = String(kst.getUTCDate()).padStart(2, "0");
  return `${kst.getUTCFullYear()}-${month}-${day}`;
}

/**
 * 저장된 값을 믿지 않고 좁힌다. `Number(null) === 0` 함정을 typeof 로 먼저 막는다
 * (숫자가 아닌 값이 0 으로 둔갑하면 "방금 불렀다"가 "1970년에 불렀다"가 된다).
 */
export function normalizeAiBuddyAttentionState(raw: unknown): AiBuddyAttentionState {
  if (!raw || typeof raw !== "object") return EMPTY_AI_BUDDY_ATTENTION_STATE;
  const record = raw as Record<string, unknown>;
  const count = (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return {
    dayKey: typeof record.dayKey === "string" ? record.dayKey : "",
    shownToday: count(record.shownToday),
    totalShown: count(record.totalShown),
    lastAtMs: typeof record.lastAtMs === "number" && Number.isFinite(record.lastAtMs)
      ? record.lastAtMs
      : null,
  };
}

/** 오늘 기준으로 다시 센 상태. 날이 바뀌었으면 오늘 횟수는 0 이다. */
export function aiBuddyAttentionToday(
  state: AiBuddyAttentionState,
  nowMs: number,
): AiBuddyAttentionState {
  const dayKey = aiBuddyAttentionDayKey(nowMs);
  if (state.dayKey === dayKey) return state;
  return { ...state, dayKey, shownToday: 0 };
}

export interface AiBuddyAttentionGate {
  /** 부모 설정(+AI 친구 켜짐)이 허용하는지. false 면 어떤 조건에서도 부르지 않는다. */
  enabled: boolean;
  /** 아이가 지금 버튼을 끌고 있는지. */
  dragging: boolean;
  /** 대화 감정을 보여 주는 중인지(실제 대화가 우선이다). */
  showingEmotion: boolean;
  /** 화면이 보이는 상태인지(document.hidden 반대). */
  visible: boolean;
  /** 움직임 줄이기 설정. */
  reducedMotion: boolean;
  /** 마지막으로 아이가 직접 옮긴 뒤 지난 시간(ms). 옮긴 적 없으면 null. */
  msSinceDrag: number | null;
  /** 이 화면에 들어온 뒤 지난 시간(ms). */
  msSinceMount: number;
  state: AiBuddyAttentionState;
  nowMs: number;
}

/** 아이가 방금 자리를 옮겼으면 그동안은 조용히 있는다(배회와 같은 유예). */
export const AI_BUDDY_ATTENTION_PAUSE_AFTER_DRAG_MS = 20_000;

/** 지금 불러도 되는지. 하나라도 걸리면 조용히 있는다. */
export function shouldPlayAiBuddyAttention(gate: AiBuddyAttentionGate): boolean {
  if (!gate.enabled) return false;
  if (gate.dragging || gate.showingEmotion || gate.reducedMotion || !gate.visible) return false;
  if (gate.msSinceMount < AI_BUDDY_ATTENTION_FIRST_DELAY_MS) return false;
  if (gate.msSinceDrag !== null && gate.msSinceDrag < AI_BUDDY_ATTENTION_PAUSE_AFTER_DRAG_MS) {
    return false;
  }
  const today = aiBuddyAttentionToday(gate.state, gate.nowMs);
  if (today.shownToday >= AI_BUDDY_ATTENTION_MAX_PER_DAY) return false;
  if (today.lastAtMs === null) return true;
  return gate.nowMs - today.lastAtMs >= AI_BUDDY_ATTENTION_MIN_GAP_MS;
}

/**
 * 이번에 어떤 방식으로 부를지. 첫 부름은 눈에 띄게 화면을 채우고,
 * 그 뒤로는 세 번에 한 번만 채운다(매번 채우면 방해가 된다).
 */
export function aiBuddyAttentionStage(totalShown: number): AiBuddyAttentionStage {
  const shown = Number.isFinite(totalShown) ? Math.max(0, Math.floor(totalShown)) : 0;
  return shown % AI_BUDDY_ATTENTION_FULL_EVERY === 0 ? "full" : "grow";
}

/** 그 방식이 화면에 머무는 시간(ms). */
export function aiBuddyAttentionDurationMs(stage: AiBuddyAttentionStage): number {
  return stage === "full" ? AI_BUDDY_ATTENTION_FULL_MS : AI_BUDDY_ATTENTION_GROW_MS;
}

/** 부른 뒤의 상태. */
export function markAiBuddyAttentionShown(
  state: AiBuddyAttentionState,
  nowMs: number,
): AiBuddyAttentionState {
  const today = aiBuddyAttentionToday(state, nowMs);
  return {
    dayKey: today.dayKey,
    shownToday: today.shownToday + 1,
    totalShown: today.totalShown + 1,
    lastAtMs: nowMs,
  };
}

/** 저장 키 — 가족·아이별로 분리해 기기를 같이 쓰는 형제끼리 섞이지 않게 한다. */
export function aiBuddyAttentionStorageKey(
  familyId: string | null,
  userId: string | null,
): string {
  return `hyeni-ai-buddy-attention-v1:${familyId ?? "nofamily"}:${userId ?? "nouser"}`;
}

export function readAiBuddyAttentionState(key: string): AiBuddyAttentionState {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return EMPTY_AI_BUDDY_ATTENTION_STATE;
    return normalizeAiBuddyAttentionState(JSON.parse(raw));
  } catch {
    return EMPTY_AI_BUDDY_ATTENTION_STATE;
  }
}

export function writeAiBuddyAttentionState(key: string, state: AiBuddyAttentionState): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // 저장 실패는 기능을 막지 않는다(이번 세션 횟수만 유지).
  }
}

/**
 * 대기 중 AI 친구가 화면을 돌아다니는 경로(순수 계산, 2026-08-18 TK 지시).
 *
 * 원칙
 *  · 아이가 직접 옮긴 자리는 그 아이의 선택이다 — 돌아다님은 **임시**이고 저장하지 않는다.
 *  · 한 번에 조금씩(최대 0.34비율) 움직여 "걸어간다"로 읽히게 한다. 순간 이동은 놀라게 한다.
 *  · 가장자리 근처에 머무른다(가운데를 가로지르면 아이가 보는 내용을 가린다).
 *  · 같은 step 이면 같은 결과다(시드 기반). 테스트가 경로를 그대로 고정할 수 있다.
 *  · 움직임을 줄인 기기·드래그 중·대화 감정 표시 중에는 호출부가 아예 부르지 않는다.
 */
import {
  AI_BUDDY_IDLE_MOTIONS,
  type AiBuddyChatFace,
} from "./aiBuddyEmotion.ts";
import type { AiBuddyFabRatio } from "./aiBuddyFabPosition.ts";

/** 한 걸음 간격(ms) — 너무 짧으면 산만하고 길면 멈춰 있는 것처럼 보인다. */
export const AI_BUDDY_WANDER_STEP_MS = 9_000;
/** 아이가 직접 옮긴 뒤 이 시간 동안은 그 자리에 그대로 있는다. */
export const AI_BUDDY_WANDER_PAUSE_AFTER_DRAG_MS = 20_000;
/** 한 걸음의 최대 이동량(비율). */
export const AI_BUDDY_WANDER_MAX_STEP = 0.34;
/** 가장자리에서 이만큼 안쪽까지만 다닌다(0=완전 왼쪽/위, 1=오른쪽/아래). */
export const AI_BUDDY_WANDER_VERTICAL_MIN = 0.08;
export const AI_BUDDY_WANDER_VERTICAL_MAX = 0.92;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 정수 step → 0~1 난수(결정적). 같은 값이면 항상 같은 결과다. */
function seeded(step: number, salt: number): number {
  const value = Math.sin((step + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

/**
 * 다음 걸음 위치. x 는 좌우 가장자리(0 또는 1) 사이를 오가고, y 는 조금씩 오르내린다.
 * 세 걸음마다 반대쪽 가장자리로 건너가 화면을 넓게 돌아다니는 느낌을 준다.
 */
export function nextAiBuddyWanderRatio(
  current: AiBuddyFabRatio,
  step: number,
): AiBuddyFabRatio {
  const crossing = step % 3 === 2;
  const x = crossing ? (current.xRatio >= 0.5 ? 0 : 1) : current.xRatio >= 0.5 ? 1 : 0;
  const direction = seeded(step, 1) >= 0.5 ? 1 : -1;
  const distance = 0.12 + seeded(step, 2) * (AI_BUDDY_WANDER_MAX_STEP - 0.12);
  let y = current.yRatio + direction * distance;
  if (y < AI_BUDDY_WANDER_VERTICAL_MIN || y > AI_BUDDY_WANDER_VERTICAL_MAX) {
    y = current.yRatio - direction * distance;
  }
  return {
    xRatio: x,
    yRatio: clamp(y, AI_BUDDY_WANDER_VERTICAL_MIN, AI_BUDDY_WANDER_VERTICAL_MAX),
  };
}

/** 자리를 옮기는 동안은 실제 달리는 3D 포즈를 써서 위치 변화가 순간 이동처럼 보이지 않게 한다. */
export const AI_BUDDY_WANDER_MOVING_FACE: AiBuddyChatFace = "excited";

/**
 * 도착해서 짓는 얼굴 후보. 대기 포즈 목록에는 이동 중 달리는 얼굴(excited)을 넣지 않아
 * "멈춰 서서 말을 거는" 순간이 분명하게 바뀐다.
 */
const ARRIVAL_FACES: readonly AiBuddyChatFace[] = AI_BUDDY_IDLE_MOTIONS;

/**
 * 그 걸음에서 지을 표정. 자리를 옮기는 동안은 두리번거리고,
 * 도착하면 인사·궁금함처럼 아이에게 말을 걸 듯한 얼굴을 짓는다.
 */
export function aiBuddyWanderFace(step: number, moving: boolean): AiBuddyChatFace {
  if (moving) return AI_BUDDY_WANDER_MOVING_FACE;
  const index = Math.floor(seeded(step, 3) * ARRIVAL_FACES.length);
  return ARRIVAL_FACES[Math.min(index, ARRIVAL_FACES.length - 1)];
}

/** 말풍선을 띄우는 걸음 주기 — 매번 말을 걸면 잔소리가 된다. */
export const AI_BUDDY_WANDER_LINE_EVERY = 3;
/** 말풍선이 보이는 시간(ms). 읽을 만큼만 두고 사라진다. */
export const AI_BUDDY_WANDER_LINE_MS = 2_600;

/**
 * 도착해서 아이에게 건네는 한 마디(반말). 표정과 뜻이 맞아야 친구로 읽힌다.
 * 이동 중(excited)·입력 표시(typing)·탭 반응(quick)에는 말을 걸지 않는다.
 */
const WANDER_LINE: Partial<Record<AiBuddyChatFace, string>> = {
  greeting: "안녕!",
  curious: "뭐 해?",
  explore: "같이 찾아볼까?",
  music: "노래 듣는 중~",
  idea: "생각났어!",
  love: "보고 싶었어",
  shy: "히히",
  wink: "나 여기 있어",
  waiting: "얘기하자!",
  talking: "할 말 있어!",
};

/** 그 표정에서 건넬 한 마디. 말을 걸지 않는 표정이면 null. */
export function aiBuddyWanderLine(face: AiBuddyChatFace): string | null {
  return WANDER_LINE[face] ?? null;
}

/** 이 걸음에서 말풍선을 띄울지. 세 걸음마다 한 번만 말을 건다. */
export function shouldShowAiBuddyWanderLine(step: number): boolean {
  return step > 0 && step % AI_BUDDY_WANDER_LINE_EVERY === 0;
}

export interface AiBuddyWanderGate {
  /** 아이가 지금 버튼을 끌고 있는지. */
  dragging: boolean;
  /** 대화 감정을 보여 주는 중인지(감정 표시가 우선이다). */
  showingEmotion: boolean;
  /** 화면이 보이는 상태인지(document.hidden 반대). */
  visible: boolean;
  /** 움직임 줄이기 설정. */
  reducedMotion: boolean;
  /** 마지막으로 아이가 직접 옮긴 뒤 지난 시간(ms). 옮긴 적 없으면 null. */
  msSinceDrag: number | null;
}

/** 지금 돌아다녀도 되는지. 하나라도 걸리면 제자리에 머문다. */
export function canAiBuddyWander(gate: AiBuddyWanderGate): boolean {
  if (gate.dragging || gate.showingEmotion || gate.reducedMotion || !gate.visible) return false;
  if (gate.msSinceDrag !== null && gate.msSinceDrag < AI_BUDDY_WANDER_PAUSE_AFTER_DRAG_MS) return false;
  return true;
}

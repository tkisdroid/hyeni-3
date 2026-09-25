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
import type { IntlShape } from "react-intl";
import type { MessageId } from "../i18n/generated/messageIds.ts";

/** 한 걸음 간격(ms) — 너무 짧으면 산만하고 길면 멈춰 있는 것처럼 보인다. */
export const AI_BUDDY_WANDER_STEP_MS = 9_000;
/** 한 걸음이 화면에서 이어지는 시간(ms). 위치 이동과 달리기·착지 연출이 함께 끝난다. */
export const AI_BUDDY_WANDER_TRAVEL_MS = 1_500;
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

/** 멈춰 설 후보를 훑는 세로 간격(비율). */
export const AI_BUDDY_WANDER_SCAN_STEP = 0.06;

/**
 * 멈춰 설 자리 후보를 가까운 순서로 돌려준다(2026-09-25 브라우저 QA — 떠다니는 친구가 홈 타일·
 * 준비물 삭제 버튼을 덮어 아이가 누른 곳 대신 친구가 눌렸다).
 * 호출부는 앞에서부터 "아래에 누를 수 있는 것이 가장 적은" 자리를 고른다. 같은 가장자리를 먼저,
 * 그다음 반대편 가장자리를 세로 거리순으로 본다. 첫 후보는 원래 가려던 자리다.
 */
export function aiBuddyWanderCandidates(preferred: AiBuddyFabRatio): AiBuddyFabRatio[] {
  const target = {
    xRatio: preferred.xRatio >= 0.5 ? 1 : 0,
    yRatio: clamp(preferred.yRatio, AI_BUDDY_WANDER_VERTICAL_MIN, AI_BUDDY_WANDER_VERTICAL_MAX),
  };
  const ys: number[] = [];
  for (let y = AI_BUDDY_WANDER_VERTICAL_MIN; y <= AI_BUDDY_WANDER_VERTICAL_MAX + 1e-9; y += AI_BUDDY_WANDER_SCAN_STEP) {
    ys.push(Math.round(y * 1000) / 1000);
  }
  const byDistance = (a: number, b: number) => Math.abs(a - target.yRatio) - Math.abs(b - target.yRatio);
  const sameEdge = ys.slice().sort(byDistance).map((yRatio) => ({ xRatio: target.xRatio, yRatio }));
  const otherEdge = ys.slice().sort(byDistance).map((yRatio) => ({ xRatio: 1 - target.xRatio, yRatio }));
  return [target, ...sameEdge, ...otherEdge];
}

export interface AiBuddyRatioCoverage {
  ratio: AiBuddyFabRatio;
  /** 친구 자리 표본점 중 아래에 누를 수 있는 요소가 있는 점의 수. 0 이면 아무것도 덮지 않는다. */
  covered: number;
}

/**
 * 후보 중 버튼을 가장 적게 덮는 자리를 고른다(같으면 앞선 = 가까운 자리). 아무것도 덮지 않는 자리가
 * 나오면 바로 멈춘다. 목록 행이 화면 폭을 다 채우는 구간에서는 빈자리가 아예 없어서,
 * "빈자리만" 찾으면 친구가 준비물 체크 버튼 위에 그대로 서 있었다(2026-09-25 브라우저 QA).
 */
export function pickLeastCoveringRatio(
  candidates: readonly AiBuddyFabRatio[],
  coverage: (ratio: AiBuddyFabRatio) => number,
): AiBuddyRatioCoverage | null {
  let best: AiBuddyRatioCoverage | null = null;
  for (const ratio of candidates) {
    const covered = coverage(ratio);
    if (covered <= 0) return { ratio, covered: 0 };
    if (!best || covered < best.covered) best = { ratio, covered };
  }
  return best;
}

/** 지금 자리보다 덜 덮는 자리일 때만 옮긴다(같은 만큼 덮으면 괜히 움직여 아이를 헷갈리게 하지 않는다). */
export function shouldMoveAiBuddyTo(best: AiBuddyRatioCoverage | null, currentCovered: number): boolean {
  if (!best) return false;
  return best.covered === 0 || best.covered < currentCovered;
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
 * 문구는 locale catalog 가 정본이므로 여기에는 id 만 둔다.
 */
const WANDER_LINE_ID: Partial<Record<AiBuddyChatFace, MessageId>> = {
  greeting: "core.aiBuddy.wander.greeting" as MessageId,
  curious: "core.aiBuddy.wander.curious" as MessageId,
  explore: "core.aiBuddy.wander.explore" as MessageId,
  music: "core.aiBuddy.wander.music" as MessageId,
  idea: "core.aiBuddy.wander.idea" as MessageId,
  love: "core.aiBuddy.wander.love" as MessageId,
  shy: "core.aiBuddy.wander.shy" as MessageId,
  wink: "core.aiBuddy.wander.wink" as MessageId,
  waiting: "core.aiBuddy.wander.waiting" as MessageId,
  talking: "core.aiBuddy.wander.talking" as MessageId,
};

/** 그 표정에서 건넬 한 마디. 말을 걸지 않는 표정이면 null. */
export function aiBuddyWanderLine(face: AiBuddyChatFace, intl: IntlShape): string | null {
  const id = WANDER_LINE_ID[face];
  return id ? intl.formatMessage({ id }) : null;
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

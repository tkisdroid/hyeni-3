/**
 * 플로팅 AI 친구가 아이에게 **먼저 건네는 말**의 정본(순수 계산, 2026-08-19 TK 지시).
 *
 * 왜 필요한가: 지금까지 친구는 "안녕!", "뭐 해?" 같은 빈말만 했다. 아이 입장에서는
 * 눌러야 할 이유가 없다. 부모님 메시지가 왔다거나, 곧 태권도라거나, 가방에 아직 못 넣은
 * 준비물이 있다는 걸 **친구가 먼저 알려 주면** 그 자체로 쓸모가 생긴다.
 *
 * 원칙
 *  · 아는 사실만 말한다. 없는 일정·없는 메시지를 지어내지 않는다(빈말은 `invite` 로 강등).
 *  · 부모님 메시지는 다른 무엇보다 먼저다 — 아이가 놓치면 안 되는 유일한 항목이다.
 *  · 나머지(일정·준비물)는 돌아가며 말한다. 같은 말만 반복하면 배경처럼 무시된다.
 *  · 말풍선은 좁다. `line` 은 한 호흡(짧게), 화면을 채울 때만 `fullLine` 으로 조금 더 말한다.
 *  · 판정은 순수 함수다. 시계·저장소·DOM 을 읽지 않고 호출부가 값을 넘긴다.
 */
import type { AiBuddyChatFace } from "./aiBuddyEmotion.ts";
import { eventCompanionAsk } from "./eventCompanionPrompt.ts";

export type AiBuddyNudgeKind = "parentMessage" | "nextEvent" | "supplies" | "invite";

export interface AiBuddyNudge {
  kind: AiBuddyNudgeKind;
  /** 버튼 옆 말풍선 한 줄(반말). 좁은 말풍선에 들어가야 한다. */
  line: string;
  /** 화면을 채우고 부를 때의 한 줄. 조금 더 구체적으로 말한다. */
  fullLine: string;
  /** 그때 지을 얼굴. */
  face: AiBuddyChatFace;
}

export interface AiBuddyNudgeInput {
  /** 아직 아이가 읽지 않은 부모 메시지 수. */
  unreadParentMessages: number;
  /** 가장 최근 부모 메시지 미리보기(이미 줄여 온 값). 없으면 null. */
  parentMessagePreview: string | null;
  /** 오늘 남은 다음 일정 제목. 없으면 null. */
  nextEventTitle: string | null;
  /** 그 일정 시각 라벨(예: "15:00"). 모르면 null — 지어내지 않는다. */
  nextEventTime: string | null;
  /** 아직 못 챙긴 준비물 라벨(순서 그대로). */
  pendingSupplies: readonly string[];
}

export const EMPTY_AI_BUDDY_NUDGE_INPUT: AiBuddyNudgeInput = {
  unreadParentMessages: 0,
  parentMessagePreview: null,
  nextEventTitle: null,
  nextEventTime: null,
  pendingSupplies: [],
};

/** 아이를 부르기만 하는 기본 한 마디 — 할 말이 없어도 친구는 여기 있다. */
export const AI_BUDDY_INVITE_NUDGE: AiBuddyNudge = {
  kind: "invite",
  line: "나랑 얘기할래?",
  fullLine: "꾹 누르면 나랑 바로 말할 수 있어!",
  face: "talking",
};

function clean(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

/** "15:00" → "3시" / "15:30" → "3시 반". 형식을 모르면 null(시각을 지어내지 않는다). */
export function aiBuddyNudgeTimeLabel(time: unknown): string | null {
  if (typeof time !== "string") return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(time.trim());
  if (!match) return null;
  const hour24 = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour24) || hour24 < 0 || hour24 > 23) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  if (minute === 0) return `${hour12}시`;
  if (minute === 30) return `${hour12}시 반`;
  return `${hour12}시 ${minute}분`;
}

function parentMessageNudge(input: AiBuddyNudgeInput): AiBuddyNudge | null {
  if (input.unreadParentMessages <= 0) return null;
  const preview = clean(input.parentMessagePreview, 24);
  return {
    kind: "parentMessage",
    line: "부모님 메시지 왔어!",
    // 미리보기가 없으면 있는 척하지 않고 확인해 보자고만 한다.
    fullLine: preview ? `부모님이 "${preview}" 라고 했어` : "부모님이 메시지를 보냈어. 같이 볼까?",
    face: "talking",
  };
}

function nextEventNudge(input: AiBuddyNudgeInput): AiBuddyNudge | null {
  const title = clean(input.nextEventTitle, 12);
  if (!title) return null;
  const when = aiBuddyNudgeTimeLabel(input.nextEventTime);
  // 일정 성격에 맞는 한 마디는 인사말과 같은 표에서 고른다(친구가 화면마다 다른 말을 하지 않게).
  const tail = eventCompanionAsk(input.nextEventTitle);
  return {
    kind: "nextEvent",
    line: when ? `${when}에 ${title}!` : `이따 ${title} 있어!`,
    fullLine: when ? `${when}에 ${title} 있어. ${tail}` : `오늘 ${title} 있어. ${tail}`,
    face: "idea",
  };
}

function suppliesNudge(input: AiBuddyNudgeInput): AiBuddyNudge | null {
  const items = input.pendingSupplies
    .map((label) => clean(label, 10))
    .filter((label): label is string => label !== null)
    .slice(0, 2);
  if (!items.length) return null;
  return {
    kind: "supplies",
    line: `${items[0]} 챙겼어?`,
    fullLine: items.length > 1
      ? `가방에 ${items.join("랑 ")} 넣었어?`
      : `가방에 ${items[0]} 넣었어?`,
    face: "curious",
  };
}

/**
 * 지금 건넬 수 있는 말 전부(우선순위 순).
 * 부모 메시지 → 다음 일정 → 준비물 → 그냥 부르기.
 */
export function aiBuddyNudgeCandidates(input: AiBuddyNudgeInput): readonly AiBuddyNudge[] {
  const out: AiBuddyNudge[] = [];
  const parent = parentMessageNudge(input);
  if (parent) out.push(parent);
  const event = nextEventNudge(input);
  if (event) out.push(event);
  const supplies = suppliesNudge(input);
  if (supplies) out.push(supplies);
  out.push(AI_BUDDY_INVITE_NUDGE);
  return out;
}

/**
 * 이번에 건넬 한 마디.
 * 부모 메시지가 있으면 무조건 그것부터(놓치면 안 되는 유일한 항목).
 * 그 외에는 `rotation` 으로 돌아가며 말해 같은 말만 반복하지 않는다.
 */
export function buildAiBuddyNudge(input: AiBuddyNudgeInput, rotation: number): AiBuddyNudge {
  const candidates = aiBuddyNudgeCandidates(input);
  if (candidates[0].kind === "parentMessage") return candidates[0];
  const turn = Number.isFinite(rotation) ? Math.max(0, Math.floor(rotation)) : 0;
  return candidates[turn % candidates.length];
}

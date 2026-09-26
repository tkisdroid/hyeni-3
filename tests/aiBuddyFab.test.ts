// 아이모드 AI 친구 플로팅 버튼 — 표정 판정과 위치 계산 회귀.
//
// 이 테스트가 지키는 것
//  · 아이가 속상할 때 친구는 같이 슬퍼하지 않고 다독인다(caring). 웃는 얼굴로 넘기지 않는다.
//  · 부탁을 아직 실행하지 않았으면(확인 대기) 해낸 표정을 짓지 않는다.
//  · 버튼은 어떤 화면 크기에서도 프레임 밖·독 아래로 나가지 않고, 손을 떼면 가장자리에 붙는다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createIntl, createIntlCache, type IntlShape } from "react-intl";

// 표정 설명은 locale catalog 가 정본이므로 한국어 카탈로그로 intl 을 만들어 검증한다.
const koChildIntl = createIntl({
  locale: "ko",
  messages: JSON.parse(
    readFileSync(new URL("../locales/ko/child.json", import.meta.url), "utf8"),
  ) as Record<string, string>,
}, createIntlCache()) as IntlShape;

import { existsSync } from "node:fs";
import {
  AI_BUDDY_BLINK_FACE,
  AI_BUDDY_CHAT_FACES,
  AI_BUDDY_EMOTIONS,
  AI_BUDDY_IDLE_MOTIONS,
  AI_BUDDY_POSES,
  AI_BUDDY_TAP_FACE,
  AI_BUDDY_TYPING_FACE,
  aiBuddyChatFaceAsset,
  aiBuddyEmotionLabel,
  aiBuddyFaceAsset,
  aiBuddyFaceFor,
  aiBuddyPoseForFace,
  aiBuddyIdleEmotion,
  isAiBuddyEmotion,
  resolveAiBuddyEmotion,
} from "../src/transform/aiBuddyEmotion.ts";
import {
  AI_BUDDY_WANDER_MAX_STEP,
  AI_BUDDY_WANDER_PAUSE_AFTER_DRAG_MS,
  AI_BUDDY_WANDER_STEP_MS,
  AI_BUDDY_WANDER_VERTICAL_MAX,
  AI_BUDDY_WANDER_VERTICAL_MIN,
  AI_BUDDY_WANDER_LINE_EVERY,
  AI_BUDDY_WANDER_LINE_MS,
  AI_BUDDY_WANDER_MOVING_FACE,
  AI_BUDDY_WANDER_TRAVEL_MS,
  aiBuddyWanderCandidates,
  pickLeastCoveringRatio,
  shouldMoveAiBuddyTo,
  aiBuddyWanderFace,
  aiBuddyWanderLine as aiBuddyWanderLineIntl,
  canAiBuddyWander,
  nextAiBuddyWanderRatio,
  shouldShowAiBuddyWanderLine,
} from "../src/transform/aiBuddyWander.ts";
import {
  aiBuddyVoiceHintStorageKey,
  markAiBuddyVoiceHintShown,
  markAiBuddyVoiceHintUsed,
  normalizeAiBuddyVoiceHintState,
  shouldShowAiBuddyVoiceHint,
  AI_BUDDY_VOICE_HINT_ID,
  AI_BUDDY_VOICE_HINT_MAX_SHOWN,
  AI_BUDDY_VOICE_HINT_MIN_GAP_MS,
  AI_BUDDY_VOICE_LONG_PRESS_MS,
  EMPTY_AI_BUDDY_VOICE_HINT_STATE,
} from "../src/transform/aiBuddyVoiceHint.ts";
import {
  aiBuddyAttentionDayKey,
  aiBuddyAttentionDurationMs,
  aiBuddyAttentionStage,
  aiBuddyAttentionStorageKey,
  aiBuddyAttentionToday,
  markAiBuddyAttentionShown,
  normalizeAiBuddyAttentionState,
  shouldPlayAiBuddyAttention,
  AI_BUDDY_ATTENTION_FIRST_DELAY_MS,
  AI_BUDDY_ATTENTION_FULL_EVERY,
  AI_BUDDY_ATTENTION_MAX_PER_DAY,
  AI_BUDDY_ATTENTION_MIN_GAP_MS,
  EMPTY_AI_BUDDY_ATTENTION_STATE,
} from "../src/transform/aiBuddyAttention.ts";
import {
  aiBuddyNudgeCandidates as aiBuddyNudgeCandidatesIntl,
  aiBuddyNudgeTimeLabel as aiBuddyNudgeTimeLabelIntl,
  buildAiBuddyNudge as buildAiBuddyNudgeIntl,
  aiBuddyInviteNudge,
  EMPTY_AI_BUDDY_NUDGE_INPUT,
} from "../src/transform/aiBuddyNudge.ts";
import {
  aiBuddyEnterDurationMs,
  aiBuddyLaunchDelayMs,
  AI_BUDDY_HANDOFF_FACE_PX,
  AI_BUDDY_LAUNCH_MS,
} from "../src/transform/aiBuddyLaunch.ts";
import {
  AI_BUDDY_FAB_EDGE_GAP,
  AI_BUDDY_FAB_SIZE,
  aiBuddyFabOffset,
  aiBuddyFabRatioFromOffset,
  aiBuddyFabStorageKey,
  aiBuddyFabTrack,
  DEFAULT_AI_BUDDY_FAB_RATIO,
  isAiBuddyFabTap,
  normalizeAiBuddyFabRatio,
  snapAiBuddyFabRatio,
} from "../src/transform/aiBuddyFabPosition.ts";
import {
  aiBuddyHomeChatHintLine as aiBuddyHomeChatHintLineIntl,
  resolveAiBuddyFabBubbleLine as resolveAiBuddyFabBubbleLineIntl,
  resolveAiBuddyFabTarget,
} from "../src/transform/aiBuddyFabPrompt.ts";

const koCoreIntl = createIntl({
  locale: "ko",
  messages: JSON.parse(
    readFileSync(new URL("../locales/ko/core.json", import.meta.url), "utf8"),
  ) as Record<string, string>,
}, createIntlCache()) as IntlShape;

const aiBuddyWanderLine = (face: Parameters<typeof aiBuddyWanderLineIntl>[0]) =>
  aiBuddyWanderLineIntl(face, koCoreIntl);
const aiBuddyNudgeCandidates = (input: Parameters<typeof aiBuddyNudgeCandidatesIntl>[0]) =>
  aiBuddyNudgeCandidatesIntl(input, koCoreIntl);
const aiBuddyNudgeTimeLabel = (time: unknown) => aiBuddyNudgeTimeLabelIntl(time, koCoreIntl);
const buildAiBuddyNudge = (
  input: Parameters<typeof buildAiBuddyNudgeIntl>[0],
  rotation: number,
) => buildAiBuddyNudgeIntl(input, rotation, koCoreIntl);
const aiBuddyHomeChatHintLine = (name?: string | null) =>
  aiBuddyHomeChatHintLineIntl(koCoreIntl, name);
const resolveAiBuddyFabBubbleLine = (
  input: Parameters<typeof resolveAiBuddyFabBubbleLineIntl>[0],
) => resolveAiBuddyFabBubbleLineIntl(input, koCoreIntl);
const AI_BUDDY_VOICE_HINT_LINE = koCoreIntl.formatMessage({ id: AI_BUDDY_VOICE_HINT_ID });
const AI_BUDDY_HOME_CHAT_HINT_LINE = aiBuddyHomeChatHintLine();
const AI_BUDDY_INVITE_NUDGE = aiBuddyInviteNudge(koCoreIntl);

const FRAME = { width: 390, height: 844, topInset: 64, bottomInset: 112 };

test("답을 기다리는 동안은 생각하는 얼굴을 유지한다", () => {
  assert.equal(resolveAiBuddyEmotion({ phase: "thinking", childText: "심심해 ㅋㅋ" }), "thinking");
  // 즐거운 말이 섞여 있어도 대기 중이면 웃는 얼굴로 앞서가지 않는다.
  assert.equal(resolveAiBuddyEmotion({ phase: "thinking", childText: "재밌는 얘기 해줘" }), "thinking");
});

test("아이가 속상하면 같이 슬퍼하지 않고 다독인다", () => {
  assert.equal(resolveAiBuddyEmotion({ phase: "reply", childText: "오늘 학교에서 혼났어" }), "caring");
  assert.equal(resolveAiBuddyEmotion({ phase: "reply", childText: "너무 속상해" }), "caring");
  assert.equal(resolveAiBuddyEmotion({ phase: "idle", childText: "무서워" }), "caring");
});

test("안전 신호는 어떤 즐거운 말보다 먼저 다독이는 얼굴로 간다", () => {
  assert.equal(
    resolveAiBuddyEmotion({ phase: "reply", childText: "ㅋㅋ 재밌어", safetyRiskLevel: "high" }),
    "caring",
  );
  assert.equal(resolveAiBuddyEmotion({ phase: "reply", safetyRiskLevel: "medium" }), "caring");
  assert.equal(resolveAiBuddyEmotion({ phase: "reply", safetyRiskLevel: "none", childText: "ㅋㅋ" }), "happy");
});

test("부탁을 실제로 해냈을 때만 신난 얼굴을 짓는다", () => {
  assert.equal(
    resolveAiBuddyEmotion({ phase: "reply", toolResult: { ok: true, confirmationRequired: false } }),
    "excited",
  );
  // 확인 대기 중은 아직 해낸 게 아니다 — 해낸 표정을 지으면 아이가 됐다고 오해한다.
  assert.notEqual(
    resolveAiBuddyEmotion({ phase: "reply", toolResult: { ok: true, confirmationRequired: true } }),
    "excited",
  );
  assert.equal(resolveAiBuddyEmotion({ phase: "reply", toolResult: { ok: false } }), "sad");
});

test("칭찬·축하는 응원 얼굴, 그냥 답은 웃는 얼굴", () => {
  assert.equal(resolveAiBuddyEmotion({ phase: "reply", childText: "나 받아쓰기 100점 맞았어!" }), "cheer");
  assert.equal(resolveAiBuddyEmotion({ phase: "reply", replyText: "정말 대단해!" }), "cheer");
  assert.equal(resolveAiBuddyEmotion({ phase: "reply", childText: "오늘 뭐 하지" }), "happy");
});

test("밤에는 대기 얼굴이 졸린 표정이고, 시각을 모르면 지어내지 않는다", () => {
  assert.equal(aiBuddyIdleEmotion(23), "sleepy");
  assert.equal(aiBuddyIdleEmotion(3), "sleepy");
  assert.equal(aiBuddyIdleEmotion(14), "idle");
  assert.equal(aiBuddyIdleEmotion(null), "idle");
  assert.equal(aiBuddyIdleEmotion(99), "idle");
  assert.equal(resolveAiBuddyEmotion({ phase: "idle", hourOfDay: 23 }), "sleepy");
});

test("감정마다 같은 3D 캐릭터 포즈와 읽어 주는 설명이 있다", () => {
  for (const emotion of AI_BUDDY_EMOTIONS) {
    const face = aiBuddyFaceFor(emotion);
    assert.ok(AI_BUDDY_CHAT_FACES.includes(face), `${emotion} 그림 매핑 누락`);
    assert.equal(aiBuddyFaceAsset(emotion), `ai-buddy/poses/${aiBuddyPoseForFace(face)}.webp`);
    assert.ok(aiBuddyEmotionLabel(emotion, koChildIntl).length > 0, `${emotion} 설명 누락`);
    assert.equal(isAiBuddyEmotion(emotion), true);
  }
  assert.equal(isAiBuddyEmotion("blink"), false);
  assert.equal(isAiBuddyEmotion(null), false);
  // 속상한 아이에게는 걱정하며 다독이는 얼굴, 축하에는 축하 얼굴을 쓴다.
  assert.equal(aiBuddyFaceFor("caring"), "worried");
  assert.equal(aiBuddyFaceFor("cheer"), "celebrate");
  assert.equal(aiBuddyFaceFor("idle"), "waiting");
});

test("20개 상황 얼굴이 실제 3D 포즈 18종을 빠짐없이 공유한다", () => {
  assert.equal(AI_BUDDY_CHAT_FACES.length, 20);
  assert.equal(AI_BUDDY_POSES.length, 18);
  const usedPoses = new Set<string>();
  for (const face of AI_BUDDY_CHAT_FACES) {
    const pose = aiBuddyPoseForFace(face);
    usedPoses.add(pose);
    const file = new URL(`../public/assets/${aiBuddyChatFaceAsset(face)}`, import.meta.url);
    assert.equal(existsSync(file), true, `${face}.webp 누락`);
  }
  assert.deepEqual([...usedPoses].toSorted(), [...AI_BUDDY_POSES].toSorted());
  for (const face of [AI_BUDDY_BLINK_FACE, AI_BUDDY_TAP_FACE, AI_BUDDY_TYPING_FACE]) {
    assert.ok(AI_BUDDY_CHAT_FACES.includes(face), `${face} 는 20종 안에 있어야 한다`);
  }
  for (const face of AI_BUDDY_IDLE_MOTIONS) {
    assert.ok(AI_BUDDY_CHAT_FACES.includes(face), `${face} 대기 동작 그림 누락`);
  }
});

test("대기 중 배회는 조금씩 움직이고 가장자리 띠를 벗어나지 않는다", () => {
  let ratio = { xRatio: 1, yRatio: 0.86 };
  const seen = new Set<string>();
  for (let step = 1; step <= 24; step += 1) {
    const next = nextAiBuddyWanderRatio(ratio, step);
    assert.ok(next.xRatio === 0 || next.xRatio === 1, "좌우 가장자리에만 선다");
    assert.ok(
      next.yRatio >= AI_BUDDY_WANDER_VERTICAL_MIN && next.yRatio <= AI_BUDDY_WANDER_VERTICAL_MAX,
      `step ${step}: 세로 띠를 벗어났다(${next.yRatio})`,
    );
    assert.ok(
      Math.abs(next.yRatio - ratio.yRatio) <= AI_BUDDY_WANDER_MAX_STEP + 1e-9,
      `step ${step}: 한 번에 너무 멀리 갔다`,
    );
    seen.add(`${next.xRatio}:${next.yRatio.toFixed(3)}`);
    ratio = next;
  }
  assert.ok(seen.size >= 8, "같은 자리만 오가면 돌아다니는 것이 아니다");
  // 결정적이다 — 같은 step 이면 같은 결과.
  assert.deepEqual(
    nextAiBuddyWanderRatio({ xRatio: 1, yRatio: 0.5 }, 7),
    nextAiBuddyWanderRatio({ xRatio: 1, yRatio: 0.5 }, 7),
  );
  // 세 걸음마다 반대쪽으로 건너간다.
  assert.equal(nextAiBuddyWanderRatio({ xRatio: 1, yRatio: 0.5 }, 2).xRatio, 0);
  assert.equal(nextAiBuddyWanderRatio({ xRatio: 0, yRatio: 0.5 }, 2).xRatio, 1);
});

test("배회 한 걸음은 급하게 튀지 않고 짧은 도약 안에 끝난다", () => {
  assert.ok(
    AI_BUDDY_WANDER_TRAVEL_MS >= 1_200 && AI_BUDDY_WANDER_TRAVEL_MS <= 1_800,
    "급하게 튀거나 너무 오래 화면을 가로지르면 안 된다",
  );
});

test("이동 중에는 달리고 도착하면 말을 걸 듯한 얼굴을 짓는다", () => {
  assert.equal(aiBuddyWanderFace(3, true), AI_BUDDY_WANDER_MOVING_FACE);
  assert.equal(AI_BUDDY_WANDER_MOVING_FACE, "excited");
  for (let step = 1; step <= 24; step += 1) {
    const face = aiBuddyWanderFace(step, false);
    assert.ok(AI_BUDDY_IDLE_MOTIONS.includes(face), `step ${step}: 대기 동작 밖 얼굴`);
    // 도착 얼굴이 이동 중 얼굴과 같으면 멈춘 걸 알 수 없다(실측: 계속 걸어가는 것처럼 보였다).
    assert.notEqual(face, AI_BUDDY_WANDER_MOVING_FACE, `step ${step}: 도착했는데 계속 달린다`);
    assert.equal(typeof aiBuddyWanderLine(face), "string", `step ${step}: 도착 얼굴에 대사가 없다`);
  }
  assert.equal(aiBuddyWanderFace(5, false), aiBuddyWanderFace(5, false));
});

test("말은 몇 걸음에 한 번만 걸고, 이동 중에는 말풍선을 띄우지 않는다", () => {
  assert.equal(shouldShowAiBuddyWanderLine(0), false, "첫 렌더에 먼저 말을 걸지 않는다");
  assert.equal(shouldShowAiBuddyWanderLine(AI_BUDDY_WANDER_LINE_EVERY), true);
  assert.equal(shouldShowAiBuddyWanderLine(AI_BUDDY_WANDER_LINE_EVERY + 1), false);
  assert.ok(AI_BUDDY_WANDER_LINE_EVERY >= 3, "매 걸음 말을 걸면 잔소리가 된다");
  assert.ok(AI_BUDDY_WANDER_LINE_MS >= 2_000 && AI_BUDDY_WANDER_LINE_MS <= 4_000);

  // 이동 중 달리는 얼굴에는 대사가 없고, 도착 얼굴에는 반말 한 마디가 있다.
  assert.equal(aiBuddyWanderLine(AI_BUDDY_WANDER_MOVING_FACE), null);
  assert.equal(aiBuddyWanderLine("typing"), null);
  for (const face of AI_BUDDY_IDLE_MOTIONS) {
    const line = aiBuddyWanderLine(face);
    assert.equal(typeof line, "string", `${face} 대사 누락`);
    assert.ok(line && line.length <= 10, `${face} 대사가 길다: ${line}`);
    assert.doesNotMatch(line ?? "", /(?:요|습니다|세요)$/, `${face} 대사가 존댓말이다`);
  }
});

test("배회는 드래그·감정 표시·움직임 줄이기·숨은 화면에서 멈춘다", () => {
  const base = {
    dragging: false,
    showingEmotion: false,
    visible: true,
    reducedMotion: false,
    msSinceDrag: null,
  };
  assert.equal(canAiBuddyWander(base), true);
  assert.equal(canAiBuddyWander({ ...base, dragging: true }), false);
  assert.equal(canAiBuddyWander({ ...base, showingEmotion: true }), false);
  assert.equal(canAiBuddyWander({ ...base, reducedMotion: true }), false);
  assert.equal(canAiBuddyWander({ ...base, visible: false }), false);
  // 아이가 직접 옮긴 자리는 잠시 그대로 둔다.
  assert.equal(canAiBuddyWander({ ...base, msSinceDrag: 1_000 }), false);
  assert.equal(
    canAiBuddyWander({ ...base, msSinceDrag: AI_BUDDY_WANDER_PAUSE_AFTER_DRAG_MS + 1 }),
    true,
  );
  assert.ok(AI_BUDDY_WANDER_STEP_MS >= 6_000, "너무 자주 움직이면 산만하다");
});

test("버튼은 프레임 안, 상단 헤더 아래·하단 독 위에만 놓인다", () => {
  const track = aiBuddyFabTrack(FRAME);
  assert.equal(track.left, AI_BUDDY_FAB_EDGE_GAP);
  assert.equal(track.top, FRAME.topInset + AI_BUDDY_FAB_EDGE_GAP);

  const topLeft = aiBuddyFabOffset({ xRatio: 0, yRatio: 0 }, FRAME);
  const bottomRight = aiBuddyFabOffset({ xRatio: 1, yRatio: 1 }, FRAME);
  assert.equal(topLeft.left, AI_BUDDY_FAB_EDGE_GAP);
  assert.equal(topLeft.top, FRAME.topInset + AI_BUDDY_FAB_EDGE_GAP);
  assert.equal(bottomRight.left + AI_BUDDY_FAB_SIZE, FRAME.width - AI_BUDDY_FAB_EDGE_GAP);
  assert.equal(
    bottomRight.top + AI_BUDDY_FAB_SIZE,
    FRAME.height - FRAME.bottomInset - AI_BUDDY_FAB_EDGE_GAP,
  );
});

test("프레임 밖으로 끌어도 위치는 안쪽으로 좁혀진다", () => {
  const farOut = aiBuddyFabRatioFromOffset({ left: 9999, top: -9999 }, FRAME);
  assert.equal(farOut.xRatio, 1);
  assert.equal(farOut.yRatio, 0);
  const offset = aiBuddyFabOffset(farOut, FRAME);
  assert.ok(offset.left + AI_BUDDY_FAB_SIZE <= FRAME.width);
  assert.ok(offset.top >= FRAME.topInset);
});

test("아주 좁은 화면에서도 계산이 무너지지 않는다", () => {
  const tiny = { width: 40, height: 60, topInset: 64, bottomInset: 112 };
  const track = aiBuddyFabTrack(tiny);
  assert.equal(track.width, 0);
  assert.equal(track.height, 0);
  const offset = aiBuddyFabOffset({ xRatio: 1, yRatio: 1 }, tiny);
  assert.equal(Number.isFinite(offset.left), true);
  assert.equal(Number.isFinite(offset.top), true);
});

test("손을 떼면 가까운 좌우 가장자리에 붙고 높이는 그대로 둔다", () => {
  assert.deepEqual(snapAiBuddyFabRatio({ xRatio: 0.2, yRatio: 0.4 }), { xRatio: 0, yRatio: 0.4 });
  assert.deepEqual(snapAiBuddyFabRatio({ xRatio: 0.8, yRatio: 0.4 }), { xRatio: 1, yRatio: 0.4 });
  assert.deepEqual(snapAiBuddyFabRatio({ xRatio: 0.5, yRatio: 0.9 }), { xRatio: 1, yRatio: 0.9 });
});

test("저장된 위치가 깨져 있으면 기본 위치로 강등한다", () => {
  assert.equal(normalizeAiBuddyFabRatio(null), null);
  assert.equal(normalizeAiBuddyFabRatio("1"), null);
  // Number(null) === 0 함정 — 좌표가 조용히 좌상단으로 튀면 안 된다.
  assert.equal(normalizeAiBuddyFabRatio({ xRatio: null, yRatio: null }), null);
  assert.equal(normalizeAiBuddyFabRatio({ xRatio: Number.NaN, yRatio: 0.5 }), null);
  assert.deepEqual(normalizeAiBuddyFabRatio({ xRatio: 5, yRatio: -2 }), { xRatio: 1, yRatio: 0 });
  assert.deepEqual(DEFAULT_AI_BUDDY_FAB_RATIO, { xRatio: 1, yRatio: 0.86 });
});

test("살짝 흔들린 짧은 누름은 드래그가 아니라 열기다", () => {
  assert.equal(isAiBuddyFabTap(2, 3, 120), true);
  assert.equal(isAiBuddyFabTap(40, 0, 120), false);
  assert.equal(isAiBuddyFabTap(1, 1, 2000), false);
});

test("저장 키는 가족·아이별로 갈라 형제끼리 위치가 섞이지 않는다", () => {
  assert.notEqual(aiBuddyFabStorageKey("f1", "c1"), aiBuddyFabStorageKey("f1", "c2"));
  assert.notEqual(aiBuddyFabStorageKey("f1", "c1"), aiBuddyFabStorageKey("f2", "c1"));
  assert.equal(typeof aiBuddyFabStorageKey(null, null), "string");
});

// ── 배선 가드 ──────────────────────────────────────────────────────────────

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("플로팅 버튼은 아이 셸과 상세 셸 양쪽에서 상시 대기한다", () => {
  const shell = read("src/app/AppShell.tsx");
  // 진입 번들 예산(500KB) 때문에 지연 로드한다 — 첫 화면에 필요한 요소가 아니다.
  assert.match(shell, /lazy\(async \(\) => \(\{ default: \(await import\("\.\/AiBuddyFab"\)\)\.AiBuddyFab \}\)\)/);
  assert.match(shell, /<Suspense fallback=\{null\}>[\s\S]{0,120}<AiBuddyFab bottomInset=\{bottomInset\} \/>/);
  // 아이 탭 화면(독 있음)과 상세 화면(독 없음)에서 각각 다른 하단 여유를 준다.
  // 대화 탭은 독 위 입력줄(≈120)까지 피한다(2026-09-27 — 대화에서도 독이 남는다).
  assert.match(shell, /<ChildDock \/>[\s\S]{0,260}<AiBuddyFabSlot bottomInset=\{chat \? 232 : 112\} \/>/);
  // PushShell 본문 안에 있는지를 함수 범위로 정확히 본다.
  // (예전 400자 창은 본문이 길어지면 깨지는 대략적인 장치였다 — 하단 메뉴가 들어오며 넘쳤다.)
  const pushBody = shell.slice(shell.indexOf("export function PushShell()"));
  assert.match(pushBody, /<AiBuddyFabSlot bottomInset=\{20\} \/>/);
  // 아이 상세 화면에는 독을 겹치지 않는다 — SOS 홀드·대화 입력줄과 부딪힌다.
  assert.doesNotMatch(pushBody, /<ChildDock \/>/);
});

test("표정 상태는 라우터 위 provider 한 곳에서만 들고 있다", () => {
  const app = read("src/app/App.tsx");
  assert.match(app, /import \{ AiBuddyMoodProvider \} from "\.\/aiBuddyMood"/);
  assert.match(app, /<AiBuddyMoodProvider>[\s\S]{0,600}<RouterProvider router=\{router\} \/>/);
});

test("AI 친구 화면 안에서는 플로팅 버튼을 겹쳐 띄우지 않는다", () => {
  const fab = read("src/app/AiBuddyFab.tsx");
  for (const path of ["/child/ai-friend", "/child/ai-friend-setup", "/child/sos", "/onboarding"]) {
    assert.ok(fab.includes(`"${path}"`), `${path} 숨김 목록 누락`);
  }
  // 부모·선생님 세션에는 렌더되지 않는다.
  assert.match(fab, /role !== "child"[\s\S]{0,80}return null/);
  // 드래그가 화면 스크롤로 새지 않아야 한다.
  assert.match(read("src/app/AiBuddyFab.css"), /touch-action: none/);
});

test("배회 타이머는 감정이 바뀌어도 다시 만들지 않고 말풍선은 대화에 자리를 비킨다", () => {
  const fab = read("src/app/AiBuddyFab.tsx");
  // emotion 을 의존성에 넣으면 도착 표정·말풍선 타이머가 취소돼 두리번거리는 얼굴로 굳는다.
  assert.match(fab, /AI_BUDDY_WANDER_STEP_MS\);[\s\S]{0,320}\n  \}, \[\]\);/);
  assert.match(fab, /showingEmotion: emotionRef\.current !== "idle"/);
  // 실제 대화 감정·탭·드래그에는 말풍선이 즉시 물러난다.
  assert.match(
    fab,
    /setWanderLine\(null\);\n    setVoiceHint\(false\);\n    setAttention\(null\);\n  \}, \[emotion\]\)/,
  );
  assert.match(fab, /setTapped\(true\);\n    setWanderLine\(null\)/);
  // 말풍선은 얼굴을 가리지 않는 안내라 조작을 가로채지 않고 스크린리더에 중복 낭독되지 않는다.
  assert.match(fab, /className=\{guidanceBubble \? "abf__bubble abf__bubble--hint" : "abf__bubble"\}/);
  assert.match(fab, /aria-hidden="true"/);
  assert.match(read("src/app/AiBuddyFab.css"), /\.abf__bubble \{[^}]*pointer-events: none/);
});

// 2026-09-26: 1/3 크기는 색상 칩·카드 버튼을 너무 많이 가려 약 27%(411px 기준 111px)로 줄였다.
test("아이 홈은 화면 폭 약 27%의 실제 렌더 크기로 위치를 계산한다", () => {
  const fab = read("src/app/AiBuddyFab.tsx");
  const css = read("src/app/AiBuddyFab.css");
  assert.match(css, /\.abf \{[^}]*width: clamp\(96px, 27vw, 120px\)/);
  assert.match(css, /\.abf \{[^}]*height: clamp\(96px, 27vw, 120px\)/);
  assert.match(fab, /fabSize: hostRef\.current\?\.offsetWidth \?\? presentation\.size/);
  assert.match(css, /\.abf--compact \{[^}]*width: 68px;[^}]*height: 68px/);
});

test("홈 친구는 아무 말이 없을 때 눌러 대화할 수 있다고 알려 준다", () => {
  assert.equal(AI_BUDDY_HOME_CHAT_HINT_LINE, "혜니를 눌러서 이야기해 봐!");
  assert.equal(aiBuddyHomeChatHintLine("별이"), "별이를 눌러서 이야기해 봐!");
  assert.ok(AI_BUDDY_HOME_CHAT_HINT_LINE.length <= 16, "한눈에 읽을 수 있는 말풍선이어야 한다");
  assert.doesNotMatch(AI_BUDDY_HOME_CHAT_HINT_LINE, /(?:요|습니다|세요)[!.]?$/, "아이 모드는 반말이다");

  assert.equal(resolveAiBuddyFabBubbleLine({
    canPrompt: true,
    voiceHint: false,
    attentionStage: null,
    attentionLine: null,
    wanderLine: null,
    friendName: "별이",
  }), "별이를 눌러서 이야기해 봐!");
  assert.equal(resolveAiBuddyFabBubbleLine({
    canPrompt: true,
    voiceHint: false,
    attentionStage: null,
    attentionLine: null,
    wanderLine: null,
    friendName: "혜니",
  }), AI_BUDDY_HOME_CHAT_HINT_LINE);
  assert.equal(resolveAiBuddyFabBubbleLine({
    canPrompt: false,
    voiceHint: false,
    attentionStage: null,
    attentionLine: null,
    wanderLine: null,
  }), null, "작은 동행 모드에서는 홈 안내를 띄우지 않는다");

  const fab = read("src/app/AiBuddyFab.tsx");
  assert.match(fab, /const friendName = resolveAiFriendDisplayName\(/);
  // 라벨 문구는 catalog 가 정본이고 컴포넌트는 id 와 값만 넘긴다.
  assert.match(fab, /core\.aiBuddy\.fab\.label/);
  assert.match(fab, /\{ name: friendName, emotion: aiBuddyEmotionLabel\(emotion, intl\) \}/);
  assert.doesNotMatch(fab, /const label = `/);
  assert.match(fab, /title=\{friendName\}/);
});

test("혜니의 모든 말풍선은 모바일에서 줄바꿈·말줄임 없이 한 줄로 보인다", () => {
  const css = read("src/app/AiBuddyFab.css");
  const fab = read("src/app/AiBuddyFab.tsx");
  const floatingBubble = css.match(/\.abf__bubble \{([^}]*)\}/)?.[1] ?? "";
  const hintBubble = css.match(/\.abf__bubble--hint \{([^}]*)\}/)?.[1] ?? "";
  const stageBubble = css.match(/\.abf-stage__bubble \{([^}]*)\}/)?.[1] ?? "";
  const stageLine = css.match(/\.abf-stage__line \{([^}]*)\}/)?.[1] ?? "";

  assert.match(floatingBubble, /width:\s*max-content/);
  assert.match(floatingBubble, /white-space:\s*nowrap/);
  assert.doesNotMatch(floatingBubble, /text-overflow:\s*ellipsis/);
  assert.match(hintBubble, /white-space:\s*nowrap/);
  assert.doesNotMatch(hintBubble, /white-space:\s*normal|overflow-wrap:\s*anywhere/);
  assert.match(stageBubble, /white-space:\s*nowrap/);
  assert.match(stageLine, /white-space:\s*nowrap/);
  assert.match(fab, /<p className="abf-stage__line">\{attention\.nudge\.line\}<\/p>/);
  assert.doesNotMatch(fab, /className="abf-stage__hint"/);
});

test("탭 안내는 음성 안내·상황 알림·배회 대사를 가로채지 않는다", () => {
  assert.equal(resolveAiBuddyFabBubbleLine({
    canPrompt: true,
    voiceHint: true,
    attentionStage: null,
    attentionLine: null,
    wanderLine: "같이 놀자!",
  }), AI_BUDDY_VOICE_HINT_LINE);
  assert.equal(resolveAiBuddyFabBubbleLine({
    canPrompt: true,
    voiceHint: false,
    attentionStage: "grow",
    attentionLine: "준비물 챙겼어?",
    wanderLine: "같이 놀자!",
  }), "준비물 챙겼어?");
  assert.equal(resolveAiBuddyFabBubbleLine({
    canPrompt: true,
    voiceHint: false,
    attentionStage: null,
    attentionLine: null,
    wanderLine: "같이 놀자!",
  }), "같이 놀자!");
});

test("설정을 확인한 뒤에만 탭을 대화나 친구 만들기로 연결한다", () => {
  assert.equal(resolveAiBuddyFabTarget({ settings: undefined, loading: true, error: false }), null);
  assert.equal(resolveAiBuddyFabTarget({ settings: undefined, loading: false, error: true }), null);
  assert.equal(resolveAiBuddyFabTarget({
    settings: { ai_enabled: true, ai_friend_name: "별이" },
    loading: false,
    error: true,
  }), "/child/ai-friend", "background refetch 실패가 이미 확인한 설정을 무효화하면 안 된다");
  assert.equal(resolveAiBuddyFabTarget({ settings: { ai_enabled: false }, loading: false, error: false }), null);
  assert.equal(resolveAiBuddyFabTarget({ settings: null, loading: false, error: false }), "/child/ai-friend-setup");
  assert.equal(resolveAiBuddyFabTarget({
    settings: { ai_enabled: true, ai_friend_name: "혜니" },
    loading: false,
    error: false,
  }), "/child/ai-friend");

  const fab = read("src/app/AiBuddyFab.tsx");
  assert.match(fab, /const chatTarget = resolveAiBuddyFabTarget\(\{/);
  assert.match(fab, /if \(!chatTarget\) \{[\s\S]{0,420}return;/);
  assert.match(fab, /canPrompt: presentation\.canPrompt && chatTarget !== null/);
  assert.match(fab, /friendSettings\.data\?\.ai_enabled === false[\s\S]{0,180}child\.home\.aiDisabled/);
  assert.match(fab, /friendSettings\.isError[\s\S]{0,220}child\.aiSetup\.loadError\.title/);
});

test("홈 크기 친구의 살짝 커지기 동작은 가장자리 여백 안에서 끝난다", () => {
  const css = read("src/app/AiBuddyFab.css");
  assert.doesNotMatch(css, /@keyframes abf-attention[\s\S]{0,520}scale\(1\.55\)/);
  assert.match(css, /@keyframes abf-attention[\s\S]{0,520}scale\(1\.14\)/);
});

test("움직임 최소화 설정에서는 떠다니지도 깜빡이지도 않는다", () => {
  const fab = read("src/app/AiBuddyFab.tsx");
  assert.match(fab, /prefersReducedMotion\(\)/);
  assert.match(read("src/app/AiBuddyFab.css"), /@media \(prefers-reduced-motion: reduce\)/);
});

// ── 꾹 누르면 바로 말하기(2026-08-19 TK 지시) ─────────────────────────────

test("한 번 써 본 아이에게는 말하기 안내를 다시 띄우지 않는다", () => {
  const now = 1_700_000_000_000;
  assert.equal(shouldShowAiBuddyVoiceHint(EMPTY_AI_BUDDY_VOICE_HINT_STATE, now), true);
  // 실제로 꾹 눌러 써 봤으면 끝이다 — 아는 걸 계속 알리면 잔소리가 된다.
  assert.equal(
    shouldShowAiBuddyVoiceHint(markAiBuddyVoiceHintUsed(EMPTY_AI_BUDDY_VOICE_HINT_STATE), now),
    false,
  );
});

test("안내는 하루 한 번, 최대 세 번까지만 한다", () => {
  const now = 1_700_000_000_000;
  let state = EMPTY_AI_BUDDY_VOICE_HINT_STATE;
  state = markAiBuddyVoiceHintShown(state, now);
  assert.equal(state.shownCount, 1);
  // 방금 알렸으면 오늘은 그만.
  assert.equal(shouldShowAiBuddyVoiceHint(state, now + 1_000), false);
  assert.equal(shouldShowAiBuddyVoiceHint(state, now + AI_BUDDY_VOICE_HINT_MIN_GAP_MS), true);

  state = markAiBuddyVoiceHintShown(state, now + AI_BUDDY_VOICE_HINT_MIN_GAP_MS);
  state = markAiBuddyVoiceHintShown(state, now + AI_BUDDY_VOICE_HINT_MIN_GAP_MS * 2);
  assert.equal(state.shownCount, AI_BUDDY_VOICE_HINT_MAX_SHOWN);
  assert.equal(shouldShowAiBuddyVoiceHint(state, now + AI_BUDDY_VOICE_HINT_MIN_GAP_MS * 9), false);
});

test("저장된 안내 상태가 깨져 있어도 0 으로 둔갑하지 않는다", () => {
  assert.deepEqual(normalizeAiBuddyVoiceHintState(null), EMPTY_AI_BUDDY_VOICE_HINT_STATE);
  assert.deepEqual(normalizeAiBuddyVoiceHintState("3"), EMPTY_AI_BUDDY_VOICE_HINT_STATE);
  // Number(null) === 0 함정 — "1970년에 알림"이 되면 매번 다시 뜬다.
  assert.equal(normalizeAiBuddyVoiceHintState({ lastShownAtMs: null }).lastShownAtMs, null);
  assert.equal(normalizeAiBuddyVoiceHintState({ lastShownAtMs: "x" }).lastShownAtMs, null);
  assert.equal(normalizeAiBuddyVoiceHintState({ shownCount: -4 }).shownCount, 0);
  assert.equal(normalizeAiBuddyVoiceHintState({ used: "true" }).used, false);
  assert.notEqual(
    aiBuddyVoiceHintStorageKey("f1", "c1"),
    aiBuddyVoiceHintStorageKey("f1", "c2"),
  );
});

test("안내 문구는 무엇을 하면 무엇이 되는지 한 문장 반말로 말한다", () => {
  assert.ok(AI_BUDDY_VOICE_HINT_LINE.includes("꾹"));
  assert.ok(AI_BUDDY_VOICE_HINT_LINE.includes("말"));
  assert.ok(AI_BUDDY_VOICE_HINT_LINE.length <= 20, "말풍선에 들어갈 길이를 넘겼다");
  assert.doesNotMatch(AI_BUDDY_VOICE_HINT_LINE, /(?:요|습니다|세요)[!.]?$/, "아이 모드는 반말이다");
  // 꾹 누름은 열기(탭)와 확실히 구분돼야 한다.
  assert.ok(AI_BUDDY_VOICE_LONG_PRESS_MS >= 400 && AI_BUDDY_VOICE_LONG_PRESS_MS <= 800);
});

test("꾹 누르면 마이크가 켜진 대화창이 열리고 손을 떼도 또 열리지 않는다", () => {
  const fab = read("src/app/AiBuddyFab.tsx");
  assert.match(fab, /longPressTimerRef\.current = setTimeout\([\s\S]{0,200}AI_BUDDY_VOICE_LONG_PRESS_MS\)/);
  // 옮기는 중이면 말하기가 아니다.
  assert.match(fab, /drag\.moved = true;[\s\S]{0,140}cancelLongPress\(\)/);
  // 이미 마이크가 켜졌으면 손을 뗀 것으로 대화창을 다시 열지 않는다.
  assert.match(fab, /if \(longPressFiredRef\.current\) \{[\s\S]{0,200}return;/);
  assert.match(fab, /const state = \{ startVoice: configured && startVoice, buddyLaunch: true \}/);
  // 이름을 안 정한 아이는 여전히 친구 만들기로 간다(빈 대화창을 열지 않는다).
  assert.match(fab, /const configured = chatTarget === "\/child\/ai-friend"/);
  assert.match(fab, /navigate\(chatTarget, \{ state \}\)/);
  // 써 본 아이에게는 다시 알리지 않는다.
  assert.match(fab, /markAiBuddyVoiceHintUsed\(voiceHintStateRef\.current\)/);
  // 버튼 라벨이 이 조작을 알려 준다(스크린리더도 알 수 있게).
  assert.match(fab, /core\.aiBuddy\.fab\.label/);
  const koCore = JSON.parse(
    readFileSync(new URL("../locales/ko/core.json", import.meta.url), "utf8"),
  ) as Record<string, string>;
  assert.match(koCore["core.aiBuddy.fab.label"], /길게 누르면 바로 말하기/);
  assert.match(koCore["core.aiBuddy.stage.faceLabel"], /길게 누르면 바로 말하기/);
});

test("대화 화면은 꾹 눌러 들어왔을 때만 마이크를 켜고 히스토리를 지운다", () => {
  const chat = read("src/screens/child/AiFriendChat.tsx");
  assert.match(chat, /navState\.startVoice !== true && navState\.buddyLaunch !== true\) return/);
  assert.match(chat, /autoVoiceStartedRef\.current = true/);
  // 뒤로 갔다 돌아왔을 때 또 켜지지 않도록 state 를 즉시 지운다.
  assert.match(
    chat,
    /replace: true,\s*state: \{ \.\.\.navState, startVoice: false, buddyLaunch: false \}/,
  );
  // 마이크는 "말로 하고 싶다"고 꾹 누른 경우에만 켠다(그냥 탭으로 들어오면 켜지 않는다).
  assert.match(chat, /if \(wantsVoice\) startVoice\(\);/);
});

test("대화 화면은 확인 카드에서만 도구를 실행하고 같은 표정을 공유한다", () => {
  const chat = read("src/screens/child/AiFriendChat.tsx");
  assert.match(chat, /useAiBuddyMood\(\)/);
  assert.match(chat, /aiBuddyFaceAsset\(emotion\)/);
  // 확인이 필요한 도구는 카드로 세워 두고, 실행은 버튼에서만 한다.
  assert.match(chat, /confirmationRequired === true[\s\S]{0,120}setPendingTool\(tool\)/);
  assert.match(chat, /onClick=\{runPendingTool\}/);
  // 확인 문구도 10개 언어 카탈로그를 쓴다(글로벌 버전 병합).
  assert.match(chat, /send\(\s*intl\.formatMessage\(\{ id: "child\.aiChat\.confirm\.yes" \}\),\s*"confirm",\s*confirmed,?\s*\)/);
  // 내 색깔은 서버 컬럼이 없어 기기에서 적용한다.
  assert.match(chat, /clientAction === "setAccent"[\s\S]{0,80}setAccent\(tool\.accent\)/);
});


// ── 스스로 아이를 부르기(2026-08-19 TK 지시) ──────────────────────────────

test("부모가 끄면 어떤 조건에서도 부르지 않는다", () => {
  const now = 1_700_000_000_000;
  const base = {
    dragging: false,
    showingEmotion: false,
    visible: true,
    reducedMotion: false,
    msSinceDrag: null,
    msSinceMount: AI_BUDDY_ATTENTION_FIRST_DELAY_MS + 1,
    state: EMPTY_AI_BUDDY_ATTENTION_STATE,
    nowMs: now,
  };
  assert.equal(shouldPlayAiBuddyAttention({ ...base, enabled: true }), true);
  // 부모 스위치가 유일한 최상위 게이트다 — 나머지 조건이 아무리 좋아도 조용히 있는다.
  assert.equal(shouldPlayAiBuddyAttention({ ...base, enabled: false }), false);
});

test("들어오자마자·드래그 직후·화면이 안 보일 때는 부르지 않는다", () => {
  const now = 1_700_000_000_000;
  const base = {
    enabled: true,
    dragging: false,
    showingEmotion: false,
    visible: true,
    reducedMotion: false,
    msSinceDrag: null,
    msSinceMount: AI_BUDDY_ATTENTION_FIRST_DELAY_MS + 1,
    state: EMPTY_AI_BUDDY_ATTENTION_STATE,
    nowMs: now,
  };
  assert.equal(shouldPlayAiBuddyAttention({ ...base, msSinceMount: 1_000 }), false);
  assert.equal(shouldPlayAiBuddyAttention({ ...base, msSinceDrag: 3_000 }), false);
  assert.equal(shouldPlayAiBuddyAttention({ ...base, visible: false }), false);
  assert.equal(shouldPlayAiBuddyAttention({ ...base, dragging: true }), false);
  // 실제 대화 감정을 보여 주는 중이면 그게 우선이다.
  assert.equal(shouldPlayAiBuddyAttention({ ...base, showingEmotion: true }), false);
  assert.equal(shouldPlayAiBuddyAttention({ ...base, reducedMotion: true }), false);
});

test("하루 횟수와 최소 간격을 지키고 날이 바뀌면 다시 센다", () => {
  const now = Date.UTC(2026, 7, 19, 3, 0, 0); // KST 정오
  const gate = (state: AiBuddyAttentionState, nowMs: number) => shouldPlayAiBuddyAttention({
    enabled: true,
    dragging: false,
    showingEmotion: false,
    visible: true,
    reducedMotion: false,
    msSinceDrag: null,
    msSinceMount: AI_BUDDY_ATTENTION_FIRST_DELAY_MS + 1,
    state,
    nowMs,
  });

  let state = markAiBuddyAttentionShown(EMPTY_AI_BUDDY_ATTENTION_STATE, now);
  assert.equal(state.shownToday, 1);
  assert.equal(gate(state, now + 1_000), false, "방금 불렀으면 잠시 조용히 있는다");
  assert.equal(gate(state, now + AI_BUDDY_ATTENTION_MIN_GAP_MS), true);

  for (let i = 1; i < AI_BUDDY_ATTENTION_MAX_PER_DAY; i += 1) {
    state = markAiBuddyAttentionShown(state, now + AI_BUDDY_ATTENTION_MIN_GAP_MS * i);
  }
  assert.equal(state.shownToday, AI_BUDDY_ATTENTION_MAX_PER_DAY);
  assert.equal(gate(state, now + AI_BUDDY_ATTENTION_MIN_GAP_MS * 99), false, "하루 상한을 넘겼다");

  // 다음 날이 되면 오늘 횟수만 0 으로 돌아간다(총 횟수는 이어져 연출이 매번 같아지지 않는다).
  const tomorrow = now + 24 * 60 * 60 * 1_000;
  const reset = aiBuddyAttentionToday(state, tomorrow);
  assert.equal(reset.shownToday, 0);
  assert.equal(reset.totalShown, state.totalShown);
  assert.equal(reset.dayKey, aiBuddyAttentionDayKey(tomorrow));
});

test("하루 경계는 아이가 사는 시간대(KST)로 센다", () => {
  // UTC 2026-08-18 16:00 = KST 2026-08-19 01:00 — 아이에게는 이미 다음 날이다.
  assert.equal(aiBuddyAttentionDayKey(Date.UTC(2026, 7, 18, 16, 0, 0)), "2026-08-19");
  assert.equal(aiBuddyAttentionDayKey(Date.UTC(2026, 7, 18, 14, 59, 0)), "2026-08-18");
});

test("화면을 채우는 큰 동작은 몇 번에 한 번뿐이다", () => {
  assert.equal(aiBuddyAttentionStage(0), "full", "처음에는 확실히 눈에 띄어야 발견된다");
  const stages = Array.from({ length: 9 }, (_, i) => aiBuddyAttentionStage(i));
  const fullCount = stages.filter((stage) => stage === "full").length;
  assert.equal(fullCount, 9 / AI_BUDDY_ATTENTION_FULL_EVERY);
  assert.ok(stages.includes("grow"), "나머지는 살짝 커졌다 작아진다");
  // 화면을 가리는 동작이 더 짧게 끝나면 안 된다(읽을 시간은 줘야 한다).
  assert.ok(aiBuddyAttentionDurationMs("full") > aiBuddyAttentionDurationMs("grow"));
  assert.ok(aiBuddyAttentionDurationMs("full") <= 5_000, "화면을 오래 가리면 방해가 된다");
});

test("저장된 부르기 상태가 깨져 있어도 0 으로 둔갑하지 않는다", () => {
  assert.deepEqual(normalizeAiBuddyAttentionState(null), EMPTY_AI_BUDDY_ATTENTION_STATE);
  assert.deepEqual(normalizeAiBuddyAttentionState("3"), EMPTY_AI_BUDDY_ATTENTION_STATE);
  // Number(null) === 0 함정 — "1970년에 불렀다"가 되면 간격 제한이 통째로 무력화된다.
  assert.equal(normalizeAiBuddyAttentionState({ lastAtMs: null }).lastAtMs, null);
  assert.equal(normalizeAiBuddyAttentionState({ lastAtMs: "x" }).lastAtMs, null);
  assert.equal(normalizeAiBuddyAttentionState({ shownToday: -2 }).shownToday, 0);
  assert.notEqual(
    aiBuddyAttentionStorageKey("f1", "c1"),
    aiBuddyAttentionStorageKey("f1", "c2"),
  );
});

// ── 먼저 알려 주는 말(부모 메시지·다음 일정·준비물) ────────────────────────

test("부모님 메시지는 무엇보다 먼저 알린다", () => {
  const nudge = buildAiBuddyNudge({
    unreadParentMessages: 2,
    parentMessagePreview: "학원 끝나면 전화해",
    nextEventTitle: "태권도",
    nextEventTime: "15:00",
    pendingSupplies: ["물통"],
  }, 7);
  assert.equal(nudge.kind, "parentMessage");
  assert.ok(nudge.fullLine.includes("학원 끝나면 전화해"));
});

test("미리보기를 모르면 있는 척하지 않고 확인하자고만 한다", () => {
  const nudge = buildAiBuddyNudge({
    ...EMPTY_AI_BUDDY_NUDGE_INPUT,
    unreadParentMessages: 1,
    parentMessagePreview: null,
  }, 0);
  assert.equal(nudge.kind, "parentMessage");
  assert.doesNotMatch(nudge.fullLine, /""/, "빈 인용부호를 남기지 않는다");
});

test("다음 일정은 물건 이름으로 묻고, 시합·발표는 응원부터 한다", () => {
  const lesson = buildAiBuddyNudge({
    ...EMPTY_AI_BUDDY_NUDGE_INPUT,
    nextEventTitle: "태권도",
    nextEventTime: "15:00",
  }, 0);
  assert.equal(lesson.kind, "nextEvent");
  assert.ok(lesson.line.includes("3시"), lesson.line);
  assert.ok(lesson.fullLine.includes("도복"), lesson.fullLine);

  const game = buildAiBuddyNudge({
    ...EMPTY_AI_BUDDY_NUDGE_INPUT,
    nextEventTitle: "축구 시합",
    nextEventTime: "10:00",
  }, 0);
  assert.ok(game.fullLine.includes("파이팅"), game.fullLine);
});

test("시각 형식을 모르면 시각을 지어내지 않는다", () => {
  assert.equal(aiBuddyNudgeTimeLabel("15:00"), "3시");
  assert.equal(aiBuddyNudgeTimeLabel("15:30"), "3시 반");
  assert.equal(aiBuddyNudgeTimeLabel("09:15"), "9시 15분");
  assert.equal(aiBuddyNudgeTimeLabel("00:00"), "12시");
  assert.equal(aiBuddyNudgeTimeLabel(""), null);
  assert.equal(aiBuddyNudgeTimeLabel(null), null);
  assert.equal(aiBuddyNudgeTimeLabel("종일"), null);
  assert.equal(aiBuddyNudgeTimeLabel("25:00"), null);

  const noTime = buildAiBuddyNudge({
    ...EMPTY_AI_BUDDY_NUDGE_INPUT,
    nextEventTitle: "소풍",
    nextEventTime: null,
  }, 0);
  assert.doesNotMatch(noTime.line, /\d+시/, "모르는 시각을 만들어 말하지 않는다");
});

test("아직 못 챙긴 준비물이 있으면 물건 이름으로 묻는다", () => {
  const nudge = buildAiBuddyNudge({
    ...EMPTY_AI_BUDDY_NUDGE_INPUT,
    pendingSupplies: ["알림장", "물통", "실내화"],
  }, 0);
  assert.equal(nudge.kind, "supplies");
  assert.ok(nudge.fullLine.includes("알림장"));
  assert.ok(nudge.fullLine.includes("물통"));
  assert.ok(!nudge.fullLine.includes("실내화"), "한 번에 두 개까지만 말한다");
});

test("알려 줄 게 없으면 지어내지 않고 그냥 부른다", () => {
  const nudge = buildAiBuddyNudge(EMPTY_AI_BUDDY_NUDGE_INPUT, 0);
  assert.deepEqual(nudge, AI_BUDDY_INVITE_NUDGE);
  assert.equal(aiBuddyNudgeCandidates(EMPTY_AI_BUDDY_NUDGE_INPUT).length, 1);
});

test("부모 메시지가 없으면 돌아가며 말해 같은 말만 반복하지 않는다", () => {
  const input = {
    unreadParentMessages: 0,
    parentMessagePreview: null,
    nextEventTitle: "피아노",
    nextEventTime: "17:00",
    pendingSupplies: ["악보"],
  };
  const kinds = [0, 1, 2, 3].map((turn) => buildAiBuddyNudge(input, turn).kind);
  assert.equal(new Set(kinds).size, 3, "돌아가며 말해야 한다: " + kinds.join(","));
  assert.equal(kinds[0], "nextEvent");
  assert.equal(kinds[3], "nextEvent", "한 바퀴 돌면 처음으로 돌아온다");
});

test("먼저 건네는 말은 짧은 반말이고 말풍선에 들어간다", () => {
  const inputs = [
    { ...EMPTY_AI_BUDDY_NUDGE_INPUT, unreadParentMessages: 1, parentMessagePreview: "밥 먹었어?" },
    { ...EMPTY_AI_BUDDY_NUDGE_INPUT, nextEventTitle: "수영", nextEventTime: "16:00" },
    { ...EMPTY_AI_BUDDY_NUDGE_INPUT, pendingSupplies: ["수경"] },
    EMPTY_AI_BUDDY_NUDGE_INPUT,
  ];
  for (const input of inputs) {
    const nudge = buildAiBuddyNudge(input, 0);
    assert.ok(nudge.line.length <= 16, "말풍선에 안 들어간다: " + nudge.line);
    assert.ok(nudge.fullLine.length <= 40, "화면 문구가 너무 길다: " + nudge.fullLine);
    assert.doesNotMatch(nudge.line, /(?:요|습니다|세요)[!?.]?$/, "아이 모드는 반말이다");
    assert.ok((AI_BUDDY_CHAT_FACES as readonly string[]).includes(nudge.face), nudge.face);
  }
});

// ── 대화 화면으로 이어지는 전환 ────────────────────────────────────────────

test("전환은 두 화면이 같은 크기·같은 시간을 쓴다", () => {
  const fabCss = read("src/app/AiBuddyFab.css");
  const chatCss = read("src/screens/child/AiFriendChat.css");
  // ① 버튼이 커지며 가운데로 가는 크기 = ② 대화 화면이 이어받는 크기.
  assert.match(
    fabCss,
    new RegExp('\\.abf\\[data-launching="true"\\] \\{[^}]*width: ' + AI_BUDDY_HANDOFF_FACE_PX + 'px'),
  );
  assert.match(
    chatCss,
    new RegExp('\\.afc-enter img \\{[^}]*width: ' + AI_BUDDY_HANDOFF_FACE_PX + 'px'),
  );
  // 이동 시간도 같아야 중간에 툭 튀지 않는다.
  assert.match(fabCss, new RegExp('left ' + (AI_BUDDY_LAUNCH_MS / 1_000) + 's'));
  assert.ok(aiBuddyEnterDurationMs(false) > AI_BUDDY_LAUNCH_MS, "이어받는 쪽이 더 여유 있게 자리를 잡는다");
});

test("움직임 줄이기에서는 연출 없이 바로 대화창을 연다", () => {
  assert.equal(aiBuddyLaunchDelayMs(true), 0, "기다리게만 하고 아무것도 안 보이면 느린 앱이 된다");
  assert.equal(aiBuddyEnterDurationMs(true), 0);
  assert.equal(aiBuddyLaunchDelayMs(false), AI_BUDDY_LAUNCH_MS);
});

test("플로팅 버튼은 부모 설정과 AI 켜짐을 함께 확인하고 오늘 알 것을 말한다", () => {
  const fab = read("src/app/AiBuddyFab.tsx");
  // 부모가 끄면 부르지 않고, 설정을 아직 못 읽었으면 조용히 있는다(놀래키지 않는다).
  assert.match(fab, /friendSettings\.data\?\.buddy_attention_enabled !== false/);
  assert.match(fab, /aiEnabled = friendSettings\.data\?\.ai_enabled === true/);
  // AI 가 꺼진 가족에서는 말 걸 재료도 받지 않는다.
  assert.match(fab, /useAiBuddyNudgeInput\(aiEnabled && presentation\.canPrompt\)/);
  // 배회하며 건네는 말도 오늘 알아야 할 것이 있으면 그걸 먼저 말한다.
  assert.match(fab, /buildAiBuddyNudge\(nudgeInputRef\.current, step, intl\)/);
  assert.match(fab, /nudge\.kind === "invite" \? aiBuddyWanderLine\(arrival, intl\) : nudge\.line/);
  // 부르는 중에는 배회하지 않는다(커진 얼굴이 걸어 다니면 어지럽다).
  assert.match(fab, /if \(attentionRef\.current \|\| launchingRef\.current\) return;/);
});

test("화면을 채우고 부를 때도 조작은 같다(누르면 대화·꾹 누르면 말하기)", () => {
  const fab = read("src/app/AiBuddyFab.tsx");
  assert.match(fab, /className="abf-stage__face hy-press"/);
  assert.match(fab, /bindStageLongPress\(undefined, \(\) => openChatRef\.current\(false\)\)/);
  assert.match(fab, /delayMs: AI_BUDDY_VOICE_LONG_PRESS_MS/);
  // 바깥을 누르면 바로 닫힌다(아이를 붙잡아 두지 않는다).
  assert.match(fab, /className="abf-stage__scrim"[\s\S]{0,140}onClick=\{dismissAttention\}/);
  // 스스로도 물러난다.
  assert.match(fab, /setAttention\(null\),\s*aiBuddyAttentionDurationMs\(stage\)/);
});


test("부르는 동안에도 SOS 는 가려지지 않는다", () => {
  const zIndexIn = (css: string, pattern: RegExp): number => {
    const block = pattern.exec(css)?.[0] ?? "";
    return Number(/z-index:\s*(\d+)/.exec(block)?.[1] ?? NaN);
  };
  const stage = zIndexIn(read("src/app/AiBuddyFab.css"), /\.abf-stage\s*\{[^}]*\}/);
  const dock = zIndexIn(read("src/app/ChildDock.css"), /\.kdock\s*\{[^}]*\}/);
  assert.ok(Number.isFinite(stage) && Number.isFinite(dock), "z-index 를 읽지 못했어요");
  // 화면을 채우고 부르는 오버레이는 최대 3.8초 떠 있다 —
  // 그동안 아이 독(SOS)을 덮으면 위급한 순간에 아이가 버튼을 못 누른다.
  assert.ok(stage < dock, "부르기 오버레이(" + stage + ")가 아이 독(" + dock + ")을 덮고 있다");
});

test("멈춰 설 자리 후보는 원래 자리 → 같은 가장자리 가까운 순 → 반대 가장자리 순이다", () => {
  const candidates = aiBuddyWanderCandidates({ xRatio: 0.9, yRatio: 0.5 });
  assert.deepEqual(candidates[0], { xRatio: 1, yRatio: 0.5 });
  const sameEdge = candidates.slice(1).filter((c) => c.xRatio === 1);
  const otherEdge = candidates.slice(1).filter((c) => c.xRatio === 0);
  assert.ok(sameEdge.length > 0 && sameEdge.length === otherEdge.length);
  assert.ok(candidates.indexOf(otherEdge[0]) > candidates.indexOf(sameEdge[sameEdge.length - 1]));
  const distances = sameEdge.map((c) => Math.abs(c.yRatio - 0.5));
  assert.deepEqual(distances, [...distances].sort((a, b) => a - b));
  for (const c of candidates) {
    assert.ok(c.yRatio >= AI_BUDDY_WANDER_VERTICAL_MIN - 1e-9 && c.yRatio <= AI_BUDDY_WANDER_VERTICAL_MAX + 1e-9);
  }
});

test("떠다니는 친구는 버튼·입력창을 덮는 자리에 멈추지 않고, 스크롤 뒤에는 비켜 선다", () => {
  const fab = readFileSync(new URL("../src/app/AiBuddyFab.tsx", import.meta.url), "utf8");
  assert.match(fab, /elementsFromPoint/);
  assert.match(fab, /pickLeastCoveredRef\.current\(nextAiBuddyWanderRatio\(from, step\)\)/);
  assert.match(fab, /shouldMoveAiBuddyTo\(best, coverageAtRef\.current\(from\)\)/);
  assert.match(fab, /addEventListener\("scroll", onScroll, \{ passive: true \}\)/);
  assert.match(fab, /shouldMoveAiBuddyTo\(best, currentCovered\)\) setWanderRatio\(best\.ratio\)/);
});

// 2026-09-25 브라우저 QA 재검증 — 목록 행이 화면 폭을 채운 구간에는 빈자리가 없어서,
// "빈자리만" 찾던 친구가 준비물 체크 버튼 위에 그대로 서 있었다.
test("빈자리가 없으면 버튼을 가장 적게 덮는 가까운 자리를 고르고, 빈자리는 바로 고른다", () => {
  const a = { xRatio: 1, yRatio: 0.2 };
  const b = { xRatio: 1, yRatio: 0.3 };
  const c = { xRatio: 0, yRatio: 0.2 };
  const cover = (map: Map<object, number>) => (ratio: object) => map.get(ratio) ?? 9;
  assert.deepEqual(pickLeastCoveringRatio([a, b, c], cover(new Map([[a, 6], [b, 3], [c, 3]]))), { ratio: b, covered: 3 });
  const visited: object[] = [];
  const picked = pickLeastCoveringRatio([a, b, c], (ratio) => { visited.push(ratio); return ratio === b ? 0 : 6; });
  assert.deepEqual(picked, { ratio: b, covered: 0 });
  assert.deepEqual(visited, [a, b], "빈자리를 찾으면 나머지 후보는 재지 않는다");
  assert.equal(pickLeastCoveringRatio([], () => 0), null);
});

test("지금 자리보다 덜 덮을 때만 옮긴다", () => {
  const ratio = { xRatio: 1, yRatio: 0.5 };
  assert.equal(shouldMoveAiBuddyTo({ ratio, covered: 0 }, 0), true);
  assert.equal(shouldMoveAiBuddyTo({ ratio, covered: 2 }, 6), true);
  assert.equal(shouldMoveAiBuddyTo({ ratio, covered: 3 }, 3), false);
  assert.equal(shouldMoveAiBuddyTo({ ratio, covered: 4 }, 2), false);
  assert.equal(shouldMoveAiBuddyTo(null, 9), false);
});

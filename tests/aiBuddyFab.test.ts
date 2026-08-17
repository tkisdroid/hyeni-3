// 아이모드 AI 친구 플로팅 버튼 — 표정 판정과 위치 계산 회귀.
//
// 이 테스트가 지키는 것
//  · 아이가 속상할 때 친구는 같이 슬퍼하지 않고 다독인다(caring). 웃는 얼굴로 넘기지 않는다.
//  · 부탁을 아직 실행하지 않았으면(확인 대기) 해낸 표정을 짓지 않는다.
//  · 버튼은 어떤 화면 크기에서도 프레임 밖·독 아래로 나가지 않고, 손을 떼면 가장자리에 붙는다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  AI_BUDDY_EMOTIONS,
  aiBuddyEmotionLabel,
  aiBuddyFaceAsset,
  aiBuddyIdleEmotion,
  isAiBuddyEmotion,
  resolveAiBuddyEmotion,
} from "../src/transform/aiBuddyEmotion.ts";
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

test("표정마다 실제 에셋 경로와 읽어 주는 설명이 있다", () => {
  for (const emotion of AI_BUDDY_EMOTIONS) {
    assert.equal(aiBuddyFaceAsset(emotion), `ai-buddy/${emotion}.webp`);
    assert.ok(aiBuddyEmotionLabel(emotion).length > 0, `${emotion} 설명 누락`);
    assert.equal(isAiBuddyEmotion(emotion), true);
  }
  assert.equal(aiBuddyFaceAsset("blink"), "ai-buddy/blink.webp");
  assert.equal(isAiBuddyEmotion("blink"), false);
  assert.equal(isAiBuddyEmotion(null), false);
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
  assert.match(shell, /<ChildDock \/>[\s\S]{0,220}<AiBuddyFabSlot bottomInset=\{112\} \/>/);
  assert.match(shell, /export function PushShell\(\)[\s\S]{0,400}<AiBuddyFabSlot bottomInset=\{20\} \/>/);
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

test("움직임 최소화 설정에서는 떠다니지도 깜빡이지도 않는다", () => {
  const fab = read("src/app/AiBuddyFab.tsx");
  assert.match(fab, /prefersReducedMotion\(\)/);
  assert.match(read("src/app/AiBuddyFab.css"), /@media \(prefers-reduced-motion: reduce\)/);
});

test("대화 화면은 확인 카드에서만 도구를 실행하고 같은 표정을 공유한다", () => {
  const chat = read("src/screens/child/AiFriendChat.tsx");
  assert.match(chat, /useAiBuddyMood\(\)/);
  assert.match(chat, /aiBuddyFaceAsset\(emotion\)/);
  // 확인이 필요한 도구는 카드로 세워 두고, 실행은 버튼에서만 한다.
  assert.match(chat, /confirmationRequired === true[\s\S]{0,120}setPendingTool\(tool\)/);
  assert.match(chat, /onClick=\{runPendingTool\}/);
  assert.match(chat, /send\("응, 그렇게 해줘", "confirm", confirmed\)/);
  // 내 색깔은 서버 컬럼이 없어 기기에서 적용한다.
  assert.match(chat, /clientAction === "setAccent"[\s\S]{0,80}setAccent\(tool\.accent\)/);
});

import test from "node:test";
import assert from "node:assert/strict";

import * as emotionModule from "../src/transform/aiBuddyEmotion.ts";
import * as positionModule from "../src/transform/aiBuddyFabPosition.ts";
import { aiBuddyWanderFace } from "../src/transform/aiBuddyWander.ts";

const expectedPoses = [
  "welcome",
  "polite",
  "heart-hug",
  "jump",
  "crown",
  "thinking",
  "tablet",
  "idea",
  "headphones",
  "explore",
  "rush",
  "peek",
  "sleep",
  "heart-send",
  "expecting",
  "worried",
  "thumbs-up",
  "rocket",
] as const;

test("상황별 의미는 3D 캐릭터 18개 포즈를 빠짐없이 사용한다", () => {
  const module = emotionModule as typeof emotionModule & {
    AI_BUDDY_POSES?: readonly string[];
    aiBuddyPoseForFace?: (face: string) => string;
    aiBuddyChatFaceAsset?: (face: string) => string;
  };
  assert.deepEqual(module.AI_BUDDY_POSES, expectedPoses);
  assert.equal(typeof module.aiBuddyPoseForFace, "function");
  assert.equal(typeof module.aiBuddyChatFaceAsset, "function");

  const used = new Set<string>();
  for (const face of emotionModule.AI_BUDDY_CHAT_FACES) {
    const pose = module.aiBuddyPoseForFace?.(face);
    assert.ok(pose && expectedPoses.includes(pose as (typeof expectedPoses)[number]), `${face}: 포즈 매핑 누락`);
    used.add(pose);
    assert.equal(module.aiBuddyChatFaceAsset?.(face), `ai-buddy/poses/${pose}.webp`);
  }
  assert.deepEqual([...used].toSorted(), [...expectedPoses].toSorted(), "원본 18종을 모두 상황에 사용해야 한다");

  assert.equal(emotionModule.aiBuddyFaceAsset("caring"), "ai-buddy/poses/heart-hug.webp");
  assert.equal(emotionModule.aiBuddyFaceAsset("sad"), "ai-buddy/poses/worried.webp");
  assert.equal(emotionModule.aiBuddyFaceAsset("cheer"), "ai-buddy/poses/crown.webp");
  assert.equal(emotionModule.aiBuddyFaceAsset(emotionModule.AI_BUDDY_TYPING_FACE), "ai-buddy/poses/tablet.webp");
});

test("아이 홈에서만 큰 활동형 친구이고 다른 화면에서는 작은 조용한 친구다", () => {
  const module = positionModule as typeof positionModule & {
    aiBuddyFabPresentation?: (pathname: string) => {
      mode: string;
      size: number;
      canWander: boolean;
      canPrompt: boolean;
      bottomClearance: number;
    };
  };
  assert.equal(typeof module.aiBuddyFabPresentation, "function");
  assert.deepEqual(module.aiBuddyFabPresentation?.("/child/home"), {
    mode: "home",
    size: 112,
    canWander: true,
    canPrompt: true,
    bottomClearance: 0,
  });

  for (const path of ["/child/sticker", "/child/memo", "/daily-report", "/parent/home", "/unknown"]) {
    assert.deepEqual(module.aiBuddyFabPresentation?.(path), {
      mode: "compact",
      size: 68,
      canWander: false,
      canPrompt: false,
      bottomClearance: 96,
    }, path);
  }
});

// 2026-09-26: 1/3 크기는 조작 요소를 너무 많이 가려 약 27%로 줄였다(존재감은 작은 친구의 1.6배 이상 유지).
test("아이 홈 친구의 기준 크기는 411px 화면 폭의 약 27%다", () => {
  const presentation = positionModule.aiBuddyFabPresentation("/child/home");
  const ratio = presentation.size / 411;
  assert.ok(ratio >= 0.26 && ratio <= 0.28, `홈 친구 비율이 27%에서 벗어났다: ${ratio}`);
  assert.ok(presentation.size >= positionModule.aiBuddyFabPresentation("/child/memo").size * 1.6);
});

test("홈과 작은 친구 모두 실제 크기만큼 화면·하단 독 안쪽에서 움직인다", () => {
  const baseFrame = { width: 390, height: 844, topInset: 64, bottomInset: 112 };
  for (const path of ["/child/home", "/child/memo"]) {
    const presentation = positionModule.aiBuddyFabPresentation(path);
    const frame = {
      ...baseFrame,
      bottomInset: baseFrame.bottomInset + presentation.bottomClearance,
      fabSize: presentation.size,
    };
    const bottomRight = positionModule.aiBuddyFabOffset({ xRatio: 1, yRatio: 1 }, frame);
    assert.equal(
      bottomRight.left + presentation.size,
      baseFrame.width - positionModule.AI_BUDDY_FAB_EDGE_GAP,
      `${presentation.mode}: 오른쪽 경계`,
    );
    assert.equal(
      bottomRight.top + presentation.size,
      baseFrame.height - baseFrame.bottomInset - presentation.bottomClearance
        - positionModule.AI_BUDDY_FAB_EDGE_GAP,
      `${presentation.mode}: 아래쪽 경계`,
    );
    assert.deepEqual(
      positionModule.aiBuddyFabRatioFromOffset(bottomRight, frame),
      { xRatio: 1, yRatio: 1 },
      `${presentation.mode}: 위치 비율 왕복`,
    );
  }
});

test("홈에서 자리를 옮길 때는 달리는 포즈로 움직임을 분명히 보여 준다", () => {
  const movingFace = aiBuddyWanderFace(3, true);
  assert.equal(movingFace, "excited");
  assert.equal(emotionModule.aiBuddyChatFaceAsset(movingFace), "ai-buddy/poses/rush.webp");
  for (let step = 1; step <= 24; step += 1) {
    assert.notEqual(aiBuddyWanderFace(step, false), movingFace, `step ${step}: 도착 뒤에도 계속 달린다`);
  }
});

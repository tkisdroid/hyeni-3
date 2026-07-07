import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(resolve(rootDir, "src/screens/feature/Subscription.tsx"), "utf8");

test("구독 화면은 SOS와 긴급 안전 알림을 무료 안전 기능으로 안내한다", () => {
  assert.doesNotMatch(source, /SOS 긴급 알림 우선 전송/);
  assert.match(source, /SOS와 긴급 안전 알림은 무료로 계속 제공돼요/);
  assert.match(source, /프리미엄은 실시간 위치와 AI 요약처럼 더 자세한 안심 기능/);
});

test("구독 화면은 프리미엄 혜택을 상세 안심과 편의 중심으로 설명한다", () => {
  assert.match(source, /다자녀 안심 관리/);
  assert.match(source, /일정·장소 무제한/);
  assert.match(source, /위치 이력/);
  assert.match(source, /다중 위험구역/);
  assert.match(source, /월 2,900원으로 시작하기|프리미엄 시작하기/);
});

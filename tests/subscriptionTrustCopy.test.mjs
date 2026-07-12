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
  assert.match(source, /Google Play에서 확인|시작하기/);
});

test("7일 무료 체험은 Google Play가 eligible offer를 준 경우에만 조건과 자동 갱신을 안내한다", () => {
  assert.match(source, /selectedOffer\?\.hasSevenDayTrial/);
  assert.match(source, /결제 정보 등록 후 7일 동안 무료/);
  assert.match(source, /종료 후 Google Play에 표시된 구독 금액으로 자동 갱신/);
  assert.match(source, /Google Play에서 체험 종료 전에 취소/);
});

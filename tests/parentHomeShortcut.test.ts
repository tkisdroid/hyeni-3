import test from "node:test";
import assert from "node:assert/strict";
import { shortcuts } from "../src/data/mock.ts";
import { resolveParentHomeDeviceFinder } from "../src/transform/parentHomeShortcut.ts";

test("부모 홈 바로가기는 구독 대신 아이 기기 찾기를 4×2 그리드에 둔다", () => {
  assert.deepEqual(shortcuts.map((shortcut) => shortcut.label), [
    "AI 일정",
    "위치추적",
    "친구놀이",
    "장소관리",
    "주변소리",
    "안심리포트",
    "아이 기기 찾기",
    "알림",
  ]);
});

test("아이 기기 찾기는 현재 활성 아이를 원격 벨 대상으로 명시한다", () => {
  assert.deepEqual(resolveParentHomeDeviceFinder("child-user-1"), {
    to: "/remote-ring",
    state: { childUserId: "child-user-1" },
  });
});

test("연결된 아이가 없을 때는 대상 식별자를 지어내지 않는다", () => {
  assert.deepEqual(resolveParentHomeDeviceFinder(null), {
    to: "/remote-ring",
    state: { childUserId: undefined },
  });
});

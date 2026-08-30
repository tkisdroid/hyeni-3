import assert from "node:assert/strict";
import test from "node:test";

let resolveMathMiniAppDestination:
  | ((role: "parent" | "child" | "teacher") => string | null)
  | undefined;

try {
  ({ resolveMathMiniAppDestination } = await import(
    "../src/features/miniapps/miniAppNavigation.ts"
  ));
} catch {
  // RED: the production navigation boundary does not exist yet.
}

test("수학 미니앱은 부모를 관리 화면, 아이를 학습 화면으로 보낸다", () => {
  assert.equal(typeof resolveMathMiniAppDestination, "function");
  assert.equal(resolveMathMiniAppDestination?.("parent"), "/study");
  assert.equal(resolveMathMiniAppDestination?.("child"), "/study/learn");
});

test("선생님 역할에는 수학 미니앱 진입 경로를 만들지 않는다", () => {
  assert.equal(typeof resolveMathMiniAppDestination, "function");
  assert.equal(resolveMathMiniAppDestination?.("teacher"), null);
});

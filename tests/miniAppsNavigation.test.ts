import assert from "node:assert/strict";
import test from "node:test";

let resolveMathMiniAppDestination:
  | ((role: "parent" | "child" | "teacher") => string | null)
  | undefined;
let isMiniAppsMarket: ((accessCountry: unknown) => boolean) | undefined;

try {
  ({ resolveMathMiniAppDestination, isMiniAppsMarket } = await import(
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

test("미니앱 허브는 한국 접속에만 열고 국가 미확정도 닫는다", () => {
  assert.equal(typeof isMiniAppsMarket, "function");
  assert.equal(isMiniAppsMarket?.("KR"), true);
  assert.equal(isMiniAppsMarket?.("kr"), true);
  assert.equal(isMiniAppsMarket?.("JP"), false);
  assert.equal(isMiniAppsMarket?.("ZZ"), false);
  assert.equal(isMiniAppsMarket?.(null), false);
});

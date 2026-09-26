import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("부모 홈은 일반 AI 일정과 별도로 학원 시간표 Premium 진입점을 제공한다", () => {
  const home = read("src/screens/parent/ParentHome.tsx");
  const css = read("src/screens/parent/ParentHome.css");
  const koParent = JSON.parse(read("locales/ko/parent.json"));
  assert.match(home, /navigate\("\/ai-schedule\?mode=academy&tab=image"\)/);
  assert.match(home, /parent\.parentHome\.copy028/);
  // 2026-09-26: "학원표" 줄임말 대신 무엇을 올리는지 바로 읽히는 이름을 쓴다.
  assert.equal(koParent["parent.parentHome.copy028"], "학원 시간표");
  assert.match(css, /\.ph-ai__grid\s*\{[^}]*grid-template-columns:\s*1fr 1fr/s);
});

test("학원 시간표 전용 모드는 Premium만 열고 일반 일정 추가 경로는 Free로 남긴다", () => {
  const source = read("src/screens/feature/AiSchedule.tsx");
  const api = read("src/lib/api/endpoints/ai.ts");
  const koParent = JSON.parse(read("locales/ko/parent.json"));
  assert.match(source, /searchParams\.get\("mode"\) === "academy"/);
  assert.match(source, /canUse\(entitlement\.tier, FEATURES\.ACADEMY_SCHEDULE\)/);
  assert.match(source, /feature:\s*academyMode\s*\?\s*"academy_schedule"\s*:\s*undefined/);
  assert.match(api, /feature\?:\s*"academy_schedule"/);
  assert.match(api, /\.\.\.\(input\.feature\s*\?\s*\{\s*feature:\s*input\.feature\s*\}\s*:\s*\{\}\)/s);
  assert.match(source, /academyMode && e instanceof ApiError && e\.code === "premium_required"[\s\S]+entitlement\.refetch\(\)[\s\S]+setAcademyUpsellOpen\(true\)/);
  assert.doesNotMatch(source, /e\.message === "premium_required"/);
  assert.match(source, /source="academy_schedule"/);
  assert.match(source, /navigate\("\/ai-schedule\?tab=text", \{ replace: true \}\)/);
  assert.match(source, /savePremiumReturnIntent/);
  assert.match(source, /academyMode[\s\S]+parent\.aiSchedule\.academyScreenTitle[\s\S]+parent\.aiSchedule\.screenTitle/);
  assert.equal(koParent["parent.aiSchedule.academyScreenTitle"], "학원 시간표 정리");
  assert.equal(koParent["parent.aiSchedule.screenTitle"], "AI로 일정 추가");
});

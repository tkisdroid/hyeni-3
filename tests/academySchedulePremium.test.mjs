import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("부모 홈은 일반 AI 일정과 별도로 학원 시간표 Premium 진입점을 제공한다", () => {
  const home = read("src/screens/parent/ParentHome.tsx");
  const css = read("src/screens/parent/ParentHome.css");
  assert.match(home, /navigate\("\/ai-schedule\?mode=academy&tab=image"\)/);
  assert.match(home, />\s*학원표\s*</);
  assert.match(css, /\.ph-ai__grid\s*\{[^}]*grid-template-columns:\s*1fr 1fr/s);
});

test("학원 시간표 전용 모드는 Premium만 열고 일반 일정 추가 경로는 Free로 남긴다", () => {
  const source = read("src/screens/feature/AiSchedule.tsx");
  const api = read("src/lib/api/endpoints/ai.ts");
  assert.match(source, /searchParams\.get\("mode"\) === "academy"/);
  assert.match(source, /canUse\(entitlement\.tier, FEATURES\.ACADEMY_SCHEDULE\)/);
  assert.match(source, /feature:\s*academyMode\s*\?\s*"academy_schedule"\s*:\s*undefined/);
  assert.match(api, /feature\?:\s*"academy_schedule"/);
  assert.match(api, /\.\.\.\(input\.feature\s*\?\s*\{\s*feature:\s*input\.feature\s*\}\s*:\s*\{\}\)/s);
  assert.match(source, /e\.message === "premium_required"[\s\S]+entitlement\.refetch\(\)[\s\S]+setAcademyUpsellOpen\(true\)/);
  assert.match(source, /source="academy_schedule"/);
  assert.match(source, /navigate\("\/ai-schedule\?tab=text", \{ replace: true \}\)/);
  assert.match(source, /savePremiumReturnIntent/);
  assert.match(source, /academyMode \? "학원 시간표 정리" : "AI로 일정 추가"/);
});

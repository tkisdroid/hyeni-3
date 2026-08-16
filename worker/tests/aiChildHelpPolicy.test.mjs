import "./helpers/tsModuleResolve.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const workerDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { planChildAgentAction } = await import(
  pathToFileURL(resolve(workerDir, "shared/aiAgentPlanner.js")).href
);
const { buildAgentPlanChildReply, buildToolResultChildReply } = await import(
  pathToFileURL(resolve(workerDir, "shared/aiToolResultReply.js")).href
);
const { shouldChargeForAiTurn } = await import(
  pathToFileURL(resolve(workerDir, "shared/aiUsagePolicy.js")).href
);
const { mergeDailyChecklistItem, encodeDailyChecklist } = await import(
  pathToFileURL(resolve(workerDir, "shared/aiDailyItemTools.js")).href
);
const { inferChildAiEmotion } = await import(
  pathToFileURL(resolve(workerDir, "shared/aiChildEmotion.js")).href
);

test("아이 AI 는 일정 삭제를 실행하지 않고 부모님께 넘긴다", () => {
  const plan = planChildAgentAction("오늘 피아노 일정 지워줘", {
    referenceDate: "2026-08-17",
    parentSettings: {},
    recentMessages: [],
  });
  assert.equal(plan.detectedIntent, "schedule_delete_parent_only");
  assert.equal(plan.shouldUseTool, false);
  assert.equal(plan.toolName, null);
  assert.match(buildAgentPlanChildReply(plan), /부모님만/);
  assert.equal(shouldChargeForAiTurn({ detectedIntent: plan.detectedIntent }), false);
});

test("준비물 추가는 라벨이 있으면 바로 도구를 쓴다", () => {
  const plan = planChildAgentAction("오늘 준비물에 줄넘기 추가해줘", {
    referenceDate: "2026-08-17",
    parentSettings: {},
    recentMessages: [],
  });
  assert.equal(plan.detectedIntent, "daily_item_create");
  assert.equal(plan.shouldUseTool, true);
  assert.equal(plan.toolName, "createDailyItem");
  assert.equal(plan.toolArgs.label, "줄넘기");
  assert.equal(plan.toolArgs.kind, "prep");
});

test("색깔 바꾸기는 허용된 테마만 고른다", () => {
  const plan = planChildAgentAction("내 색깔 민트로 바꿔줘", {
    referenceDate: "2026-08-17",
    parentSettings: {},
    recentMessages: [],
  });
  assert.equal(plan.detectedIntent, "settings_accent");
  assert.equal(plan.toolName, "setChildAccent");
  assert.equal(plan.toolArgs.accent, "mint");
});

test("위치·알림 설정은 아이가 바꾸지 못한다", () => {
  const plan = planChildAgentAction("위치 추적 꺼줘", {
    referenceDate: "2026-08-17",
    parentSettings: {},
    recentMessages: [],
  });
  assert.equal(plan.detectedIntent, "parent_locked_setting");
  assert.equal(plan.shouldUseTool, false);
});

test("준비물 병합은 중복을 건너뛰고 8개를 넘기지 않는다", () => {
  const first = mergeDailyChecklistItem("", "줄넘기");
  assert.equal(first.added, true);
  const dup = mergeDailyChecklistItem(encodeDailyChecklist(first.items), "줄넘기");
  assert.equal(dup.duplicate, true);
  let text = "";
  for (let i = 0; i < 8; i += 1) {
    const next = mergeDailyChecklistItem(text, `항목${i}`);
    assert.equal(next.ok, true);
    text = encodeDailyChecklist(next.items);
  }
  const overflow = mergeDailyChecklistItem(text, "하나 더");
  assert.equal(overflow.ok, false);
  assert.equal(overflow.error, "daily_supply_limit_exceeded");
});

test("도구 성공 답변과 표정은 아이 톤을 유지한다", () => {
  assert.match(
    buildToolResultChildReply({ ok: true, toolName: "createDailyItem", kind: "hw", label: "일기" }),
    /일기/,
  );
  assert.equal(inferChildAiEmotion({ toolName: "createDailyItem" }), "celebrate");
});

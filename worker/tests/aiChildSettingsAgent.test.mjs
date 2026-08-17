// 아이가 AI 친구에게 말로 부탁하는 "내 설정 바꾸기"와 "일정 삭제는 부모만" 계약 회귀.
//
// 이 테스트가 지키는 것
//  · 아이는 자기 알림·AI 친구 이름·내 색깔을 되묻기 없이 바꿀 수 있다.
//  · 부모 소관 설정(알림 쉬는 시간 등)과 일정 삭제는 아이가 바꿀 수 없고, 할 수 있는 척도 하지 않는다.
//  · "엄마한테 ○○ 전해줘" 는 여전히 부모 메시지 경로로 간다(설정 분기가 가로채지 않는다).
//  · 못 해 준 turn 과 LLM 을 쓰지 않는 설정 turn 은 아이의 하루 대화 횟수를 깎지 않는다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { planChildAgentAction } from "../shared/aiAgentPlanner.js";
import {
  describeChildNotificationChange,
  detectChildAccentIntent,
  detectChildNotificationIntent,
  extractAiFriendNameRequest,
  isChildAccentKey,
  sanitizeAiFriendName,
  sanitizeChildNotificationMinutes,
} from "../shared/aiChildSettingsTools.js";
import { buildAgentPlanChildReply, buildToolResultChildReply } from "../shared/aiToolResultReply.js";
import { shouldChargeForAiTurn } from "../shared/aiUsagePolicy.js";

const REFERENCE_DATE = "2026-08-17";

function plan(message, options = {}) {
  return planChildAgentAction(message, { referenceDate: REFERENCE_DATE, ...options });
}

test("아이는 자기 일정 알림을 말로 켜고 끌 수 있다", () => {
  const off = plan("알림 꺼줘");
  assert.equal(off.detectedIntent, "notification_settings");
  assert.equal(off.toolName, "updateNotificationSettings");
  assert.equal(off.shouldUseTool, true);
  assert.equal(off.toolArgs.scheduleAlertsEnabled, false);
  assert.equal(off.confirmationRequired, false);

  const on = plan("알림 다시 켜줘");
  assert.equal(on.toolName, "updateNotificationSettings");
  assert.equal(on.toolArgs.scheduleAlertsEnabled, true);
});

test("몇 분 전에 알려 달라는 말은 사전 알림 시각으로 해석한다", () => {
  const result = plan("일정 알림 10분 전에 알려줘");
  assert.equal(result.toolName, "updateNotificationSettings");
  assert.deepEqual(result.toolArgs.minutesBefore, [10]);

  assert.deepEqual(detectChildNotificationIntent("알림 30분 전이랑 5분 전에 줘").minutesBefore, [30, 5]);
  assert.deepEqual(detectChildNotificationIntent("알림 한 시간 전에 알려줘").minutesBefore, [60]);
});

test("부모가 정하는 알림은 바꿔 준다고 하지 않는다", () => {
  const quiet = plan("알림 쉬는 시간 바꿔줘");
  assert.equal(quiet.detectedIntent, "notification_settings_parent_only");
  assert.equal(quiet.shouldUseTool, false);
  assert.equal(quiet.toolName, null);
  assert.match(buildAgentPlanChildReply(quiet), /부모님/);

  assert.deepEqual(detectChildNotificationIntent("위치 알림 꺼줘"), { parentOnly: true });
});

test("알림이라는 말만으로는 설정을 바꾸지 않는다", () => {
  assert.equal(detectChildNotificationIntent("아까 알림 왔었어"), null);
  assert.equal(detectChildNotificationIntent("오늘 뭐 하고 놀까?"), null);
});

test("일정 삭제는 부모만 할 수 있고 아이에게는 대신 전해 주겠다고 안내한다", () => {
  const result = plan("내일 피아노 일정 지워줘");
  assert.equal(result.detectedIntent, "schedule_delete_parent_only");
  assert.equal(result.shouldUseTool, false);
  assert.equal(result.toolName, null);
  const reply = buildAgentPlanChildReply(result);
  assert.match(reply, /부모님만/);
  assert.match(reply, /전해줘/);
});

test("예전 대화의 삭제 되묻기에 답해도 삭제로 이어지지 않는다", () => {
  const result = plan("피아노", {
    recentMessages: [
      { role: "user", content: "일정 지워줘" },
      { role: "assistant", content: "언제 어떤 일정을 지울까?" },
    ],
  });
  assert.equal(result.detectedIntent, "schedule_delete_parent_only");
  assert.equal(result.toolName, null);
});

test("일정 등록은 그대로 아이가 할 수 있다", () => {
  const result = plan("내일 오후 4시에 축구 일정 추가해줘");
  assert.equal(result.detectedIntent, "schedule_create");
  assert.equal(result.toolName, "createSchedule");
  assert.equal(result.shouldUseTool, true);
});

test("부모에게 전해 달라는 부탁은 설정 분기가 가로채지 않는다", () => {
  const message = plan("엄마한테 알림 좀 켜달라고 전해줘");
  assert.equal(message.detectedIntent, "message_parent");
  assert.equal(message.toolName, "createMessageToParent");
  assert.equal(message.toolArgs.parentRole, "mom");
});

test("AI 친구 이름은 아이가 직접 바꿀 수 있고 이름이 없으면 되묻는다", () => {
  const named = plan("이름 코코로 바꿔줘");
  assert.equal(named.detectedIntent, "ai_friend_name");
  assert.equal(named.toolName, "updateAiFriendName");
  assert.equal(named.shouldUseTool, true);
  assert.equal(named.toolArgs.name, "코코");

  const missing = plan("이름 바꾸고 싶어");
  assert.equal(missing.shouldUseTool, false);
  assert.deepEqual(missing.missingArgs, ["name"]);
  assert.match(buildAgentPlanChildReply(missing), /새 이름/);

  assert.equal(extractAiFriendNameRequest('이름을 "별이"로 해줘'), "별이");
  assert.equal(sanitizeAiFriendName("  달콤이 "), "달콤이");
  assert.equal(sanitizeAiFriendName("이름"), null);
  assert.equal(sanitizeAiFriendName("아주아주아주아주긴이름입니다"), null);
});

test("내 색깔은 아는 색일 때만 바꾸고 모르면 골라 달라고 한다", () => {
  const mint = plan("색깔 민트로 바꿔줘");
  assert.equal(mint.detectedIntent, "app_theme");
  assert.equal(mint.toolName, "changeAppTheme");
  assert.equal(mint.toolArgs.accent, "mint");
  assert.equal(isChildAccentKey(mint.toolArgs.accent), true);

  const unknown = plan("색깔 바꿔줘");
  assert.equal(unknown.shouldUseTool, false);
  assert.deepEqual(unknown.missingArgs, ["accent"]);
  assert.match(buildAgentPlanChildReply(unknown), /핑크/);

  assert.equal(detectChildAccentIntent("하늘색으로 바꿔줘").accent, "sky");
  assert.equal(detectChildAccentIntent("오늘 하늘 예쁘다"), null);
});

test("사전 알림 분은 정수·양수만 남기고 내림차순으로 정리한다", () => {
  assert.deepEqual(sanitizeChildNotificationMinutes([5, 15, 5, 0, -3, "10"]), [15, 10, 5]);
  assert.equal(sanitizeChildNotificationMinutes([]), null);
  assert.equal(sanitizeChildNotificationMinutes("15"), null);
});

test("설정 변경 안내는 실제로 바뀐 것만 말한다", () => {
  assert.match(
    describeChildNotificationChange({ scheduleAlertsEnabled: false, minutesBefore: null }),
    /일정 알림을 껐어/,
  );
  assert.match(
    describeChildNotificationChange({ scheduleAlertsEnabled: null, minutesBefore: [15, 5] }),
    /15분·5분 전에 알려줄게/,
  );
  assert.equal(describeChildNotificationChange({ scheduleAlertsEnabled: null, minutesBefore: null }), "");
});

test("도구 결과 안내문은 실행한 도구에 맞게 나온다", () => {
  assert.match(
    buildToolResultChildReply({
      ok: true,
      toolName: "updateNotificationSettings",
      applied: { scheduleAlertsEnabled: true, minutesBefore: null },
    }),
    /일정 알림을 켰어/,
  );
  assert.match(
    buildToolResultChildReply({ ok: true, toolName: "updateAiFriendName", name: "코코" }),
    /내 이름은 코코야/,
  );
  assert.match(
    buildToolResultChildReply({ ok: true, toolName: "changeAppTheme", accent: "mint", accentLabel: "민트" }),
    /민트 색으로 바꿨어/,
  );
});

test("못 해 준 turn 만 하루 대화 횟수를 쓰지 않는다", () => {
  // 2026-08-17 TK 결정: 아이가 말을 건 turn 은 LLM 사용 여부와 무관하게 1회 차감한다.
  // 해 준 것이 없는 거절만 예외로 남는다.
  assert.equal(shouldChargeForAiTurn({ detectedIntent: "schedule_delete_parent_only" }), false);
  assert.equal(shouldChargeForAiTurn({ detectedIntent: "notification_settings_parent_only" }), false);
  // 설정 변경은 실제로 해 준 일이므로 이제 1회로 센다(과금 예측 가능성 우선).
  assert.equal(
    shouldChargeForAiTurn({
      detectedIntent: "notification_settings",
      toolResult: { ok: true, toolName: "updateNotificationSettings" },
    }),
    true,
  );
  assert.equal(
    shouldChargeForAiTurn({ detectedIntent: "ai_friend_name", toolResult: { ok: true, toolName: "updateAiFriendName" } }),
    true,
  );
  // 일반 대화와 일정 등록도 그대로 차감한다.
  assert.equal(shouldChargeForAiTurn({ detectedIntent: "general_chat" }), true);
  assert.equal(
    shouldChargeForAiTurn({ detectedIntent: "schedule_create", toolResult: { ok: true, toolName: "createSchedule" } }),
    true,
  );
});

test("아이 세션의 일정 삭제 실행 경로는 서버에 남아 있지 않다", () => {
  const route = readFileSync(new URL("../routes/ai-child-chat.ts", import.meta.url), "utf8");
  // 확인 토큰이 남아 있어도 삭제하지 않고 부모 전용으로 닫는다.
  assert.match(route, /confirmedTool\?\.toolName === "deleteSchedule"[\s\S]{0,160}schedule_delete_parent_only/);
  // deleteSchedule 도구를 계획·실행하는 분기가 더는 없다.
  assert.doesNotMatch(route, /toolName === "deleteSchedule"\s*\)\s*\{\s*\n\s*if \(!allowScheduleActions/);
  assert.doesNotMatch(route, /toolName: "deleteSchedule"/);
  // events 링크 해제(아이만 빼기)도 사라져야 한다. 남은 DELETE 는 일정 등록 실패 롤백뿐이다.
  assert.doesNotMatch(route, /DELETE FROM events_children WHERE event_id=\? AND child_id=\?/);
  const eventDeletes = route.match(/DELETE FROM events\b/g) ?? [];
  assert.equal(eventDeletes.length, 1, "일정 등록 실패 롤백 외의 events 삭제가 남아 있다");
  assert.match(route, /schedule child link rollback failed/);
});

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

test("날짜를 생략한 아이 일정 등록은 오늘 일정으로 바로 실행한다", () => {
  const result = plan("오후3시 피아노 일정 추가");
  assert.equal(result.detectedIntent, "schedule_create");
  assert.equal(result.toolName, "createSchedule");
  assert.equal(result.shouldUseTool, true);
  assert.deepEqual(result.missingArgs, []);
  assert.deepEqual(result.toolArgs, {
    title: "피아노",
    date: REFERENCE_DATE,
    startTime: "15:00",
    endTime: null,
  });
});

test("아직 해석하지 못하는 날짜 표현을 오늘로 오인해 저장하지 않는다", () => {
  for (const message of [
    "다음 주 금요일 오후 3시 피아노 일정 추가",
    "8월 26일 오후 3시 피아노 일정 추가",
    "매주 월요일 오후 3시 피아노 일정 추가",
    "2주 뒤 오후 3시 피아노 일정 추가",
    "사흘 뒤 오후 3시 피아노 일정 추가",
    "한 달 뒤 오후 3시 피아노 일정 추가",
    "두 주 뒤 오후 3시 피아노 일정 추가",
    "보름 뒤 오후 3시 피아노 일정 추가",
    "한 달 반 뒤 오후 3시 피아노 일정 추가",
    "반년 후 오후 3시 피아노 일정 추가",
    "두세 달 뒤 오후 3시 피아노 일정 추가",
    "열한 달 뒤 오후 3시 피아노 일정 추가",
  ]) {
    const result = plan(message);
    assert.equal(result.detectedIntent, "schedule_create");
    assert.equal(result.shouldUseTool, false, message);
    assert.equal(result.toolArgs.date, null, message);
    assert.equal(result.toolArgs.title, "피아노", message);
    assert.ok(result.missingArgs.includes("date"), message);
  }
});

test("후속 답변의 해석하지 못한 날짜도 오늘로 덮어쓰지 않는다", () => {
  const result = plan("다음 주 금요일 오후 3시 피아노", {
    recentMessages: [
      { role: "user", content: "일정 추가" },
      { role: "assistant", content: "몇 시에 추가할까?" },
    ],
  });

  assert.equal(result.detectedIntent, "schedule_create");
  assert.equal(result.shouldUseTool, false);
  assert.equal(result.toolArgs.date, null);
  assert.equal(result.toolArgs.title, null);
  assert.ok(result.missingArgs.includes("date"));
});

test("시간 후속 답변의 말버릇이 기존 일정 제목을 덮지 않는다", () => {
  for (const message of ["오후 3시쯤", "지금 3시야"]) {
    const result = plan(message, {
      recentMessages: [
        { role: "user", content: "내일 피아노 일정 추가" },
        { role: "assistant", content: "몇 시에 추가할까?" },
      ],
    });

    assert.equal(result.shouldUseTool, true, message);
    assert.equal(result.toolArgs.title, "피아노", message);
    assert.equal(result.toolArgs.startTime, "15:00", message);
    assert.equal(result.toolArgs.date, "2026-08-18", message);
  }

  const titleStillMissing = plan("지금 3시야", {
    recentMessages: [
      { role: "user", content: "내일 오후 2시 일정 추가" },
      { role: "assistant", content: "어떤 일정인지 알려줘." },
    ],
  });
  assert.equal(titleStillMissing.shouldUseTool, false);
  assert.equal(titleStillMissing.toolArgs.title, null);
  assert.equal(titleStillMissing.toolArgs.startTime, "15:00");
  assert.ok(titleStillMissing.missingArgs.includes("title"));
});

test("일정 등록을 되묻는 중 취소하면 새 일정을 만들지 않는다", () => {
  for (const message of [
    "취소",
    "아냐 됐어",
    "그만할래",
    "그냥 안 할래",
    "취소할래",
    "추가 안 할래",
    "하지 마",
    "그만하자",
    "됐어 고마워",
  ]) {
    const result = plan(message, {
      recentMessages: [
        { role: "user", content: "내일 오후 3시 일정 추가" },
        { role: "assistant", content: "어떤 일정인지 알려줘." },
      ],
    });

    assert.equal(result.detectedIntent, "schedule_create_cancelled", message);
    assert.equal(result.shouldUseTool, false, message);
    assert.equal(result.toolName, null, message);
    assert.equal(buildAgentPlanChildReply(result), "알겠어. 일정 추가는 그만할게.", message);
    assert.equal(shouldChargeForAiTurn(result), false, message);
  }
});

test("일정 정보가 여러 개 빠져도 아이의 연속 답변을 합쳐 등록한다", () => {
  const first = plan("일정 추가");
  assert.equal(first.shouldUseTool, false);
  assert.deepEqual(first.missingArgs, ["startTime", "title"]);
  assert.equal(buildAgentPlanChildReply(first), "몇 시에 추가할까?");

  const secondMessages = [
    { role: "user", content: "일정 추가" },
    { role: "assistant", content: "몇 시에 추가할까?" },
  ];
  const second = plan("오후 3시", { recentMessages: secondMessages });
  assert.equal(second.detectedIntent, "schedule_create");
  assert.equal(second.shouldUseTool, false);
  assert.deepEqual(second.missingArgs, ["title"]);
  assert.equal(buildAgentPlanChildReply(second), "어떤 일정인지 알려줘.");

  const completed = plan("피아노", {
    recentMessages: [
      ...secondMessages,
      { role: "user", content: "오후 3시" },
      { role: "assistant", content: "어떤 일정인지 알려줘." },
    ],
  });
  assert.equal(completed.detectedIntent, "schedule_create");
  assert.equal(completed.shouldUseTool, true);
  assert.deepEqual(completed.toolArgs, {
    title: "피아노",
    date: REFERENCE_DATE,
    startTime: "15:00",
    endTime: null,
  });
});

test("연속 답변 중간에 말한 날짜를 마지막 제목 답변까지 유지한다", () => {
  const result = plan("피아노", {
    recentMessages: [
      { role: "user", content: "일정 추가" },
      { role: "assistant", content: "몇 시에 추가할까?" },
      { role: "user", content: "내일 오후 3시" },
      { role: "assistant", content: "어떤 일정인지 알려줘." },
    ],
  });

  assert.equal(result.detectedIntent, "schedule_create");
  assert.equal(result.shouldUseTool, true);
  assert.deepEqual(result.toolArgs, {
    title: "피아노",
    date: "2026-08-18",
    startTime: "15:00",
    endTime: null,
  });
});

test("일반 대화의 '어떤 일정' 질문은 과거 일정 등록을 되살리지 않는다", () => {
  const result = plan("좋아", {
    recentMessages: [
      { role: "user", content: "내일 오후 3시 피아노 일정 추가" },
      { role: "assistant", content: "피아노 일정을 추가했어." },
      { role: "user", content: "내일 일정이 걱정돼" },
      { role: "assistant", content: "어떤 일정이 제일 힘들 것 같아?" },
    ],
  });

  assert.equal(result.detectedIntent, "general_chat");
  assert.equal(result.toolName, null);
  assert.equal(result.shouldUseTool, false);
});

test("일정 제목을 묻는 중에도 아이의 명확한 새 의도를 가로채지 않는다", () => {
  const history = [
    { role: "user", content: "내일 오후 3시 일정 추가" },
    { role: "assistant", content: "어떤 일정인지 알려줘." },
  ];
  const cases = [
    ["엄마한테 전화해줘", "call_parent", "callParent"],
    ["내일 일정 알려줘", "schedule_query", "getScheduleByDate"],
    ["알람 설정 열어줘", "device_action", "openDeviceAction"],
    ["안녕", "general_chat", null],
    ["다른 얘기하자", "general_chat", null],
  ];

  for (const [message, detectedIntent, toolName] of cases) {
    const result = plan(message, { recentMessages: history });
    assert.equal(result.detectedIntent, detectedIntent, message);
    assert.equal(result.toolName, toolName, message);
    assert.notEqual(result.detectedIntent, "schedule_create", message);
  }
});

test("10분이 지난 일정 되묻기는 다음 대화를 일정 제목으로 삼지 않는다", () => {
  const result = plan("피아노", {
    referenceTime: "2026-08-17T12:10:01.000Z",
    recentMessages: [
      { role: "user", content: "내일 오후 3시 일정 추가", createdAt: "2026-08-17T12:00:00.000Z" },
      { role: "assistant", content: "어떤 일정인지 알려줘.", createdAt: "2026-08-17T12:00:00.000Z" },
    ],
  });

  assert.equal(result.detectedIntent, "general_chat");
  assert.equal(result.shouldUseTool, false);
  assert.equal(result.toolName, null);
});

test("배포 전 날짜 질문을 받은 대화도 오늘 답변으로 복구한다", () => {
  const result = plan("오늘", {
    recentMessages: [
      { role: "user", content: "오후3시 피아노 일정 추가" },
      { role: "assistant", content: "언제 일정인지 알려줘." },
    ],
  });
  assert.equal(result.detectedIntent, "schedule_create");
  assert.equal(result.shouldUseTool, true);
  assert.deepEqual(result.toolArgs, {
    title: "피아노",
    date: REFERENCE_DATE,
    startTime: "15:00",
    endTime: null,
  });
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
  // events 링크 해제(아이만 빼기)도 사라져야 한다. 일정 등록은 원자 저장 경계를 써서
  // 링크 실패 뒤 수동 DELETE 롤백에도 기대지 않는다.
  assert.doesNotMatch(route, /DELETE FROM events_children WHERE event_id=\? AND child_id=\?/);
  assert.doesNotMatch(route, /DELETE FROM events\b/);
  assert.match(route, /persistAiChildSchedule/);
});

test("확인된 AI 일정 수정도 저장 직후 가족 기기에 실시간 발행한다", () => {
  const route = readFileSync(new URL("../routes/ai-child-chat.ts", import.meta.url), "utf8");
  assert.match(
    route,
    /UPDATE events[\s\S]{0,900}notifyPg\(c\.env,\s*familyId,\s*"events",\s*"UPDATE"/,
  );
});

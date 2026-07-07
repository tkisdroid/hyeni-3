import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAiFriendControlPatch,
  normalizeAiControlTime,
  parseAiTopicText,
} from "../src/transform/aiFriendSettingsForm.ts";

test("금지 주제 입력은 쉼표와 줄바꿈을 안전하게 배열로 정규화한다", () => {
  assert.deepEqual(parseAiTopicText("게임, 욕설\n무서운 이야기\n게임"), ["게임", "욕설", "무서운 이야기"]);
});

test("선제 대화와 권한 설정은 서버 patch 형태로 정규화된다", () => {
  const patch = buildAiFriendControlPatch({
    forbiddenTopicsText: "게임\n모르는 사람",
    proactiveEnabled: true,
    proactiveStartTime: "07:30",
    proactiveEndTime: "20:15",
    quietHoursStart: "21:00",
    quietHoursEnd: "07:00",
    allowScheduleActions: false,
    allowContactActions: true,
  });

  assert.deepEqual(patch, {
    forbidden_topics: ["게임", "모르는 사람"],
    proactive_enabled: true,
    proactive_start_time: "07:30",
    proactive_end_time: "20:15",
    quiet_hours_start: "21:00",
    quiet_hours_end: "07:00",
    allow_schedule_actions: false,
    allow_contact_actions: true,
  });
});

test("시간 입력은 HH:MM 형식만 허용하고 잘못된 값은 안전한 기본값으로 낮춘다", () => {
  assert.equal(normalizeAiControlTime("9:5", "08:00"), "08:00");
  assert.equal(normalizeAiControlTime("24:00", "08:00"), "08:00");
  assert.equal(normalizeAiControlTime("09:05", "08:00"), "09:05");
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAiFriendControlPatch,
  isAiFriendControlFormDirty,
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
    buddyAttentionEnabled: false,
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
    buddy_attention_enabled: false,
  });
});

test("시간 입력은 HH:MM 형식만 허용하고 잘못된 값은 안전한 기본값으로 낮춘다", () => {
  assert.equal(normalizeAiControlTime("9:5", "08:00"), "08:00");
  assert.equal(normalizeAiControlTime("24:00", "08:00"), "08:00");
  assert.equal(normalizeAiControlTime("09:05", "08:00"), "09:05");
});

test("AI 상세 설정은 서버 기본값과 같으면 깨끗하고 의미 있는 입력 변경만 dirty로 판정한다", () => {
  const form = {
    forbiddenTopicsText: "게임\n게임",
    proactiveEnabled: false,
    proactiveStartTime: "08:00",
    proactiveEndTime: "20:00",
    quietHoursStart: "21:00",
    quietHoursEnd: "07:00",
    allowScheduleActions: true,
    allowContactActions: true,
    // 서버에 값이 없는 옛 가족은 켜짐이 기본이다 — 화면 초깃값과 같아야 미저장 변경으로 안 보인다.
    buddyAttentionEnabled: true,
  };

  assert.equal(isAiFriendControlFormDirty(form, { forbidden_topics: ["게임"] }), false);
  assert.equal(
    isAiFriendControlFormDirty({ ...form, quietHoursStart: "22:00" }, { forbidden_topics: ["게임"] }),
    true,
  );
  assert.equal(
    isAiFriendControlFormDirty({ ...form, allowContactActions: false }, { forbidden_topics: ["게임"] }),
    true,
  );
  // 부모가 "먼저 말 걸기"를 끄면 저장할 변경으로 잡혀야 한다(끈 게 조용히 사라지면 안 된다).
  assert.equal(
    isAiFriendControlFormDirty({ ...form, buddyAttentionEnabled: false }, { forbidden_topics: ["게임"] }),
    true,
  );
});

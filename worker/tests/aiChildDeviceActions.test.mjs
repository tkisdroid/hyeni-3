/**
 * 아이가 AI 친구에게 기기 동작을 부탁했을 때의 계약(2026-08-18 TK 지시).
 *
 * 앱은 소리·진동·무음을 대신 바꾸지 않고, 전화·문자를 대신 보내지도 않는다.
 * 알맞은 화면만 열어 주고 마지막 한 번은 아이가 누른다 —
 * 앱이 무음으로 바꿔 버리면 부모의 SOS·소리 울리기까지 조용해지기 때문이다.
 */
import "./helpers/tsModuleResolve.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const {
  CONTACT_DEVICE_ACTION_TARGETS,
  DEVICE_ACTION_TARGETS,
  detectChildDeviceActionIntent,
  isDeviceActionTarget,
} = await import("../shared/aiDeviceActionTools.js");
const { planChildAgentAction } = await import("../shared/aiAgentPlanner.js");
const { buildToolResultChildReply } = await import("../shared/aiToolResultReply.js");

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("소리·진동·무음 부탁은 설정 화면 열기로 계획한다", () => {
  for (const text of ["소리 켜줘", "진동으로 바꿔줘", "무음으로 해줘", "볼륨 좀 키워줘"]) {
    assert.deepEqual(detectChildDeviceActionIntent(text), { target: "sound" }, text);
  }
  const plan = planChildAgentAction("무음으로 해줘");
  assert.equal(plan.toolName, "openDeviceAction");
  assert.equal(plan.detectedIntent, "device_action");
  assert.equal(plan.toolArgs.target, "sound");
});

test("전화·문자·와이파이 같은 기기 앱도 열어 주기로만 계획한다", () => {
  assert.deepEqual(detectChildDeviceActionIntent("엄마한테 전화 걸어줘"), { target: "dial" });
  assert.deepEqual(detectChildDeviceActionIntent("문자 보내줘"), { target: "sms" });
  assert.deepEqual(detectChildDeviceActionIntent("와이파이 켜줘"), { target: "wifi" });
  assert.deepEqual(detectChildDeviceActionIntent("배터리 절전 켜줘"), { target: "battery" });
  // 부탁이 아닌 문장은 잡지 않는다.
  assert.equal(detectChildDeviceActionIntent("오늘 소리가 이상해"), null);
  assert.equal(detectChildDeviceActionIntent(""), null);
});

test("열 수 있는 화면은 화이트리스트이고 전화·문자만 부모 연락 허용을 따른다", () => {
  assert.deepEqual([...DEVICE_ACTION_TARGETS].sort(), [
    "battery", "dial", "location", "notifications", "sms", "sound", "wifi",
  ]);
  assert.deepEqual([...CONTACT_DEVICE_ACTION_TARGETS].sort(), ["dial", "sms"]);
  assert.equal(isDeviceActionTarget("sound"), true);
  assert.equal(isDeviceActionTarget("ringer_silent"), false);
  assert.equal(isDeviceActionTarget(""), false);
});

test("서버는 화면만 정하고 실행했다고 말하지 않는다", () => {
  const reply = buildToolResultChildReply({ ok: true, toolName: "openDeviceAction", target: "sound" });
  assert.match(reply, /대신 못 바꿔/);
  assert.match(reply, /소리 설정을 열어 줄게/);
  assert.doesNotMatch(reply, /바꿨어|껐어|켰어/);
});

test("route 는 화이트리스트 밖 target 과 연락 차단 가족을 거부한다", () => {
  const route = read("routes/ai-child-chat.ts");
  assert.match(route, /toolName === "openDeviceAction"/);
  assert.match(route, /if \(!isDeviceActionTarget\(target\)\)/);
  assert.match(route, /CONTACT_DEVICE_ACTION_TARGETS\.includes\(target\) && !contactActionsAllowed/);
  assert.match(route, /clientAction: "openDeviceAction"/);
  // LLM·크레딧 없이 결정적으로 답하는 도구 목록에 포함한다.
  assert.match(route, /CHILD_SETTINGS_AGENT_TOOLS = new Set\(\[[\s\S]*"openDeviceAction",/);
});

test("서버는 벨소리 모드를 직접 바꾸는 지시를 만들지 않는다", () => {
  const planner = read("shared/aiAgentPlanner.js");
  const tools = read("shared/aiDeviceActionTools.js");
  for (const source of [planner, tools]) {
    assert.doesNotMatch(source, /setRingerMode|RINGER_MODE|ACCESS_NOTIFICATION_POLICY/);
  }
});

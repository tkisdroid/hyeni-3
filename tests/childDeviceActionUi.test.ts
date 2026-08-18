/**
 * 아이 기기 동작 요청의 클라이언트 계약(2026-08-18 TK 지시).
 * 앱이 소리·진동·무음을 바꾸거나 전화·문자를 보내지 않는다 — 화면만 열고 마지막은 아이가 누른다.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DEVICE_ACTION_TARGETS,
  isDeviceActionTarget,
} from "../src/lib/native/deviceAction.ts";

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const bridge = read("src/lib/native/deviceAction.ts");
const chat = read("src/screens/child/AiFriendChat.tsx");
const plugin = read("android/app/src/main/java/com/hyeni/calendar/DeviceActionPlugin.java");
const koChild = JSON.parse(read("locales/ko/child.json")) as Record<string, string>;

test("열 수 있는 화면은 서버와 같은 화이트리스트다", () => {
  assert.deepEqual([...DEVICE_ACTION_TARGETS].sort(), [
    "battery", "dial", "location", "notifications", "sms", "sound", "wifi",
  ]);
  assert.equal(isDeviceActionTarget("sound"), true);
  assert.equal(isDeviceActionTarget("ringer_silent"), false);
  // 목록에 없는 값은 네이티브로 넘기지 않는다.
  assert.match(bridge, /if \(!isDeviceActionTarget\(input\.target\)\) return \{ opened: false, reason: "unsupported_target" \}/);
});

test("모든 화면에 아이가 누를 버튼 문구가 있다", () => {
  for (const target of DEVICE_ACTION_TARGETS) {
    const label = koChild[`child.aiChat.device.${target}`];
    assert.ok(label?.trim(), `${target} 버튼 문구가 없습니다`);
    assert.ok(label.length <= 20, `${target} 버튼 문구가 깁니다: ${label}`);
  }
  assert.ok(koChild["child.aiChat.device.unavailable"]?.trim());
});

test("대화 화면은 도착만으로 화면을 열지 않고 버튼을 세운다", () => {
  assert.match(chat, /tool\.toolName === "openDeviceAction"/);
  assert.match(chat, /setDeviceAction\(\{ target: tool\.target, phone: tool\.phone \?\? null \}\)/);
  assert.match(chat, /className="afc-device__open hy-press"/);
  assert.match(chat, /onClick=\{\(\) => \{[\s\S]{0,200}openDeviceAction\(deviceAction\)/);
  // 열지 못하면 연 척하지 않고 알린다.
  assert.match(chat, /child\.aiChat\.device\.unavailable/);
});

test("네이티브는 화면만 열고 발신·전송·벨소리 변경을 하지 않는다", () => {
  assert.match(plugin, /Intent\.ACTION_DIAL/);
  assert.match(plugin, /Intent\.ACTION_SENDTO/);
  assert.match(plugin, /Settings\.ACTION_SOUND_SETTINGS/);
  // 자동 발신·자동 전송·벨소리 변경 API 는 쓰지 않는다.
  // 주석에는 "ACTION_CALL 을 쓰지 않는다"고 적혀 있으므로 실제 호출 형태로 검사한다.
  assert.doesNotMatch(plugin, /Intent\.ACTION_CALL/);
  assert.doesNotMatch(plugin, /SmsManager|sendTextMessage/);
  assert.doesNotMatch(plugin, /setRingerMode|RINGER_MODE|setStreamVolume|setInterruptionFilter/);
});

test("새 권한 없이 동작한다", () => {
  const manifest = read("android/app/src/main/AndroidManifest.xml");
  assert.doesNotMatch(manifest, /ACCESS_NOTIFICATION_POLICY|MODIFY_AUDIO_SETTINGS_PRIVILEGED|SEND_SMS/);
  // 플러그인은 등록돼 있어야 실제로 열린다.
  assert.match(
    read("android/app/src/main/java/com/hyeni/calendar/MainActivity.java"),
    /registerPlugin\(DeviceActionPlugin\.class\)/,
  );
});

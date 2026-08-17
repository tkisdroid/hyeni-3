import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(resolve(rootDir, "src/screens/feature/RemoteAudio.tsx"), "utf8");
const koNotifications = JSON.parse(readFileSync(resolve(rootDir, "locales/ko/notifications.json"), "utf8"));

function assertSelectStates(message, states) {
  assert.match(message, /\{state,\s*select,/);
  for (const state of states) assert.match(message, new RegExp(`(?:^|\\s)${state}\\s*\\{`), state);
}

test("원격청취 화면은 민감 기능 투명성 안내를 보여준다", () => {
  for (const id of [
    "notifications.remoteAudio.visibleToChildTitle",
    "notifications.remoteAudio.visibleToChild",
    "notifications.remoteAudio.oneMinuteLimit",
    "notifications.remoteAudio.oneMinuteDetail",
    "notifications.remoteAudio.auditTitle",
    "notifications.remoteAudio.auditRecorded",
    "notifications.remoteAudio.emptyDescription",
    "notifications.remoteAudio.emergencyOnly",
  ]) assert.match(source, new RegExp(id.replaceAll(".", "\\.")), id);

  assert.match(koNotifications["notifications.remoteAudio.visibleToChild"], /아이가 누르지 않아도 연결.*아이 화면에 계속 표시/);
  assert.match(koNotifications["notifications.remoteAudio.oneMinuteLimit"], /1분 후 자동 종료/);
  assert.match(koNotifications["notifications.remoteAudio.auditRecorded"], /안전과 투명성.*청취 기록/);
  assert.match(koNotifications["notifications.remoteAudio.emptyDescription"], /위급할 때 주변 소리.*아이 화면에 계속 표시/);
  assert.match(koNotifications["notifications.remoteAudio.emergencyOnly"], /위급할 때만 사용/);
  assert.doesNotMatch(source, /한국어 (?:신뢰|안전|실패) (?:문구 기준|계약)/);
});

test("원격청취 실패 문구는 부모가 다음 행동을 알 수 있게 구체적이다", () => {
  assertSelectStates(koNotifications["notifications.remoteAudio.toast"], [
    "deviceUnavailable", "premiumOnly", "deviceNotFound", "auditUnavailable", "requestExpired", "captureExpired",
  ]);
  assert.match(source, /id: "notifications\.remoteAudio\.toast"[\s\S]*state: "deviceUnavailable"/);
  assert.match(source, /id: "notifications\.remoteAudio\.toast"[\s\S]*state: "premiumOnly"/);
  assert.match(source, /id: "notifications\.remoteAudio\.toast"[\s\S]*state: "deviceNotFound"/);
  assert.match(source, /sessionTiming\.phase === "request_expired"[\s\S]*state: "requestExpired"/);
  assert.match(koNotifications["notifications.remoteAudio.toast"], /deviceUnavailable \{아이 기기가 오프라인이거나 알림을 받을 수 없어요/);
  assert.match(koNotifications["notifications.remoteAudio.toast"], /premiumOnly \{주변 소리 듣기는 프리미엄.*SOS와 긴급 알림은 무료/);
  assert.match(koNotifications["notifications.remoteAudio.toast"], /deviceNotFound \{[^}]*아이 앱이 설치되어 있고 로그인되어 있는지 확인/);
  assert.match(koNotifications["notifications.remoteAudio.toast"], /requestExpired \{아이 기기가 1분 안에 연결되지 않아 요청을 종료했어요\}/);
});

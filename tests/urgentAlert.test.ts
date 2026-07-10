import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { URGENT_ALERT_TYPES, shouldInterruptForUrgentAlert } from "../src/transform/urgentAlert.ts";

const base = { role: "parent", currentHash: "#/parent/home" };

test("아이의 SOS·긴급 신호만 부모 화면을 가로챈다", () => {
  assert.equal(shouldInterruptForUrgentAlert({ ...base, alertType: "sos" }), true);
  assert.equal(shouldInterruptForUrgentAlert({ ...base, alertType: "emergency" }), true);
});

test("미도착 알림은 SOS 전면화면으로 전환하지 않는다(아이가 SOS 를 누른 것처럼 보임)", () => {
  assert.equal(shouldInterruptForUrgentAlert({ ...base, alertType: "not_arrived" }), false);
  assert.equal(shouldInterruptForUrgentAlert({ ...base, alertType: "missed_arrival" }), false);
  assert.equal(shouldInterruptForUrgentAlert({ ...base, alertType: "arrived" }), false);
  assert.equal(shouldInterruptForUrgentAlert({ ...base, alertType: "unregistered_stay" }), false);
  assert.deepEqual([...URGENT_ALERT_TYPES].sort(), ["emergency", "sos"]);
});

test("부모가 아니거나 이미 수신 화면이면 전환하지 않는다", () => {
  assert.equal(shouldInterruptForUrgentAlert({ ...base, role: "child", alertType: "sos" }), false);
  assert.equal(shouldInterruptForUrgentAlert({ ...base, role: null, alertType: "sos" }), false);
  assert.equal(
    shouldInterruptForUrgentAlert({ role: "parent", alertType: "sos", currentHash: "#/sos-receive" }),
    false,
  );
});

test("빈 alert_type 은 무시한다", () => {
  assert.equal(shouldInterruptForUrgentAlert({ ...base, alertType: undefined }), false);
  assert.equal(shouldInterruptForUrgentAlert({ ...base, alertType: "" }), false);
});

test("실시간 훅이 판정 함수를 쓴다(중복 집합 금지)", () => {
  const src = readFileSync(new URL("../src/queries/useFamilyRealtime.ts", import.meta.url), "utf8");
  assert.match(src, /shouldInterruptForUrgentAlert\(\{ role, alertType: row\?\.alert_type, currentHash: window\.location\.hash \}\)/);
  assert.ok(!src.includes('new Set(["sos", "emergency"'), "판정 집합이 두 곳에 있으면 안 된다");
});

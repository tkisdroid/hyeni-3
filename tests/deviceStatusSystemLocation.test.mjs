import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const reporter = readFileSync(
  new URL("../android/app/src/main/java/com/hyeni/calendar/DeviceStatusReporter.java", import.meta.url),
  "utf8",
);

// 2026-09-26 실기기: OS 위치 스위치가 꺼져 있는데 locationOk=true 로 보고됐다.
test("기기 상태 보고는 OS 위치 스위치를 함께 싣고 locationOk·ready 에 반영한다", () => {
  assert.match(reporter, /import android\.location\.LocationManager;/);
  assert.match(reporter, /static boolean isSystemLocationEnabled\(@Nullable LocationManager locationManager\)/);
  assert.match(reporter, /locationManager\.isLocationEnabled\(\)/);
  assert.match(reporter, /\.put\("locationOk", backgroundLocationGranted && systemLocationEnabled\)/);
  assert.match(reporter, /\.put\("systemLocationEnabled", systemLocationEnabled\)/);
  assert.match(reporter, /&& locationServiceRunning\s*&& systemLocationEnabled\);/);
  // 판정 불가(서비스 없음·예외)는 꺼졌다고 단정하지 않는다.
  assert.match(reporter, /if \(locationManager == null\) return true;/);
});

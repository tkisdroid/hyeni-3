import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AUTHORIZED_RELEASE_DEVICES,
  collectAuthorizedDeviceExitSummary,
  parseApplicationExitInfo,
  summarizeApplicationExitInfo,
} from "../scripts/android-exit-info-summary.mjs";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const FIXTURE = `
  ApplicationExitInfo #0:
    timestamp=2026-08-02 10:01:02.003 pid=10 realUid=100 packageUid=100
    process=com.google.android.webview:sandboxed_process0 reason=4 (CRASH) status=0
    description=사용자 입력이나 URL이 포함될 수 있는 원문
  ApplicationExitInfo #1:
    timestamp=2026-08-02 10:02:03.004 pid=11 realUid=100 packageUid=100
    process=com.hyeni.calendar reason=4 (CRASH) status=0
    description=민감한 원문
  ApplicationExitInfo #2:
    timestamp=2026-08-02 10:03:04.005 pid=12 realUid=100 packageUid=100
    process=com.hyeni.calendar reason=5 (NATIVE CRASH) status=0
  ApplicationExitInfo #3:
    timestamp=2026-08-02 10:04:05.006 pid=13 realUid=100 packageUid=100
    process=com.hyeni.calendar reason=6 (ANR) status=0
  ApplicationExitInfo #4:
    timestamp=2026-08-02 10:05:06.007 pid=14 realUid=100 packageUid=100
    process=com.hyeni.calendar reason=16 (PACKAGE UPDATED) status=0
`;

test("종료 이력 파서는 정확한 앱 process의 시각과 reason 숫자만 남긴다", () => {
  assert.deepEqual(parseApplicationExitInfo(FIXTURE), [
    { epochMs: Date.parse("2026-08-02T10:02:03.004+09:00"), reason: 4 },
    { epochMs: Date.parse("2026-08-02T10:03:04.005+09:00"), reason: 5 },
    { epochMs: Date.parse("2026-08-02T10:04:05.006+09:00"), reason: 6 },
    { epochMs: Date.parse("2026-08-02T10:05:06.007+09:00"), reason: 16 },
  ]);
});

test("요약은 시작 시각 이후 Java/native crash와 ANR만 센다", () => {
  const records = parseApplicationExitInfo(FIXTURE);
  assert.deepEqual(
    summarizeApplicationExitInfo(records, Date.parse("2026-08-02T10:03:00+09:00")),
    { javaCrash: 0, nativeCrash: 1, anr: 1, totalCrashOrAnr: 2 },
  );
});

test("승인된 A17 부모와 razr 아이만 조회하고 원문·serial을 결과에 저장하지 않는다", () => {
  const calls = [];
  const report = collectAuthorizedDeviceExitSummary({
    since: "2026-08-02T10:00:00+09:00",
    sinceMs: Date.parse("2026-08-02T10:00:00+09:00"),
    adbImpl(serial, args) {
      calls.push({ serial, args });
      if (args[0] === "get-state") return "device\n";
      if (args.includes("getprop")) return "Asia/Seoul\n";
      return FIXTURE;
    },
  });
  assert.deepEqual(
    [...new Set(calls.map((call) => call.serial))],
    AUTHORIZED_RELEASE_DEVICES.map((device) => device.serial),
  );
  assert.equal(report.assessment.verdict, "FAIL");
  assert.equal(report.assessment.totalCrashOrAnr, 6);
  const serialized = JSON.stringify(report);
  for (const device of AUTHORIZED_RELEASE_DEVICES) assert.doesNotMatch(serialized, new RegExp(device.serial));
  assert.doesNotMatch(serialized, /민감한 원문|사용자 입력이나 URL/);
  assert.deepEqual(report.privacy, {
    rawDumpsysStored: false,
    descriptionsStored: false,
    tracesStored: false,
    serialsStored: false,
  });
});

test("실행 스크립트는 S25를 열거하거나 raw dump·description·trace를 기록하지 않는다", async () => {
  const source = await readFile(resolve(ROOT_DIR, "scripts/android-exit-info-summary.mjs"), "utf8");
  assert.doesNotMatch(source, /adb["']?,\s*\[\s*["']devices|S25|dumpsys\s+dropbox|logcat/);
  assert.doesNotMatch(source, /getDescription|getTraceInputStream/);
});

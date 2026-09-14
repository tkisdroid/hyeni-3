import "./helpers/appModuleResolve.mjs";
import test from "node:test";
import assert from "node:assert/strict";
const { normalizeTimeZone, wallTimeToEpoch, dayWindowAt, appDateKeyAt } = await import("../shared/timeZone.ts");
const { nextEventDefault } = await import("../src/transform/eventDefaultTime.ts");

test("새 일정 기본 시각은 가족 자정과 DST를 넘어도 미래를 가리킨다", () => {
  assert.deepEqual(nextEventDefault("America/Los_Angeles", Date.parse("2026-09-14T06:45Z")), { dateKey: "2026-8-14", time: "00:00" });
  assert.deepEqual(nextEventDefault("America/Los_Angeles", Date.parse("2026-03-08T09:45Z")), { dateKey: "2026-2-8", time: "03:00" });
  assert.deepEqual(nextEventDefault("America/Los_Angeles", Date.parse("2026-11-01T09:15Z")), { dateKey: "2026-10-1", time: "02:00" });
});

test("시간대는 IANA만 받고 고정 offset·오염을 거부한다", () => {
  for (const bad of [null, "", "+09:00", "GMT+9", "Mars/Olympus", "Asia/Seoul\nsecret"]) assert.equal(normalizeTimeZone(bad), null);
  for (const good of ["UTC", "Asia/Seoul", "Asia/Kathmandu", "America/Los_Angeles", "Australia/Lord_Howe"]) assert.ok(normalizeTimeZone(good));
});
test("DST 중복·누락 벽시각을 한 개 UTC 사건으로 결정한다", () => {
  assert.equal(new Date(wallTimeToEpoch("2026-2-8", 150, "America/Los_Angeles")).toISOString(), "2026-03-08T10:30:00.000Z");
  assert.equal(new Date(wallTimeToEpoch("2026-10-1", 90, "America/Los_Angeles")).toISOString(), "2026-11-01T08:30:00.000Z");
  assert.throws(() => wallTimeToEpoch("2026-1-30", 0, "UTC"));
});
test("현지 하루는 DST에 따라 23·25시간이고 30분 전환도 보존한다", () => {
  for (const [instant, zone, hours] of [
    ["2026-03-08T12:00Z", "America/Los_Angeles", 23],
    ["2026-11-01T12:00Z", "America/Los_Angeles", 25],
    ["2026-04-05T04:00Z", "Australia/Lord_Howe", 24.5],
    ["2026-10-04T04:00Z", "Australia/Lord_Howe", 23.5],
  ] as const) {
    const window = dayWindowAt(Date.parse(instant), zone);
    assert.equal((window.endMs - window.startMs) / 3_600_000, hours);
  }
});
test("가족별 08시 위치 경계와 국제 날짜 변경선을 구분한다", () => {
  const now = Date.parse("2026-09-14T00:30Z");
  assert.equal(appDateKeyAt(now, "America/Los_Angeles"), "2026-8-13");
  assert.equal(appDateKeyAt(now, "Pacific/Kiritimati"), "2026-8-14");
  assert.equal(new Date(dayWindowAt(now, "Asia/Kathmandu", 480).startMs).toISOString(), "2026-09-13T02:15:00.000Z");
});

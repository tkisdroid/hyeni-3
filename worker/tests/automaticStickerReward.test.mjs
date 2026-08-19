import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "./helpers/tsModuleResolve.mjs";

const {
  AUTOMATIC_EARLY_ARRIVAL_WINDOW_MS,
  resolveAutomaticStickerReward,
} = await import("../lib/automaticStickerReward.ts");

const base = {
  kind: "schedule_early_arrival",
  familyId: "family-a",
  childUserId: "child-a",
  eventId: "event-a",
  occurrenceId: "occurrence-a",
  dateKey: "2026-7-20",
  scheduledAtMs: Date.parse("2026-08-20T01:00:00Z"),
};

test("일정 시작 전 60분 이내 도착은 조기 도착 스티커로 판정한다", () => {
  const reward = resolveAutomaticStickerReward({
    ...base,
    arrivedAtMs: base.scheduledAtMs - 12 * 60_000,
  });
  assert.deepEqual(reward, {
    ruleId: "schedule_early_arrival_v1",
    eventId: "auto:schedule_early_arrival_v1:occurrence-a",
    dateKey: "2026-7-20",
    stickerType: "early",
    emoji: "🌟",
    title: "일찍 도착했어요",
  });
});

test("정시·지각·한 시간보다 너무 이른 관측은 조기 도착 보상에서 제외한다", () => {
  assert.equal(resolveAutomaticStickerReward({ ...base, arrivedAtMs: base.scheduledAtMs }), null);
  assert.equal(resolveAutomaticStickerReward({ ...base, arrivedAtMs: base.scheduledAtMs + 1 }), null);
  assert.equal(resolveAutomaticStickerReward({
    ...base,
    arrivedAtMs: base.scheduledAtMs - AUTOMATIC_EARLY_ARRIVAL_WINDOW_MS - 1,
  }), null);
});

test("자동 보상은 occurrence 멱등키와 원자적 NOT EXISTS 삽입을 사용하고 두 위치 경로에 연결된다", () => {
  const rewardSource = readFileSync(new URL("../lib/automaticStickerReward.ts", import.meta.url), "utf8");
  const arbitrarySource = readFileSync(new URL("../lib/arrivalDetect.ts", import.meta.url), "utf8");
  const registeredSource = readFileSync(new URL("../cron/registered-place-geofence-check.ts", import.meta.url), "utf8");

  assert.match(rewardSource, /INSERT INTO stickers[\s\S]{0,500}NOT EXISTS/);
  assert.match(rewardSource, /role='child' AND is_active=1/);
  assert.match(rewardSource, /sendFcmToFamily\(/);
  assert.match(arbitrarySource, /awardAutomaticStickerForBehavior\(env, db/);
  assert.match(registeredSource, /awardAutomaticStickerForBehavior\(penv, db/);
});

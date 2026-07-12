import test from "node:test";
import assert from "node:assert/strict";

import {
  LOCATION_REFRESH_TIMEOUT_MS,
  waitForNewChildLocation,
} from "../src/transform/locationRefreshWait.ts";

test("위치 요청은 FCM TTL 뒤 도착한 native fix의 서버 반영까지 기다린다", () => {
  assert.ok(LOCATION_REFRESH_TIMEOUT_MS >= 210_000);
});

test("자녀 위치 조회가 멈춰도 deadline을 넘기지 않고 timeout으로 끝난다", async () => {
  let clock = 0;
  const result = await waitForNewChildLocation({
    before: { updated_at: "2026-07-12 13:45:00.000+00" },
    targetUserId: "child-1",
    refetch: () => new Promise(() => undefined),
    sleep: async (ms) => { clock += ms; },
    now: () => clock,
    timeoutMs: 1_000,
    pollMs: 100,
  });

  assert.equal(result, "timeout");
  assert.equal(clock, 1_000);
});

test("화면 이탈은 멈춘 자녀 위치 조회도 즉시 취소한다", async () => {
  let clock = 0;
  let cancelled = false;
  const result = await waitForNewChildLocation({
    before: null,
    targetUserId: "child-1",
    refetch: () => new Promise(() => undefined),
    isCancelled: () => cancelled,
    sleep: async (ms) => {
      clock += ms;
      if (clock >= 350) cancelled = true;
    },
    now: () => clock,
    timeoutMs: 5_000,
    pollMs: 100,
  });

  assert.equal(result, "cancelled");
  assert.ok(clock < 1_000);
});

test("일시적인 조회 실패 뒤 실제 updated_at 증가가 오면 성공한다", async () => {
  let calls = 0;
  let clock = 0;
  const result = await waitForNewChildLocation({
    before: { updated_at: "2026-07-12 13:45:00.000+00" },
    targetUserId: "child-1",
    refetch: async () => {
      calls += 1;
      if (calls === 1) return { isError: true, data: undefined };
      return {
        isError: false,
        data: [{ user_id: "child-1", lat: 37.3, lng: 127.1, updated_at: "2026-07-12 13:45:02.000+00" }],
      };
    },
    sleep: async (ms) => { clock += ms; },
    now: () => clock,
    timeoutMs: 10_000,
    pollMs: 1_000,
  });

  assert.equal(result, "updated");
  assert.equal(calls, 2);
});

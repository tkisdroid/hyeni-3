import assert from "node:assert/strict";
import test from "node:test";
import { parseRemoteListenMs } from "../src/transform/remoteListenStatusMs.ts";
import { resolveRemoteListenSessionTiming } from "../src/transform/remoteListenSessionTiming.ts";

test("parseRemoteListenMs 는 null/undefined/비숫자를 0 이 아니라 null 로 남긴다", () => {
  // ⚠️ Number(null) === 0 함정: null 을 유한값으로 강제하면 미동의 세션이 종료 상태로 둔갑한다.
  assert.equal(Number(null), 0);
  assert.equal(parseRemoteListenMs(null), null);
  assert.equal(parseRemoteListenMs(undefined), null);
  assert.equal(parseRemoteListenMs("12345"), null);
  assert.equal(parseRemoteListenMs(Number.NaN), null);
  assert.equal(parseRemoteListenMs(-1), null);
  assert.equal(parseRemoteListenMs(0), 0);
  assert.equal(parseRemoteListenMs(1_700_000_000_000), 1_700_000_000_000);
});

test("미동의·미종료 세션(서버 null 필드)은 파싱 후에도 waiting_for_consent 여야 한다", () => {
  // 서버가 방금 만든 세션은 consented/capture/ended 가 모두 JSON null 이다.
  const serverRow = {
    started_at_ms: 1_000_000 as number | null,
    consented_at_ms: null as number | null,
    capture_expires_at_ms: null as number | null,
    ended_at_ms: null as number | null,
    server_now_ms: 1_004_500 as number | null, // 시작 4.5초 후
  };

  const parsed = {
    startedAtMs: parseRemoteListenMs(serverRow.started_at_ms),
    consentedAtMs: parseRemoteListenMs(serverRow.consented_at_ms),
    captureExpiresAtMs: parseRemoteListenMs(serverRow.capture_expires_at_ms),
    endedAtMs: parseRemoteListenMs(serverRow.ended_at_ms),
    serverNowMs: parseRemoteListenMs(serverRow.server_now_ms),
  };

  // 핵심 회귀: null 필드는 null 이어야 한다(0 이면 아래 resolver 가 즉시 ended 로 닫는다).
  assert.equal(parsed.consentedAtMs, null);
  assert.equal(parsed.captureExpiresAtMs, null);
  assert.equal(parsed.endedAtMs, null);

  const timing = resolveRemoteListenSessionTiming({
    clientNowMs: 1_004_500,
    localRequestStartedAtMs: 1_000_000,
    serverNowMs: parsed.serverNowMs,
    serverStartedAtMs: parsed.startedAtMs,
    serverCheckedAtMs: parsed.serverNowMs,
    consentedAtMs: parsed.consentedAtMs,
    captureExpiresAtMs: parsed.captureExpiresAtMs,
    endedAtMs: parsed.endedAtMs,
  });

  assert.equal(timing.phase, "waiting_for_consent");
});

test("버그 재현: null→0 강제가 있었다면 같은 세션이 즉시 ended 로 조기 종료된다", () => {
  // 과거 finiteMs 의 Number(null) 강제를 재현 — 회귀가 되살아나면 이 대조로 드러난다.
  const buggy = (v: unknown): number | null => {
    const parsed = typeof v === "number" ? v : Number(v);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };
  assert.equal(buggy(null), 0); // 유한값으로 둔갑

  const timing = resolveRemoteListenSessionTiming({
    clientNowMs: 1_004_500,
    localRequestStartedAtMs: 1_000_000,
    serverNowMs: buggy(1_004_500),
    serverStartedAtMs: buggy(1_000_000),
    serverCheckedAtMs: buggy(1_004_500),
    consentedAtMs: buggy(null),
    captureExpiresAtMs: buggy(null),
    endedAtMs: buggy(null),
  });

  // endedAtMs=0 이 finite 로 취급되어 즉시 종료 → 사용자가 겪은 "몇 초 만에 1분 종료".
  assert.equal(timing.phase, "ended");
});

test("서버가 동의를 확정하면 파싱 후 consented 로 남은 시간을 유지한다", () => {
  const parsed = {
    startedAtMs: parseRemoteListenMs(1_000_000),
    consentedAtMs: parseRemoteListenMs(1_010_000),
    captureExpiresAtMs: parseRemoteListenMs(1_070_000),
    endedAtMs: parseRemoteListenMs(null),
    serverNowMs: parseRemoteListenMs(1_025_000),
  };

  const timing = resolveRemoteListenSessionTiming({
    clientNowMs: 1_025_000,
    localRequestStartedAtMs: 1_000_000,
    serverNowMs: parsed.serverNowMs,
    serverStartedAtMs: parsed.startedAtMs,
    serverCheckedAtMs: parsed.serverNowMs,
    consentedAtMs: parsed.consentedAtMs,
    captureExpiresAtMs: parsed.captureExpiresAtMs,
    endedAtMs: parsed.endedAtMs,
  });

  assert.equal(timing.phase, "consented");
  assert.equal(timing.remainingSeconds, 45);
});

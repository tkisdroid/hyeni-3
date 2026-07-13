import assert from "node:assert/strict";
import test from "node:test";
import {
  REMOTE_LISTEN_HARD_FALLBACK_MS,
  resolveRemoteListenSessionTiming,
} from "../src/transform/remoteListenSessionTiming.ts";

test("요청 65초 시점에도 서버 동의가 확인되면 캡처 만료까지 남은 시간을 유지한다", () => {
  const result = resolveRemoteListenSessionTiming({
    clientNowMs: 65_000,
    localRequestStartedAtMs: 0,
    serverNowMs: 65_000,
    serverStartedAtMs: 0,
    serverCheckedAtMs: 65_000,
    consentedAtMs: 50_000,
    captureExpiresAtMs: 110_000,
    endedAtMs: null,
  });

  assert.equal(result.phase, "consented");
  assert.equal(result.remainingSeconds, 45);
});

test("서버가 동의 없음으로 확인한 65초 이후에만 요청 만료로 판정한다", () => {
  const base = {
    clientNowMs: 65_000,
    localRequestStartedAtMs: 0,
    serverNowMs: 65_000,
    serverStartedAtMs: 0,
    consentedAtMs: null,
    captureExpiresAtMs: null,
    endedAtMs: null,
  } as const;

  assert.equal(
    resolveRemoteListenSessionTiming({ ...base, serverCheckedAtMs: 64_999 }).phase,
    "waiting_for_consent",
  );
  assert.equal(
    resolveRemoteListenSessionTiming({ ...base, serverCheckedAtMs: 65_000 }).phase,
    "request_expired",
  );
});

test("상태 조회가 실패해도 서버 동의 가능 구간에는 조기 종료하지 않는다", () => {
  const base = {
    localRequestStartedAtMs: 10_000,
    serverNowMs: null,
    serverStartedAtMs: null,
    serverCheckedAtMs: null,
    consentedAtMs: null,
    captureExpiresAtMs: null,
    endedAtMs: null,
  } as const;

  assert.equal(
    resolveRemoteListenSessionTiming({
      ...base,
      clientNowMs: 10_000 + REMOTE_LISTEN_HARD_FALLBACK_MS - 1,
    }).phase,
    "waiting_for_consent",
  );
  assert.equal(
    resolveRemoteListenSessionTiming({
      ...base,
      clientNowMs: 10_000 + REMOTE_LISTEN_HARD_FALLBACK_MS,
    }).phase,
    "request_expired",
  );
});

test("서버 캡처 절대 만료시각에 도달하면 첫 청크 여부와 무관하게 종료한다", () => {
  const result = resolveRemoteListenSessionTiming({
    clientNowMs: 120_000,
    localRequestStartedAtMs: 0,
    serverNowMs: 120_000,
    serverStartedAtMs: 0,
    serverCheckedAtMs: 120_000,
    consentedAtMs: 60_000,
    captureExpiresAtMs: 120_000,
    endedAtMs: null,
  });

  assert.equal(result.phase, "capture_expired");
  assert.equal(result.remainingSeconds, 0);
});

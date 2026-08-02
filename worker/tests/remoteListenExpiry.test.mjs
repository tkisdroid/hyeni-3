import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const expiry = await import("../lib/remoteListenExpiry.ts");

test("미동의 요청은 65초 정산 경계 뒤 request_timeout으로 닫는다", () => {
  const result = expiry.resolveRemoteListenExpiry({
    started_at: "1970-01-01 00:00:00.000+00",
    consented_at: null,
    capture_expires_at: null,
    ended_at: null,
  }, 65_000);

  assert.equal(result?.endReason, "request_timeout");
  assert.equal(result?.durationMs, 0);
});

test("동의 세션은 capture_expires_at을 넘기면 timeout으로 멱등 종료한다", () => {
  const result = expiry.resolveRemoteListenExpiry({
    started_at: "1970-01-01 00:00:10.000+00",
    consented_at: "1970-01-01 00:00:20.000+00",
    capture_expires_at: "1970-01-01 00:01:20.000+00",
    ended_at: null,
  }, 80_000);

  assert.equal(result?.endReason, "timeout");
  assert.equal(result?.endedAtMs, 80_000);
  assert.equal(result?.durationMs, 60_000);
  assert.equal(expiry.resolveRemoteListenExpiry({
    started_at: "1970-01-01 00:00:10.000+00",
    consented_at: "1970-01-01 00:00:20.000+00",
    capture_expires_at: "1970-01-01 00:01:20.000+00",
    ended_at: "1970-01-01 00:01:20.000+00",
  }, 90_000), null);
});

test("원격청취 만료 정리는 조회와 매분 cron 양쪽에서 실행한다", async () => {
  const route = await readFile(new URL("../routes/remote-listen.ts", import.meta.url), "utf8");
  const index = await readFile(new URL("../index.ts", import.meta.url), "utf8");

  assert.match(route, /closeExpiredRemoteListenSessions/);
  assert.match(index, /runRemoteListenExpiry/);
  assert.match(index, /name: "remote-listen-expiry"/);
});

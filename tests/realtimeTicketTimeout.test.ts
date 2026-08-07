import assert from "node:assert/strict";
import test from "node:test";

import { createBoundedRealtimeTicketRequest } from "../src/realtime/realtimeTicketRequest.ts";

test("고착된 realtime ticket 요청은 제한시간에 abort되고 호출자에게 실패를 반환한다", async () => {
  let requestSignal: AbortSignal | null = null;
  const request = createBoundedRealtimeTicketRequest(
    (signal) => {
      requestSignal = signal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          const error = new Error("fetch_aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      });
    },
    10,
  );

  await assert.rejects(request.promise, { name: "AbortError" });
  assert.equal(requestSignal?.aborted, true);
});

test("socket 종료는 진행 중인 realtime ticket 요청을 제한시간 전에도 즉시 취소한다", async () => {
  let requestSignal: AbortSignal | null = null;
  const request = createBoundedRealtimeTicketRequest(
    (signal) => {
      requestSignal = signal;
      return new Promise(() => {});
    },
    10_000,
  );

  request.abort();
  await assert.rejects(request.promise, { name: "AbortError" });
  assert.equal(requestSignal?.aborted, true);
});

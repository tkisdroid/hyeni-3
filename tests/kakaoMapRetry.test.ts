import test from "node:test";
import assert from "node:assert/strict";
import { retryKakaoMapLoad } from "../src/transform/kakaoMapRetry.ts";

test("Kakao 지도 로드는 첫 일시 실패 뒤 한 번만 자동 재시도한다", async () => {
  let attempts = 0;
  let waits = 0;

  const result = await retryKakaoMapLoad(
    async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("첫 SDK 요청 실패");
      return "loaded";
    },
    async () => {
      waits += 1;
    },
  );

  assert.equal(result, "loaded");
  assert.equal(attempts, 2);
  assert.equal(waits, 1);
});

test("Kakao 지도 로드는 두 번째 실패를 그대로 전달하고 더 반복하지 않는다", async () => {
  let attempts = 0;
  const finalError = new Error("두 번째 SDK 요청 실패");

  await assert.rejects(
    retryKakaoMapLoad(
      async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("첫 SDK 요청 실패");
        throw finalError;
      },
      async () => undefined,
    ),
    (error) => error === finalError,
  );

  assert.equal(attempts, 2);
});

test("Kakao 지도 로드는 첫 시도가 성공하면 대기하거나 재시도하지 않는다", async () => {
  let attempts = 0;
  let waits = 0;

  const result = await retryKakaoMapLoad(
    async () => {
      attempts += 1;
      return "loaded";
    },
    async () => {
      waits += 1;
    },
  );

  assert.equal(result, "loaded");
  assert.equal(attempts, 1);
  assert.equal(waits, 0);
});

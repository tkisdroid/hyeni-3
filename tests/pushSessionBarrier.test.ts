import test from "node:test";
import assert from "node:assert/strict";

import {
  acquirePushRegistrationPermit,
  beginPushSessionCleanup,
} from "../src/lib/pushSessionBarrier.ts";

test("세션 정리가 시작되면 진행 중 등록을 취소하고 정리가 끝날 때까지 새 등록을 막는다", async () => {
  const firstPermit = await acquirePushRegistrationPermit();
  const cleanup = beginPushSessionCleanup();

  assert.equal(firstPermit.signal.aborted, true);

  let registrationsStopped = false;
  const stopped = cleanup.waitForRegistrations().then(() => {
    registrationsStopped = true;
  });
  await Promise.resolve();
  assert.equal(registrationsStopped, false);

  let secondResolved = false;
  const secondPromise = acquirePushRegistrationPermit().then((permit) => {
    secondResolved = true;
    return permit;
  });

  firstPermit.release();
  await stopped;
  assert.equal(registrationsStopped, true);
  await Promise.resolve();
  assert.equal(secondResolved, false);

  cleanup.finish();
  const secondPermit = await secondPromise;
  assert.equal(secondPermit.signal.aborted, false);
  secondPermit.release();
});

test("겹친 정리가 모두 끝나기 전에는 새 등록 허가를 내주지 않는다", async () => {
  const firstCleanup = beginPushSessionCleanup();
  const secondCleanup = beginPushSessionCleanup();

  let resolved = false;
  const permitPromise = acquirePushRegistrationPermit().then((permit) => {
    resolved = true;
    return permit;
  });

  firstCleanup.finish();
  await Promise.resolve();
  assert.equal(resolved, false);

  secondCleanup.finish();
  const permit = await permitPromise;
  assert.equal(resolved, true);
  permit.release();
});

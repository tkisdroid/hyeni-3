import test from "node:test";
import assert from "node:assert/strict";

import {
  createNativeQueryResumeCoordinator,
  resumeActiveQueriesAfterNativeForeground,
  shouldRefetchOnWindowFocus,
} from "../src/queries/nativeQueryResume.ts";

const flushAsync = () => new Promise<void>((resolve) => setImmediate(resolve));

test("웹은 창 포커스 갱신을 유지하고 네이티브는 수명주기 갱신만 사용한다", () => {
  assert.equal(shouldRefetchOnWindowFocus(false), true);
  assert.equal(shouldRefetchOnWindowFocus(true), false);
});

test("최초 active와 중복 active는 조회하지 않고 inactive 복귀만 한 번 실행한다", async () => {
  let calls = 0;
  const coordinator = createNativeQueryResumeCoordinator({
    resume: async () => { calls += 1; },
    onError: () => undefined,
  });

  coordinator.initialize(true);
  coordinator.handleAppState(true);
  coordinator.handleAppState(false);
  assert.equal(calls, 0);

  coordinator.handleAppState(true);
  await flushAsync();
  assert.equal(calls, 1);

  coordinator.handleAppState(true);
  await flushAsync();
  assert.equal(calls, 1);
});

test("복구 중 여러 번 다시 복귀해도 후속 작업은 한 번만 직렬 실행한다", async () => {
  let calls = 0;
  let releaseFirst: () => void = () => undefined;
  const firstRun = new Promise<void>((resolve) => {
    releaseFirst = () => resolve();
  });
  const coordinator = createNativeQueryResumeCoordinator({
    resume: async () => {
      calls += 1;
      if (calls === 1) await firstRun;
    },
    onError: () => undefined,
  });

  coordinator.initialize(false);
  coordinator.handleAppState(true);
  await flushAsync();
  assert.equal(calls, 1);

  coordinator.handleAppState(false);
  coordinator.handleAppState(true);
  coordinator.handleAppState(false);
  coordinator.handleAppState(true);
  await flushAsync();
  assert.equal(calls, 1);

  releaseFirst();
  await flushAsync();
  await flushAsync();
  assert.equal(calls, 2);
});

test("dispose 뒤에는 새 복구 작업을 실행하지 않는다", async () => {
  let calls = 0;
  const coordinator = createNativeQueryResumeCoordinator({
    resume: async () => { calls += 1; },
    onError: () => undefined,
  });
  coordinator.initialize(false);
  coordinator.dispose();
  coordinator.handleAppState(true);
  await flushAsync();
  assert.equal(calls, 0);
});

test("복구 실패를 보고한 뒤 다음 inactive 복귀는 다시 실행한다", async () => {
  let calls = 0;
  const errors: unknown[] = [];
  const coordinator = createNativeQueryResumeCoordinator({
    resume: async () => {
      calls += 1;
      if (calls === 1) throw new Error("첫 복구 실패");
    },
    onError: (error) => { errors.push(error); },
  });

  coordinator.initialize(false);
  coordinator.handleAppState(true);
  await flushAsync();
  assert.equal(calls, 1);
  assert.equal(errors.length, 1);

  coordinator.handleAppState(false);
  coordinator.handleAppState(true);
  await flushAsync();
  assert.equal(calls, 2);
});

test("네이티브 세션을 채택하면 Auth 동기화와 렌더 대기 뒤 활성 query를 조회한다", async () => {
  const events: string[] = [];
  await resumeActiveQueriesAfterNativeForeground({
    adoptSession: async () => { events.push("adopt"); return true; },
    syncSession: () => { events.push("sync"); },
    waitForAuthRender: async () => { events.push("wait"); },
    isDisposed: () => false,
    refetchActiveQueries: async () => { events.push("refetch"); },
  });
  assert.deepEqual(events, ["adopt", "sync", "wait", "refetch"]);
});

test("세션 변경이 없으면 렌더 대기 없이 활성 query를 조회한다", async () => {
  const events: string[] = [];
  await resumeActiveQueriesAfterNativeForeground({
    adoptSession: async () => { events.push("adopt"); return false; },
    syncSession: () => { events.push("sync"); },
    waitForAuthRender: async () => { events.push("wait"); },
    isDisposed: () => false,
    refetchActiveQueries: async () => { events.push("refetch"); },
  });
  assert.deepEqual(events, ["adopt", "refetch"]);
});

test("정리 중 끝난 세션 채택은 Auth와 query를 다시 살리지 않는다", async () => {
  const events: string[] = [];
  let disposed = false;
  await resumeActiveQueriesAfterNativeForeground({
    adoptSession: async () => { events.push("adopt"); disposed = true; return true; },
    syncSession: () => { events.push("sync"); },
    waitForAuthRender: async () => { events.push("wait"); },
    isDisposed: () => disposed,
    refetchActiveQueries: async () => { events.push("refetch"); },
  });
  assert.deepEqual(events, ["adopt"]);
});

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  acquirePrivateObjectUrl,
  clearPrivateObjectUrlCache,
  peekPrivateObjectUrl,
} from "../src/lib/api/privateObjectUrlCache.ts";

const originalRevokeObjectUrl = URL.revokeObjectURL;

afterEach(() => {
  clearPrivateObjectUrlCache();
  URL.revokeObjectURL = originalRevokeObjectUrl;
});

test("같은 비공개 객체 키는 한 번만 가져오고 마지막 lease 해제 때 URL을 회수한다", async () => {
  const revoked: string[] = [];
  URL.revokeObjectURL = (url) => revoked.push(url);
  clearPrivateObjectUrlCache();

  let loadCount = 0;
  let loaderSignal: AbortSignal | null = null;
  const loader = async (signal: AbortSignal) => {
    loadCount += 1;
    loaderSignal = signal;
    return "blob:private-one";
  };
  const first = acquirePrivateObjectUrl("child:one", loader);
  const second = acquirePrivateObjectUrl("child:one", loader);

  assert.strictEqual(first.url, second.url);
  assert.equal(await first.url, "blob:private-one");
  assert.equal(loadCount, 1);

  first.release();
  assert.deepEqual(revoked, []);
  assert.equal(loaderSignal?.aborted, false);
  second.release();
  assert.deepEqual(revoked, ["blob:private-one"]);
  assert.equal(loaderSignal?.aborted, true);
  second.release();
  assert.deepEqual(revoked, ["blob:private-one"], "release는 멱등이어야 한다");
});

test("세션이 바뀐 뒤 늦게 끝난 비공개 객체 요청은 노출하지 않고 즉시 회수한다", async () => {
  const revoked: string[] = [];
  URL.revokeObjectURL = (url) => revoked.push(url);
  clearPrivateObjectUrlCache();

  let resolveLoader: ((url: string) => void) | null = null;
  let loaderSignal: AbortSignal | null = null;
  const lease = acquirePrivateObjectUrl(
    "child:late",
    (signal) => new Promise<string>((resolve) => {
      loaderSignal = signal;
      resolveLoader = resolve;
    }),
  );

  await Promise.resolve();
  clearPrivateObjectUrlCache();
  assert.equal(loaderSignal?.aborted, true);
  assert.ok(resolveLoader);
  resolveLoader("blob:stale-session");

  assert.equal(await lease.url, null);
  assert.deepEqual(revoked, ["blob:stale-session"]);
  lease.release();
});

test("화면이 먼저 사라진 pending 요청도 완료 즉시 URL을 회수한다", async () => {
  const revoked: string[] = [];
  URL.revokeObjectURL = (url) => revoked.push(url);
  let resolveLoader: ((url: string) => void) | null = null;
  let loaderSignal: AbortSignal | null = null;
  const lease = acquirePrivateObjectUrl(
    "child:offscreen",
    (signal) => new Promise<string>((resolve) => {
      loaderSignal = signal;
      resolveLoader = resolve;
    }),
  );

  await Promise.resolve();
  lease.release();
  assert.equal(loaderSignal?.aborted, true);
  assert.ok(resolveLoader);
  resolveLoader("blob:offscreen");
  assert.equal(await lease.url, null);
  assert.deepEqual(revoked, ["blob:offscreen"]);
});

test("마지막 lease 해제는 AbortSignal을 따르는 pending loader를 취소하고 null로 종료한다", async () => {
  let loaderSignal: AbortSignal | null = null;
  const lease = acquirePrivateObjectUrl(
    "child:abort-aware",
    (signal) => new Promise<string>((_resolve, reject) => {
      loaderSignal = signal;
      signal.addEventListener("abort", () => reject(new Error("loader_aborted")), { once: true });
    }),
  );

  await Promise.resolve();
  lease.release();

  assert.equal(loaderSignal?.aborted, true);
  assert.equal(await lease.url, null);
});

test("실패한 비공개 객체 요청은 cache에서 제거되어 다음 lease로 복구된다", async () => {
  clearPrivateObjectUrlCache();
  let loadCount = 0;

  const failed = acquirePrivateObjectUrl("child:retry", async () => {
    loadCount += 1;
    throw new Error("temporary_failure");
  });
  await assert.rejects(failed.url, /temporary_failure/);
  failed.release();

  const recovered = acquirePrivateObjectUrl("child:retry", async () => {
    loadCount += 1;
    return "blob:recovered";
  });
  assert.equal(await recovered.url, "blob:recovered");
  assert.equal(loadCount, 2);
  recovered.release();
});

test("순차 소비한 객체는 cache에 무상한 축적되지 않는다", async () => {
  const revoked: string[] = [];
  URL.revokeObjectURL = (url) => revoked.push(url);

  for (let index = 0; index < 40; index += 1) {
    const lease = acquirePrivateObjectUrl(`child:${index}`, async () => `blob:private-${index}`);
    await lease.url;
    lease.release();
  }

  assert.equal(revoked.length, 40);
});

test("가족 사진처럼 retainMs 를 준 키는 받아 둔 URL 을 잠시 더 두고 다시 오면 그대로 쓴다", async () => {
  // 2026-09-26 Safari: 설정에 들어올 때마다 보호자 사진을 다시 받아 기본 캐릭터가 보였다 바뀌었다.
  const revoked: string[] = [];
  URL.revokeObjectURL = (url) => revoked.push(url);
  let loadCount = 0;
  const loader = async () => { loadCount += 1; return "blob:family-avatar"; };
  const first = acquirePrivateObjectUrl("child:avatar", loader, { retainMs: 60 });
  assert.equal(await first.url, "blob:family-avatar");
  first.release();
  assert.deepEqual(revoked, [], "retain 동안은 회수하지 않는다");
  assert.equal(peekPrivateObjectUrl("child:avatar"), "blob:family-avatar");

  const again = acquirePrivateObjectUrl("child:avatar", loader, { retainMs: 60 });
  assert.equal(await again.url, "blob:family-avatar");
  assert.equal(loadCount, 1, "다시 들어와도 새로 받지 않는다");
  again.release();
  await new Promise((resolve) => setTimeout(resolve, 90));
  assert.deepEqual(revoked, ["blob:family-avatar"], "retain 이 지나면 회수한다");
  assert.equal(peekPrivateObjectUrl("child:avatar"), null);
});

test("retainMs 를 줘도 아직 받는 중인 요청과 세션 교체는 즉시 회수한다", async () => {
  const revoked: string[] = [];
  URL.revokeObjectURL = (url) => revoked.push(url);
  let loaderSignal: AbortSignal | null = null;
  const pending = acquirePrivateObjectUrl("child:pending", (signal) => {
    loaderSignal = signal;
    return new Promise<string>(() => {});
  }, { retainMs: 60_000 });
  await Promise.resolve();
  pending.release();
  assert.equal(loaderSignal?.aborted, true);

  const kept = acquirePrivateObjectUrl("child:kept", async () => "blob:kept", { retainMs: 60_000 });
  await kept.url;
  kept.release();
  clearPrivateObjectUrlCache();
  assert.deepEqual(revoked, ["blob:kept"], "로그아웃·세션 교체는 retain 을 기다리지 않는다");
});

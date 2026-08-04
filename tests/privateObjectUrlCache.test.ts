import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  acquirePrivateObjectUrl,
  clearPrivateObjectUrlCache,
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

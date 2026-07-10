import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  createOAuthCodeOnce,
  oauthCodeKey,
  OAUTH_ONCE_HISTORY,
  type OAuthOnceStore,
} from "../src/transform/oauthCodeOnce.ts";

function memStore(seed: string[] = []): OAuthOnceStore & { keys: string[] } {
  const keys = [...seed];
  return {
    keys,
    read: () => keys,
    write: (next) => {
      keys.length = 0;
      keys.push(...next);
    },
  };
}

const KEY = oauthCodeKey("google", "CODE123");

test("같은 인가코드는 두 번 교환하지 않는다(순차 재진입)", async () => {
  const store = memStore();
  const once = createOAuthCodeOnce(store);
  let calls = 0;
  const exec = async () => {
    calls += 1;
    return true;
  };

  assert.equal(await once.run(KEY, exec), true);
  assert.equal(await once.run(KEY, exec), true); // 진행 중 Promise 재사용
  assert.equal(calls, 1);
});

test("동시 진입(getLaunchUrl + appUrlOpen)에도 교환은 1회다", async () => {
  const store = memStore();
  const once = createOAuthCodeOnce(store);
  let calls = 0;
  const exec = () =>
    new Promise<boolean>((resolve) => {
      calls += 1;
      setTimeout(() => resolve(true), 10);
    });

  const [a, b, c] = await Promise.all([once.run(KEY, exec), once.run(KEY, exec), once.run(KEY, exec)]);
  assert.equal(calls, 1, "동시 3회 진입 → 실제 교환은 1회여야 한다");
  assert.deepEqual([a, b, c], [true, true, true]);
});

test("프로세스 재시작(stale launch URL) 후에도 소비된 코드는 재교환하지 않는다", async () => {
  const store = memStore();
  let calls = 0;
  const exec = async () => {
    calls += 1;
    return true;
  };
  await createOAuthCodeOnce(store).run(KEY, exec);

  // 새 인스턴스 = 새 프로세스. 영속 store 만 공유된다.
  const revived = createOAuthCodeOnce(store);
  assert.equal(revived.consumed(KEY), true);
  assert.equal(await revived.run(KEY, exec), false, "재교환 대신 skip");
  assert.equal(calls, 1);
});

test("실행 실패해도 코드는 소비된 것으로 남는다(1회용 코드는 되살아나지 않는다)", async () => {
  const store = memStore();
  const once = createOAuthCodeOnce(store);
  let calls = 0;
  const exec = async () => {
    calls += 1;
    throw new Error("token_exchange_failed");
  };

  await assert.rejects(() => once.run(KEY, exec));
  assert.equal(store.read().includes(KEY), true, "실행 직전에 영속화되어야 한다");
  assert.equal(await createOAuthCodeOnce(store).run(KEY, exec), false);
  assert.equal(calls, 1);
});

test("다른 코드는 정상적으로 교환된다", async () => {
  const store = memStore();
  const once = createOAuthCodeOnce(store);
  let calls = 0;
  const exec = async () => {
    calls += 1;
    return true;
  };
  await once.run(oauthCodeKey("google", "A"), exec);
  await once.run(oauthCodeKey("kakao", "A"), exec); // provider 가 다르면 다른 키
  await once.run(oauthCodeKey("google", "B"), exec);
  assert.equal(calls, 3);
});

test("영속 목록은 상한을 넘지 않는다", async () => {
  const store = memStore();
  const once = createOAuthCodeOnce(store);
  for (let i = 0; i < OAUTH_ONCE_HISTORY + 3; i += 1) {
    await once.run(oauthCodeKey("google", `C${i}`), async () => true);
  }
  assert.equal(store.read().length, OAUTH_ONCE_HISTORY);
  assert.equal(store.read().includes(oauthCodeKey("google", "C0")), false, "오래된 키는 밀려난다");
});

test("딥링크 핸들러가 1회 소비 가드를 실제로 쓴다(배선 회귀)", () => {
  const src = readFileSync(new URL("../src/lib/native/oauthDeepLink.ts", import.meta.url), "utf8");
  assert.match(src, /createOAuthCodeOnce/);
  assert.match(src, /oauthCodeKey\(cb\.provider, cb\.code\)/);
  // 리스너를 먼저 등록하고 launch URL 을 나중에 처리해야 인텐트를 놓치지 않는다.
  assert.ok(
    src.indexOf("addListener") < src.indexOf("getLaunchUrl"),
    "appUrlOpen 리스너 등록이 getLaunchUrl 처리보다 앞서야 한다",
  );
  // 중복 등록(리스너 스택) 방지.
  assert.match(src, /listenerRefs|initialized/);
});

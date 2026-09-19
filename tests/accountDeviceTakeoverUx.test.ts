import "./helpers/appModuleResolve.mjs";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const {
  consumeSessionEndReason,
  rememberSessionEndReason,
} = await import("../src/auth/sessionEndReason.ts");

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("다른 설치가 계정을 인계하면 이전 기기의 종료 사유를 한 번만 안내한다", () => {
  const previousStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: new MemoryStorage(),
  });
  try {
    rememberSessionEndReason("device_session_inactive");
    assert.equal(consumeSessionEndReason(), "device_session_inactive");
    assert.equal(consumeSessionEndReason(), null);
  } finally {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: previousStorage,
    });
  }
});

test("자동 세션 종료는 캐시와 위치 세션을 지우고 온보딩에 원인을 표시한다", () => {
  const client = read("src/lib/api/client.ts");
  const provider = read("src/auth/AuthProvider.tsx");
  const onboarding = read("src/screens/onboarding/Onboarding.tsx");
  const korean = JSON.parse(read("locales/ko/onboarding.json"));

  assert.match(client, /return classifyRefreshFailure\(code\)/);
  assert.match(client, /rememberSessionEndReason\("device_session_inactive"\)/);
  assert.equal((client.match(/endRejectedApiSession\(\w+\)/g) ?? []).length >= 2, true);
  assert.match(provider, /if \(!tokens\.access\)[\s\S]{0,180}queryClient\.clear\(\)[\s\S]{0,180}stopLocationTracking/);
  assert.match(onboarding, /consumeSessionEndReason\(\) === "device_session_inactive"/);
  assert.match(onboarding, /role="alert"[\s\S]{0,160}onboarding\.session\.deviceInactive/);
  assert.match(korean["onboarding.session.deviceInactive"], /다른 기기[\s\S]*자동 로그아웃/);
});

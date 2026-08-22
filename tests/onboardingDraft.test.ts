import test from "node:test";
import assert from "node:assert/strict";

import {
  clearOnboardingDraft,
  createOnboardingDraft,
  parseOnboardingDraft,
  readOnboardingDraft,
} from "../src/transform/onboardingDraft.ts";

const now = Date.parse("2026-08-22T00:00:00.000Z");

test("OAuth 왕복용 초대·가입 설문은 짧은 TTL과 고정 선택지만 보존한다", () => {
  const draft = createOnboardingDraft({
    pairInvite: { code: "KID-AB12CD34", role: "parent", roleExplicit: true },
    signupMethod: { kind: "oauth", provider: "google" },
    surveyChoices: ["location", "schedule", "location", "free-text"],
  }, now);
  const parsed = parseOnboardingDraft(JSON.stringify(draft), now + 60_000);

  assert.deepEqual(parsed?.pairInvite, { code: "KID-AB12CD34", role: "parent", roleExplicit: true });
  assert.deepEqual(parsed?.signupMethod, { kind: "oauth", provider: "google" });
  assert.deepEqual(parsed?.surveyChoices, ["location", "schedule"]);
});

test("만료되거나 변조된 역할·provider의 draft는 복원하지 않는다", () => {
  const valid = createOnboardingDraft({
    pairInvite: null,
    signupMethod: { kind: "phone" },
    surveyChoices: [],
  }, now);
  assert.equal(parseOnboardingDraft(JSON.stringify(valid), valid.expiresAtMs + 1), null);
  assert.equal(parseOnboardingDraft(JSON.stringify({ ...valid, signupMethod: { kind: "oauth", provider: "apple" } }), now), null);
  assert.equal(parseOnboardingDraft(JSON.stringify({ ...valid, pairInvite: { code: "KID-AB12CD34", role: "admin" } }), now), null);
});

class MemoryStorage {
  #values = new Map<string, string>();

  constructor(entries: [string, string][] = []) {
    for (const [key, value] of entries) this.#values.set(key, value);
  }

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.#values.set(key, value);
  }

  removeItem(key: string): void {
    this.#values.delete(key);
  }
}

test("다른 탭이 local draft를 갱신해도 현재 탭의 OAuth draft를 복구하고 상대 draft를 지우지 않는다", () => {
  const key = "hyeni-onboarding-draft-v1";
  const currentTabDraft = createOnboardingDraft({
    pairInvite: { code: "KID-PARENT-TAB-A", role: "parent", roleExplicit: true },
    signupMethod: { kind: "oauth", provider: "google" },
    surveyChoices: ["location"],
  });
  const otherTabDraft = createOnboardingDraft({
    pairInvite: null,
    signupMethod: { kind: "phone" },
    surveyChoices: ["schedule"],
  });
  const currentRaw = JSON.stringify(currentTabDraft);
  const otherRaw = JSON.stringify(otherTabDraft);
  const sessionStorage = new MemoryStorage([[key, currentRaw]]);
  const localStorage = new MemoryStorage([[key, otherRaw]]);
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { sessionStorage, localStorage },
  });

  try {
    assert.deepEqual(readOnboardingDraft(), currentTabDraft);
    assert.equal(localStorage.getItem(key), otherRaw);

    clearOnboardingDraft();
    assert.equal(sessionStorage.getItem(key), null);
    assert.equal(localStorage.getItem(key), otherRaw);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

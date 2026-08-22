import test from "node:test";
import assert from "node:assert/strict";

import {
  createOnboardingDraft,
  parseOnboardingDraft,
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


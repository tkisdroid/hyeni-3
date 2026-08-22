import test from "node:test";
import assert from "node:assert/strict";

import {
  resolvePairInviteAction,
  resolvePostAuthAction,
  resolveSignupContinuation,
} from "../src/transform/onboardingFlow.ts";
import { ONBOARDING_INTERESTS as clientOnboardingInterests } from "../src/transform/onboardingPreferences.ts";
import { ONBOARDING_INTERESTS as workerOnboardingInterests } from "../worker/lib/onboardingPreferences.ts";

test("가입 설문 allowlist는 앱과 Worker가 같은 순서와 값으로 유지한다", () => {
  assert.deepEqual(clientOnboardingInterests, workerOnboardingInterests);
});

test("회원가입 설문 뒤에는 선택한 전화·소셜 수단을 잃지 않고 이어간다", () => {
  assert.deepEqual(resolveSignupContinuation({ kind: "phone" }), { kind: "phone-form" });
  assert.deepEqual(resolveSignupContinuation({ kind: "oauth", provider: "kakao" }), {
    kind: "oauth",
    provider: "kakao",
  });
  assert.deepEqual(resolveSignupContinuation({ kind: "oauth", provider: "google" }), {
    kind: "oauth",
    provider: "google",
  });
});

test("명시적 공동 보호자 초대는 미인증 사용자를 부모 인증으로 보낸다", () => {
  assert.equal(resolvePairInviteAction({
    inviteRole: "parent",
    roleExplicit: true,
    authStatus: "unauthenticated",
    authRole: null,
    familyId: null,
  }), "parent-auth");
});

test("아이 초대는 익명 아이 세션으로, 기존 공동 보호자 링크는 부모 페어링으로 간다", () => {
  assert.equal(resolvePairInviteAction({
    inviteRole: "child",
    roleExplicit: true,
    authStatus: "unauthenticated",
    authRole: null,
    familyId: null,
  }), "child-session");
  assert.equal(resolvePairInviteAction({
    inviteRole: "child",
    roleExplicit: false,
    authStatus: "authenticated",
    authRole: "parent",
    familyId: null,
  }), "parent-pair");
});

test("역할 정보가 없던 기존 링크는 미인증 사용자를 아이로 단정하지 않는다", () => {
  assert.equal(resolvePairInviteAction({
    inviteRole: "child",
    roleExplicit: false,
    authStatus: "unauthenticated",
    authRole: null,
    familyId: null,
  }), "choose-role");
});

test("명시적 아이 링크로 로그인한 부모를 자녀나 공동 보호자로 자동 변경하지 않는다", () => {
  assert.equal(resolvePairInviteAction({
    inviteRole: "child",
    roleExplicit: true,
    authStatus: "authenticated",
    authRole: "parent",
    familyId: null,
  }), "role-mismatch");
});

test("가족이 있는 기존 회원은 어떤 초대 링크도 현재 역할 홈이 우선한다", () => {
  for (const inviteRole of ["child", "parent"] as const) {
    assert.equal(resolvePairInviteAction({
      inviteRole,
      roleExplicit: true,
      authStatus: "authenticated",
      authRole: "parent",
      familyId: "family-existing",
    }), "role-home");
  }
});

test("부모 인증 후에는 기존 가족·초대·일반 가입을 서로 섞지 않는다", () => {
  assert.equal(resolvePostAuthAction({ authRole: "parent", familyExists: true, pendingParentInvite: true }), "role-home");
  assert.equal(resolvePostAuthAction({ authRole: "child", familyExists: true, pendingParentInvite: false }), "role-home");
  assert.equal(resolvePostAuthAction({ authRole: "parent", familyExists: false, pendingParentInvite: true }), "parent-pair");
  assert.equal(resolvePostAuthAction({ authRole: "parent", familyExists: false, pendingParentInvite: false }), "parent-connect");
  assert.equal(resolvePostAuthAction({ authRole: "child", familyExists: false, pendingParentInvite: false }), "child-pair");
  assert.equal(resolvePostAuthAction({ authRole: "teacher", familyExists: false, pendingParentInvite: false }), "teacher-setup");
});

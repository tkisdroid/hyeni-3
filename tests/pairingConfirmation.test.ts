import "./helpers/appModuleResolve.mjs";
import assert from "node:assert/strict";
import test from "node:test";

const { isPairingMembershipConfirmed } = await import("../src/transform/pairingConfirmation.ts");

const family = {
  familyId: "family-1",
  myRole: "parent",
  members: [
    { id: "primary", user_id: "primary-parent", role: "parent" },
    { id: "coparent", user_id: "joining-parent", role: "parent" },
    { id: "child", user_id: "joining-child", role: "child" },
  ],
};

test("보호자 연결은 세션·가족·본인 멤버십 역할이 모두 일치해야 확정된다", () => {
  assert.equal(isPairingMembershipConfirmed({
    mode: "parent",
    expectedFamilyId: "family-1",
    session: { userId: "joining-parent", role: "parent", familyId: "family-1" },
    family,
  }), true);

  for (const input of [
    { session: { userId: "joining-parent", role: "child", familyId: "family-1" }, family },
    { session: { userId: "joining-parent", role: "parent", familyId: "other-family" }, family },
    { session: { userId: "missing-parent", role: "parent", familyId: "family-1" }, family },
    { session: { userId: "joining-parent", role: "parent", familyId: "family-1" }, family: { ...family, myRole: "child" } },
    { session: { userId: "joining-parent", role: "parent", familyId: "family-1" }, family: null },
  ]) {
    assert.equal(isPairingMembershipConfirmed({
      mode: "parent",
      expectedFamilyId: "family-1",
      ...input,
    }), false);
  }
});

test("아이 연결도 같은 user_id의 child 멤버십이 부모 가족 정본에 있어야 확정된다", () => {
  assert.equal(isPairingMembershipConfirmed({
    mode: "child",
    expectedFamilyId: "family-1",
    session: { userId: "joining-child", role: "child", familyId: "family-1" },
    family: { ...family, myRole: "child" },
  }), true);
  assert.equal(isPairingMembershipConfirmed({
    mode: "child",
    expectedFamilyId: "family-1",
    session: { userId: "joining-parent", role: "child", familyId: "family-1" },
    family: { ...family, myRole: "child" },
  }), false);
});

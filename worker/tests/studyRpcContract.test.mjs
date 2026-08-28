import assert from "node:assert/strict";
import test from "node:test";

test("Study RPC 계약은 2026-08-27과 learner 역할을 고정한다", async () => {
  const contract = await import("../contracts/studyRpc.ts");

  assert.equal(contract.STUDY_API_VERSION, "2026-08-27");
  assert.deepEqual(contract.CALENDAR_STUDY_ROLES, ["guardian", "primary", "learner", "system_cleanup"]);
});

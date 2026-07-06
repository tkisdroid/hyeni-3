import assert from "node:assert/strict";

import { resolveInitialAssignedChildIds } from "../src/transform/eventAssignment";

const members = [
  { id: "parent-1", role: "parent" },
  { id: "hyeni", role: "child" },
  { id: "testi", role: "child" },
] as const;

assert.deepEqual(
  resolveInitialAssignedChildIds({
    existingChildIds: [],
    needsAssignment: true,
    activeChildId: "hyeni",
    members,
  }),
  ["hyeni"],
);

assert.deepEqual(
  resolveInitialAssignedChildIds({
    existingChildIds: [],
    needsAssignment: true,
    activeChildId: "missing",
    members: [{ id: "only-child", role: "child" }],
  }),
  ["only-child"],
);

assert.deepEqual(
  resolveInitialAssignedChildIds({
    existingChildIds: [],
    needsAssignment: true,
    activeChildId: null,
    members,
  }),
  [],
);

assert.deepEqual(
  resolveInitialAssignedChildIds({
    existingChildIds: ["already"],
    needsAssignment: true,
    activeChildId: "hyeni",
    members,
  }),
  ["already"],
);

console.log("eventAssignment contract ok");

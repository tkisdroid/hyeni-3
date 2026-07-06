export interface AssignmentMember {
  id: string;
  role: string;
}

function uniqueNonEmpty(ids: readonly string[]): string[] {
  const out = new Set<string>();
  for (const id of ids) {
    const clean = id.trim();
    if (clean) out.add(clean);
  }
  return [...out];
}

export function resolveInitialAssignedChildIds({
  existingChildIds,
  needsAssignment,
  activeChildId,
  members,
}: {
  existingChildIds: readonly string[];
  needsAssignment: boolean;
  activeChildId: string | null | undefined;
  members: readonly AssignmentMember[];
}): string[] {
  const existing = uniqueNonEmpty(existingChildIds);
  if (existing.length > 0 || !needsAssignment) return existing;

  const childIds = members.filter((m) => m.role === "child").map((m) => m.id);
  if (activeChildId && childIds.includes(activeChildId)) return [activeChildId];
  return childIds.length === 1 ? [childIds[0]] : [];
}

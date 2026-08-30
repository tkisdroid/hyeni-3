import type { UpdateStudyGradeCommand } from "./contracts";

type ChildLike = Readonly<{ id: string; role: "parent" | "child"; name?: string }>;

export type ParentStudyTarget<T extends ChildLike> =
  | Readonly<{ kind: "select" }>
  | Readonly<{ kind: "invalid"; requestedId: string }>
  | Readonly<{ kind: "ready"; child: T; fromDeepLink: boolean }>;

/** 첫 자녀 fallback 없이 저장 선택 또는 검증된 deep link만 받아들인다. */
export function resolveParentStudyTarget<T extends ChildLike>(
  children: readonly T[],
  selectedChildId: string | null,
  requestedChildId: string | null,
): ParentStudyTarget<T> {
  if (requestedChildId) {
    const requested = children.find((child) => child.role === "child" && child.id === requestedChildId);
    return requested
      ? { kind: "ready", child: requested, fromDeepLink: true }
      : { kind: "invalid", requestedId: requestedChildId };
  }
  if (!selectedChildId) return { kind: "select" };
  const selected = children.find((child) => child.role === "child" && child.id === selectedChildId);
  return selected ? { kind: "ready", child: selected, fromDeepLink: false } : { kind: "select" };
}

export function buildStudyGradeCommand(command: UpdateStudyGradeCommand): UpdateStudyGradeCommand {
  return { ...command };
}

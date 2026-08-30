export type ChildStudyEntry =
  | Readonly<{ kind: "start" | "select_grade" | "unavailable" }>
  | Readonly<{ kind: "resume"; missionId: string }>;

export const STUDY_GRADE_CHOICES = [3, 4, 5, 6] as const;

export function resolveChildStudyEntry(state: Readonly<{
  status: "available" | "inactive_or_missing";
  profile: Readonly<{ grade: Readonly<{ grade: number }> | null }>;
  activeMissionId: string | null;
}>): ChildStudyEntry {
  if (state.status !== "available") return { kind: "unavailable" };
  if (state.activeMissionId) return { kind: "resume", missionId: state.activeMissionId };
  return state.profile.grade === null ? { kind: "select_grade" } : { kind: "start" };
}

export function isRetryableStudyFailure(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (!error || typeof error !== "object") return false;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" && status >= 500;
}

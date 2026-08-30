export type ChildStudyEntry =
  | Readonly<{ kind: "start" | "unavailable" }>
  | Readonly<{ kind: "resume"; missionId: string }>;

export function resolveChildStudyEntry(state: Readonly<{
  status: "available" | "inactive_or_missing";
  activeMissionId: string | null;
}>): ChildStudyEntry {
  if (state.status !== "available") return { kind: "unavailable" };
  return state.activeMissionId
    ? { kind: "resume", missionId: state.activeMissionId }
    : { kind: "start" };
}

export function isRetryableStudyFailure(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (!error || typeof error !== "object") return false;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" && status >= 500;
}

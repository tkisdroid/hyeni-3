export type ChildStudyEntry =
  | Readonly<{ kind: "start" | "select_grade" | "unavailable" }>
  | Readonly<{ kind: "resume"; missionId: string }>;

export type ChildStudyLaunch =
  | Readonly<{ kind: "selection" }>
  | Readonly<{ kind: "resume_choice" | "mission"; missionId: string }>;

export const STUDY_GRADE_CHOICES = [3, 4, 5, 6] as const;

export type StudyTopicSelection = StudyMissionDto["selection"];

export function groupStudyConcepts(
  concepts: StudyConceptCatalogDto["concepts"],
): readonly Readonly<{
  unitKey: string;
  concepts: StudyConceptCatalogDto["concepts"];
}>[] {
  const groups = new Map<string, StudyConceptCatalogDto["concepts"][number][]>();
  for (const concept of concepts) {
    const group = groups.get(concept.unitKey);
    if (group) group.push(concept);
    else groups.set(concept.unitKey, [concept]);
  }
  return Array.from(groups, ([unitKey, groupedConcepts]) => ({
    unitKey,
    concepts: groupedConcepts,
  }));
}

export function startInputForSelection(
  grade: StudyGrade,
  selection: Pick<StudyTopicSelection, "kind"> & Partial<Pick<Extract<StudyTopicSelection, { kind: "concept" }>, "conceptId">>,
): Readonly<{ grade: StudyGrade; conceptId?: string }> {
  return selection.kind === "concept" && selection.conceptId
    ? { grade, conceptId: selection.conceptId }
    : { grade };
}

export function isSelectedGradeLoading(
  grade: StudyGrade,
  selectedGrade: StudyGrade | null,
  loading: boolean,
): boolean {
  return loading && selectedGrade === grade;
}

export function resolveChildStudyLaunch(
  entry: ChildStudyEntry,
  selectedMissionId: string | null,
): ChildStudyLaunch {
  if (selectedMissionId) return { kind: "mission", missionId: selectedMissionId };
  if (entry.kind === "resume") return { kind: "resume_choice", missionId: entry.missionId };
  return { kind: "selection" };
}

export function missionToAbandonBeforeSelection(input: Readonly<{
  localMissionId: string | null;
  activeMissionId: string | null | undefined;
  localMissionCompleted: boolean;
}>): string | null {
  if (input.localMissionId) return input.localMissionCompleted ? null : input.localMissionId;
  return input.activeMissionId ?? null;
}

export function resolveChildStudyEntry(state: Readonly<{
  status: "available" | "inactive_or_missing";
  profile: Readonly<{
    grade: Readonly<{
      grade: number;
      source: "hyeni_birth_year" | "parent_override" | "learner_selected";
    }> | null;
  }>;
  activeMissionId: string | null;
}>): ChildStudyEntry {
  if (state.status !== "available") return { kind: "unavailable" };
  if (state.activeMissionId) return { kind: "resume", missionId: state.activeMissionId };
  return state.profile.grade === null || state.profile.grade.source === "learner_selected"
    ? { kind: "select_grade" }
    : { kind: "start" };
}

export function isRetryableStudyFailure(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (!error || typeof error !== "object") return false;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" && status >= 500;
}
import type { StudyConceptCatalogDto, StudyGrade, StudyMissionDto } from "./contracts";

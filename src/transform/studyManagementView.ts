import type { FamilyMember } from "@/lib/api/endpoints/family";
import type {
  StudyChildDto,
  StudyDeviceDto,
  StudyFeatureState,
  StudyReportDto,
} from "@/lib/api/endpoints/study";

export type StudyFamilyMember = Pick<
  FamilyMember,
  "id" | "role" | "name" | "photo_url" | "child_order"
> & Readonly<{
  /** `/api/family/mine`은 활성 행만 반환한다. 명시된 false는 방어적으로 제외한다. */
  is_active?: boolean;
}>;

export type ActiveStudyChild = Readonly<{
  memberId: string;
  displayName: string;
  photoUrl: string | null;
  childOrder: number | null;
}>;

export function selectActiveStudyChildren(
  members: readonly StudyFamilyMember[],
): ActiveStudyChild[] {
  return members
    .filter((member) => member.role === "child" && member.is_active !== false)
    .map((member) => ({
      memberId: member.id,
      displayName: member.name?.trim() || "아이",
      photoUrl: member.photo_url ?? null,
      childOrder: member.child_order ?? null,
    }))
    .sort((a, b) => (a.childOrder ?? 99) - (b.childOrder ?? 99));
}

export function resolveSelectedStudyMember(
  children: readonly ActiveStudyChild[],
  requestedMemberId: string | null | undefined,
): string | null {
  const requested = String(requestedMemberId ?? "").trim();
  if (requested && children.some((child) => child.memberId === requested)) return requested;
  return children.length === 1 ? children[0].memberId : null;
}

export type StudyManagementViewState =
  | Readonly<{ kind: "loading" }>
  | Readonly<{ kind: "no-active-children" }>
  | Readonly<{ kind: "service-disabled" }>
  | Readonly<{ kind: "service-unavailable" }>
  | Readonly<{ kind: "select-child" }>
  | Readonly<{
      kind: "unlinked";
      memberId: string;
      child: StudyChildDto;
      devices: readonly StudyDeviceDto[];
      canManageLinks: boolean;
    }>
  | Readonly<{
      kind: "linked";
      child: StudyChildDto;
      report: StudyReportDto;
      devices: readonly StudyDeviceDto[];
      canManageLinks: boolean;
    }>;

export type StudyManagementViewInput = Readonly<{
  featureState: StudyFeatureState | undefined;
  activeChildren: readonly ActiveStudyChild[];
  selectedMemberId: string | null;
  studyChild: StudyChildDto | null | undefined;
  report: StudyReportDto | null | undefined;
  devices: readonly StudyDeviceDto[];
  canManageLinks: boolean;
  loading?: boolean;
  unavailable?: boolean;
}>;

export function buildStudyManagementView(
  input: StudyManagementViewInput,
): StudyManagementViewState {
  if (input.loading || input.featureState === undefined) return { kind: "loading" };
  if (input.featureState === "disabled") return { kind: "service-disabled" };
  if (input.activeChildren.length === 0) return { kind: "no-active-children" };
  if (input.unavailable || input.featureState === "unavailable") {
    return { kind: "service-unavailable" };
  }
  if (!input.selectedMemberId) return { kind: "select-child" };
  if (!input.activeChildren.some((child) => child.memberId === input.selectedMemberId)) {
    return { kind: "service-unavailable" };
  }
  if (!input.studyChild || input.studyChild.memberId !== input.selectedMemberId) {
    return { kind: "service-unavailable" };
  }
  if (!input.studyChild.linked) {
    return {
      kind: "unlinked",
      memberId: input.selectedMemberId,
      child: input.studyChild,
      devices: input.devices,
      canManageLinks: input.canManageLinks,
    };
  }
  if (!input.report || input.report.memberId !== input.selectedMemberId || !input.report.linked) {
    return { kind: "service-unavailable" };
  }
  return {
    kind: "linked",
    child: input.studyChild,
    report: input.report,
    devices: input.devices,
    canManageLinks: input.canManageLinks,
  };
}

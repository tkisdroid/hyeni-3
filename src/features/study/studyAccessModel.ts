import type { StudyStatusDto } from "./contracts";

export type StudyAccessView =
  | Readonly<{ kind: "loading" | "hidden" | "unavailable" }>
  | Readonly<{ kind: "confirm"; inferredCountry: string | null }>
  | Readonly<{ kind: "enabled"; role: "parent" | "child" }>;

export function resolveStudyAccessView(status: StudyStatusDto | null | undefined): StudyAccessView {
  if (!status) return { kind: "loading" };
  if (status.state === "enabled") {
    const roleEnabled = status.role === "parent" ? status.managementEnabled : status.learnerEnabled;
    return roleEnabled ? { kind: "enabled", role: status.role } : { kind: "hidden" };
  }
  if (status.state === "not_confirmed" && status.canConfirm) {
    return { kind: "confirm", inferredCountry: status.inferredCountry };
  }
  if (status.state === "unavailable") return { kind: "unavailable" };
  return { kind: "hidden" };
}

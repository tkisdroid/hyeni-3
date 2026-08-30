import type { StudyStatusDto } from "@/features/study/contracts";
import { apiGet } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";

function invalidStatus(): never {
  throw new ApiError("invalid_study_response", 502);
}

function statusObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalidStatus();
  return value as Record<string, unknown>;
}

function exactStatus(record: Record<string, unknown>, required: readonly string[]): void {
  const allowed = new Set(required);
  if (Object.keys(record).some((key) => !allowed.has(key))) invalidStatus();
  if (required.some((key) => !Object.prototype.hasOwnProperty.call(record, key))) invalidStatus();
}

function statusBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") invalidStatus();
  return value;
}

export function parseStudyStatus(value: unknown): StudyStatusDto {
  const record = statusObject(value);
  if (record.state === "enabled") {
    exactStatus(record, ["state", "market", "role", "managementEnabled", "learnerEnabled"]);
    if (record.market !== "KR" || (record.role !== "parent" && record.role !== "child")) invalidStatus();
    return {
      state: "enabled",
      market: "KR",
      role: record.role,
      managementEnabled: statusBoolean(record.managementEnabled),
      learnerEnabled: statusBoolean(record.learnerEnabled),
    };
  }
  if (record.state === "not_confirmed") {
    exactStatus(record, ["state", "inferredCountry", "canConfirm"]);
    if (record.inferredCountry !== null && (
      typeof record.inferredCountry !== "string"
      || !/^[A-Za-z]{2}$/u.test(record.inferredCountry)
    )) invalidStatus();
    return {
      state: "not_confirmed",
      inferredCountry: record.inferredCountry === null ? null : record.inferredCountry,
      canConfirm: statusBoolean(record.canConfirm),
    };
  }
  if (["outside_market", "feature_disabled", "unavailable", "no_family"].includes(String(record.state))) {
    exactStatus(record, ["state"]);
    return { state: record.state as "outside_market" | "feature_disabled" | "unavailable" | "no_family" };
  }
  invalidStatus();
}

export async function fetchStudyStatus(): Promise<StudyStatusDto> {
  return parseStudyStatus(await apiGet<unknown>("/api/study/status"));
}

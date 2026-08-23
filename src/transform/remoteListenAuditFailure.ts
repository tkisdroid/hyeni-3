import { isApiError } from "@/lib/api/errors";

export interface RemoteListenAuditFailure {
  errorCode: string | null;
  status: number | null;
}

export type RemoteListenAuditFailureState =
  | "primaryOnly"
  | "premiumOnly"
  | "disabled"
  | "auditUnavailable";

export function describeRemoteListenAuditFailure(error: unknown): RemoteListenAuditFailure {
  if (!isApiError(error)) return { errorCode: null, status: null };
  return { errorCode: error.code, status: error.status };
}

export function resolveRemoteListenAuditFailureState(
  failure: RemoteListenAuditFailure,
): RemoteListenAuditFailureState {
  if (failure.errorCode === "primary_parent_required") return "primaryOnly";
  if (failure.errorCode === "remote_listen_requires_premium" || failure.status === 402) return "premiumOnly";
  if (failure.errorCode === "remote_listen_disabled_by_family") return "disabled";
  return "auditUnavailable";
}

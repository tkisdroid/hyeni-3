type VersionMetadataLike = Pick<WorkerVersionMetadata, "id"> | null | undefined;

export type RequestStatusClass = "1xx" | "2xx" | "3xx" | "4xx" | "5xx" | "other";
export type CronHeartbeatStatus = "success" | "failure";

const VERSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const CRON_PATTERN = /^[A-Za-z0-9*/?, -]{1,128}$/;
const HANDLER_PATTERN = /^[a-z0-9-]{1,96}$/;

function normalizeVersionId(metadata: VersionMetadataLike): string {
  const id = metadata?.id;
  return typeof id === "string" && VERSION_ID_PATTERN.test(id) ? id : "unavailable";
}

function normalizeCron(cron: string): string {
  return CRON_PATTERN.test(cron) ? cron : "unavailable";
}

function normalizeHandler(handler: string): string {
  return HANDLER_PATTERN.test(handler) ? handler : "unavailable";
}

export function resolveStatusClass(status: number): RequestStatusClass {
  if (!Number.isInteger(status) || status < 100 || status > 599) return "other";
  return `${Math.floor(status / 100)}xx` as RequestStatusClass;
}

export function buildRequestOutcomeLog(metadata: VersionMetadataLike, status: number) {
  return {
    event: "hyeni_request_outcome_v1" as const,
    versionId: normalizeVersionId(metadata),
    statusClass: resolveStatusClass(status),
  };
}

export function logRequestOutcome(metadata: VersionMetadataLike, status: number): void {
  console.log(buildRequestOutcomeLog(metadata, status));
}

export function buildCronHeartbeatLog(
  metadata: VersionMetadataLike,
  cron: string,
  handler: string,
  status: CronHeartbeatStatus,
) {
  return {
    event: "hyeni_cron_heartbeat_v1" as const,
    versionId: normalizeVersionId(metadata),
    cron: normalizeCron(cron),
    handler: normalizeHandler(handler),
    status,
  };
}

export function logCronHeartbeat(
  metadata: VersionMetadataLike,
  cron: string,
  handler: string,
  status: CronHeartbeatStatus,
): void {
  const marker = buildCronHeartbeatLog(metadata, cron, handler, status);
  if (status === "failure") {
    console.error(marker);
    return;
  }
  console.log(marker);
}

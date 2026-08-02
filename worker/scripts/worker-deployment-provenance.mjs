const CLOUDFLARE_API_PREFIX = "https://api.cloudflare.com/client/v4/accounts";

export const WORKER_SERVICE = "hyeni-calendar-api";
export const WORKER_VERSION_ID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function parseUuid(value, errorCode) {
  if (typeof value !== "string" || !WORKER_VERSION_ID_PATTERN.test(value)) {
    throw new Error(errorCode);
  }
  return value.toLowerCase();
}

export function parseWorkerVersionId(value) {
  return parseUuid(value, "worker_version_id_invalid");
}

export function parseWorkerDeploymentId(value) {
  return parseUuid(value, "worker_deployment_id_invalid");
}

export function parseDeploymentTimestamp(value) {
  if (typeof value !== "string") throw new Error("worker_deployment_created_at_invalid");
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error("worker_deployment_created_at_invalid");
  }
  return parsed.toISOString();
}

export function parseActiveDeploymentResponse(payload) {
  const deployments = payload?.result?.deployments;
  if (payload?.success !== true || !Array.isArray(deployments) || deployments.length === 0) {
    throw new Error("worker_deployment_response_invalid");
  }

  // Cloudflare 계약상 첫 항목이 현재 트래픽을 처리하는 최신 deployment다.
  const deployment = deployments[0];
  if (
    deployment?.strategy !== "percentage"
    || !Array.isArray(deployment.versions)
    || deployment.versions.length !== 1
    || deployment.versions[0]?.percentage !== 100
  ) {
    throw new Error("worker_deployment_not_single_version");
  }

  return {
    workerDeploymentId: parseWorkerDeploymentId(deployment.id),
    workerDeploymentCreatedAt: parseDeploymentTimestamp(deployment.created_on),
    workerVersionId: parseWorkerVersionId(deployment.versions[0].version_id),
  };
}

export async function verifyActiveWorkerDeployment({
  accountId,
  apiToken,
  expectedVersionId,
  observedAtMs,
  nowMs = Date.now(),
  fetchImpl = globalThis.fetch,
}) {
  if (typeof accountId !== "string" || !/^[a-f0-9]{32}$/i.test(accountId)) {
    throw new Error("cloudflare_account_id_invalid");
  }
  if (typeof apiToken !== "string" || apiToken.trim().length === 0) {
    throw new Error("cloudflare_api_token_missing");
  }
  if (typeof fetchImpl !== "function") throw new Error("fetch_unavailable");
  if (!Number.isSafeInteger(observedAtMs) || observedAtMs <= 0) {
    throw new Error("worker_deployment_observed_at_invalid");
  }
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0) {
    throw new Error("worker_deployment_verification_clock_invalid");
  }
  if (observedAtMs > nowMs) {
    throw new Error("worker_deployment_observation_in_future");
  }
  const normalizedExpectedVersionId = parseWorkerVersionId(expectedVersionId);

  let response;
  try {
    response = await fetchImpl(
      `${CLOUDFLARE_API_PREFIX}/${accountId}/workers/scripts/${WORKER_SERVICE}/deployments`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${apiToken}` },
      },
    );
  } catch {
    throw new Error("worker_deployment_query_network_failed");
  }
  if (!response.ok) throw new Error(`worker_deployment_query_http_${response.status}`);

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("worker_deployment_response_invalid");
  }
  const provenance = parseActiveDeploymentResponse(payload);
  if (provenance.workerVersionId !== normalizedExpectedVersionId) {
    throw new Error("worker_deployment_version_mismatch");
  }
  if (Date.parse(provenance.workerDeploymentCreatedAt) > observedAtMs) {
    throw new Error("worker_deployment_after_observation");
  }

  return {
    workerService: WORKER_SERVICE,
    ...provenance,
    deploymentVerifiedAt: new Date(nowMs).toISOString(),
  };
}

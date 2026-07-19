export interface AppVersionPolicy {
  minimumSupportedVersion: string;
  latestVersion: string;
}

export type AppUpdateDecision =
  | { kind: "forced"; targetVersion: string }
  | { kind: "optional"; targetVersion: string };

function parseVersion(value: string): number[] | null {
  if (!/^\d+(?:\.\d+){0,3}$/.test(value)) return null;
  const parts = value.split(".").map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part))) return null;
  return parts;
}

/** 표시 문자열이 아닌 숫자 구성요소 기준으로 앱 버전을 비교한다. */
export function compareAppVersions(left: string, right: string): -1 | 0 | 1 {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  if (!leftParts || !rightParts) throw new Error("invalid_app_version");
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;
    if (leftPart < rightPart) return -1;
    if (leftPart > rightPart) return 1;
  }
  return 0;
}

/** 정책이 모순되거나 파싱되지 않으면 화면을 잠그지 않고 안전하게 무시한다. */
export function resolveAppUpdateDecision(
  currentVersion: string,
  policy: AppVersionPolicy,
): AppUpdateDecision | null {
  try {
    if (compareAppVersions(policy.minimumSupportedVersion, policy.latestVersion) > 0) return null;
    if (compareAppVersions(currentVersion, policy.minimumSupportedVersion) < 0) {
      return { kind: "forced", targetVersion: policy.latestVersion };
    }
    if (compareAppVersions(currentVersion, policy.latestVersion) < 0) {
      return { kind: "optional", targetVersion: policy.latestVersion };
    }
    return null;
  } catch {
    return null;
  }
}

export function forcedUpdateHash(targetVersion: string): string {
  return `#/app-update?forced=1&target=${encodeURIComponent(targetVersion)}`;
}

export function shouldEnforceForcedUpdate(currentHash: string, targetVersion: string): boolean {
  return currentHash !== forcedUpdateHash(targetVersion);
}

/** 서버 정책이 완화되면 캐시에 의해 남아 있던 강제 업데이트 화면을 해제한다. */
export function shouldReleaseForcedUpdate(
  currentHash: string,
  nextDecision: AppUpdateDecision | null,
): boolean {
  return currentHash.startsWith("#/app-update?forced=1")
    && nextDecision?.kind !== "forced";
}

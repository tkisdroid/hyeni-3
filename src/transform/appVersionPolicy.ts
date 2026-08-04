export interface AppVersionPolicy {
  minimumSupportedVersion: string;
  latestVersion: string;
  /**
   * 구버전 사용을 실제로 차단할지 여부. 기본은 차단하지 않는다(2026-08-04 보호자 결정).
   *
   * 업데이트가 나왔다는 이유만으로 앱을 잠그면 사용자가 그 순간 아무것도 못 한다.
   * 위치·SOS 같은 안전 기능이 걸린 앱에서 그건 업데이트보다 큰 손해다. 그래서
   * `minimumSupportedVersion` 미만이어도 기본은 안내만 하고 계속 쓸 수 있게 둔다.
   *
   * 서버 계약이 깨져 구버전이 오작동하는 경우처럼 정말 막아야 할 때만 운영자가
   * 이 값을 `true`로 올려 잠근다. 즉 차단은 버전 숫자가 아니라 명시적 의사결정이다.
   */
  blockingUpdate?: boolean;
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
    // 차단은 운영자가 blockingUpdate로 명시할 때만 한다 — 버전이 낮다는 이유만으로 잠그지 않는다.
    if (
      policy.blockingUpdate === true
      && compareAppVersions(currentVersion, policy.minimumSupportedVersion) < 0
    ) {
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

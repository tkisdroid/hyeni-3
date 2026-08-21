export interface PwaNavigationResponseInput {
  request: Request;
  fetchNetwork: (request: Request) => Promise<Response>;
  matchOfflineShell: () => Promise<Response | undefined>;
}

/** 온라인 앱 문서는 설치 시점의 precache보다 현재 배포 응답을 우선한다. */
export function resolvePwaNavigationResponse({
  request,
  fetchNetwork,
  matchOfflineShell,
}: PwaNavigationResponseInput): Promise<Response> {
  return fetchNetwork(request).catch(async (networkError: unknown) => {
    const offlineShell = await matchOfflineShell().catch(() => undefined);
    if (!offlineShell) throw networkError;
    return offlineShell;
  });
}

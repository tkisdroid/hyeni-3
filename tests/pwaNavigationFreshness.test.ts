import "./helpers/appModuleResolve.mjs";

import test from "node:test";
import assert from "node:assert/strict";

type NavigationFreshnessModule = {
  resolvePwaNavigationResponse(input: {
    request: Request;
    fetchNetwork: (request: Request) => Promise<Response>;
    matchOfflineShell: () => Promise<Response | undefined>;
  }): Promise<Response>;
};

const navigationFreshness = await import("../src/transform/pwaNavigationFreshness.ts")
  .catch(() => null) as NavigationFreshnessModule | null;

test("온라인 탐색은 설치 때 저장한 셸보다 현재 네트워크 문서를 우선한다", async () => {
  assert.ok(navigationFreshness, "PWA 탐색 응답의 네트워크 우선 정책이 필요합니다");
  const request = new Request("https://hyenicalendar.com/#/parent/home");
  const currentDocument = new Response("current-index", { status: 200 });
  let offlineShellReads = 0;

  const response = await navigationFreshness.resolvePwaNavigationResponse({
    request,
    fetchNetwork: async () => currentDocument,
    matchOfflineShell: async () => {
      offlineShellReads += 1;
      return new Response("stale-index", { status: 200 });
    },
  });

  assert.equal(await response.text(), "current-index");
  assert.equal(offlineShellReads, 0);
});

test("오프라인 탐색은 설치된 현재 셸로 정직하게 강등한다", async () => {
  assert.ok(navigationFreshness, "PWA 탐색 응답의 네트워크 우선 정책이 필요합니다");
  const request = new Request("https://hyenicalendar.com/#/parent/home");

  const response = await navigationFreshness.resolvePwaNavigationResponse({
    request,
    fetchNetwork: async () => {
      throw new TypeError("Failed to fetch");
    },
    matchOfflineShell: async () => new Response("offline-index", { status: 200 }),
  });

  assert.equal(await response.text(), "offline-index");
});

test("네트워크와 오프라인 셸이 모두 없으면 원래 탐색 실패를 숨기지 않는다", async () => {
  assert.ok(navigationFreshness, "PWA 탐색 응답의 네트워크 우선 정책이 필요합니다");
  const request = new Request("https://hyenicalendar.com/#/parent/home");
  const networkError = new TypeError("Failed to fetch");

  await assert.rejects(
    navigationFreshness.resolvePwaNavigationResponse({
      request,
      fetchNetwork: async () => {
        throw networkError;
      },
      matchOfflineShell: async () => undefined,
    }),
    (error) => error === networkError,
  );
});

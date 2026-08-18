/**
 * 화면 첫 진입에서 "화면을 불러오는 중"이 번쩍이지 않도록 하는 계약
 * (2026-08-18 TK 제보 "대화·설정 화면에서 한 번씩 리프레시된다").
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  preloadRoute,
  preloadRoutes,
  registerRoutePreload,
  registeredPreloadRoutes,
} from "../src/app/routePreload.ts";
import { canReloadForPwaUpdateNow } from "../src/lib/pwaReloadTiming.ts";

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const app = read("src/app/App.tsx");
const tabBar = read("src/app/TabBar.tsx");
const dock = read("src/app/ChildDock.tsx");
const main = read("src/main.tsx");
const lazyScreen = read("src/app/lazyScreen.tsx");

test("등록된 경로만 미리 받고, 없는 경로는 조용히 넘어간다", () => {
  let calls = 0;
  registerRoutePreload("/test/route", async () => { calls += 1; });
  preloadRoute("/test/route");
  preloadRoute("/test/missing");
  assert.equal(calls, 1);
  preloadRoutes(["/test/route", "/test/route"]);
  assert.equal(calls, 3);
  assert.ok(registeredPreloadRoutes().includes("/test/route"));
});

test("화면 청크는 한 번만 받고 실패하면 다음 시도에 다시 받는다", () => {
  // 실패한 약속을 남겨 두면 실제 이동에서도 영영 실패한다.
  assert.match(lazyScreen, /started = null;\s*\n\s*throw error;/);
  assert.match(lazyScreen, /if \(!started\)/);
  assert.match(lazyScreen, /screen\.preload = \(\) => load\(\)\.then\(\(\) => undefined, \(\) => undefined\)/);
});

test("탭·독 목적지는 전부 preload 로 등록돼 있다", () => {
  const registered = new Set(
    [...app.matchAll(/\["(\/[a-z/-]+)",\s*[A-Za-z]+\]/g)].map((match) => match[1]),
  );
  const tabPaths = [...tabBar.matchAll(/to: "(\/[a-z/-]+)"/g)].map((match) => match[1]);
  const shellPaths = [...read("src/app/AppShell.tsx").matchAll(/\{ to: "(\/[a-z/-]+)"/g)].map((match) => match[1]);
  const dockPaths = [...dock.matchAll(/to: "(\/[a-z/-]+)"/g)].map((match) => match[1]);
  for (const path of [...tabPaths, ...shellPaths, ...dockPaths, "/child/sos"]) {
    assert.ok(registered.has(path), `${path} preload 등록 누락`);
  }
  // 등록한 경로는 라우터에도 실제로 있어야 한다(경로 오타 방지).
  for (const path of registered) {
    const routePath = path.replace(/^\//, "");
    assert.ok(app.includes(`path: "${routePath}"`), `${path} 라우터 경로 없음`);
  }
});

test("탭·독은 한가할 때 미리 받고 누르는 순간에도 다시 확인한다", () => {
  assert.match(tabBar, /preloadRoutesWhenIdle\(/);
  assert.match(tabBar, /onPointerDown=\{\(\) => preloadRoute\(t\.to\)\}/);
  assert.match(dock, /preloadRoutesWhenIdle\(\[\.\.\.TABS\.map\(\(tab\) => tab\.to\), "\/child\/sos"\]\)/);
  assert.match(dock, /onPointerDown=\{\(\) => preloadRoute\(tab\.to\)\}/);
  assert.match(dock, /onPointerDown=\{\(\) => preloadRoute\("\/child\/sos"\)\}/);
});

test("문구를 받는 동안에도 빈 화면 대신 불러오는 중 표시를 남긴다", () => {
  const boundary = read("src/i18n/LocaleBoundary.tsx");
  assert.match(boundary, /return ready \? children : <RouteLoading \/>;/);
  assert.doesNotMatch(boundary, /return ready \? children : null/);
});

test("네이티브 앱은 사용자가 보고 있는 화면을 스스로 새로고침하지 않는다", () => {
  assert.equal(canReloadForPwaUpdateNow({ native: true, visibility: "visible" }), false);
  assert.equal(canReloadForPwaUpdateNow({ native: true, visibility: "hidden" }), true);
  // 웹·PWA 는 기존대로 즉시 적용한다(브라우저 탭에서는 새로고침이 자연스럽다).
  assert.equal(canReloadForPwaUpdateNow({ native: false, visibility: "visible" }), true);
  assert.equal(canReloadForPwaUpdateNow({ native: false, visibility: "hidden" }), true);
});

test("오래 열어 둔 브라우저 탭도 새 버전을 주기적으로 확인한다", () => {
  // 확인을 안 하면 며칠 열어 둔 탭이 옛 번들에 머물러 새 기능이 없는 화면을 보게 된다.
  assert.match(main, /onRegisteredSW: \(_url, registration\) =>/);
  assert.match(main, /setInterval\(check, PWA_UPDATE_CHECK_INTERVAL_MS\)/);
  assert.match(main, /PWA_UPDATE_CHECK_INTERVAL_MS = 30 \* 60_000/);
  assert.match(main, /registration\.update\(\)/);
});

test("미뤄 둔 새로고침은 앱이 백그라운드로 갈 때 다시 시도한다", () => {
  assert.match(main, /queuePwaUpdateAction\("reload", reloadForPwaUpdate\)/);
  assert.match(main, /canReloadForPwaUpdateNow\(\{\s*native: isNativePlatform\(\),\s*visibility: document\.visibilityState,\s*\}\)/);
  assert.match(main, /throw new Error\("앱 사용 중 — 백그라운드에서 적용"\)/);
  // visible 로 돌아올 때만 재시도하면 미뤄 둔 새로고침이 사용 중에만 실행된다.
  assert.match(main, /document\.addEventListener\("visibilitychange", retryPendingPwaUpdate\)/);
});

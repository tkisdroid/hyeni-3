import "./helpers/appModuleResolve.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const {
  STALE_CHUNK_RELOAD_COOLDOWN_MS,
  isStaleChunkError,
  shouldReloadForStaleChunk,
} = await import("../src/lib/staleChunkRecovery.ts");

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("브라우저별 옛 청크 실패 문구만 옛 청크로 판정한다", () => {
  for (const message of [
    "Failed to fetch dynamically imported module: https://hyenicalendar.com/assets/ParentStudy-OLD.js",
    "Importing a module script failed.",
    "error loading dynamically imported module: https://hyenicalendar.com/assets/ParentStudy-OLD.js",
    "'text/html' is not a valid JavaScript MIME type for module script 'https://hyenicalendar.com/assets/ParentStudy-OLD.js'.",
    "Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of \"text/html\".",
    "Unable to preload CSS for /assets/study-learning-OLD.css",
  ]) {
    assert.equal(isStaleChunkError(new TypeError(message)), true, message);
  }
  assert.equal(isStaleChunkError(new TypeError("Cannot read properties of undefined (reading 'id')")), false);
  assert.equal(isStaleChunkError(null), false);
  assert.equal(isStaleChunkError({ message: "Importing a module script failed." }), false);
});

test("온라인이고 최근에 복구하지 않았을 때만 한 번 새로고침한다", () => {
  const error = new TypeError("Importing a module script failed.");
  const now = 1_000_000;
  assert.equal(shouldReloadForStaleChunk({ error, online: true, lastReloadAt: null, now }), true);
  assert.equal(shouldReloadForStaleChunk({ error, online: true, lastReloadAt: now - STALE_CHUNK_RELOAD_COOLDOWN_MS, now }), true);
  // 방금 새로고침했는데 또 실패하면 반복하지 않고 오류 화면에 맡긴다.
  assert.equal(shouldReloadForStaleChunk({ error, online: true, lastReloadAt: now - 5_000, now }), false);
  // 오프라인 새로고침은 브라우저 오류 페이지로 빠질 수 있다.
  assert.equal(shouldReloadForStaleChunk({ error, online: false, lastReloadAt: null, now }), false);
  // 저장소를 못 쓰면 반복을 막을 수 없으니 새로고침하지 않는다.
  assert.equal(shouldReloadForStaleChunk({ error, online: true, lastReloadAt: undefined, now }), false);
  assert.equal(shouldReloadForStaleChunk({ error: new Error("render bug"), online: true, lastReloadAt: null, now }), false);
});

test("화면 이동과 라우트 오류 화면은 옛 청크를 복구하고, 미리 받기는 새로고침하지 않는다", () => {
  const lazyScreen = read("src/app/lazyScreen.tsx");
  assert.match(lazyScreen, /if \(reloadForStaleChunk\(error\)\) return new Promise<never>\(\(\) => undefined\);/);
  assert.match(lazyScreen, /screen\.preload = \(\) => load\(\)\.then\(\(\) => undefined, \(\) => undefined\)/);

  const boundary = read("src/app/ErrorBoundary.tsx");
  assert.match(boundary, /useState\(\(\) => isStaleChunkError\(error\)\)/);
  assert.match(boundary, /if \(reloadForStaleChunk\(error\)\) return;/);
  assert.match(boundary, /return reloading \? <RouteLoading \/> : <ErrorFallback \/>;/);
});

const { isUsableAssetResponse } = await import("../src/transform/pwaAssetResponse.ts");
const { purgeMismatchedAssetCacheEntries } = await import("../src/lib/staleChunkRecovery.ts");

test("SW 캐시는 JS·CSS 이름에 맞는 MIME 응답만 저장·사용한다", () => {
  assert.equal(isUsableAssetResponse("/assets/ParentStudy-a1.js", 200, "text/javascript"), true);
  assert.equal(isUsableAssetResponse("/assets/ParentStudy-a1.js", 200, "application/javascript; charset=utf-8"), true);
  // Pages SPA 폴백(index.html)이 JS 이름으로 들어가면 새로고침해도 그 화면이 계속 열리지 않는다.
  assert.equal(isUsableAssetResponse("/assets/ParentStudy-a1.js", 200, "text/html; charset=utf-8"), false);
  assert.equal(isUsableAssetResponse("/assets/study-learning-a1.css", 200, "text/html"), false);
  assert.equal(isUsableAssetResponse("/assets/study-learning-a1.css", 200, "text/css"), true);
  assert.equal(isUsableAssetResponse("/assets/ParentStudy-a1.js", 404, "text/javascript"), false);
  assert.equal(isUsableAssetResponse("/index.html", 200, "text/html"), true);
  assert.equal(isUsableAssetResponse("/assets/mascot/diary.webp", 200, "image/webp"), true);
});

test("새로고침 전 캐시 정리는 형식이 맞지 않는 JS·CSS 항목만 지운다", async () => {
  const entries = new Map([
    ["https://hyenicalendar.com/assets/ParentStudy-a1.js", { status: 200, type: "text/html; charset=utf-8" }],
    ["https://hyenicalendar.com/assets/ParentHome-b2.js", { status: 200, type: "text/javascript" }],
    ["https://hyenicalendar.com/assets/study-c3.css", { status: 200, type: "text/html" }],
    ["https://hyenicalendar.com/index.html?__WB_REVISION__=1", { status: 200, type: "text/html" }],
  ]);
  const cache = {
    keys: async () => [...entries.keys()].map((url) => ({ url })),
    match: async (request) => {
      const entry = entries.get(request.url);
      return entry && { status: entry.status, headers: { get: () => entry.type } };
    },
    delete: async (request) => entries.delete(request.url),
  };
  const storage = { keys: async () => ["workbox-precache-v2"], open: async () => cache };
  assert.equal(await purgeMismatchedAssetCacheEntries(storage), 2);
  assert.deepEqual([...entries.keys()], [
    "https://hyenicalendar.com/assets/ParentHome-b2.js",
    "https://hyenicalendar.com/index.html?__WB_REVISION__=1",
  ]);
});

test("Service Worker precache와 런타임 스크립트 캐시가 같은 응답 검사를 거친다", () => {
  const sw = read("src/sw.ts");
  assert.match(sw, /cacheWillUpdate: async \(\{ request, response \}\) => \(usableAsset\(request, response\) \? response : null\)/);
  assert.match(sw, /cachedResponseWillBeUsed: async \(\{ request, cachedResponse \}\) => \(\s*cachedResponse && usableAsset\(request, cachedResponse\) \? cachedResponse : null/);
  assert.match(sw, /addPlugins\(\[assetResponseGuard\]\);\nprecacheAndRoute\(self\.__WB_MANIFEST\);/);
  assert.match(sw, /plugins: \[assetResponseGuard, new ExpirationPlugin\(/);
  const recovery = read("src/lib/staleChunkRecovery.ts");
  assert.match(recovery, /purgeMismatchedAssetCacheEntries\(storage\)/);
  assert.match(recovery, /window\.setTimeout\(reload, CACHE_PURGE_TIMEOUT_MS\)/);
});

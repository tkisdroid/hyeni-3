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

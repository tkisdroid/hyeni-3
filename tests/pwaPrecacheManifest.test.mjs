import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { inspectPwaPrecacheManifest } from "../scripts/lib/pwaPrecacheManifest.mjs";

function withServiceWorker(source, run) {
  const dir = mkdtempSync(join(tmpdir(), "hyeni-pwa-precache-"));
  try {
    writeFileSync(join(dir, "sw.js"), source, "utf8");
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("PWA precache 검증은 고유 URL 목록을 통과시킨다", () => {
  withServiceWorker(
    'precache([{"revision":"a","url":"index.html"},{"revision":null,"url":"assets/app-123.js"}]);',
    (distDir) => {
      assert.deepEqual(inspectPwaPrecacheManifest({ distDir }), {
        swFile: "sw.js",
        entries: 2,
      });
    },
  );
});

test("PWA precache 검증은 revision이 달라도 같은 URL이면 빌드를 막는다", () => {
  withServiceWorker(
    'precache([{"revision":null,"url":"pwa-192x192.png"},{"revision":"abc","url":"pwa-192x192.png"}]);',
    (distDir) => {
      assert.throws(
        () => inspectPwaPrecacheManifest({ distDir }),
        /pwa-192x192\.png \(2회\)/,
      );
    },
  );
});

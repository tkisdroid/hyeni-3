import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { inspectPwaPrecacheManifest, inspectPwaPrecacheBudget } from "../scripts/lib/pwaPrecacheManifest.mjs";

function withServiceWorker(source, run) {
  const dir = mkdtempSync(join(tmpdir(), "hyeni-pwa-precache-"));
  try {
    writeFileSync(join(dir, "sw.js"), source, "utf8");
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("PWA 전체 캐시 예산은 실제 파일 크기로 경계 초과를 막는다", () => {
  withServiceWorker('precache([{"revision":null,"url":"index.html"}]);', (distDir) => {
    writeFileSync(join(distDir, 'index.html'), '12345');
    assert.equal(inspectPwaPrecacheBudget({ distDir, limitBytes: 6 }).bytes, 5);
    assert.throws(() => inspectPwaPrecacheBudget({ distDir, limitBytes: 5 }), /예산/);
  });
});

test("PWA precache 검증은 고유 URL 목록을 통과시킨다", () => {
  withServiceWorker(
    'precache([{"revision":null,"url":"assets/app-123.js"},{"revision":"a","url":"index.html"}]);',
    (distDir) => {
      assert.deepEqual(inspectPwaPrecacheManifest({ distDir }), {
        swFile: "sw.js",
        entries: 2,
      });
    },
  );
});

test("PWA precache 검증은 OS별로 달라질 수 있는 URL 순서를 빌드에서 차단한다", () => {
  withServiceWorker(
    'precache([{"revision":null,"url":"assets/webBilling.js"},{"revision":null,"url":"assets/WeeklyFamilyReport.js"}]);',
    (distDir) => {
      assert.throws(
        () => inspectPwaPrecacheManifest({ distDir }),
        /URL 순서가 결정적이지 않습니다/,
      );
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

import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  inspectRouteEntryBundle,
  inspectRouteEntryStyles,
} from "../scripts/lib/routeBundleBudget.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function withDistFixture(run) {
  const distDir = mkdtempSync(join(tmpdir(), "hyeni-route-bundle-"));
  try {
    return run(distDir);
  } finally {
    rmSync(distDir, { recursive: true, force: true });
  }
}

function writeBundle(distDir, bytes) {
  mkdirSync(join(distDir, "assets"));
  writeFileSync(
    join(distDir, "index.html"),
    '<script type="module" crossorigin src="./assets/index-fixture.js"></script>',
  );
  writeFileSync(join(distDir, "assets", "index-fixture.js"), Buffer.alloc(bytes, 1));
}

test("production HTML이 가리키는 실제 module entry 크기를 검사한다", () => withDistFixture((distDir) => {
  writeBundle(distDir, 499_999);
  assert.deepEqual(inspectRouteEntryBundle({ distDir, limitBytes: 500_000 }), {
    entryFile: "assets/index-fixture.js",
    bytes: 499_999,
    limitBytes: 500_000,
  });
}));

test("entry가 500KB 경계 이상이면 실패한다", () => withDistFixture((distDir) => {
  writeBundle(distDir, 500_000);
  assert.throws(
    () => inspectRouteEntryBundle({ distDir, limitBytes: 500_000 }),
    /500000.*미만/,
  );
}));

test("production HTML의 초기 stylesheet는 40KB 미만이어야 한다", () => withDistFixture((distDir) => {
  mkdirSync(join(distDir, "assets"));
  writeFileSync(
    join(distDir, "index.html"),
    '<link rel="stylesheet" href="./assets/index-fixture.css">',
  );
  writeFileSync(join(distDir, "assets", "index-fixture.css"), Buffer.alloc(39_999, 1));
  assert.deepEqual(inspectRouteEntryStyles({ distDir, limitBytes: 40_000 }), {
    entryFile: "assets/index-fixture.css",
    bytes: 39_999,
    limitBytes: 40_000,
  });
}));

test("초기 stylesheet가 40KB 경계 이상이면 실패한다", () => withDistFixture((distDir) => {
  mkdirSync(join(distDir, "assets"));
  writeFileSync(
    join(distDir, "index.html"),
    '<link rel="stylesheet" href="./assets/index-fixture.css">',
  );
  writeFileSync(join(distDir, "assets", "index-fixture.css"), Buffer.alloc(40_000, 1));
  assert.throws(
    () => inspectRouteEntryStyles({ distDir, limitBytes: 40_000 }),
    /40000.*미만/,
  );
}));

test("build 산출물이나 단일 module entry가 없으면 명시적으로 실패한다", () => withDistFixture((distDir) => {
  assert.throws(() => inspectRouteEntryBundle({ distDir }), /npm run build/);

  writeFileSync(join(distDir, "index.html"), "<main>entry 없음</main>");
  assert.throws(() => inspectRouteEntryBundle({ distDir }), /module entry/);

  writeFileSync(
    join(distDir, "index.html"),
    '<script type="module" src="./assets/a.js"></script><script type="module" src="./assets/b.js"></script>',
  );
  assert.throws(() => inspectRouteEntryBundle({ distDir }), /정확히 1개/);
}));

test("npm run build는 Vite 산출 직후 실제 번들 예산 검사를 실행한다", () => {
  const packageJson = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
  assert.equal(
    packageJson.scripts.build,
    "tsc -b && vite build && node scripts/verify-route-bundle.mjs",
  );
  assert.equal(packageJson.scripts["verify:route-bundle"], "node scripts/verify-route-bundle.mjs");
});

test("defaultIntl의 한국어 fallback catalog 6개만 안정 청크로 분리한다", () => {
  const viteConfig = readFileSync(join(rootDir, "vite.config.ts"), "utf8");
  const fallbackChunk = viteConfig.match(/"i18n-ko-fallback"\s*:\s*\[([\s\S]*?)\]/)?.[1];

  assert.ok(fallbackChunk, "i18n-ko-fallback 청크가 필요합니다.");
  const catalogFiles = [...fallbackChunk.matchAll(
    /\.\/src\/i18n\/generated\/catalogs\/ko\/([^"']+)\.ts/g,
  )].map((match) => match[1]).sort();
  assert.deepEqual(catalogFiles, [
    "child",
    "core",
    "notifications",
    "parent",
    "reports",
    "shared",
  ]);
});

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  inspectRouteEntryBundle,
  inspectRouteEntryStyles,
} from "../scripts/lib/routeBundleBudget.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const provenanceModulePath = resolve(rootDir, "scripts/lib/initialChunkProvenance.mjs");
const provenanceFile = "initial-chunk-provenance.json";

function withDistFixture(run) {
  const distDir = mkdtempSync(join(tmpdir(), "hyeni-route-bundle-"));
  try {
    return run(distDir);
  } finally {
    rmSync(distDir, { recursive: true, force: true });
  }
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function writeProvenance(distDir, chunks) {
  writeFileSync(
    join(distDir, provenanceFile),
    `${JSON.stringify({ schemaVersion: 1, chunks }, null, 2)}\n`,
  );
}

function provenanceRecord(distDir, file, modules, classification) {
  const content = readFileSync(join(distDir, file));
  return {
    file,
    bytes: content.byteLength,
    sha256: sha256(content),
    modules: [...modules].sort(),
    classification,
    reason: classification === "third-party-runtime"
      ? "허용된 React·React Intl runtime source만 포함합니다."
      : "first-party 모듈이 포함되어 자체 JS 예산에 합산합니다.",
  };
}

function writeBundle(distDir, bytes, preloads = []) {
  mkdirSync(join(distDir, "assets"));
  writeFileSync(
    join(distDir, "index.html"),
    [
      '<script type="module" crossorigin src="./assets/index-fixture.js"></script>',
      ...preloads.map(({ file }) => `<link rel="modulepreload" href="./assets/${file}">`),
    ].join(""),
  );
  writeFileSync(join(distDir, "assets", "index-fixture.js"), Buffer.alloc(bytes, 1));
  for (const preload of preloads) {
    writeFileSync(join(distDir, "assets", preload.file), Buffer.alloc(preload.bytes, 1));
  }
  writeProvenance(distDir, []);
}

test("production HTML이 가리키는 실제 초기 자체 JS 그래프 크기를 검사한다", () => withDistFixture((distDir) => {
  writeBundle(distDir, 499_999);
  assert.deepEqual(inspectRouteEntryBundle({ distDir, limitBytes: 500_000 }), {
    entryFile: "assets/index-fixture.js",
    files: [{ file: "assets/index-fixture.js", bytes: 499_999 }],
    excludedFiles: [],
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

test("entry가 작아도 초기 자체 modulepreload를 합친 그래프가 500KB 이상이면 실패한다", () => withDistFixture((distDir) => {
  writeBundle(distDir, 300_000, [{ file: "i18n-ko-fallback-fixture.js", bytes: 200_000 }]);
  assert.throws(
    () => inspectRouteEntryBundle({ distDir, limitBytes: 500_000 }),
    /초기 자체 JS 그래프.*500000.*미만/,
  );
}));

test("명시적인 third-party runtime preload는 자체 JS 그래프 예산에서 제외한다", () => withDistFixture((distDir) => {
  writeBundle(distDir, 300_000, [{ file: "i18n-runtime-fixture.js", bytes: 300_000 }]);
  writeProvenance(distDir, [provenanceRecord(
    distDir,
    "assets/i18n-runtime-fixture.js",
    ["node_modules/react/index.js", "node_modules/react-intl/index.js"],
    "third-party-runtime",
  )]);
  const result = inspectRouteEntryBundle({ distDir, limitBytes: 500_000 });
  assert.equal(result.bytes, 300_000);
  assert.deepEqual(result.excludedFiles, [{
    file: "assets/i18n-runtime-fixture.js",
    bytes: 300_000,
    reason: "third-party-runtime",
  }]);
}));

test("i18n-runtime 이름이어도 first-party 모듈이 섞이면 예산에 포함해 실패한다", () => withDistFixture((distDir) => {
  writeBundle(distDir, 300_000, [{ file: "i18n-runtime-fixture.js", bytes: 300_000 }]);
  writeProvenance(distDir, [provenanceRecord(
    distDir,
    "assets/i18n-runtime-fixture.js",
    ["node_modules/react/index.js", "src/i18n/defaultIntl.ts"],
    "first-party",
  )]);
  assert.throws(
    () => inspectRouteEntryBundle({ distDir, limitBytes: 500_000 }),
    /초기 자체 JS 그래프.*500000.*미만/,
  );
}));

for (const source of [
  "https://cdn.example.com/initial.js",
  "//cdn.example.com/initial.js",
  "data:text/javascript,export default 1",
]) {
  test(`외부 modulepreload ${source}는 provenance에서 제외하지 않고 fail-closed한다`, () => withDistFixture((distDir) => {
    writeBundle(distDir, 100_000);
    writeFileSync(
      join(distDir, "index.html"),
      [
        '<script type="module" src="./assets/index-fixture.js"></script>',
        `<link rel="modulepreload" href="${source}">`,
      ].join(""),
    );
    assert.throws(
      () => inspectRouteEntryBundle({ distDir }),
      /외부 modulepreload는 검사할 수 없습니다/,
    );
  }));
}

test("provenance artifact 누락·stale·파일 tamper는 fail-closed한다", () => withDistFixture((distDir) => {
  writeBundle(distDir, 100_000, [{ file: "i18n-runtime-fixture.js", bytes: 100_000 }]);
  rmSync(join(distDir, provenanceFile));
  assert.throws(() => inspectRouteEntryBundle({ distDir }), /provenance.*없습니다/);

  writeProvenance(distDir, [{
    file: "assets/stale-runtime.js",
    bytes: 1,
    sha256: sha256(Buffer.alloc(1, 1)),
    modules: ["node_modules/react/index.js"],
    classification: "third-party-runtime",
    reason: "허용된 React·React Intl runtime source만 포함합니다.",
  }]);
  assert.throws(() => inspectRouteEntryBundle({ distDir }), /stale.*provenance/);

  writeProvenance(distDir, [provenanceRecord(
    distDir,
    "assets/i18n-runtime-fixture.js",
    ["node_modules/react/index.js"],
    "third-party-runtime",
  )]);
  writeFileSync(join(distDir, "assets", "i18n-runtime-fixture.js"), Buffer.alloc(100_001, 1));
  assert.throws(() => inspectRouteEntryBundle({ distDir }), /provenance.*(?:크기|해시)/);
}));

test("provenance 생성물은 입력 순서와 무관하게 결정적이다", async () => {
  assert.equal(existsSync(provenanceModulePath), true, "초기 chunk provenance 생성기가 필요합니다");
  const { serializeInitialChunkProvenance } = await import(pathToFileURL(provenanceModulePath));
  const chunks = [
    { file: "assets/z.js", code: "z", moduleIds: ["C:/repo/node_modules/react/index.js"] },
    { file: "assets/a.js", code: "a", moduleIds: ["C:/repo/node_modules/react-intl/index.js"] },
  ];
  assert.equal(
    serializeInitialChunkProvenance(chunks, { rootDir: "C:/repo" }),
    serializeInitialChunkProvenance([...chunks].reverse(), { rootDir: "C:/repo" }),
  );
});

test("실제 React·React Intl runtime 전이 의존성과 Rollup CommonJS helper만 허용한다", async () => {
  const {
    ALLOWED_INITIAL_RUNTIME_SOURCES,
    classifyInitialChunkModules,
  } = await import(pathToFileURL(provenanceModulePath));
  assert.deepEqual(ALLOWED_INITIAL_RUNTIME_SOURCES, [
    { source: "@formatjs/fast-memoize", reason: "React Intl 메시지 포맷 캐시의 직접 전이 의존성입니다." },
    { source: "@formatjs/icu-messageformat-parser", reason: "React Intl ICU 메시지 파서의 직접 전이 의존성입니다." },
    { source: "@formatjs/icu-skeleton-parser", reason: "React Intl ICU skeleton 파서의 직접 전이 의존성입니다." },
    { source: "@formatjs/intl", reason: "react-intl이 사용하는 FormatJS intl runtime입니다." },
    { source: "intl-messageformat", reason: "react-intl의 ICU 메시지 포맷 runtime입니다." },
    { source: "react", reason: "애플리케이션의 React runtime입니다." },
    { source: "react-dom", reason: "애플리케이션의 React DOM runtime입니다." },
    { source: "react-intl", reason: "애플리케이션의 국제화 runtime입니다." },
    { source: "scheduler", reason: "react-dom의 scheduler 전이 의존성입니다." },
    { source: "virtual:commonjsHelpers.js", reason: "허용 runtime의 CommonJS 변환을 위해 Rollup이 생성한 정확한 가상 helper입니다." },
  ]);
  assert.deepEqual(classifyInitialChunkModules([
    "node_modules/@formatjs/fast-memoize/index.js",
    "node_modules/@formatjs/icu-messageformat-parser/index.js",
    "node_modules/@formatjs/icu-skeleton-parser/index.js",
    "node_modules/@formatjs/intl/index.js",
    "node_modules/intl-messageformat/index.js",
    "node_modules/react-dom/cjs/react-dom-client.production.js",
    "node_modules/react-dom/cjs/react-dom.production.js",
    "node_modules/react-dom/client.js",
    "node_modules/react-dom/index.js",
    "node_modules/react-intl/index.js",
    "node_modules/react/cjs/react-jsx-runtime.production.js",
    "node_modules/react/cjs/react.production.js",
    "node_modules/react/index.js",
    "node_modules/react/jsx-runtime.js",
    "node_modules/scheduler/cjs/scheduler.production.js",
    "node_modules/scheduler/index.js",
    "virtual:commonjsHelpers.js",
  ]), {
    classification: "third-party-runtime",
    reason: "허용된 React·React Intl runtime source만 포함합니다.",
  });
  assert.equal(classifyInitialChunkModules([
    "node_modules/react/index.js",
    "virtual:unapproved-helper.js",
  ]).classification, "first-party");
});

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

test("defaultIntl은 전체 한국어 catalog를 정적으로 가져오지 않고 실제 사용 최소 생성물만 쓴다", () => {
  const defaultIntl = readFileSync(join(rootDir, "src/i18n/defaultIntl.ts"), "utf8");
  const viteConfig = readFileSync(join(rootDir, "vite.config.ts"), "utf8");
  assert.match(defaultIntl, /generated\/legacyKoreanMessages/);
  assert.doesNotMatch(defaultIntl, /generated\/catalogs\/ko\//);
  assert.doesNotMatch(viteConfig, /i18n-ko-fallback/);
});

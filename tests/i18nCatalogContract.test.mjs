import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { validateCatalogs } from "../scripts/i18n/validate-catalogs.mjs";
import { checkGeneratedFiles, getGeneratedFiles } from "../scripts/i18n/build-catalogs.mjs";

const locales = ["ko", "en", "ja", "zh-CN", "zh-TW", "vi", "th", "id", "ms", "fil"];
const namespaces = [
  "core", "onboarding", "parent", "child", "shared", "billing", "reports", "notifications", "android",
];

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function withFixture(run) {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "hyeni-i18n-catalog-"));
  try {
    await run(fixtureRoot);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

async function writeValidFixture(root, { core = { "core.help": "Need help?" } } = {}) {
  const localesRoot = join(root, "locales");
  await mkdir(localesRoot, { recursive: true });
  await writeJson(join(localesRoot, "manifest.json"), {
    sourceLocale: "ko",
    locales: locales.map((code) => ({ code })),
  });
  await writeJson(join(localesRoot, "descriptions.json"), Object.fromEntries(
    Object.keys(core).map((id) => [id, { namespace: "core", variables: {} }]),
  ));
  await writeJson(join(localesRoot, "review-status.json"), {
    statuses: Object.fromEntries(locales.map((locale) => [
      locale,
      Object.fromEntries(namespaces.map((namespace) => [namespace, "draft"])),
    ])),
  });
  for (const locale of locales) {
    const namespaceRoot = join(localesRoot, locale);
    await mkdir(namespaceRoot, { recursive: true });
    for (const namespace of namespaces) {
      await writeJson(join(namespaceRoot, `${namespace}.json`), namespace === "core" ? core : {});
    }
  }
}

test("카탈로그 검증기는 ID·ICU 인수·금지 마크업 불일치를 보고한다", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "hyeni-i18n-catalog-"));
  const localesRoot = join(fixtureRoot, "locales");

  try {
    await mkdir(localesRoot, { recursive: true });
    await writeJson(join(localesRoot, "manifest.json"), {
      sourceLocale: "ko",
      locales: locales.map((code) => ({ code })),
    });
    await writeJson(join(localesRoot, "descriptions.json"), {
      "core.action.retry": {
        namespace: "core",
        variables: {},
      },
      "core.greeting": {
        namespace: "core",
        variables: { name: "string" },
      },
      "core.help": {
        namespace: "core",
        variables: {},
      },
    });
    await writeJson(join(localesRoot, "review-status.json"), {
      statuses: Object.fromEntries(locales.map((locale) => [locale, { core: "draft" }])),
    });

    for (const locale of locales) {
      const namespaceRoot = join(localesRoot, locale);
      await mkdir(namespaceRoot, { recursive: true });
      const catalog = {
        "core.action.retry": "Retry",
        "core.greeting": "Hello, {name}",
        "core.help": "Need help?",
      };
      if (locale === "vi") delete catalog["core.action.retry"];
      if (locale === "th") catalog["core.unknown"] = "Unknown";
      if (locale === "ja") catalog["core.greeting"] = "こんにちは、{person}";
      if (locale === "id") catalog["core.help"] = "<script>alert(1)</script>";
      await writeJson(join(namespaceRoot, "core.json"), catalog);
    }

    const result = await validateCatalogs({ rootDir: fixtureRoot, namespaces: ["core"] });

    assert.equal(result.errors.includes("missing_id:vi:core:core.action.retry"), true);
    assert.equal(result.errors.includes("extra_id:th:core:core.unknown"), true);
    assert.equal(result.errors.includes("argument_mismatch:ja:core:core.greeting:name"), true);
    assert.equal(result.errors.includes("forbidden_markup:id:core:core.help"), true);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("카탈로그 검증기는 malformed metadata와 정확하지 않은 locale 집합을 fail-closed 한다", async () => {
  await withFixture(async (fixtureRoot) => {
    await writeValidFixture(fixtureRoot);
    const localesRoot = join(fixtureRoot, "locales");
    for (const [file, values, expected] of [
      ["manifest.json", [null, {}, [], "invalid"], "invalid_manifest"],
      ["descriptions.json", [null, [], "invalid"], "invalid_descriptions"],
      ["review-status.json", [null, [], { statuses: [] }, "invalid"], "invalid_review_status"],
    ]) {
      for (const value of values) {
        await writeValidFixture(fixtureRoot);
        await writeJson(join(localesRoot, file), value);
        const result = await validateCatalogs({ rootDir: fixtureRoot });
        assert.equal(result.errors.includes(expected), true);
      }
    }

    await writeValidFixture(fixtureRoot);
    await writeJson(join(localesRoot, "manifest.json"), { sourceLocale: "ko", locales: [] });
    assert.equal((await validateCatalogs({ rootDir: fixtureRoot })).errors.includes("invalid_locale_set"), true);

    await writeJson(join(localesRoot, "manifest.json"), {
      sourceLocale: "ko",
      locales: [...locales.slice(0, 9).map((code) => ({ code })), { code: "ko" }],
    });
    const duplicate = await validateCatalogs({ rootDir: fixtureRoot });
    assert.equal(duplicate.errors.includes("duplicate_locale:ko"), true);
    assert.equal(duplicate.errors.includes("invalid_locale_set"), true);

    await writeJson(join(localesRoot, "manifest.json"), {
      sourceLocale: "ko",
      locales: locales.map((code, index) => ({ code: index === 1 ? "en-US" : code })),
    });
    const inaccurate = await validateCatalogs({ rootDir: fixtureRoot });
    assert.equal(inaccurate.errors.includes("invalid_locale:en-US"), true);
    assert.equal(inaccurate.errors.includes("invalid_locale_set"), true);
  });
});

test("카탈로그 검증기는 허용 origin 접두사를 흉내 낸 URL을 거부한다", async () => {
  await withFixture(async (fixtureRoot) => {
    for (const message of ["https://hyeni-calendar.pages.devil.example/help", "https://"]) {
      await writeValidFixture(fixtureRoot, { core: { "core.help": message } });
      const result = await validateCatalogs({ rootDir: fixtureRoot });
      assert.equal(result.errors.includes("forbidden_markup:ko:core:core.help"), true);
    }
  });
});

test("카탈로그 검증기는 prototype 오염 key를 거부한다", async () => {
  await withFixture(async (fixtureRoot) => {
    await writeValidFixture(fixtureRoot, {
      core: JSON.parse('{"__proto__":"x","prototype":"x","constructor":"x"}'),
    });
    const result = await validateCatalogs({ rootDir: fixtureRoot });
    assert.equal(result.errors.includes("forbidden_key:ko:core:__proto__"), true);
    assert.equal(result.errors.includes("forbidden_key:ko:core:prototype"), true);
    assert.equal(result.errors.includes("forbidden_key:ko:core:constructor"), true);
  });
});

test("생성물 freshness는 예상 밖 TypeScript 파일도 검출한다", async () => {
  await withFixture(async (fixtureRoot) => {
    await writeValidFixture(fixtureRoot);
    const result = await validateCatalogs({ rootDir: fixtureRoot });
    assert.deepEqual(result.errors, []);
    for (const [path, content] of getGeneratedFiles(result)) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, "utf8");
    }
    const extra = join(fixtureRoot, "src", "i18n", "generated", "catalogs", "ko", "obsolete.ts");
    await writeFile(extra, "export default {};\n", "utf8");
    const freshness = await checkGeneratedFiles(result);
    assert.equal(freshness.stale.includes("src/i18n/generated/catalogs/ko/obsolete.ts"), true);
  });
});

test("카탈로그 검증기는 draft 밖 review status를 거부한다", async () => {
  await withFixture(async (fixtureRoot) => {
    await writeValidFixture(fixtureRoot);
    const path = join(fixtureRoot, "locales", "review-status.json");
    const statuses = Object.fromEntries(locales.map((locale) => [
      locale,
      Object.fromEntries(namespaces.map((namespace) => [namespace, "draft"])),
    ]));
    statuses.en.core = "approved";
    await writeJson(path, { statuses });
    const result = await validateCatalogs({ rootDir: fixtureRoot });
    assert.equal(result.errors.includes("invalid_review_status:en:core:approved"), true);
  });
});

test("검증 오류는 locale 영향을 받지 않는 code-point 순서로 정렬한다", async () => {
  await withFixture(async (fixtureRoot) => {
    await writeValidFixture(fixtureRoot, {
      core: { "core.a": "A", "core.z": "Z", "core.á": "Accent" },
    });
    await writeJson(join(fixtureRoot, "locales", "en", "core.json"), {});
    const result = await validateCatalogs({ rootDir: fixtureRoot });
    assert.deepEqual(
      result.errors.filter((error) => error.startsWith("missing_id:en:core:")),
      ["missing_id:en:core:core.a", "missing_id:en:core:core.z", "missing_id:en:core:core.á"],
    );
  });
});

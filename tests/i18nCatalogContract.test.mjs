import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { validateCatalogs } from "../scripts/i18n/validate-catalogs.mjs";

const locales = ["ko", "en", "ja", "zh-CN", "zh-TW", "vi", "th", "id", "ms", "fil"];

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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

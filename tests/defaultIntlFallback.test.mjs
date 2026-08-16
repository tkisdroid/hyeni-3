import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import legacyKoreanMessages from "../src/i18n/generated/legacyKoreanMessages.ts";
import { legacyKoreanMessageIds } from "../scripts/i18n/legacy-korean-message-ids.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const usageAuditPath = resolve(rootDir, "scripts/i18n/default-intl-usage.mjs");

test("동기 한국어 fallback 생성물은 명시한 actual-use ID와 정확히 일치한다", () => {
  assert.deepEqual(Object.keys(legacyKoreanMessages).sort(), legacyKoreanMessageIds);
  assert.equal(legacyKoreanMessageIds.length, 248);
});

test("src 전체 AST에서 defaultIntl importer와 정적·분류된 동적 ID를 자동 감사한다", async () => {
  assert.equal(existsSync(usageAuditPath), true, "defaultIntl 사용 감사기가 필요합니다");
  const { auditDefaultIntlUsage } = await import(pathToFileURL(usageAuditPath));
  const { defaultIntlDynamicUsages } = await import("../scripts/i18n/legacy-korean-message-ids.mjs");
  assert.ok(Array.isArray(defaultIntlDynamicUsages), "분류된 동적 ID 예외 목록이 필요합니다");
  const result = auditDefaultIntlUsage({
    rootDir,
    fallbackIds: Object.keys(legacyKoreanMessages),
    dynamicUsages: defaultIntlDynamicUsages,
  });
  assert.ok(result.importers.length > 0, "defaultIntl importer를 자동 발견해야 합니다");
  assert.deepEqual(result.violations, []);
  assert.deepEqual(result.messageIds, legacyKoreanMessageIds);
  assert.equal(result.consumedDynamicUsages, result.dynamicUsageEntries);
});

test("새 디렉터리의 defaultIntl importer도 자동 포함하고 누락 ID를 실패시킨다", async () => {
  assert.equal(existsSync(usageAuditPath), true, "defaultIntl 사용 감사기가 필요합니다");
  const { auditDefaultIntlUsage } = await import(pathToFileURL(usageAuditPath));
  const fixtureRoot = mkdtempSync(join(tmpdir(), "hyeni-default-intl-"));
  try {
    mkdirSync(join(fixtureRoot, "src", "i18n"), { recursive: true });
    mkdirSync(join(fixtureRoot, "src", "feature", "nested"), { recursive: true });
    writeFileSync(join(fixtureRoot, "src", "i18n", "defaultIntl.ts"), "export const withDefaultIntl = (value) => value;\n");
    writeFileSync(
      join(fixtureRoot, "src", "feature", "nested", "newConsumer.ts"),
      [
        'import { withDefaultIntl } from "../../i18n/defaultIntl.ts";',
        "export function copy(providedIntl) {",
        "  const intl = withDefaultIntl(providedIntl);",
        '  return intl.formatMessage({ id: "shared.fixture.missing" });',
        "}",
      ].join("\n"),
    );
    const result = auditDefaultIntlUsage({ rootDir: fixtureRoot, fallbackIds: [], dynamicUsages: [] });
    assert.deepEqual(result.importers, ["src/feature/nested/newConsumer.ts"]);
    assert.match(result.violations.join("\n"), /missing_fallback:src\/feature\/nested\/newConsumer\.ts:shared\.fixture\.missing/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("동적 ID 예외는 importer·pattern·exact IDs·근거가 필요하고 미소비 예외를 거부한다", async () => {
  assert.equal(existsSync(usageAuditPath), true, "defaultIntl 사용 감사기가 필요합니다");
  const { auditDefaultIntlUsage } = await import(pathToFileURL(usageAuditPath));
  const { defaultIntlDynamicUsages } = await import("../scripts/i18n/legacy-korean-message-ids.mjs");
  assert.ok(Array.isArray(defaultIntlDynamicUsages), "분류된 동적 ID 예외 목록이 필요합니다");
  for (const usage of defaultIntlDynamicUsages) {
    assert.deepEqual(Object.keys(usage).sort(), ["ids", "importer", "pattern", "reason"]);
    assert.ok(usage.importer.startsWith("src/"));
    assert.ok(usage.pattern.trim());
    assert.ok(usage.ids.length > 0);
    assert.ok(usage.reason.trim());
  }
  const result = auditDefaultIntlUsage({
    rootDir,
    fallbackIds: Object.keys(legacyKoreanMessages),
    dynamicUsages: [
      ...defaultIntlDynamicUsages,
      {
        importer: "src/transform/never-imported.ts",
        pattern: "`shared.never.${value}`",
        ids: ["shared.never.value"],
        reason: "stale 검증 fixture",
      },
    ],
  });
  assert.match(result.violations.join("\n"), /stale_dynamic_usage:src\/transform\/never-imported\.ts/);
});

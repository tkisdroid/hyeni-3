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

async function auditFixture(source, fallbackIds = []) {
  const { auditDefaultIntlUsage } = await import(pathToFileURL(usageAuditPath));
  const fixtureRoot = mkdtempSync(join(tmpdir(), "hyeni-default-intl-"));
  try {
    mkdirSync(join(fixtureRoot, "src", "i18n"), { recursive: true });
    mkdirSync(join(fixtureRoot, "src", "feature"), { recursive: true });
    writeFileSync(join(fixtureRoot, "src", "i18n", "defaultIntl.ts"), "export const withDefaultIntl = (value) => value;\n");
    writeFileSync(
      join(fixtureRoot, "src", "feature", "consumer.ts"),
      `import { withDefaultIntl } from "../i18n/defaultIntl.ts";\n${source}\n`,
    );
    return auditDefaultIntlUsage({ rootDir: fixtureRoot, fallbackIds, dynamicUsages: [] });
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

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
  assert.equal(result.importers.length, 19, "defaultIntl importer 19개를 자동 발견해야 합니다");
  assert.deepEqual(result.violations, []);
  assert.deepEqual(result.messageIds, legacyKoreanMessageIds);
  assert.equal(result.dynamicUsageEntries, 12);
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

test("inline·descriptor const·id const·destructured·renamed formatMessage의 누락 ID를 모두 찾는다", async () => {
  const result = await auditFixture([
    "export function copy(providedIntl) {",
    "  const intl = withDefaultIntl(providedIntl);",
    '  intl.formatMessage({ id: "shared.fixture.inline" });',
    '  const descriptor = { id: "shared.fixture.descriptor" };',
    "  intl.formatMessage(descriptor);",
    '  const id = "shared.fixture.shorthand";',
    "  intl.formatMessage({ id });",
    "  const { formatMessage } = intl;",
    '  formatMessage({ id: "shared.fixture.destructured" });',
    "  const { formatMessage: fm } = intl;",
    '  return fm({ id: "shared.fixture.renamed" });',
    "}",
  ].join("\n"));

  assert.deepEqual(result.messageIds, [
    "shared.fixture.descriptor",
    "shared.fixture.destructured",
    "shared.fixture.inline",
    "shared.fixture.renamed",
    "shared.fixture.shorthand",
  ]);
  for (const id of result.messageIds) {
    assert.match(result.violations.join("\n"), new RegExp(`missing_fallback:src/feature/consumer\\.ts:${id}`));
  }
});

test("defaultIntl에서 유래하지 않은 동명 formatMessage 호출은 감사하지 않는다", async () => {
  const result = await auditFixture([
    "const unrelated = { formatMessage(descriptor) { return descriptor.id; } };",
    'unrelated.formatMessage({ id: "shared.fixture.unrelatedMethod" });',
    "const { formatMessage: unrelatedFormat } = unrelated;",
    'unrelatedFormat({ id: "shared.fixture.unrelatedAlias" });',
    "export function copy(providedIntl) {",
    "  const intl = withDefaultIntl(providedIntl);",
    '  return intl.formatMessage({ id: "shared.fixture.actual" });',
    "}",
  ].join("\n"), ["shared.fixture.actual"]);

  assert.deepEqual(result.messageIds, ["shared.fixture.actual"]);
  assert.deepEqual(result.violations, []);
});

test("mutable·computed·spread·ambiguous descriptor와 미지원 method alias는 fail-closed한다", async () => {
  const result = await auditFixture([
    "export function copy(providedIntl, condition) {",
    "  const intl = withDefaultIntl(providedIntl);",
    '  let mutableId = "shared.fixture.mutableId";',
    "  intl.formatMessage({ id: mutableId });",
    '  let mutableDescriptor = { id: "shared.fixture.mutableDescriptor" };',
    "  intl.formatMessage(mutableDescriptor);",
    '  const computedDescriptor = { ["id"]: "shared.fixture.computed" };',
    "  intl.formatMessage(computedDescriptor);",
    '  const spreadDescriptor = { ...{ id: "shared.fixture.spread" } };',
    "  intl.formatMessage(spreadDescriptor);",
    '  const ambiguousDescriptor = condition ? { id: "shared.fixture.a" } : { id: "shared.fixture.b" };',
    "  intl.formatMessage(ambiguousDescriptor);",
    '  const mutatedDescriptor = { id: "shared.fixture.beforeMutation" };',
    '  mutatedDescriptor.id = "shared.fixture.afterMutation";',
    "  intl.formatMessage(mutatedDescriptor);",
    "  const fm = intl.formatMessage;",
    '  fm({ id: "shared.fixture.methodAlias" });',
    "  let { formatMessage: mutableFm } = intl;",
    '  mutableFm({ id: "shared.fixture.mutableDestructured" });',
    "  const { formatMessage: stableFm } = intl;",
    "  let mutableAlias = stableFm;",
    '  mutableAlias({ id: "shared.fixture.mutableAlias" });',
    '  let mutableMethodName = "formatMessage";',
    '  return intl[mutableMethodName]({ id: "shared.fixture.mutableComputed" });',
    "}",
  ].join("\n"));

  const violations = result.violations.join("\n");
  assert.match(violations, /unsupported_format_message:src\/feature\/consumer\.ts:.*mutableId/);
  assert.match(violations, /unsupported_format_message:src\/feature\/consumer\.ts:.*mutableDescriptor/);
  assert.match(violations, /unsupported_format_message:src\/feature\/consumer\.ts:.*computedDescriptor/);
  assert.match(violations, /unsupported_format_message:src\/feature\/consumer\.ts:.*spreadDescriptor/);
  assert.match(violations, /unsupported_format_message:src\/feature\/consumer\.ts:.*ambiguousDescriptor/);
  assert.match(violations, /unsupported_format_message:src\/feature\/consumer\.ts:.*mutatedDescriptor/);
  assert.match(violations, /unsupported_format_message:src\/feature\/consumer\.ts:.*fm\(/);
  assert.match(violations, /unsupported_format_message:src\/feature\/consumer\.ts:.*mutableFm\(/);
  assert.match(violations, /unsupported_format_message:src\/feature\/consumer\.ts:.*mutableAlias\(/);
  assert.match(violations, /unsupported_format_message:src\/feature\/consumer\.ts:.*mutableMethodName/);
});

test("trusted formatMessage의 call·apply·bind 경로를 조용히 무시하지 않는다", async () => {
  const result = await auditFixture([
    "export function copy(providedIntl) {",
    "  const intl = withDefaultIntl(providedIntl);",
    '  intl.formatMessage.call(intl, { id: "shared.fixture.callMissing" });',
    '  intl.formatMessage.apply(intl, [{ id: "shared.fixture.applyMissing" }]);',
    '  intl.formatMessage.bind(intl)({ id: "shared.fixture.inlineBoundMissing" });',
    "  const bound = intl.formatMessage.bind(intl);",
    '  return bound({ id: "shared.fixture.boundMissing" });',
    "}",
  ].join("\n"));

  const violations = result.violations.join("\n");
  assert.match(violations, /unsupported_format_message:src\/feature\/consumer\.ts:.*\.call\(/);
  assert.match(violations, /unsupported_format_message:src\/feature\/consumer\.ts:.*\.apply\(/);
  assert.match(violations, /unsupported_format_message:src\/feature\/consumer\.ts:.*\.bind\(/);
  assert.match(violations, /unsupported_format_message:src\/feature\/consumer\.ts:.*bound\(/);
});

test("destructured const alias chain과 exact const computed key의 누락 ID를 수집한다", async () => {
  const result = await auditFixture([
    "export function copy(providedIntl) {",
    "  const intl = withDefaultIntl(providedIntl);",
    "  const { formatMessage: fm } = intl;",
    "  const alias = fm;",
    '  alias({ id: "shared.fixture.aliasMissing" });',
    '  const methodName = "formatMessage" as const;',
    '  return intl[methodName]({ id: "shared.fixture.computedMissing" });',
    "}",
  ].join("\n"));

  assert.deepEqual(result.messageIds, [
    "shared.fixture.aliasMissing",
    "shared.fixture.computedMissing",
  ]);
  assert.match(result.violations.join("\n"), /missing_fallback:src\/feature\/consumer\.ts:shared\.fixture\.aliasMissing/);
  assert.match(result.violations.join("\n"), /missing_fallback:src\/feature\/consumer\.ts:shared\.fixture\.computedMissing/);
});

test("trusted formatMessage reference의 callback·return·배열·객체 escape를 fail-closed한다", async () => {
  const result = await auditFixture([
    "function consume(value) { return value; }",
    "export function callbackEscape(providedIntl) {",
    "  const callbackIntl = withDefaultIntl(providedIntl);",
    "  return consume(callbackIntl.formatMessage);",
    "}",
    "export function returnEscape(providedIntl) {",
    "  const returnIntl = withDefaultIntl(providedIntl);",
    "  return returnIntl.formatMessage;",
    "}",
    "export function arrayEscape(providedIntl) {",
    "  const arrayIntl = withDefaultIntl(providedIntl);",
    "  return [arrayIntl.formatMessage];",
    "}",
    "export function objectEscape(providedIntl) {",
    "  const objectIntl = withDefaultIntl(providedIntl);",
    "  return { formatter: objectIntl.formatMessage };",
    "}",
  ].join("\n"));

  const violations = result.violations.join("\n");
  assert.match(violations, /unsupported_format_message:src\/feature\/consumer\.ts:.*callbackIntl\.formatMessage/);
  assert.match(violations, /unsupported_format_message:src\/feature\/consumer\.ts:.*returnIntl\.formatMessage/);
  assert.match(violations, /unsupported_format_message:src\/feature\/consumer\.ts:.*arrayIntl\.formatMessage/);
  assert.match(violations, /unsupported_format_message:src\/feature\/consumer\.ts:.*objectIntl\.formatMessage/);
});

test("unrelated 객체의 call·apply·bind·alias·computed·escape는 감사 대상이 아니다", async () => {
  const result = await auditFixture([
    "function consume(value) { return value; }",
    "const unrelated = { formatMessage(descriptor) { return descriptor.id; } };",
    'unrelated.formatMessage.call(unrelated, { id: "shared.fixture.unrelatedCall" });',
    'unrelated.formatMessage.apply(unrelated, [{ id: "shared.fixture.unrelatedApply" }]);',
    "const unrelatedBound = unrelated.formatMessage.bind(unrelated);",
    'unrelatedBound({ id: "shared.fixture.unrelatedBound" });',
    "const { formatMessage: unrelatedFm } = unrelated;",
    "const unrelatedAlias = unrelatedFm;",
    'unrelatedAlias({ id: "shared.fixture.unrelatedAlias" });',
    'const methodName = "formatMessage" as const;',
    'unrelated[methodName]({ id: "shared.fixture.unrelatedComputed" });',
    "consume(unrelated.formatMessage);",
    "export const unrelatedEscapes = [unrelated.formatMessage, { formatter: unrelated.formatMessage }];",
    "const cycleA = cycleB;",
    "const cycleB = cycleA;",
    'cycleA({ id: "shared.fixture.unrelatedCycle" });',
  ].join("\n"));

  assert.deepEqual(result.messageIds, []);
  assert.deepEqual(result.violations, []);
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
      { ...defaultIntlDynamicUsages[0] },
      {
        importer: "src/transform/never-imported.ts",
        pattern: "`shared.never.${value}`",
        ids: ["shared.never.value"],
        reason: "stale 검증 fixture",
      },
    ],
  });
  assert.match(result.violations.join("\n"), /duplicate_dynamic_usage:src\/transform\/deviceNotificationHealth\.ts/);
  assert.match(result.violations.join("\n"), /stale_dynamic_usage:src\/transform\/never-imported\.ts/);
});

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
    writeFileSync(
      join(fixtureRoot, "src", "i18n", "defaultIntl.ts"),
      [
        "export const defaultKoreanIntl = { formatMessage: (descriptor) => descriptor.id };",
        "export const withDefaultIntl = (value) => value ?? defaultKoreanIntl;",
      ].join("\n"),
    );
    writeFileSync(
      join(fixtureRoot, "src", "react-intl.d.ts"),
      [
        'declare module "react-intl" {',
        "  export interface IntlShape {",
        "    formatMessage(descriptor: { id: string }): string;",
        "  }",
        "}",
      ].join("\n"),
    );
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

test("defaultIntl namespace factory와 singleton의 누락 ID를 수집한다", async () => {
  const result = await auditFixture([
    'import * as defaults from "../i18n/defaultIntl.ts";',
    "export function copy(providedIntl) {",
    "  const intl = defaults.withDefaultIntl(providedIntl);",
    '  intl.formatMessage({ id: "shared.fixture.namespaceFactoryMissing" });',
    '  return defaults.defaultKoreanIntl.formatMessage({ id: "shared.fixture.namespaceSingletonMissing" });',
    "}",
  ].join("\n"));

  assert.deepEqual(result.messageIds, [
    "shared.fixture.namespaceFactoryMissing",
    "shared.fixture.namespaceSingletonMissing",
  ]);
  assert.match(result.violations.join("\n"), /missing_fallback:src\/feature\/consumer\.ts:shared\.fixture\.namespaceFactoryMissing/);
  assert.match(result.violations.join("\n"), /missing_fallback:src\/feature\/consumer\.ts:shared\.fixture\.namespaceSingletonMissing/);
});

test("alias-resolved IntlShape default parameter와 destructured parameter의 ID를 수집한다", async () => {
  const result = await auditFixture([
    'import type { IntlShape } from "react-intl";',
    "type IntlAlias = IntlShape;",
    "export function byAlias(",
    "  providedIntl: IntlShape,",
    "  intl: IntlAlias = withDefaultIntl(providedIntl),",
    ") {",
    '  return intl.formatMessage({ id: "shared.fixture.aliasParameterMissing" });',
    "}",
    "export function byDestructuring(",
    "  providedIntl: IntlShape,",
    "  { formatMessage }: IntlShape = withDefaultIntl(providedIntl),",
    ") {",
    '  return formatMessage({ id: "shared.fixture.parameterDestructuringMissing" });',
    "}",
  ].join("\n"));

  assert.deepEqual(result.messageIds, [
    "shared.fixture.aliasParameterMissing",
    "shared.fixture.parameterDestructuringMissing",
  ]);
  assert.match(result.violations.join("\n"), /missing_fallback:src\/feature\/consumer\.ts:shared\.fixture\.aliasParameterMissing/);
  assert.match(result.violations.join("\n"), /missing_fallback:src\/feature\/consumer\.ts:shared\.fixture\.parameterDestructuringMissing/);
});

test("signature-only forward 선언은 trusted 전달을 fail-closed하고 실제 실행 경로에서 누락된 ID를 발견한다", async () => {
  const result = await auditFixture([
    'import type { IntlShape } from "react-intl";',
    "export function typedForwarder(intl: IntlShape): IntlShape {",
    "  return withDefaultIntl(intl);",
    "}",
    "export function typedOverloadForward(intl: IntlShape): IntlShape;",
    "export function typedOverloadForward(value: any): any {",
    "  return value;",
    "}",
    "export function copy(providedIntl) {",
    "  const typed = typedForwarder(withDefaultIntl(providedIntl));",
    "  const broken = typedOverloadForward(withDefaultIntl(providedIntl));",
    '  typed.formatMessage({ id: "shared.fixture.concreteForwarder" });',
    '  return broken.formatMessage({ id: "shared.fixture.overloadSignatureMissing" });',
    "}",
  ].join("\n"));

  assert.deepEqual(result.messageIds, ["shared.fixture.concreteForwarder"]);
  assert.match(result.violations.join("\n"), /missing_fallback:src\/feature\/consumer\.ts:shared\.fixture\.concreteForwarder/);
  assert.match(result.violations.join("\n"), /unsupported_format_message:src\/feature\/consumer\.ts:.*overloadSignatureMissing/);
});

test("typed overload helper의 실제 구현 signature는 구현 호출을 허용한다", async () => {
  const result = await auditFixture([
    'import type { IntlShape } from "react-intl";',
    "export function typedOverloadForward(intl: IntlShape): IntlShape;",
    "export function typedOverloadForward(intl: IntlShape): IntlShape {",
    "  return withDefaultIntl(intl);",
    "}",
    "export function copy(providedIntl) {",
    "  const typed = typedOverloadForward(withDefaultIntl(providedIntl));",
    '  return typed.formatMessage({ id: "shared.fixture.overloadConcreteMissing" });',
    "}",
  ].join("\n"));

  assert.deepEqual(result.messageIds, ["shared.fixture.overloadConcreteMissing"]);
  assert.match(result.violations.join("\n"), /missing_fallback:src\/feature\/consumer\.ts:shared\.fixture\.overloadConcreteMissing/);
});

test("derived formatMessage const alias의 export escape를 fail-closed한다", async () => {
  const result = await auditFixture([
    "const providedIntl = undefined;",
    "const intl = withDefaultIntl(providedIntl);",
    "const { formatMessage: fm } = intl;",
    "const alias = fm;",
    "export { alias };",
    "const { formatMessage } = intl;",
    "export const formatter = formatMessage;",
  ].join("\n"));

  const violations = result.violations.join("\n");
  assert.match(violations, /unsupported_format_message:src\/feature\/consumer\.ts:.*alias/);
  assert.match(violations, /unsupported_format_message:src\/feature\/consumer\.ts:.*formatter/);
});

test("assignment destructuring으로 파생된 formatMessage를 unrelated로 잃지 않는다", async () => {
  const result = await auditFixture([
    "export function copy(providedIntl) {",
    "  const intl = withDefaultIntl(providedIntl);",
    "  let fm;",
    "  ({ formatMessage: fm } = intl);",
    '  return fm({ id: "shared.fixture.assignmentMissing" });',
    "}",
  ].join("\n"));

  assert.match(
    result.violations.join("\n"),
    /unsupported_format_message:src\/feature\/consumer\.ts:.*(?:formatMessage: fm|fm\()/,
  );
});

test("defaultIntl root와 derived intl object의 module·wrapper escape를 fail-closed한다", async () => {
  const result = await auditFixture([
    'export { defaultKoreanIntl as forwardedIntl } from "../i18n/defaultIntl.ts";',
    "export { withDefaultIntl };",
    "function consume(value) { return value; }",
    "export function returnFactory() { return withDefaultIntl; }",
    "export function callbackFactory() { return consume(withDefaultIntl); }",
    "export function returnIntl(providedIntl) {",
    "  const intl = withDefaultIntl(providedIntl);",
    "  return intl;",
    "}",
    "export const intlContainer = [withDefaultIntl(undefined)];",
  ].join("\n"));

  const violations = result.violations.join("\n");
  assert.match(violations, /unsupported_format_message:src\/feature\/consumer\.ts:.*forwardedIntl/);
  assert.match(violations, /unsupported_format_message:src\/feature\/consumer\.ts:.*withDefaultIntl/);
  assert.match(violations, /unsupported_format_message:src\/feature\/consumer\.ts:.*returnIntl/);
  assert.match(violations, /unsupported_format_message:src\/feature\/consumer\.ts:.*intlContainer/);
});

test("unrelated namespace·object·type alias·assignment·alias cycle은 위반이 아니다", async () => {
  const result = await auditFixture([
    "const unrelatedDefaults = {",
    "  withDefaultIntl: (value) => value,",
    "  defaultKoreanIntl: { formatMessage: (descriptor) => descriptor.id },",
    "};",
    "const unrelatedIntl = unrelatedDefaults.withDefaultIntl(unrelatedDefaults.defaultKoreanIntl);",
    'unrelatedIntl.formatMessage({ id: "shared.fixture.unrelatedNamespace" });',
    "type UnrelatedIntlAlias = { formatMessage(descriptor: { id: string }): string };",
    "function unrelatedParameter(",
    "  { formatMessage }: UnrelatedIntlAlias = unrelatedDefaults.defaultKoreanIntl,",
    ") {",
    '  return formatMessage({ id: "shared.fixture.unrelatedParameter" });',
    "}",
    "const { formatMessage: unrelatedFm } = unrelatedIntl;",
    "const unrelatedAlias = unrelatedFm;",
    "export { unrelatedAlias };",
    "let unrelatedAssigned;",
    "({ formatMessage: unrelatedAssigned } = unrelatedIntl);",
    'unrelatedAssigned({ id: "shared.fixture.unrelatedAssignment" });',
    "const cycleA = cycleB;",
    "const cycleB = cycleA;",
    'cycleA({ id: "shared.fixture.unrelatedCycle" });',
    "type TypeCycleA = TypeCycleB;",
    "type TypeCycleB = TypeCycleA;",
    "void unrelatedParameter;",
  ].join("\n"));

  assert.deepEqual(result.messageIds, []);
  assert.deepEqual(result.violations, []);
});

test("양쪽 root를 가진 conditional intl·format const alias는 ID를 끝까지 수집한다", async () => {
  const result = await auditFixture([
    "export function copy(providedIntl, condition) {",
    "  const leftIntl = withDefaultIntl(providedIntl);",
    "  const rightIntl = withDefaultIntl(providedIntl);",
    "  const intl = condition ? leftIntl : rightIntl;",
    '  intl.formatMessage({ id: "shared.fixture.conditionalIntlMissing" });',
    "  const { formatMessage: leftFormat } = leftIntl;",
    "  const { formatMessage: rightFormat } = rightIntl;",
    "  const format = condition ? leftFormat : rightFormat;",
    '  return format({ id: "shared.fixture.conditionalFormatMissing" });',
    "}",
  ].join("\n"));

  assert.deepEqual(result.messageIds, [
    "shared.fixture.conditionalFormatMissing",
    "shared.fixture.conditionalIntlMissing",
  ]);
  assert.match(result.violations.join("\n"), /missing_fallback:src\/feature\/consumer\.ts:shared\.fixture\.conditionalFormatMissing/);
  assert.match(result.violations.join("\n"), /missing_fallback:src\/feature\/consumer\.ts:shared\.fixture\.conditionalIntlMissing/);
});

test("factory·intl object의 mutable·callback·export·container·property write를 fail-closed한다", async () => {
  const result = await auditFixture([
    'import type { IntlShape } from "react-intl";',
    'import { defaultKoreanIntl } from "../i18n/defaultIntl.ts";',
    "function consume(value) { return value; }",
    "let mutableFactory = withDefaultIntl;",
    "let mutableIntl = withDefaultIntl(undefined);",
    "const stableIntl = withDefaultIntl(undefined);",
    "consume(stableIntl);",
    "export const exportedIntl = stableIntl;",
    "const holder = { stableIntl, factory: withDefaultIntl, singleton: defaultKoreanIntl };",
    "stableIntl.formatMessage = (descriptor) => descriptor.id;",
    "export function parameterWrite(intl: IntlShape) {",
    "  intl = defaultKoreanIntl;",
    '  return intl.formatMessage({ id: "shared.fixture.parameterWrite" });',
    "}",
    "void mutableFactory;",
    "void mutableIntl;",
    "void holder;",
  ].join("\n"));

  const violations = result.violations.join("\n");
  for (const marker of [
    "mutableFactory",
    "mutableIntl",
    "consume(stableIntl)",
    "exportedIntl",
    "holder",
    "stableIntl.formatMessage",
    "parameterWrite",
  ]) {
    assert.match(violations, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")));
  }
});

test("defaultIntl default import·export-all·unknown namespace member를 명시적으로 거부한다", async () => {
  const result = await auditFixture([
    'import defaultsDefault from "../i18n/defaultIntl.ts";',
    'import * as defaults from "../i18n/defaultIntl.ts";',
    'export * from "../i18n/defaultIntl.ts";',
    "const dynamicKey = Math.random() > 0.5 ? \"withDefaultIntl\" : \"defaultKoreanIntl\";",
    "void defaultsDefault;",
    "void defaults[dynamicKey];",
  ].join("\n"));

  const violations = result.violations.join("\n");
  assert.match(violations, /unsupported_format_message:src\/feature\/consumer\.ts:import defaultsDefault/);
  assert.match(violations, /unsupported_format_message:src\/feature\/consumer\.ts:export \*/);
  assert.match(violations, /unsupported_format_message:src\/feature\/consumer\.ts:defaults\[dynamicKey\]/);
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

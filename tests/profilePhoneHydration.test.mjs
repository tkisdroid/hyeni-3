import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tsModule from "typescript";

const ts = tsModule.default ?? tsModule;
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parse(relativePath) {
  const source = readFileSync(resolve(rootDir, relativePath), "utf8");
  return {
    source,
    sourceFile: ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
  };
}

function variableInitializer(sourceFile, name) {
  let initializer = null;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      initializer = node.initializer?.getText(sourceFile) ?? null;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return initializer;
}

function arrowBody(sourceFile, name) {
  let body = null;
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === name
      && node.initializer
      && ts.isArrowFunction(node.initializer)
    ) {
      body = node.initializer.body.getText(sourceFile);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return body;
}

function disabledExpressionForClass(sourceFile, className) {
  let expression = null;
  const visit = (node) => {
    if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) {
      ts.forEachChild(node, visit);
      return;
    }
    const attributes = node.attributes.properties.filter(ts.isJsxAttribute);
    const classAttribute = attributes.find((attribute) => attribute.name.text === "className");
    if (!classAttribute?.initializer || !ts.isStringLiteral(classAttribute.initializer)) {
      ts.forEachChild(node, visit);
      return;
    }
    if (!classAttribute.initializer.text.split(/\s+/).includes(className)) {
      ts.forEachChild(node, visit);
      return;
    }
    const disabled = attributes.find((attribute) => attribute.name.text === "disabled");
    if (disabled?.initializer) {
      expression = disabled.initializer.getText(sourceFile);
    }
  };
  visit(sourceFile);
  return expression;
}

test("아이 프로필 폼은 현재 가족·멤버 서버 snapshot을 seed한 뒤에만 수정·저장한다", () => {
  const { source, sourceFile } = parse("src/screens/feature/ProfileEdit.tsx");
  const sourceKey = variableInitializer(sourceFile, "profileSourceKey");
  const ready = variableInitializer(sourceFile, "profileFormReady");
  const hydrating = variableInitializer(sourceFile, "profileFormHydrating");
  const onSave = arrowBody(sourceFile, "onSave");

  assert.match(sourceKey ?? "", /familyId/);
  assert.match(sourceKey ?? "", /family\?\.familyId/);
  assert.match(sourceKey ?? "", /member\.id/);
  assert.match(sourceKey ?? "", /member\.name/);
  assert.match(sourceKey ?? "", /member\.birthdate/);
  assert.match(sourceKey ?? "", /member\.phone/);
  assert.match(ready ?? "", /hydratedProfileSourceKey === profileSourceKey/);
  assert.match(hydrating ?? "", /!profileFormReady/);
  assert.match(source, /setHydratedProfileSourceKey\(profileSourceKey\)/);
  assert.match(onSave ?? "", /if \(!profileFormReady\)/);
  assert.match(disabledExpressionForClass(sourceFile, "pe-photo") ?? "", /!profileFormReady/);
  assert.match(disabledExpressionForClass(sourceFile, "pe-save") ?? "", /!profileFormReady/);
});

test("전화번호 폼은 현재 user·family의 서버 phone을 seed한 뒤에만 저장한다", () => {
  const { source, sourceFile } = parse("src/screens/feature/PhoneSetup.tsx");
  const sourceKey = variableInitializer(sourceFile, "phoneSourceKey");
  const ready = variableInitializer(sourceFile, "phoneFormReady");
  const hydrating = variableInitializer(sourceFile, "phoneFormHydrating");
  const save = arrowBody(sourceFile, "save");

  assert.match(sourceKey ?? "", /familyId/);
  assert.match(sourceKey ?? "", /family\?\.familyId/);
  assert.match(sourceKey ?? "", /userId/);
  assert.match(sourceKey ?? "", /me\.id/);
  assert.match(sourceKey ?? "", /me\.phone/);
  assert.match(ready ?? "", /hydratedPhoneSourceKey === phoneSourceKey/);
  assert.match(hydrating ?? "", /!phoneFormReady/);
  assert.match(source, /setHydratedPhoneSourceKey\(phoneSourceKey\)/);
  assert.match(save ?? "", /if \(!phoneFormReady \|\| !me/);
  assert.match(disabledExpressionForClass(sourceFile, "psu-row__input") ?? "", /!phoneFormReady/);
  assert.match(disabledExpressionForClass(sourceFile, "psu-save") ?? "", /!phoneFormReady/);
});

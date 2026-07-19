import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import tsModule from "typescript";

const ts = tsModule.default ?? tsModule;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(root, "src/screens/onboarding/Onboarding.tsx");
const source = readFileSync(sourcePath, "utf8");
const sourceFile = ts.createSourceFile(
  sourcePath,
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

function findPermsStep() {
  let result = null;
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "PermsStep") {
      result = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return result;
}

function jsxAttribute(opening, name) {
  return opening.attributes.properties.find(
    (attribute) => ts.isJsxAttribute(attribute) && attribute.name.text === name,
  );
}

function jsxAttributeExpression(opening, name) {
  const attribute = jsxAttribute(opening, name);
  return attribute?.initializer && ts.isJsxExpression(attribute.initializer)
    ? attribute.initializer.expression?.getText(sourceFile) ?? null
    : null;
}

test("위치 권한 dialog는 열린 상태의 단계 전환마다 새 제목으로 포커스를 옮긴다", () => {
  const permsStep = findPermsStep();
  assert.ok(permsStep, "PermsStep을 찾을 수 없습니다");

  const headings = [];
  const stageEffects = [];
  const visit = (node) => {
    if (
      ts.isJsxElement(node)
      && node.openingElement.tagName.getText(sourceFile) === "h2"
      && jsxAttributeExpression(node.openingElement, "id") === "consentTitleId"
    ) {
      headings.push(node.openingElement);
    }
    if (
      ts.isCallExpression(node)
      && node.expression.getText(sourceFile) === "useEffect"
      && node.arguments.length >= 2
      && ts.isArrayLiteralExpression(node.arguments[1])
      && node.arguments[1].elements.some((element) => element.getText(sourceFile) === "locationStage")
    ) {
      stageEffects.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(permsStep);

  assert.equal(headings.length, 3, "권한 단계별 제목 전수 목록이 바뀌었습니다");
  const titleRefs = headings.map((heading) => jsxAttributeExpression(heading, "ref"));
  assert.ok(titleRefs.every(Boolean), "모든 단계 제목에 focus ref가 필요합니다");
  assert.equal(new Set(titleRefs).size, 1, "단계별 제목은 같은 focus ref를 사용해야 합니다");
  assert.ok(
    headings.every((heading) => jsxAttributeExpression(heading, "tabIndex") === "-1"),
    "단계 제목은 Tab 순서를 바꾸지 않으면서 프로그램적으로 포커스할 수 있어야 합니다",
  );

  const titleRef = titleRefs[0];
  assert.ok(
    stageEffects.some((effect) => {
      const effectText = effect.getText(sourceFile);
      return effectText.includes(`${titleRef}.current?.focus({ preventScroll: true })`)
        && effectText.includes("previousLocationStage")
        && effectText.includes('previousLocationStage === "idle"')
        && effectText.includes('locationStage === "idle"');
    }),
    "열린 dialog의 locationStage가 바뀌면 새 제목을 즉시 포커스해야 합니다",
  );
});

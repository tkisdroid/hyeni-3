import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = resolve(rootDir, "src");

function walkTsx(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walkTsx(path, out);
    else if (name.endsWith(".tsx")) out.push(path);
  }
  return out;
}

function attribute(opening, name) {
  return opening.attributes.properties.find(
    (property) => ts.isJsxAttribute(property) && property.name.text === name,
  );
}

function staticAttributeValue(opening, name) {
  const initializer = attribute(opening, name)?.initializer;
  return initializer && ts.isStringLiteral(initializer) ? initializer.text : null;
}

function isInsideLabel(node, sourceFile) {
  let parent = node.parent;
  while (parent && parent !== sourceFile) {
    if (ts.isJsxElement(parent) && parent.openingElement.tagName.getText(sourceFile) === "label") {
      return true;
    }
    parent = parent.parent;
  }
  return false;
}

function collectUnlabelledControls(path) {
  const source = readFileSync(path, "utf8");
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const labelTargets = new Set();
  const violations = [];

  function collectLabels(node) {
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(sourceFile) === "label") {
      const target = staticAttributeValue(node, "htmlFor");
      if (target) labelTargets.add(target);
    }
    node.forEachChild(collectLabels);
  }
  collectLabels(sourceFile);

  function inspect(node) {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const tag = node.tagName.getText(sourceFile);
      if (["input", "select", "textarea"].includes(tag)) {
        const type = staticAttributeValue(node, "type");
        const ignored = type === "hidden" || type === "file";
        const hasAriaName = Boolean(attribute(node, "aria-label") || attribute(node, "aria-labelledby"));
        const id = staticAttributeValue(node, "id");
        const hasLabelTarget = Boolean(id && labelTargets.has(id));
        if (!ignored && !hasAriaName && !hasLabelTarget && !isInsideLabel(node, sourceFile)) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
          violations.push(`${relative(rootDir, path)}:${line + 1} <${tag}>`);
        }
      }
    }
    node.forEachChild(inspect);
  }
  inspect(sourceFile);
  return violations;
}

test("모든 사용자 입력 컨트롤은 보조기기가 읽을 수 있는 명시적 이름을 가진다", () => {
  const violations = walkTsx(sourceDir).flatMap(collectUnlabelledControls).sort();
  assert.deepEqual(violations, [], `접근 가능한 이름이 없는 입력 컨트롤:\n${violations.join("\n")}`);
});

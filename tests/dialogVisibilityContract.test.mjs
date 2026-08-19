import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const ROOT = path.resolve(import.meta.dirname, "..");

const contracts = [
  {
    sourcePath: "src/screens/parent/ChildDetail.tsx",
    dialogRef: "deleteDialogRef",
    visibleFlag: "deleteDialogVisible",
    clauses: ["confirmDelete", "!detailError", "!detailLoading", "rawChild!==null"],
  },
  {
    sourcePath: "src/screens/parent/EventForm.tsx",
    dialogRef: "seriesScopeDialogRef",
    visibleFlag: "seriesScopeDialogVisible",
    clauses: ["seriesScopePrompt!==null", "eventFormDataReady", "children.length>0"],
  },
  {
    sourcePath: "src/screens/teacher/TeacherSettings.tsx",
    dialogRef: "deleteDialogRef",
    visibleFlag: "deleteDialogVisible",
    clauses: ["confirmDelete", 'teacherSettingsQueryState==="ready"', "!teacherSettingsDataMissing"],
  },
];

function parseSource(sourcePath) {
  const absolutePath = path.join(ROOT, sourcePath);
  return ts.createSourceFile(
    absolutePath,
    fs.readFileSync(absolutePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

function findVariable(sourceFile, variableName) {
  let declaration = null;
  walk(sourceFile, (node) => {
    if (
      declaration === null
      && ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === variableName
    ) {
      declaration = node;
    }
  });
  return declaration;
}

function normalizedText(node, sourceFile) {
  return node.getText(sourceFile).replace(/\s+/g, "");
}

function flattenAndClauses(expression) {
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    return [...flattenAndClauses(expression.left), ...flattenAndClauses(expression.right)];
  }
  return [expression];
}

function findLifecycleOpenExpression(sourceFile, dialogRef) {
  const declaration = findVariable(sourceFile, dialogRef);
  assert.ok(declaration?.initializer && ts.isCallExpression(declaration.initializer), `${dialogRef}: lifecycle 호출이 필요합니다`);
  assert.equal(declaration.initializer.expression.getText(sourceFile), "useDialogFocusLifecycle");

  const [options] = declaration.initializer.arguments;
  assert.ok(options && ts.isObjectLiteralExpression(options), `${dialogRef}: lifecycle 옵션이 필요합니다`);
  const openProperty = options.properties.find(
    (property) => ts.isPropertyAssignment(property) && property.name.getText(sourceFile) === "open",
  );
  assert.ok(openProperty && ts.isPropertyAssignment(openProperty), `${dialogRef}: open 옵션이 필요합니다`);
  return openProperty.initializer;
}

function findDialogRenderGuard(sourceFile, dialogRef) {
  let dialogNode = null;
  walk(sourceFile, (node) => {
    if (dialogNode !== null || !ts.isJsxOpeningElement(node)) return;
    const refAttribute = node.attributes.properties.find(
      (property) => ts.isJsxAttribute(property) && property.name.getText(sourceFile) === "ref",
    );
    if (
      refAttribute
      && ts.isJsxAttribute(refAttribute)
      && refAttribute.initializer
      && ts.isJsxExpression(refAttribute.initializer)
      && refAttribute.initializer.expression?.getText(sourceFile) === dialogRef
    ) {
      dialogNode = node;
    }
  });

  assert.ok(dialogNode, `${dialogRef}: dialog JSX를 찾을 수 없습니다`);
  let current = dialogNode;
  while (current.parent) {
    const parent = current.parent;
    if (
      ts.isBinaryExpression(parent)
      && parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
      && parent.right.getStart(sourceFile) <= dialogNode.getStart(sourceFile)
      && parent.right.getEnd() >= dialogNode.getEnd()
    ) {
      return parent.left;
    }
    current = parent;
  }
  assert.fail(`${dialogRef}: dialog JSX를 감싸는 && 가시성 조건이 필요합니다`);
}

test("query early-return 화면의 dialog lifecycle과 JSX는 같은 실제 가시성 조건을 사용한다", () => {
  for (const contract of contracts) {
    const sourceFile = parseSource(contract.sourcePath);
    const visibleDeclaration = findVariable(sourceFile, contract.visibleFlag);
    assert.ok(visibleDeclaration?.initializer, `${contract.sourcePath}: ${contract.visibleFlag}가 필요합니다`);

    const actualClauses = flattenAndClauses(visibleDeclaration.initializer)
      .map((clause) => normalizedText(clause, sourceFile))
      .sort();
    assert.deepEqual(actualClauses, [...contract.clauses].sort(), `${contract.sourcePath}: 실제 렌더 가능 조건이 모두 필요합니다`);

    const lifecycleOpen = findLifecycleOpenExpression(sourceFile, contract.dialogRef);
    assert.equal(normalizedText(lifecycleOpen, sourceFile), contract.visibleFlag, `${contract.sourcePath}: lifecycle open 불일치`);

    const renderGuard = findDialogRenderGuard(sourceFile, contract.dialogRef);
    assert.equal(normalizedText(renderGuard, sourceFile), contract.visibleFlag, `${contract.sourcePath}: JSX 가시성 조건 불일치`);
  }
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const locales = ["ko", "en", "ja", "zh-CN", "zh-TW", "vi", "th", "id", "ms", "fil"];

const childSurfaces = [
  "src/screens/child/AiFriendChat.tsx",
  "src/screens/child/AiFriendSetup.tsx",
  "src/screens/child/ChildHome.tsx",
  "src/screens/child/ChildLocationStatus.tsx",
  "src/screens/child/ChildSettings.tsx",
  "src/screens/child/ChildSos.tsx",
  "src/screens/child/ChildTimetable.tsx",
  "src/screens/child/StickerBook.tsx",
  "src/screens/child/overlays/CallSheet.tsx",
  "src/screens/child/overlays/Celebrate.tsx",
  "src/screens/child/overlays/ChildSheet.tsx",
  "src/screens/child/overlays/DaySheet.tsx",
  "src/screens/child/overlays/PlaydateSheet.tsx",
  "src/screens/child/overlays/RouteSheet.tsx",
  "src/screens/child/overlays/StickerDetail.tsx",
];

const catalogAwareContainers = new Set(["formatMessage", "FormattedMessage"]);
const userFacingJsxAttributes = new Set([
  "aria-label", "alt", "description", "heading", "label", "placeholder", "retryLabel",
  "screenTitle", "title",
]);
const userFacingPropertyNames = new Set([
  "badge", "description", "detail", "empty", "eyebrow", "label", "message", "placeholder",
  "subtitle", "text", "title",
]);

const literalAllowlist = [
  {
    path: "src/screens/child/StickerBook.tsx",
    context: "jsx-text",
    value: "NEW",
  },
  {
    path: "src/screens/child/ChildSettings.tsx",
    context: "return:connectionLabel",
    value: "connected",
  },
  {
    path: "src/screens/child/ChildSettings.tsx",
    context: "return:connectionLabel",
    value: "pending",
  },
];

function sourceFile(path) {
  const source = readFileSync(resolve(rootDir, path), "utf8");
  return {
    source,
    file: ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
  };
}

function insideCatalogCall(node) {
  let current = node.parent;
  while (current) {
    if (ts.isCallExpression(current)) {
      const expression = current.expression;
      if (
        (ts.isIdentifier(expression) && catalogAwareContainers.has(expression.text))
        || (ts.isPropertyAccessExpression(expression) && expression.name.text === "formatMessage")
      ) return true;
    }
    if (ts.isStatement(current)) break;
    current = current.parent;
  }
  return false;
}

function enclosingFunctionName(node) {
  let current = node.parent;
  while (current) {
    if (ts.isFunctionDeclaration(current) && current.name) return current.name.text;
    if (
      (ts.isArrowFunction(current) || ts.isFunctionExpression(current))
      && ts.isVariableDeclaration(current.parent)
      && ts.isIdentifier(current.parent.name)
    ) return current.parent.name.text;
    current = current.parent;
  }
  return null;
}

function displayWrapperParent(node) {
  const parent = node.parent;
  if (!parent) return null;
  if (
    (ts.isParenthesizedExpression(parent) && parent.expression === node)
    || (ts.isJsxExpression(parent) && parent.expression === node)
    || (ts.isAsExpression(parent) && parent.expression === node)
    || (ts.isNonNullExpression(parent) && parent.expression === node)
  ) return parent;
  if (ts.isConditionalExpression(parent) && (parent.whenTrue === node || parent.whenFalse === node)) return parent;
  if (
    ts.isBinaryExpression(parent)
    && [
      ts.SyntaxKind.AmpersandAmpersandToken,
      ts.SyntaxKind.BarBarToken,
      ts.SyntaxKind.QuestionQuestionToken,
      ts.SyntaxKind.PlusToken,
    ].includes(parent.operatorToken.kind)
    && (parent.left === node || parent.right === node)
  ) return parent;
  return null;
}

function userFacingContext(node, text) {
  if (insideCatalogCall(node) || !/[\p{L}\p{N}]/u.test(text)) return null;
  if (/^(?:child|shared|notifications)\.[A-Za-z0-9_.${}-]+$/.test(text)) return null;
  if (ts.isJsxText(node)) return "jsx-text";
  let current = node;
  let wrapper = displayWrapperParent(current);
  while (wrapper) {
    current = wrapper;
    wrapper = displayWrapperParent(current);
  }
  const parent = current.parent;
  if (ts.isJsxAttribute(parent)) {
    const name = parent.name.getText();
    return userFacingJsxAttributes.has(name) ? `jsx-attribute:${name}` : null;
  }
  if (ts.isJsxExpression(current) && (ts.isJsxElement(parent) || ts.isJsxFragment(parent))) return "jsx-expression";
  if (ts.isCallExpression(parent)) {
    const callee = parent.expression.getText();
    if (/^(?:show|toast|setError|alert|confirm)$/.test(callee) && parent.arguments[0] === current) {
      return `call:${callee}:argument:0`;
    }
  }
  if (ts.isPropertyAssignment(parent)) {
    const name = ts.isIdentifier(parent.name) || ts.isStringLiteral(parent.name) ? parent.name.text : null;
    if (name && userFacingPropertyNames.has(name)) return `property:${name}`;
  }
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    if (/(?:label|message|placeholder|subtitle|text|title)$/i.test(parent.name.text)) {
      return `variable:${parent.name.text}`;
    }
  }
  const functionName = enclosingFunctionName(node);
  if (functionName && /(?:label|copy|description|message|placeholder|text|title|view)$/i.test(functionName)) {
    current = node;
    while (current.parent && !ts.isReturnStatement(current.parent)) current = current.parent;
    if (current.parent && ts.isReturnStatement(current.parent)) return `return:${functionName}`;
  }
  return null;
}

function literalCandidatesFromSource(path, source) {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const candidates = [];
  const visit = (node) => {
    if (ts.isTemplateExpression(node)) {
      const text = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(" ").trim();
      const context = userFacingContext(node, text);
      if (context) candidates.push({
        path,
        line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
        context,
        text,
      });
    } else if (ts.isStringLiteralLike(node) || ts.isJsxText(node)) {
      const text = ts.isJsxText(node) ? node.text.trim() : node.text;
      const context = userFacingContext(node, text);
      if (context) candidates.push({
        path,
        line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
        context,
        text,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return candidates;
}

function firstLiteralViolation(path) {
  const { source } = sourceFile(path);
  const violation = literalCandidatesFromSource(path, source).find(({ context, text }) => !literalAllowlist.some((entry) => (
    entry.path === path && entry.context === context && entry.value === text
  )));
  return {
    source,
    violation: violation
      ? `${path}:${violation.line} [${violation.context}]: ${violation.text.replace(/\s+/g, " ")}`
      : null,
  };
}

test("Task 8의 child 8개와 overlay 7개는 파일별 사용자 문구를 카탈로그로 이관한다", () => {
  const failures = [];
  for (const path of childSurfaces) {
    const { source, violation } = firstLiteralViolation(path);
    if (!/(?:useIntl|FormattedMessage|IntlShape|withDefaultIntl)/.test(source)) {
      failures.push(`${path}: React Intl 문구 배선이 없습니다`);
    }
    if (violation) failures.push(violation);
  }
  assert.deepEqual(failures, []);
});

test("한국어 아이 핵심 문구는 친근한 반말과 3초 SOS 안전 동선을 유지한다", () => {
  const child = JSON.parse(readFileSync(resolve(rootDir, "locales/ko/child.json"), "utf8"));
  assert.equal(child["child.settings.title"], "내 설정");
  assert.equal(child["child.sos.holdInstruction"], "3초 동안 꾹 눌러");
  assert.equal(child["child.sos.sent"], "부모님께 긴급 알림을 보냈어");
  assert.equal(child["child.ai.emptyResponse"], "지금은 대답을 못 받았어. 잠시 뒤에 다시 말 걸어줘!");
});

test("아이 화면은 AI 답변·메모·이름을 번역 함수에 넣지 않고 SOS pointer capture를 유지한다", () => {
  const chat = sourceFile("src/screens/child/AiFriendChat.tsx").source;
  const home = sourceFile("src/screens/child/ChildHome.tsx").source;
  const sos = sourceFile("src/screens/child/ChildSos.tsx").source;
  assert.doesNotMatch(chat, /formatMessage\([^)]*,\s*\{[^}]*(?:reply|content|message)/s);
  assert.doesNotMatch(
    home,
    /formatMessage\(\s*(?:parentNote|childName|target\.label|aiFriendDisplayName|newestSlot\.label)/,
  );
  assert.match(sos, /setPointerCapture/);
  assert.match(sos, /releasePointerCapture/);
  assert.match(sos, /3000/);
});

test("10개 locale의 child namespace는 같은 실제 메시지 ID와 비어 있지 않은 번역을 제공한다", () => {
  const source = JSON.parse(readFileSync(resolve(rootDir, "locales/ko/child.json"), "utf8"));
  assert.ok(Object.keys(source).length > 0, "child: 한국어 카탈로그가 비었습니다");
  for (const locale of locales) {
    const catalog = JSON.parse(readFileSync(resolve(rootDir, `locales/${locale}/child.json`), "utf8"));
    assert.deepEqual(Object.keys(catalog).sort(), Object.keys(source).sort(), `${locale}/child`);
    for (const [id, value] of Object.entries(catalog)) {
      assert.equal(typeof value, "string", `${locale}:${id}`);
      assert.ok(value.trim().length > 0, `${locale}:${id}: 빈 번역`);
      if (locale !== "ko") assert.doesNotMatch(value, /혜니캘린더/, `${locale}:${id}: 비한국어 브랜드`);
    }
  }
});

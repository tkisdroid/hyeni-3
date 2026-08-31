import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const parentScreens = [
  "src/screens/parent/ParentHome.tsx",
  "src/screens/parent/ParentSettings.tsx",
  "src/screens/parent/ParentAccount.tsx",
  "src/screens/parent/ParentCalendar.tsx",
  "src/screens/parent/EventForm.tsx",
  "src/screens/parent/ParentLocation.tsx",
  "src/screens/parent/ChildDetail.tsx",
  "src/screens/parent/ParentFamily.tsx",
  "src/screens/shared/MemoChat.tsx",
  "src/screens/parent/SocialLinks.tsx",
];

const parentComponents = [
  "src/maps/providers/kakao/KakaoMapAdapter.tsx",
  "src/components/MapPickerSheet.tsx",
  "src/components/MessageSafetyDialog.tsx",
  "src/components/PremiumUpsell.tsx",
  "src/components/ReferralRewardPanel.tsx",
];

const parentTransforms = [
  "src/transform/adventureMap.ts",
  "src/transform/eventScope.ts",
  "src/transform/familyView.ts",
  "src/transform/locationTrustCopy.ts",
  "src/transform/locationView.ts",
  "src/transform/memoChatCopy.ts",
  "src/transform/memoQuickReplies.ts",
  "src/transform/notificationsView.ts",
  "src/transform/placeVisual.ts",
  "src/transform/premiumUpsell.ts",
  "src/transform/scheduleView.ts",
  "src/transform/tierPolicy.ts",
];

// Task 7 화면에서 familyView를 거쳐 실제 표시되는 전이 formatter도 수동 인벤토리에 포함한다.
const parentTransitFormatters = [
  "src/transform/deviceNotificationHealth.ts",
  "src/transform/deviceUnlock.ts",
  "src/transform/deviceAppUsageView.ts",
];

const parentSurfaces = [
  ...parentScreens,
  ...parentComponents,
  ...parentTransforms,
  ...parentTransitFormatters,
];

const catalogAwareContainers = new Set([
  "formatMessage",
  "FormattedMessage",
]);

const userFacingJsxAttributes = new Set([
  "aria-label",
  "alt",
  "description",
  "heading",
  "label",
  "placeholder",
  "retryLabel",
  "screenTitle",
  "title",
]);

const userFacingPropertyNames = new Set([
  "badge",
  "description",
  "detail",
  "empty",
  "eyebrow",
  "label",
  "message",
  "placeholder",
  "subtitle",
  "text",
  "title",
]);

// locale-neutral 사용자 표면만 파일+AST 문맥+값으로 좁게 허용한다. 각 예외는 실제 사용자 의미를 설명한다.
const literalAllowlist = [
  {
    path: "src/screens/parent/ParentHome.tsx",
    context: "jsx-expression",
    value: "99+",
    reason: "알림 바로가기의 실제 미읽음 개수를 99에서 제한해 표시하는 locale-neutral 숫자 상한입니다.",
  },
  {
    path: "src/components/MessageSafetyDialog.tsx",
    context: "jsx-text",
    value: "/500",
    reason: "상세 신고 입력의 고정 최대 글자 수를 현재 길이 뒤에 표시하는 locale-neutral 카운터입니다.",
  },
  ...["Wi-Fi", "2G", "3G", "4G", "5G"].map((value) => ({
    path: "src/transform/familyView.ts",
    context: "return:networkTypeLabel",
    value,
    reason: "Android 기기 보고의 국제 표준 네트워크 세대 표기이며 번역하지 않습니다.",
  })),
];

function sourceFile(path) {
  const source = readFileSync(resolve(rootDir, path), "utf8");
  return {
    source,
    file: ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      true,
      path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    ),
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
      ) {
        return true;
      }
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
    ) {
      return current.parent.name.text;
    }
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
    || (ts.isTypeAssertionExpression(parent) && parent.expression === node)
    || (ts.isNonNullExpression(parent) && parent.expression === node)
  ) {
    return parent;
  }
  if (
    ts.isConditionalExpression(parent)
    && (parent.whenTrue === node || parent.whenFalse === node)
  ) {
    return parent;
  }
  if (
    ts.isBinaryExpression(parent)
    && [
      ts.SyntaxKind.AmpersandAmpersandToken,
      ts.SyntaxKind.BarBarToken,
      ts.SyntaxKind.QuestionQuestionToken,
      ts.SyntaxKind.PlusToken,
    ].includes(parent.operatorToken.kind)
    && (parent.left === node || parent.right === node)
  ) {
    return parent;
  }
  return null;
}

function userFacingContext(node, text) {
  if (insideCatalogCall(node) || !/[\p{L}\p{N}]/u.test(text)) return null;
  if (/^(?:parent|shared|notifications)\.[A-Za-z0-9_.${}-]+$/.test(text)) return null;

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
  if (
    ts.isJsxExpression(current)
    && (ts.isJsxElement(parent) || ts.isJsxFragment(parent))
  ) {
    return "jsx-expression";
  }
  if (ts.isCallExpression(parent)) {
    const callee = parent.expression.getText();
    if (/^(?:show|toast|setError|alert|confirm)$/.test(callee) && parent.arguments[0] === current) {
      return `call:${callee}:argument:0`;
    }
  }
  if (ts.isPropertyAssignment(parent)) {
    const name = ts.isIdentifier(parent.name) || ts.isStringLiteral(parent.name) ? parent.name.text : null;
    if (name && userFacingPropertyNames.has(name)) {
      return `property:${name}`;
    }
  }
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    if (/(?:label|message|placeholder|subtitle|text|title)$/i.test(parent.name.text)) {
      return `variable:${parent.name.text}`;
    }
  }
  const functionName = enclosingFunctionName(node);
  if (functionName && /(?:label|copy|description|message|placeholder|text|title|view)$/i.test(functionName)) {
    current = node;
    let eligible = true;
    while (current.parent && !ts.isReturnStatement(current.parent)) {
      current = current.parent;
      if (
        ts.isCallExpression(current)
        || ts.isPropertyAssignment(current)
        || (ts.isBinaryExpression(current) && ![
          ts.SyntaxKind.BarBarToken,
          ts.SyntaxKind.QuestionQuestionToken,
          ts.SyntaxKind.PlusToken,
        ].includes(current.operatorToken.kind))
      ) {
        eligible = false;
        break;
      }
    }
    if (eligible && current.parent && ts.isReturnStatement(current.parent)) return `return:${functionName}`;
  }
  return null;
}

function allowlistedLiteral(path, context, text) {
  return literalAllowlist.find((entry) => (
    entry.path === path && entry.context === context && entry.value === text
  )) ?? null;
}

function literalCandidatesFromSource(path, source) {
  const file = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const candidates = [];
  const visit = (node) => {
    if (ts.isTemplateExpression(node)) {
      const text = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)]
        .join(" ")
        .trim();
      const context = userFacingContext(node, text);
      if (context) {
        const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
        candidates.push({ path, line, context, text });
      }
    } else if (ts.isStringLiteralLike(node) || ts.isJsxText(node)) {
      const text = ts.isJsxText(node) ? node.text.trim() : node.text;
      const context = userFacingContext(node, text);
      if (context) {
        const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
        candidates.push({ path, line, context, text });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return candidates;
}

function firstLiteralViolationFromSource(path, source) {
  const violation = literalCandidatesFromSource(path, source)
    .find(({ context, text }) => !allowlistedLiteral(path, context, text));
  return violation
    ? `${path}:${violation.line} [${violation.context}]: ${violation.text.replace(/\s+/g, " ")}`
    : null;
}

function firstLiteralViolation(path) {
  const { source } = sourceFile(path);
  return { source, violation: firstLiteralViolationFromSource(path, source) };
}

test("사용자 노출 AST 문맥은 한글이 없어도 영어와 숫자-only literal을 탐지한다", () => {
  assert.match(
    firstLiteralViolationFromSource("fixture.tsx", 'export const View = () => <button aria-label="Open details" />;') ?? "",
    /Open details/,
  );
  assert.match(
    firstLiteralViolationFromSource("fixture.tsx", 'export const View = () => <input placeholder="010-0000-0000" />;') ?? "",
    /010-0000-0000/,
  );
});

test("사용자 노출 AST 문맥은 JSX와 표시 함수 안의 조건식 wrapper를 거슬러 탐지한다", () => {
  assert.match(
    firstLiteralViolationFromSource(
      "fixture.tsx",
      'export const View = ({ condition, value }) => <span>{condition ? "99+" : value}</span>;',
    ) ?? "",
    /\[jsx-expression\]: 99\+/,
  );
  assert.match(
    firstLiteralViolationFromSource(
      "fixture.ts",
      'export const save = (condition) => show(condition ? "Failed" : "Saved");',
    ) ?? "",
    /\[call:show:argument:0\]: Failed/,
  );
  assert.match(
    firstLiteralViolationFromSource(
      "fixture.tsx",
      'export const View = ({ condition }) => <button title={condition && ("Open details")} />;',
    ) ?? "",
    /\[jsx-attribute:title\]: Open details/,
  );
  assert.match(
    firstLiteralViolationFromSource(
      "fixture.ts",
      'export const save = (condition) => toast(condition || "Saved");',
    ) ?? "",
    /\[call:toast:argument:0\]: Saved/,
  );
  assert.match(
    firstLiteralViolationFromSource(
      "fixture.ts",
      'export const view = (condition) => ({ label: condition ? "Ready" : "Waiting" });',
    ) ?? "",
    /\[property:label\]: Ready/,
  );
});

test("사용자 literal exact allowlist는 파일·문맥·값·근거가 모두 있고 실제 사용된다", () => {
  for (const entry of literalAllowlist) {
    assert.ok(entry.reason.length >= 12, `${entry.path}:${entry.value}: 예외 근거가 필요합니다`);
    const source = sourceFile(entry.path).source;
    const used = literalCandidatesFromSource(entry.path, source).some((candidate) => (
      candidate.context === entry.context && candidate.text === entry.value
    ));
    assert.equal(used, true, `${entry.path} [${entry.context}] ${entry.value}: 미사용 allowlist`);
  }
});

test("Task 7의 10개 화면·5개 컴포넌트·12개 transform·전이 formatter는 사용자 문구를 카탈로그로 이관한다", () => {
  const failures = [];
  for (const path of parentSurfaces) {
    const { source, violation } = firstLiteralViolation(path);
    if (!/(?:useIntl|FormattedMessage|IntlShape|withDefaultIntl)/.test(source)) {
      failures.push(`${path}: React Intl 문구 배선이 없습니다`);
    }
    if (violation) failures.push(violation);
  }
  assert.deepEqual(failures, []);
});

test("부모 계정 전화번호는 KR-only placeholder와 locale 한계 안내를 사용한다", () => {
  const account = sourceFile("src/screens/parent/ParentAccount.tsx").source;
  assert.match(account, /placeholder=\{intl\.formatMessage\(\{ id: "parent\.parentAccount\.phonePlaceholder" \}\)\}/);
  assert.match(account, /intl\.formatMessage\(\{ id: "parent\.parentAccount\.phoneKoreanOnlyHelp" \}\)/);
  for (const locale of ["ko", "en", "ja", "zh-CN", "zh-TW", "vi", "th", "id", "ms", "fil"]) {
    const parent = JSON.parse(readFileSync(resolve(rootDir, `locales/${locale}/parent.json`), "utf8"));
    assert.equal(
      parent["parent.parentAccount.phonePlaceholder"],
      "010-0000-0000",
      `${locale}: 전화번호 placeholder`,
    );
    assert.equal(typeof parent["parent.parentAccount.phoneKoreanOnlyHelp"], "string", `${locale}: 전화번호 한계 안내`);
    assert.ok(parent["parent.parentAccount.phoneKoreanOnlyHelp"].trim().length > 0, `${locale}: 전화번호 한계 안내가 비었습니다`);
  }
});

test("부모·공용 문구 namespace는 10개 locale에서 같은 비어 있지 않은 ID를 제공한다", () => {
  const locales = ["ko", "en", "ja", "zh-CN", "zh-TW", "vi", "th", "id", "ms", "fil"];
  for (const namespace of ["parent", "shared", "notifications"]) {
    const source = JSON.parse(readFileSync(resolve(rootDir, `locales/ko/${namespace}.json`), "utf8"));
    assert.ok(Object.keys(source).length > 0, `${namespace}: 한국어 카탈로그가 비었습니다`);
    for (const locale of locales) {
      const catalog = JSON.parse(readFileSync(resolve(rootDir, `locales/${locale}/${namespace}.json`), "utf8"));
      assert.deepEqual(Object.keys(catalog).sort(), Object.keys(source).sort(), `${locale}/${namespace}`);
      for (const [id, value] of Object.entries(catalog)) {
        assert.equal(typeof value, "string", `${locale}:${id}`);
        assert.ok(value.trim().length > 0, `${locale}:${id}: 빈 번역`);
      }
    }
  }
});

test("부모 화면 이관은 활성 아이·member id·메모 thread 불변식을 유지한다", () => {
  const home = sourceFile("src/screens/parent/ParentHome.tsx").source;
  const detail = sourceFile("src/screens/parent/ChildDetail.tsx").source;
  const memo = sourceFile("src/screens/shared/MemoChat.tsx").source;
  const eventForm = sourceFile("src/screens/parent/EventForm.tsx").source;

  assert.match(home, /useActiveChild\(\)/);
  assert.match(detail, /const childId = \(routeLocation\.state[\s\S]*if \(childId\) return children\.find[\s\S]*return activeChild/);
  assert.doesNotMatch(detail, /children\s*\[\s*0\s*\]/);
  assert.match(eventForm, /activeChildId/);
  assert.match(memo, /useMemoThread\(dateKeys,\s*scopeChild\?\.id \?\? null\)/);
  assert.match(memo, /childId:\s*scopeChild\.id/);
});

test("사용자 문구가 없는 정책 transform은 번역 대상에서 제외한 근거가 있다", () => {
  const policyOnlyTransforms = [
    "src/transform/oauthProvider.ts",
    "src/transform/secondChildGate.ts",
  ];

  for (const path of policyOnlyTransforms) {
    const { file } = sourceFile(path);
    const koreanLiterals = [];
    const visit = (node) => {
      if (ts.isStringLiteralLike(node) && /[가-힣]/.test(node.text)) {
        const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
        koreanLiterals.push(`${path}:${line}: ${node.text}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
    assert.deepEqual(
      koreanLiterals,
      [],
      `${path}는 provider/path 또는 수치·status 정책만 다루므로 사용자 번역 문구가 없어야 합니다`,
    );
  }
});

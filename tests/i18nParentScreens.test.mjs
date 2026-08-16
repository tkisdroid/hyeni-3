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
  "src/components/KakaoMap.tsx",
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

function userFacingLiteral(node, text) {
  if (!/[가-힣]/.test(text) || insideCatalogCall(node)) return null;

  // 템플릿은 변수 선언·toast·aria 어디에 있든 번역 누락이 되기 쉬워 모두 사용자 문구로 본다.
  if (ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node)) return text;

  if (ts.isJsxText(node)) return text;
  const parent = node.parent;
  if (ts.isJsxAttribute(parent)) {
    return [
      "aria-label",
      "alt",
      "description",
      "heading",
      "label",
      "placeholder",
      "retryLabel",
      "screenTitle",
      "title",
    ].includes(parent.name.getText())
      ? text
      : null;
  }
  if (ts.isCallExpression(parent)) {
    const callee = parent.expression.getText();
    if (/^(?:show|setError|alert|confirm)$/.test(callee)) return text;
  }
  if (ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) {
    if (/^(?:badge|description|detail|empty|eyebrow|label|message|placeholder|subtitle|title)$/.test(parent.name.text)) {
      return text;
    }
  }
  if (
    ts.isConditionalExpression(parent)
    || ts.isReturnStatement(parent)
    || (ts.isBinaryExpression(parent) && [
      ts.SyntaxKind.BarBarToken,
      ts.SyntaxKind.QuestionQuestionToken,
      ts.SyntaxKind.PlusToken,
    ].includes(parent.operatorToken.kind))
    || ts.isTemplateExpression(parent)
  ) {
    return text;
  }
  return null;
}

function firstLiteralViolation(path) {
  const { source, file } = sourceFile(path);
  let violation = null;
  const visit = (node) => {
    if (violation) return;
    if (ts.isTemplateExpression(node)) {
      const text = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)]
        .join(" ")
        .trim();
      const exposed = userFacingLiteral(node, text);
      if (exposed) {
        const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
        violation = `${path}:${line}: ${exposed.replace(/\s+/g, " ")}`;
        return;
      }
    } else if (ts.isStringLiteralLike(node) || ts.isJsxText(node)) {
      const text = ts.isJsxText(node) ? node.text.trim() : node.text;
      const exposed = userFacingLiteral(node, text);
      if (exposed) {
        const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
        violation = `${path}:${line}: ${exposed.replace(/\s+/g, " ")}`;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { source, violation };
}

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

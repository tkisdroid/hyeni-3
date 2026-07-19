/**
 * 아이콘·이미지 일관성 가드 (2026-07-14 전수조사).
 *
 * 규칙:
 *  1. 진한 선(line) 스타일 플랫 SVG(ui/icon-*.svg)를 화면에 다시 들여오지 않는다.
 *     - 기능 타일/칩/히어로 = 소프트 3D webp(menu-*, place-*, *-3d 등)
 *     - 텍스트 행 인라인/유틸리티 = lucide-react
 *  2. 안전지표(부모 홈·안심리포트)는 배터리와 같은 3D webp 언어로 4칸 전부 통일한다.
 *  3. 전용 아이콘 슬롯(칩·배지·행 아이콘)에 원시 유니코드 이모지를 쓰지 않는다.
 *     (문장 안 이모지·토스트 장식·아이 SOS 감정 표현은 별개 규칙으로 허용)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readSource(relativePath) {
  return readFileSync(resolve(rootDir, relativePath), "utf8");
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|css)$/.test(name)) out.push(full);
  }
  return out;
}

const emojiPattern = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

function parseTsx(source, file = "fixture.tsx") {
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function visit(node, callback) {
  callback(node);
  node.forEachChild((child) => visit(child, callback));
}

function jsxOpening(node) {
  if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) return node;
  return null;
}

function attributeByName(opening, name) {
  return opening.attributes.properties.find(
    (property) => ts.isJsxAttribute(property) && property.name.text === name,
  );
}

function numericJsxAttribute(opening, name) {
  const attribute = attributeByName(opening, name);
  if (!attribute) return { kind: "missing" };
  const initializer = attribute.initializer;
  if (
    !initializer ||
    !ts.isJsxExpression(initializer) ||
    !initializer.expression ||
    !ts.isNumericLiteral(initializer.expression)
  ) {
    return { kind: "non-literal" };
  }
  return { kind: "literal", value: Number(initializer.expression.text) };
}

function importedLucideBindings(sourceFile) {
  const values = new Set();
  const types = new Set();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "lucide-react"
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      (element.isTypeOnly ? types : values).add(element.name.text);
    }
  }
  return { values, types };
}

function propertyNameText(node) {
  if (!node) return null;
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  return null;
}

function expressionResolvesToLucide(expression, lucideBindings, lucideIconProperties) {
  if (!expression) return false;
  if (ts.isIdentifier(expression)) return lucideBindings.has(expression.text);
  if (ts.isParenthesizedExpression(expression)) {
    return expressionResolvesToLucide(expression.expression, lucideBindings, lucideIconProperties);
  }
  if (ts.isConditionalExpression(expression)) {
    return (
      expressionResolvesToLucide(expression.whenTrue, lucideBindings, lucideIconProperties) &&
      expressionResolvesToLucide(expression.whenFalse, lucideBindings, lucideIconProperties)
    );
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return lucideIconProperties.has(expression.name.text);
  }
  if (ts.isElementAccessExpression(expression) && ts.isStringLiteral(expression.argumentExpression)) {
    return lucideIconProperties.has(expression.argumentExpression.text);
  }
  return false;
}

function collectLucideElements(source, file) {
  const sourceFile = parseTsx(source, file);
  const imported = importedLucideBindings(sourceFile);
  const lucideBindings = new Set(imported.values);
  const lucideIconProperties = new Set();

  visit(sourceFile, (node) => {
    if (
      ts.isPropertySignature(node) &&
      propertyNameText(node.name) &&
      node.type &&
      ts.isTypeReferenceNode(node.type) &&
      ts.isIdentifier(node.type.typeName) &&
      imported.types.has(node.type.typeName.text)
    ) {
      lucideIconProperties.add(propertyNameText(node.name));
    }
    if (
      ts.isPropertyAssignment(node) &&
      propertyNameText(node.name) &&
      expressionResolvesToLucide(node.initializer, lucideBindings, lucideIconProperties)
    ) {
      lucideIconProperties.add(propertyNameText(node.name));
    }
  });

  let changed = true;
  while (changed) {
    changed = false;
    visit(sourceFile, (node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        !lucideBindings.has(node.name.text) &&
        expressionResolvesToLucide(node.initializer, lucideBindings, lucideIconProperties)
      ) {
        lucideBindings.add(node.name.text);
        changed = true;
      }
    });
  }

  const elements = [];
  visit(sourceFile, (node) => {
    const opening = jsxOpening(node);
    if (!opening || !ts.isIdentifier(opening.tagName) || !lucideBindings.has(opening.tagName.text)) return;
    elements.push({
      file,
      component: opening.tagName.text,
      size: numericJsxAttribute(opening, "size"),
      strokeWidth: numericJsxAttribute(opening, "strokeWidth"),
    });
  });
  return elements;
}

function lucideElementDiagnostic(element) {
  if (element.size.kind !== "literal") {
    return `${element.file}|${element.component}|size:${element.size.kind}`;
  }
  if (element.strokeWidth.kind !== "literal") {
    return `${element.file}|${element.component}|strokeWidth:${element.strokeWidth.kind}`;
  }
  return `${element.file}|${element.component}|${element.size.value}|${element.strokeWidth.value}`;
}

function staticExpressionText(expression) {
  if (!expression) return "";
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text;
  if (ts.isTemplateExpression(expression)) {
    return [expression.head.text, ...expression.templateSpans.map((span) => span.literal.text)].join(" ");
  }
  if (ts.isParenthesizedExpression(expression)) return staticExpressionText(expression.expression);
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return `${staticExpressionText(expression.left)} ${staticExpressionText(expression.right)}`;
  }
  if (ts.isConditionalExpression(expression)) {
    return `${staticExpressionText(expression.whenTrue)} ${staticExpressionText(expression.whenFalse)}`;
  }
  return "";
}

function staticClassTokens(opening) {
  const attribute = attributeByName(opening, "className");
  if (!attribute?.initializer) return new Set();
  const text = ts.isStringLiteral(attribute.initializer)
    ? attribute.initializer.text
    : ts.isJsxExpression(attribute.initializer)
      ? staticExpressionText(attribute.initializer.expression)
      : "";
  return new Set(text.split(/\s+/).filter(Boolean));
}

function jsxTextContainsEmoji(text) {
  if (emojiPattern.test(text)) return true;
  const decodedNumericEntities = text.replace(
    /&#(?:x([0-9a-f]+)|([0-9]+));/gi,
    (entity, hexValue, decimalValue) => {
      const codePoint = Number.parseInt(hexValue ?? decimalValue, hexValue ? 16 : 10);
      if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return entity;
      return String.fromCodePoint(codePoint);
    },
  );
  return emojiPattern.test(decodedNumericEntities);
}

function expressionContainsEmoji(expression) {
  if (!expression) return false;
  if (ts.isJsxText(expression)) return jsxTextContainsEmoji(expression.text);
  if (ts.isJsxElement(expression) || ts.isJsxFragment(expression)) {
    return jsxChildrenContainEmoji(expression);
  }
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return emojiPattern.test(expression.text);
  }
  if (ts.isTemplateExpression(expression)) {
    return (
      emojiPattern.test(expression.head.text) ||
      expression.templateSpans.some(
        (span) => emojiPattern.test(span.literal.text) || expressionContainsEmoji(span.expression),
      )
    );
  }
  let found = false;
  expression.forEachChild((child) => {
    if (!found && expressionContainsEmoji(child)) found = true;
  });
  return found;
}

function jsxChildrenContainEmoji(node) {
  const children = ts.isJsxElement(node) || ts.isJsxFragment(node) ? node.children : [];
  return children.some((child) => {
    if (ts.isJsxText(child)) return jsxTextContainsEmoji(child.text);
    if (ts.isJsxExpression(child)) return expressionContainsEmoji(child.expression);
    if (ts.isJsxElement(child) || ts.isJsxFragment(child)) return jsxChildrenContainEmoji(child);
    return false;
  });
}

const dedicatedSlotClasses = new Set([
  "ac-note__emoji",
  "ac-auto__icon",
  "ais-hint__ico",
  "ais-reslabel__badge",
  "mc-loc-ic",
  "sb-slot__lock",
  "qrs-title",
  "ts-hint__ico",
  "tt-note__ico",
  "ob-teacher-note__ic",
  "ob-qr-cta",
  "fp-setting__icon",
  "fp-connected__badge",
  "fp-waiting",
  "fp-cta",
  "rr-modal-emoji",
  "pl-scrub__legend",
]);

function collectDedicatedSlotEmojiViolations(source, file = "fixture.tsx") {
  const sourceFile = parseTsx(source, file);
  const violations = new Set();
  visit(sourceFile, (node) => {
    if (!ts.isJsxElement(node)) return;
    const tokens = staticClassTokens(node.openingElement);
    for (const token of tokens) {
      if (dedicatedSlotClasses.has(token) && jsxChildrenContainEmoji(node)) violations.add(token);
    }
  });
  return [...violations].sort();
}

function collectIconPropertyEmojiViolations(source, file) {
  const sourceFile = parseTsx(source, file);
  const violations = [];
  visit(sourceFile, (node) => {
    if (
      ts.isPropertyAssignment(node) &&
      propertyNameText(node.name) === "icon" &&
      expressionContainsEmoji(node.initializer)
    ) {
      violations.push(`${file}|icon-property`);
    }
  });
  return violations;
}

function collectHomePlaceEmojiViolations(source, file) {
  const sourceFile = parseTsx(source, file);
  const violations = [];
  visit(sourceFile, (node) => {
    if (
      ts.isConditionalExpression(node) &&
      node.condition.getText(sourceFile).includes("is_home") &&
      (expressionContainsEmoji(node.whenTrue) || expressionContainsEmoji(node.whenFalse))
    ) {
      violations.push(`${file}|is_home-conditional`);
    }
  });
  return violations;
}

function collectJsxTagOccurrences(source, file, tagName) {
  const sourceFile = parseTsx(source, file);
  const occurrences = [];
  visit(sourceFile, (node) => {
    const opening = jsxOpening(node);
    if (opening && ts.isIdentifier(opening.tagName) && opening.tagName.text === tagName) {
      occurrences.push(opening);
    }
  });
  return occurrences;
}

function ariaHiddenIsTrue(opening) {
  const attribute = attributeByName(opening, "aria-hidden");
  const initializer = attribute?.initializer;
  if (!initializer) return false;
  if (ts.isStringLiteral(initializer)) return initializer.text === "true";
  return (
    ts.isJsxExpression(initializer) &&
    !!initializer.expression &&
    (initializer.expression.kind === ts.SyntaxKind.TrueKeyword ||
      (ts.isStringLiteral(initializer.expression) && initializer.expression.text === "true"))
  );
}

function directFunctionReturnExpressions(functionNode) {
  const expressions = [];
  const walkFunctionBody = (node) => {
    if (node !== functionNode && ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression) {
      expressions.push(node.expression);
      return;
    }
    node.forEachChild(walkFunctionBody);
  };
  walkFunctionBody(functionNode.body);
  return expressions;
}

function collectOAuthBrandViolations(source, file = "Onboarding.tsx") {
  const sourceFile = parseTsx(source, file);
  const functions = new Map();
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) functions.set(statement.name.text, statement);
  }

  const violations = [];
  for (const component of ["KakaoIcon", "NaverIcon", "GoogleIcon"]) {
    const functionNode = functions.get(component);
    if (!functionNode?.body) {
      violations.push(component);
      continue;
    }
    const svgOpenings = [];
    for (const expression of directFunctionReturnExpressions(functionNode)) {
      visit(expression, (node) => {
        const opening = jsxOpening(node);
        if (opening && ts.isIdentifier(opening.tagName) && opening.tagName.text === "svg") {
          svgOpenings.push(opening);
        }
      });
    }
    if (svgOpenings.length === 0 || svgOpenings.some((opening) => !ariaHiddenIsTrue(opening))) {
      violations.push(component);
    }
  }
  return violations;
}

test("플랫 라인 SVG(ui/icon-*.svg)는 src 어디에서도 참조하지 않는다", () => {
  const offenders = [];
  for (const file of walk(resolve(rootDir, "src"))) {
    const body = readFileSync(file, "utf8");
    if (/ui\/icon-[a-z-]+\.svg/.test(body)) offenders.push(file);
  }
  assert.deepEqual(offenders, [], `플랫 SVG 참조 금지: ${offenders.join(", ")}`);
});

test("교체용 3D 아이콘 에셋이 존재한다", () => {
  for (const name of [
    "clock-3d.webp",
    "wifi-3d.webp",
    "lock-3d.webp",
    "lock-open-3d.webp",
    "chart-3d.webp",
    "ai-robot.webp",
    "mic-lavender.webp",
    "battery.webp",
  ]) {
    assert.ok(existsSync(resolve(rootDir, "public/assets/ui", name)), `missing public/assets/ui/${name}`);
  }
});

test("부모 홈 안전지표 4칸은 전부 3D webp 아이콘을 쓴다", () => {
  const home = readSource("src/screens/parent/ParentHome.tsx");
  assert.match(home, /ui\/battery\.webp/);
  assert.match(home, /ui\/clock-3d\.webp/);
  assert.match(home, /ui\/lock-open-3d\.webp/);
  assert.match(home, /ui\/wifi-3d\.webp/);
});

test("안심리포트 기기 상태 그리드도 3D webp 4종으로 통일한다", () => {
  const report = readSource("src/screens/feature/DailySafetyReport.tsx");
  assert.match(report, /ui\/battery\.webp/);
  assert.match(report, /ui\/clock-3d\.webp/);
  assert.match(report, /ui\/lock-open-3d\.webp/);
  assert.match(report, /ui\/wifi-3d\.webp/);
});

test("프리미엄 잠금·주간 리포트 히어로는 3D webp를 쓴다", () => {
  const weekly = readSource("src/screens/feature/WeeklyFamilyReport.tsx");
  const location = readSource("src/screens/parent/ParentLocation.tsx");
  assert.match(weekly, /ui\/chart-3d\.webp/);
  assert.match(weekly, /ui\/lock-3d\.webp/);
  assert.match(location, /ui\/lock-3d\.webp/);
});

test("PNG 중복 에셋(ai-robot·mic-lavender)은 webp 참조만 남긴다", () => {
  for (const file of walk(resolve(rootDir, "src"))) {
    const body = readFileSync(file, "utf8");
    assert.doesNotMatch(body, /ai-robot\.png|mic-lavender\.png/, `${file} 에 PNG 참조가 남아 있음`);
  }
});

test("전용 아이콘 슬롯에 원시 이모지를 쓰지 않는다 (2026-07-14 전수조사)", () => {
  const slotFiles = [
    "src/screens/feature/AiCredit.tsx",
    "src/screens/feature/AiSchedule.tsx",
    "src/screens/shared/MemoChat.tsx",
    "src/screens/child/StickerBook.tsx",
    "src/components/QrScanner.tsx",
    "src/screens/teacher/TeacherStudents.tsx",
    "src/screens/teacher/TeacherTimetable.tsx",
    "src/screens/onboarding/Onboarding.tsx",
  ];
  for (const file of slotFiles) {
    assert.deepEqual(
      collectDedicatedSlotEmojiViolations(readSource(file), file),
      [],
      `${file} 아이콘 슬롯에 원시 이모지`,
    );
  }
  for (const file of ["src/screens/feature/DaySummary.tsx", "src/screens/feature/RemoteAudio.tsx"]) {
    assert.deepEqual(
      collectIconPropertyEmojiViolations(readSource(file), file),
      [],
      `${file} icon 속성에 원시 이모지`,
    );
  }
  for (const file of ["src/screens/parent/EventForm.tsx", "src/components/MapPickerSheet.tsx"]) {
    assert.deepEqual(
      collectHomePlaceEmojiViolations(readSource(file), file),
      [],
      `${file} 장소 아이콘 조건식에 원시 이모지`,
    );
  }
});

test("출시 화면 유틸리티 아이콘은 손작성 SVG나 전용 슬롯 이모지를 쓰지 않는다", () => {
  const parentLocation = readSource("src/screens/parent/ParentLocation.tsx");
  assert.equal(
    collectJsxTagOccurrences(parentLocation, "src/screens/parent/ParentLocation.tsx", "svg").length,
    0,
    "ParentLocation 유틸리티 아이콘은 lucide-react를 사용해야 함",
  );

  for (const file of [
    "src/screens/feature/FriendPlay.tsx",
    "src/screens/feature/RemoteRing.tsx",
    "src/screens/parent/ParentLocation.tsx",
  ]) {
    assert.deepEqual(
      collectDedicatedSlotEmojiViolations(readSource(file), file),
      [],
      `${file} 전용 슬롯에 원시 이모지`,
    );
  }
  for (const file of ["src/screens/feature/DaySummary.tsx", "src/screens/feature/RemoteAudio.tsx"]) {
    assert.deepEqual(collectIconPropertyEmojiViolations(readSource(file), file), []);
  }
});

test("장소 삭제 아이콘은 44px 조작 영역과 18px glyph를 유지한다", () => {
  const css = readSource("src/screens/feature/PlaceManager.css");
  const screen = readSource("src/screens/feature/PlaceManager.tsx");

  for (const selector of ["pm-item__del", "pm-danger__del"]) {
    const block = new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
    assert.match(block, /width:\s*var\(--control-min-size\)/, `${selector} 너비 44px 계약 누락`);
    assert.match(block, /height:\s*var\(--control-min-size\)/, `${selector} 높이 44px 계약 누락`);
  }
  const trashIcons = collectLucideElements(screen, "src/screens/feature/PlaceManager.tsx")
    .filter((element) => element.component === "Trash2")
    .map(lucideElementDiagnostic);
  assert.deepEqual(trashIcons, [
    "src/screens/feature/PlaceManager.tsx|Trash2|18|2.2",
    "src/screens/feature/PlaceManager.tsx|Trash2|18|2.2",
  ]);
});

test("출시 화면 Lucide 유틸리티 아이콘은 승인된 glyph와 stroke 척도만 쓴다", () => {
  const files = [
    "src/components/MapPickerSheet.tsx",
    "src/components/ui/OfflineBanner.tsx",
    "src/components/ui/ScreenQueryState.tsx",
    "src/screens/child/ChildHome.tsx",
    "src/screens/child/ChildSettings.tsx",
    "src/screens/parent/ParentLocation.tsx",
    "src/screens/feature/DaySummary.tsx",
    "src/screens/feature/RemoteAudio.tsx",
    "src/screens/feature/FriendPlay.tsx",
    "src/screens/feature/RemoteRing.tsx",
    "src/screens/feature/PlaceManager.tsx",
  ];
  const allowedSizes = new Set([16, 18, 20, 22, 24]);
  const allowedStrokes = new Set([2.2, 2.4]);
  const decorativeAllowlist = new Set([
    "src/components/ui/ScreenQueryState.tsx|Icon|32|2.1",
    "src/screens/child/ChildHome.tsx|Check|19|3.4",
    "src/screens/parent/ParentLocation.tsx|AlertTriangle|30|2.2",
    "src/screens/parent/ParentLocation.tsx|RefreshCw|30|2.2",
    "src/screens/feature/RemoteAudio.tsx|Mic|52|1.8",
    "src/screens/feature/RemoteRing.tsx|Bell|52|1.9",
  ]);
  const violations = [];

  for (const file of files) {
    for (const element of collectLucideElements(readSource(file), file)) {
      if (element.size.kind !== "literal" || element.strokeWidth.kind !== "literal") {
        violations.push(lucideElementDiagnostic(element));
        continue;
      }
      const key = lucideElementDiagnostic(element);
      if (decorativeAllowlist.has(key)) continue;
      if (!allowedSizes.has(element.size.value) || !allowedStrokes.has(element.strokeWidth.value)) {
        violations.push(key);
      }
    }
  }
  assert.deepEqual(violations, [], `Lucide 규격 위반:\n${violations.join("\n")}`);
});

test("OAuth 브랜드 SVG는 버튼 이름과 중복 낭독되지 않는다", () => {
  const onboarding = readSource("src/screens/onboarding/Onboarding.tsx");
  assert.deepEqual(
    collectOAuthBrandViolations(onboarding),
    [],
    "KakaoIcon/NaverIcon/GoogleIcon 각 반환 SVG에 aria-hidden이 필요함",
  );
});

test("저수준 fixture: Lucide 속성 순서·누락·동적 값을 모두 거부한다", () => {
  const source = `
    import { Bell } from "lucide-react";
    const cards = [{ icon: Bell }];
    const item = cards[0];
    const DynamicIcon = item.icon;
    const iconSize = 20;
    export function Fixture() {
      return <>
        <Bell strokeWidth={2.2} size={20} />
        <Bell size={20} />
        <Bell size={iconSize} strokeWidth={2.2} />
        <DynamicIcon size={20} strokeWidth={2.2} />
      </>;
    }
  `;
  assert.deepEqual(collectLucideElements(source, "fixture.tsx").map(lucideElementDiagnostic), [
    "fixture.tsx|Bell|20|2.2",
    "fixture.tsx|Bell|strokeWidth:missing",
    "fixture.tsx|Bell|size:non-literal",
    "fixture.tsx|DynamicIcon|20|2.2",
  ]);
});

test("저수준 fixture: JSX 표현식과 class가 있는 일정 슬롯의 이모지를 거부한다", () => {
  const source = `
    export function Fixture() {
      return <div className="pl-scrub__legend">
        <span className="fp-waiting hy-press">{"🔔"}</span>
        <span className="pl-schedule-item">{"📅"} 일정</span>
      </div>;
    }
  `;
  assert.deepEqual(collectDedicatedSlotEmojiViolations(source), ["fp-waiting", "pl-scrub__legend"]);
});

test("저수준 fixture: 조건식 안 중첩 JSX 텍스트 이모지를 거부한다", () => {
  const source = `
    export function Fixture() {
      return <span className="fp-waiting">{true && <span>🔔</span>}</span>;
    }
  `;
  assert.deepEqual(collectDedicatedSlotEmojiViolations(source), ["fp-waiting"]);
});

test("저수준 fixture: JSX 숫자 entity와 문자열 표현식 이모지를 모두 거부한다", () => {
  const source = `
    export function Fixture() {
      return <>
        <span className="fp-waiting">&#x1F514;</span>
        <span className="rr-modal-emoji">{"🔔"}</span>
        <span className="fp-cta">{"&#x1F514;"}</span>
        <span className="fp-connected__badge">&#65;</span>
      </>;
    }
  `;
  assert.deepEqual(collectDedicatedSlotEmojiViolations(source), ["fp-waiting", "rr-modal-emoji"]);
});

test("저수준 fixture: OAuth SVG 검사는 다음 함수 경계를 넘지 않는다", () => {
  const source = `
    function KakaoIcon() { return null; }
    function NaverIcon() { return <svg aria-hidden="true" />; }
    function GoogleIcon() { return <svg aria-hidden="true" />; }
  `;
  assert.deepEqual(collectOAuthBrandViolations(source), ["KakaoIcon"]);
});

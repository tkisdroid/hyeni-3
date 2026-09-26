import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expectedDialogCounts = new Map([
  ["src/components/ChildLocationPermissionDialog.tsx", 1],
  ["src/components/MapPickerSheet.tsx", 1],
  ["src/components/MessageSafetyDialog.tsx", 1],
  ["src/components/PremiumUpsell.tsx", 1],
  ["src/components/QrScanner.tsx", 1],
  ["src/components/ReferralRewardPanel.tsx", 1],
  ["src/screens/child/ChildSettings.tsx", 1],
  ["src/screens/child/overlays/ChildSheet.tsx", 2],
  ["src/screens/feature/FamilyConnection.tsx", 1],
  ["src/screens/feature/RemoteRing.tsx", 1],
  // 2026-09-26: 아이디 확인·비밀번호 재설정 바닥 시트.
  ["src/screens/onboarding/PasswordResetSheet.tsx", 1],
  ["src/screens/parent/ChildDetail.tsx", 1],
  ["src/screens/parent/EventForm.tsx", 1],
  ["src/screens/parent/ParentAccount.tsx", 2],
  ["src/screens/parent/ParentCalendar.tsx", 1],
  ["src/screens/shared/MemoChat.tsx", 1],
  ["src/screens/teacher/TeacherHome.tsx", 2],
  ["src/screens/teacher/TeacherReleaseGate.tsx", 1],
  ["src/screens/teacher/TeacherSettings.tsx", 1],
  ["src/screens/teacher/TeacherStudents.tsx", 1],
]);

function tsxFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = resolve(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(absolute);
    return entry.isFile() && entry.name.endsWith(".tsx") ? [absolute] : [];
  });
}

function normalizedPath(absolute) {
  return relative(root, absolute).replaceAll("\\", "/");
}

function attribute(opening, name) {
  return opening.attributes.properties.find(
    (property) => ts.isJsxAttribute(property) && property.name.text === name,
  );
}

function stringAttribute(opening, name) {
  const found = attribute(opening, name);
  return found && found.initializer && ts.isStringLiteral(found.initializer)
    ? found.initializer.text
    : null;
}

function expressionAttributeText(opening, name) {
  const found = attribute(opening, name);
  return found?.initializer && ts.isJsxExpression(found.initializer)
    ? found.initializer.expression?.getText() ?? null
    : null;
}

function dialogsIn(absolute) {
  const source = readFileSync(absolute, "utf8");
  const sourceFile = ts.createSourceFile(absolute, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const dialogs = [];
  const visit = (node) => {
    if (ts.isJsxElement(node) && stringAttribute(node.openingElement, "role") === "dialog") {
      const line = sourceFile.getLineAndCharacterOfPosition(node.openingElement.getStart()).line + 1;
      dialogs.push({ opening: node.openingElement, line });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { dialogs, source };
}

function descendantButtonsWithClass(node, className) {
  const buttons = [];
  const visit = (child) => {
    if (ts.isJsxElement(child)
      && child.openingElement.tagName.getText() === "button"
      && stringAttribute(child.openingElement, "className")?.split(/\s+/).includes(className)) {
      buttons.push(child.openingElement);
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return buttons;
}

test("모든 dialog를 전수 목록으로 고정한다", () => {
  const actual = new Map();
  for (const absolute of tsxFiles(resolve(root, "src"))) {
    const path = normalizedPath(absolute);
    const count = dialogsIn(absolute).dialogs.length;
    if (count > 0) actual.set(path, count);
  }
  assert.deepEqual([...actual.entries()].sort(), [...expectedDialogCounts.entries()].sort());
});

test("모든 dialog는 공통 focus lifecycle과 제목·설명·안전한 초기 focus를 연결한다", () => {
  const violations = [];
  for (const [path, expectedCount] of expectedDialogCounts) {
    const absolute = resolve(root, path);
    const { dialogs, source } = dialogsIn(absolute);
    const lifecycleCount = (source.match(/useDialogFocusLifecycle(?:<[^>]+>)?\s*\(\s*\{/g) ?? []).length;
    const initialFocusCount = (source.match(/initialFocusRef\s*:/g) ?? []).length;

    if (lifecycleCount !== expectedCount) {
      violations.push(`${path}: focus lifecycle ${lifecycleCount}/${expectedCount}`);
    }
    if (initialFocusCount < expectedCount) {
      violations.push(`${path}: initialFocusRef ${initialFocusCount}/${expectedCount}`);
    }
    for (const { opening, line } of dialogs) {
      if (stringAttribute(opening, "aria-modal") !== "true") {
        violations.push(`${path}:${line} aria-modal=true 누락`);
      }
      for (const required of ["ref", "aria-labelledby", "aria-describedby"]) {
        if (!attribute(opening, required)) violations.push(`${path}:${line} ${required} 누락`);
      }
    }
  }
  assert.deepEqual(violations, [], `modal 접근성 위반 ${violations.length}건:\n${violations.join("\n")}`);
});

test("dialog의 투명 scrim은 Tab 순서에 들어오지 않는다", () => {
  const violations = [];
  let scrimCount = 0;
  for (const absolute of tsxFiles(resolve(root, "src"))) {
    const relativePath = normalizedPath(absolute);
    const source = readFileSync(absolute, "utf8");
    const tags = source.match(/<button\b[^>]*className="[^"]*(?:scrim|ks-dim)[^"]*"[^>]*>/gs) ?? [];
    scrimCount += tags.length;
    for (const tag of tags) {
      if (!/tabIndex=\{-1\}/.test(tag)) violations.push(relativePath);
    }
  }
  assert.equal(scrimCount, 14, "dialog scrim 전수 목록이 바뀌면 접근성 계약도 갱신해야 합니다");
  assert.deepEqual(violations, [], `Tab 순서에 남은 투명 scrim:\n${violations.join("\n")}`);
});

test("공용 아이 sheet와 modal은 항상 44px 이상의 명시적 닫기 버튼을 첫 focus로 제공한다", () => {
  const path = "src/screens/child/overlays/ChildSheet.tsx";
  const absolute = resolve(root, path);
  const { dialogs, source } = dialogsIn(absolute);
  const koChild = JSON.parse(readFileSync(resolve(root, "locales/ko/child.json"), "utf8"));
  assert.equal(dialogs.length, 2);
  for (const { opening } of dialogs) {
    const dialog = opening.parent;
    const closeButtons = descendantButtonsWithClass(dialog, "ks-dialog-close");
    assert.equal(closeButtons.length, 1, "ChildSheet와 ChildModal 각각에 닫기 버튼이 하나씩 있어야 합니다");
    const closeButton = closeButtons[0];
    assert.match(
      expressionAttributeText(closeButton, "aria-label") ?? "",
      /^intl\.formatMessage\(\{\s*id:\s*"child\.action\.close"\s*\}\)$/,
    );
    assert.ok(attribute(closeButton, "onClick"), "닫기 버튼은 실제 onClose 동작을 연결해야 합니다");
    assert.ok(attribute(closeButton, "ref"), "닫기 버튼은 초기 focus 대상을 연결해야 합니다");
    assert.equal(attribute(closeButton, "tabIndex"), undefined, "닫기 버튼은 Tab 순서에서 빠지면 안 됩니다");
  }
  assert.equal((source.match(/initialFocusRef:\s*closeRef/g) ?? []).length, 2);
  assert.equal((source.match(/const intl = useIntl\(\)/g) ?? []).length, 2);
  assert.equal(koChild["child.action.close"], "닫기");

  const css = readFileSync(resolve(root, "src/screens/child/overlays/ChildSheet.css"), "utf8");
  const closeRule = /\.ks-dialog-close\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.match(closeRule, /width:\s*44px\s*;/);
  assert.match(closeRule, /height:\s*44px\s*;/);
});

test("어른 화면 안 modal은 isolation 스택에 갇혀 탭바 밑에 깔리지 않는다", () => {
  // 2026-09-26 실기기: .hy-adult .hy-screen 의 isolation 때문에 프리미엄 안내·벨 확인 시트의
  // 아래쪽과 scrim 이 탭바(z 45)에 가려졌다. 모달이 열린 동안 화면 스택을 탭바 위로 올린다.
  const glass = readFileSync(resolve(root, "src/styles/glass.css"), "utf8");
  const components = readFileSync(resolve(root, "src/styles/components.css"), "utf8");
  assert.match(glass, /\.hy-adult \.hy-screen\s*\{[^}]*isolation:\s*isolate/);
  const tabbarZ = Number(/\.hy-tabbar\s*\{[^}]*z-index:\s*(\d+)/.exec(components)?.[1]);
  const lifted = /\.hy-adult \.hy-screen:has\(\[aria-modal="true"\]\)\s*\{[^}]*z-index:\s*(\d+)/.exec(glass);
  assert.ok(lifted, "모달을 품은 어른 화면의 z-index 승격 규칙이 있어야 합니다");
  assert.ok(Number(lifted[1]) > tabbarZ, "승격한 화면은 탭바보다 위여야 합니다");
});

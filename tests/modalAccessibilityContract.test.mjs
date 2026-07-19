import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const memoChatPath = "src/screens/shared/MemoChat.tsx";
const expectedDialogCounts = new Map([
  ["src/components/MapPickerSheet.tsx", 1],
  ["src/components/MessageSafetyDialog.tsx", 1],
  ["src/components/QrScanner.tsx", 1],
  ["src/screens/child/ChildSettings.tsx", 1],
  ["src/screens/child/overlays/ChildSheet.tsx", 2],
  ["src/screens/feature/FamilyConnection.tsx", 1],
  ["src/screens/feature/RemoteRing.tsx", 1],
  ["src/screens/onboarding/Onboarding.tsx", 1],
  ["src/screens/parent/ChildDetail.tsx", 1],
  ["src/screens/parent/EventForm.tsx", 1],
  ["src/screens/parent/ParentAccount.tsx", 2],
  ["src/screens/parent/ParentCalendar.tsx", 1],
  ["src/screens/parent/ParentSettings.tsx", 1],
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

test("MemoChat을 제외한 모든 dialog를 전수 목록으로 고정한다", () => {
  const actual = new Map();
  for (const absolute of tsxFiles(resolve(root, "src"))) {
    const path = normalizedPath(absolute);
    if (path === memoChatPath) continue;
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
    if (relativePath === memoChatPath) continue;
    const source = readFileSync(absolute, "utf8");
    const tags = source.match(/<button\b[^>]*className="[^"]*(?:scrim|ks-dim)[^"]*"[^>]*>/gs) ?? [];
    scrimCount += tags.length;
    for (const tag of tags) {
      if (!/tabIndex=\{-1\}/.test(tag)) violations.push(relativePath);
    }
  }
  assert.equal(scrimCount, 12, "dialog scrim 전수 목록이 바뀌면 접근성 계약도 갱신해야 합니다");
  assert.deepEqual(violations, [], `Tab 순서에 남은 투명 scrim:\n${violations.join("\n")}`);
});

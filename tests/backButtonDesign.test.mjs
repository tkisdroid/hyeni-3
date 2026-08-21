import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));

function collectTsx(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectTsx(path);
    return entry.isFile() && path.endsWith(".tsx") ? [path] : [];
  });
}

function containsChevronLeft(node, sourceFile) {
  let found = false;
  const visit = (child) => {
    if (found) return;
    if (ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child)) {
      if (child.tagName.getText(sourceFile) === "ChevronLeft") {
        found = true;
        return;
      }
    }
    ts.forEachChild(child, visit);
  };
  ts.forEachChild(node, visit);
  return found;
}

test("모든 페이지 뒤로가기는 공용 투명 버튼 규칙에 연결된다", () => {
  const misses = [];

  for (const path of collectTsx(join(repoRoot, "src"))) {
    const source = readFileSync(path, "utf8");
    const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node) => {
      const isChevronButton = ts.isJsxElement(node)
        && node.openingElement.tagName.getText(sourceFile) === "button"
        && containsChevronLeft(node, sourceFile);
      if (isChevronButton) {
        const className = node.openingElement.attributes.properties.find(
          (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(sourceFile) === "className",
        )?.getText(sourceFile) ?? "";

        // 달력의 왼쪽 화살표는 페이지 복귀가 아니라 이전 달 이동이다.
        if (!className.includes("pc-navbtn") && !/(?:[\w-]+-back|hy-backbtn)/.test(className)) {
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
          misses.push(`${relative(repoRoot, path).replaceAll("\\", "/")}:${line}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  assert.deepEqual(misses, [], `공용 뒤로가기 규칙을 쓰지 않는 버튼:\n${misses.join("\n")}`);
});

test("뒤로가기는 44px 터치 영역에 20px 꺾쇠만 표시한다", () => {
  const components = readFileSync(join(repoRoot, "src/styles/components.css"), "utf8");
  const backRule = components.match(
    /\.hy-app button\.hy-press\[class\*="-back"\],\s*\.hy-app button\.hy-backbtn \{([\s\S]*?)\n\}/,
  )?.[1] ?? "";
  const iconRule = components.match(
    /\.hy-app button\.hy-press\[class\*="-back"\] > svg,\s*\.hy-app button\.hy-backbtn > svg \{([\s\S]*?)\n\}/,
  )?.[1] ?? "";
  const darkRule = components.match(
    /\.hy-app button\.hy-press\.ob-back--dark,\s*\.hy-app button\.hy-press\.cs-back \{([\s\S]*?)\n\}/,
  )?.[1] ?? "";

  for (const property of ["width", "height", "min-width", "min-height"]) {
    assert.match(backRule, new RegExp(`${property}: var\\(--control-min-size\\) !important`));
  }
  assert.match(backRule, /border: 0 !important/);
  assert.match(backRule, /border-radius: 0 !important/);
  assert.match(backRule, /background: transparent !important/);
  assert.match(backRule, /box-shadow: none !important/);
  assert.match(backRule, /-webkit-backdrop-filter: none !important/);
  assert.match(backRule, /backdrop-filter: none !important/);
  assert.match(iconRule, /width: var\(--icon-20\) !important/);
  assert.match(iconRule, /height: var\(--icon-20\) !important/);
  assert.match(darkRule, /color: #fff/);
  assert.doesNotMatch(darkRule, /background|border|box-shadow|backdrop-filter/);
});

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import test from "node:test";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const screenRoots = ["onboarding", "parent", "shared", "feature", "child", "teacher"];

function collectFiles(directory, extension) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(absolutePath, extension);
    if (!entry.isFile() || !entry.name.endsWith(extension)) return [];
    return [absolutePath];
  });
}

const cssFiles = screenRoots
  .flatMap((directory) => collectFiles(join(repoRoot, "src", "screens", directory), ".css"))
  .sort();
const commonReleaseCssFiles = [
  join(repoRoot, "src", "styles", "components.css"),
  join(repoRoot, "src", "app", "ChildDock.css"),
];
const typographyCssFiles = [...cssFiles, ...commonReleaseCssFiles];
const tsxFiles = collectFiles(join(repoRoot, "src", "screens"), ".tsx").sort();

function displayPath(absolutePath) {
  return relative(repoRoot, absolutePath).split(sep).join("/");
}

function cssBlocks(source) {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, (comment) => "\n".repeat(comment.split("\n").length - 1));
  return [...withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1].trim(),
    declarations: match[2],
    line: withoutComments.slice(0, match.index).split("\n").length,
  }));
}

function declarationValue(declarations, property) {
  return declarations.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, "i"))?.[1].trim() ?? null;
}

function resolvePixels(value) {
  if (!value) return null;
  const numeric = value.match(/^(-?[0-9.]+)px$/i)?.[1];
  if (numeric) return Number.parseFloat(numeric);
  if (/^var\(--control-min-size\)$/i.test(value)) return 44;
  return null;
}

const typeRoles = new Map([
  ["--type-display", ["--type-display-line-height", "--type-display-weight"]],
  ["--type-title-xl", ["--type-title-xl-line-height", "--type-title-xl-weight"]],
  ["--type-title-lg", ["--type-title-lg-line-height", "--type-title-lg-weight"]],
  ["--type-title", ["--type-title-line-height", "--type-title-weight"]],
  ["--type-body-lg", ["--type-body-lg-line-height", "--type-body-lg-weight"]],
  ["--type-body", ["--type-body-line-height", "--type-body-weight"]],
  ["--type-body-sm", ["--type-body-sm-line-height", "--type-body-sm-weight"]],
  ["--type-label", ["--type-label-line-height", "--type-label-weight"]],
  ["--type-caption", ["--type-caption-line-height", "--type-caption-weight"]],
]);

function collectLiteralClassNames(node, names) {
  if (ts.isStringLiteralLike(node)) {
    for (const name of node.text.split(/\s+/)) {
      if (/^[a-z][a-z0-9_-]*$/i.test(name)) names.add(name);
    }
    return;
  }
  ts.forEachChild(node, (child) => collectLiteralClassNames(child, names));
}

function collectInteractiveClasses() {
  const names = new Set();
  const interactiveTags = new Set(["button", "a", "input", "select", "textarea"]);

  for (const absolutePath of tsxFiles) {
    const source = readFileSync(absolutePath, "utf8");
    const sourceFile = ts.createSourceFile(absolutePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node) => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tagName = node.tagName.getText(sourceFile);
        if (interactiveTags.has(tagName)) {
          const classAttribute = node.attributes.properties.find(
            (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(sourceFile) === "className",
          );
          if (classAttribute?.initializer) collectLiteralClassNames(classAttribute.initializer, names);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return names;
}

function selectorTargetsClass(selector, className) {
  return selector.split(",").some((part) => {
    if (/::(?:before|after)\b/.test(part)) return false;
    const lastCompound = part.trim().split(/\s+|>|\+|~/).at(-1) ?? "";
    return new RegExp(`\\.${className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9_-])`, "i").test(lastCompound);
  });
}

function isGlyphSelector(selector) {
  const glyphRoles = new Set(["icon", "emoji", "spinner", "chevron", "checkmark", "star"]);
  return selector.split(",").every((part) => {
    if (/::(?:before|after)\b/.test(part)) return true;
    const lastCompound = (part.trim().split(/\s+|>|\+|~/).at(-1) ?? "").replace(/:not\([^)]*\)/g, "");
    const classNames = [...lastCompound.matchAll(/\.([a-z][a-z0-9_-]*)/gi)].map((match) => match[1]);
    return classNames.some((className) => className.split(/[-_]+/).some((segment) => glyphRoles.has(segment)));
  });
}

test("출시 화면과 공용 dock의 읽는 텍스트는 12px 이상인 의미 type token을 세 속성 묶음으로 사용한다", () => {
  const violations = [];

  for (const absolutePath of typographyCssFiles) {
    for (const block of cssBlocks(readFileSync(absolutePath, "utf8"))) {
      const fontSize = declarationValue(block.declarations, "font-size");
      if (!fontSize) continue;
      // font-size가 글자 크기가 아니라 단일 장식 glyph의 optical size인 selector만 제외합니다.
      // 실제 읽는 숫자·badge·meta는 이 예외에 포함하지 않고 Caption 이상으로 올립니다.
      if (isGlyphSelector(block.selector)) {
        continue;
      }
      const token = fontSize.match(/^var\((--type-[a-z-]+)\)$/)?.[1];
      if (!token || !typeRoles.has(token)) {
        violations.push(`${displayPath(absolutePath)}:${block.line} ${block.selector} (${fontSize})`);
        continue;
      }
      const [lineHeightToken, weightToken] = typeRoles.get(token);
      if (declarationValue(block.declarations, "line-height") !== `var(${lineHeightToken})`
        || declarationValue(block.declarations, "font-weight") !== `var(${weightToken})`) {
        violations.push(`${displayPath(absolutePath)}:${block.line} ${block.selector} (${token} 묶음 불완전)`);
      }
    }
  }

  assert.deepEqual(violations, [], `type token 위반 ${violations.length}건:\n${violations.slice(0, 120).join("\n")}`);
});

test("정본 Caption token은 실제 12px 이상이다", () => {
  const tokens = readFileSync(join(repoRoot, "src", "styles", "tokens.css"), "utf8");
  const captionSize = Number.parseFloat(tokens.match(/--type-caption\s*:\s*([0-9.]+)px/)?.[1] ?? "NaN");
  assert.ok(Number.isFinite(captionSize) && captionSize >= 12, `Caption token이 ${captionSize}px입니다`);
});

test("부모 홈의 내용 기반 소형 버튼도 실제 44px hit area를 보장한다", () => {
  const components = readFileSync(join(repoRoot, "src", "styles", "components.css"), "utf8");
  const parentHome = readFileSync(join(repoRoot, "src", "screens", "parent", "ParentHome.css"), "utf8");
  assert.match(components, /\.hy-section-action\s*\{[^}]*min-height:\s*var\(--control-min-size\)/s);
  assert.match(parentHome, /\.ph-ai__btn\s*\{[^}]*min-height:\s*var\(--control-min-size\)/s);
  assert.match(parentHome, /\.ph-safety__refresh button\s*\{[^}]*min-height:\s*var\(--control-min-size\)/s);
  assert.match(parentHome, /\.ph-prep-edit\s*\{[^}]*min-height:\s*var\(--control-min-size\)/s);
});

test("실제 화면의 상호작용 클래스는 명시된 hit area가 44px보다 작지 않다", () => {
  const interactiveClasses = collectInteractiveClasses();
  const rulesByClass = new Map([...interactiveClasses].map((className) => [className, []]));

  for (const absolutePath of cssFiles) {
    for (const block of cssBlocks(readFileSync(absolutePath, "utf8"))) {
      for (const className of interactiveClasses) {
        if (selectorTargetsClass(block.selector, className)) {
          rulesByClass.get(className).push({ ...block, path: displayPath(absolutePath) });
        }
      }
    }
  }

  const violations = [];
  for (const [className, rules] of rulesByClass) {
    const heights = rules.flatMap(({ declarations }) => ["min-height", "height"]
      .map((property) => resolvePixels(declarationValue(declarations, property)))
      .filter(Number.isFinite));
    const widths = rules.flatMap(({ declarations }) => ["min-width", "width"]
      .map((property) => resolvePixels(declarationValue(declarations, property)))
      .filter(Number.isFinite));
    const hasSmallHeight = heights.some((height) => height < 44);
    const hasAdequateHeight = heights.some((height) => height >= 44);
    const isSmallSquareControl = hasSmallHeight && widths.some((width) => width < 44);
    const hasAdequateWidth = widths.some((width) => width >= 44);
    if ((hasSmallHeight && !hasAdequateHeight) || (isSmallSquareControl && !hasAdequateWidth)) {
      const first = rules.find(({ declarations }) => {
        const height = resolvePixels(declarationValue(declarations, "height"));
        const minHeight = resolvePixels(declarationValue(declarations, "min-height"));
        return (height != null && height < 44) || (minHeight != null && minHeight < 44);
      });
      violations.push(`${first?.path ?? "CSS 없음"}:${first?.line ?? 0} .${className} (높이 ${heights.join("/") || "미지정"}, 너비 ${widths.join("/") || "미지정"})`);
    }
  }

  assert.deepEqual(violations, [], `44px hit area 위반 ${violations.length}건:\n${violations.join("\n")}`);
});

test("출시 화면에는 848px 고정 프레임이 없다", () => {
  const fixedFrames = [];

  for (const absolutePath of cssFiles) {
    for (const block of cssBlocks(readFileSync(absolutePath, "utf8"))) {
      if (/\bmin-height\s*:\s*848px\b/i.test(block.declarations)) {
        fixedFrames.push(`${displayPath(absolutePath)}:${block.line} ${block.selector}`);
      }
    }
  }

  assert.deepEqual(fixedFrames, [], `848px 고정 프레임 ${fixedFrames.length}건:\n${fixedFrames.join("\n")}`);
});

test("출시 화면은 브라우저 focus outline을 제거하지 않는다", () => {
  const hiddenFocus = [];

  for (const absolutePath of cssFiles) {
    for (const block of cssBlocks(readFileSync(absolutePath, "utf8"))) {
      if (/\boutline\s*:\s*none\b/i.test(block.declarations)) {
        hiddenFocus.push(`${displayPath(absolutePath)}:${block.line} ${block.selector}`);
      }
    }
  }

  assert.deepEqual(hiddenFocus, [], `outline:none ${hiddenFocus.length}건:\n${hiddenFocus.join("\n")}`);
});

test("출시 화면의 단순 padding과 gap은 4px 리듬을 사용한다", () => {
  const violations = [];
  const spacingProperties = /^(?:padding(?:-(?:top|right|bottom|left|block|inline))?|gap|row-gap|column-gap)$/;

  for (const absolutePath of cssFiles) {
    for (const block of cssBlocks(readFileSync(absolutePath, "utf8"))) {
      for (const declaration of block.declarations.split(";")) {
        const match = declaration.match(/^\s*([a-z-]+)\s*:\s*(.+?)\s*$/i);
        if (!match || !spacingProperties.test(match[1])) continue;
        const literals = [...match[2].matchAll(/(?<![-\w])([0-9.]+)px\b/g)].map((item) => Number.parseFloat(item[1]));
        const offGrid = literals.filter((value) => value !== 0 && value !== 2 && value % 4 !== 0);
        if (offGrid.length > 0) {
          violations.push(`${displayPath(absolutePath)}:${block.line} ${block.selector} (${match[1]}: ${match[2]})`);
        }
      }
    }
  }

  assert.deepEqual(violations, [], `spacing rhythm 위반 ${violations.length}건:\n${violations.slice(0, 120).join("\n")}`);
});

test("sticky/fixed 화면 header는 상단 safe area를 포함한다", () => {
  const violations = [];

  for (const absolutePath of cssFiles) {
    for (const block of cssBlocks(readFileSync(absolutePath, "utf8"))) {
      if (!/(?:^|[-_])(header|topbar)\b/i.test(block.selector)) continue;
      if (!/\bposition\s*:\s*(?:sticky|fixed)\b/i.test(block.declarations)) continue;
      if (!/\btop\s*:\s*0(?:px)?\b/i.test(block.declarations)) continue;
      if (!/safe-area-inset-top/i.test(block.declarations)) {
        violations.push(`${displayPath(absolutePath)}:${block.line} ${block.selector}`);
      }
    }
  }

  assert.deepEqual(violations, [], `safe-area 누락 header ${violations.length}건:\n${violations.join("\n")}`);
});

test("카드·hero·modal·sheet 표면은 정본 radius와 elevation만 사용한다", () => {
  const violations = [];
  const expectedRadius = { card: "--radius-16", panel: "--radius-16", hero: "--radius-20", modal: "--radius-20", sheet: "--radius-24" };

  for (const absolutePath of cssFiles) {
    for (const block of cssBlocks(readFileSync(absolutePath, "utf8"))) {
      if (/::(?:before|after)\b/.test(block.selector)) continue;
      const lastCompound = block.selector.trim().split(/\s+|>|\+|~/).at(-1) ?? "";
      const classNames = [...lastCompound.matchAll(/\.([a-z][a-z0-9_-]*)/gi)].map((match) => match[1]);
      const surfaceClass = classNames.find((className) => /(?:^|[-_])(card|panel|hero|modal|sheet)$/i.test(className));
      if (!surfaceClass) continue;
      const role = /sheet/i.test(surfaceClass)
        ? "sheet"
        : /(?:modal|dialog)/i.test(surfaceClass)
          ? "modal"
          : /hero/i.test(surfaceClass)
            ? "hero"
            : surfaceClass.match(/(?:^|[-_])(card|panel)$/i)?.[1].toLowerCase();
      const radius = declarationValue(block.declarations, "border-radius");
      const canonicalRadius = `var(${expectedRadius[role]})`;
      const isCanonicalSheetTopRadius = role === "sheet"
        && radius === `${canonicalRadius} ${canonicalRadius} 0 0`;
      if (radius && radius !== canonicalRadius && !isCanonicalSheetTopRadius) {
        violations.push(`${displayPath(absolutePath)}:${block.line} ${block.selector} (${role} radius ${radius})`);
      }
      const shadow = declarationValue(block.declarations, "box-shadow");
      if (shadow && shadow !== "none" && !/^var\(--shadow-(?:soft|floating|modal)\)$/.test(shadow)) {
        violations.push(`${displayPath(absolutePath)}:${block.line} ${block.selector} (${role} shadow ${shadow})`);
      }
    }
  }

  assert.deepEqual(violations, [], `surface 규격 위반 ${violations.length}건:\n${violations.slice(0, 120).join("\n")}`);
});

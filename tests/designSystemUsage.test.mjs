import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
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

function uniqueFiles(files) {
  return [...new Set(files.filter(existsSync))].sort();
}

const screenCssFiles = screenRoots
  .flatMap((directory) => collectFiles(join(repoRoot, "src", "screens", directory), ".css"));
const releaseCssFiles = uniqueFiles([
  ...screenCssFiles,
  join(repoRoot, "src", "screens", "Splash.css"),
  ...collectFiles(join(repoRoot, "src", "app"), ".css"),
  join(repoRoot, "src", "styles", "components.css"),
  ...collectFiles(join(repoRoot, "src", "components"), ".css"),
]);
const releaseTsxFiles = uniqueFiles([
  ...collectFiles(join(repoRoot, "src", "screens"), ".tsx"),
  ...collectFiles(join(repoRoot, "src", "components"), ".tsx"),
  ...collectFiles(join(repoRoot, "src", "app"), ".tsx"),
]);
const cssVariableDefinitionFiles = uniqueFiles([
  ...releaseCssFiles,
  ...collectFiles(join(repoRoot, "src", "styles"), ".css"),
]);

function displayPath(absolutePath) {
  return relative(repoRoot, absolutePath).split(sep).join("/");
}

function stripCommentsPreservingLines(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
}

function findMatchingBrace(source, openIndex, end) {
  let depth = 1;
  let quote = null;
  for (let index = openIndex + 1; index < end; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) return index;
  }
  return end;
}

function splitTopLevel(source, delimiter) {
  const parts = [];
  let start = 0;
  let round = 0;
  let square = 0;
  let quote = null;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "(") round += 1;
    else if (character === ")") round -= 1;
    else if (character === "[") square += 1;
    else if (character === "]") square -= 1;
    else if (character === delimiter && round === 0 && square === 0) {
      parts.push(source.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(source.slice(start));
  return parts;
}

function parseDeclarations(source) {
  return splitTopLevel(source, ";").flatMap((raw) => {
    const separator = raw.indexOf(":");
    if (separator < 0) return [];
    const property = raw.slice(0, separator).trim().toLowerCase();
    const value = raw.slice(separator + 1).trim();
    return property && value ? [{ property, value }] : [];
  });
}

function cssBlocks(source) {
  const clean = stripCommentsPreservingLines(source);
  const blocks = [];
  const walk = (start, end, atRules) => {
    let cursor = start;
    while (cursor < end) {
      while (cursor < end && /\s/.test(clean[cursor])) cursor += 1;
      if (cursor >= end) break;
      const preludeStart = cursor;
      let quote = null;
      let round = 0;
      while (cursor < end) {
        const character = clean[cursor];
        if (quote) {
          if (character === "\\") cursor += 1;
          else if (character === quote) quote = null;
        } else if (character === '"' || character === "'") quote = character;
        else if (character === "(") round += 1;
        else if (character === ")") round -= 1;
        else if (round === 0 && (character === "{" || character === ";")) break;
        cursor += 1;
      }
      if (cursor >= end) break;
      if (clean[cursor] === ";") {
        cursor += 1;
        continue;
      }
      const prelude = clean.slice(preludeStart, cursor).trim();
      const close = findMatchingBrace(clean, cursor, end);
      const contentStart = cursor + 1;
      if (/^@(media|supports|container|layer)\b/i.test(prelude)) {
        walk(contentStart, close, [...atRules, prelude]);
      } else if (!/^@(?:keyframes|-webkit-keyframes|font-face|property)\b/i.test(prelude)) {
        blocks.push({
          selector: prelude,
          selectors: splitTopLevel(prelude, ",").map((selector) => selector.trim()).filter(Boolean),
          declarations: parseDeclarations(clean.slice(contentStart, close)),
          atRules,
          line: clean.slice(0, preludeStart).split("\n").length,
        });
      }
      cursor = close + 1;
    }
  };
  walk(0, clean.length, []);
  return blocks;
}

function declarationValue(declarations, property) {
  const normalized = property.toLowerCase();
  return declarations.findLast((declaration) => declaration.property === normalized)?.value ?? null;
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

function addClassTokens(text, names) {
  for (const name of text.split(/\s+/)) {
    if (/^[a-z][a-z0-9_-]*$/i.test(name) && !/[-_]$/.test(name)) names.add(name);
  }
}

function collectClassNamesFromExpression(expression, names) {
  if (!expression) return;
  if (ts.isStringLiteralLike(expression)) {
    addClassTokens(expression.text, names);
  } else if (ts.isParenthesizedExpression(expression)) {
    collectClassNamesFromExpression(expression.expression, names);
  } else if (ts.isConditionalExpression(expression)) {
    collectClassNamesFromExpression(expression.whenTrue, names);
    collectClassNamesFromExpression(expression.whenFalse, names);
  } else if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    collectClassNamesFromExpression(expression.left, names);
    collectClassNamesFromExpression(expression.right, names);
  } else if (ts.isTemplateExpression(expression)) {
    addClassTokens(expression.head.text, names);
    for (const span of expression.templateSpans) {
      collectClassNamesFromExpression(span.expression, names);
      addClassTokens(span.literal.text, names);
    }
  } else if (ts.isArrayLiteralExpression(expression)) {
    for (const element of expression.elements) collectClassNamesFromExpression(element, names);
  } else if (ts.isCallExpression(expression) || ts.isPropertyAccessExpression(expression)) {
    collectClassNamesFromExpression(expression.expression, names);
  }
}

function jsxAttribute(opening, name, sourceFile) {
  return opening.attributes.properties.find(
    (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(sourceFile) === name,
  );
}

function jsxAttributeValues(attribute) {
  const values = new Set();
  if (!attribute?.initializer) return values;
  if (ts.isStringLiteral(attribute.initializer)) values.add(attribute.initializer.text);
  else if (ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression) {
    const collect = (expression) => {
      if (ts.isStringLiteralLike(expression)) values.add(expression.text);
      else if (ts.isParenthesizedExpression(expression)) collect(expression.expression);
      else if (ts.isConditionalExpression(expression)) {
        collect(expression.whenTrue);
        collect(expression.whenFalse);
      }
    };
    collect(attribute.initializer.expression);
  }
  return values;
}

function styleObjectsFromExpression(expression) {
  if (!expression) return [];
  if (ts.isParenthesizedExpression(expression)) return styleObjectsFromExpression(expression.expression);
  if (ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression)) {
    return styleObjectsFromExpression(expression.expression);
  }
  if (ts.isConditionalExpression(expression)) {
    return [
      ...styleObjectsFromExpression(expression.whenTrue),
      ...styleObjectsFromExpression(expression.whenFalse),
    ];
  }
  if (!ts.isObjectLiteralExpression(expression)) return [];
  const declarations = [];
  for (const property of expression.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = property.name.getText().replace(/^['"]|['"]$/g, "");
    const valueNode = property.initializer;
    let value = null;
    if (ts.isNumericLiteral(valueNode)) value = `${valueNode.text}px`;
    else if (ts.isStringLiteralLike(valueNode)) value = valueNode.text;
    declarations.push({ property: name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`), value, node: valueNode });
  }
  return [declarations];
}

function isInsideLabel(node, sourceFile) {
  let current = node.parent;
  while (current) {
    if (ts.isJsxElement(current) && current.openingElement.tagName.getText(sourceFile) === "label") return true;
    current = current.parent;
  }
  return false;
}

function classNamesFromOpening(opening, sourceFile) {
  const classes = new Set();
  const classAttribute = jsxAttribute(opening, "className", sourceFile);
  if (classAttribute?.initializer && ts.isStringLiteral(classAttribute.initializer)) {
    addClassTokens(classAttribute.initializer.text, classes);
  } else if (classAttribute?.initializer && ts.isJsxExpression(classAttribute.initializer)) {
    collectClassNamesFromExpression(classAttribute.initializer.expression, classes);
  }
  return classes;
}

function collectAncestorClassNames(node, sourceFile) {
  const classes = new Set();
  let current = node.parent;
  while (current) {
    if (ts.isJsxElement(current)) {
      for (const className of classNamesFromOpening(current.openingElement, sourceFile)) classes.add(className);
    }
    current = current.parent;
  }
  return classes;
}

function collectReleaseElements() {
  const elements = [];
  const intrinsicInteractiveTags = new Set(["button", "a", "input", "select", "textarea"]);

  for (const absolutePath of releaseTsxFiles) {
    const source = readFileSync(absolutePath, "utf8");
    const sourceFile = ts.createSourceFile(absolutePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node) => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tagName = node.tagName.getText(sourceFile);
        const roleValues = jsxAttributeValues(jsxAttribute(node, "role", sourceFile));
        const typeValues = jsxAttributeValues(jsxAttribute(node, "type", sourceFile));
        const hidden = Boolean(jsxAttribute(node, "hidden", sourceFile));
        const isInteractive = intrinsicInteractiveTags.has(tagName)
          || tagName === "Link"
          || tagName === "NavLink"
          || roleValues.has("button");
        const skipDelegatedInput = tagName === "input" && isInsideLabel(node, sourceFile);
        if (isInteractive && !hidden && !typeValues.has("hidden") && !skipDelegatedInput) {
          const classes = classNamesFromOpening(node, sourceFile);
          const styleAttribute = jsxAttribute(node, "style", sourceFile);
          const styles = styleAttribute?.initializer && ts.isJsxExpression(styleAttribute.initializer)
            ? styleObjectsFromExpression(styleAttribute.initializer.expression)
            : [];
          elements.push({
            path: displayPath(absolutePath),
            line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
            tagName,
            renderedTag: tagName === "Link" || tagName === "NavLink" ? "a" : tagName,
            classes,
            ancestorClasses: collectAncestorClassNames(node, sourceFile),
            styles,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return elements;
}

const releaseElements = collectReleaseElements();

function collectReleaseInlineStyles() {
  const entries = [];
  for (const absolutePath of releaseTsxFiles) {
    const source = readFileSync(absolutePath, "utf8");
    const sourceFile = ts.createSourceFile(absolutePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node) => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const styleAttribute = jsxAttribute(node, "style", sourceFile);
        if (styleAttribute?.initializer && ts.isJsxExpression(styleAttribute.initializer)) {
          for (const declarations of styleObjectsFromExpression(styleAttribute.initializer.expression)) {
            entries.push({
              path: displayPath(absolutePath),
              line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
              tagName: node.tagName.getText(sourceFile),
              classes: classNamesFromOpening(node, sourceFile),
              declarations,
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return entries;
}

const releaseInlineStyles = collectReleaseInlineStyles();

function selectorTargetsClass(selector, className) {
  return splitTopLevel(selector, ",").some((part) => {
    if (/::(?:before|after)\b/.test(part)) return false;
    const lastCompound = part.trim().split(/\s+|>|\+|~/).at(-1) ?? "";
    return new RegExp(`\\.${className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9_-])`, "i").test(lastCompound);
  });
}

function selectorTargetsElement(selector, element) {
  return splitTopLevel(selector, ",").some((arm) => {
    if (/::(?:before|after)\b/.test(arm)) return false;
    const compounds = arm.trim().split(/\s+|>|\+|~/).filter(Boolean);
    const target = compounds.at(-1) ?? "";
    const targetWithoutFunctionalPseudos = target.replace(/:[a-z-]+\([^)]*\)/gi, "");
    const targetClasses = [...targetWithoutFunctionalPseudos.matchAll(/\.([a-z][a-z0-9_-]*)/gi)]
      .map((match) => match[1]);
    if (!targetClasses.every((className) => element.classes.has(className))) return false;
    const tag = targetWithoutFunctionalPseudos.match(/^([a-z][a-z0-9-]*)/i)?.[1];
    if (tag && tag.toLowerCase() !== element.renderedTag.toLowerCase()) return false;

    const ancestorClasses = compounds.slice(0, -1).flatMap((compound) =>
      [...compound.replace(/:[a-z-]+\([^)]*\)/gi, "").matchAll(/\.([a-z][a-z0-9_-]*)/gi)]
        .map((match) => match[1]));
    return ancestorClasses.every((className) => element.ancestorClasses.has(className));
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

function withCssBlocks(files) {
  return files.flatMap((absolutePath) => cssBlocks(readFileSync(absolutePath, "utf8"))
    .map((block) => ({ ...block, path: displayPath(absolutePath) })));
}

const releaseBlocks = withCssBlocks(releaseCssFiles);

function rootClassBlock(path, className) {
  return releaseBlocks.find((block) => block.path === path && block.selectors.includes(`.${className}`)) ?? null;
}

function mediaAppliesAtWidth(atRules, width) {
  for (const atRule of atRules) {
    if (!/^@media\b/i.test(atRule)) continue;
    const minWidths = [...atRule.matchAll(/min-width\s*:\s*([0-9.]+)px/gi)].map((match) => Number(match[1]));
    const maxWidths = [...atRule.matchAll(/max-width\s*:\s*([0-9.]+)px/gi)].map((match) => Number(match[1]));
    if (minWidths.some((minimum) => width < minimum) || maxWidths.some((maximum) => width > maximum)) return false;
  }
  return true;
}

function selectorStyleAtWidth(path, selector, width) {
  const declarations = [];
  for (const block of releaseBlocks) {
    if (block.path !== path || !block.selectors.includes(selector) || !mediaAppliesAtWidth(block.atRules, width)) continue;
    declarations.push(...block.declarations);
  }
  return declarations;
}

function classStyleAtWidth(path, className, width) {
  return selectorStyleAtWidth(path, `.${className}`, width);
}

function splitCssWhitespace(value) {
  const parts = [];
  let start = 0;
  let round = 0;
  let quote = null;
  for (let index = 0; index <= value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "(") round += 1;
    else if (character === ")") round -= 1;
    else if ((index === value.length || /\s/.test(character)) && round === 0) {
      if (value.slice(start, index).trim()) parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  return parts;
}

function horizontalInsetsFromPadding(value) {
  const parts = splitCssWhitespace(value ?? "");
  const pixels = parts.map(resolvePixels);
  if (pixels.length === 1) return [pixels[0], pixels[0]];
  if (pixels.length === 2 || pixels.length === 3) return [pixels[1], pixels[1]];
  if (pixels.length >= 4) return [pixels[3], pixels[1]];
  return [null, null];
}

function cssVariableReferences(value) {
  return [...value.matchAll(/var\(\s*(--[a-z0-9_-]+)\s*(,)?/gi)].map((match) => ({
    name: match[1],
    hasFallback: Boolean(match[2]),
  }));
}

test("release CSS의 fallback 없는 var()는 tokens·data-accent 또는 CSS 정본에 정의되어 있다", () => {
  const definitionBlocks = withCssBlocks(cssVariableDefinitionFiles);
  const definedVariables = new Set(definitionBlocks.flatMap((block) => block.declarations
    .filter((declaration) => declaration.property.startsWith("--"))
    .map((declaration) => declaration.property)));
  // CSS에서 소비하는 runtime custom property도 TSX style object가 실제 선언하면 정본 정의로 인정합니다.
  for (const inline of releaseInlineStyles) {
    for (const declaration of inline.declarations) {
      if (declaration.property.startsWith("--")) definedVariables.add(declaration.property);
    }
  }
  const violations = [];

  for (const block of releaseBlocks) {
    for (const declaration of block.declarations) {
      for (const reference of cssVariableReferences(declaration.value)) {
        if (!reference.hasFallback && !definedVariables.has(reference.name)) {
          violations.push(`${block.path}:${block.line} ${block.selector} (${declaration.property}: ${reference.name})`);
        }
      }
    }
  }

  assert.deepEqual(violations, [], `undefined CSS var ${violations.length}건:\n${violations.join("\n")}`);
});

test("release TSX inline style의 fontSize와 크기 값은 type token 또는 정본 4px·icon 척도를 사용한다", () => {
  const violations = [];
  const dimensionProperties = new Set(["min-height", "min-width", "height", "width"]);

  for (const entry of releaseInlineStyles) {
    const isInteractive = releaseElements.some((element) => element.path === entry.path && element.line === entry.line);
    const isVisualAsset = entry.tagName === "img" || entry.tagName === "svg";
    for (const declaration of entry.declarations) {
      if (declaration.property === "font-size") {
        const typeToken = declaration.value?.match(/^var\((--type-[a-z-]+)\)$/)?.[1];
        if (!typeToken || !typeRoles.has(typeToken)) {
          violations.push(`${entry.path}:${entry.line} <${entry.tagName}> (fontSize: ${declaration.value ?? "동적/비정본"})`);
        }
        continue;
      }
      if (!dimensionProperties.has(declaration.property) || declaration.value == null) continue;
      const pixels = resolvePixels(declaration.value);
      if (pixels == null) continue;
      if (isVisualAsset) continue;
      if (isInteractive && pixels >= 44) continue;
      const isCanonicalDimension = pixels === 0 || pixels % 4 === 0 || pixels === 18 || pixels === 22;
      if (!isCanonicalDimension) {
        violations.push(`${entry.path}:${entry.line} <${entry.tagName}> (${declaration.property}: ${declaration.value})`);
      }
    }
  }

  assert.deepEqual(violations, [], `inline style 크기 위반 ${violations.length}건:\n${violations.join("\n")}`);
});

test("AppShell 내부 6개 nested screen은 viewport를 다시 점유하는 100dvh를 사용하지 않는다", () => {
  const nestedShells = [
    ["src/screens/child/AiFriendSetup.css", "afs"],
    ["src/screens/feature/DaySummary.css", "ds-screen"],
    ["src/screens/feature/Notifications.css", "nc-root"],
    ["src/screens/feature/PhoneSetup.css", "psu-screen"],
    ["src/screens/feature/PlaceManager.css", "pm-screen"],
    ["src/screens/feature/ProfileEdit.css", "pe-root"],
  ];
  const violations = nestedShells.flatMap(([path, className]) => {
    const block = rootClassBlock(path, className);
    const minHeight = block && declarationValue(block.declarations, "min-height");
    return minHeight === "100dvh" || minHeight === "100vh"
      ? [`${path}:${block.line} .${className} (min-height: ${minHeight})`]
      : [];
  });

  assert.deepEqual(violations, [], `nested 100dvh 위반 ${violations.length}건:\n${violations.join("\n")}`);
});

test("명시된 semantic surface root는 역할별 radius와 shadow를 직접 선언한다", () => {
  const surfaces = [
    ["src/screens/parent/ParentFamily.css", "pf-parents", "card"],
    ["src/screens/parent/ParentFamily.css", "pf-child", "card"],
    ["src/screens/parent/ParentAccount.css", "pa-profile", "hero"],
    ["src/screens/child/ChildHome.css", "kd-tile", "card"],
    ["src/screens/feature/AiCredit.css", "ac-pack", "card"],
    ["src/screens/feature/AiCredit.css", "ac-auto", "card"],
    ["src/screens/onboarding/Onboarding.css", "ob-consent-dialog", "modal"],
    ["src/components/MapPickerSheet.css", "mps-sheet", "sheet"],
    ["src/components/MessageSafetyDialog.css", "msd-dialog", "modal"],
  ];
  const specs = {
    card: { radius: ["var(--radius-16)"], shadow: ["none", "var(--shadow-soft)"] },
    hero: { radius: ["var(--radius-20)"], shadow: ["none", "var(--shadow-soft)", "var(--shadow-floating)"] },
    modal: { radius: ["var(--radius-20)"], shadow: ["var(--shadow-modal)"] },
    sheet: { radius: ["var(--radius-24) var(--radius-24) 0 0"], shadow: ["var(--shadow-modal)"] },
  };
  const violations = [];

  for (const [path, className, role] of surfaces) {
    const block = rootClassBlock(path, className);
    if (!block) {
      violations.push(`${path} .${className} (root selector 누락)`);
      continue;
    }
    const radius = declarationValue(block.declarations, "border-radius");
    const shadow = declarationValue(block.declarations, "box-shadow");
    if (!specs[role].radius.includes(radius)) {
      violations.push(`${path}:${block.line} .${className} (${role} radius ${radius ?? "누락"})`);
    }
    if (!specs[role].shadow.includes(shadow)) {
      violations.push(`${path}:${block.line} .${className} (${role} shadow ${shadow ?? "누락"})`);
    }
  }

  assert.deepEqual(violations, [], `semantic surface 위반 ${violations.length}건:\n${violations.join("\n")}`);
});

test("ParentCalendar는 360px에서 7열 44px hit area와 17px dots 행을 overflow 없이 보장한다", () => {
  const path = "src/screens/parent/ParentCalendar.css";
  const body = classStyleAtWidth(path, "pc-body", 360);
  const card = classStyleAtWidth(path, "pc-card", 360);
  const grid = classStyleAtWidth(path, "pc-grid", 360);
  const day = classStyleAtWidth(path, "pc-day", 360);
  const dots = classStyleAtWidth(path, "pc-day__dots", 360);
  const [bodyLeft, bodyRight] = horizontalInsetsFromPadding(declarationValue(body, "padding"));
  const [cardLeft, cardRight] = horizontalInsetsFromPadding(declarationValue(card, "padding"));
  const gridGapParts = splitCssWhitespace(declarationValue(grid, "gap") ?? "");
  const columnGap = resolvePixels(gridGapParts.at(-1)) ?? 0;
  const available = 360 - (bodyLeft ?? 0) - (bodyRight ?? 0) - (cardLeft ?? 0) - (cardRight ?? 0);
  const required = 7 * 44 + 6 * columnGap;
  const trackWidth = (available - 6 * columnGap) / 7;
  const dayHeight = Math.max(
    resolvePixels(declarationValue(day, "height")) ?? 0,
    resolvePixels(declarationValue(day, "min-height")) ?? 0,
  );
  const dotsHeight = Math.max(
    resolvePixels(declarationValue(dots, "height")) ?? 0,
    resolvePixels(declarationValue(dots, "min-height")) ?? 0,
  );
  const violations = [];
  if (trackWidth < 44) violations.push(`${path} .pc-grid (360px 열 폭 ${trackWidth.toFixed(2)}px)`);
  if (required > available) violations.push(`${path} .pc-grid (필요 ${required}px > 가용 ${available}px, 가로 overflow)`);
  if (dayHeight < 44) violations.push(`${path} .pc-day (높이 ${dayHeight || "미지정"}px)`);
  if (dotsHeight < 17) violations.push(`${path} .pc-day__dots (높이 ${dotsHeight || "미지정"}px)`);

  assert.deepEqual(violations, [], `360px calendar 위반 ${violations.length}건:\n${violations.join("\n")}`);
});

test("TeacherNotice는 360px에서 toggle·파일 삭제의 hit와 visual 크기를 분리하고 긴 파일명을 자른다", () => {
  const path = "src/screens/teacher/TeacherNotice.css";
  const toggle = classStyleAtWidth(path, "tn-toggle", 360);
  const knob = classStyleAtWidth(path, "tn-toggle__knob", 360);
  const fileRemove = classStyleAtWidth(path, "tn-file-chip__x", 360);
  const fileRemoveVisual = selectorStyleAtWidth(path, ".tn-file-chip__x::before", 360);
  const fileName = classStyleAtWidth(path, "tn-file-chip__name", 360);
  const fileChip = classStyleAtWidth(path, "tn-file-chip", 360);
  const violations = [];

  const toggleHitHeight = Math.max(
    resolvePixels(declarationValue(toggle, "height")) ?? 0,
    resolvePixels(declarationValue(toggle, "min-height")) ?? 0,
  );
  const toggleWidth = Math.max(
    resolvePixels(declarationValue(toggle, "width")) ?? 0,
    resolvePixels(declarationValue(toggle, "min-width")) ?? 0,
  );
  if (toggleHitHeight < 44 || toggleWidth < 44) {
    violations.push(`${path} .tn-toggle (hit ${toggleWidth || "?"}×${toggleHitHeight || "?"})`);
  }
  if (declarationValue(toggle, "height") !== "28px"
    || declarationValue(toggle, "padding-block") !== "8px"
    || declarationValue(toggle, "background-clip") !== "content-box") {
    violations.push(`${path} .tn-toggle (28px visual track 분리 누락)`);
  }
  if (declarationValue(knob, "top") !== "11px") {
    violations.push(`${path} .tn-toggle__knob (44px hit 기준 optical top ${declarationValue(knob, "top") ?? "누락"})`);
  }

  const fileHitHeight = Math.max(
    resolvePixels(declarationValue(fileRemove, "height")) ?? 0,
    resolvePixels(declarationValue(fileRemove, "min-height")) ?? 0,
  );
  const fileHitWidth = Math.max(
    resolvePixels(declarationValue(fileRemove, "width")) ?? 0,
    resolvePixels(declarationValue(fileRemove, "min-width")) ?? 0,
  );
  if (fileHitHeight < 44 || fileHitWidth < 44) {
    violations.push(`${path} .tn-file-chip__x (hit ${fileHitWidth || "?"}×${fileHitHeight || "?"})`);
  }
  if (declarationValue(fileRemoveVisual, "width") !== "18px"
    || declarationValue(fileRemoveVisual, "height") !== "18px"
    || !declarationValue(fileRemoveVisual, "background")) {
    violations.push(`${path} .tn-file-chip__x::before (18px visual 원형 누락)`);
  }
  if (declarationValue(fileName, "min-width") !== "0"
    || declarationValue(fileName, "overflow") !== "hidden"
    || declarationValue(fileName, "text-overflow") !== "ellipsis"
    || declarationValue(fileName, "white-space") !== "nowrap") {
    violations.push(`${path} .tn-file-chip__name (긴 파일명 ellipsis 계약 누락)`);
  }
  if (declarationValue(fileChip, "max-width") !== "100%"
    || declarationValue(fileChip, "box-sizing") !== "border-box") {
    violations.push(`${path} .tn-file-chip (360px overflow 방지 계약 누락)`);
  }

  assert.deepEqual(violations, [], `TeacherNotice 360px 위반 ${violations.length}건:\n${violations.join("\n")}`);
});

test("release import graph의 읽는 텍스트는 의미 type token을 세 속성 묶음으로 사용한다", () => {
  const violations = [];

  for (const absolutePath of releaseCssFiles) {
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

test("실제 JSX 상호작용 요소는 모든 viewport에서 최소 세로 44px을 명시하고 소형 정사각형은 가로도 보장한다", () => {
  const violations = [];

  for (const element of releaseElements) {
    const rules = releaseBlocks.filter((block) => selectorTargetsElement(block.selector, element));
    const mediaScopes = new Set(["base", ...rules.flatMap((rule) => {
      const media = rule.atRules.filter((atRule) => /^@media\b/i.test(atRule) && /(?:min|max)-width\s*:/i.test(atRule));
      return media.length > 0 ? [media.join(" && ")] : [];
    })]);

    for (const scope of mediaScopes) {
      const scopedRules = rules.filter((rule) => {
        const widthMedia = rule.atRules.filter((atRule) => /^@media\b/i.test(atRule) && /(?:min|max)-width\s*:/i.test(atRule)).join(" && ");
        const nonWidthMedia = rule.atRules.some((atRule) => /^@media\b/i.test(atRule) && !/(?:min|max)-width\s*:/i.test(atRule));
        if (nonWidthMedia) return false;
        return widthMedia === "" || (scope !== "base" && widthMedia === scope);
      });
      const declarations = [
        ...scopedRules.flatMap((rule) => rule.declarations),
        ...element.styles.flat(),
      ];
      const heights = ["height", "min-height"].flatMap((property) => declarations
        .filter((declaration) => declaration.property === property)
        .map((declaration) => resolvePixels(declaration.value))
        .filter(Number.isFinite));
      const widths = ["width", "min-width"].flatMap((property) => declarations
        .filter((declaration) => declaration.property === property)
        .map((declaration) => resolvePixels(declaration.value))
        .filter(Number.isFinite));
      const fillsContainingBlock = declarations.some((declaration) => declaration.property === "inset" && /^0(?:px)?$/i.test(declaration.value));
      const hasAdequateHeight = fillsContainingBlock || heights.some((height) => height >= 44);
      const hasExplicitSmallSquare = heights.some((height) => height < 44) && widths.some((width) => width < 44);
      const hasAdequateWidth = fillsContainingBlock || widths.some((width) => width >= 44);
      if (!hasAdequateHeight || (hasExplicitSmallSquare && !hasAdequateWidth)) {
        violations.push(`${element.path}:${element.line} <${element.tagName}> ${[...element.classes].map((name) => `.${name}`).join(" ") || "class 없음"} [${scope}] (높이 ${heights.join("/") || "미지정"}, 너비 ${widths.join("/") || "미지정"})`);
      }
    }
  }

  assert.deepEqual(violations, [], `44px hit area 또는 크기 명시 위반 ${violations.length}건:\n${violations.slice(0, 160).join("\n")}`);
});

test("출시 화면에는 848px 고정 프레임이 없다", () => {
  const fixedFrames = [];

  for (const absolutePath of releaseCssFiles) {
    for (const block of cssBlocks(readFileSync(absolutePath, "utf8"))) {
      if (declarationValue(block.declarations, "min-height") === "848px") {
        fixedFrames.push(`${displayPath(absolutePath)}:${block.line} ${block.selector}`);
      }
    }
  }

  assert.deepEqual(fixedFrames, [], `848px 고정 프레임 ${fixedFrames.length}건:\n${fixedFrames.join("\n")}`);
});

test("출시 화면은 브라우저 focus outline을 제거하지 않는다", () => {
  const hiddenFocus = [];

  for (const absolutePath of releaseCssFiles) {
    for (const block of cssBlocks(readFileSync(absolutePath, "utf8"))) {
      if (declarationValue(block.declarations, "outline") === "none") {
        hiddenFocus.push(`${displayPath(absolutePath)}:${block.line} ${block.selector}`);
      }
    }
  }

  assert.deepEqual(hiddenFocus, [], `outline:none ${hiddenFocus.length}건:\n${hiddenFocus.join("\n")}`);
});

const optical2pxSpacingAllowlist = new Set([
  // 360px 화면에서 66px SOS와 pill 독의 합산 폭을 보존하는 기존 좌우 14px optical inset입니다.
  "src/app/ChildDock.css|.kdock|padding",
  // 정사각 로고 raster가 baseline보다 아래로 처져 보이지 않도록 아래쪽만 0으로 맞춘 optical inset입니다.
  "src/styles/components.css|.hy-topbar__logo|padding",
  // 7열 캘린더의 일정 점과 숫자 사이를 분리하는 micro-density 간격입니다.
  "src/screens/parent/ParentCalendar.css|.pc-grid|gap",
  "src/screens/parent/ParentCalendar.css|.pc-day|gap",
  "src/screens/parent/ParentCalendar.css|.pc-day__dots|gap",
  // 음성 waveform bar 사이의 시각적 박자를 유지하는 장식 전용 간격입니다.
  "src/screens/feature/AiSchedule.css|.ais-wave|gap",
  // 작은 상태 capsule의 세로 2px은 44px hit box와 분리된 내부 optical padding입니다.
  "src/screens/shared/MemoChat.css|.mc-safety-action|padding",
  "src/screens/child/AiFriendChat.css|.afc-report-link|padding",
  "src/screens/parent/ParentHome.css|.ph-child__now|padding",
]);

test("출시 화면의 단순 padding과 gap은 4px 리듬을 사용한다", () => {
  const violations = [];
  const spacingProperties = /^(?:padding(?:-(?:top|right|bottom|left|block|inline))?|gap|row-gap|column-gap)$/;

  for (const absolutePath of releaseCssFiles) {
    for (const block of cssBlocks(readFileSync(absolutePath, "utf8"))) {
      for (const declaration of block.declarations) {
        if (!spacingProperties.test(declaration.property)) continue;
        const literals = [...declaration.value.matchAll(/(?<![-\w])([0-9.]+)px\b/g)].map((item) => Number.parseFloat(item[1]));
        const allowOpticalTwo = optical2pxSpacingAllowlist.has(
          `${displayPath(absolutePath)}|${block.selector}|${declaration.property}`,
        );
        const offGrid = literals.filter((value) => value !== 0 && value % 4 !== 0 && !(value % 4 === 2 && allowOpticalTwo));
        if (offGrid.length > 0) {
          violations.push(`${displayPath(absolutePath)}:${block.line} ${block.selector} (${declaration.property}: ${declaration.value})`);
        }
      }
    }
  }

  assert.deepEqual(violations, [], `spacing rhythm 위반 ${violations.length}건:\n${violations.slice(0, 120).join("\n")}`);
});

test("sticky/fixed 화면 header는 상단 safe area를 포함한다", () => {
  const violations = [];

  for (const absolutePath of releaseCssFiles) {
    for (const block of cssBlocks(readFileSync(absolutePath, "utf8"))) {
      if (!/(?:^|[-_])(header|topbar)\b/i.test(block.selector)) continue;
      if (!/^(?:sticky|fixed)$/i.test(declarationValue(block.declarations, "position") ?? "")) continue;
      if (!/^0(?:px)?$/i.test(declarationValue(block.declarations, "top") ?? "")) continue;
      if (!block.declarations.some((declaration) => /safe-area-inset-top/i.test(declaration.value))) {
        violations.push(`${displayPath(absolutePath)}:${block.line} ${block.selector}`);
      }
    }
  }

  assert.deepEqual(violations, [], `safe-area 누락 header ${violations.length}건:\n${violations.join("\n")}`);
});

test("카드·hero·modal·sheet 표면은 정본 radius와 elevation만 사용한다", () => {
  const violations = [];
  const expectedRadius = { card: "--radius-16", panel: "--radius-16", hero: "--radius-20", modal: "--radius-20", sheet: "--radius-24" };

  for (const absolutePath of releaseCssFiles) {
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

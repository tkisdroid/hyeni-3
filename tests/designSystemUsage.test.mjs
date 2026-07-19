import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, posix, relative, resolve, sep } from "node:path";
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
  ...collectFiles(join(repoRoot, "src", "styles"), ".css"),
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
    const rawValue = raw.slice(separator + 1).trim();
    const important = /!\s*important\s*$/i.test(rawValue);
    const value = rawValue.replace(/!\s*important\s*$/i, "").trim();
    return property && value ? [{ property, value, important }] : [];
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

function staticJsxAttributeValues(expression, sourceFile, bindings, seen = new Set()) {
  if (!expression) return { resolved: false, values: [] };
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression)
    || ts.isTypeAssertionExpression(expression) || ts.isNonNullExpression(expression)) {
    return staticJsxAttributeValues(expression.expression, sourceFile, bindings, seen);
  }
  if (ts.isStringLiteralLike(expression) || ts.isNumericLiteral(expression)) {
    return { resolved: true, values: [expression.text] };
  }
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return { resolved: true, values: ["true"] };
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return { resolved: true, values: ["false"] };
  if (ts.isPrefixUnaryExpression(expression) && ts.isNumericLiteral(expression.operand)) {
    const sign = expression.operator === ts.SyntaxKind.MinusToken ? -1 : 1;
    return { resolved: true, values: [String(sign * Number(expression.operand.text))] };
  }
  if (ts.isConditionalExpression(expression)) {
    const left = staticJsxAttributeValues(expression.whenTrue, sourceFile, bindings, seen);
    const right = staticJsxAttributeValues(expression.whenFalse, sourceFile, bindings, seen);
    return left.resolved && right.resolved
      ? { resolved: true, values: [...new Set([...left.values, ...right.values])] }
      : { resolved: false, values: [] };
  }
  if (ts.isIdentifier(expression)) {
    if (seen.has(expression.text)) return { resolved: false, values: [] };
    const candidates = (bindings.get(expression.text) ?? [])
      .filter((candidate) => candidate.position <= expression.getStart(sourceFile))
      .sort((left, right) => right.position - left.position);
    const initializer = candidates[0]?.initializer;
    return initializer
      ? staticJsxAttributeValues(initializer, sourceFile, bindings, new Set([...seen, expression.text]))
      : { resolved: false, values: [] };
  }
  return { resolved: false, values: [] };
}

function attributesFromOpening(opening, sourceFile, bindings) {
  const attributes = new Map();
  for (const attribute of opening.attributes.properties) {
    if (!ts.isJsxAttribute(attribute)) continue;
    const name = attribute.name.getText(sourceFile).toLowerCase();
    if (!attribute.initializer) {
      attributes.set(name, { present: true, values: new Set([""]), dynamic: false });
      continue;
    }
    if (ts.isStringLiteral(attribute.initializer)) {
      attributes.set(name, { present: true, values: new Set([attribute.initializer.text]), dynamic: false });
      continue;
    }
    if (ts.isJsxExpression(attribute.initializer)) {
      const result = staticJsxAttributeValues(attribute.initializer.expression, sourceFile, bindings);
      attributes.set(name, { present: true, values: new Set(result.values), dynamic: !result.resolved });
    }
  }
  return attributes;
}

function collectBindingInitializers(sourceFile) {
  const bindings = new Map();
  const add = (name, initializer, position) => {
    if (!initializer) return;
    const entries = bindings.get(name) ?? [];
    entries.push({ initializer, position });
    bindings.set(name, entries);
  };
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      add(node.name.text, node.initializer, node.getStart(sourceFile));
    } else if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
      add(node.name.text, node.initializer, node.getStart(sourceFile));
    } else if (ts.isBindingElement(node) && ts.isIdentifier(node.name)) {
      add(node.name.text, node.initializer, node.getStart(sourceFile));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return bindings;
}

function staticStyleValues(expression, sourceFile, bindings, seen = new Set()) {
  if (!expression) return { resolved: false, values: [] };
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression)
    || ts.isTypeAssertionExpression(expression) || ts.isNonNullExpression(expression)) {
    return staticStyleValues(expression.expression, sourceFile, bindings, seen);
  }
  if (ts.isNumericLiteral(expression)) return { resolved: true, values: [`${expression.text}px`] };
  if (ts.isStringLiteralLike(expression)) return { resolved: true, values: [expression.text] };
  if (ts.isPrefixUnaryExpression(expression) && ts.isNumericLiteral(expression.operand)) {
    const sign = expression.operator === ts.SyntaxKind.MinusToken ? -1 : 1;
    return { resolved: true, values: [`${sign * Number(expression.operand.text)}px`] };
  }
  if (ts.isConditionalExpression(expression)) {
    const left = staticStyleValues(expression.whenTrue, sourceFile, bindings, seen);
    const right = staticStyleValues(expression.whenFalse, sourceFile, bindings, seen);
    return left.resolved && right.resolved
      ? { resolved: true, values: [...new Set([...left.values, ...right.values])] }
      : { resolved: false, values: [] };
  }
  if (ts.isIdentifier(expression)) {
    if (seen.has(expression.text)) return { resolved: false, values: [] };
    const candidates = (bindings.get(expression.text) ?? [])
      .filter((candidate) => candidate.position <= expression.getStart(sourceFile))
      .sort((left, right) => right.position - left.position);
    const initializer = candidates[0]?.initializer;
    if (!initializer) return { resolved: false, values: [] };
    return staticStyleValues(initializer, sourceFile, bindings, new Set([...seen, expression.text]));
  }
  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
    const candidates = (bindings.get(expression.expression.text) ?? [])
      .filter((candidate) => candidate.position <= expression.getStart(sourceFile))
      .sort((left, right) => right.position - left.position);
    const initializer = candidates[0]?.initializer;
    if (initializer && ts.isObjectLiteralExpression(initializer)) {
      const property = initializer.properties.find((entry) =>
        ts.isPropertyAssignment(entry) && entry.name.getText(sourceFile).replace(/^['"]|['"]$/g, "") === expression.name.text);
      if (property && ts.isPropertyAssignment(property)) {
        return staticStyleValues(property.initializer, sourceFile, bindings, seen);
      }
    }
  }
  return { resolved: false, values: [] };
}

function styleObjectsFromExpression(expression, sourceFile, bindings) {
  if (!expression) return [];
  if (ts.isParenthesizedExpression(expression)) return styleObjectsFromExpression(expression.expression, sourceFile, bindings);
  if (ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression)) {
    return styleObjectsFromExpression(expression.expression, sourceFile, bindings);
  }
  if (ts.isConditionalExpression(expression)) {
    return [
      ...styleObjectsFromExpression(expression.whenTrue, sourceFile, bindings),
      ...styleObjectsFromExpression(expression.whenFalse, sourceFile, bindings),
    ];
  }
  if (!ts.isObjectLiteralExpression(expression)) return [];
  const declarations = [];
  for (const property of expression.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = property.name.getText().replace(/^['"]|['"]$/g, "");
    const valueNode = property.initializer;
    const result = staticStyleValues(valueNode, sourceFile, bindings);
    declarations.push({
      property: name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`),
      value: result.values.length === 1 ? result.values[0] : null,
      values: result.values,
      resolved: result.resolved,
      node: valueNode,
    });
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

function collectAncestorDescriptors(node, sourceFile, bindings) {
  const ancestors = [];
  let current = node.parent;
  while (current) {
    if (ts.isJsxElement(current) && current.openingElement !== node) {
      const opening = current.openingElement;
      const tagName = opening.tagName.getText(sourceFile);
      ancestors.push({
        renderedTag: tagName === "Link" || tagName === "NavLink" ? "a" : tagName,
        classes: classNamesFromOpening(opening, sourceFile),
        attributes: attributesFromOpening(opening, sourceFile, bindings),
        states: new Set(),
      });
    }
    current = current.parent;
  }
  if (!ancestors.some((ancestor) => ancestor.renderedTag.toLowerCase() === "body")) {
    ancestors.push({ renderedTag: "body", classes: new Set(), attributes: new Map(), states: new Set() });
  }
  return ancestors;
}

function collectElementsFromSource(path, source) {
  const elements = [];
  const intrinsicInteractiveTags = new Set(["button", "a", "input", "select", "textarea"]);
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const bindings = collectBindingInitializers(sourceFile);
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
        const attributes = attributesFromOpening(node, sourceFile, bindings);
        const ancestors = collectAncestorDescriptors(node, sourceFile, bindings);
        const ancestorClasses = new Set(ancestors.flatMap((ancestor) => [...ancestor.classes]));
        const styleAttribute = jsxAttribute(node, "style", sourceFile);
        const styles = styleAttribute?.initializer && ts.isJsxExpression(styleAttribute.initializer)
          ? styleObjectsFromExpression(styleAttribute.initializer.expression, sourceFile, bindings)
          : [];
        const states = new Set();
        if (attributes.has("disabled")) states.add("disabled");
        if (attributes.has("checked")) states.add("checked");
        elements.push({
          path,
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
          tagName,
          renderedTag: tagName === "Link" || tagName === "NavLink" ? "a" : tagName,
          classes,
          attributes,
          ancestors,
          ancestorClasses,
          states,
          styles,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return elements;
}

function collectReleaseElements() {
  return releaseTsxFiles.flatMap((absolutePath) => collectElementsFromSource(
    displayPath(absolutePath),
    readFileSync(absolutePath, "utf8"),
  ));
}

const releaseElements = collectReleaseElements();

function collectInlineStylesFromSource(path, source) {
  const entries = [];
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const bindings = collectBindingInitializers(sourceFile);
  const visit = (node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const styleAttribute = jsxAttribute(node, "style", sourceFile);
      if (styleAttribute?.initializer && ts.isJsxExpression(styleAttribute.initializer)) {
        for (const declarations of styleObjectsFromExpression(styleAttribute.initializer.expression, sourceFile, bindings)) {
          entries.push({
            path,
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
  return entries;
}

function collectReleaseInlineStyles() {
  return releaseTsxFiles.flatMap((absolutePath) => collectInlineStylesFromSource(
    displayPath(absolutePath),
    readFileSync(absolutePath, "utf8"),
  ));
}

const releaseInlineStyles = collectReleaseInlineStyles();

function inlineStyleKey(entry, declaration) {
  return `${entry.path}:${entry.line}|${[...entry.classes].sort().join(".") || entry.tagName}|${declaration.property}`;
}

const inlineDynamicScaleAllowlist = new Set([
  // 실제 진행률을 퍼센트로 표시하는 fill은 runtime 데이터에 따라 매 렌더 달라집니다.
  "src/screens/child/ChildHome.tsx:497|kd-prep__fill|width",
  "src/screens/child/StickerBook.tsx:73|sb-progress__fill|width",
  "src/screens/feature/DailySafetyReport.tsx:720|span|width",
  "src/screens/onboarding/Onboarding.tsx:544|ob-progress__fill|width",
  // confetti 조각은 9/13px, 9/14px optical 장식이며 조작·레이아웃 surface가 아닙니다.
  "src/screens/child/overlays/Celebrate.tsx:49|ks-confetti|width",
  "src/screens/child/overlays/Celebrate.tsx:49|ks-confetti|height",
  // 사용자가 드래그하는 지도 높이는 160~520px 연속값이라 4px 단위로 양자화하지 않습니다.
  "src/screens/feature/PlaceForm.tsx:239|pf-map|height",
]);

function inlineScaleViolations(entries, elements = [], dynamicAllowlist = new Set()) {
  const violations = [];
  const dimensionProperties = new Set(["min-height", "min-width", "height", "width"]);
  const spacingProperties = /^(?:(?:padding|margin)(?:-(?:top|right|bottom|left|block|inline))?|gap|row-gap|column-gap)$/;

  for (const entry of entries) {
    const isInteractive = elements.some((element) => element.path === entry.path && element.line === entry.line);
    const isVisualAsset = entry.tagName === "img" || entry.tagName === "svg";
    for (const declaration of entry.declarations) {
      if (declaration.property === "font-size") {
        const typeToken = declaration.value?.match(/^var\((--type-[a-z-]+)\)$/)?.[1];
        if (!typeToken || !typeRoles.has(typeToken)) {
          violations.push(`${entry.path}:${entry.line} <${entry.tagName}> (fontSize: ${declaration.value ?? "동적/비정본"})`);
        }
        continue;
      }
      if (!dimensionProperties.has(declaration.property) && !spacingProperties.test(declaration.property)) continue;
      if (!declaration.resolved) {
        if (!dynamicAllowlist.has(inlineStyleKey(entry, declaration))) {
          violations.push(`${entry.path}:${entry.line} <${entry.tagName}> (${declaration.property}: 동적/해석 불가)`);
        }
        continue;
      }
      for (const value of declaration.values) {
        const pixels = resolvePixels(value);
        if (pixels == null) continue;
        if (dimensionProperties.has(declaration.property)) {
          if (isVisualAsset) continue;
          if (isInteractive && pixels >= 44) continue;
          const isCanonicalDimension = pixels === 0 || pixels % 4 === 0 || pixels === 18 || pixels === 22;
          if (!isCanonicalDimension) {
            violations.push(`${entry.path}:${entry.line} <${entry.tagName}> (${declaration.property}: ${value})`);
          }
        } else if (pixels !== 0 && Math.abs(pixels) % 4 !== 0) {
          violations.push(`${entry.path}:${entry.line} <${entry.tagName}> (${declaration.property}: ${value})`);
        }
      }
    }
  }
  return violations;
}

function selectorTargetsClass(selector, className) {
  return splitTopLevel(selector, ",").some((part) => {
    if (/::(?:before|after)\b/.test(part)) return false;
    const lastCompound = part.trim().split(/\s+|>|\+|~/).at(-1) ?? "";
    return new RegExp(`\\.${className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9_-])`, "i").test(lastCompound);
  });
}

function findCssClosingDelimiter(source, openIndex, openCharacter, closeCharacter) {
  let depth = 1;
  let quote = null;
  for (let index = openIndex + 1; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === openCharacter) depth += 1;
    else if (character === closeCharacter && --depth === 0) return index;
  }
  return -1;
}

function selectorTokens(arm) {
  const compounds = [];
  const combinators = [];
  let current = "";
  let pendingCombinator = null;
  let round = 0;
  let square = 0;
  let quote = null;
  const flush = () => {
    const compound = current.trim();
    if (!compound) return;
    if (compounds.length > 0) combinators.push(pendingCombinator ?? " ");
    compounds.push(compound);
    current = "";
    pendingCombinator = null;
  };

  for (let index = 0; index < arm.length; index += 1) {
    const character = arm[index];
    if (quote) {
      current += character;
      if (character === "\\" && index + 1 < arm.length) current += arm[++index];
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      current += character;
    } else if (character === "(") {
      round += 1;
      current += character;
    } else if (character === ")") {
      round -= 1;
      current += character;
    } else if (character === "[") {
      square += 1;
      current += character;
    } else if (character === "]") {
      square -= 1;
      current += character;
    } else if (round === 0 && square === 0 && /\s/.test(character)) {
      flush();
      if (compounds.length > 0 && pendingCombinator == null) pendingCombinator = " ";
    } else if (round === 0 && square === 0 && /^[>+~]$/.test(character)) {
      flush();
      pendingCombinator = character;
    } else {
      current += character;
    }
  }
  flush();
  return compounds.length > 0 && combinators.length === compounds.length - 1
    ? { compounds, combinators }
    : null;
}

function normalizedElementNode(node) {
  return {
    renderedTag: String(node.renderedTag ?? "").toLowerCase(),
    classes: node.classes ?? new Set(),
    attributes: node.attributes ?? new Map(),
    states: node.states ?? new Set(),
  };
}

function attributeSelectorMatches(content, node) {
  const match = content.match(/^\s*([^\s~|^$*=\]]+)\s*(?:(~=|\|=|\^=|\$=|\*=|=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+))\s*([is])?)?\s*$/i);
  if (!match) return false;
  const [, rawName, operator, doubleQuoted, singleQuoted, bareValue, flag] = match;
  const descriptor = node.attributes.get(rawName.toLowerCase());
  if (!descriptor?.present) return false;
  if (!operator) return true;
  if (descriptor.dynamic && descriptor.values.size === 0) return false;
  const expectedRaw = doubleQuoted ?? singleQuoted ?? bareValue ?? "";
  const normalizeValue = flag?.toLowerCase() === "i"
    ? (value) => String(value).toLowerCase()
    : (value) => String(value);
  const expected = normalizeValue(expectedRaw);
  return [...descriptor.values].some((rawValue) => {
    const value = normalizeValue(rawValue);
    if (operator === "=") return value === expected;
    if (operator === "~=") return value.split(/\s+/).includes(expected);
    if (operator === "|=") return value === expected || value.startsWith(`${expected}-`);
    if (operator === "^=") return value.startsWith(expected);
    if (operator === "$=") return value.endsWith(expected);
    if (operator === "*=") return value.includes(expected);
    return false;
  });
}

function simplePseudoMatches(name, node) {
  const normalized = name.toLowerCase();
  const statePseudos = new Set([
    "hover", "active", "focus", "focus-visible", "focus-within", "visited",
    "disabled", "checked", "indeterminate", "placeholder-shown", "target",
  ]);
  if (statePseudos.has(normalized)) {
    if (normalized === "disabled" && node.attributes.has("disabled")) return true;
    if (normalized === "checked" && node.attributes.has("checked")) return true;
    return node.states.has(normalized);
  }
  if (normalized === "enabled") return !simplePseudoMatches("disabled", node);
  if (normalized === "link" || normalized === "any-link") return node.renderedTag === "a";
  if (normalized === "root") return node.renderedTag === "html";
  if (normalized === "scope") return true;
  // 정적 AST만으로 형제 위치를 알 수 없는 구조 pseudo는 모든 가능 상태에서 검사합니다.
  if (/^(?:first|last|only|nth|empty)(?:-|$)/.test(normalized)) return true;
  return false;
}

function compoundMatchesNode(compound, rawNode) {
  const node = normalizedElementNode(rawNode);
  let index = 0;
  const typeMatch = compound.match(/^(\*|[a-z][a-z0-9-]*)/i);
  if (typeMatch) {
    if (typeMatch[1] !== "*" && typeMatch[1].toLowerCase() !== node.renderedTag) return false;
    index = typeMatch[0].length;
  }

  while (index < compound.length) {
    const character = compound[index];
    if (character === "." || character === "#") {
      const match = compound.slice(index + 1).match(/^([a-z_][a-z0-9_-]*)/i);
      if (!match) return false;
      if (character === "." && !node.classes.has(match[1])) return false;
      if (character === "#") {
        const id = node.attributes.get("id");
        if (!id?.present || !id.values.has(match[1])) return false;
      }
      index += match[0].length + 1;
      continue;
    }
    if (character === "[") {
      const close = findCssClosingDelimiter(compound, index, "[", "]");
      if (close < 0 || !attributeSelectorMatches(compound.slice(index + 1, close), node)) return false;
      index = close + 1;
      continue;
    }
    if (character === ":") {
      if (compound[index + 1] === ":") return false;
      const nameMatch = compound.slice(index + 1).match(/^([a-z-]+)/i);
      if (!nameMatch) return false;
      const name = nameMatch[1].toLowerCase();
      index += nameMatch[0].length + 1;
      if (compound[index] === "(") {
        const close = findCssClosingDelimiter(compound, index, "(", ")");
        if (close < 0) return false;
        const options = splitTopLevel(compound.slice(index + 1, close), ",").map((part) => part.trim()).filter(Boolean);
        const matches = options.map((option) => selectorArmTargetsElement(option, rawNode));
        if ((name === "is" || name === "where") && !matches.some(Boolean)) return false;
        if (name === "not" && matches.some(Boolean)) return false;
        if (name === "has") return false;
        if (!["is", "where", "not", "has"].includes(name)
          && !/^(?:nth|lang|dir)\b/.test(name)) return false;
        index = close + 1;
      } else if (!simplePseudoMatches(name, node)) {
        return false;
      }
      continue;
    }
    if (character === "*") {
      index += 1;
      continue;
    }
    return false;
  }
  return true;
}

function selectorArmTargetsElement(arm, element) {
  const tokens = selectorTokens(arm);
  if (!tokens) return false;
  const { compounds, combinators } = tokens;
  if (!compoundMatchesNode(compounds.at(-1), element)) return false;
  const explicitAncestors = element.ancestors ?? [];
  const ancestors = explicitAncestors.length > 0
    ? explicitAncestors
    : element.ancestorClasses?.size > 0
      ? [{ renderedTag: "", classes: element.ancestorClasses, attributes: new Map(), states: new Set() }]
      : [];
  let ancestorIndex = 0;
  for (let compoundIndex = compounds.length - 2; compoundIndex >= 0; compoundIndex -= 1) {
    const combinator = combinators[compoundIndex];
    if (combinator === ">") {
      if (!ancestors[ancestorIndex] || !compoundMatchesNode(compounds[compoundIndex], ancestors[ancestorIndex])) {
        return false;
      }
      ancestorIndex += 1;
    } else if (combinator === " ") {
      let matchedIndex = -1;
      for (let candidate = ancestorIndex; candidate < ancestors.length; candidate += 1) {
        if (compoundMatchesNode(compounds[compoundIndex], ancestors[candidate])) {
          matchedIndex = candidate;
          break;
        }
      }
      if (matchedIndex < 0) return false;
      ancestorIndex = matchedIndex + 1;
    } else {
      // JSX 파일 단위 정적 모델에는 실제 형제 순서가 없으므로 형제 combinator는 적용하지 않습니다.
      return false;
    }
  }
  return true;
}

function selectorTargetsElement(selector, element) {
  return splitTopLevel(selector, ",").some((arm) => selectorArmTargetsElement(arm, element));
}

function selectorSpecificity(arm) {
  const specificity = [0, 0, 0, 0];
  let index = 0;
  let expectsType = true;
  while (index < arm.length) {
    const character = arm[index];
    if (/\s/.test(character) || /^[>+~]$/.test(character)) {
      expectsType = true;
      index += 1;
      continue;
    }
    if (character === "#" || character === ".") {
      const identifier = arm.slice(index + 1).match(/^([a-z_][a-z0-9_-]*)/i);
      if (!identifier) {
        index += 1;
        continue;
      }
      specificity[character === "#" ? 1 : 2] += 1;
      expectsType = false;
      index += identifier[0].length + 1;
      continue;
    }
    if (character === "[") {
      const close = findCssClosingDelimiter(arm, index, "[", "]");
      specificity[2] += 1;
      expectsType = false;
      index = close < 0 ? arm.length : close + 1;
      continue;
    }
    if (character === ":") {
      const pseudoElement = arm[index + 1] === ":";
      const nameStart = index + (pseudoElement ? 2 : 1);
      const nameMatch = arm.slice(nameStart).match(/^([a-z-]+)/i);
      if (!nameMatch) {
        index += 1;
        continue;
      }
      const name = nameMatch[1].toLowerCase();
      index = nameStart + nameMatch[0].length;
      if (pseudoElement) specificity[3] += 1;
      if (arm[index] === "(") {
        const close = findCssClosingDelimiter(arm, index, "(", ")");
        const content = close < 0 ? "" : arm.slice(index + 1, close);
        if (!pseudoElement && ["is", "not", "has"].includes(name)) {
          const options = splitTopLevel(content, ",").map(selectorSpecificity);
          const maximum = options.reduce((best, current) => compareSpecificity(current, best) > 0 ? current : best,
            [0, 0, 0, 0]);
          for (let column = 1; column < specificity.length; column += 1) specificity[column] += maximum[column];
        } else if (!pseudoElement && name !== "where") {
          specificity[2] += 1;
        }
        index = close < 0 ? arm.length : close + 1;
      } else if (!pseudoElement) {
        specificity[2] += 1;
      }
      expectsType = false;
      continue;
    }
    if (expectsType) {
      const type = arm.slice(index).match(/^([a-z][a-z0-9-]*)/i);
      if (type) {
        specificity[3] += 1;
        index += type[0].length;
        expectsType = false;
        continue;
      }
    }
    if (character === "*") expectsType = false;
    index += 1;
  }
  return specificity;
}

function compareSpecificity(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
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
  let sourceOrder = 0;
  return files.flatMap((absolutePath) => cssBlocks(readFileSync(absolutePath, "utf8"))
    .map((block) => ({ ...block, path: displayPath(absolutePath), sourceOrder: sourceOrder++ })));
}

function resolveLocalImport(fromPath, specifier) {
  if (!specifier.startsWith(".") && !specifier.startsWith("@/")) return null;
  const base = specifier.startsWith("@/")
    ? join(repoRoot, "src", specifier.slice(2))
    : resolve(dirname(fromPath), specifier);
  const candidates = extname(base)
    ? [base]
    : [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, join(base, "index.ts"), join(base, "index.tsx")];
  return candidates.find(existsSync) ?? null;
}

function collectRuntimeCssOrder(entryPath) {
  const visitedModules = new Set();
  const seenCss = new Set();
  const cssOrder = [];

  const visitModule = (absolutePath) => {
    if (visitedModules.has(absolutePath) || !existsSync(absolutePath)) return;
    visitedModules.add(absolutePath);
    const source = readFileSync(absolutePath, "utf8");
    const sourceFile = ts.createSourceFile(absolutePath, source, ts.ScriptTarget.Latest, true,
      absolutePath.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const imported = resolveLocalImport(absolutePath, statement.moduleSpecifier.text);
      if (!imported) continue;
      if (imported.endsWith(".css")) {
        if (!seenCss.has(imported)) {
          seenCss.add(imported);
          cssOrder.push(imported);
        }
      } else {
        visitModule(imported);
      }
    }
  };

  visitModule(entryPath);
  return cssOrder;
}

function collectRuntimeCssOrderFromSources(entryPath, sources) {
  const normalizedSources = new Map([...sources].map(([path, source]) => [posix.normalize(path.replaceAll("\\", "/")), source]));
  const visitedModules = new Set();
  const seenCss = new Set();
  const cssOrder = [];

  const resolveImport = (fromPath, specifier) => {
    if (!specifier.startsWith(".") && !specifier.startsWith("@/")) return null;
    const base = specifier.startsWith("@/")
      ? posix.join("src", specifier.slice(2))
      : posix.normalize(posix.join(posix.dirname(fromPath), specifier));
    const candidates = posix.extname(base)
      ? [base]
      : [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, `${base}.css`,
          posix.join(base, "index.ts"), posix.join(base, "index.tsx")];
    return candidates.find((candidate) => normalizedSources.has(candidate)) ?? null;
  };

  const visitModule = (path) => {
    const normalizedPath = posix.normalize(path.replaceAll("\\", "/"));
    if (visitedModules.has(normalizedPath) || !normalizedSources.has(normalizedPath)) return;
    visitedModules.add(normalizedPath);
    const source = normalizedSources.get(normalizedPath);
    const sourceFile = ts.createSourceFile(normalizedPath, source, ts.ScriptTarget.Latest, true,
      normalizedPath.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const imported = resolveImport(normalizedPath, statement.moduleSpecifier.text);
      if (!imported) continue;
      if (imported.endsWith(".css")) {
        if (!seenCss.has(imported)) {
          seenCss.add(imported);
          cssOrder.push(imported);
        }
      } else {
        visitModule(imported);
      }
    }
  };

  visitModule(entryPath);
  return cssOrder;
}

const runtimeCssOrder = collectRuntimeCssOrder(join(repoRoot, "src", "main.tsx"));
const releaseCssSet = new Set(releaseCssFiles);
const orderedReleaseCssFiles = [
  ...runtimeCssOrder.filter((path) => releaseCssSet.has(path)),
  ...releaseCssFiles.filter((path) => !runtimeCssOrder.includes(path)),
];
const releaseBlocks = withCssBlocks(orderedReleaseCssFiles);

function viewportWidthsForBlocks(blocks) {
  const widths = new Set([320, 360, 390, 412, 768, 1024, 1440]);
  for (const block of blocks) {
    for (const atRule of block.atRules) {
      if (!/^@media\b/i.test(atRule)) continue;
      for (const match of atRule.matchAll(/(?:min|max)-width\s*:\s*([0-9.]+)px/gi)) {
        const boundary = Number(match[1]);
        for (const candidate of [Math.floor(boundary - 1), boundary, Math.ceil(boundary + 1)]) {
          if (candidate >= 240 && candidate <= 2560) widths.add(candidate);
        }
      }
    }
  }
  return [...widths].sort((left, right) => left - right);
}

const releaseViewportWidths = viewportWidthsForBlocks(releaseBlocks);

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

function candidateWins(next, current) {
  if (!current) return true;
  if (next.important !== current.important) return next.important;
  const specificity = compareSpecificity(next.specificity, current.specificity);
  if (specificity !== 0) return specificity > 0;
  return next.sourceOrder >= current.sourceOrder;
}

function cascadedElementDeclarations(element, width, blocks = releaseBlocks, inlineDeclarations = []) {
  const winners = new Map();
  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
    const block = blocks[blockIndex];
    if (!mediaAppliesAtWidth(block.atRules, width)) continue;
    const matchedSpecificities = block.matchedSpecificity
      ? [block.matchedSpecificity]
      : block.selectors
        .filter((arm) => selectorArmTargetsElement(arm, element))
        .map(selectorSpecificity);
    if (matchedSpecificities.length === 0) continue;
    const specificity = matchedSpecificities.reduce((best, current) =>
      compareSpecificity(current, best) > 0 ? current : best);
    for (let declarationIndex = 0; declarationIndex < block.declarations.length; declarationIndex += 1) {
      const declaration = block.declarations[declarationIndex];
      const candidate = {
        ...declaration,
        specificity,
        sourceOrder: (block.sourceOrder ?? blockIndex) * 1000 + declarationIndex,
      };
      if (candidateWins(candidate, winners.get(declaration.property))) {
        winners.set(declaration.property, candidate);
      }
    }
  }

  for (let index = 0; index < inlineDeclarations.length; index += 1) {
    const declaration = inlineDeclarations[index];
    if (!declaration.value) continue;
    const candidate = {
      ...declaration,
      important: declaration.important === true,
      specificity: [1, 0, 0, 0],
      sourceOrder: Number.MAX_SAFE_INTEGER - inlineDeclarations.length + index,
    };
    if (candidateWins(candidate, winners.get(declaration.property))) {
      winners.set(declaration.property, candidate);
    }
  }
  return winners;
}

function cssBlocksMatchingElement(element, blocks = releaseBlocks) {
  return blocks.flatMap((block) => {
    const specificities = block.selectors
      .filter((arm) => selectorArmTargetsElement(arm, element))
      .map(selectorSpecificity);
    if (specificities.length === 0) return [];
    const matchedSpecificity = specificities.reduce((best, current) =>
      compareSpecificity(current, best) > 0 ? current : best);
    return [{ ...block, matchedSpecificity }];
  });
}

function expandInlineDeclarationScenarios(styleObjects) {
  if (styleObjects.length === 0) return [[]];
  return styleObjects.flatMap((declarations) => {
    let scenarios = [[]];
    for (const declaration of declarations) {
      const values = declaration.resolved && declaration.values.length > 0
        ? declaration.values
        : [declaration.value];
      scenarios = scenarios.flatMap((scenario) => values.map((value) => [...scenario, { ...declaration, value }]));
    }
    return scenarios;
  });
}

function computeElementBoxAtWidth(element, width, blocks = releaseBlocks, inlineDeclarations = []) {
  const declarations = cascadedElementDeclarations(element, width, blocks, inlineDeclarations);
  const pixels = (property) => resolvePixels(declarations.get(property)?.value ?? null);
  const inset = declarations.get("inset")?.value ?? null;
  return {
    height: pixels("height"),
    minHeight: pixels("min-height"),
    width: pixels("width"),
    minWidth: pixels("min-width"),
    fillsContainingBlock: /^0(?:px)?$/i.test(inset ?? ""),
  };
}

function hasAdequateHitArea(box) {
  if (box.fillsContainingBlock) return true;
  const usedHeight = Math.max(box.height ?? 0, box.minHeight ?? 0);
  if (usedHeight < 44) return false;
  const explicitWidths = [box.width, box.minWidth].filter(Number.isFinite);
  return explicitWidths.length === 0 || Math.max(...explicitWidths) >= 44;
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

test("inline style AST는 literal·상수·default param을 해석하고 알 수 없는 크기를 숨기지 않는다", () => {
  const entries = collectInlineStylesFromSource("fixture/InlineStyles.tsx", `
    const CONST_GAP = 5;
    const ALIASED_GAP = CONST_GAP;
    export function Fixture({ dotSize = 7, unknownSize }) {
      return <>
        <span className="literal" style={{ marginRight: 5 }} />
        <span className="dynamic" style={{ width: dotSize, height: ALIASED_GAP }} />
        <span className="unknown" style={{ gap: unknownSize }} />
      </>;
    }
  `);
  const byClass = new Map(entries.map((entry) => [[...entry.classes][0], entry]));

  assert.deepEqual(byClass.get("literal").declarations.find((item) => item.property === "margin-right").values, ["5px"]);
  assert.deepEqual(byClass.get("dynamic").declarations.find((item) => item.property === "width").values, ["7px"]);
  assert.deepEqual(byClass.get("dynamic").declarations.find((item) => item.property === "height").values, ["5px"]);
  assert.equal(byClass.get("unknown").declarations.find((item) => item.property === "gap").resolved, false);
  const violations = inlineScaleViolations(entries);
  assert.equal(violations.length, 4, `literal·default·const·unknown 우회를 각각 잡아야 합니다:\n${violations.join("\n")}`);
  const unknownEntry = byClass.get("unknown");
  const unknownDeclaration = unknownEntry.declarations.find((item) => item.property === "gap");
  assert.deepEqual(
    inlineScaleViolations([unknownEntry], [], new Set([inlineStyleKey(unknownEntry, unknownDeclaration)])),
    [],
    "해석 불가 값은 정확한 path+class+property allowlist만 허용해야 합니다",
  );
});

test("release TSX inline style의 fontSize·크기·간격은 정본 type·4px·icon 척도를 사용한다", () => {
  const violations = inlineScaleViolations(releaseInlineStyles, releaseElements, inlineDynamicScaleAllowlist);

  assert.deepEqual(violations, [], `inline style 크기·간격 위반 ${violations.length}건:\n${violations.join("\n")}`);
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

const semanticSurfaceManifest = [
    ["src/screens/parent/ParentFamily.css", "pf-parents", "card"],
    ["src/screens/parent/ParentFamily.css", "pf-child", "card"],
    ["src/screens/parent/ParentAccount.css", "pa-profile", "hero"],
    ["src/screens/child/ChildHome.css", "kd-tile", "card"],
    ["src/screens/feature/AiCredit.css", "ac-pack", "card"],
    ["src/screens/feature/AiCredit.css", "ac-auto", "card"],
    ["src/screens/onboarding/Onboarding.css", "ob-consent-dialog", "modal"],
    ["src/components/MapPickerSheet.css", "mps-sheet", "sheet"],
    ["src/components/MessageSafetyDialog.css", "msd-dialog", "modal"],
    ["src/screens/feature/PairingWizard.css", "pw-childcard", "card"],
    ["src/screens/parent/ParentSettings.css", "ps-profile", "card"],
    ["src/screens/feature/Subscription.css", "sub-plan", "card"],
    ["src/screens/onboarding/Onboarding.css", "ob-role-card--parent", "card"],
    ["src/screens/onboarding/Onboarding.css", "ob-role-card--child", "card"],
    ["src/screens/onboarding/Onboarding.css", "ob-role-card--teacher", "card"],
    ["src/screens/feature/RouteView.css", "rv-info", "card"],
    ["src/screens/feature/RouteView.css", "rv-steps", "card"],
    ["src/screens/feature/RouteView.css", "rv-fallback", "card"],
    ["src/screens/feature/TrialLock.css", "tl-lock", "card"],
    ["src/screens/feature/TrialLock.css", "tl-perks", "card"],
    ["src/screens/feature/Subscription.css", "sub-active", "hero"],
    ["src/screens/feature/Subscription.css", "sub-benefits", "card"],
    ["src/screens/feature/Subscription.css", "sub-compare__scroll", "card"],
    ["src/screens/feature/AiSchedule.css", "ais-result", "card"],
    ["src/screens/feature/DataSync.css", "ds-sync", "card"],
    ["src/screens/feature/FamilyConnection.css", "fc-invite", "card"],
    ["src/screens/feature/Notifications.css", "nc-item", "card"],
    ["src/screens/feature/PlaceManager.css", "pm-item", "card"],
    ["src/screens/feature/PlaceManager.css", "pm-danger", "card"],
    ["src/screens/feature/FriendPlay.css", "fp-connected", "card"],
    ["src/screens/teacher/TeacherNotice.css", "tn-empty", "card"],
    ["src/styles/components.css", "hy-toast", "floating"],
    ["src/screens/parent/ParentHome.css", "ph-hero", "hero"],
    ["src/screens/parent/ParentHome.css", "ph-ai", "card"],
    ["src/screens/parent/ParentCalendar.css", "pc-card", "card"],
    ["src/screens/parent/ParentCalendar.css", "pc-event__card", "card"],
    ["src/screens/parent/ParentCalendar.css", "pc-sheet", "sheet"],
    ["src/screens/parent/ParentLocation.css", "pl-sheet", "sheet"],
    ["src/screens/parent/ParentFamily.css", "pf-invite-card", "card"],
    ["src/screens/parent/ParentFamily.css", "pf-conn", "card"],
    ["src/screens/parent/ParentFamily.css", "pf-paircode__card", "card"],
    ["src/screens/parent/ParentSettings.css", "ps-list", "card"],
    ["src/screens/parent/ParentSettings.css", "ps-modal__card", "modal"],
    ["src/screens/shared/MemoChat.css", "mc-photo-preview__panel", "modal"],
    ["src/screens/child/overlays/ChildSheet.css", "ks-sheet", "sheet"],
    ["src/screens/child/overlays/ChildSheet.css", "ks-friend", "card"],
    ["src/screens/child/overlays/ChildSheet.css", "ks-modal", "modal"],
    ["src/screens/child/overlays/ChildSheet.css", "ks-day__list", "card"],
    ["src/screens/child/ChildHome.css", "kd-map", "hero"],
    ["src/screens/child/ChildHome.css", "kd-card", "card"],
    ["src/screens/teacher/TeacherHome.css", "th-hero", "hero"],
    ["src/screens/teacher/TeacherHome.css", "th-note", "card"],
    ["src/screens/teacher/TeacherHome.css", "th-tile", "card"],
    ["src/screens/teacher/TeacherHome.css", "th-empty", "card"],
    ["src/screens/teacher/TeacherHome.css", "th-sheet", "sheet"],
    ["src/screens/teacher/TeacherStudents.css", "ts-empty", "card"],
    ["src/screens/teacher/TeacherStudents.css", "ts-sheet", "sheet"],
    ["src/screens/teacher/TeacherReleaseGate.css", "trg-card", "card"],
    ["src/screens/teacher/TeacherReleaseGate.css", "trg-dialog__card", "modal"],
    ["src/screens/onboarding/Onboarding.css", "ob-survey-card", "card"],
    ["src/screens/onboarding/Onboarding.css", "ob-connect-card", "card"],
    ["src/screens/onboarding/Onboarding.css", "ob-perm", "card"],
    ["src/screens/feature/RemoteAudio.css", "ra-trust-card", "card"],
    ["src/screens/feature/FriendPlay.css", "fp-card", "card"],
    ["src/screens/feature/FriendPlay.css", "fp-setting", "card"],
    ["src/screens/feature/FriendPlay.css", "fp-parent-card", "card"],
    ["src/screens/feature/AiSchedule.css", "ais-mode-intro", "card"],
    ["src/screens/feature/AiCredit.css", "ac-hero", "hero"],
    ["src/screens/feature/AiCredit.css", "ac-detail", "card"],
    ["src/screens/feature/Feedback.css", "fb-satis", "card"],
    ["src/screens/feature/Feedback.css", "fb-ideas__card", "card"],
    ["src/screens/feature/PhoneSetup.css", "psu-card", "card"],
    ["src/screens/feature/RouteView.css", "rv-empty", "card"],
    ["src/screens/parent/EventForm.css", "ef-scope-sheet", "sheet"],
    ["src/screens/parent/EventForm.css", "ef-place-suggestions", "floating"],
    ["src/screens/feature/Supplies.css", "sup-status", "card"],
    ["src/screens/feature/Supplies.css", "sup-card", "card"],
    ["src/screens/feature/DangerZoneForm.css", "dzf-toggles", "card"],
    ["src/screens/feature/LocationStatus.css", "ls-card", "card"],
    ["src/screens/feature/LocationStatus.css", "ls-last", "card"],
    ["src/screens/parent/ChildDetail.css", "cd-hero", "hero"],
    ["src/screens/parent/ChildDetail.css", "cd-stat", "card"],
    ["src/screens/parent/ChildDetail.css", "cd-row", "card"],
    ["src/screens/parent/ChildDetail.css", "cd-danger", "card"],
    ["src/screens/parent/ChildDetail.css", "cd-confirm__sheet", "sheet"],
    ["src/screens/feature/PairingWizard.css", "pw-summary", "card"],
    ["src/screens/teacher/TeacherNotice.css", "tn-reflect", "card"],
    ["src/screens/teacher/TeacherTimetable.css", "tt-empty", "card"],
    ["src/screens/feature/FamilyConnection.css", "fc-hero", "hero"],
    ["src/screens/feature/FamilyConnection.css", "fc-device", "card"],
    ["src/screens/feature/FamilyConnection.css", "fc-modal__card", "modal"],
    ["src/screens/child/ChildLocationStatus.css", "cls-detail", "card"],
    ["src/screens/child/ChildSettings.css", "ks-hero", "hero"],
    ["src/screens/child/ChildSettings.css", "ks-row", "card"],
    ["src/screens/child/ChildSettings.css", "ks-modal__card", "modal"],
    ["src/screens/parent/ParentAccount.css", "pa-card", "card"],
    ["src/screens/parent/ParentAccount.css", "pa-action", "card"],
    ["src/screens/parent/ParentAccount.css", "pa-modal__card", "modal"],
    ["src/screens/feature/DataSync.css", "ds-card", "card"],
    ["src/screens/feature/NotificationSettings.css", "nst-list", "card"],
    ["src/screens/feature/ArrivalAlerts.css", "aa-item", "card"],
    ["src/screens/feature/DangerAlert.css", "da-hero", "hero"],
    ["src/screens/feature/DangerAlert.css", "da-item", "card"],
    ["src/screens/feature/DaySummary.css", "ds-hero", "hero"],
    ["src/screens/feature/DaySummary.css", "ds-row", "card"],
    ["src/screens/feature/DaySummary.css", "ds-quote", "card"],
    ["src/screens/feature/DaySummary.css", "ds-panel", "card"],
    ["src/screens/feature/DailySafetyReport.css", "dr-overview-card", "card"],
    ["src/screens/feature/WeeklyFamilyReport.css", "wr-hero", "hero"],
    ["src/screens/feature/RemoteAudioAudit.css", "raa-hero", "hero"],
    ["src/screens/feature/RemoteRing.css", "rr-modal", "modal"],
    ["src/screens/feature/SosReceive.css", "sr-banner", "hero"],
    ["src/screens/feature/SosReceive.css", "sr-loc", "card"],
    ["src/screens/feature/SosReceive.css", "sr-history-item", "card"],
    ["src/screens/feature/AppUpdate.css", "au-card", "card"],
    ["src/screens/feature/PermDenied.css", "pd-card", "card"],
    ["src/components/ui/StickerCelebration.css", "sticker-celebration__main", "modal"],
];

function surfaceManifestKey(path, selector) {
  return `${path}|${selector}`;
}

function surfaceCandidates(blocks) {
  const grouped = new Map();
  for (const block of blocks) {
    if (block.atRules.length > 0) continue;
    for (const selector of block.selectors) {
      if (!/^\.[a-z][a-z0-9_-]*$/i.test(selector)) continue;
      const key = surfaceManifestKey(block.path, selector);
      const current = grouped.get(key) ?? { path: block.path, selector, line: block.line, declarations: [] };
      current.declarations.push(...block.declarations);
      grouped.set(key, current);
    }
  }
  return [...grouped.values()].filter((candidate) => {
    const hasRadius = Boolean(declarationValue(candidate.declarations, "border-radius"));
    const hasBackground = Boolean(declarationValue(candidate.declarations, "background")
      || declarationValue(candidate.declarations, "background-color"));
    const hasElevationDeclaration = declarationValue(candidate.declarations, "box-shadow") !== null;
    const hasContainerInset = candidate.declarations.some((declaration) =>
      /^(?:padding|padding-(?:top|right|bottom|left|block|inline))$/.test(declaration.property));
    return hasRadius && hasBackground && hasContainerInset && hasElevationDeclaration;
  });
}

function unclassifiedSurfaceCandidates(blocks, manifestKeys, nonSurfaceKeys) {
  return surfaceCandidates(blocks).filter((candidate) => {
    const key = surfaceManifestKey(candidate.path, candidate.selector);
    return !manifestKeys.has(key) && !nonSurfaceKeys.has(key);
  });
}

const semanticSurfaceManifestKeys = new Set(semanticSurfaceManifest.map(([path, className]) =>
  surfaceManifestKey(path, `.${className}`)));
const nonSurfacePaintManifest = new Set([
  ["src/styles/components.css", ".hy-topbar__logo"],
  ["src/styles/components.css", ".hy-tabbar__inner"],
  ["src/app/ChildDock.css", ".kdock__bar"],
  ["src/screens/parent/ParentHome.css", ".ph-stickerbtn"],
  ["src/screens/parent/ParentHome.css", ".ph-location-error__retry"],
  ["src/screens/parent/ParentLocation.css", ".pl-safe-label"],
  ["src/screens/parent/ParentLocation.css", ".pl-danger__pill"],
  ["src/screens/parent/ParentLocation.css", ".pl-live"],
  ["src/screens/parent/ParentLocation.css", ".pl-refreshing"],
  ["src/screens/parent/ParentLocation.css", ".pl-chip"],
  ["src/screens/parent/ParentLocation.css", ".pl-lock__cta"],
  ["src/screens/parent/ParentLocation.css", ".pl-lock__retry"],
  ["src/screens/parent/ParentLocation.css", ".pl-viewtog"],
  ["src/screens/parent/ParentLocation.css", ".pl-histmsg"],
  ["src/screens/parent/ParentLocation.css", ".pl-scrub"],
  ["src/screens/parent/ParentLocation.css", ".pl-stays-reopen"],
  ["src/screens/shared/MemoChat.css", ".mc-sticker"],
  ["src/screens/shared/MemoChat.css", ".mc-quick-btn"],
  ["src/screens/shared/MemoChat.css", ".mc-inputbar"],
  ["src/screens/child/ChildHome.css", ".kd-map__chip"],
  ["src/screens/child/ChildHome.css", ".kd-hyeni__bubble"],
  ["src/screens/child/StickerBook.css", ".sb-slot"],
  ["src/screens/child/AiFriendSetup.css", ".afs-name-field"],
  ["src/screens/child/AiFriendSetup.css", ".afs-cta"],
  ["src/screens/child/AiFriendChat.css", ".afc-credits"],
  ["src/screens/child/AiFriendChat.css", ".afc-chip"],
  ["src/screens/child/AiFriendChat.css", ".afc-field"],
  ["src/screens/child/AiFriendChat.css", ".afc-send"],
  ["src/screens/teacher/TeacherHome.css", ".th-empty__cta"],
  ["src/screens/feature/Subscription.css", ".sub-plan__ribbon"],
  ["src/screens/feature/RemoteAudio.css", ".ra-audit-link"],
  ["src/screens/feature/Notifications.css", ".nc-filter"],
  ["src/screens/feature/AiSchedule.css", ".ais-tab"],
  ["src/screens/feature/AiSchedule.css", ".ais-bubble"],
  ["src/screens/feature/AiSchedule.css", ".ais-textbox"],
  ["src/screens/feature/AiCredit.css", ".ac-buy"],
  ["src/screens/feature/Feedback.css", ".fb-textwrap"],
  ["src/screens/feature/StickerSend.css", ".ss-child"],
  ["src/screens/feature/StickerSend.css", ".ss-msg"],
  ["src/screens/feature/PlaceForm.css", ".pf-map__hint"],
  ["src/screens/feature/ChildInvite.css", ".ci-regen"],
  ["src/screens/feature/RouteView.css", ".rv-retry"],
  ["src/screens/feature/RouteView.css", ".rv-empty__home"],
  ["src/screens/feature/RouteView.css", ".rv-map-chip"],
  ["src/screens/feature/DangerZoneForm.css", ".dzf-map__hint"],
  ["src/screens/feature/LocationSettings.css", ".lset-row"],
  ["src/screens/feature/DaySummary.css", ".ds-panel__cta"],
  ["src/screens/feature/DailySafetyReport.css", ".dr-scope-error__retry"],
  ["src/screens/feature/DailySafetyReport.css", ".dr-primary"],
  ["src/screens/feature/WeeklyFamilyReport.css", ".wr-primary"],
  ["src/screens/feature/RemoteRing.css", ".rr-stop"],
  ["src/screens/feature/SosReceive.css", ".sr-map__label"],
].map(([path, selector]) => surfaceManifestKey(path, selector)));

test("명시된 semantic surface manifest는 역할별 radius와 shadow를 직접 선언한다", () => {
  const specs = {
    card: { radius: ["var(--radius-16)"], shadow: ["none", "var(--shadow-soft)"] },
    hero: { radius: ["var(--radius-20)", "0 0 var(--radius-20) var(--radius-20)"], shadow: ["none", "var(--shadow-soft)", "var(--shadow-floating)"] },
    modal: { radius: ["var(--radius-20)"], shadow: ["var(--shadow-modal)"] },
    sheet: { radius: ["var(--radius-24)", "var(--radius-24) var(--radius-24) 0 0"], shadow: ["var(--shadow-modal)"] },
    floating: { radius: ["var(--radius-16)"], shadow: ["var(--shadow-floating)", "var(--shadow-modal)"] },
  };
  const canonicalVariantShadows = new Set([
    "none", "var(--shadow-soft)", "var(--shadow-floating)", "var(--shadow-modal)",
  ]);
  const violations = [];

  for (const [path, className, role] of semanticSurfaceManifest) {
    const block = rootClassBlock(path, className);
    if (!block) {
      violations.push(`${path} .${className} (root selector 누락)`);
      continue;
    }
    const baseClassName = className.split("--")[0];
    const baseBlock = baseClassName === className ? null : rootClassBlock(path, baseClassName);
    const declarations = [...(baseBlock?.declarations ?? []), ...block.declarations];
    const radius = declarationValue(declarations, "border-radius");
    const shadow = declarationValue(declarations, "box-shadow");
    if (!specs[role].radius.includes(radius)) {
      violations.push(`${path}:${block.line} .${className} (${role} radius ${radius ?? "누락"})`);
    }
    if (!specs[role].shadow.includes(shadow)) {
      violations.push(`${path}:${block.line} .${className} (${role} shadow ${shadow ?? "누락"})`);
    }
    for (const variantBlock of releaseBlocks) {
      if (variantBlock.path !== path
        || !variantBlock.selectors.some((selector) => selectorTargetsClass(selector, className))) continue;
      const variantRadius = declarationValue(variantBlock.declarations, "border-radius");
      const variantShadow = declarationValue(variantBlock.declarations, "box-shadow");
      if (variantRadius && !specs[role].radius.includes(variantRadius)) {
        violations.push(`${path}:${variantBlock.line} ${variantBlock.selector} (${role} variant radius ${variantRadius})`);
      }
      if (variantShadow && !canonicalVariantShadows.has(variantShadow)) {
        violations.push(`${path}:${variantBlock.line} ${variantBlock.selector} (${role} variant shadow ${variantShadow})`);
      }
    }
  }

  assert.deepEqual(violations, [], `semantic surface 위반 ${violations.length}건:\n${violations.join("\n")}`);
});

test("새로 칠한 semantic surface는 manifest 분류 없이 추가할 수 없다", () => {
  const fixtureBlocks = cssBlocks(`
    .qa-new-surface {
      background: #fff;
      border: 1px solid #eee;
      border-radius: 22px;
      box-shadow: 0 10px 24px rgba(0, 0, 0, 0.1);
      padding: 16px;
    }
  `).map((block, sourceOrder) => ({ ...block, path: "fixture/NewSurface.css", sourceOrder }));
  const unclassified = unclassifiedSurfaceCandidates(fixtureBlocks, new Set(), new Set());
  assert.deepEqual(unclassified.map((candidate) => `${candidate.path}|${candidate.selector}`), [
    "fixture/NewSurface.css|.qa-new-surface",
  ]);
});

test("출시 CSS의 rounded painted container는 surface 또는 non-surface manifest로 전수 분류한다", () => {
  const unclassified = unclassifiedSurfaceCandidates(
    releaseBlocks,
    semanticSurfaceManifestKeys,
    nonSurfacePaintManifest,
  );
  const labels = unclassified.map((item) => `${item.path}:${item.line} ${item.selector}`);
  assert.deepEqual(labels, [], `surface manifest 미분류 ${labels.length}건:\n${labels.join("\n")}`);
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
  const toggleOn = classStyleAtWidth(path, "tn-toggle--on", 360);
  const knob = classStyleAtWidth(path, "tn-toggle__knob", 360);
  const attachmentList = classStyleAtWidth(path, "tn-attach-list", 360);
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
  if (declarationValue(toggleOn, "background-color") !== "var(--lav-500)"
    || declarationValue(toggleOn, "background") !== null) {
    violations.push(`${path} .tn-toggle--on (background-clip을 보존하는 color longhand 누락)`);
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
  const attachmentRowGap = resolvePixels(declarationValue(attachmentList, "row-gap")) ?? 0;
  if (attachmentRowGap < 12) {
    violations.push(`${path} .tn-attach-list (행간 ${attachmentRowGap}px, 44px 삭제 hit 중첩)`);
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

test("hit-area cascade 계산은 후행 고특이도 30px override를 이전 44px로 숨기지 않는다", () => {
  const fixtureElement = {
    path: "fixture/HitArea.tsx",
    line: 1,
    tagName: "button",
    renderedTag: "button",
    classes: new Set(["cascade-fixture"]),
    ancestorClasses: new Set(["qa-shell"]),
    styles: [],
  };
  const fixtureBlocks = cssBlocks(`
    :where(button) {
      min-height: 44px;
      min-width: 44px;
    }
    .qa-shell .cascade-fixture.cascade-fixture {
      width: 44px !important;
      min-width: 44px !important;
      height: 44px !important;
      min-height: 44px !important;
    }
    @media (max-width: 390px) {
      .qa-shell .cascade-fixture.cascade-fixture {
        width: 30px !important;
        min-width: 30px !important;
        height: 30px !important;
        min-height: 30px !important;
      }
    }
  `).map((block, sourceOrder) => ({ ...block, path: "fixture/hit-area.css", sourceOrder }));

  for (const width of [360, 390]) {
    const box = computeElementBoxAtWidth(fixtureElement, width, fixtureBlocks);
    assert.equal(box.height, 30, `${width}px final height`);
    assert.equal(box.minHeight, 30, `${width}px final min-height`);
    assert.equal(box.width, 30, `${width}px final width`);
    assert.equal(box.minWidth, 30, `${width}px final min-width`);
    assert.equal(hasAdequateHitArea(box), false, `${width}px 30px override를 실패로 판정해야 합니다`);
  }
});

test("main import graph는 global.css를 포함한 실제 CSS 파일 순서를 보존한다", () => {
  assert.deepEqual(orderedReleaseCssFiles.slice(0, 4).map(displayPath), [
    "src/styles/tokens.css",
    "src/styles/jua.css",
    "src/styles/global.css",
    "src/styles/components.css",
  ]);
});

test("가상 모듈 import 순서도 후행 파일의 30px override를 최종 cascade로 계산한다", () => {
  const sources = new Map([
    ["fixture/main.tsx", 'import "./base.css"; import "./Feature";'],
    ["fixture/Feature.tsx", 'import "./feature.css"; export const Feature = () => null;'],
    ["fixture/base.css", ".ordered-hit { min-height: 44px; min-width: 44px; }"],
    ["fixture/feature.css", ".ordered-hit { min-height: 30px; min-width: 30px; }"],
  ]);
  const order = collectRuntimeCssOrderFromSources("fixture/main.tsx", sources);
  assert.deepEqual(order, ["fixture/base.css", "fixture/feature.css"]);
  const blocks = order.flatMap((path, fileIndex) => cssBlocks(sources.get(path))
    .map((block, blockIndex) => ({ ...block, path, sourceOrder: fileIndex * 100 + blockIndex })));
  const element = {
    renderedTag: "button",
    classes: new Set(["ordered-hit"]),
    ancestorClasses: new Set(),
    attributes: new Map(),
    ancestors: [],
    states: new Set(),
  };
  assert.equal(computeElementBoxAtWidth(element, 800, blocks).minHeight, 30);
});

test("selector matcher는 attribute 값과 조상 순서를 추측해서 44px 규칙을 적용하지 않는다", () => {
  const element = {
    renderedTag: "button",
    classes: new Set(["selector-hit", "primary"]),
    ancestorClasses: new Set(["inner", "outer"]),
    attributes: new Map([["data-mode", { present: true, values: new Set(["full"]), dynamic: false }]]),
    ancestors: [
      { renderedTag: "section", classes: new Set(["inner"]), attributes: new Map() },
      { renderedTag: "div", classes: new Set(["outer"]), attributes: new Map() },
    ],
    states: new Set(),
  };
  const blocks = cssBlocks(`
    .selector-hit.primary { min-height: 30px; min-width: 30px; }
    [data-mode="compact"].selector-hit.primary { min-height: 44px; min-width: 44px; }
    .inner .outer .selector-hit.primary { min-height: 44px; min-width: 44px; }
  `).map((block, sourceOrder) => ({ ...block, path: "fixture/selectors.css", sourceOrder }));
  const box = computeElementBoxAtWidth(element, 800, blocks);
  assert.equal(box.minHeight, 30, "존재하지 않는 attribute 값과 역전 조상은 match하면 안 됩니다");
  assert.equal(box.minWidth, 30);
});

test("selector matcher는 올바른 ancestor compound와 attribute state의 30px override를 적용한다", () => {
  const element = {
    renderedTag: "button",
    classes: new Set(["state-hit", "primary"]),
    ancestorClasses: new Set(["inner", "outer"]),
    attributes: new Map([["data-mode", { present: true, values: new Set(["compact"]), dynamic: false }]]),
    ancestors: [
      { renderedTag: "section", classes: new Set(["inner"]), attributes: new Map() },
      { renderedTag: "div", classes: new Set(["outer"]), attributes: new Map() },
    ],
    states: new Set(["hover"]),
  };
  const blocks = cssBlocks(`
    .state-hit { min-height: 44px; min-width: 44px; }
    .outer .inner [data-mode="compact"].state-hit.primary:hover { min-height: 30px; min-width: 30px; }
  `).map((block, sourceOrder) => ({ ...block, path: "fixture/states.css", sourceOrder }));
  const box = computeElementBoxAtWidth(element, 800, blocks);
  assert.equal(box.minHeight, 30);
  assert.equal(box.minWidth, 30);
});

test("default param으로 이어진 동적 inline 30px도 전역 44px보다 우선하는 최종값으로 계산한다", () => {
  const [element] = collectElementsFromSource("fixture/DynamicHit.tsx", `
    export function DynamicHit({ size = 30 }) {
      return <button className="dynamic-hit" style={{ width: size, minWidth: size, height: size, minHeight: size }}>작게</button>;
    }
  `);
  const blocks = cssBlocks(":where(button) { min-width: 44px; min-height: 44px; }")
    .map((block, sourceOrder) => ({ ...block, path: "fixture/global.css", sourceOrder }));
  const box = computeElementBoxAtWidth(element, 800, blocks, element.styles[0]);
  assert.deepEqual({ width: box.width, minWidth: box.minWidth, height: box.height, minHeight: box.minHeight }, {
    width: 30,
    minWidth: 30,
    height: 30,
    minHeight: 30,
  });
  assert.equal(hasAdequateHitArea(box), false);
});

test("실제 JSX 상호작용 요소는 모든 viewport에서 최소 세로 44px을 명시하고 소형 정사각형은 가로도 보장한다", () => {
  const violations = [];

  for (const element of releaseElements) {
    const inlineScenarios = expandInlineDeclarationScenarios(element.styles);
    const baseStates = new Set(element.states);
    const stateScenarios = [
      baseStates,
      ...["hover", "active", "focus", "focus-visible", "focus-within", "visited", "disabled", "checked"]
        .map((state) => new Set([...baseStates, state])),
      new Set([...baseStates, "hover", "active", "focus", "focus-visible", "focus-within"]),
    ];
    const uniqueStateScenarios = [...new Map(stateScenarios.map((states) => [[...states].sort().join("+"), states])).values()];
    for (const states of uniqueStateScenarios) {
      const stateElement = { ...element, states };
      const matchingBlocks = cssBlocksMatchingElement(stateElement);
      for (const width of releaseViewportWidths) {
        for (let scenario = 0; scenario < inlineScenarios.length; scenario += 1) {
          const box = computeElementBoxAtWidth(stateElement, width, matchingBlocks, inlineScenarios[scenario]);
          if (!hasAdequateHitArea(box)) {
            violations.push(`${element.path}:${element.line} <${element.tagName}> ${[...element.classes].map((name) => `.${name}`).join(" ") || "class 없음"} [${width}px, state ${[...states].join("+") || "기본"}, inline ${scenario + 1}] (final height ${box.height ?? "auto"}, min-height ${box.minHeight ?? "0"}, width ${box.width ?? "auto"}, min-width ${box.minWidth ?? "0"})`);
          }
        }
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

const opticalSpacingAllowlist = new Map([
  // 360px 화면에서 66px SOS와 pill 독의 합산 폭을 보존하는 기존 좌우 14px optical inset입니다.
  ["src/app/ChildDock.css|.kdock|padding", new Set([14])],
  // 정사각 로고 raster가 baseline보다 아래로 처져 보이지 않도록 아래쪽만 0으로 맞춘 optical inset입니다.
  ["src/styles/components.css|.hy-topbar__logo|padding", new Set([2])],
  // 7열 캘린더의 일정 점과 숫자 사이를 분리하는 micro-density 간격입니다.
  ["src/screens/parent/ParentCalendar.css|.pc-day__dots|gap", new Set([2])],
  // 음성 waveform bar 사이의 시각적 박자를 유지하는 장식 전용 간격입니다.
  ["src/screens/feature/AiSchedule.css|.ais-wave|gap", new Set([2])],
  // 작은 상태 capsule의 세로 2px은 44px hit box와 분리된 내부 optical padding입니다.
  ["src/screens/shared/MemoChat.css|.mc-safety-action|padding", new Set([2])],
  ["src/screens/child/AiFriendChat.css|.afc-report-link|padding", new Set([2])],
  ["src/screens/parent/ParentHome.css|.ph-child__now|padding", new Set([2])],
  // 44px hit 안의 18px 삭제 원을 중앙에 두는 13px 역마진입니다.
  ["src/screens/teacher/TeacherNotice.css|.tn-file-chip__x|margin", new Set([-13])],
  // 지도 marker/ring 중심을 실제 좌표에 맞추는 기하 오프셋입니다.
  ["src/screens/parent/ParentLocation.css|.pl-child-ring|margin-left", new Set([-75])],
  ["src/screens/parent/ParentLocation.css|.pl-child-ring|margin-top", new Set([-46])],
  // scrub tick의 1px stroke 중심을 track에 맞추는 optical 오프셋입니다.
  ["src/screens/parent/ParentLocation.css|.pl-scrub__ticks|margin-top", new Set([-2])],
]);

test("출시 화면의 padding·gap·margin은 근거 있는 optical 예외 외 4px 리듬을 사용한다", () => {
  const violations = [];
  const spacingProperties = /^(?:(?:padding|margin)(?:-(?:top|right|bottom|left|block|inline))?|gap|row-gap|column-gap)$/;

  for (const absolutePath of releaseCssFiles) {
    for (const block of cssBlocks(readFileSync(absolutePath, "utf8"))) {
      for (const declaration of block.declarations) {
        if (!spacingProperties.test(declaration.property)) continue;
        const literals = [...declaration.value.matchAll(/(?<![\w.])(-?[0-9.]+)px\b/g)].map((item) => Number.parseFloat(item[1]));
        const allowedOpticalValues = opticalSpacingAllowlist.get(
          `${displayPath(absolutePath)}|${block.selector}|${declaration.property}`,
        ) ?? new Set();
        const offGrid = literals.filter((value) => {
          const magnitude = Math.abs(value);
          return magnitude !== 0 && magnitude % 4 !== 0 && !allowedOpticalValues.has(value);
        });
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

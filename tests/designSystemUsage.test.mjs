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
const releaseCssSource = releaseCssFiles.map((path) => readFileSync(path, "utf8")).join("\n");
const releaseCssClassNames = new Set(
  [...releaseCssSource.matchAll(/\.([a-z_][a-z0-9_-]*)/gi)].map((match) => match[1]),
);
const releaseSelectorAttributeNames = new Set(
  [...releaseCssSource.matchAll(/\[((?:aria|data)-[a-z0-9_-]+)(?:\s*[=\]])/gi)].map((match) => match[1].toLowerCase()),
);
const releaseAttributeValues = new Map();
const releaseAttributeValuesByClass = new Map();
const releaseSelectorAttributeNamesByClass = new Map();
const releaseUnscopedSelectorAttributeNames = new Set();
const releaseUnscopedAttributeValues = new Map();
for (const match of releaseCssSource.matchAll(/\[((?:aria|data)-[a-z0-9_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+))/gi)) {
  const name = match[1].toLowerCase();
  const values = releaseAttributeValues.get(name) ?? new Set();
  values.add(match[2] ?? match[3] ?? match[4]);
  releaseAttributeValues.set(name, values);
}
for (const block of cssBlocks(releaseCssSource)) {
  for (const selector of block.selectors) {
    const classes = [...selector.matchAll(/\.([a-z_][a-z0-9_-]*)/gi)].map((match) => match[1]);
    const attributes = [...selector.matchAll(/\[((?:aria|data)-[a-z0-9_-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?/gi)];
    if (classes.length === 0) {
      for (const attribute of attributes) {
        const name = attribute[1].toLowerCase();
        releaseUnscopedSelectorAttributeNames.add(name);
        const value = attribute[2] ?? attribute[3] ?? attribute[4];
        if (value != null) {
          const values = releaseUnscopedAttributeValues.get(name) ?? new Set();
          values.add(value);
          releaseUnscopedAttributeValues.set(name, values);
        }
      }
    }
    for (const className of classes) {
      const names = releaseSelectorAttributeNamesByClass.get(className) ?? new Set();
      for (const attribute of attributes) {
        const name = attribute[1].toLowerCase();
        names.add(name);
        const value = attribute[2] ?? attribute[3] ?? attribute[4];
        if (value != null) {
          const key = `${className}|${name}`;
          const values = releaseAttributeValuesByClass.get(key) ?? new Set();
          values.add(value);
          releaseAttributeValuesByClass.set(key, values);
        }
      }
      releaseSelectorAttributeNamesByClass.set(className, names);
    }
  }
}

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
  if (/^var\(--control-(?:min-size|size-icon)\)$/i.test(value)) return 44;
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

// 분석기가 한 파일에서 펼치는 상호작용 요소 시나리오 상한(폭발 방지용 용량 한계이며
// 디자인 규칙 자체는 아니다). 상한을 올리면 더 많은 요소가 검사되므로 규칙은 더 엄격해진다.
// 진행 표시자 계약으로 pending 버튼에 aria-busy 를 붙이면서 상태 조합이 늘어 32 를 넘었다.
const MAX_JSX_SCENARIOS = 64;

function assertScenarioLimit(count, kind) {
  if (count > MAX_JSX_SCENARIOS) {
    throw new Error(`JSX ${kind} scenario가 상한 ${MAX_JSX_SCENARIOS}개를 넘었습니다`);
  }
}

function uniqueBoundedClassScenarios(scenarios) {
  const unique = new Map();
  for (const scenario of scenarios) {
    const key = [...scenario].sort().join(" ");
    if (!unique.has(key)) unique.set(key, scenario);
    assertScenarioLimit(unique.size, "class");
  }
  return [...unique.values()];
}

function combineClassScenarios(left, right) {
  return uniqueBoundedClassScenarios(left.flatMap((leftClasses) => right.map((rightClasses) =>
    new Set([...leftClasses, ...rightClasses]))));
}

const UNKNOWN_CLASS_FRAGMENT = "\u0000";

function uniqueBoundedFragments(fragments) {
  const unique = [...new Set(fragments)];
  assertScenarioLimit(unique.length, "class fragment");
  return unique;
}

function classFragmentsFromExpression(expression, sourceFile, bindings, seen = new Set(), stringifyPrimitives = false) {
  if (!expression) return [""];
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression)
    || ts.isTypeAssertionExpression(expression) || ts.isNonNullExpression(expression)) {
    return classFragmentsFromExpression(expression.expression, sourceFile, bindings, seen, stringifyPrimitives);
  }
  if (ts.isStringLiteralLike(expression) || ts.isNumericLiteral(expression)) return [expression.text];
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return [stringifyPrimitives ? "true" : ""];
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return [stringifyPrimitives ? "false" : ""];
  if (expression.kind === ts.SyntaxKind.NullKeyword) return [stringifyPrimitives ? "null" : ""];
  if (ts.isConditionalExpression(expression)) {
    return uniqueBoundedFragments([
      ...classFragmentsFromExpression(expression.whenTrue, sourceFile, bindings, seen, stringifyPrimitives),
      ...classFragmentsFromExpression(expression.whenFalse, sourceFile, bindings, seen, stringifyPrimitives),
    ]);
  }
  if (ts.isBinaryExpression(expression)) {
    if (expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      return uniqueBoundedFragments(classFragmentsFromExpression(expression.left, sourceFile, bindings, seen, stringifyPrimitives)
        .flatMap((left) => classFragmentsFromExpression(expression.right, sourceFile, bindings, seen, stringifyPrimitives)
          .map((right) => `${left}${right}`)));
    }
    if (expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      return uniqueBoundedFragments(["", ...classFragmentsFromExpression(expression.right, sourceFile, bindings, seen, stringifyPrimitives)]);
    }
    if (expression.operatorToken.kind === ts.SyntaxKind.BarBarToken
      || expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
      return uniqueBoundedFragments([
        ...classFragmentsFromExpression(expression.left, sourceFile, bindings, seen, stringifyPrimitives),
        ...classFragmentsFromExpression(expression.right, sourceFile, bindings, seen, stringifyPrimitives),
      ]);
    }
  }
  if (ts.isIdentifier(expression)) {
    if (seen.has(expression.text)) return [UNKNOWN_CLASS_FRAGMENT];
    const initializer = visibleBinding(expression.text, expression, sourceFile, bindings)?.initializer;
    return initializer
      ? classFragmentsFromExpression(initializer, sourceFile, bindings, new Set([...seen, expression.text]), stringifyPrimitives)
      : [UNKNOWN_CLASS_FRAGMENT];
  }
  return [UNKNOWN_CLASS_FRAGMENT];
}

function classScenariosFromRenderedTemplate(rendered) {
  let scenarios = [new Set()];
  for (const token of rendered.split(/\s+/).filter(Boolean)) {
    // 컴포넌트가 그대로 전달받는 전체 className prop은 이 파일 안에서 variant 후보를 확정할 수 없습니다.
    // 정적 prefix/suffix가 있는 동적 variant만 CSS 정본에서 열거합니다.
    if (token === UNKNOWN_CLASS_FRAGMENT) continue;
    if (!token.includes(UNKNOWN_CLASS_FRAGMENT)) {
      const classes = new Set();
      addClassTokens(token, classes);
      scenarios = combineClassScenarios(scenarios, [classes]);
      continue;
    }
    const pattern = new RegExp(`^${token.split(UNKNOWN_CLASS_FRAGMENT)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("[a-z0-9_-]+")}$`, "i");
    const matches = [...releaseCssClassNames].filter((className) => pattern.test(className));
    if (matches.length === 0) throw new Error(`동적 class suffix를 CSS selector에서 해석할 수 없습니다: ${token}`);
    scenarios = combineClassScenarios(scenarios, matches.map((className) => new Set([className])));
  }
  return scenarios;
}

function classScenariosFromExpression(expression, sourceFile, bindings, seen = new Set()) {
  if (!expression) return [new Set()];
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression)
    || ts.isTypeAssertionExpression(expression) || ts.isNonNullExpression(expression)) {
    return classScenariosFromExpression(expression.expression, sourceFile, bindings, seen);
  }
  if (ts.isStringLiteralLike(expression)) {
    const classes = new Set();
    addClassTokens(expression.text, classes);
    return [classes];
  }
  if (expression.kind === ts.SyntaxKind.TrueKeyword || expression.kind === ts.SyntaxKind.FalseKeyword
    || expression.kind === ts.SyntaxKind.NullKeyword) return [new Set()];
  if (ts.isConditionalExpression(expression)) {
    return uniqueBoundedClassScenarios([
      ...classScenariosFromExpression(expression.whenTrue, sourceFile, bindings, seen),
      ...classScenariosFromExpression(expression.whenFalse, sourceFile, bindings, seen),
    ]);
  }
  if (ts.isBinaryExpression(expression)) {
    if (expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      return combineClassScenarios(
        classScenariosFromExpression(expression.left, sourceFile, bindings, seen),
        classScenariosFromExpression(expression.right, sourceFile, bindings, seen),
      );
    }
    if (expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      return uniqueBoundedClassScenarios([
        new Set(),
        ...classScenariosFromExpression(expression.right, sourceFile, bindings, seen),
      ]);
    }
    if (expression.operatorToken.kind === ts.SyntaxKind.BarBarToken
      || expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
      return uniqueBoundedClassScenarios([
        ...classScenariosFromExpression(expression.left, sourceFile, bindings, seen),
        ...classScenariosFromExpression(expression.right, sourceFile, bindings, seen),
      ]);
    }
  }
  if (ts.isTemplateExpression(expression)) {
    let rendered = [expression.head.text];
    for (const span of expression.templateSpans) {
      const fragments = classFragmentsFromExpression(span.expression, sourceFile, bindings, seen, true);
      rendered = uniqueBoundedFragments(rendered.flatMap((base) => fragments.map((fragment) =>
        `${base}${fragment}${span.literal.text}`)));
    }
    return uniqueBoundedClassScenarios(rendered.flatMap(classScenariosFromRenderedTemplate));
  }
  if (ts.isIdentifier(expression)) {
    if (seen.has(expression.text)) return [new Set()];
    const initializer = visibleBinding(expression.text, expression, sourceFile, bindings)?.initializer;
    return initializer
      ? classScenariosFromExpression(initializer, sourceFile, bindings, new Set([...seen, expression.text]))
      : [new Set()];
  }
  if (ts.isArrayLiteralExpression(expression)) {
    return expression.elements.reduce((scenarios, element) => combineClassScenarios(
      scenarios,
      classScenariosFromExpression(element, sourceFile, bindings, seen),
    ), [new Set()]);
  }
  if (ts.isCallExpression(expression)) {
    return expression.arguments.reduce((scenarios, argument) => combineClassScenarios(
      scenarios,
      classScenariosFromExpression(argument, sourceFile, bindings, seen),
    ), [new Set()]);
  }
  return [new Set()];
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
  if (ts.isStringLiteralLike(expression)) {
    return { resolved: true, values: [{ text: expression.text, truthy: expression.text.length > 0, present: true }] };
  }
  if (ts.isNumericLiteral(expression)) {
    return { resolved: true, values: [{ text: expression.text, truthy: Number(expression.text) !== 0, present: true }] };
  }
  if (expression.kind === ts.SyntaxKind.TrueKeyword) {
    return { resolved: true, values: [{ text: "true", truthy: true, present: true }] };
  }
  if (expression.kind === ts.SyntaxKind.FalseKeyword) {
    return { resolved: true, values: [{ text: "false", truthy: false, present: true }] };
  }
  if (expression.kind === ts.SyntaxKind.NullKeyword
    || (ts.isIdentifier(expression) && expression.text === "undefined")) {
    return { resolved: true, values: [{ text: "", truthy: false, present: false }] };
  }
  if (ts.isPrefixUnaryExpression(expression) && ts.isNumericLiteral(expression.operand)) {
    const sign = expression.operator === ts.SyntaxKind.MinusToken ? -1 : 1;
    const value = sign * Number(expression.operand.text);
    return { resolved: true, values: [{ text: String(value), truthy: value !== 0, present: true }] };
  }
  if (ts.isConditionalExpression(expression)) {
    const left = staticJsxAttributeValues(expression.whenTrue, sourceFile, bindings, seen);
    const right = staticJsxAttributeValues(expression.whenFalse, sourceFile, bindings, seen);
    if (!left.resolved || !right.resolved) return { resolved: false, values: [] };
    const unique = new Map([...left.values, ...right.values].map((value) => [
      `${value.present ? "1" : "0"}:${value.truthy ? "1" : "0"}:${value.text}`,
      value,
    ]));
    return { resolved: true, values: [...unique.values()] };
  }
  if (ts.isIdentifier(expression)) {
    if (seen.has(expression.text)) return { resolved: false, values: [] };
    const initializer = visibleBinding(expression.text, expression, sourceFile, bindings)?.initializer;
    return initializer
      ? staticJsxAttributeValues(initializer, sourceFile, bindings, new Set([...seen, expression.text]))
      : { resolved: false, values: [] };
  }
  return { resolved: false, values: [] };
}

function attributeScenarioKey(attributes) {
  return [...attributes.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([name, descriptor]) =>
    `${name}:${descriptor.present ? "1" : "0"}:${descriptor.dynamic ? "d" : "s"}:${[...descriptor.values].sort().join(",")}`)
    .join("|");
}

function uniqueBoundedAttributeScenarios(scenarios) {
  const unique = new Map();
  for (const scenario of scenarios) {
    const key = attributeScenarioKey(scenario);
    if (!unique.has(key)) unique.set(key, scenario);
    assertScenarioLimit(unique.size, "attribute");
  }
  return [...unique.values()];
}

function attributeScenariosFromOpening(opening, sourceFile, bindings) {
  let scenarios = [new Map()];
  const booleanAttributes = new Set([
    "checked", "disabled", "hidden", "multiple", "open", "readOnly", "required", "selected",
  ].map((name) => name.toLowerCase()));
  const openingClasses = classNamesFromOpening(opening, sourceFile, bindings);
  const selectorReferences = (name) => releaseUnscopedSelectorAttributeNames.has(name)
    || (openingClasses.size > 0
      ? [...openingClasses].some((className) => releaseSelectorAttributeNamesByClass.get(className)?.has(name))
      : releaseSelectorAttributeNames.has(name));
  for (const attribute of opening.attributes.properties) {
    if (ts.isJsxSpreadAttribute(attribute)) {
      throw new Error(`JSX attribute spread는 scenario 해석을 지원하지 않습니다: ${attribute.getText(sourceFile)}`);
    }
    if (!ts.isJsxAttribute(attribute)) continue;
    const name = attribute.name.getText(sourceFile).toLowerCase();
    if (name === "classname" || name === "style") continue;
    let options;
    if (!attribute.initializer) {
      options = [{ present: true, values: new Set([""]), dynamic: false }];
    } else if (ts.isStringLiteral(attribute.initializer)) {
      options = booleanAttributes.has(name) && attribute.initializer.text.length === 0
        ? [null]
        : [{ present: true, values: new Set([attribute.initializer.text]), dynamic: false }];
    } else if (ts.isJsxExpression(attribute.initializer)) {
      const result = staticJsxAttributeValues(attribute.initializer.expression, sourceFile, bindings);
      if (booleanAttributes.has(name)) {
        options = result.resolved
          ? result.values.map((value) => !value.truthy
            ? null
            : { present: true, values: new Set([""]), dynamic: false })
          : [null, { present: true, values: new Set([""]), dynamic: false }];
      } else if (result.resolved) {
        if ((name.startsWith("aria-") || name.startsWith("data-")) && !selectorReferences(name)) {
          const presentValues = result.values.filter((value) => value.present).map((value) => value.text);
          options = presentValues.length > 0
            ? [{ present: true, values: new Set(presentValues), dynamic: false }]
            : [null];
        } else {
          options = result.values.map((value) => value.present
            ? { present: true, values: new Set([value.text]), dynamic: false }
            : null);
        }
      } else if (name.startsWith("aria-") || name.startsWith("data-")) {
        const contextualValues = new Set([...openingClasses].flatMap((className) => [
          ...(releaseAttributeValuesByClass.get(`${className}|${name}`) ?? []),
        ]).concat([...(releaseUnscopedAttributeValues.get(name) ?? [])]));
        if (!selectorReferences(name)) {
          options = [{ present: true, values: new Set(), dynamic: true }];
        } else {
          const cssValues = contextualValues.size > 0 ? contextualValues : releaseAttributeValues.get(name) ?? new Set();
          const values = new Set([
            ...(name.startsWith("aria-") ? ["false", "true"] : cssValues.size === 0 ? ["false", "true"] : []),
            ...cssValues,
          ]);
          options = [
            null,
            ...[...values].map((value) => ({ present: true, values: new Set([value]), dynamic: false })),
          ];
        }
      } else {
        options = [{ present: true, values: new Set(), dynamic: true }];
      }
    } else {
      options = [{ present: true, values: new Set(), dynamic: true }];
    }
    scenarios = uniqueBoundedAttributeScenarios(scenarios.flatMap((scenario) => options.map((descriptor) => {
      const next = new Map(scenario);
      if (descriptor) next.set(name, descriptor);
      return next;
    })));
  }
  return scenarios;
}

function attributesFromOpening(opening, sourceFile, bindings) {
  return attributeScenariosFromOpening(opening, sourceFile, bindings)[0] ?? new Map();
}

function collectBindingInitializers(sourceFile) {
  const bindings = new Map();
  const bindingScope = (node) => {
    let current = node.parent;
    while (current) {
      if (ts.isBlock(current) || ts.isSourceFile(current) || ts.isModuleBlock(current)
        || ts.isCaseBlock(current) || ts.isCatchClause(current)
        || ts.isForStatement(current) || ts.isForInStatement(current) || ts.isForOfStatement(current)
        || ts.isFunctionDeclaration(current) || ts.isFunctionExpression(current)
        || ts.isArrowFunction(current) || ts.isMethodDeclaration(current)
        || ts.isConstructorDeclaration(current) || ts.isGetAccessorDeclaration(current)
        || ts.isSetAccessorDeclaration(current)) return current;
      current = current.parent;
    }
    return sourceFile;
  };
  const add = (name, initializer, declaration) => {
    const entries = bindings.get(name) ?? [];
    entries.push({ initializer: initializer ?? null, position: declaration.getStart(sourceFile), scope: bindingScope(declaration) });
    bindings.set(name, entries);
  };
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      add(node.name.text, node.initializer, node);
    } else if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
      add(node.name.text, node.initializer, node);
    } else if (ts.isBindingElement(node) && ts.isIdentifier(node.name)) {
      add(node.name.text, node.initializer, node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return bindings;
}

function visibleBinding(name, expression, sourceFile, bindings) {
  const expressionStart = expression.getStart(sourceFile);
  const candidates = (bindings.get(name) ?? []).flatMap((candidate) => {
    if (candidate.position > expressionStart) return [];
    let distance = 0;
    let current = expression;
    while (current && current !== candidate.scope) {
      current = current.parent;
      distance += 1;
    }
    return current === candidate.scope ? [{ ...candidate, distance }] : [];
  }).sort((left, right) => left.distance - right.distance || right.position - left.position);
  return candidates[0] ?? null;
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
    const initializer = visibleBinding(expression.text, expression, sourceFile, bindings)?.initializer;
    if (!initializer) return { resolved: false, values: [] };
    return staticStyleValues(initializer, sourceFile, bindings, new Set([...seen, expression.text]));
  }
  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
    const initializer = visibleBinding(expression.expression.text, expression, sourceFile, bindings)?.initializer;
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

function styleUnknownDeclaration(node) {
  return { property: "*", value: null, values: [], resolved: false, node };
}

function stylePropertyName(name, sourceFile) {
  if (ts.isComputedPropertyName(name)) {
    return ts.isStringLiteralLike(name.expression) || ts.isNumericLiteral(name.expression)
      ? name.expression.text
      : null;
  }
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text;
  return name.getText(sourceFile).replace(/^['"]|['"]$/g, "");
}

function mergeStyleDeclarations(base, overrides) {
  const merged = [...base];
  for (const declaration of overrides) {
    const previous = merged.findIndex((item) => item.property === declaration.property);
    if (previous >= 0) merged.splice(previous, 1);
    merged.push(declaration);
  }
  return merged;
}

function styleObjectsFromExpression(expression, sourceFile, bindings, seen = new Set()) {
  if (!expression) return [[styleUnknownDeclaration(expression)]];
  if (expression.kind === ts.SyntaxKind.NullKeyword
    || (ts.isIdentifier(expression) && expression.text === "undefined")) return [[]];
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression)
    || ts.isTypeAssertionExpression(expression) || ts.isNonNullExpression(expression)) {
    return styleObjectsFromExpression(expression.expression, sourceFile, bindings, seen);
  }
  if (ts.isConditionalExpression(expression)) {
    return [
      ...styleObjectsFromExpression(expression.whenTrue, sourceFile, bindings, seen),
      ...styleObjectsFromExpression(expression.whenFalse, sourceFile, bindings, seen),
    ];
  }
  if (ts.isIdentifier(expression)) {
    if (seen.has(expression.text)) return [[styleUnknownDeclaration(expression)]];
    const initializer = visibleBinding(expression.text, expression, sourceFile, bindings)?.initializer;
    return initializer
      ? styleObjectsFromExpression(initializer, sourceFile, bindings, new Set([...seen, expression.text]))
      : [[styleUnknownDeclaration(expression)]];
  }
  if (!ts.isObjectLiteralExpression(expression)) return [[styleUnknownDeclaration(expression)]];

  let scenarios = [[]];
  for (const property of expression.properties) {
    if (ts.isSpreadAssignment(property)) {
      const spreadScenarios = styleObjectsFromExpression(property.expression, sourceFile, bindings, seen);
      scenarios = scenarios.flatMap((scenario) => spreadScenarios.map((spread) =>
        mergeStyleDeclarations(scenario, spread)));
      continue;
    }
    let name;
    let valueNode;
    if (ts.isPropertyAssignment(property)) {
      name = stylePropertyName(property.name, sourceFile);
      if (name == null) {
        scenarios = scenarios.map((scenario) => mergeStyleDeclarations(scenario, [styleUnknownDeclaration(property)]));
        continue;
      }
      valueNode = property.initializer;
    } else if (ts.isShorthandPropertyAssignment(property)) {
      name = property.name.text;
      valueNode = property.name;
    } else {
      scenarios = scenarios.map((scenario) => mergeStyleDeclarations(scenario, [styleUnknownDeclaration(property)]));
      continue;
    }
    const result = staticStyleValues(valueNode, sourceFile, bindings);
    const declaration = {
      property: name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`),
      value: result.values.length === 1 ? result.values[0] : null,
      values: result.values,
      resolved: result.resolved,
      node: valueNode,
    };
    scenarios = scenarios.map((scenario) => mergeStyleDeclarations(scenario, [declaration]));
  }
  return scenarios;
}

function isInsideLabel(node, sourceFile) {
  let current = node.parent;
  while (current) {
    if (ts.isJsxElement(current) && current.openingElement.tagName.getText(sourceFile) === "label") return true;
    current = current.parent;
  }
  return false;
}

function classNameScenariosFromOpening(opening, sourceFile, bindings) {
  const classAttribute = jsxAttribute(opening, "className", sourceFile);
  if (!classAttribute?.initializer) return [new Set()];
  if (ts.isStringLiteral(classAttribute.initializer)) {
    const classes = new Set();
    addClassTokens(classAttribute.initializer.text, classes);
    return [classes];
  }
  if (ts.isJsxExpression(classAttribute.initializer)) {
    return classScenariosFromExpression(classAttribute.initializer.expression, sourceFile, bindings);
  }
  return [new Set()];
}

function classNamesFromOpening(opening, sourceFile, bindings = new Map()) {
  const classes = new Set();
  for (const scenario of classNameScenariosFromOpening(opening, sourceFile, bindings)) {
    for (const className of scenario) classes.add(className);
  }
  return classes;
}

function openingDescriptorScenarios(opening, sourceFile, bindings) {
  const tagName = opening.tagName.getText(sourceFile);
  const renderedTag = tagName === "Link" || tagName === "NavLink" ? "a" : tagName;
  const classScenarios = classNameScenariosFromOpening(opening, sourceFile, bindings);
  const attributeScenarios = attributeScenariosFromOpening(opening, sourceFile, bindings);
  const descriptors = [];
  for (const classes of classScenarios) {
    for (const attributes of attributeScenarios) {
      const states = new Set();
      if (attributes.has("disabled")) states.add("disabled");
      if (attributes.has("checked")) states.add("checked");
      descriptors.push({ renderedTag, classes, attributes, states });
      assertScenarioLimit(descriptors.length, "element descriptor");
    }
  }
  return descriptors;
}

function collectAncestorDescriptorScenarios(node, sourceFile, bindings) {
  let scenarios = [[]];
  let current = node.parent;
  while (current) {
    if (ts.isJsxElement(current) && current.openingElement !== node) {
      const descriptors = openingDescriptorScenarios(current.openingElement, sourceFile, bindings);
      const combined = [];
      for (const scenario of scenarios) {
        for (const descriptor of descriptors) {
          combined.push([...scenario, descriptor]);
          assertScenarioLimit(combined.length, "ancestor");
        }
      }
      scenarios = combined;
    }
    current = current.parent;
  }
  for (const ancestors of scenarios) {
    if (!ancestors.some((ancestor) => ancestor.renderedTag.toLowerCase() === "body")) {
      ancestors.push({ renderedTag: "body", classes: new Set(), attributes: new Map(), states: new Set() });
    }
  }
  return scenarios;
}

function collectElementsFromSource(path, source) {
  const elements = [];
  const intrinsicInteractiveTags = new Set(["button", "a", "input", "select", "textarea"]);
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const bindings = collectBindingInitializers(sourceFile);
  const visit = (node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tagName = node.tagName.getText(sourceFile);
      const skipDelegatedInput = tagName === "input" && isInsideLabel(node, sourceFile);
      if (!skipDelegatedInput) {
        const classScenarios = classNameScenariosFromOpening(node, sourceFile, bindings);
        const attributeScenarios = attributeScenariosFromOpening(node, sourceFile, bindings);
        const ancestorScenarios = collectAncestorDescriptorScenarios(node, sourceFile, bindings);
        const styleAttribute = jsxAttribute(node, "style", sourceFile);
        const styles = styleAttribute?.initializer && ts.isJsxExpression(styleAttribute.initializer)
          ? styleObjectsFromExpression(styleAttribute.initializer.expression, sourceFile, bindings)
          : [];
        let emitted = 0;
        for (const classes of classScenarios) {
          for (const attributes of attributeScenarios) {
            const roleValues = attributes.get("role")?.values ?? new Set();
            const typeValues = attributes.get("type")?.values ?? new Set();
            const isInteractive = intrinsicInteractiveTags.has(tagName)
              || tagName === "Link"
              || tagName === "NavLink"
              || roleValues.has("button");
            if (!isInteractive || attributes.has("hidden") || typeValues.has("hidden")) continue;
            for (const ancestors of ancestorScenarios) {
              const states = new Set();
              if (attributes.has("disabled")) states.add("disabled");
              if (attributes.has("checked")) states.add("checked");
              elements.push({
                path,
                line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
                sourcePosition: node.getStart(sourceFile),
                tagName,
                renderedTag: tagName === "Link" || tagName === "NavLink" ? "a" : tagName,
                classes,
                attributes,
                ancestors,
                ancestorClasses: new Set(ancestors.flatMap((ancestor) => [...ancestor.classes])),
                states,
                styles,
              });
              emitted += 1;
              if (emitted > MAX_JSX_SCENARIOS) {
                const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
                throw new Error(`JSX interactive element scenario가 ${path}:${line}에서 상한 ${MAX_JSX_SCENARIOS}개를 넘었습니다`);
              }
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return elements;
}

function collectReleaseElements() {
  return releaseTsxFiles.flatMap((absolutePath) => {
    const path = displayPath(absolutePath);
    try {
      return collectElementsFromSource(path, readFileSync(absolutePath, "utf8"));
    } catch (error) {
      throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  });
}

const releaseElements = collectReleaseElements();

function inlineStyleTarget(opening, sourceFile, bindings) {
  const tagName = opening.tagName.getText(sourceFile);
  const ownClasses = classNamesFromOpening(opening, sourceFile, bindings);
  if (ownClasses.size > 0) return [...ownClasses].sort().join(".");
  let current = opening.parent;
  while (current) {
    if (ts.isJsxElement(current)) {
      const ancestorClasses = classNamesFromOpening(current.openingElement, sourceFile, bindings);
      if (ancestorClasses.size > 0) return `${[...ancestorClasses].sort().join(".")}>${tagName}`;
    }
    current = current.parent;
  }
  return tagName;
}

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
            target: inlineStyleTarget(node, sourceFile, bindings),
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
  const expression = declaration.node?.getText?.().replace(/\s+/g, " ") ?? "unknown-expression";
  return `${entry.path}|${entry.target ?? ([...entry.classes].sort().join(".") || entry.tagName)}|${declaration.property}|${expression}`;
}

const inlineDynamicScaleAllowlist = new Set([
  // 실제 진행률을 퍼센트로 표시하는 fill은 runtime 데이터에 따라 매 렌더 달라집니다.
  "src/screens/child/ChildHome.tsx|kd-prep__fill|width|`${prepPct}%`",
  "src/screens/child/StickerBook.tsx|sb-progress__fill|width|`${book.percent}%`",
  "src/screens/feature/DailySafetyReport.tsx|dr-progress>span|width|`${supplyPercent}%`",
  "src/screens/onboarding/Onboarding.tsx|ob-progress__fill|width|`${percent}%`",
  // confetti 조각은 9/13px, 9/14px optical 장식이며 조작·레이아웃 surface가 아닙니다.
  "src/screens/child/overlays/Celebrate.tsx|ks-confetti|width|p.width",
  "src/screens/child/overlays/Celebrate.tsx|ks-confetti|height|p.height",
  // 사용자가 드래그하는 지도 높이는 160~520px 연속값이라 4px 단위로 양자화하지 않습니다.
  "src/screens/feature/PlaceForm.tsx|pf-map|height|mapH",
]);

function inlineScaleViolations(entries, elements = [], dynamicAllowlist = new Set()) {
  const violations = [];
  const dimensionProperties = new Set(["min-height", "min-width", "height", "width"]);
  const spacingProperties = /^(?:(?:padding|margin)(?:-(?:top|right|bottom|left|block|inline))?|gap|row-gap|column-gap)$/;

  for (const entry of entries) {
    const isInteractive = elements.some((element) => element.path === entry.path && element.line === entry.line);
    const isVisualAsset = entry.tagName === "img" || entry.tagName === "svg";
    for (const declaration of entry.declarations) {
      if (declaration.property === "*" && !declaration.resolved) {
        if (!dynamicAllowlist.has(inlineStyleKey(entry, declaration))) {
          violations.push(`${entry.path}:${entry.line} <${entry.tagName}> (style object/spread: 동적/해석 불가)`);
        }
        continue;
      }
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

test("inline style AST는 CONST_OBJECT·nested alias·object spread를 같은 선언으로 해석한다", () => {
  const entries = collectInlineStylesFromSource("fixture/ObjectAliases.tsx", `
    const CONST_OBJECT = { marginRight: 5, width: 8 };
    const NESTED_ALIAS = CONST_OBJECT;
    export function Fixture() {
      return <>
        <span className="direct-object" style={CONST_OBJECT} />
        <span className="nested-object" style={NESTED_ALIAS} />
        <span className="spread-object" style={{ ...NESTED_ALIAS }} />
      </>;
    }
  `);
  assert.deepEqual(entries.map((entry) => [...entry.classes][0]), [
    "direct-object", "nested-object", "spread-object",
  ]);
  for (const entry of entries) {
    assert.deepEqual(entry.declarations.map(({ property, value }) => [property, value]), [
      ["margin-right", "5px"],
      ["width", "8px"],
    ]);
  }
  assert.equal(inlineScaleViolations(entries).length, 3, "각 object 경로의 5px 간격을 모두 잡아야 합니다");
});

test("inline style AST는 여러 spread의 순서와 override를 지키고 unknown·순환 spread를 숨기지 않는다", () => {
  const entries = collectInlineStylesFromSource("fixture/ObjectSpreads.tsx", `
    const BASE = { marginRight: 5, width: 8 };
    const EXTRA = { ...BASE, gap: 5 };
    const CYCLE_A = CYCLE_B;
    const CYCLE_B = CYCLE_A;
    export function Fixture({ runtimeStyle }) {
      return <>
        <span className="merged-object" style={{ ...BASE, ...EXTRA, marginRight: 4 }} />
        <span className="unknown-object" style={{ ...runtimeStyle, marginRight: 4 }} />
        <span className="cycle-object" style={CYCLE_A} />
      </>;
    }
  `);
  assert.deepEqual(entries.map((entry) => [...entry.classes][0]), [
    "merged-object", "unknown-object", "cycle-object",
  ]);
  const byClass = new Map(entries.map((entry) => [[...entry.classes][0], entry]));
  assert.deepEqual(byClass.get("merged-object").declarations.map(({ property, value }) => [property, value]), [
    ["width", "8px"],
    ["gap", "5px"],
    ["margin-right", "4px"],
  ]);
  for (const className of ["unknown-object", "cycle-object"]) {
    const entry = byClass.get(className);
    const unresolved = entry.declarations.find((declaration) => declaration.property === "*");
    assert.equal(unresolved?.resolved, false, `${className}의 해석 불가 style object를 보존해야 합니다`);
    assert.equal(inlineScaleViolations([entry]).length, 1);
    assert.deepEqual(
      inlineScaleViolations([entry], [], new Set([inlineStyleKey(entry, unresolved)])),
      [],
      "해석 불가 spread는 정확한 path+class+property allowlist만 허용해야 합니다",
    );
  }
});

test("inline style AST는 conditional의 undefined·null 분기를 style 부재로 해석한다", () => {
  const entries = collectInlineStylesFromSource("fixture/OptionalStyles.tsx", `
    export function Fixture({ compact, dragged }) {
      return <>
        <div className="undefined-style" style={compact ? { minHeight: 56 } : undefined} />
        <div className="null-style" style={dragged ? { transform: "translateY(4px)" } : null} />
      </>;
    }
  `);
  const byClass = new Map();
  for (const entry of entries) {
    const className = [...entry.classes][0];
    const scenarios = byClass.get(className) ?? [];
    scenarios.push(entry.declarations);
    byClass.set(className, scenarios);
  }

  assert.deepEqual(byClass.get("undefined-style").map((scenario) => scenario.map(
    ({ property, value, values, resolved }) => ({ property, value, values, resolved }),
  )), [
    [{ property: "min-height", value: "56px", values: ["56px"], resolved: true }],
    [],
  ]);
  assert.equal(byClass.get("null-style").length, 2);
  assert.deepEqual(byClass.get("null-style")[1], []);
});

test("inline style AST는 computed literal key를 실제 속성으로 검사하고 동적 key를 숨기지 않는다", () => {
  const entries = collectInlineStylesFromSource("fixture/ComputedStyles.tsx", `
    export function Fixture({ runtimeKey }) {
      return <>
        <span className="literal-key" style={{ ["width"]: 13 }} />
        <span className="dynamic-key" style={{ [runtimeKey]: 13 }} />
      </>;
    }
  `);
  const byClass = new Map(entries.map((entry) => [[...entry.classes][0], entry]));
  assert.equal(byClass.get("literal-key").declarations[0].property, "width");
  assert.equal(inlineScaleViolations([byClass.get("literal-key")]).length, 1);
  assert.equal(byClass.get("dynamic-key").declarations[0].property, "*");
  assert.equal(inlineScaleViolations([byClass.get("dynamic-key")]).length, 1);
});

test("inline style AST binding은 다른 lexical scope의 동명 const로 parameter를 오해하지 않는다", () => {
  const entries = collectInlineStylesFromSource("fixture/LexicalBindings.tsx", `
    function First() {
      const size = 16;
      return <span className="first-size" style={{ width: size }} />;
    }
    function Second({ size }) {
      return <span className="second-size" style={{ width: size }} />;
    }
  `);
  const byClass = new Map(entries.map((entry) => [[...entry.classes][0], entry]));
  assert.deepEqual(byClass.get("first-size").declarations[0].values, ["16px"]);
  assert.equal(byClass.get("second-size").declarations[0].resolved, false);
  assert.equal(inlineScaleViolations([byClass.get("second-size")]).length, 1);
});

test("동적 inline style allowlist key는 줄 이동과 무관하고 path·class·property에는 정확하다", () => {
  const declaration = { property: "width" };
  const first = { path: "fixture/Stable.tsx", line: 10, tagName: "span", classes: new Set(["fill"]) };
  const shifted = { ...first, line: 42 };

  assert.equal(inlineStyleKey(first, declaration), inlineStyleKey(shifted, declaration));
  assert.notEqual(inlineStyleKey(first, declaration), inlineStyleKey({ ...first, path: "fixture/Other.tsx" }, declaration));
  assert.notEqual(inlineStyleKey(first, declaration), inlineStyleKey({ ...first, classes: new Set(["other"]) }, declaration));
  assert.notEqual(inlineStyleKey(first, declaration), inlineStyleKey(first, { property: "height" }));
});

test("무클래스 inline style allowlist key는 가장 가까운 class 조상으로 node 문맥을 분리한다", () => {
  const entries = collectInlineStylesFromSource("fixture/ContextStyles.tsx", `
    export function Fixture({ firstWidth, secondWidth }) {
      return <>
        <div className="first-progress"><span style={{ width: firstWidth }} /></div>
        <div className="second-progress"><span style={{ width: secondWidth }} /></div>
        <div className="shared-progress"><span style={{ width: firstWidth }} /></div>
        <div className="shared-progress"><span style={{ width: secondWidth }} /></div>
      </>;
    }
  `);
  assert.equal(entries.length, 4);
  assert.notEqual(
    inlineStyleKey(entries[0], entries[0].declarations[0]),
    inlineStyleKey(entries[1], entries[1].declarations[0]),
  );
  assert.notEqual(
    inlineStyleKey(entries[2], entries[2].declarations[0]),
    inlineStyleKey(entries[3], entries[3].declarations[0]),
    "같은 class 문맥의 서로 다른 동적 표현식도 하나의 허용으로 합치면 안 됩니다",
  );
  const allowlist = new Set([inlineStyleKey(entries[0], entries[0].declarations[0])]);
  assert.equal(inlineScaleViolations(entries, [], allowlist).length, 3, "한 node의 허용이 다른 무클래스 span까지 열면 안 됩니다");
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
    ["src/screens/child/ChildHome.css", "kd-memo-banner", "card"],
    ["src/screens/child/ChildHome.css", "kd-sticker-banner", "card"],
    ["src/screens/child/StickerBook.css", "sb-progress", "card"],
    ["src/screens/child/StickerBook.css", "sb-slot", "card"],
    ["src/screens/child/ChildSos.css", "cs-checks", "card"],
    ["src/screens/child/ChildSos.css", "cs-query-note", "card"],
    ["src/screens/feature/AiCredit.css", "ac-pack", "card"],
    ["src/screens/feature/AiCredit.css", "ac-auto", "card"],
    ["src/screens/feature/AiCredit.css", "ac-premium-callout", "card"],
    ["src/components/ChildLocationPermissionDialog.css", "clp-dialog", "modal"],
    ["src/components/MapPickerSheet.css", "mps-sheet", "sheet"],
    ["src/components/MapPickerSheet.css", "mps-map", "media"],
    ["src/components/MessageSafetyDialog.css", "msd-dialog", "modal"],
    ["src/components/QrScanner.css", "qrs-cam", "media"],
    ["src/screens/onboarding/Onboarding.css", "ob-qr", "media"],
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
    ["src/screens/feature/Subscription.css", "sub-web-unavailable", "card"],
    ["src/screens/feature/Subscription.css", "sub-cancel", "card"],
    ["src/screens/feature/AiSchedule.css", "ais-result", "card"],
    ["src/screens/feature/AiSchedule.css", "ais-academy-intro", "card"],
    ["src/screens/feature/AiSchedule.css", "ais-academy-lock__premium", "card"],
    ["src/components/PremiumUpsell.css", "pu-dialog", "modal"],
    ["src/components/ReferralRewardPanel.css", "rrp__dialog", "modal"],
    ["src/components/ReferralRewardPanel.css", "rrp__policy", "card"],
    ["src/components/ReferralRewardPanel.css", "rrp__state", "card"],
    ["src/components/ReferralRewardPanel.css", "rrp__progress", "card"],
    ["src/components/ReferralRewardPanel.css", "rrp__code", "card"],
    ["src/components/ReferralRewardPanel.css", "rrp__complete", "card"],
    ["src/screens/feature/DataSync.css", "ds-sync", "card"],
    ["src/screens/feature/FamilyConnection.css", "fc-invite", "card"],
    ["src/screens/feature/Notifications.css", "nc-item", "card"],
    ["src/screens/feature/PlaceManager.css", "pm-item", "card"],
    ["src/screens/feature/PlaceManager.css", "pm-danger", "card"],
    ["src/screens/feature/FriendPlay.css", "fp-connected", "card"],
    ["src/screens/teacher/TeacherNotice.css", "tn-empty", "card"],
    ["src/styles/components.css", "hy-toast", "floating"],
    ["src/styles/components.css", "hy-card", "card"],
    ["src/screens/parent/ParentHome.css", "ph-hero", "hero"],
    ["src/screens/parent/ParentHome.css", "ph-ai", "card"],
    ["src/screens/parent/ParentCalendar.css", "pc-card", "card"],
    ["src/screens/parent/ParentCalendar.css", "pc-event__card", "card"],
    ["src/screens/parent/ParentCalendar.css", "pc-sheet", "sheet"],
    ["src/screens/parent/ParentLocation.css", "pl-sheet", "sheet"],
    ["src/screens/parent/ParentLocation.css", "pl-history-toolbar", "floating"],
    ["src/screens/parent/ParentLocation.css", "pl-journey", "sheet"],
    ["src/screens/parent/ParentLocation.css", "pl-journey__state", "card"],
    ["src/screens/parent/ParentLocation.css", "pl-journey__replay", "card"],
    ["src/screens/parent/ParentLocation.css", "pl-journey__stay", "card"],
    ["src/screens/parent/ParentFamily.css", "pf-invite-card", "card"],
    ["src/screens/parent/ParentFamily.css", "pf-conn", "card"],
    ["src/screens/parent/ParentFamily.css", "pf-paircode__card", "card"],
    ["src/screens/parent/ParentSettings.css", "ps-list", "card"],
    ["src/screens/parent/ParentSettings.css", "ps-modal__card", "modal"],
    ["src/screens/shared/MemoChat.css", "mc-photo-preview__panel", "modal"],
    ["src/screens/child/overlays/ChildSheet.css", "ks-sheet", "sheet"],
    ["src/screens/child/overlays/ChildSheet.css", "ks-friend", "card"],
    ["src/screens/child/overlays/ChildSheet.css", "ks-empty", "card"],
    ["src/screens/child/overlays/ChildSheet.css", "ks-route__strip", "media"],
    ["src/screens/child/overlays/ChildSheet.css", "ks-route__step", "card"],
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
    ["src/screens/teacher/TeacherStudents.css", "ts-row", "card"],
    ["src/screens/teacher/TeacherStudents.css", "ts-sheet", "sheet"],
    ["src/screens/teacher/TeacherReleaseGate.css", "trg-card", "card"],
    ["src/screens/teacher/TeacherReleaseGate.css", "trg-dialog__card", "modal"],
    ["src/screens/onboarding/Onboarding.css", "ob-survey-card", "card"],
    ["src/screens/onboarding/Onboarding.css", "ob-connect-card", "card"],
    ["src/screens/onboarding/Onboarding.css", "ob-referral-notice", "card"],
    ["src/screens/onboarding/Onboarding.css", "ob-perm", "card"],
    ["src/screens/feature/RemoteAudio.css", "ra-trust-card", "card"],
    ["src/screens/feature/FriendPlay.css", "fp-card", "card"],
    ["src/screens/feature/FriendPlay.css", "fp-setting", "card"],
    ["src/screens/feature/FriendPlay.css", "fp-parent-card", "card"],
    ["src/screens/feature/AiSchedule.css", "ais-mode-intro", "card"],
    ["src/screens/feature/AiSchedule.css", "ais-upload", "media"],
    ["src/screens/feature/AiSchedule.css", "ais-preview__img", "media"],
    ["src/screens/feature/AiCredit.css", "ac-hero", "hero"],
    ["src/screens/feature/AiCredit.css", "ac-detail", "card"],
    ["src/screens/feature/Feedback.css", "fb-satis", "card"],
    ["src/screens/feature/Feedback.css", "fb-ideas__card", "card"],
    ["src/screens/feature/PhoneSetup.css", "psu-card", "card"],
    ["src/screens/feature/RouteView.css", "rv-empty", "card"],
    ["src/screens/feature/RouteView.css", "rv-map", "media"],
    ["src/screens/feature/ChildInvite.css", "ci-qr-card", "media"],
    ["src/screens/feature/StickerSend.css", "ss-preview__tile", "media"],
    ["src/screens/parent/EventForm.css", "ef-scope-sheet", "sheet"],
    ["src/screens/parent/EventForm.css", "ef-place-suggestions", "floating"],
    ["src/screens/feature/Supplies.css", "sup-status", "card"],
    ["src/screens/feature/Supplies.css", "sup-card", "card"],
    ["src/screens/feature/DangerZoneForm.css", "dzf-toggles", "card"],
    ["src/screens/feature/DangerZoneForm.css", "dzf-map", "media"],
    ["src/screens/feature/PlaceForm.css", "pf-map", "media"],
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
    ["src/screens/child/ChildSettings.css", "ks-help-modal__card", "modal"],
    ["src/screens/parent/ParentAccount.css", "pa-card", "card"],
    ["src/screens/parent/ParentAccount.css", "pa-action", "card"],
    ["src/screens/parent/ParentAccount.css", "pa-modal__card", "modal"],
    ["src/screens/feature/DataSync.css", "ds-card", "card"],
    ["src/screens/feature/NotificationSettings.css", "nst-list", "card"],
    ["src/screens/feature/LocationSettings.css", "lset-row", "card"],
    ["src/screens/feature/ArrivalAlerts.css", "aa-item", "card"],
    ["src/screens/feature/ArrivalAlerts.css", "aa-summary", "card"],
    ["src/screens/feature/DangerAlert.css", "da-hero", "hero"],
    ["src/screens/feature/DangerAlert.css", "da-item", "card"],
    ["src/screens/feature/DaySummary.css", "ds-hero", "hero"],
    ["src/screens/feature/DaySummary.css", "ds-row", "card"],
    ["src/screens/feature/DaySummary.css", "ds-quote", "card"],
    ["src/screens/feature/DaySummary.css", "ds-panel", "card"],
    ["src/screens/feature/DailySafetyReport.css", "dr-overview-card", "card"],
    ["src/screens/feature/WeeklyFamilyReport.css", "wr-hero", "hero"],
    ["src/screens/feature/RemoteAudioAudit.css", "raa-hero", "hero"],
    ["src/screens/feature/RemoteAudioAudit.css", "raa-empty", "card"],
    ["src/screens/feature/RemoteAudioAudit.css", "raa-item", "card"],
    ["src/screens/feature/RemoteAudioAudit.css", "raa-note", "card"],
    ["src/screens/feature/RemoteRing.css", "rr-modal", "modal"],
    ["src/screens/feature/SosReceive.css", "sr-banner", "hero"],
    ["src/screens/feature/SosReceive.css", "sr-map", "media"],
    ["src/screens/feature/SosReceive.css", "sr-loc", "card"],
    ["src/screens/feature/SosReceive.css", "sr-history-item", "card"],
    ["src/screens/feature/AppUpdate.css", "au-card", "card"],
    ["src/screens/feature/PermDenied.css", "pd-card", "card"],
    ["src/components/ui/StickerCelebration.css", "sticker-celebration__main", "modal"],
    ["src/screens/feature/PlaceManager.css", "pm-hero", "hero"],
    ["src/screens/parent/ParentHome.css", "ph-location-error", "card"],
    ["src/screens/parent/ParentLocation.css", "pl-upsell", "card"],
    ["src/screens/shared/MemoChat.css", "mc-blocked-banner", "card"],
    ["src/screens/child/overlays/ChildSheet.css", "ks-day__notice", "card"],
    ["src/screens/onboarding/Onboarding.css", "ob-teacher-note", "card"],
    ["src/screens/teacher/TeacherReleaseGate.css", "trg-notice", "card"],
    ["src/screens/teacher/TeacherTimetable.css", "tt-note", "card"],
    ["src/screens/feature/Subscription.css", "sub-note", "card"],
    ["src/screens/feature/FriendPlay.css", "fp-waiting", "card"],
    ["src/screens/feature/FriendPlay.css", "fp-note", "card"],
    ["src/screens/feature/PlaydateAccept.css", "pa-active", "card"],
    ["src/screens/feature/LocationStatus.css", "ls-permit", "card"],
    ["src/screens/feature/PermDenied.css", "pd-steps", "card"],
    ["src/screens/parent/ParentHome.css", "ph-app-summary__item", "card"],
    ["src/screens/parent/ParentCalendar.css", "pc-sheet__row", "card"],
    ["src/screens/parent/ParentLocation.css", "pl-status", "card"],
    ["src/screens/child/overlays/ChildSheet.css", "ks-modal__msg", "card"],
    ["src/screens/feature/FriendPlay.css", "fp-steps", "card"],
    ["src/screens/feature/AiSchedule.css", "ais-edit-note", "card"],
    ["src/screens/feature/AiCredit.css", "ac-control-row", "card"],
    ["src/screens/child/ChildSettings.css", "ks-help-item", "card"],
    ["src/screens/feature/DataSync.css", "ds-sync__rows", "card"],
    ["src/screens/feature/NotificationSettings.css", "nst-safety-note", "card"],
    ["src/screens/feature/NotificationSettings.css", "nst-capability", "card"],
    ["src/screens/feature/WeeklyFamilyReport.css", "wr-emptyline", "card"],
    ["src/screens/feature/DailySafetyReport.css", "dr-scope-error", "card"],
    ["src/screens/feature/DailySafetyReport.css", "dr-section-error", "card"],
    ["src/screens/feature/DailySafetyReport.css", "dr-signal", "card"],
    ["src/screens/feature/DailySafetyReport.css", "dr-alert", "card"],
    ["src/screens/feature/DailySafetyReport.css", "dr-feature-row", "card"],
    ["src/screens/feature/DailySafetyReport.css", "dr-emptyline", "card"],
    ["src/screens/feature/DailySafetyReport.css", "dr-lock", "card"],
    ["src/screens/feature/DailySafetyReport.css", "dr-note", "card"],
    ["src/screens/feature/DailySafetyReport.css", "dr-event", "card"],
    ["src/screens/feature/DailySafetyReport.css", "dr-notification-health", "card"],
    ["src/screens/feature/DailySafetyReport.css", "dr-app", "card"],
    ["src/screens/feature/DailySafetyReport.css", "dr-memo", "card"],
    ["src/screens/feature/DailySafetyReport.css", "dr-premium", "card"],
    ["src/screens/feature/DailySafetyReport.css", "dr-empty", "card"],
    ["src/components/ui/ScreenQueryState.css", "sqs-card", "card"],
    ["src/components/ui/ScreenQueryState.css", "sqs-inline-empty", "card"],
    ["src/screens/child/AiFriendChat.css", "afc-query-state", "card"],
    ["src/screens/child/ChildHome.css", "kd-map__query-state", "floating"],
    ["src/screens/feature/RemoteRing.css", "rr-query-state", "card"],
];

function surfaceManifestKey(path, selector) {
  return `${path}|${selector}`;
}

function surfaceCandidates(blocks) {
  const grouped = new Map();
  for (const block of blocks) {
    for (const selector of block.selectors) {
      const key = surfaceManifestKey(block.path, selector);
      const current = grouped.get(key) ?? { path: block.path, selector, line: block.line, declarations: [] };
      current.declarations.push(...block.declarations);
      grouped.set(key, current);
    }
  }
  return [...grouped.values()].filter((candidate) => {
    const hasRadius = Boolean(declarationValue(candidate.declarations, "border-radius"));
    const hasPaintedBackground = candidate.declarations.some((declaration) => {
      if (!/^(?:background|background-color|background-image)$/.test(declaration.property)) return false;
      const value = declaration.value.trim().toLowerCase();
      return value !== "none" && value !== "transparent" && value !== "rgba(0, 0, 0, 0)";
    });
    return hasRadius && hasPaintedBackground;
  });
}

function unclassifiedSurfaceCandidates(blocks, manifestKeys, nonSurfaceKeys) {
  return surfaceCandidates(blocks).filter((candidate) => {
    const key = surfaceManifestKey(candidate.path, candidate.selector);
    const semanticMatch = [...manifestKeys].some((manifestKey) => {
      const separator = manifestKey.lastIndexOf("|");
      const path = manifestKey.slice(0, separator);
      const selector = manifestKey.slice(separator + 1);
      return path === candidate.path
        && /^\.[a-z][a-z0-9_-]*$/i.test(selector)
        && selectorTargetsClass(candidate.selector, selector.slice(1));
    });
    return !semanticMatch && !nonSurfaceKeys.has(key);
  });
}

const semanticSurfaceManifestKeys = new Set(semanticSurfaceManifest.map(([path, className]) =>
  surfaceManifestKey(path, `.${className}`)));
const nonSurfacePaintManifest = new Set([
  // 기존 레이아웃·navigation container — exact path + selector만 허용
  ["src/styles/components.css", ".hy-tabbar__inner"],
  ["src/app/ChildDock.css", ".kdock__bar"],
  // 기존 버튼과 액션 컨트롤 — exact path + selector만 허용
  ["src/screens/parent/ParentHome.css", ".ph-stickerbtn"],
  ["src/screens/parent/ParentHome.css", ".ph-location-error__retry"],
  ["src/screens/parent/ParentHome.css", ".ph-subscription__action"],
  ["src/screens/parent/ParentLocation.css", ".pl-lock__cta"],
  ["src/screens/parent/ParentLocation.css", ".pl-lock__retry"],
  ["src/screens/parent/ParentLocation.css", ".pl-viewtog"],
  ["src/screens/parent/ParentLocation.css", ".pl-journey__retry"],
  ["src/screens/parent/ParentLocation.css", ".pl-journey__follow"],
  ["src/screens/shared/MemoChat.css", ".mc-quick-btn"],
  ["src/screens/child/AiFriendSetup.css", ".afs-cta"],
  ["src/screens/child/AiFriendChat.css", ".afc-send"],
  ["src/screens/child/AiFriendChat.css", ".afc-mic"],
  ["src/screens/child/AiFriendChat.css", ".afc-speak"],
  ["src/screens/child/AiFriendChat.css", ".afc-action"],
  ["src/screens/child/AiFriendChat.css", ".afc-action--soft"],
  ["src/components/child/ChildAiFab.css", ".caf"],
  ["src/screens/teacher/TeacherHome.css", ".th-empty__cta"],
  ["src/screens/feature/RemoteAudio.css", ".ra-audit-link"],
  ["src/screens/feature/Notifications.css", ".nc-filter"],
  ["src/screens/feature/AiSchedule.css", ".ais-tab"],
  ["src/screens/feature/AiCredit.css", ".ac-buy"],
  ["src/screens/feature/AiCredit.css", ".ac-premium-callout__cta"],
  ["src/screens/feature/AiCredit.css", ".ac-limit-default"],
  ["src/screens/feature/ChildInvite.css", ".ci-regen"],
  ["src/screens/feature/RouteView.css", ".rv-retry"],
  ["src/screens/feature/RouteView.css", ".rv-empty__home"],
  ["src/screens/feature/DaySummary.css", ".ds-panel__cta"],
  ["src/screens/feature/DailySafetyReport.css", ".dr-scope-error__retry"],
  ["src/screens/feature/DailySafetyReport.css", ".dr-primary"],
  ["src/screens/feature/WeeklyFamilyReport.css", ".wr-primary"],
  ["src/components/ReferralRewardPanel.css", ".rrp__close"],
  ["src/components/ReferralRewardPanel.css", ".rrp__retry"],
  ["src/components/ReferralRewardPanel.css", ".rrp__save"],
  ["src/components/ReferralRewardPanel.css", ".rrp__field select"],
  ["src/screens/feature/RemoteRing.css", ".rr-stop"],
  // 기존 폼과 입력 컨트롤 — exact path + selector만 허용
  ["src/screens/shared/MemoChat.css", ".mc-inputbar"],
  ["src/screens/child/AiFriendSetup.css", ".afs-name-field"],
  ["src/screens/child/AiFriendChat.css", ".afc-field"],
  ["src/screens/feature/AiSchedule.css", ".ais-textbox"],
  ["src/screens/feature/Feedback.css", ".fb-textwrap"],
  ["src/screens/feature/StickerSend.css", ".ss-msg"],
  ["src/screens/parent/ParentLocation.css", ".pl-history-toolbar__date-picker"],
  // 기존 칩과 상태 표시 — exact path + selector만 허용
  ["src/screens/parent/ParentLocation.css", ".pl-safe-label"],
  ["src/screens/parent/ParentLocation.css", ".pl-danger__pill"],
  ["src/screens/parent/ParentLocation.css", ".pl-live"],
  ["src/screens/parent/ParentLocation.css", ".pl-refreshing"],
  ["src/screens/parent/ParentLocation.css", ".pl-chip"],
  ["src/screens/parent/ParentLocation.css", ".pl-journey__skeleton-row"],
  ["src/screens/shared/MemoChat.css", ".mc-sticker"],
  // 인증 사진이 준비되기 전 이미지 버블 내부를 채우는 상태 레이어다.
  ["src/screens/shared/MemoChat.css", ".mc-private-photo-status"],
  ["src/screens/child/ChildHome.css", ".kd-map__chip"],
  ["src/screens/child/ChildHome.css", ".kd-hyeni__bubble"],
  ["src/screens/child/AiFriendChat.css", ".afc-credits"],
  ["src/screens/child/AiFriendChat.css", ".afc-chip"],
  ["src/components/child/ChildAiFab.css", ".caf-credit"],
  ["src/screens/feature/Subscription.css", ".sub-plan__ribbon"],
  ["src/screens/feature/AiSchedule.css", ".ais-bubble"],
  ["src/screens/feature/StickerSend.css", ".ss-child"],
  ["src/screens/feature/PlaceForm.css", ".pf-map__hint"],
  ["src/screens/feature/RouteView.css", ".rv-map-chip"],
  ["src/screens/feature/DangerZoneForm.css", ".dzf-map__hint"],
  ["src/screens/feature/SosReceive.css", ".sr-map__label"],
  // 기존 장식 조각 — exact path + selector만 허용
  ["src/styles/components.css", ".hy-topbar__logo"],
  // 로딩 스켈레톤(장식 전용, aria-hidden) — 목록·카드 자리표시자
  ["src/styles/components.css", ".hy-skel"],
  // 레이아웃 루트 — exact path + selector만 허용
  ["src/styles/global.css", ".hy-app"],
  // 버튼과 액션 컨트롤 — exact path + selector만 허용
  ["src/styles/components.css", ".hy-iconbtn"],
  ["src/styles/components.css", ".km-error__retry"],
  ["src/styles/components.css", ".hy-crash__btn"],
  ["src/styles/components.css", ".hy-crash__ghost"],
  ["src/components/ui/ScreenQueryState.css", ".sqs-retry"],
  ["src/components/ui/ScreenQueryState.css", ".sqs-inline-empty button"],
  ["src/app/ChildDock.css", ".kdock__sos"],
  ["src/screens/child/AiFriendChat.css", ".afc-query-state button"],
  ["src/screens/child/ChildHome.css", ".kd-map__query-state button"],
  ["src/screens/child/StickerBook.css", ".sb-state button"],
  ["src/screens/feature/RemoteRing.css", ".rr-query-retry"],
  ["src/screens/parent/SocialLinks.css", ".sl-retry"],
  ["src/screens/parent/ParentHome.css", ".ph-ai__btn"],
  ["src/screens/parent/ParentHome.css", ".ph-safety__refresh button"],
  ["src/screens/parent/ParentCalendar.css", ".pc-navbtn"],
  ["src/screens/parent/ParentCalendar.css", ".pc-addbtn"],
  ["src/screens/parent/ParentLocation.css", ".pl-refresh"],
  ["src/screens/parent/ParentLocation.css", ".pl-route-btn"],
  ["src/screens/parent/ParentLocation.css", ".pl-memo-btn"],
  ["src/screens/parent/ParentLocation.css", ".pl-listen-btn"],
  ["src/screens/parent/ParentLocation.css", ".pl-call-btn"],
  ["src/screens/parent/ParentFamily.css", ".pf-invite-btn"],
  ["src/screens/parent/ParentFamily.css", ".pf-add"],
  ["src/screens/parent/ParentFamily.css", ".pf-paircode__btn"],
  ["src/screens/parent/ParentSettings.css", ".ps-back"],
  ["src/screens/parent/ParentSettings.css", ".ps-profile__edit"],
  ["src/components/MessageSafetyDialog.css", ".msd-close"],
  ["src/components/MessageSafetyDialog.css", ".msd-report"],
  ["src/components/MessageSafetyDialog.css", ".msd-block"],
  ["src/screens/shared/MemoChat.css", ".mc-unblock"],
  ["src/screens/shared/MemoChat.css", ".mc-safety-action"],
  ["src/screens/shared/MemoChat.css", ".mc-attach"],
  ["src/screens/shared/MemoChat.css", ".mc-send"],
  ["src/screens/shared/MemoChat.css", ".mc-root[data-child=\"true\"] .mc-back"],
  ["src/screens/shared/MemoChat.css", ".mc-root[data-child=\"true\"] .mc-quick-btn"],
  ["src/screens/child/overlays/ChildSheet.css", ".ks-cta"],
  ["src/screens/child/overlays/ChildSheet.css", ".ks-cta--soft"],
  ["src/screens/child/overlays/ChildSheet.css", ".ks-cta--ghost"],
  ["src/screens/child/overlays/ChildSheet.css", ".ks-dialog-close"],
  ["src/screens/child/overlays/ChildSheet.css", ".ks-retry"],
  ["src/screens/child/ChildHome.css", ".kd-next__cta"],
  ["src/screens/child/ChildHome.css", ".kd-prep__edit"],
  ["src/screens/child/ChildHome.css", ".kd-prep__del"],
  ["src/screens/child/ChildHome.css", ".kd-status__btn"],
  ["src/screens/child/ChildHome.css", ".kd-more__btn"],
  ["src/screens/child/ChildSos.css", ".cs-back"],
  ["src/screens/child/ChildSos.css", ".cs-cancel"],
  ["src/screens/child/ChildSos.css", ".cs-callbtn"],
  ["src/screens/child/ChildSos.css", ".cs-query-retry"],
  ["src/screens/child/ChildSos.css", ".cs-ghost"],
  ["src/screens/child/AiFriendSetup.css", ".afs-back"],
  ["src/screens/child/AiFriendChat.css", ".afc-back"],
  ["src/screens/child/AiFriendChat.css", ".afc-setup"],
  ["src/screens/child/AiFriendChat.css", ".afc-report-link"],
  ["src/screens/child/AiFriendChat.css", ".afc-mic"],
  ["src/screens/child/AiFriendChat.css", ".afc-speak"],
  ["src/screens/child/AiFriendChat.css", ".afc-action"],
  ["src/screens/child/AiFriendChat.css", ".afc-action--soft"],
  ["src/components/child/ChildAiFab.css", ".caf"],
  ["src/screens/teacher/TeacherHome.css", ".th-sheet__x"],
  ["src/screens/teacher/TeacherHome.css", ".th-sheet__send"],
  ["src/screens/teacher/TeacherStudents.css", ".ts-invite"],
  ["src/screens/teacher/TeacherStudents.css", ".ts-filter"],
  ["src/screens/teacher/TeacherStudents.css", ".ts-attend__btn"],
  ["src/screens/teacher/TeacherStudents.css", ".ts-sheet__x"],
  ["src/screens/teacher/TeacherStudents.css", ".ts-sheet__send"],
  ["src/screens/teacher/TeacherReleaseGate.css", ".trg-primary"],
  ["src/screens/teacher/TeacherReleaseGate.css", ".trg-danger"],
  ["src/components/QrScanner.css", ".qrs-settings"],
  ["src/screens/onboarding/Onboarding.css", ".ob-back"],
  ["src/screens/onboarding/Onboarding.css", ".ob-loginbtn"],
  ["src/screens/onboarding/Onboarding.css", ".ob-datebtn"],
  ["src/components/ChildLocationPermissionDialog.css", ".clp-primary"],
  ["src/components/ChildLocationPermissionDialog.css", ".clp-secondary"],
  ["src/screens/feature/Subscription.css", ".sub-cta"],
  ["src/screens/feature/Subscription.css", ".sub-cancel__actions button"],
  ["src/screens/feature/Notifications.css", ".nc-retry"],
  ["src/screens/feature/RemoteAudio.css", ".ra-back"],
  ["src/screens/feature/RemoteAudio.css", ".ra-ctrl-mute"],
  ["src/screens/feature/RemoteAudio.css", ".ra-ctrl-stop"],
  ["src/screens/feature/RemoteAudio.css", ".ra-ctrl-call"],
  ["src/screens/feature/PlaceManager.css", ".pm-back"],
  ["src/screens/feature/PlaceManager.css", ".pm-add"],
  ["src/screens/feature/PlaceManager.css", ".pm-zone-add"],
  ["src/screens/feature/PlaceManager.css", ".pm-item__edit"],
  ["src/screens/feature/PlaceManager.css", ".pm-item__del"],
  ["src/screens/feature/PlaceManager.css", ".pm-danger__del"],
  ["src/screens/feature/FriendPlay.css", ".fp-back"],
  ["src/screens/feature/FriendPlay.css", ".fp-cta"],
  ["src/screens/feature/FriendPlay.css", ".fp-end"],
  ["src/screens/feature/AiSchedule.css", ".ais-back"],
  ["src/screens/feature/AiSchedule.css", ".ais-preview__change"],
  ["src/screens/feature/AiSchedule.css", ".ais-confirm"],
  ["src/screens/feature/AiSchedule.css", ".ais-academy-lock__icon"],
  ["src/components/PremiumUpsell.css", ".pu-close"],
  ["src/components/PremiumUpsell.css", ".pu-icon"],
  ["src/components/PremiumUpsell.css", ".pu-copy strong"],
  ["src/components/PremiumUpsell.css", ".pu-error"],
  ["src/components/PremiumUpsell.css", ".pu-upgrade"],
  ["src/screens/feature/AiCredit.css", ".ac-back"],
  ["src/screens/feature/AiCredit.css", ".ac-limit__btn"],
  ["src/screens/feature/AiCredit.css", ".ac-save-detail"],
  ["src/screens/feature/Feedback.css", ".fb-back"],
  ["src/screens/feature/Feedback.css", ".fb-kind"],
  ["src/screens/feature/Feedback.css", ".fb-kind__icon"],
  ["src/screens/feature/Feedback.css", ".fb-cat"],
  ["src/screens/feature/Feedback.css", ".fb-diagnostic__icon"],
  ["src/screens/feature/Feedback.css", ".fb-diagnostic__toggle"],
  ["src/screens/feature/Feedback.css", ".fb-submit"],
  ["src/screens/feature/PhoneSetup.css", ".psu-back"],
  ["src/screens/feature/PhoneSetup.css", ".psu-save"],
  ["src/screens/feature/PlaydateAccept.css", ".pa-screen .pa-back"],
  ["src/screens/feature/PlaydateAccept.css", ".pa-btn-accept"],
  ["src/screens/feature/StickerSend.css", ".ss-back"],
  ["src/screens/feature/StickerSend.css", ".ss-send"],
  ["src/screens/feature/ProfileEdit.css", ".pe-state__btn"],
  ["src/screens/feature/ProfileEdit.css", ".pe-save"],
  ["src/screens/feature/PlaceForm.css", ".pf-back"],
  ["src/screens/feature/PlaceForm.css", ".pf-save"],
  ["src/screens/feature/PlaceForm.css", ".pf-map-locate"],
  ["src/screens/feature/ChildInvite.css", ".ci-back"],
  ["src/screens/feature/RouteView.css", ".rv-back"],
  ["src/screens/feature/RouteView.css", ".rv-fallback__kakao"],
  ["src/components/MapPickerSheet.css", ".mps-confirm"],
  ["src/screens/parent/EventForm.css", ".ef-back"],
  ["src/screens/parent/EventForm.css", ".ef-save"],
  ["src/screens/parent/EventForm.css", ".ef-scope-primary"],
  ["src/screens/parent/EventForm.css", ".ef-scope-secondary"],
  ["src/screens/parent/EventForm.css", ".ef-scope-cancel"],
  ["src/screens/parent/EventForm.css", ".ef-mapbtn"],
  ["src/screens/parent/EventForm.css", ".ef-supply-add"],
  ["src/screens/feature/Supplies.css", ".sup-back"],
  ["src/screens/feature/Supplies.css", ".sup-status__retry"],
  ["src/screens/feature/Supplies.css", ".sup-add__btn"],
  ["src/screens/feature/DangerZoneForm.css", ".dzf-back"],
  ["src/screens/feature/DangerZoneForm.css", ".dzf-save"],
  ["src/screens/feature/LocationStatus.css", ".ls-back"],
  ["src/screens/feature/LocationStatus.css", ".ls-retry"],
  ["src/screens/parent/ChildDetail.css", ".cd-action"],
  ["src/screens/parent/ChildDetail.css", ".cd-state__btn"],
  ["src/screens/parent/ChildDetail.css", ".cd-confirm__cancel"],
  ["src/screens/parent/ChildDetail.css", ".cd-confirm__delete"],
  ["src/screens/feature/PairingWizard.css", ".pw-cta"],
  ["src/screens/teacher/TeacherNotice.css", ".tn-back"],
  ["src/screens/teacher/TeacherNotice.css", ".tn-send"],
  ["src/screens/teacher/TeacherTimetable.css", ".tt-add"],
  ["src/screens/teacher/TeacherTimetable.css", ".tt-retry"],
  ["src/screens/teacher/TeacherTimetable.css", ".tt-copy"],
  ["src/screens/feature/FamilyConnection.css", ".fc-ghost"],
  ["src/screens/feature/FamilyConnection.css", ".fc-unpair"],
  ["src/screens/feature/LocationSettings.css", ".lset-back"],
  ["src/screens/child/ChildLocationStatus.css", ".cls-back"],
  ["src/screens/child/ChildLocationStatus.css", ".cls-cta"],
  ["src/screens/child/ChildSettings.css", ".ks-ask"],
  ["src/screens/child/ChildSettings.css", ".ks-help-modal__x"],
  ["src/screens/parent/ParentAccount.css", ".pa-back"],
  ["src/screens/parent/ParentAccount.css", ".pa-save"],
  ["src/screens/feature/DataSync.css", ".ds-root .ds-back"],
  ["src/screens/feature/DataSync.css", ".ds-sync__btn"],
  ["src/screens/feature/DataSync.css", ".ds-card__cta"],
  ["src/screens/feature/TrialLock.css", ".tl-back"],
  ["src/screens/feature/TrialLock.css", ".tl-cta"],
  ["src/screens/feature/NotificationSettings.css", ".nst-back"],
  ["src/screens/feature/NotificationSettings.css", ".nst-retry"],
  ["src/screens/feature/NotificationSettings.css", ".nst-system-btn"],
  ["src/screens/feature/ArrivalAlerts.css", ".aa-back"],
  ["src/screens/feature/ArrivalAlerts.css", ".aa-retry"],
  ["src/screens/feature/DangerAlert.css", ".da-back"],
  ["src/screens/feature/DangerAlert.css", ".da-retry"],
  ["src/screens/feature/DangerAlert.css", ".da-hero__cta"],
  ["src/screens/feature/DaySummary.css", ".ds-screen .ds-back"],
  ["src/screens/feature/DailySafetyReport.css", ".dr-back"],
  ["src/screens/feature/DailySafetyReport.css", ".dr-source-error__retry"],
  ["src/screens/feature/DailySafetyReport.css", ".dr-link"],
  ["src/screens/feature/DailySafetyReport.css", ".dr-section-error__retry"],
  ["src/screens/feature/DailySafetyReport.css", ".dr-premium button"],
  ["src/screens/feature/WeeklyFamilyReport.css", ".wr-back"],
  ["src/screens/feature/WeeklyFamilyReport.css", ".wr-state__retry"],
  ["src/screens/feature/RemoteAudioAudit.css", ".raa-back"],
  ["src/screens/feature/RemoteAudioAudit.css", ".raa-refresh"],
  ["src/screens/feature/RemoteAudioAudit.css", ".raa-retry"],
  ["src/screens/feature/RemoteRing.css", ".rr-back"],
  ["src/screens/feature/RemoteRing.css", ".rr-cta"],
  ["src/screens/feature/RemoteRing.css", ".rr-modal-cancel"],
  ["src/screens/feature/RemoteRing.css", ".rr-modal-confirm"],
  ["src/screens/feature/SosReceive.css", ".sr-loc-track"],
  ["src/screens/feature/SosReceive.css", ".sr-confirm"],
  ["src/screens/feature/SosReceive.css", ".sr-retry"],
  ["src/screens/feature/AppUpdate.css", ".au-cta"],
  ["src/screens/feature/PermDenied.css", ".pd-cta"],
  // 폼과 입력 컨트롤 — exact path + selector만 허용
  ["src/screens/parent/ParentSettings.css", ".ps-switch"],
  ["src/screens/parent/ParentSettings.css", ".ps-switch__knob"],
  ["src/components/MessageSafetyDialog.css", ".msd-reason"],
  ["src/components/MessageSafetyDialog.css", ".msd-detail textarea"],
  ["src/screens/child/ChildHome.css", ".kd-prep__input"],
  ["src/screens/child/AiFriendSetup.css", ".afs-cell"],
  ["src/screens/teacher/TeacherHome.css", ".th-sheet__input"],
  ["src/screens/teacher/TeacherStudents.css", ".ts-sheet__input"],
  ["src/screens/onboarding/Onboarding.css", ".ob-input"],
  ["src/screens/feature/FriendPlay.css", ".fp-setting__switch"],
  ["src/screens/feature/FriendPlay.css", ".fp-setting__knob"],
  ["src/screens/feature/AiSchedule.css", ".ais-tabs"],
  ["src/screens/feature/AiCredit.css", ".ac-toggle__knob"],
  ["src/screens/feature/AiCredit.css", ".ac-textarea"],
  ["src/screens/feature/AiCredit.css", ".ac-time"],
  ["src/screens/feature/PhoneSetup.css", ".psu-row__input"],
  ["src/screens/feature/ProfileEdit.css", ".pe-age"],
  ["src/screens/feature/ProfileEdit.css", ".pe-input"],
  ["src/screens/feature/PlaceForm.css", ".pf-input"],
  ["src/screens/parent/EventForm.css", ".ef-input"],
  ["src/screens/parent/EventForm.css", ".ef-textarea"],
  ["src/screens/parent/EventForm.css", ".ef-weekday"],
  ["src/screens/feature/Supplies.css", ".sup-edit-input"],
  ["src/screens/feature/Supplies.css", ".sup-add__input"],
  ["src/screens/feature/DangerZoneForm.css", ".dzf-input"],
  ["src/screens/feature/DangerZoneForm.css", ".dzf-toggle"],
  ["src/screens/feature/DangerZoneForm.css", ".dzf-toggle__knob"],
  ["src/screens/feature/PairingWizard.css", ".pw-input"],
  ["src/screens/teacher/TeacherNotice.css", ".tn-input"],
  ["src/screens/teacher/TeacherNotice.css", ".tn-textarea"],
  ["src/screens/teacher/TeacherNotice.css", ".tn-attach"],
  ["src/screens/teacher/TeacherNotice.css", ".tn-file-chip"],
  ["src/screens/teacher/TeacherNotice.css", ".tn-toggle"],
  ["src/screens/teacher/TeacherNotice.css", ".tn-toggle__knob"],
  ["src/screens/teacher/TeacherNotice.css", ".tn-date"],
  ["src/screens/feature/LocationSettings.css", ".lset-toggle"],
  ["src/screens/feature/LocationSettings.css", ".lset-toggle__knob"],
  ["src/screens/feature/LocationSettings.css", ".lset-seg__item"],
  ["src/screens/child/ChildSettings.css", ".ks-toggle"],
  ["src/screens/child/ChildSettings.css", ".ks-toggle__knob"],
  ["src/screens/parent/ParentAccount.css", ".pa-modal__input"],
  ["src/screens/feature/NotificationSettings.css", ".nst-switch"],
  ["src/screens/feature/NotificationSettings.css", ".nst-switch__knob"],
  ["src/screens/feature/NotificationSettings.css", ".nst-minute"],
  // 칩과 상태 표시 — exact path + selector만 허용
  ["src/styles/components.css", ".hy-tab__dot"],
  ["src/app/ChildDock.css", ".kdock__badge"],
  ["src/screens/Splash.css", ".sp-dot"],
  ["src/components/ui/Loading.css", ".hy-loading__dot"],
  ["src/screens/parent/ParentHome.css", ".ph-hero__badge"],
  ["src/screens/parent/ParentHome.css", ".ph-child__now"],
  ["src/screens/parent/ParentHome.css", ".ph-child__attend"],
  ["src/screens/parent/ParentHome.css", ".ph-safety__pending"],
  ["src/screens/parent/ParentHome.css", ".ph-safety__signal"],
  ["src/screens/parent/ParentHome.css", ".ph-safety__notification"],
  ["src/screens/parent/ParentHome.css", ".ph-recent-row__badge"],
  ["src/screens/parent/ParentHome.css", ".ph-memo__badge"],
  ["src/screens/parent/ParentHome.css", ".ph-shortcut__badge"],
  ["src/screens/parent/ParentCalendar.css", ".pc-today-badge"],
  ["src/screens/parent/ParentCalendar.css", ".pc-event__child"],
  ["src/screens/parent/ParentLocation.css", ".pl-safe-label__dot"],
  ["src/screens/parent/ParentLocation.css", ".pl-chip__dot"],
  ["src/screens/parent/ParentLocation.css", ".pl-sheet__zone-dot"],
  ["src/screens/parent/ParentLocation.css", ".pl-sheet__dur"],
  ["src/screens/parent/ParentLocation.css", ".pl-status__dot"],
  ["src/screens/parent/ParentLocation.css", ".pl-delay-badge"],
  ["src/screens/parent/ParentLocation.css", ".pl-history-toolbar__avatar"],
  ["src/screens/parent/ParentLocation.css", ".pl-journey__timeline::before"],
  ["src/screens/parent/ParentLocation.css", ".pl-journey__order"],
  ["src/screens/parent/ParentFamily.css", ".pf-parent__badge"],
  ["src/screens/parent/ParentFamily.css", ".pf-chip__dot"],
  ["src/screens/parent/ParentSettings.css", ".ps-account__badge"],
  ["src/screens/shared/MemoChat.css", ".mc-status-dot"],
  ["src/screens/shared/MemoChat.css", ".mc-daysep span"],
  ["src/screens/child/overlays/ChildSheet.css", ".ks-head__badge"],
  ["src/screens/child/overlays/ChildSheet.css", ".ks-friend__check"],
  ["src/screens/child/ChildHome.css", ".kd-map__date"],
  ["src/screens/child/ChildHome.css", ".kd-node__pill"],
  ["src/screens/child/ChildHome.css", ".kd-next__badge"],
  ["src/screens/child/ChildHome.css", ".kd-prep__count"],
  ["src/screens/child/ChildHome.css", ".kd-prep__check"],
  ["src/screens/child/ChildHome.css", ".kd-prep__kind"],
  ["src/screens/child/ChildHome.css", ".kd-memo-banner__badge"],
  ["src/screens/child/ChildHome.css", ".kd-tile__badge"],
  ["src/screens/child/ChildHome.css", ".kd-tt__done"],
  ["src/screens/child/ChildHome.css", ".kd-tt__next"],
  ["src/screens/child/ChildHome.css", ".kd-color__dot"],
  ["src/screens/child/StickerBook.css", ".sb-head__badge"],
  ["src/screens/child/StickerBook.css", ".sb-slot__new"],
  ["src/screens/child/StickerBook.css", ".sb-slot__count"],
  ["src/screens/child/ChildSos.css", ".cs-checks__dot"],
  ["src/screens/child/AiFriendChat.css", ".afc-typing span"],
  ["src/screens/teacher/TeacherHome.css", ".th-hero__attend"],
  ["src/screens/onboarding/Onboarding.css", ".ob-progress__track"],
  ["src/screens/onboarding/Onboarding.css", ".ob-role-badge"],
  ["src/screens/onboarding/Onboarding.css", ".ob-perm-check"],
  ["src/screens/feature/Subscription.css", ".sub-active__badge"],
  ["src/screens/feature/Subscription.css", ".sub-table__col-badge"],
  ["src/screens/feature/Notifications.css", ".nc-item__dot"],
  ["src/screens/feature/RemoteAudio.css", ".ra-note"],
  ["src/screens/feature/RemoteAudio.css", ".ra-live"],
  ["src/screens/feature/RemoteAudio.css", ".ra-live-dot"],
  ["src/screens/feature/PlaceManager.css", ".pm-item__badge"],
  ["src/screens/feature/FriendPlay.css", ".fp-step__num"],
  ["src/screens/feature/FriendPlay.css", ".fp-connected__badge"],
  ["src/screens/feature/AiSchedule.css", ".ais-reslabel__badge"],
  ["src/screens/feature/AiCredit.css", ".ac-hero__badge"],
  ["src/screens/feature/AiCredit.css", ".ac-pack__tag"],
  ["src/screens/feature/ChildInvite.css", ".ci-timer"],
  ["src/screens/feature/ChildInvite.css", ".ci-wait__dot"],
  ["src/screens/feature/RouteView.css", ".rv-info__tag"],
  ["src/components/MapPickerSheet.css", ".mps-saved__chip"],
  ["src/screens/parent/EventForm.css", ".ef-supply-chip"],
  ["src/screens/feature/Supplies.css", ".sup-section__count"],
  ["src/screens/feature/PairingWizard.css", ".pw-progress__seg"],
  ["src/screens/feature/PairingWizard.css", ".pw-count"],
  ["src/screens/teacher/TeacherNotice.css", ".tn-chip"],
  ["src/screens/teacher/TeacherNotice.css", ".tn-chip__x"],
  ["src/screens/teacher/TeacherNotice.css", ".tn-attach__badge"],
  ["src/screens/teacher/TeacherNotice.css", ".tn-file-chip__x::before"],
  ["src/screens/teacher/TeacherTimetable.css", ".tt-day-chip"],
  ["src/screens/teacher/TeacherTimetable.css", ".tt-item__cat"],
  ["src/screens/feature/FamilyConnection.css", ".fc-chip__dot"],
  ["src/screens/child/ChildLocationStatus.css", ".cls-live"],
  ["src/screens/child/ChildSettings.css", ".ks-hero__chip"],
  ["src/screens/child/ChildSettings.css", ".ks-onchip"],
  ["src/screens/feature/DataSync.css", ".ds-sync__dot"],
  ["src/screens/feature/TrialLock.css", ".tl-hero__badge"],
  ["src/screens/feature/TrialLock.css", ".tl-lock__reviewed"],
  ["src/screens/feature/NotificationSettings.css", ".nst-web-facts span"],
  ["src/screens/feature/ArrivalAlerts.css", ".aa-item__dot"],
  ["src/screens/feature/DangerAlert.css", ".da-item__dot"],
  ["src/screens/feature/DailySafetyReport.css", ".dr-hero__chips span"],
  ["src/screens/feature/DailySafetyReport.css", ".dr-chips span"],
  ["src/screens/feature/RemoteRing.css", ".rr-childchip"],
  ["src/screens/feature/RemoteRing.css", ".rr-chip"],
  ["src/screens/feature/RemoteRing.css", ".rr-quota"],
  ["src/screens/feature/RemoteRing.css", ".rr-quota-tier"],
  ["src/screens/feature/SosReceive.css", ".sr-banner-chip"],
  ["src/screens/feature/SosReceive.css", ".sr-act-badge"],
  ["src/screens/feature/SosReceive.css", ".sr-history-dot"],
  ["src/screens/feature/AppUpdate.css", ".au-badge"],
  // 장식과 미디어 조각 — exact path + selector만 허용
  ["src/styles/components.css", ".hy-iconbtn__dot"],
  ["src/styles/components.css", ".hy-chip__pulse"],
  ["src/components/ui/RouteLoading.css", ".route-loading__visual"],
  ["src/components/ui/ScreenQueryState.css", ".sqs-icon"],
  ["src/screens/Splash.css", ".sp-halo"],
  ["src/screens/Splash.css", ".sp-halo::after"],
  ["src/screens/parent/ParentHome.css", ".ph-live-dot .ring"],
  ["src/screens/parent/ParentHome.css", ".ph-live-dot .core"],
  ["src/screens/parent/ParentHome.css", ".ph-ai__icon"],
  ["src/screens/parent/ParentHome.css", ".ph-child__online"],
  ["src/screens/parent/ParentHome.css", ".ph-recent-row__icon"],
  ["src/screens/parent/ParentHome.css", ".ph-memo__icon"],
  ["src/screens/parent/ParentHome.css", ".ph-subscription__icon"],
  ["src/screens/parent/ParentCalendar.css", ".pc-sheet__handle"],
  ["src/screens/parent/ParentLocation.css", ".pl-blob-1"],
  ["src/screens/parent/ParentLocation.css", ".pl-blob-2"],
  ["src/screens/parent/ParentLocation.css", ".pl-blob-3"],
  ["src/screens/parent/ParentLocation.css", ".pl-child-ring__static"],
  ["src/screens/parent/ParentLocation.css", ".pl-child-ring__pulse"],
  ["src/screens/parent/ParentLocation.css", ".pl-child-pin__inner"],
  ["src/screens/parent/ParentLocation.css", ".pl-parent__pulse"],
  ["src/screens/parent/ParentLocation.css", ".pl-parent__core"],
  ["src/screens/parent/ParentLocation.css", ".pl-danger"],
  ["src/screens/parent/ParentLocation.css", ".pl-live__ring"],
  ["src/screens/parent/ParentLocation.css", ".pl-live__core"],
  ["src/screens/parent/ParentLocation.css", ".pl-chip__avatar"],
  ["src/screens/parent/ParentLocation.css", ".pl-sheet__handle"],
  ["src/screens/parent/ParentLocation.css", ".pl-sheet__avatar"],
  ["src/screens/parent/ParentLocation.css", ".pl-lock__ring"],
  ["src/screens/parent/ParentFamily.css", ".pf-parent__avatar"],
  ["src/screens/parent/ParentFamily.css", ".pf-conn__icon"],
  ["src/screens/parent/ParentFamily.css", ".pf-paircode__qr"],
  ["src/screens/parent/ParentSettings.css", ".ps-profile__avatar"],
  ["src/screens/parent/ParentSettings.css", ".ps-feature__icon"],
  ["src/components/MessageSafetyDialog.css", ".msd-icon"],
  ["src/screens/shared/MemoChat.css", ".mc-peer-avatar"],
  ["src/screens/shared/MemoChat.css", ".mc-msg-avatar"],
  ["src/screens/shared/MemoChat.css", ".mc-bubble--img"],
  ["src/screens/shared/MemoChat.css", ".mc-photo-preview__close"],
  ["src/screens/shared/MemoChat.css", ".mc-photo-preview__save"],
  ["src/screens/shared/MemoChat.css", ".mc-photo-preview__stage"],
  ["src/screens/child/overlays/ChildSheet.css", ".ks-handle"],
  ["src/screens/child/overlays/ChildSheet.css", ".ks-route__dest"],
  ["src/screens/child/overlays/ChildSheet.css", ".ks-route__line"],
  ["src/screens/child/overlays/ChildSheet.css", ".ks-route__no"],
  ["src/screens/child/overlays/ChildSheet.css", ".ks-friend__ava"],
  ["src/screens/child/ChildHome.css", ".kd-map__sun"],
  ["src/components/ReferralRewardPanel.css", ".rrp__header-icon"],
  ["src/screens/child/ChildHome.css", ".kd-map__cloud"],
  ["src/screens/child/ChildHome.css", ".kd-map__cloud::before"],
  ["src/screens/child/ChildHome.css", ".kd-map__cloud::after"],
  ["src/screens/child/ChildHome.css", ".kd-node__disc"],
  ["src/screens/child/ChildHome.css", ".kd-node__ring"],
  ["src/screens/child/ChildHome.css", ".kd-next__icon"],
  ["src/screens/child/ChildHome.css", ".kd-prep__bar"],
  ["src/screens/child/ChildHome.css", ".kd-prep__fill"],
  ["src/screens/child/StickerBook.css", ".sb-progress__bar"],
  ["src/screens/child/StickerBook.css", ".sb-progress__fill"],
  ["src/screens/child/ChildSos.css", ".cs-holder__ring"],
  ["src/screens/child/ChildSos.css", ".cs-hold__inner"],
  ["src/screens/child/AiFriendSetup.css", ".afs-preview__art"],
  ["src/screens/teacher/TeacherHome.css", ".th-brand__icon"],
  ["src/screens/teacher/TeacherHome.css", ".th-note__icon"],
  ["src/screens/teacher/TeacherReleaseGate.css", ".trg-icon"],
  ["src/components/QrScanner.css", ".qrs-close"],
  ["src/components/QrScanner.css", ".qrs-retry"],
  ["src/screens/onboarding/Onboarding.css", ".ob-progress__fill"],
  ["src/screens/onboarding/Onboarding.css", ".ob-role-logo"],
  ["src/screens/onboarding/Onboarding.css", ".ob-teacher-logo"],
  ["src/screens/onboarding/Onboarding.css", ".ob-qr-cta"],
  ["src/screens/feature/Subscription.css", ".sub-benefit__icon"],
  ["src/screens/feature/RemoteAudio.css", ".ra-halo-ring1"],
  ["src/screens/feature/RemoteAudio.css", ".ra-halo-ring2"],
  ["src/screens/feature/RemoteAudio.css", ".ra-start"],
  ["src/screens/feature/RemoteAudio.css", ".ra-pulse-ring1"],
  ["src/screens/feature/RemoteAudio.css", ".ra-pulse-ring2"],
  ["src/screens/feature/RemoteAudio.css", ".ra-pulse-core"],
  ["src/screens/feature/RemoteAudio.css", ".ra-bar"],
  ["src/screens/feature/RemoteAudio.css", ".ra-stop-square"],
  ["src/screens/feature/PlaceManager.css", ".pm-item__icon"],
  ["src/screens/feature/PlaceManager.css", ".pm-danger__icon"],
  ["src/screens/feature/FriendPlay.css", ".fp-setting__icon"],
  ["src/screens/feature/AiSchedule.css", ".ais-mic__ring"],
  ["src/screens/feature/AiSchedule.css", ".ais-mic__inner"],
  ["src/screens/feature/AiSchedule.css", ".ais-wave__bar"],
  ["src/screens/feature/AiSchedule.css", ".ais-upload__icon"],
  ["src/screens/feature/AiSchedule.css", ".ais-result__icon"],
  ["src/screens/feature/AiCredit.css", ".ac-pack__icon"],
  ["src/screens/feature/AiCredit.css", ".ac-auto__icon"],
  ["src/screens/feature/PlaydateAccept.css", ".pa-avatar"],
  ["src/screens/feature/PlaydateAccept.css", ".pa-btn-decline"],
  ["src/screens/feature/StickerSend.css", ".ss-child__avatar"],
  ["src/screens/parent/EventForm.css", ".ef-chip__avatar"],
  ["src/screens/feature/ProfileEdit.css", ".pe-photo"],
  ["src/screens/feature/ProfileEdit.css", ".pe-photo__edit"],
  ["src/screens/feature/PlaceForm.css", ".pf-map__ring"],
  ["src/screens/feature/PlaceForm.css", ".pf-map-handle__bar"],
  ["src/screens/feature/ChildInvite.css", ".ci-qr-skeleton"],
  ["src/screens/feature/RouteView.css", ".rv-map__start"],
  ["src/screens/feature/RouteView.css", ".rv-info__icon"],
  ["src/screens/feature/RouteView.css", ".rv-start"],
  ["src/screens/feature/RouteView.css", ".rv-empty__icon"],
  ["src/screens/feature/LocationStatus.css", ".ls-last__icon"],
  ["src/screens/parent/ChildDetail.css", ".cd-row__icon"],
  ["src/screens/parent/ChildDetail.css", ".cd-danger__icon"],
  ["src/screens/parent/ChildDetail.css", ".cd-confirm__icon"],
  ["src/screens/feature/PairingWizard.css", ".pw-photo"],
  ["src/screens/feature/PairingWizard.css", ".pw-photo__edit"],
  ["src/screens/feature/PairingWizard.css", ".pw-summary__photo"],
  ["src/screens/teacher/TeacherNotice.css", ".tn-attach__icon"],
  ["src/screens/feature/FamilyConnection.css", ".fc-invite__icon"],
  ["src/screens/feature/LocationSettings.css", ".lset-row__icon"],
  ["src/screens/child/ChildSettings.css", ".ks-hero__avatar"],
  ["src/screens/child/ChildSettings.css", ".ks-row__icon"],
  ["src/screens/child/ChildSettings.css", ".ks-help-item__emoji"],
  ["src/screens/parent/ParentAccount.css", ".pa-profile__avatar"],
  ["src/screens/feature/TrialLock.css", ".tl-lock__ring"],
  ["src/screens/feature/TrialLock.css", ".tl-perk__ic"],
  ["src/screens/feature/DangerAlert.css", ".da-hero__icon"],
  ["src/screens/feature/DangerAlert.css", ".da-item__icon"],
  ["src/screens/feature/DaySummary.css", ".ds-row__icon"],
  ["src/screens/feature/DaySummary.css", ".ds-panel__art"],
  ["src/screens/feature/DailySafetyReport.css", ".dr-source-error__icon"],
  ["src/screens/feature/DailySafetyReport.css", ".dr-hero::after"],
  ["src/screens/feature/DailySafetyReport.css", ".dr-hero__orb"],
  ["src/screens/feature/DailySafetyReport.css", ".dr-hero__mini"],
  ["src/screens/feature/DailySafetyReport.css", ".dr-overview-card__icon"],
  ["src/screens/feature/DailySafetyReport.css", ".dr-section__icon"],
  ["src/screens/feature/DailySafetyReport.css", ".dr-feature-row__icon"],
  ["src/screens/feature/DailySafetyReport.css", ".dr-memo__icon"],
  ["src/screens/feature/DailySafetyReport.css", ".dr-weekly__icon"],
  ["src/screens/feature/WeeklyFamilyReport.css", ".wr-hero__icon"],
  ["src/screens/feature/WeeklyFamilyReport.css", ".wr-empty__icon"],
  ["src/screens/feature/WeeklyFamilyReport.css", ".wr-state__icon"],
  ["src/screens/feature/WeeklyFamilyReport.css", ".wr-preview__item span"],
  ["src/screens/feature/RemoteAudioAudit.css", ".raa-hero__icon"],
  ["src/screens/feature/RemoteRing.css", ".rr-hero-ring1"],
  ["src/screens/feature/RemoteRing.css", ".rr-hero-ring2"],
  ["src/screens/feature/RemoteRing.css", ".rr-pulse-ring1"],
  ["src/screens/feature/RemoteRing.css", ".rr-pulse-ring2"],
  ["src/screens/feature/RemoteRing.css", ".rr-pulse-core"],
  ["src/screens/feature/RemoteRing.css", ".rr-stop-square"],
  ["src/screens/feature/SosReceive.css", ".sr-empty-icon"],
  ["src/screens/feature/SosReceive.css", ".sr-loc-icon"],
  ["src/screens/feature/SosReceive.css", ".sr-history-emoji"],
  ["src/screens/feature/PermDenied.css", ".pd-icon"],
  ["src/components/ui/StickerCelebration.css", ".sticker-celebration__confetti span"],
  // nested와 inset 조각 — exact path + selector만 허용
  ["src/components/MessageSafetyDialog.css", ".msd-error"],
  ["src/screens/shared/MemoChat.css", ".mc-msg--peer .mc-bubble"],
  ["src/screens/shared/MemoChat.css", ".mc-msg--mine .mc-bubble"],
  ["src/screens/child/AiFriendChat.css", ".afc-bubble--ai"],
  ["src/screens/child/AiFriendChat.css", ".afc-bubble--me"],
  ["src/screens/onboarding/Onboarding.css", ".ob-pair-cell"],
  ["src/screens/feature/FriendPlay.css", ".fp-parent-rule span"],
  ["src/screens/feature/PlaydateAccept.css", ".pa-screen .pa-note"],
  ["src/screens/feature/RouteView.css", ".rv-map__label"],
  ["src/components/MapPickerSheet.css", ".mps-map__hint"],
  ["src/screens/feature/DailySafetyReport.css", ".dr-progress"],
  ["src/screens/feature/DailySafetyReport.css", ".dr-progress span"],
  ["src/screens/feature/DailySafetyReport.css", ".dr-device-grid div"],
].map(([path, selector]) => surfaceManifestKey(path, selector)));

const semanticSurfaceRoleSpecs = {
  card: { radius: ["var(--radius-16)"], shadow: ["none", "var(--shadow-soft)"] },
  hero: { radius: ["var(--radius-20)", "0 0 var(--radius-20) var(--radius-20)"], shadow: ["none", "var(--shadow-soft)", "var(--shadow-floating)"] },
  media: { radius: ["var(--radius-20)"], shadow: ["none", "var(--shadow-soft)", "var(--shadow-modal)"] },
  modal: { radius: ["var(--radius-20)"], shadow: ["var(--shadow-modal)"] },
  sheet: { radius: ["var(--radius-24)", "var(--radius-24) var(--radius-24) 0 0"], shadow: ["var(--shadow-modal)"] },
  floating: { radius: ["var(--radius-16)"], shadow: ["var(--shadow-floating)", "var(--shadow-modal)"] },
};

function semanticSurfaceViolations(manifest, blocks) {
  const violations = [];

  const findRootBlock = (path, className) => blocks.find(
    (block) => block.path === path && block.selectors.includes(`.${className}`),
  ) ?? null;

  for (const [path, className, role] of manifest) {
    const block = findRootBlock(path, className);
    if (!block) {
      violations.push(`${path} .${className} (root selector 누락)`);
      continue;
    }
    const baseClassName = className.split("--")[0];
    const baseBlock = baseClassName === className ? null : findRootBlock(path, baseClassName);
    const declarations = [...(baseBlock?.declarations ?? []), ...block.declarations];
    const radius = declarationValue(declarations, "border-radius");
    const shadow = declarationValue(declarations, "box-shadow");
    if (!semanticSurfaceRoleSpecs[role].radius.includes(radius)) {
      violations.push(`${path}:${block.line} .${className} (${role} radius ${radius ?? "누락"})`);
    }
    if (!semanticSurfaceRoleSpecs[role].shadow.includes(shadow)) {
      violations.push(`${path}:${block.line} .${className} (${role} shadow ${shadow ?? "누락"})`);
    }
    for (const variantBlock of blocks) {
      if (variantBlock.path !== path
        || !variantBlock.selectors.some((selector) => selectorTargetsClass(selector, className))) continue;
      const variantRadius = declarationValue(variantBlock.declarations, "border-radius");
      const variantShadow = declarationValue(variantBlock.declarations, "box-shadow");
      if (variantRadius && !semanticSurfaceRoleSpecs[role].radius.includes(variantRadius)) {
        violations.push(`${path}:${variantBlock.line} ${variantBlock.selector} (${role} variant radius ${variantRadius})`);
      }
      if (variantShadow && !semanticSurfaceRoleSpecs[role].shadow.includes(variantShadow)) {
        violations.push(`${path}:${variantBlock.line} ${variantBlock.selector} (${role} variant shadow ${variantShadow})`);
      }
    }
  }
  return violations;
}

test("명시된 semantic surface manifest는 역할별 radius와 shadow를 직접 선언한다", () => {
  const violations = semanticSurfaceViolations(semanticSurfaceManifest, releaseBlocks);

  assert.deepEqual(violations, [], `semantic surface 위반 ${violations.length}건:\n${violations.join("\n")}`);
});

test("card surface의 상태 variant는 modal shadow로 역할 계약을 우회할 수 없다", () => {
  const path = "fixture/CardMutation.css";
  const blocks = cssBlocks(`
    .qa-card {
      background: #fff;
      border-radius: var(--radius-16);
      box-shadow: var(--shadow-soft);
    }
    .qa-card:hover { box-shadow: var(--shadow-modal); }
  `).map((block, sourceOrder) => ({ ...block, path, sourceOrder }));
  const violations = semanticSurfaceViolations([[path, "qa-card", "card"]], blocks);
  assert.equal(violations.length, 1, `card에 modal shadow를 넣으면 정확히 실패해야 합니다:\n${violations.join("\n")}`);
  assert.match(violations[0], /card variant shadow var\(--shadow-modal\)/);
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

test("shadow와 padding이 없는 rounded painted surface도 manifest 후보에서 빠지지 않는다", () => {
  const fixtureBlocks = cssBlocks(`
    .qa-shadowless {
      background-color: #fff;
      border-radius: 18px;
    }
  `).map((block, sourceOrder) => ({ ...block, path: "fixture/ShadowlessSurface.css", sourceOrder }));
  const unclassified = unclassifiedSurfaceCandidates(fixtureBlocks, new Set(), new Set());
  assert.deepEqual(unclassified.map((candidate) => `${candidate.path}|${candidate.selector}`), [
    "fixture/ShadowlessSurface.css|.qa-shadowless",
  ]);
});

test("compound와 media selector의 background-image rounded surface도 후보로 분류한다", () => {
  const fixtureBlocks = cssBlocks(`
    @media (min-width: 640px) {
      .qa-shell .qa-media-surface {
        background-image: linear-gradient(#fff, #eee);
        border-radius: 20px;
      }
    }
  `).map((block, sourceOrder) => ({ ...block, path: "fixture/MediaSurface.css", sourceOrder }));
  const unclassified = unclassifiedSurfaceCandidates(fixtureBlocks, new Set(), new Set());
  assert.deepEqual(unclassified.map((candidate) => `${candidate.path}|${candidate.selector}`), [
    "fixture/MediaSurface.css|.qa-shell .qa-media-surface",
  ]);
});

test("compound surface는 마지막 target class의 semantic manifest로 분류한다", () => {
  const path = "fixture/CompoundSemantic.css";
  const fixtureBlocks = cssBlocks(`
    .qa-shell .qa-semantic-card {
      background: #fff;
      border-radius: var(--radius-16);
    }
  `).map((block, sourceOrder) => ({ ...block, path, sourceOrder }));
  const semanticKeys = new Set([surfaceManifestKey(path, ".qa-semantic-card")]);
  assert.deepEqual(unclassifiedSurfaceCandidates(fixtureBlocks, semanticKeys, new Set()), []);
});

test("non-surface manifest는 compound selector를 정확히 적은 경우에만 분류한다", () => {
  const path = "fixture/CompoundNonSurface.css";
  const selector = ".qa-shell .qa-decoration";
  const fixtureBlocks = cssBlocks(`${selector} { background: #fff; border-radius: 50%; }`)
    .map((block, sourceOrder) => ({ ...block, path, sourceOrder }));
  assert.equal(unclassifiedSurfaceCandidates(
    fixtureBlocks,
    new Set(),
    new Set([surfaceManifestKey(path, ".qa-decoration")]),
  ).length, 1);
  assert.deepEqual(unclassifiedSurfaceCandidates(
    fixtureBlocks,
    new Set(),
    new Set([surfaceManifestKey(path, selector)]),
  ), []);
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

test("320~349px 경계에서도 달력·요일 선택과 권한 모달 행동이 화면 안에 들어온다", () => {
  const widths = [320, 340, 341, 344, 347, 348, 349];
  const calendarPath = "src/screens/parent/ParentCalendar.css";
  const eventPath = "src/screens/parent/EventForm.css";
  const permissionDialogPath = "src/components/ChildLocationPermissionDialog.css";
  const violations = [];
  for (const width of widths) {
    const calendarBody = classStyleAtWidth(calendarPath, "pc-body", width);
    const calendarCard = classStyleAtWidth(calendarPath, "pc-card", width);
    const [bodyLeft, bodyRight] = horizontalInsetsFromPadding(declarationValue(calendarBody, "padding"));
    const [cardLeft, cardRight] = horizontalInsetsFromPadding(declarationValue(calendarCard, "padding"));
    const calendarAvailable = width
      - (bodyLeft ?? 0)
      - (bodyRight ?? 0)
      - (cardLeft ?? 0)
      - (cardRight ?? 0);

    const eventBody = classStyleAtWidth(eventPath, "ef-body", width);
    const weekday = classStyleAtWidth(eventPath, "ef-weekday", width);
    const [eventLeft, eventRight] = horizontalInsetsFromPadding(declarationValue(eventBody, "padding"));
    const eventAvailable = width - (eventLeft ?? 0) - (eventRight ?? 0);
    const weekdayHeight = Math.max(
      resolvePixels(declarationValue(weekday, "height")) ?? 0,
      resolvePixels(declarationValue(weekday, "min-height")) ?? 0,
    );

    const actions = classStyleAtWidth(permissionDialogPath, "clp-dialog__actions", width);
    const columns = declarationValue(actions, "grid-template-columns")?.trim();

    if (calendarAvailable < 7 * 44) {
      violations.push(`${calendarPath} ${width}px 달력 가용폭 ${calendarAvailable}px`);
    }
    if (eventAvailable < 7 * 44) {
      violations.push(`${eventPath} ${width}px 요일 선택 가용폭 ${eventAvailable}px`);
    }
    if (weekdayHeight < 44) violations.push(`${eventPath} ${width}px 요일 높이 ${weekdayHeight}px`);
    if (width <= 348 && columns !== "1fr") {
      violations.push(`${permissionDialogPath} ${width}px 권한 버튼 열 ${columns ?? "미지정"}`);
    }
  }

  assert.deepEqual(violations, [], `좁은 화면 경계 위반 ${violations.length}건:\n${violations.join("\n")}`);
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
    "src/styles/global.css",
    "src/styles/components.css",
    "src/app/ChildDock.css",
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

test("conditional class는 현실에 없는 combined class 규칙으로 작은 실제 branch를 숨기지 않는다", () => {
  const elements = collectElementsFromSource("fixture/ClassBranches.tsx", `
    export function ClassBranches({ compact }) {
      return <button className={compact ? "branch-small" : "branch-large"}>분기</button>;
    }
  `);
  assert.deepEqual(elements.map((element) => [...element.classes].sort()), [
    ["branch-small"],
    ["branch-large"],
  ]);
  const blocks = cssBlocks(`
    .branch-small { min-width: 30px; min-height: 30px; }
    .branch-large { min-width: 44px; min-height: 44px; }
    .branch-small.branch-large { min-width: 44px !important; min-height: 44px !important; }
  `).map((block, sourceOrder) => ({ ...block, path: "fixture/ClassBranches.css", sourceOrder }));
  const heights = elements.map((element) => computeElementBoxAtWidth(element, 800, blocks).minHeight);
  assert.deepEqual(heights, [30, 44]);
});

test("동적 template class suffix는 CSS의 실제 variant class별 scenario로 확장한다", () => {
  const elements = collectElementsFromSource("fixture/DynamicClassSuffix.tsx", `
    export function DynamicClassSuffix({ view }) {
      return <button className={\`ls-card ls-card--\${view.tone}\`}>상태</button>;
    }
  `);
  const signatures = new Set(elements.map((element) => [...element.classes].sort().join(" ")));
  assert.ok(signatures.has("ls-card ls-card--mint"));
  assert.ok(signatures.has("ls-card ls-card--caution"));
  const blocks = cssBlocks(`
    .ls-card { min-width: 44px; min-height: 44px; }
    .ls-card--caution { min-width: 30px; min-height: 30px; }
  `).map((block, sourceOrder) => ({ ...block, path: "fixture/DynamicClassSuffix.css", sourceOrder }));
  assert.ok(elements.some((element) => computeElementBoxAtWidth(element, 800, blocks).minHeight === 30));
});

test("template class interpolation은 false도 JavaScript 문자열 값으로 보존한다", () => {
  const elements = collectElementsFromSource("fixture/TemplateBooleanClass.tsx", `
    export function TemplateBooleanClass() {
      return <button className={\`toggle toggle--\${false}\`}>상태</button>;
    }
  `);
  assert.deepEqual(elements.map((element) => [...element.classes].sort()), [["toggle", "toggle--false"]]);
});

test("dynamic disabled는 true와 false branch를 나눠 작은 enabled 상태를 숨기지 않는다", () => {
  const elements = collectElementsFromSource("fixture/DisabledBranches.tsx", `
    export function DisabledBranches({ disabled }) {
      return <button className="disabled-branch" disabled={disabled}>분기</button>;
    }
  `);
  assert.deepEqual(elements.map((element) => [...element.states].sort()), [[], ["disabled"]]);
  const blocks = cssBlocks(`
    .disabled-branch { min-width: 30px; min-height: 30px; }
    .disabled-branch:disabled { min-width: 44px !important; min-height: 44px !important; }
  `).map((block, sourceOrder) => ({ ...block, path: "fixture/DisabledBranches.css", sourceOrder }));
  const heights = elements.map((element) => computeElementBoxAtWidth(element, 800, blocks).minHeight);
  assert.deepEqual(heights, [30, 44]);
});

test("dynamic checked·aria·data 값은 bounded true/false attribute scenario로 분리한다", () => {
  const elements = collectElementsFromSource("fixture/AttributeBranches.tsx", `
    export function AttributeBranches({ checked, pressed, active }) {
      return <input className="kd-color__btn ais-tab" checked={checked} aria-pressed={pressed} data-active={active} />;
    }
  `);
  const signatures = new Set(elements.map((element) => [
    element.states.has("checked") ? "checked" : "unchecked",
    [...(element.attributes.get("aria-pressed")?.values ?? [])][0] ?? "missing",
    [...(element.attributes.get("data-active")?.values ?? [])][0] ?? "missing",
  ].join("|")));
  assert.ok(elements.length <= MAX_JSX_SCENARIOS);
  for (const value of ["checked|true|true", "unchecked|false|missing"]) {
    assert.ok(signatures.has(value), `${value} selector 상태를 보존해야 합니다`);
  }
});

test("동적 data-status는 CSS가 실제 사용하는 문자열 값별 scenario를 만든다", () => {
  const elements = collectElementsFromSource("fixture/StatusBranches.tsx", `
    export function StatusBranches({ status }) {
      return <button className="status-branch ts-attend__btn--on" data-status={status}>상태</button>;
    }
  `);
  const values = new Set(elements.flatMap((element) => [
    ...(element.attributes.get("data-status")?.values ?? []),
  ]));
  for (const value of ["attended", "left", "absent"]) assert.ok(values.has(value), `${value} CSS 분기가 필요합니다`);
  const blocks = cssBlocks(`
    .status-branch { min-width: 44px; min-height: 44px; }
    .status-branch[data-status="left"] { min-width: 30px; min-height: 30px; }
  `).map((block, sourceOrder) => ({ ...block, path: "fixture/StatusBranches.css", sourceOrder }));
  assert.ok(elements.some((element) => computeElementBoxAtWidth(element, 800, blocks).minHeight === 30));
});

test("class 없는 전역 attribute selector도 class가 있는 JSX 요소의 동적 값에 적용한다", () => {
  const elements = collectElementsFromSource("fixture/GlobalAttributeSelector.tsx", `
    export function GlobalAttributeSelector({ locked }) {
      return <button className="global-attribute-fixture" aria-disabled={locked}>상태</button>;
    }
  `);
  const values = new Set(elements.flatMap((element) => [
    ...(element.attributes.get("aria-disabled")?.values ?? []),
  ]));
  assert.ok(values.has("true"), "class 없는 [aria-disabled=\"true\"] selector 분기를 보존해야 합니다");
  assert.ok(values.has("false"), "동적 aria-disabled의 false 분기도 보존해야 합니다");
  assert.ok(elements.some((element) => !element.attributes.has("aria-disabled")), "attribute 미지정 분기도 보존해야 합니다");
});

test("native boolean attribute는 0·빈 문자열을 enabled branch로, 문자열 false를 present branch로 해석한다", () => {
  const elements = collectElementsFromSource("fixture/FalsyBoolean.tsx", `
    export function FalsyBoolean() {
      return <>
        <button className="zero-disabled" disabled={0}>0</button>
        <input className="empty-checked" checked={""} />
        <button className="string-false" disabled={"false"}>문자열</button>
      </>;
    }
  `);
  const byClass = new Map(elements.map((element) => [[...element.classes][0], element]));
  assert.equal(byClass.get("zero-disabled").states.has("disabled"), false);
  assert.equal(byClass.get("empty-checked").states.has("checked"), false);
  assert.equal(byClass.get("string-false").states.has("disabled"), true);
});

test("JSX attribute spread는 상태 분기를 조용히 생략하지 않고 명시적으로 실패한다", () => {
  assert.throws(() => collectElementsFromSource("fixture/SpreadAttributes.tsx", `
    export function SpreadAttributes({ interactionProps }) {
      return <button className="spread-attributes" {...interactionProps}>분기</button>;
    }
  `), /attribute spread.*지원하지 않습니다/i);
});

test("JSX scenario가 상한을 넘으면 후반 분기를 자르지 않고 명시적으로 실패한다", () => {
  assert.throws(() => collectElementsFromSource("fixture/OverflowBranches.tsx", `
    export function OverflowBranches({ pressed, active, invalid, on, selected, current }) {
      return <input
        className="kd-color__btn ais-tab ob-input lset-toggle sub-plan ph-location-chip"
        aria-pressed={pressed}
        data-active={active}
        aria-invalid={invalid}
        data-on={on}
        data-selected={selected}
        data-current={current}
      />;
    }
  `), new RegExp(`scenario.*${MAX_JSX_SCENARIOS}`, "i"));
});

test("실제 JSX scenario 확장은 상호작용 node마다 상한을 지킨다", () => {
  const counts = new Map();
  for (const element of releaseElements) {
    const key = `${element.path}:${element.sourcePosition}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const maximum = Math.max(...counts.values());
  assert.ok(counts.size > 0, "검사할 실제 상호작용 JSX node가 있어야 합니다");
  assert.ok(maximum <= MAX_JSX_SCENARIOS, `node별 scenario 최대 ${maximum}개가 상한 ${MAX_JSX_SCENARIOS}개를 넘었습니다`);
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

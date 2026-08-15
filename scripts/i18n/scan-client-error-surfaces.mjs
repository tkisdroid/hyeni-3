import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import ts from "typescript";

const ALLOWLIST_REASONS = /^(?:protocol|data|accessibility):/;
const RAW_PROPERTIES = new Set(["message", "error"]);
const DISPLAY_SINKS = new Set([
  "show",
  "toast",
  "alert",
  "confirm",
  "setError",
  "setMessage",
]);
const APPROVED_SANITIZERS = new Set([
  "cleanAlertTitle",
  "friendlyError",
  "localizeApiError",
  "playdateCandidateNotice",
  "resolveNativeBillingFailureMessage",
  "webAiCreditFailureMessage",
  "webBillingRequestFailureMessage",
]);
const MEMBER_SINK_OWNERS = /(?:^|_)(?:toast|toaster|dialog|snackbar|notification)s?$/i;
const MEMBER_SINK_METHODS = new Set(["show", "error", "alert", "confirm"]);

function defaultRoot() {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

function parseRoot() {
  const index = process.argv.indexOf("--root");
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : defaultRoot();
}

function slash(path) {
  return path.replaceAll("\\", "/");
}

async function listSourceFiles(root) {
  const files = [];
  async function walk(path) {
    let entries;
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name)) files.push(child);
    }
  }
  await walk(join(root, "src"));
  return files;
}

async function loadAllowlist(root) {
  const path = join(root, "scripts", "i18n", "client-error-surface-allowlist.json");
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function rawPropertyName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    return node.argumentExpression.text;
  }
  return null;
}

function isRawPropertyAccess(node) {
  const property = rawPropertyName(node);
  return property !== null && RAW_PROPERTIES.has(property);
}

function isErrorNamedIdentifier(node) {
  return ts.isIdentifier(node) && /^(?:error|err|failure)$/i.test(node.text);
}

function bindingHasName(binding, name) {
  return bindingIdentifiers(binding).some((identifier) => identifier.text === name);
}

function isErrorSourceReference(node) {
  if (!ts.isIdentifier(node)) return false;
  let current = node.parent;
  while (current) {
    if (ts.isFunctionLike(current)) {
      const parameter = current.parameters.find((item) => bindingHasName(item.name, node.text));
      if (parameter) return isErrorNamedIdentifier(node);
    }
    if (
      ts.isCatchClause(current)
      && current.variableDeclaration
      && bindingHasName(current.variableDeclaration.name, node.text)
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function expressionIsTainted(node, tainted) {
  if (!node) return false;
  if (isRawPropertyAccess(node)) return true;
  if (ts.isIdentifier(node)) return tainted.has(node.text) || isErrorSourceReference(node);
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    return expressionIsTainted(node.expression, tainted);
  }
  if (ts.isCallExpression(node)) {
    if (ts.isIdentifier(node.expression) && APPROVED_SANITIZERS.has(node.expression.text)) {
      return false;
    }
    return node.arguments.some((argument) => expressionIsTainted(argument, tainted))
      || (
        ts.isPropertyAccessExpression(node.expression)
        && expressionIsTainted(node.expression.expression, tainted)
      );
  }
  if (ts.isNewExpression(node)) {
    return node.arguments?.some((argument) => expressionIsTainted(argument, tainted)) ?? false;
  }
  if (
    ts.isParenthesizedExpression(node)
    || ts.isAsExpression(node)
    || ts.isTypeAssertionExpression(node)
    || ts.isNonNullExpression(node)
    || ts.isAwaitExpression(node)
  ) {
    return expressionIsTainted(node.expression, tainted);
  }
  if (ts.isArrowFunction(node)) return expressionIsTainted(node.body, tainted);
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.some((property) => {
      if (ts.isPropertyAssignment(property)) return expressionIsTainted(property.initializer, tainted);
      if (ts.isShorthandPropertyAssignment(property)) return expressionIsTainted(property.name, tainted);
      if (ts.isSpreadAssignment(property)) return expressionIsTainted(property.expression, tainted);
      return false;
    });
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.some((element) => expressionIsTainted(element, tainted));
  }
  if (ts.isTemplateExpression(node)) {
    return node.templateSpans.some((span) => expressionIsTainted(span.expression, tainted));
  }
  if (ts.isConditionalExpression(node)) {
    return expressionIsTainted(node.whenTrue, tainted)
      || expressionIsTainted(node.whenFalse, tainted);
  }
  if (ts.isBinaryExpression(node)) {
    if (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      return expressionIsTainted(node.right, tainted);
    }
    if (
      node.operatorToken.kind === ts.SyntaxKind.BarBarToken
      || node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
      || node.operatorToken.kind === ts.SyntaxKind.PlusToken
    ) {
      return expressionIsTainted(node.left, tainted)
        || expressionIsTainted(node.right, tainted);
    }
  }
  return false;
}

function bindingIdentifiers(name) {
  if (ts.isIdentifier(name)) return [name];
  const identifiers = [];
  for (const element of name.elements) {
    if (ts.isOmittedExpression(element)) continue;
    identifiers.push(...bindingIdentifiers(element.name));
  }
  return identifiers;
}

function boundName(binding) {
  return ts.isIdentifier(binding.name) ? binding.name.text : null;
}

function collectStateSetters(sourceFile) {
  const setters = new Map();
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node)
      && ts.isArrayBindingPattern(node.name)
      && node.name.elements.length >= 2
      && node.initializer
      && ts.isCallExpression(node.initializer)
      && ts.isIdentifier(node.initializer.expression)
      && node.initializer.expression.text === "useState"
    ) {
      const state = node.name.elements[0] && boundName(node.name.elements[0]);
      const setter = node.name.elements[1] && boundName(node.name.elements[1]);
      if (state && setter) setters.set(setter, state);
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return setters;
}

function collectTaintedNames(sourceFile, stateSetters) {
  const tainted = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    const add = (name) => {
      if (!name || tainted.has(name)) return;
      tainted.add(name);
      changed = true;
    };
    const visit = (node) => {
      if (ts.isVariableDeclaration(node)) {
        if (ts.isIdentifier(node.name) && expressionIsTainted(node.initializer, tainted)) {
          add(node.name.text);
        }
        if (ts.isObjectBindingPattern(node.name)) {
          for (const element of node.name.elements) {
            const property = element.propertyName ?? element.name;
            const propertyText = ts.isIdentifier(property) || ts.isStringLiteralLike(property)
              ? property.text
              : "";
            if (RAW_PROPERTIES.has(propertyText) || expressionIsTainted(node.initializer, tainted)) {
              add(boundName(element));
            }
          }
        }
      }
      if (
        ts.isBinaryExpression(node)
        && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && expressionIsTainted(node.right, tainted)
      ) {
        if (ts.isIdentifier(node.left)) add(node.left.text);
        if (
          (ts.isPropertyAccessExpression(node.left) || ts.isElementAccessExpression(node.left))
          && ts.isIdentifier(node.left.expression)
        ) {
          add(node.left.expression.text);
        }
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const state = stateSetters.get(node.expression.text);
        if (state && node.arguments.some((argument) => expressionIsTainted(argument, tainted))) {
          add(state);
        }
      }
      node.forEachChild(visit);
    };
    visit(sourceFile);
  }
  return tainted;
}

function rootIdentifier(node) {
  let current = node;
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    current = current.expression;
  }
  return ts.isIdentifier(current) ? current.text : null;
}

function isDisplayCall(node) {
  if (ts.isIdentifier(node.expression)) return DISPLAY_SINKS.has(node.expression.text);
  if (!ts.isPropertyAccessExpression(node.expression)) return false;
  const owner = rootIdentifier(node.expression.expression);
  return owner !== null
    && MEMBER_SINK_OWNERS.test(owner)
    && MEMBER_SINK_METHODS.has(node.expression.name.text);
}

function findingNodes(sourceFile, tainted) {
  const findings = [];
  const visit = (node) => {
    if (ts.isJsxExpression(node) && expressionIsTainted(node.expression, tainted)) {
      findings.push(node);
    } else if (
      ts.isCallExpression(node)
      && isDisplayCall(node)
      && node.arguments.some((argument) => expressionIsTainted(argument, tainted))
    ) {
      findings.push(node);
    } else if (
      ts.isNewExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === "Error"
      && node.arguments?.some((argument) => expressionIsTainted(argument, tainted))
    ) {
      findings.push(node);
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return findings;
}

async function main() {
  const root = parseRoot();
  const allowlist = await loadAllowlist(root);
  const errors = [];
  const compiled = allowlist.map((entry, index) => {
    if (!entry || typeof entry.path !== "string" || typeof entry.pattern !== "string"
      || typeof entry.reason !== "string" || !ALLOWLIST_REASONS.test(entry.reason)) {
      errors.push(`invalid_allowlist_reason:${index + 1}`);
      return { entry, regex: null, used: 0 };
    }
    try {
      if (!Number.isInteger(entry.occurrences) || entry.occurrences < 1) {
        errors.push(`invalid_allowlist_occurrences:${index + 1}`);
      }
      return { entry, regex: new RegExp(entry.pattern), used: 0 };
    } catch {
      errors.push(`invalid_allowlist_pattern:${index + 1}`);
      return { entry, regex: null, used: 0 };
    }
  });

  for (const path of await listSourceFiles(root)) {
    const file = slash(relative(root, path));
    const source = await readFile(path, "utf8");
    const lines = source.split(/\r?\n/);
    const sourceFile = ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      true,
      path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const stateSetters = collectStateSetters(sourceFile);
    const tainted = collectTaintedNames(sourceFile, stateSetters);
    for (const node of findingNodes(sourceFile, tainted)) {
      const lineIndex = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line;
      const line = lines[lineIndex] ?? "";
      const snippet = node.getText(sourceFile);
      const matching = compiled.filter((item) => {
        if (!item.regex || item.entry.path !== file) return false;
        item.regex.lastIndex = 0;
        return item.regex.test(snippet);
      });
      const available = matching.find((item) => item.used < item.entry.occurrences);
      if (available) {
        available.used += 1;
      } else {
        if (matching.length > 0) {
          errors.push(`${file}:${lineIndex + 1}:overused_allowlist:${line.trim()}`);
        }
        errors.push(`${file}:${lineIndex + 1}:raw_error_surface:${line.trim()}`);
      }
    }
  }

  compiled.forEach((item, index) => {
    if (item.regex && item.used !== item.entry.occurrences) {
      errors.push(`stale_allowlist:${index + 1}:${item.entry.path}:expected_${item.entry.occurrences}:used_${item.used}`);
    }
  });
  if (errors.length > 0) {
    console.error([...new Set(errors)].join("\n"));
    process.exitCode = 1;
    return;
  }
  console.log("클라이언트 오류 표면 검사 통과");
}

await main();

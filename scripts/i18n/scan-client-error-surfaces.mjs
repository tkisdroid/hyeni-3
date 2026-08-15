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
const APPROVED_IMPORTED_SANITIZERS = new Map([
  ["localizeApiError", new Set(["@/i18n/apiError", "../i18n/apiError.ts"])],
  ["playdateCandidateNotice", new Set(["@/transform/playdateNotice"])],
  ["resolveNativeBillingFailureMessage", new Set(["@/transform/billingFailureMessage"])],
  ["webBillingRequestFailureMessage", new Set(["@/transform/webBilling"])],
]);
const APPROVED_LOCAL_SANITIZERS = new Map([
  ["src/screens/child/AiFriendChat.tsx", new Set(["friendlyError"])],
  ["src/screens/feature/AiCredit.tsx", new Set(["webAiCreditFailureMessage"])],
  ["src/screens/feature/PlaydateAccept.tsx", new Set(["friendlyError"])],
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

function bindingIdentifiers(name) {
  if (ts.isIdentifier(name)) return [name];
  const identifiers = [];
  for (const element of name.elements) {
    if (ts.isOmittedExpression(element)) continue;
    identifiers.push(...bindingIdentifiers(element.name));
  }
  return identifiers;
}

function createBindingModel(sourceFile, file) {
  const nodeScopes = new WeakMap();
  const declarationBindings = new WeakMap();
  const makeScope = (parent) => ({ parent, bindings: new Map() });
  const rootScope = makeScope(null);

  const declareName = (name, scope, metadata = {}) => {
    for (const identifier of bindingIdentifiers(name)) {
      const binding = { name: identifier.text, declaration: identifier, ...metadata };
      scope.bindings.set(identifier.text, binding);
      declarationBindings.set(identifier, binding);
    }
  };

  const predeclareStatement = (statement, scope) => {
    if (ts.isImportDeclaration(statement) && statement.importClause) {
      const moduleSource = ts.isStringLiteralLike(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : "";
      if (statement.importClause.name) {
        declareName(statement.importClause.name, scope, {
          kind: "import",
          importedName: "default",
          moduleSource,
        });
      }
      const bindings = statement.importClause.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          declareName(element.name, scope, {
            kind: "import",
            importedName: element.propertyName?.text ?? element.name.text,
            moduleSource,
          });
        }
      } else if (bindings && ts.isNamespaceImport(bindings)) {
        declareName(bindings.name, scope, { kind: "import_namespace", moduleSource });
      }
      return;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        declareName(declaration.name, scope, { kind: "variable" });
      }
      return;
    }
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) {
      declareName(statement.name, scope, { kind: "declaration" });
    }
  };

  const predeclareContainer = (container, scope) => {
    if (ts.isSourceFile(container) || ts.isBlock(container)) {
      for (const statement of container.statements) predeclareStatement(statement, scope);
    }
    if (ts.isFunctionLike(container)) {
      if (ts.isFunctionExpression(container) && container.name) {
        declareName(container.name, scope, { kind: "declaration" });
      }
      for (const parameter of container.parameters) {
        for (const identifier of bindingIdentifiers(parameter.name)) {
          declareName(identifier, scope, {
            kind: "parameter",
            errorSource: isErrorNamedIdentifier(identifier),
          });
        }
      }
    }
    if (ts.isCatchClause(container) && container.variableDeclaration) {
      for (const identifier of bindingIdentifiers(container.variableDeclaration.name)) {
        declareName(identifier, scope, { kind: "catch", errorSource: true });
      }
    }
  };

  const isNestedScope = (node) => ts.isFunctionLike(node)
    || ts.isBlock(node)
    || ts.isCatchClause(node)
    || ts.isForStatement(node)
    || ts.isForInStatement(node)
    || ts.isForOfStatement(node);
  const attach = (node, scope) => {
    nodeScopes.set(node, scope);
    if (ts.isVariableDeclaration(node)) {
      for (const identifier of bindingIdentifiers(node.name)) {
        if (!declarationBindings.has(identifier)) {
          declareName(identifier, scope, { kind: "variable" });
        }
      }
    }
    node.forEachChild((child) => {
      if (isNestedScope(child)) {
        const childScope = makeScope(scope);
        predeclareContainer(child, childScope);
        attach(child, childScope);
      } else {
        attach(child, scope);
      }
    });
  };

  predeclareContainer(sourceFile, rootScope);
  attach(sourceFile, rootScope);

  const resolve = (identifier) => {
    if (!ts.isIdentifier(identifier)) return null;
    const declaration = declarationBindings.get(identifier);
    if (declaration) return declaration;
    let scope = nodeScopes.get(identifier) ?? rootScope;
    while (scope) {
      const binding = scope.bindings.get(identifier.text);
      if (binding) return binding;
      scope = scope.parent;
    }
    return null;
  };

  const approvedLocalNames = APPROVED_LOCAL_SANITIZERS.get(file);
  const isApprovedSanitizer = (identifier) => {
    const binding = resolve(identifier);
    if (!binding) return false;
    if (binding.kind === "import") {
      const sources = APPROVED_IMPORTED_SANITIZERS.get(binding.importedName);
      return sources?.has(binding.moduleSource) ?? false;
    }
    if (!approvedLocalNames?.has(binding.name)) return false;
    const declaration = binding.declaration.parent;
    return ts.isFunctionDeclaration(declaration)
      || (
        ts.isVariableDeclaration(declaration)
        && declaration.initializer !== undefined
        && (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))
      );
  };

  return { resolve, isApprovedSanitizer };
}

function expressionIsTainted(node, tainted, model) {
  if (!node) return false;
  if (isRawPropertyAccess(node)) return true;
  if (ts.isIdentifier(node)) {
    const binding = model.resolve(node);
    return binding !== null && (tainted.has(binding) || binding.errorSource === true);
  }
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    return expressionIsTainted(node.expression, tainted, model);
  }
  if (ts.isCallExpression(node)) {
    if (ts.isIdentifier(node.expression) && model.isApprovedSanitizer(node.expression)) {
      return false;
    }
    return node.arguments.some((argument) => expressionIsTainted(argument, tainted, model))
      || (
        ts.isPropertyAccessExpression(node.expression)
        && expressionIsTainted(node.expression.expression, tainted, model)
      );
  }
  if (ts.isNewExpression(node)) {
    return node.arguments?.some((argument) => expressionIsTainted(argument, tainted, model)) ?? false;
  }
  if (
    ts.isParenthesizedExpression(node)
    || ts.isAsExpression(node)
    || ts.isTypeAssertionExpression(node)
    || ts.isNonNullExpression(node)
    || ts.isAwaitExpression(node)
  ) {
    return expressionIsTainted(node.expression, tainted, model);
  }
  if (ts.isArrowFunction(node)) return expressionIsTainted(node.body, tainted, model);
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.some((property) => {
      if (ts.isPropertyAssignment(property)) return expressionIsTainted(property.initializer, tainted, model);
      if (ts.isShorthandPropertyAssignment(property)) return expressionIsTainted(property.name, tainted, model);
      if (ts.isSpreadAssignment(property)) return expressionIsTainted(property.expression, tainted, model);
      return false;
    });
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.some((element) => expressionIsTainted(element, tainted, model));
  }
  if (ts.isTemplateExpression(node)) {
    return node.templateSpans.some((span) => expressionIsTainted(span.expression, tainted, model));
  }
  if (ts.isConditionalExpression(node)) {
    return expressionIsTainted(node.whenTrue, tainted, model)
      || expressionIsTainted(node.whenFalse, tainted, model);
  }
  if (ts.isBinaryExpression(node)) {
    if (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      return expressionIsTainted(node.right, tainted, model);
    }
    if (
      node.operatorToken.kind === ts.SyntaxKind.BarBarToken
      || node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
      || node.operatorToken.kind === ts.SyntaxKind.PlusToken
    ) {
      return expressionIsTainted(node.left, tainted, model)
        || expressionIsTainted(node.right, tainted, model);
    }
  }
  return false;
}

function boundName(binding) {
  return ts.isIdentifier(binding.name) ? binding.name : null;
}

function collectStateSetters(sourceFile, model) {
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
      const stateBinding = state && model.resolve(state);
      const setterBinding = setter && model.resolve(setter);
      if (stateBinding && setterBinding) setters.set(setterBinding, stateBinding);
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return setters;
}

function rootIdentifierNode(node) {
  let current = node;
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    current = current.expression;
  }
  return ts.isIdentifier(current) ? current : null;
}

function collectTaintedBindings(sourceFile, stateSetters, model) {
  const tainted = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    const add = (binding) => {
      if (!binding || tainted.has(binding)) return;
      tainted.add(binding);
      changed = true;
    };
    const visit = (node) => {
      if (ts.isVariableDeclaration(node)) {
        if (ts.isIdentifier(node.name) && expressionIsTainted(node.initializer, tainted, model)) {
          add(model.resolve(node.name));
        }
        if (ts.isObjectBindingPattern(node.name)) {
          for (const element of node.name.elements) {
            const property = element.propertyName ?? element.name;
            const propertyText = ts.isIdentifier(property) || ts.isStringLiteralLike(property)
              ? property.text
              : "";
            if (RAW_PROPERTIES.has(propertyText) || expressionIsTainted(node.initializer, tainted, model)) {
              add(model.resolve(boundName(element)));
            }
          }
        }
      }
      if (
        ts.isBinaryExpression(node)
        && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && expressionIsTainted(node.right, tainted, model)
      ) {
        const target = ts.isIdentifier(node.left) ? node.left : rootIdentifierNode(node.left);
        if (target) add(model.resolve(target));
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const state = stateSetters.get(model.resolve(node.expression));
        if (state && node.arguments.some((argument) => expressionIsTainted(argument, tainted, model))) {
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
  return rootIdentifierNode(node)?.text ?? null;
}

function isDisplayCall(node) {
  if (ts.isIdentifier(node.expression)) return DISPLAY_SINKS.has(node.expression.text);
  if (!ts.isPropertyAccessExpression(node.expression) && !ts.isElementAccessExpression(node.expression)) {
    return false;
  }
  const method = ts.isPropertyAccessExpression(node.expression)
    ? node.expression.name.text
    : ts.isStringLiteralLike(node.expression.argumentExpression)
      ? node.expression.argumentExpression.text
      : null;
  const owner = rootIdentifier(node.expression.expression);
  return owner !== null
    && MEMBER_SINK_OWNERS.test(owner)
    && method !== null
    && MEMBER_SINK_METHODS.has(method);
}

function findingNodes(sourceFile, tainted, model) {
  const findings = [];
  const visit = (node) => {
    if (ts.isJsxExpression(node) && expressionIsTainted(node.expression, tainted, model)) {
      findings.push(node);
    } else if (
      ts.isCallExpression(node)
      && isDisplayCall(node)
      && node.arguments.some((argument) => expressionIsTainted(argument, tainted, model))
    ) {
      findings.push(node);
    } else if (
      ts.isNewExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === "Error"
      && node.arguments?.some((argument) => expressionIsTainted(argument, tainted, model))
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
    const model = createBindingModel(sourceFile, file);
    const stateSetters = collectStateSetters(sourceFile, model);
    const tainted = collectTaintedBindings(sourceFile, stateSetters, model);
    for (const node of findingNodes(sourceFile, tainted, model)) {
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

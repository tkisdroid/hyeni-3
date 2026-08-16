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

  const approvedLocalBindings = new Set();
  for (const name of APPROVED_LOCAL_SANITIZERS.get(file) ?? []) {
    const binding = rootScope.bindings.get(name);
    if (!binding) continue;
    const declaration = binding.declaration.parent;
    if (
      ts.isFunctionDeclaration(declaration)
      || (
        ts.isVariableDeclaration(declaration)
        && declaration.initializer !== undefined
        && (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))
      )
    ) {
      approvedLocalBindings.add(binding);
    }
  }
  const isApprovedSanitizer = (identifier) => {
    const binding = resolve(identifier);
    if (!binding) return false;
    if (binding.kind === "import") {
      const sources = APPROVED_IMPORTED_SANITIZERS.get(binding.importedName);
      return sources?.has(binding.moduleSource) ?? false;
    }
    return approvedLocalBindings.has(binding);
  };

  return { resolve, isApprovedSanitizer };
}

function isTrackedCallable(node) {
  return ts.isArrowFunction(node)
    || ts.isFunctionExpression(node)
    || ts.isFunctionDeclaration(node)
    || ts.isMethodDeclaration(node);
}

function callableReturnExpressions(callable) {
  if (ts.isArrowFunction(callable) && !ts.isBlock(callable.body)) return [callable.body];
  if (!callable.body) return [];
  const expressions = [];
  const visit = (node) => {
    if (node !== callable.body && isTrackedCallable(node)) return;
    if (ts.isReturnStatement(node)) {
      if (node.expression) expressions.push(node.expression);
      return;
    }
    node.forEachChild(visit);
  };
  visit(callable.body);
  return expressions;
}

function emptyAbstractValue() {
  return { displayRaw: false, callables: new Set() };
}

function rawAbstractValue() {
  return { displayRaw: true, callables: new Set() };
}

function callableAbstractValue(callable) {
  return { displayRaw: false, callables: new Set([callable]) };
}

function mergeAbstractValues(...values) {
  const merged = emptyAbstractValue();
  for (const value of values) {
    if (!value) continue;
    merged.displayRaw ||= value.displayRaw;
    for (const callable of value.callables) merged.callables.add(callable);
  }
  return merged;
}

function abstractValueChanged(previous, next) {
  if (previous.displayRaw !== next.displayRaw || previous.callables.size !== next.callables.size) {
    return true;
  }
  return [...next.callables].some((callable) => !previous.callables.has(callable));
}

function callableReturnValue(callable, bindingValues, model, activeCallables) {
  if (activeCallables.has(callable)) return emptyAbstractValue();
  const nextActive = new Set(activeCallables);
  nextActive.add(callable);
  return mergeAbstractValues(...callableReturnExpressions(callable)
    .map((expression) => expressionAbstractValue(expression, bindingValues, model, nextActive)));
}

function transparentExpression(node) {
  if (
    ts.isParenthesizedExpression(node)
    || ts.isAsExpression(node)
    || ts.isTypeAssertionExpression(node)
    || ts.isNonNullExpression(node)
    || ts.isSatisfiesExpression(node)
    || ts.isAwaitExpression(node)
  ) {
    return node.expression;
  }
  return null;
}

function expressionAbstractValue(node, bindingValues, model, activeCallables = new Set()) {
  if (!node) return emptyAbstractValue();
  if (isRawPropertyAccess(node)) return rawAbstractValue();
  if (ts.isIdentifier(node)) {
    const binding = model.resolve(node);
    if (!binding) return emptyAbstractValue();
    return mergeAbstractValues(
      bindingValues.get(binding),
      binding.errorSource === true ? rawAbstractValue() : null,
    );
  }
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    return expressionAbstractValue(node.expression, bindingValues, model, activeCallables);
  }
  if (ts.isCallExpression(node)) {
    if (ts.isIdentifier(node.expression) && model.isApprovedSanitizer(node.expression)) {
      return emptyAbstractValue();
    }
    const callee = expressionAbstractValue(node.expression, bindingValues, model, activeCallables);
    const returned = mergeAbstractValues(...[...callee.callables]
      .map((callable) => callableReturnValue(callable, bindingValues, model, activeCallables)));
    const argumentsContainRaw = node.arguments.some((argument) => (
      expressionAbstractValue(argument, bindingValues, model, activeCallables).displayRaw
    ));
    return mergeAbstractValues(
      returned,
      callee.displayRaw || argumentsContainRaw ? rawAbstractValue() : null,
    );
  }
  if (ts.isNewExpression(node)) {
    const argumentsContainRaw = node.arguments?.some((argument) => (
      expressionAbstractValue(argument, bindingValues, model, activeCallables).displayRaw
    )) ?? false;
    return argumentsContainRaw ? rawAbstractValue() : emptyAbstractValue();
  }
  const transparent = transparentExpression(node);
  if (transparent) {
    return expressionAbstractValue(transparent, bindingValues, model, activeCallables);
  }
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    return callableAbstractValue(node);
  }
  if (ts.isObjectLiteralExpression(node)) {
    return mergeAbstractValues(...node.properties.map((property) => {
      if (ts.isPropertyAssignment(property)) {
        return expressionAbstractValue(property.initializer, bindingValues, model, activeCallables);
      }
      if (ts.isShorthandPropertyAssignment(property)) {
        return expressionAbstractValue(property.name, bindingValues, model, activeCallables);
      }
      if (ts.isSpreadAssignment(property)) {
        return expressionAbstractValue(property.expression, bindingValues, model, activeCallables);
      }
      if (ts.isMethodDeclaration(property)) return callableAbstractValue(property);
      return emptyAbstractValue();
    }));
  }
  if (ts.isArrayLiteralExpression(node)) {
    return mergeAbstractValues(...node.elements.map((element) => (
      expressionAbstractValue(element, bindingValues, model, activeCallables)
    )));
  }
  if (ts.isTemplateExpression(node)) {
    const containsRaw = node.templateSpans.some((span) => (
      expressionAbstractValue(span.expression, bindingValues, model, activeCallables).displayRaw
    ));
    return containsRaw ? rawAbstractValue() : emptyAbstractValue();
  }
  if (ts.isConditionalExpression(node)) {
    return mergeAbstractValues(
      expressionAbstractValue(node.whenTrue, bindingValues, model, activeCallables),
      expressionAbstractValue(node.whenFalse, bindingValues, model, activeCallables),
    );
  }
  if (ts.isBinaryExpression(node)) {
    const operator = node.operatorToken.kind;
    if (operator === ts.SyntaxKind.CommaToken || operator === ts.SyntaxKind.EqualsToken) {
      return expressionAbstractValue(node.right, bindingValues, model, activeCallables);
    }
    if (operator === ts.SyntaxKind.AmpersandAmpersandToken) {
      return expressionAbstractValue(node.right, bindingValues, model, activeCallables);
    }
    if (
      operator === ts.SyntaxKind.BarBarToken
      || operator === ts.SyntaxKind.QuestionQuestionToken
      || operator === ts.SyntaxKind.AmpersandAmpersandEqualsToken
      || operator === ts.SyntaxKind.BarBarEqualsToken
      || operator === ts.SyntaxKind.QuestionQuestionEqualsToken
    ) {
      return mergeAbstractValues(
        expressionAbstractValue(node.left, bindingValues, model, activeCallables),
        expressionAbstractValue(node.right, bindingValues, model, activeCallables),
      );
    }
    if (operator === ts.SyntaxKind.PlusToken || operator === ts.SyntaxKind.PlusEqualsToken) {
      const containsRaw = expressionAbstractValue(node.left, bindingValues, model, activeCallables).displayRaw
        || expressionAbstractValue(node.right, bindingValues, model, activeCallables).displayRaw;
      return containsRaw ? rawAbstractValue() : emptyAbstractValue();
    }
  }
  return emptyAbstractValue();
}

function expressionIsTainted(node, bindingValues, model) {
  return expressionAbstractValue(node, bindingValues, model).displayRaw;
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

function accessChainRoot(node) {
  let current = node;
  while (current) {
    if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
      current = current.expression;
      continue;
    }
    const transparent = transparentExpression(current);
    if (transparent) {
      current = transparent;
      continue;
    }
    break;
  }
  return ts.isIdentifier(current) ? current : null;
}

function assignmentTargetIdentifiers(node) {
  if (!node) return [];
  if (ts.isIdentifier(node)) return [node];
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    const root = accessChainRoot(node);
    return root ? [root] : [];
  }
  const transparent = transparentExpression(node);
  if (transparent) return assignmentTargetIdentifiers(transparent);
  if (ts.isSpreadElement(node) || ts.isSpreadAssignment(node)) {
    return assignmentTargetIdentifiers(node.expression);
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    return assignmentTargetIdentifiers(node.left);
  }
  if (ts.isBindingElement(node)) return assignmentTargetIdentifiers(node.name);
  if (ts.isArrayLiteralExpression(node) || ts.isArrayBindingPattern(node)) {
    return node.elements.flatMap((element) => (
      ts.isOmittedExpression(element) ? [] : assignmentTargetIdentifiers(element)
    ));
  }
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.flatMap((property) => {
      if (ts.isShorthandPropertyAssignment(property)) return assignmentTargetIdentifiers(property.name);
      if (ts.isPropertyAssignment(property)) return assignmentTargetIdentifiers(property.initializer);
      if (ts.isSpreadAssignment(property)) return assignmentTargetIdentifiers(property.expression);
      return [];
    });
  }
  if (ts.isObjectBindingPattern(node)) {
    return node.elements.flatMap((element) => assignmentTargetIdentifiers(element));
  }
  return [];
}

function collectBindingValues(sourceFile, stateSetters, model) {
  const bindingValues = new Map();
  let changed = true;
  while (changed) {
    changed = false;
    const add = (binding, value) => {
      if (!binding) return;
      const previous = bindingValues.get(binding) ?? emptyAbstractValue();
      const next = mergeAbstractValues(previous, value);
      if (!abstractValueChanged(previous, next)) return;
      bindingValues.set(binding, next);
      changed = true;
    };
    const visit = (node) => {
      if (ts.isVariableDeclaration(node)) {
        const initializerValue = expressionAbstractValue(node.initializer, bindingValues, model);
        if (ts.isIdentifier(node.name)) {
          add(model.resolve(node.name), initializerValue);
        }
        if (ts.isArrayBindingPattern(node.name) && (
          initializerValue.displayRaw || initializerValue.callables.size > 0
        )) {
          for (const identifier of bindingIdentifiers(node.name)) add(model.resolve(identifier), initializerValue);
        }
        if (ts.isObjectBindingPattern(node.name)) {
          for (const element of node.name.elements) {
            const property = element.propertyName ?? element.name;
            const propertyText = ts.isIdentifier(property) || ts.isStringLiteralLike(property)
              ? property.text
              : "";
            if (RAW_PROPERTIES.has(propertyText)) {
              add(model.resolve(boundName(element)), rawAbstractValue());
            } else if (initializerValue.displayRaw || initializerValue.callables.size > 0) {
              add(model.resolve(boundName(element)), initializerValue);
            }
          }
        }
      }
      if (ts.isFunctionDeclaration(node) && node.name) {
        add(model.resolve(node.name), callableAbstractValue(node));
      }
      if (
        ts.isBinaryExpression(node)
        && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      ) {
        const rightValue = expressionAbstractValue(node.right, bindingValues, model);
        if (rightValue.displayRaw || rightValue.callables.size > 0) {
          for (const target of assignmentTargetIdentifiers(node.left)) {
            add(model.resolve(target), rightValue);
          }
        }
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const state = stateSetters.get(model.resolve(node.expression));
        if (state) {
          const argumentValue = mergeAbstractValues(...node.arguments.map((argument) => (
            expressionAbstractValue(argument, bindingValues, model)
          )));
          if (argumentValue.displayRaw || argumentValue.callables.size > 0) add(state, argumentValue);
        }
      }
      node.forEachChild(visit);
    };
    visit(sourceFile);
  }
  return bindingValues;
}

function rootIdentifier(node) {
  return accessChainRoot(node)?.text ?? null;
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

function findingNodes(sourceFile, bindingValues, model) {
  const findings = [];
  const visit = (node) => {
    if (ts.isJsxExpression(node) && expressionIsTainted(node.expression, bindingValues, model)) {
      findings.push(node);
    } else if (
      ts.isCallExpression(node)
      && isDisplayCall(node)
      && node.arguments.some((argument) => expressionIsTainted(argument, bindingValues, model))
    ) {
      findings.push(node);
    } else if (
      ts.isNewExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === "Error"
      && node.arguments?.some((argument) => expressionIsTainted(argument, bindingValues, model))
    ) {
      findings.push(node);
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return findings;
}

function findingSubject(node, sourceFile) {
  const subject = ts.isJsxExpression(node) ? node.expression : node;
  return subject?.getText(sourceFile).replace(/\s+/g, " ").trim() ?? "";
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
      return { entry, regex: new RegExp(`^(?:${entry.pattern})$`), used: 0 };
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
    const bindingValues = collectBindingValues(sourceFile, stateSetters, model);
    for (const node of findingNodes(sourceFile, bindingValues, model)) {
      const lineIndex = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line;
      const line = lines[lineIndex] ?? "";
      const snippet = findingSubject(node, sourceFile);
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

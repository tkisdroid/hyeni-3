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
  return { displayRaw: false, mayUntrackedCallable: false, callables: new Set() };
}

function rawAbstractValue() {
  return { displayRaw: true, mayUntrackedCallable: false, callables: new Set() };
}

function untrackedCallableAbstractValue() {
  return { displayRaw: false, mayUntrackedCallable: true, callables: new Set() };
}

function createAbstractAnalysis() {
  return { descriptors: new WeakMap(), revision: 0 };
}

function mergeAbstractValues(...values) {
  const merged = emptyAbstractValue();
  for (const value of values) {
    if (!value) continue;
    merged.displayRaw ||= value.displayRaw;
    merged.mayUntrackedCallable ||= value.mayUntrackedCallable;
    for (const callable of value.callables) merged.callables.add(callable);
  }
  return merged;
}

function abstractValueChanged(previous, next) {
  if (
    previous.displayRaw !== next.displayRaw
    || previous.mayUntrackedCallable !== next.mayUntrackedCallable
    || previous.callables.size !== next.callables.size
  ) {
    return true;
  }
  return [...next.callables].some((callable) => !previous.callables.has(callable));
}

function mergeEnvironmentValue(environment, binding, value) {
  const previous = environment.get(binding) ?? emptyAbstractValue();
  const next = mergeAbstractValues(previous, value);
  if (!abstractValueChanged(previous, next)) return false;
  environment.set(binding, next);
  return true;
}

function callableDescriptor(callable, origin, environment, analysis) {
  let byOrigin = analysis.descriptors.get(callable);
  if (!byOrigin) {
    byOrigin = new WeakMap();
    analysis.descriptors.set(callable, byOrigin);
  }
  const stableOrigin = origin ?? callable;
  let descriptor = byOrigin.get(stableOrigin);
  if (!descriptor) {
    descriptor = { callable, capturedValues: new Map() };
    byOrigin.set(stableOrigin, descriptor);
  }
  for (const [binding, value] of environment) {
    if (mergeEnvironmentValue(descriptor.capturedValues, binding, value)) analysis.revision += 1;
  }
  return descriptor;
}

function callableAbstractValue(callable, context) {
  return {
    displayRaw: false,
    mayUntrackedCallable: false,
    callables: new Set([
      callableDescriptor(callable, context.origin, context.environment, context.analysis),
    ]),
  };
}

function callableDeclarationForBinding(binding) {
  const declaration = binding.declaration.parent;
  if (
    (ts.isFunctionDeclaration(declaration) || ts.isFunctionExpression(declaration))
    && declaration.name === binding.declaration
  ) {
    return declaration;
  }
  return null;
}

function bindingMayBeUntrackedCallable(binding, resolvedValue) {
  if (binding.kind === "import" || binding.kind === "import_namespace") return true;
  if (abstractValueHasSignal(resolvedValue ?? emptyAbstractValue())) return false;
  if (binding.kind === "parameter") return true;
  const declaration = binding.declaration.parent;
  return binding.kind === "variable"
    && ts.isVariableDeclaration(declaration)
    && declaration.initializer === undefined;
}

function bindCallableParameters(descriptor, argumentValues, context) {
  const environment = new Map(descriptor.capturedValues);
  let argumentIndex = 0;
  for (const parameter of descriptor.callable.parameters) {
    let parameterValue;
    if (parameter.dotDotDotToken) {
      parameterValue = mergeAbstractValues(...argumentValues.slice(argumentIndex));
      argumentIndex = argumentValues.length;
    } else {
      parameterValue = argumentValues[argumentIndex] ?? emptyAbstractValue();
      argumentIndex += 1;
    }
    if (parameter.initializer) {
      parameterValue = mergeAbstractValues(
        parameterValue,
        expressionAbstractValue(parameter.initializer, { ...context, environment }),
      );
    }
    for (const identifier of bindingIdentifiers(parameter.name)) {
      const binding = context.model.resolve(identifier);
      if (binding) mergeEnvironmentValue(environment, binding, parameterValue);
    }
  }
  return environment;
}

function callableReturnValue(descriptor, argumentValues, context, invocation) {
  const callable = descriptor.callable;
  if (context.activeCallables.has(callable)) return emptyAbstractValue();
  const activeCallables = new Set(context.activeCallables);
  activeCallables.add(callable);
  let environment = bindCallableParameters(descriptor, argumentValues, context);
  let returnContext = {
    ...context,
    activeCallables,
    environment,
    origin: invocation,
  };
  environment = propagateCallableEnvironment(callable, environment, returnContext);
  returnContext = { ...returnContext, environment };
  return mergeAbstractValues(...callableReturnExpressions(callable)
    .map((expression) => expressionAbstractValue(expression, returnContext)));
}

function invokeTrackedCallables(value, argumentValues, context, invocation) {
  return mergeAbstractValues(...[...value.callables]
    .map((descriptor) => callableReturnValue(descriptor, argumentValues, context, invocation)));
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

function expressionAbstractValue(node, context) {
  if (!node) return emptyAbstractValue();
  if (isRawPropertyAccess(node)) return rawAbstractValue();
  if (ts.isIdentifier(node)) {
    const binding = context.model.resolve(node);
    if (!binding) return untrackedCallableAbstractValue();
    const declaredCallable = callableDeclarationForBinding(binding);
    const resolvedValue = context.environment.has(binding)
      ? context.environment.get(binding)
      : context.bindingValues.get(binding);
    return mergeAbstractValues(
      resolvedValue,
      binding.errorSource === true ? rawAbstractValue() : null,
      bindingMayBeUntrackedCallable(binding, resolvedValue)
        ? untrackedCallableAbstractValue()
        : null,
      declaredCallable ? callableAbstractValue(declaredCallable, context) : null,
    );
  }
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    return expressionAbstractValue(node.expression, context);
  }
  if (ts.isCallExpression(node)) {
    if (ts.isIdentifier(node.expression) && context.model.isApprovedSanitizer(node.expression)) {
      return emptyAbstractValue();
    }
    const callee = expressionAbstractValue(node.expression, context);
    const argumentValues = node.arguments.map((argument) => expressionAbstractValue(argument, context));
    const returned = invokeTrackedCallables(callee, argumentValues, context, node);
    const untrackedArgumentsContainRaw = callee.mayUntrackedCallable
      && argumentValues.some((argument) => argument.displayRaw);
    return mergeAbstractValues(
      returned,
      callee.displayRaw || untrackedArgumentsContainRaw ? rawAbstractValue() : null,
      callee.mayUntrackedCallable ? untrackedCallableAbstractValue() : null,
    );
  }
  if (ts.isNewExpression(node)) {
    const argumentsContainRaw = node.arguments?.some((argument) => (
      expressionAbstractValue(argument, context).displayRaw
    )) ?? false;
    return argumentsContainRaw ? rawAbstractValue() : emptyAbstractValue();
  }
  const transparent = transparentExpression(node);
  if (transparent) {
    return expressionAbstractValue(transparent, context);
  }
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    return callableAbstractValue(node, context);
  }
  if (ts.isObjectLiteralExpression(node)) {
    return mergeAbstractValues(...node.properties.map((property) => {
      if (ts.isPropertyAssignment(property)) {
        return expressionAbstractValue(property.initializer, context);
      }
      if (ts.isShorthandPropertyAssignment(property)) {
        return expressionAbstractValue(property.name, context);
      }
      if (ts.isSpreadAssignment(property)) {
        return expressionAbstractValue(property.expression, context);
      }
      if (ts.isMethodDeclaration(property)) return callableAbstractValue(property, context);
      return emptyAbstractValue();
    }));
  }
  if (ts.isArrayLiteralExpression(node)) {
    return mergeAbstractValues(...node.elements.map((element) => (
      expressionAbstractValue(element, context)
    )));
  }
  if (ts.isTemplateExpression(node)) {
    const containsRaw = node.templateSpans.some((span) => (
      expressionAbstractValue(span.expression, context).displayRaw
    ));
    return containsRaw ? rawAbstractValue() : emptyAbstractValue();
  }
  if (ts.isConditionalExpression(node)) {
    return mergeAbstractValues(
      expressionAbstractValue(node.whenTrue, context),
      expressionAbstractValue(node.whenFalse, context),
    );
  }
  if (ts.isBinaryExpression(node)) {
    const operator = node.operatorToken.kind;
    if (operator === ts.SyntaxKind.CommaToken || operator === ts.SyntaxKind.EqualsToken) {
      return expressionAbstractValue(node.right, context);
    }
    if (operator === ts.SyntaxKind.AmpersandAmpersandToken) {
      return expressionAbstractValue(node.right, context);
    }
    if (
      operator === ts.SyntaxKind.BarBarToken
      || operator === ts.SyntaxKind.QuestionQuestionToken
      || operator === ts.SyntaxKind.AmpersandAmpersandEqualsToken
      || operator === ts.SyntaxKind.BarBarEqualsToken
      || operator === ts.SyntaxKind.QuestionQuestionEqualsToken
    ) {
      return mergeAbstractValues(
        expressionAbstractValue(node.left, context),
        expressionAbstractValue(node.right, context),
      );
    }
    if (operator === ts.SyntaxKind.PlusToken || operator === ts.SyntaxKind.PlusEqualsToken) {
      const containsRaw = expressionAbstractValue(node.left, context).displayRaw
        || expressionAbstractValue(node.right, context).displayRaw;
      return containsRaw ? rawAbstractValue() : emptyAbstractValue();
    }
  }
  return emptyAbstractValue();
}

function rootEvaluationContext(bindingValues, model, analysis) {
  return {
    bindingValues,
    model,
    analysis,
    environment: new Map(),
    activeCallables: new Set(),
    origin: null,
  };
}

function expressionIsTainted(node, bindingValues, model, analysis) {
  return expressionAbstractValue(node, rootEvaluationContext(bindingValues, model, analysis)).displayRaw;
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

function abstractValueHasSignal(value) {
  return value.displayRaw || value.mayUntrackedCallable || value.callables.size > 0;
}

function propagateVariableDeclaration(declaration, context, add) {
  const initializerValue = expressionAbstractValue(declaration.initializer, context);
  if (ts.isIdentifier(declaration.name)) {
    add(context.model.resolve(declaration.name), initializerValue);
    return;
  }
  if (ts.isArrayBindingPattern(declaration.name)) {
    if (!abstractValueHasSignal(initializerValue)) return;
    for (const identifier of bindingIdentifiers(declaration.name)) {
      add(context.model.resolve(identifier), initializerValue);
    }
    return;
  }
  if (!ts.isObjectBindingPattern(declaration.name)) return;
  for (const element of declaration.name.elements) {
    const property = element.propertyName ?? element.name;
    const propertyText = ts.isIdentifier(property) || ts.isStringLiteralLike(property)
      ? property.text
      : "";
    const elementValue = RAW_PROPERTIES.has(propertyText)
      ? rawAbstractValue()
      : initializerValue;
    if (!abstractValueHasSignal(elementValue)) continue;
    for (const identifier of bindingIdentifiers(element.name)) {
      add(context.model.resolve(identifier), elementValue);
    }
  }
}

function propagateCallableEnvironment(callable, environment, context) {
  if (!callable.body || !ts.isBlock(callable.body)) return environment;
  let changed = true;
  while (changed) {
    changed = false;
    const revision = context.analysis.revision;
    const localContext = { ...context, environment };
    const add = (binding, value) => {
      if (!binding || !abstractValueHasSignal(value)) return;
      if (mergeEnvironmentValue(environment, binding, value)) changed = true;
    };
    const visit = (node) => {
      if (node !== callable.body && isTrackedCallable(node)) return;
      if (ts.isVariableDeclaration(node)) {
        propagateVariableDeclaration(node, localContext, add);
      }
      if (
        ts.isBinaryExpression(node)
        && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      ) {
        const rightValue = expressionAbstractValue(node.right, localContext);
        if (abstractValueHasSignal(rightValue)) {
          for (const target of assignmentTargetIdentifiers(node.left)) {
            add(context.model.resolve(target), rightValue);
          }
        }
      }
      node.forEachChild(visit);
    };
    visit(callable.body);
    if (context.analysis.revision !== revision) changed = true;
  }
  return environment;
}

function collectBindingValues(sourceFile, stateSetters, model, analysis) {
  const bindingValues = new Map();
  let changed = true;
  while (changed) {
    changed = false;
    const revision = analysis.revision;
    const context = rootEvaluationContext(bindingValues, model, analysis);
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
        propagateVariableDeclaration(node, context, add);
      }
      if (
        ts.isBinaryExpression(node)
        && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      ) {
        const rightValue = expressionAbstractValue(node.right, context);
        if (abstractValueHasSignal(rightValue)) {
          for (const target of assignmentTargetIdentifiers(node.left)) {
            add(model.resolve(target), rightValue);
          }
        }
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const state = stateSetters.get(model.resolve(node.expression));
        if (state && node.arguments[0]) {
          const argumentValue = expressionAbstractValue(node.arguments[0], context);
          const stateValue = argumentValue.callables.size > 0
            ? mergeAbstractValues(
              invokeTrackedCallables(
                argumentValue,
                [bindingValues.get(state) ?? emptyAbstractValue()],
                context,
                node,
              ),
              argumentValue.displayRaw ? rawAbstractValue() : null,
            )
            : argumentValue;
          if (abstractValueHasSignal(stateValue)) add(state, stateValue);
        }
      }
      node.forEachChild(visit);
    };
    visit(sourceFile);
    if (analysis.revision !== revision) changed = true;
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

function findingNodes(sourceFile, bindingValues, model, analysis) {
  const findings = [];
  const visit = (node) => {
    if (ts.isJsxExpression(node) && expressionIsTainted(node.expression, bindingValues, model, analysis)) {
      findings.push(node);
    } else if (
      ts.isCallExpression(node)
      && isDisplayCall(node)
      && node.arguments.some((argument) => expressionIsTainted(argument, bindingValues, model, analysis))
    ) {
      findings.push(node);
    } else if (
      ts.isNewExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === "Error"
      && node.arguments?.some((argument) => expressionIsTainted(argument, bindingValues, model, analysis))
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
    const analysis = createAbstractAnalysis();
    const stateSetters = collectStateSetters(sourceFile, model);
    const bindingValues = collectBindingValues(sourceFile, stateSetters, model, analysis);
    for (const node of findingNodes(sourceFile, bindingValues, model, analysis)) {
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

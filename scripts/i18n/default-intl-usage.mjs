import { readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";

function compareCodePoints(left, right) {
  const leftPoints = Array.from(left);
  const rightPoints = Array.from(right);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftPoints[index].codePointAt(0) - rightPoints[index].codePointAt(0);
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

function normalizedPath(path) {
  return path.replaceAll("\\", "/");
}

function sourceFiles(rootDir) {
  const srcDir = resolve(rootDir, "src");
  const files = [];
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && /\.(?:ts|tsx)$/u.test(entry.name)) files.push(path);
    }
  }
  walk(srcDir);
  return files.sort(compareCodePoints);
}

function unwrapExpression(node) {
  if (
    ts.isParenthesizedExpression(node)
    || ts.isAsExpression(node)
    || ts.isTypeAssertionExpression(node)
    || ts.isNonNullExpression(node)
  ) return unwrapExpression(node.expression);
  return node;
}

function staticMessageIds(node) {
  const expression = unwrapExpression(node);
  if (ts.isStringLiteralLike(expression)) return [expression.text];
  if (ts.isConditionalExpression(expression)) {
    const whenTrue = staticMessageIds(expression.whenTrue);
    const whenFalse = staticMessageIds(expression.whenFalse);
    if (whenTrue && whenFalse) return [...whenTrue, ...whenFalse];
  }
  return null;
}

function resolvesToDefaultIntl(importerPath, specifier, targetPath) {
  if (!specifier.startsWith(".")) return specifier.replace(/^@\//u, "src/").replace(/\.ts$/u, "") === "src/i18n/defaultIntl";
  const resolved = resolve(dirname(importerPath), specifier).replace(/\.ts$/u, "");
  return resolved === targetPath;
}

function defaultIntlImports(file, sourceFile, targetPath) {
  return sourceFile.statements.filter((statement) => (
    ts.isImportDeclaration(statement)
    && ts.isStringLiteral(statement.moduleSpecifier)
    && resolvesToDefaultIntl(file, statement.moduleSpecifier.text, targetPath)
  ));
}

function symbolAt(checker, node) {
  return checker.getSymbolAtLocation(node) ?? null;
}

function importedName(specifier) {
  return (specifier.propertyName ?? specifier.name).text;
}

function collectIntlBindings(file, sourceFile, targetPath, checker) {
  const imports = defaultIntlImports(file, sourceFile, targetPath);
  const factorySymbols = new Set();
  const intlObjectSymbols = new Set();
  const intlShapeSymbols = new Set();

  for (const statement of imports) {
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const specifier of bindings.elements) {
      const symbol = symbolAt(checker, specifier.name);
      if (!symbol) continue;
      if (importedName(specifier) === "withDefaultIntl") factorySymbols.add(symbol);
      if (importedName(specifier) === "defaultKoreanIntl") intlObjectSymbols.add(symbol);
    }
  }

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement)
      || !ts.isStringLiteral(statement.moduleSpecifier)
      || statement.moduleSpecifier.text !== "react-intl"
    ) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const specifier of bindings.elements) {
      if (importedName(specifier) !== "IntlShape") continue;
      const symbol = symbolAt(checker, specifier.name);
      if (symbol) intlShapeSymbols.add(symbol);
    }
  }

  return {
    isImporter: imports.length > 0,
    sourceFile,
    checker,
    factorySymbols,
    intlObjectSymbols,
    intlShapeSymbols,
  };
}

function symbolReferenceCount(symbol, context) {
  let count = 0;
  function visit(node) {
    if (ts.isIdentifier(node) && symbolAt(context.checker, node) === symbol) count += 1;
    ts.forEachChild(node, visit);
  }
  visit(context.sourceFile);
  return count;
}

function isConstDeclaration(declaration) {
  return ts.isVariableDeclarationList(declaration.parent)
    && (declaration.parent.flags & ts.NodeFlags.Const) !== 0;
}

function variableResolutionFromSymbol(symbol) {
  const declarations = symbol?.declarations?.filter(ts.isVariableDeclaration) ?? [];
  if (declarations.length !== 1) return { kind: "none" };
  const [declaration] = declarations;
  if (!declaration.initializer) return { kind: "unsupported" };
  return isConstDeclaration(declaration)
    ? { kind: "const", declaration, initializer: declaration.initializer, symbol }
    : { kind: "mutable", declaration, initializer: declaration.initializer, symbol };
}

function variableResolution(identifier, checker) {
  return variableResolutionFromSymbol(symbolAt(checker, identifier));
}

function typeIsIntlShape(typeNode, context) {
  if (!typeNode) return false;
  if (ts.isParenthesizedTypeNode(typeNode)) return typeIsIntlShape(typeNode.type, context);
  if (ts.isUnionTypeNode(typeNode)) return typeNode.types.some((type) => typeIsIntlShape(type, context));
  return ts.isTypeReferenceNode(typeNode)
    && ts.isIdentifier(typeNode.typeName)
    && context.intlShapeSymbols.has(symbolAt(context.checker, typeNode.typeName));
}

function symbolIsIntlShapeParameter(symbol, context) {
  const declarations = symbol?.declarations ?? [];
  return declarations.length === 1
    && ts.isParameter(declarations[0])
    && typeIsIntlShape(declarations[0].type, context);
}

function isFactoryCall(expression, context) {
  const value = unwrapExpression(expression);
  return ts.isCallExpression(value)
    && ts.isIdentifier(unwrapExpression(value.expression))
    && context.factorySymbols.has(symbolAt(context.checker, unwrapExpression(value.expression)));
}

function propertyNameText(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

function exactStringValue(expression, context, seenSymbols = new Set()) {
  const value = unwrapExpression(expression);
  if (ts.isStringLiteralLike(value)) return { kind: "resolved", value: value.text };
  if (!ts.isIdentifier(value)) return { kind: "unsupported" };

  const resolution = variableResolution(value, context.checker);
  if (resolution.kind !== "const" || seenSymbols.has(resolution.symbol)) return { kind: "unsupported" };
  seenSymbols.add(resolution.symbol);
  const result = exactStringValue(resolution.initializer, context, seenSymbols);
  seenSymbols.delete(resolution.symbol);
  return result;
}

function intlExpressionSource(expression, context, seenSymbols = new Set()) {
  const value = unwrapExpression(expression);
  if (isFactoryCall(value, context)) return { kind: "supported" };
  if (ts.isConditionalExpression(value)) {
    const whenTrue = intlExpressionSource(value.whenTrue, context, seenSymbols);
    const whenFalse = intlExpressionSource(value.whenFalse, context, seenSymbols);
    if (whenTrue.kind === "unrelated" && whenFalse.kind === "unrelated") return { kind: "unrelated" };
    return whenTrue.kind === "supported" && whenFalse.kind === "supported"
      ? { kind: "supported" }
      : { kind: "unsupported" };
  }
  if (!ts.isIdentifier(value)) return { kind: "unrelated" };

  const symbol = symbolAt(context.checker, value);
  if (!symbol || seenSymbols.has(symbol)) return { kind: "unrelated" };
  if (context.intlObjectSymbols.has(symbol) || symbolIsIntlShapeParameter(symbol, context)) {
    return { kind: "supported" };
  }

  const resolution = variableResolution(value, context.checker);
  if (resolution.kind !== "const" && resolution.kind !== "mutable") return { kind: "unrelated" };
  seenSymbols.add(symbol);
  const source = intlExpressionSource(resolution.initializer, context, seenSymbols);
  seenSymbols.delete(symbol);
  if (source.kind === "unrelated") return source;
  return resolution.kind === "const" && source.kind === "supported"
    ? source
    : { kind: "unsupported" };
}

function memberAccessName(expression, context) {
  const value = unwrapExpression(expression);
  if (ts.isPropertyAccessExpression(value)) return { kind: "resolved", value: value.name.text };
  if (ts.isElementAccessExpression(value) && value.argumentExpression) {
    return exactStringValue(value.argumentExpression, context);
  }
  return null;
}

function memberFormatSource(expression, context) {
  const value = unwrapExpression(expression);
  if (!ts.isPropertyAccessExpression(value) && !ts.isElementAccessExpression(value)) return null;

  const intlSource = intlExpressionSource(value.expression, context);
  if (intlSource.kind === "unrelated") return { kind: "unrelated" };
  const name = memberAccessName(value, context);
  if (!name || name.kind !== "resolved") return { kind: "unsupported" };
  if (name.value !== "formatMessage") return { kind: "unrelated" };
  return intlSource.kind === "supported"
    ? { kind: "supported" }
    : { kind: "unsupported" };
}

function bindingElementPropertyName(element, context) {
  const propertyName = element.propertyName ?? element.name;
  if (ts.isComputedPropertyName(propertyName)) return exactStringValue(propertyName.expression, context);
  const value = propertyNameText(propertyName);
  return value === null ? { kind: "unsupported" } : { kind: "resolved", value };
}

function bindingElementFormatSource(identifier, context) {
  const symbol = symbolAt(context.checker, identifier);
  const declarations = symbol?.declarations ?? [];
  if (declarations.length !== 1 || !ts.isBindingElement(declarations[0])) return null;
  const element = declarations[0];
  if (!ts.isObjectBindingPattern(element.parent)) return null;
  const declaration = element.parent.parent;
  if (!ts.isVariableDeclaration(declaration) || !declaration.initializer) return null;
  const intlSource = intlExpressionSource(declaration.initializer, context);
  if (intlSource.kind === "unrelated") return { kind: "unrelated" };
  const propertyName = bindingElementPropertyName(element, context);
  if (propertyName.kind !== "resolved") return { kind: "unsupported" };
  if (propertyName.value !== "formatMessage") return { kind: "unrelated" };
  const supported = intlSource.kind === "supported"
    && isConstDeclaration(declaration)
    && !element.dotDotDotToken
    && !element.initializer
    && ts.isIdentifier(element.name);
  return { kind: supported ? "supported" : "unsupported" };
}

function helperCallSource(call, context, seenSymbols = new Set()) {
  const callee = unwrapExpression(call.expression);
  if (!ts.isPropertyAccessExpression(callee) && !ts.isElementAccessExpression(callee)) {
    return { kind: "unrelated" };
  }
  const target = formatReferenceSource(callee.expression, context, seenSymbols);
  if (target.kind === "unrelated") return target;
  const helperName = memberAccessName(callee, context);
  if (helperName?.kind === "resolved" && !["call", "apply", "bind"].includes(helperName.value)) {
    return { kind: "unrelated" };
  }
  return { kind: "unsupported" };
}

function identifierFormatSource(identifier, context, seenSymbols = new Set()) {
  const binding = bindingElementFormatSource(identifier, context);
  if (binding) return binding;

  const resolution = variableResolution(identifier, context.checker);
  if (resolution.kind !== "const" && resolution.kind !== "mutable") return { kind: "unrelated" };
  if (seenSymbols.has(resolution.symbol)) return { kind: "unrelated" };
  seenSymbols.add(resolution.symbol);
  const source = formatReferenceSource(resolution.initializer, context, seenSymbols);
  seenSymbols.delete(resolution.symbol);
  if (source.kind === "unrelated") return source;
  if (resolution.kind === "mutable") return { kind: "unsupported" };
  return ts.isIdentifier(unwrapExpression(resolution.initializer))
    ? source
    : { kind: "unsupported" };
}

function formatReferenceSource(expression, context, seenSymbols = new Set()) {
  const value = unwrapExpression(expression);
  const member = memberFormatSource(value, context);
  if (member) return member;
  if (ts.isIdentifier(value)) return identifierFormatSource(value, context, seenSymbols);
  if (ts.isCallExpression(value)) return helperCallSource(value, context, seenSymbols);
  return { kind: "unrelated" };
}

function classifyFormatMessageCall(call, context) {
  const callee = unwrapExpression(call.expression);
  const reference = formatReferenceSource(callee, context);
  if (reference.kind !== "unrelated") return reference;
  return helperCallSource(call, context);
}

function constInitializerForAlias(identifier, context, seenSymbols) {
  const resolution = variableResolution(identifier, context.checker);
  if (resolution.kind === "none") return { kind: "dynamic", expression: identifier };
  if (resolution.kind !== "const" || seenSymbols.has(resolution.symbol)) return { kind: "unsupported" };
  seenSymbols.add(resolution.symbol);
  return { kind: "const", expression: resolution.initializer, symbol: resolution.symbol };
}

function resolveIdExpression(expression, context, seenSymbols = new Set()) {
  const value = unwrapExpression(expression);
  if (!ts.isIdentifier(value)) return { kind: "resolved", expression: value };
  const alias = constInitializerForAlias(value, context, seenSymbols);
  if (alias.kind === "dynamic") return { kind: "resolved", expression: value };
  if (alias.kind === "unsupported") return alias;
  const result = resolveIdExpression(alias.expression, context, seenSymbols);
  seenSymbols.delete(alias.symbol);
  return result;
}

function resolveDescriptor(expression, context, seenSymbols = new Set()) {
  let value = unwrapExpression(expression);
  if (ts.isIdentifier(value)) {
    const alias = constInitializerForAlias(value, context, seenSymbols);
    if (alias.kind !== "const") return { kind: "unsupported" };
    if (symbolReferenceCount(alias.symbol, context) !== 2) return { kind: "unsupported" };
    value = unwrapExpression(alias.expression);
    const result = resolveDescriptor(value, context, seenSymbols);
    seenSymbols.delete(alias.symbol);
    return result;
  }
  if (!ts.isObjectLiteralExpression(value)) return { kind: "unsupported" };
  if (value.properties.some((property) => (
    ts.isSpreadAssignment(property)
    || ("name" in property && property.name && ts.isComputedPropertyName(property.name))
  ))) return { kind: "unsupported" };

  const idProperties = value.properties.filter((property) => (
    (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property))
    && propertyNameText(property.name) === "id"
  ));
  if (idProperties.length !== 1) return { kind: "unsupported" };
  const [idProperty] = idProperties;
  if (ts.isPropertyAssignment(idProperty)) {
    return resolveIdExpression(idProperty.initializer, context);
  }
  const valueSymbol = context.checker.getShorthandAssignmentValueSymbol(idProperty);
  const resolution = variableResolutionFromSymbol(valueSymbol);
  if (resolution.kind !== "const" || seenSymbols.has(resolution.symbol)) return { kind: "unsupported" };
  seenSymbols.add(resolution.symbol);
  const result = resolveIdExpression(resolution.initializer, context, seenSymbols);
  seenSymbols.delete(resolution.symbol);
  return result;
}

function compactNodeText(node, sourceFile) {
  return node.getText(sourceFile).replace(/\s+/gu, " ").trim();
}

function outerWrappedExpression(node) {
  let current = node;
  while (
    current.parent
    && (
      ts.isParenthesizedExpression(current.parent)
      || ts.isAsExpression(current.parent)
      || ts.isTypeAssertionExpression(current.parent)
      || ts.isNonNullExpression(current.parent)
    )
    && current.parent.expression === current
  ) {
    current = current.parent;
  }
  return current;
}

function isDeclarationIdentifier(identifier) {
  const parent = identifier.parent;
  return (
    (ts.isVariableDeclaration(parent) && parent.name === identifier)
    || (ts.isBindingElement(parent) && parent.name === identifier)
    || (ts.isParameter(parent) && parent.name === identifier)
    || (ts.isFunctionDeclaration(parent) && parent.name === identifier)
    || (ts.isFunctionExpression(parent) && parent.name === identifier)
    || (ts.isClassDeclaration(parent) && parent.name === identifier)
    || (ts.isClassExpression(parent) && parent.name === identifier)
    || ts.isImportSpecifier(parent)
    || ts.isImportClause(parent)
    || ts.isNamespaceImport(parent)
    || ts.isExportSpecifier(parent)
  );
}

function isHandledFormatReferenceUse(node, context) {
  if (ts.isIdentifier(node) && isDeclarationIdentifier(node)) return true;
  const expression = outerWrappedExpression(node);
  const parent = expression.parent;
  if (!parent) return false;

  if (ts.isCallExpression(parent) && parent.expression === expression) return true;

  if (
    (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent))
    && parent.expression === expression
    && ts.isCallExpression(parent.parent)
    && parent.parent.expression === parent
  ) {
    const helperName = memberAccessName(parent, context);
    if (helperName?.kind !== "resolved" || ["call", "apply", "bind"].includes(helperName.value)) {
      return true;
    }
  }

  if (
    ts.isIdentifier(node)
    && ts.isVariableDeclaration(parent)
    && parent.initializer === expression
    && isConstDeclaration(parent)
  ) {
    return true;
  }

  return false;
}

function isFormatReferenceCandidate(node) {
  return ts.isIdentifier(node) || ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node);
}

function messageIdExpressions(sourceFile, context) {
  const expressions = [];
  const unsupportedCalls = [];
  function visit(node) {
    if (ts.isCallExpression(node)) {
      const classification = classifyFormatMessageCall(node, context);
      if (classification.kind === "unsupported") {
        unsupportedCalls.push(compactNodeText(node, sourceFile));
      } else if (classification.kind === "supported") {
        const descriptor = node.arguments[0];
        const resolved = descriptor ? resolveDescriptor(descriptor, context) : { kind: "unsupported" };
        if (resolved.kind === "resolved") expressions.push(resolved.expression);
        else unsupportedCalls.push(compactNodeText(node, sourceFile));
      }
    }
    if (isFormatReferenceCandidate(node) && !isHandledFormatReferenceUse(node, context)) {
      const reference = formatReferenceSource(node, context);
      if (reference.kind !== "unrelated") {
        unsupportedCalls.push(compactNodeText(outerWrappedExpression(node), sourceFile));
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return { expressions, unsupportedCalls };
}

function dynamicUsageKey(importer, pattern) {
  return `${importer}\u0000${pattern}`;
}

export function auditDefaultIntlUsage({ rootDir, fallbackIds, dynamicUsages = [] } = {}) {
  if (!rootDir) throw new Error("rootDir가 필요합니다.");
  const targetPath = resolve(rootDir, "src", "i18n", "defaultIntl");
  const fallbackSet = fallbackIds ? new Set(fallbackIds) : null;
  const violations = [];
  const dynamicLookup = new Map();
  const consumedDynamicIndexes = new Set();

  dynamicUsages.forEach((usage, index) => {
    if (
      !usage
      || typeof usage.importer !== "string"
      || typeof usage.pattern !== "string"
      || !Array.isArray(usage.ids)
      || usage.ids.length === 0
      || typeof usage.reason !== "string"
      || !usage.reason.trim()
    ) {
      violations.push(`invalid_dynamic_usage:${index}`);
      return;
    }
    const key = dynamicUsageKey(usage.importer, usage.pattern);
    if (dynamicLookup.has(key)) violations.push(`duplicate_dynamic_usage:${usage.importer}:${usage.pattern}`);
    else dynamicLookup.set(key, { usage, index });
  });

  const files = sourceFiles(rootDir);
  const program = ts.createProgram({
    rootNames: files,
    options: {
      allowImportingTsExtensions: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.Latest,
    },
  });
  const checker = program.getTypeChecker();
  const importerRecords = [];
  for (const file of files) {
    const importer = normalizedPath(relative(rootDir, file));
    const sourceFile = program.getSourceFile(file);
    if (!sourceFile) continue;
    const context = collectIntlBindings(file, sourceFile, targetPath, checker);
    if (!context.isImporter) continue;
    const usage = messageIdExpressions(sourceFile, context);
    importerRecords.push({ importer, sourceFile, ...usage });
  }

  const discoveredIds = new Set();
  for (const { importer, sourceFile, expressions, unsupportedCalls } of importerRecords) {
    for (const call of unsupportedCalls) {
      violations.push(`unsupported_format_message:${importer}:${call}`);
    }
    for (const expression of expressions) {
      const staticIds = staticMessageIds(expression);
      if (staticIds) {
        for (const id of staticIds) {
          discoveredIds.add(id);
          if (fallbackSet && !fallbackSet.has(id)) violations.push(`missing_fallback:${importer}:${id}`);
        }
        continue;
      }

      const pattern = expression.getText(sourceFile);
      const matched = dynamicLookup.get(dynamicUsageKey(importer, pattern));
      if (!matched) {
        violations.push(`unclassified_dynamic_id:${importer}:${pattern}`);
        continue;
      }
      consumedDynamicIndexes.add(matched.index);
      for (const id of matched.usage.ids) {
        discoveredIds.add(id);
        if (fallbackSet && !fallbackSet.has(id)) violations.push(`missing_fallback:${importer}:${id}`);
      }
    }
  }

  dynamicUsages.forEach((usage, index) => {
    if (!consumedDynamicIndexes.has(index)) violations.push(`stale_dynamic_usage:${usage.importer}:${usage.pattern}`);
  });

  return {
    importers: importerRecords.map(({ importer }) => importer).sort(compareCodePoints),
    messageIds: [...discoveredIds].sort(compareCodePoints),
    dynamicUsageEntries: dynamicUsages.length,
    consumedDynamicUsages: consumedDynamicIndexes.size,
    violations: [...new Set(violations)].sort(compareCodePoints),
  };
}

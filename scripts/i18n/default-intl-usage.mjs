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
  const namespaceSymbols = new Set();
  const intlShapeSymbols = new Set();
  const canonicalIntlShapeSymbols = new Set();
  const rootViolationTexts = [];

  for (const statement of imports) {
    if (!statement.importClause) {
      rootViolationTexts.push(statement.getText(sourceFile));
      continue;
    }
    if (statement.importClause.name) {
      rootViolationTexts.push(statement.getText(sourceFile));
    }
    const bindings = statement.importClause?.namedBindings;
    if (!bindings) continue;
    if (ts.isNamespaceImport(bindings)) {
      const symbol = symbolAt(checker, bindings.name);
      if (symbol) namespaceSymbols.add(symbol);
      continue;
    }
    for (const specifier of bindings.elements) {
      const symbol = symbolAt(checker, specifier.name);
      if (!symbol) continue;
      const name = importedName(specifier);
      if (name === "withDefaultIntl") factorySymbols.add(symbol);
      else if (name === "defaultKoreanIntl") intlObjectSymbols.add(symbol);
      else rootViolationTexts.push(specifier.getText(sourceFile));
    }
  }

  for (const statement of sourceFile.statements) {
    if (
      !ts.isExportDeclaration(statement)
      || !statement.moduleSpecifier
      || !ts.isStringLiteral(statement.moduleSpecifier)
      || !resolvesToDefaultIntl(file, statement.moduleSpecifier.text, targetPath)
    ) continue;
    rootViolationTexts.push(statement.getText(sourceFile));
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
      if (!symbol) continue;
      intlShapeSymbols.add(symbol);
      if ((symbol.flags & ts.SymbolFlags.Alias) !== 0) {
        const canonical = checker.getAliasedSymbol(symbol);
        if (canonical) canonicalIntlShapeSymbols.add(canonical);
      }
    }
  }

  const context = {
    isImporter: imports.length > 0 || rootViolationTexts.length > 0,
    targetPath,
    sourceFile,
    checker,
    factorySymbols,
    intlObjectSymbols,
    namespaceSymbols,
    intlShapeSymbols,
    canonicalIntlShapeSymbols,
    rootViolationTexts,
    writtenSymbols: new Set(),
  };
  context.writtenSymbols = collectWrittenSymbols(sourceFile, checker);
  return context;
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

function resolvedAliasSymbol(symbol, checker) {
  if (!symbol || (symbol.flags & ts.SymbolFlags.Alias) === 0) return symbol ?? null;
  try {
    return checker.getAliasedSymbol(symbol) ?? null;
  } catch {
    return null;
  }
}

function getIntlShapeType(context) {
  if (Object.prototype.hasOwnProperty.call(context, "intlShapeType")) return context.intlShapeType;
  for (const symbol of context.intlShapeSymbols) {
    try {
      context.intlShapeType = context.checker.getDeclaredTypeOfSymbol(symbol);
      return context.intlShapeType;
    } catch {
      continue;
    }
  }
  context.intlShapeType = null;
  return null;
}

function typeIsIntlShape(typeNode, context, seenSymbols = new Set()) {
  if (!typeNode) return false;
  if (ts.isParenthesizedTypeNode(typeNode)) return typeIsIntlShape(typeNode.type, context, seenSymbols);
  if (ts.isUnionTypeNode(typeNode) || ts.isIntersectionTypeNode(typeNode)) {
    return typeNode.types.some((type) => typeIsIntlShape(type, context, seenSymbols));
  }
  if (!ts.isTypeReferenceNode(typeNode)) return false;

  const symbol = symbolAt(context.checker, typeNode.typeName);
  if (!symbol || seenSymbols.has(symbol)) return false;
  if (context.intlShapeSymbols.has(symbol)) return true;
  const canonical = resolvedAliasSymbol(symbol, context.checker);
  if (canonical && context.canonicalIntlShapeSymbols.has(canonical)) return true;

  seenSymbols.add(symbol);
  const result = (symbol.declarations ?? []).some((declaration) => (
    ts.isTypeAliasDeclaration(declaration)
    && typeIsIntlShape(declaration.type, context, seenSymbols)
  ));
  seenSymbols.delete(symbol);
  return result;
}

function typeIsIntlShapeFromType(type, context, seenTypes = new Set()) {
  if (!type || seenTypes.has(type)) return false;
  if ((type.flags & ts.TypeFlags.Any) !== 0 || (type.flags & ts.TypeFlags.Unknown) !== 0) return false;

  seenTypes.add(type);
  let result = false;
  const shapeType = getIntlShapeType(context);
  if (shapeType) {
    try {
      result = context.checker.isTypeAssignableTo(type, shapeType);
    } catch {
      result = false;
    }
  }
  seenTypes.delete(type);
  return result;
}

function addWrittenTargetSymbols(target, checker, symbols) {
  const value = unwrapExpression(target);
  if (ts.isIdentifier(value)) {
    const symbol = symbolAt(checker, value);
    if (symbol) symbols.add(symbol);
    return;
  }
  if (ts.isObjectLiteralExpression(value)) {
    for (const property of value.properties) {
      if (ts.isPropertyAssignment(property)) addWrittenTargetSymbols(property.initializer, checker, symbols);
      else if (ts.isShorthandPropertyAssignment(property)) addWrittenTargetSymbols(property.name, checker, symbols);
      else if (ts.isSpreadAssignment(property)) addWrittenTargetSymbols(property.expression, checker, symbols);
    }
    return;
  }
  if (ts.isArrayLiteralExpression(value)) {
    for (const element of value.elements) {
      if (!ts.isOmittedExpression(element)) addWrittenTargetSymbols(element, checker, symbols);
    }
  }
}

function collectWrittenSymbols(sourceFile, checker) {
  const symbols = new Set();
  function visit(node) {
    if (
      ts.isBinaryExpression(node)
      && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
      && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      addWrittenTargetSymbols(node.left, checker, symbols);
    }
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
      && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)
    ) {
      addWrittenTargetSymbols(node.operand, checker, symbols);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return symbols;
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

function relatedProvenance(provenance) {
  return !["unrelated", "cycle"].includes(provenance.kind);
}

function mergeConditionalProvenance(left, right) {
  if (!relatedProvenance(left) && !relatedProvenance(right)) {
    return left.kind === "cycle" || right.kind === "cycle" ? { kind: "cycle" } : { kind: "unrelated" };
  }
  if (left.kind === right.kind && !["unsupported", "namespace", "factory"].includes(left.kind)) return left;
  return { kind: "unsupported" };
}

function memberAccessName(expression, context) {
  const value = unwrapExpression(expression);
  if (ts.isPropertyAccessExpression(value)) return { kind: "resolved", value: value.name.text };
  if (ts.isElementAccessExpression(value) && value.argumentExpression) {
    return exactStringValue(value.argumentExpression, context);
  }
  return null;
}

function bindingElementPropertyName(element, context) {
  const propertyName = element.propertyName ?? element.name;
  if (ts.isComputedPropertyName(propertyName)) return exactStringValue(propertyName.expression, context);
  const value = propertyNameText(propertyName);
  return value === null ? { kind: "unsupported" } : { kind: "resolved", value };
}

function parameterProvenance(declaration, context, seenSymbols) {
  const typedIntl = typeIsIntlShape(declaration.type, context);
  if (!declaration.initializer) return typedIntl ? { kind: "intl" } : { kind: "unrelated" };
  const initialized = expressionProvenance(declaration.initializer, context, seenSymbols);
  if (initialized.kind === "unsupported") return initialized;
  if (initialized.kind === "intl") return initialized;
  if (relatedProvenance(initialized)) return { kind: "unsupported" };
  return typedIntl ? { kind: "intl" } : { kind: "unrelated" };
}

function bindingElementProvenance(identifier, context, seenSymbols) {
  const symbol = symbolAt(context.checker, identifier);
  const declarations = symbol?.declarations ?? [];
  if (declarations.length !== 1 || !ts.isBindingElement(declarations[0])) return null;
  const element = declarations[0];
  if (!ts.isObjectBindingPattern(element.parent)) return null;
  const owner = element.parent.parent;
  let intlSource = { kind: "unrelated" };
  let immutable = false;
  if (ts.isVariableDeclaration(owner)) {
    if (!owner.initializer) return { kind: "unrelated" };
    intlSource = expressionProvenance(owner.initializer, context, seenSymbols);
    immutable = isConstDeclaration(owner);
  } else if (ts.isParameter(owner)) {
    intlSource = parameterProvenance(owner, context, seenSymbols);
    immutable = true;
  } else {
    return { kind: "unrelated" };
  }

  if (!relatedProvenance(intlSource)) return intlSource;
  if (intlSource.kind !== "intl") return { kind: "unsupported" };
  const propertyName = bindingElementPropertyName(element, context);
  if (propertyName.kind !== "resolved") return { kind: "unsupported" };
  if (propertyName.value !== "formatMessage") return { kind: "unsupported" };
  const supported = immutable
    && !element.dotDotDotToken
    && !element.initializer
    && ts.isIdentifier(element.name);
  if (!supported || (symbol && context.writtenSymbols.has(symbol))) return { kind: "unsupported" };
  return { kind: "format" };
}

function safeFormatAliasInitializer(expression) {
  const value = unwrapExpression(expression);
  if (ts.isIdentifier(value)) return true;
  if (ts.isConditionalExpression(value)) {
    return safeFormatAliasInitializer(value.whenTrue) && safeFormatAliasInitializer(value.whenFalse);
  }
  return false;
}

function getCallForwardDeclaration(call, context) {
  const signature = context.checker.getResolvedSignature(call);
  if (!signature || !ts.isFunctionLike(signature.declaration)) return null;
  let declaration = signature.declaration;
  if (!declaration.body) {
    const symbol = context.checker.getSymbolAtLocation(call.expression);
    const implementations = (symbol?.declarations ?? []).filter((candidate) => (
      ts.isFunctionLike(candidate) && Boolean(candidate.body)
    ));
    if (implementations.length !== 1) return null;
    if (implementations[0] === declaration) return null;
    declaration = implementations[0];
  }
  return declaration;
}

function callForwardsToIntl(call, context) {
  const signature = context.checker.getResolvedSignature(call);
  if (!signature) return false;
  const declaration = getCallForwardDeclaration(call, context);
  if (!declaration) return false;
  const declarationSource = declaration.getSourceFile();
  const auditedTarget = declarationSource === context.sourceFile
    || defaultIntlImports(declarationSource.fileName, declarationSource, context.targetPath).length > 0;
  if (!auditedTarget) return false;
  const returnType = context.checker.getReturnTypeOfSignature(signature);
  if (!typeIsIntlShapeFromType(returnType, context)) return false;

  if (call.arguments.length === 0) return false;
  const allowed = call.arguments.some((_, argumentIndex) => (
    callAllowsIntlForward(call, argumentIndex, context)
  ));
  return allowed;
}

function callMayReturnIntl(call, context) {
  const signature = context.checker.getResolvedSignature(call);
  if (!signature) return false;
  const declaration = getCallForwardDeclaration(call, context);
  if (!declaration) return false;
  const declarationSource = declaration.getSourceFile();
  const auditedTarget = declarationSource === context.sourceFile
    || defaultIntlImports(declarationSource.fileName, declarationSource, context.targetPath).length > 0;
  if (!auditedTarget) return false;
  const returnType = context.checker.getReturnTypeOfSignature(signature);
  return typeIsIntlShapeFromType(returnType, context);
}

function identifierProvenance(identifier, context, seenSymbols = new Set()) {
  let symbol = symbolAt(context.checker, identifier);
  if (ts.isExportSpecifier(identifier.parent)) {
    symbol = context.checker.getExportSpecifierLocalTargetSymbol(identifier.parent) ?? symbol;
  }
  if (!symbol) return { kind: "unrelated" };
  if (context.factorySymbols.has(symbol)) return { kind: "factory" };
  if (context.intlObjectSymbols.has(symbol)) return { kind: "intl" };
  if (context.namespaceSymbols.has(symbol)) return { kind: "namespace" };
  if (seenSymbols.has(symbol)) return { kind: "cycle" };

  const binding = bindingElementProvenance(identifier, context, seenSymbols);
  if (binding) return binding;

  const declarations = symbol.declarations ?? [];
  if (declarations.length === 1 && ts.isParameter(declarations[0])) {
    if (context.writtenSymbols.has(symbol)) return { kind: "unsupported" };
    seenSymbols.add(symbol);
    const result = parameterProvenance(declarations[0], context, seenSymbols);
    seenSymbols.delete(symbol);
    return result;
  }

  const resolution = variableResolutionFromSymbol(symbol);
  if (resolution.kind === "none" || !resolution.initializer) return { kind: "unrelated" };
  seenSymbols.add(resolution.symbol);
  const source = expressionProvenance(resolution.initializer, context, seenSymbols);
  seenSymbols.delete(resolution.symbol);
  if (!relatedProvenance(source)) return source;
  if (resolution.kind !== "const" || context.writtenSymbols.has(symbol)) return { kind: "unsupported" };
  if (source.kind === "factory" || source.kind === "namespace") return { kind: "unsupported" };
  if (source.kind === "format" && !safeFormatAliasInitializer(resolution.initializer)) {
    return { kind: "unsupported" };
  }
  return source;
}

function expressionProvenance(expression, context, seenSymbols = new Set()) {
  const value = unwrapExpression(expression);
  if (ts.isIdentifier(value)) return identifierProvenance(value, context, seenSymbols);
  if (ts.isConditionalExpression(value)) {
    return mergeConditionalProvenance(
      expressionProvenance(value.whenTrue, context, seenSymbols),
      expressionProvenance(value.whenFalse, context, seenSymbols),
    );
  }
  if (
    ts.isBinaryExpression(value)
    && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(value.operatorToken.kind)
  ) {
    return mergeConditionalProvenance(
      expressionProvenance(value.left, context, seenSymbols),
      expressionProvenance(value.right, context, seenSymbols),
    );
  }
  if (ts.isPropertyAccessExpression(value) || ts.isElementAccessExpression(value)) {
    const owner = expressionProvenance(value.expression, context, seenSymbols);
    if (!relatedProvenance(owner)) return owner;
    const member = memberAccessName(value, context);
    if (!member || member.kind !== "resolved") return { kind: "unsupported" };
    if (owner.kind === "namespace") {
      if (member.value === "withDefaultIntl") return { kind: "factory" };
      if (member.value === "defaultKoreanIntl") return { kind: "intl" };
      return { kind: "unsupported" };
    }
    if (owner.kind === "intl") {
      return member.value === "formatMessage" ? { kind: "format" } : { kind: "unsupported" };
    }
    return { kind: "unsupported" };
  }
  if (ts.isCallExpression(value)) {
    const callee = expressionProvenance(value.expression, context, seenSymbols);
    if (callee.kind === "factory") return { kind: "intl" };
    if (callee.kind === "format") return { kind: "unrelated" };
    if (relatedProvenance(callee)) return { kind: "unsupported" };
    if (callForwardsToIntl(value, context)) return { kind: "intl" };
    if (callMayReturnIntl(value, context)) return { kind: "unsupported" };
  }
  return { kind: "unrelated" };
}

function classifyFormatMessageCall(call, context) {
  const reference = expressionProvenance(call.expression, context);
  if (reference.kind === "format") return { kind: "supported" };
  if (reference.kind === "unsupported") return { kind: "unsupported" };
  return { kind: "unrelated" };
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
  );
}

function hasExportModifier(node) {
  return ts.canHaveModifiers(node)
    && (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

function variableDeclarationIsExported(declaration) {
  const statement = declaration.parent?.parent;
  return Boolean(statement && ts.isVariableStatement(statement) && hasExportModifier(statement));
}

function safeIntlBindingName(name, context) {
  if (ts.isIdentifier(name)) return true;
  if (!ts.isObjectBindingPattern(name) || name.elements.length === 0) return false;
  return name.elements.every((element) => (
    !element.dotDotDotToken
    && !element.initializer
    && ts.isIdentifier(element.name)
    && bindingElementPropertyName(element, context).kind === "resolved"
    && bindingElementPropertyName(element, context).value === "formatMessage"
  ));
}

function callAllowsIntlForward(call, argumentIndex, context) {
  const callee = expressionProvenance(call.expression, context);
  if (callee.kind === "factory") return true;

  const declaration = getCallForwardDeclaration(call, context);
  if (!declaration) return false;
  const declarationSource = declaration.getSourceFile();
  const auditedTarget = declarationSource === context.sourceFile
    || defaultIntlImports(declarationSource.fileName, declarationSource, context.targetPath).length > 0;
  if (!auditedTarget) return false;
  const parameters = declaration.parameters ?? [];
  const parameter = parameters[Math.min(argumentIndex, parameters.length - 1)];
  if (!parameter) return false;
  if (argumentIndex >= parameters.length && !parameter.dotDotDotToken) return false;
  return typeIsIntlShape(parameter.type, context);
}

function isRelatedComposition(parent, expression, context) {
  if (
    (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent))
    && parent.expression === expression
  ) return relatedProvenance(expressionProvenance(parent, context));
  if (
    ts.isConditionalExpression(parent)
    && (parent.whenTrue === expression || parent.whenFalse === expression)
  ) return relatedProvenance(expressionProvenance(parent, context));
  return ts.isBinaryExpression(parent)
    && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(parent.operatorToken.kind)
    && (parent.left === expression || parent.right === expression)
    && relatedProvenance(expressionProvenance(parent, context));
}

function relatedUseIsAllowed(node, provenance, context) {
  if (provenance.kind === "unsupported") return false;
  if (ts.isIdentifier(node) && isDeclarationIdentifier(node)) return true;
  const expression = outerWrappedExpression(node);
  const parent = expression.parent;
  if (!parent) return false;

  if (isRelatedComposition(parent, expression, context)) return true;

  if (ts.isCallExpression(parent)) {
    if (parent.expression === expression) {
      return provenance.kind === "factory" || provenance.kind === "format";
    }
    const argumentIndex = parent.arguments.indexOf(expression);
    return argumentIndex >= 0
      && provenance.kind === "intl"
      && callAllowsIntlForward(parent, argumentIndex, context);
  }

  if (ts.isVariableDeclaration(parent) && parent.initializer === expression) {
    if (!isConstDeclaration(parent) || variableDeclarationIsExported(parent)) return false;
    if (provenance.kind === "intl") return safeIntlBindingName(parent.name, context);
    return provenance.kind === "format" && safeFormatAliasInitializer(expression);
  }

  if (ts.isParameter(parent) && parent.initializer === expression) {
    return provenance.kind === "intl" && safeIntlBindingName(parent.name, context);
  }

  return false;
}

function isRelatedValueCandidate(node) {
  return ts.isIdentifier(node)
    || ts.isPropertyAccessExpression(node)
    || ts.isElementAccessExpression(node)
    || ts.isCallExpression(node)
    || ts.isConditionalExpression(node)
    || (
      ts.isBinaryExpression(node)
      && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(node.operatorToken.kind)
    );
}

function escapeReportNode(node) {
  let current = outerWrappedExpression(node);
  while (current.parent) {
    const parent = current.parent;
    if (
      ts.isArrayLiteralExpression(parent)
      || ts.isObjectLiteralExpression(parent)
      || ts.isPropertyAssignment(parent)
      || ts.isShorthandPropertyAssignment(parent)
      || ts.isSpreadAssignment(parent)
      || ts.isConditionalExpression(parent)
      || ts.isParenthesizedExpression(parent)
      || ts.isAsExpression(parent)
      || ts.isTypeAssertionExpression(parent)
      || ts.isNonNullExpression(parent)
    ) {
      current = parent;
      continue;
    }
    if (ts.isVariableDeclaration(parent) && parent.initializer === current) return parent;
    if (ts.isCallExpression(parent) && parent.arguments.includes(current)) return parent;
    if (ts.isBinaryExpression(parent)) return parent;
    if (ts.isExportSpecifier(parent)) return parent.parent.parent;
    if (ts.isReturnStatement(parent)) {
      let owner = parent.parent;
      while (owner && !ts.isFunctionLike(owner)) owner = owner.parent;
      return owner ?? parent;
    }
    break;
  }
  return current;
}

function messageIdExpressions(sourceFile, context) {
  const expressions = [];
  const unsupportedCalls = [...context.rootViolationTexts];
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
    if (isRelatedValueCandidate(node)) {
      const provenance = expressionProvenance(node, context);
      if (relatedProvenance(provenance) && !relatedUseIsAllowed(node, provenance, context)) {
        unsupportedCalls.push(compactNodeText(escapeReportNode(node), sourceFile));
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

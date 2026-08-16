import { readdirSync, readFileSync } from "node:fs";
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

function importsDefaultIntl(file, sourceFile, targetPath) {
  return sourceFile.statements.some((statement) => (
    ts.isImportDeclaration(statement)
    && ts.isStringLiteral(statement.moduleSpecifier)
    && resolvesToDefaultIntl(file, statement.moduleSpecifier.text, targetPath)
  ));
}

function messageIdExpressions(sourceFile) {
  const expressions = [];
  function visit(node) {
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === "formatMessage"
    ) {
      const descriptor = node.arguments[0];
      if (descriptor && ts.isObjectLiteralExpression(descriptor)) {
        const idProperty = descriptor.properties.find((property) => (
          ts.isPropertyAssignment(property)
          && ((ts.isIdentifier(property.name) && property.name.text === "id")
            || (ts.isStringLiteral(property.name) && property.name.text === "id"))
        ));
        if (idProperty) expressions.push(idProperty.initializer);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return expressions;
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

  const importerRecords = [];
  for (const file of sourceFiles(rootDir)) {
    const source = readFileSync(file, "utf8");
    const importer = normalizedPath(relative(rootDir, file));
    const sourceFile = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    if (!importsDefaultIntl(file, sourceFile, targetPath)) continue;
    importerRecords.push({ importer, sourceFile });
  }

  const discoveredIds = new Set();
  for (const { importer, sourceFile } of importerRecords) {
    for (const expression of messageIdExpressions(sourceFile)) {
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

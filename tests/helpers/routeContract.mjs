import assert from "node:assert/strict";
import ts from "typescript";

function propertyName(property) {
  if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) {
    return property.name.text;
  }
  return undefined;
}

function propertyInitializer(object, name) {
  for (const property of object.properties) {
    if (ts.isPropertyAssignment(property) && propertyName(property) === name) {
      return property.initializer;
    }
  }
  return undefined;
}

function jsxTagName(node) {
  if (ts.isJsxSelfClosingElement(node)) return node.tagName.getText();
  if (ts.isJsxElement(node)) return node.openingElement.tagName.getText();
  return undefined;
}

function jsxAttribute(node, name) {
  const attributes = ts.isJsxSelfClosingElement(node)
    ? node.attributes.properties
    : ts.isJsxElement(node)
      ? node.openingElement.attributes.properties
      : [];

  for (const attribute of attributes) {
    if (!ts.isJsxAttribute(attribute) || attribute.name.text !== name || !attribute.initializer) continue;
    if (ts.isStringLiteral(attribute.initializer)) return attribute.initializer.text;
    if (ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression) {
      return attribute.initializer.expression.getText();
    }
  }
  return undefined;
}

function findDescendant(node, predicate) {
  if (predicate(node)) return node;
  let match;
  node.forEachChild((child) => {
    if (!match) match = findDescendant(child, predicate);
  });
  return match;
}

function guardFromElement(element) {
  const guardNode = findDescendant(element, (node) => {
    const tag = jsxTagName(node);
    return tag === "RequireGuest"
      || tag === "RequireAuthenticated"
      || tag === "RequireRole"
      || tag === "RequireAnyRole";
  });
  if (!guardNode) return undefined;

  const tag = jsxTagName(guardNode);
  if (tag === "RequireGuest") return "guest";
  if (tag === "RequireAuthenticated") return "authenticated";
  if (tag === "RequireRole") return jsxAttribute(guardNode, "role");
  if (tag === "RequireAnyRole") {
    const roles = jsxAttribute(guardNode, "roles");
    if (roles === '["parent", "child"]') return "parent|child";
  }
  return undefined;
}

const ROUTE_NAMESPACE_IDENTIFIERS = new Set([
  "ONBOARDING_NAMESPACES",
  "PARENT_NAMESPACES",
  "CHILD_NAMESPACES",
  "BILLING_NAMESPACES",
  "REPORT_NAMESPACES",
  "PARENT_NOTIFICATION_NAMESPACES",
  "CHILD_NOTIFICATION_NAMESPACES",
  // 위치 탭은 위치·장소(notifications)와 프리미엄 안내(billing)를 함께 싣는다(2026-08-17).
  "PARENT_LOCATION_NAMESPACES",
  "SHARED_NAMESPACES",
]);

function routeComponentFromElement(element) {
  const routeElementCall = findDescendant(
    element,
    (node) => ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === "routeElement",
  );
  if (!routeElementCall) return undefined;

  assert.ok(
    routeElementCall.arguments.length === 1 || routeElementCall.arguments.length === 2,
    "routeElement 인자는 화면 JSX와 선택적 namespace만 허용합니다.",
  );
  if (routeElementCall.arguments.length === 2) {
    const namespace = routeElementCall.arguments[1];
    assert.ok(
      ts.isIdentifier(namespace) && ROUTE_NAMESPACE_IDENTIFIERS.has(namespace.text),
      "routeElement namespace 인자는 지원 목록의 식별자여야 합니다.",
    );
  }
  const component = routeElementCall.arguments[0];
  assert.ok(
    component && ts.isJsxSelfClosingElement(component) && ts.isIdentifier(component.tagName),
    "routeElement의 첫 번째 인자는 식별자 JSX 화면이어야 합니다.",
  );
  return component.tagName.text;
}

function stringValue(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    ? node.text
    : undefined;
}

function conditionAvailability(condition, whenTrue) {
  if (condition.getText() !== "TEACHER_MODE_ENABLED") return undefined;
  return whenTrue ? "teacher-enabled" : "teacher-disabled";
}

function parseRoutes(routerArray) {
  const routes = [];

  function visitExpression(expression, context) {
    if (ts.isParenthesizedExpression(expression)) {
      visitExpression(expression.expression, context);
      return;
    }
    if (ts.isArrayLiteralExpression(expression)) {
      for (const item of expression.elements) {
        if (ts.isSpreadElement(item)) visitExpression(item.expression, context);
        else visitExpression(item, context);
      }
      return;
    }
    if (ts.isConditionalExpression(expression)) {
      const enabled = conditionAvailability(expression.condition, true);
      const disabled = conditionAvailability(expression.condition, false);
      visitExpression(expression.whenTrue, {
        ...context,
        availability: enabled ?? context.availability,
      });
      visitExpression(expression.whenFalse, {
        ...context,
        availability: disabled ?? context.availability,
      });
      return;
    }
    if (!ts.isObjectLiteralExpression(expression)) return;

    const element = propertyInitializer(expression, "element");
    const path = propertyInitializer(expression, "path");
    const component = element ? routeComponentFromElement(element) : undefined;
    const ownGuard = element ? guardFromElement(element) : undefined;
    const nextContext = {
      ...context,
      guard: ownGuard ?? context.guard,
    };

    if (path && component) {
      routes.push({
        path: stringValue(path),
        component,
        guard: nextContext.guard,
        availability: nextContext.availability,
      });
    }

    const children = propertyInitializer(expression, "children");
    if (children) visitExpression(children, nextContext);
  }

  visitExpression(routerArray, { guard: "public", availability: "always" });
  return routes;
}

function parseLazyScreens(sourceFile) {
  const screens = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      const call = declaration.initializer;
      if (!ts.isCallExpression(call)
        || !ts.isIdentifier(call.expression)
        || call.expression.text !== "lazyScreen"
        || call.arguments.length !== 2) continue;

      const importCall = findDescendant(
        call.arguments[0],
        (node) => ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword,
      );
      const module = importCall?.arguments[0] ? stringValue(importCall.arguments[0]) : undefined;
      const namedExport = stringValue(call.arguments[1]);
      screens.push({ component: declaration.name.text, module, namedExport });
    }
  }
  return screens;
}

function parseStaticScreenImports(sourceFile) {
  return sourceFile.statements
    .filter(ts.isImportDeclaration)
    .map((statement) => stringValue(statement.moduleSpecifier))
    .filter((module) => module?.startsWith("@/screens/") && module !== "@/screens/Splash");
}

export function parseAppRouteContract(source) {
  const sourceFile = ts.createSourceFile(
    "App.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const routerDeclaration = sourceFile.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === "router");
  const routerCall = routerDeclaration?.initializer;
  assert.ok(
    routerCall && ts.isCallExpression(routerCall) && routerCall.expression.getText() === "createHashRouter",
    "createHashRouter 정본을 찾을 수 없습니다.",
  );
  const routerArray = routerCall.arguments[0];
  assert.ok(routerArray && ts.isArrayLiteralExpression(routerArray), "라우트 배열 정본을 찾을 수 없습니다.");

  return {
    lazyScreens: parseLazyScreens(sourceFile),
    routes: parseRoutes(routerArray),
    staticScreenImports: parseStaticScreenImports(sourceFile),
  };
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

export function assertAppRouteContract(source, expected) {
  const parsed = parseAppRouteContract(source);
  assert.equal(parsed.lazyScreens.length, 59, "지연 화면은 정확히 59개여야 합니다.");
  assert.equal(parsed.routes.length, 60, "지연 라우트는 정확히 60개여야 합니다.");
  assert.deepEqual(parsed.staticScreenImports, [], "Splash 외 화면의 정적 import를 허용하지 않습니다.");
  assert.deepEqual(parsed.lazyScreens, expected.lazyScreens, "지연 화면 모듈·named export 정본이 다릅니다.");
  assert.deepEqual(parsed.routes, expected.routes, "라우트 path·화면·guard 정본이 다릅니다.");
  assert.deepEqual(
    duplicateValues(parsed.lazyScreens.map(({ component }) => component)),
    [],
    "지연 화면 선언이 중복되었습니다.",
  );
  assert.deepEqual(
    duplicateValues(parsed.routes.map(({ path }) => path)),
    [],
    "라우트 path가 중복되었습니다.",
  );

  const routeCounts = new Map();
  for (const { component } of parsed.routes) {
    routeCounts.set(component, (routeCounts.get(component) ?? 0) + 1);
  }
  for (const { component } of parsed.lazyScreens) {
    assert.equal(
      routeCounts.get(component),
      component === "MemoChat" ? 2 : 1,
      `${component} 라우트 사용 횟수가 정본과 다릅니다.`,
    );
  }
  assert.deepEqual(
    [...routeCounts].filter(([component, count]) => count > 1 && component !== "MemoChat"),
    [],
    "MemoChat 외 화면의 라우트 중복 사용을 허용하지 않습니다.",
  );
}

/**
 * 사용자 노출 literal 게이트.
 *
 * 왜 필요한가: 10개 언어 릴리스에서 catalog 밖에 남은 원문 문구는 어떤 locale 을 골라도
 * 한국어로 새어 나온다. 화면을 눈으로 훑는 스윕은 이 결함을 놓친다(앞 화면이 이미 로드한
 * namespace 때문에 가려지고, 조건 분기 문구는 재현조차 어렵다).
 *
 * 판정 원리 — "글자를 세지 않고 자리를 본다":
 *  · 한글 문자 탐지나 `rg` 개수로 판정하지 않는다. TypeScript AST 로 **사용자에게 보이는 자리**
 *    (JSX text, 문구를 담는 JSX attribute, toast/dialog/validation sink)를 먼저 특정하고,
 *    그 자리에 도달하는 값이 message API 를 거치지 않은 원문 literal 인지 본다.
 *  · 값 흐름은 모듈 경계를 넘는다. `AI_BUDDY_VOICE_HINT_LINE`(transform) →
 *    `resolveAiBuddyFabBubbleLine`(transform) → `AiBuddyFab`(화면) 처럼 세 파일을 건너야
 *    실제 결함이 잡히기 때문이다. 단조(monotone) taint 를 fixpoint 로 수렴시킨다.
 *  · `intl.formatMessage(...)`·`<FormattedMessage>`·`localizeApiError(...)` 는 sanitizer 다.
 *
 * allowlist 는 `path`+`pattern`+`occurrences`+`reason` 을 모두 요구하고, 쓰이지 않는 항목은
 * 실패시킨다(stale 항목이 남으면 게이트가 조용히 헐거워진다).
 */
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import ts from "typescript";

/** allowlist 사유는 분류 접두어를 강제한다 — "왜 번역 대상이 아닌가"가 사유여야 한다. */
const ALLOWLIST_REASONS = /^(?:data|protocol|brand|bootstrap|accessibility|admin|legal|dev|universal|study):/;

/**
 * `exempt` = 번역 대상이 아니다(사용자 데이터·고유명·기계 계약).
 * `pending-migration` = **면제가 아니다.** 아직 catalog 로 옮기지 못한 실제 결함을 명시 기록해
 * 새 결함(회귀)과 구분한다. 이관을 마치면 항목을 지워야 하고, 남겨 두면 stale 로 실패한다.
 */
const ALLOWLIST_STATUSES = new Set(["exempt", "pending-migration"]);

/** 문구를 담는 JSX attribute. `className`·`value`·`id` 처럼 기계용 속성은 넣지 않는다. */
const COPY_ATTRIBUTES = new Set([
  "alt",
  "title",
  "placeholder",
  "label",
  "subtitle",
  "heading",
  "caption",
  "hint",
  "description",
  "message",
  "emptyText",
  "confirmText",
  "cancelText",
  "actionLabel",
  "ariaLabel",
  "aria-label",
  "aria-description",
  "aria-placeholder",
  "aria-roledescription",
  "aria-valuetext",
]);

/** 문자열 인자를 그대로 보여 주는 호출. */
const DISPLAY_SINKS = new Set([
  "show",
  "toast",
  "alert",
  "confirm",
  "setError",
  "setMessage",
  "setStatusMessage",
  "setBanner",
]);

const MEMBER_SINK_OWNERS = /(?:^|_)(?:toast|toaster|dialog|snackbar|notification)s?$/i;
const MEMBER_SINK_METHODS = new Set(["show", "error", "alert", "confirm"]);

/** message API 를 거친 값은 이미 locale catalog 산출물이다. */
const SANITIZER_NAMES = new Set([
  "formatMessage",
  "formatMessageId",
  "localizeApiError",
  "formatList",
  "formatDate",
  "formatTime",
  "formatNumber",
  "formatRelativeTime",
]);

/** 생성 catalog 자체와 message id 정본은 검사 대상이 아니다(그것이 번역 산출물이다). */
const EXCLUDED_DIRECTORIES = ["src/i18n/generated"];

const CJK_COPY = /[\u3131-\u318E\uAC00-\uD7A3\u3040-\u30FF\u4E00-\u9FFF]/;
const LATIN_WORD = /[A-Za-z]{3,}/;
const LATIN_PHRASE = /[A-Za-z]{2,}[^A-Za-z]+[A-Za-z]{2,}/;
const TITLE_CASE_WORD = /\b[A-Z][a-z]{2,}/;
const TECHNICAL_SHAPES = [
  /^(?:https?:|mailto:|tel:|geo:|data:|blob:|ws{1,2}:)/i,
  /^[./#@]/,
  /^[a-z0-9]+(?:[_-]+[a-z0-9]+)+$/,
  /^[a-z][a-zA-Z0-9]*$/,
  /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/,
  /^[A-Za-z0-9_]+(?:\/[A-Za-z0-9_+-]+)+$/,
  /\.(?:webp|png|svg|jpe?g|json|css|ts|tsx|mjs|html|ico|woff2?)$/i,
  /^[-+]?\d[\d.,]*\s*(?:px|rem|em|%|ms|s|deg|vh|dvh|vw|kb|mb|gb)?$/i,
];

function isTechnicalToken(token) {
  return TECHNICAL_SHAPES.some((shape) => shape.test(token));
}

function defaultRoot() {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

function parseArgs() {
  const argv = process.argv.slice(2);
  const rootIndex = argv.indexOf("--root");
  return {
    root: rootIndex >= 0 && argv[rootIndex + 1] ? argv[rootIndex + 1] : defaultRoot(),
    json: argv.includes("--json"),
  };
}

function slash(path) {
  return path.replaceAll("\\", "/");
}

/**
 * 사용자에게 읽히는 문구인지. 한국어·일본어·중국어 문자는 즉시 문구로 본다.
 * 라틴 문자만인 값은 코드 식별자와 구분해야 하므로 **여러 단어이거나 Title Case 단어**를
 * 요구한다(`standalone`·`not_arrived` 같은 안정 코드는 통과, `Hyeni Calendar`·`Premium` 은 문구).
 */
export function isLinguisticCopy(rawText) {
  const value = String(rawText ?? "").trim();
  if (value.length === 0) return false;
  if (CJK_COPY.test(value)) return true;
  if (!LATIN_WORD.test(value)) return false;
  // CSS 클래스 나열(`kdock__tab hy-press`)처럼 **모든 토큰이 기계 식별자**면 문구가 아니다.
  // 문자열 전체로만 검사하면 공백 때문에 "두 단어 문장"으로 오판된다.
  const tokens = value.split(/\s+/).filter((token) => token.length > 0);
  if (tokens.every(isTechnicalToken)) return false;
  return LATIN_PHRASE.test(value) || TITLE_CASE_WORD.test(value);
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
    for (const entry of entries.sort((left, right) => (left.name < right.name ? -1 : 1))) {
      const child = join(path, entry.name);
      const relativePath = slash(relative(root, child));
      if (EXCLUDED_DIRECTORIES.some((excluded) => relativePath === excluded)) continue;
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name)) files.push(child);
    }
  }
  await walk(join(root, "src"));
  return files;
}

async function loadAllowlist(root) {
  const path = join(root, "scripts", "i18n", "user-facing-literal-allowlist.json");
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function resolveModule(fromFile, specifier, root, knownFiles) {
  let base;
  if (specifier.startsWith("@/")) base = join(root, "src", specifier.slice(2));
  else if (specifier.startsWith(".")) base = join(dirname(fromFile), specifier);
  else return null;

  const stripped = base.replace(/\.(?:ts|tsx)$/, "");
  const candidates = [
    base,
    `${stripped}.ts`,
    `${stripped}.tsx`,
    join(stripped, "index.ts"),
    join(stripped, "index.tsx"),
  ];
  for (const candidate of candidates) {
    const key = slash(relative(root, candidate));
    if (knownFiles.has(key)) return key;
  }
  return null;
}

function bindingIdentifiers(name) {
  if (ts.isIdentifier(name)) return [name];
  if (!name || !("elements" in name)) return [];
  const identifiers = [];
  for (const element of name.elements) {
    if (ts.isOmittedExpression(element)) continue;
    identifiers.push(...bindingIdentifiers(element.name));
  }
  return identifiers;
}

function isCallableNode(node) {
  return Boolean(node) && (ts.isArrowFunction(node) || ts.isFunctionExpression(node));
}

/**
 * 파일 하나의 이름 해석 모델. 스코프 체인을 만들어 같은 이름의 지역 변수가 다른 함수로
 * 새지 않게 한다(스코프를 무시하면 기술 문자열이 문구로 오탐된다).
 */
function createBindingModel(sourceFile) {
  const nodeScopes = new WeakMap();
  const declared = new WeakMap();
  const makeScope = (parent) => ({ parent, bindings: new Map() });
  const rootScope = makeScope(null);
  const moduleSymbols = new Map();

  const declare = (name, scope, metadata) => {
    for (const identifier of bindingIdentifiers(name)) {
      const binding = { name: identifier.text, ...metadata };
      scope.bindings.set(identifier.text, binding);
      declared.set(identifier, binding);
    }
  };

  const declareStatement = (statement, scope, moduleLevel) => {
    if (ts.isImportDeclaration(statement) && statement.importClause) {
      const specifier = ts.isStringLiteralLike(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : "";
      const clause = statement.importClause;
      if (clause.name) {
        declare(clause.name, scope, { kind: "import", exported: "default", specifier });
      }
      const named = clause.namedBindings;
      if (named && ts.isNamedImports(named)) {
        for (const element of named.elements) {
          declare(element.name, scope, {
            kind: "import",
            exported: element.propertyName?.text ?? element.name.text,
            specifier,
          });
        }
      } else if (named && ts.isNamespaceImport(named)) {
        declare(named.name, scope, { kind: "namespace", specifier });
      }
      return;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const callable = isCallableNode(declaration.initializer);
        const metadata = {
          kind: "value",
          valueNode: ts.isIdentifier(declaration.name) ? declaration.initializer : undefined,
          callableNode: callable && ts.isIdentifier(declaration.name)
            ? declaration.initializer
            : undefined,
        };
        declare(declaration.name, scope, metadata);
        if (moduleLevel && ts.isIdentifier(declaration.name)) {
          moduleSymbols.set(declaration.name.text, metadata);
        }
      }
      return;
    }
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      const metadata = { kind: "value", callableNode: statement };
      declare(statement.name, scope, metadata);
      if (moduleLevel) moduleSymbols.set(statement.name.text, metadata);
      return;
    }
    if (ts.isClassDeclaration(statement) && statement.name) {
      declare(statement.name, scope, { kind: "value" });
    }
  };

  const declareContainer = (container, scope, moduleLevel = false) => {
    if (ts.isSourceFile(container) || ts.isBlock(container) || ts.isModuleBlock(container)) {
      for (const statement of container.statements) declareStatement(statement, scope, moduleLevel);
    }
    if (ts.isFunctionLike(container)) {
      for (const parameter of container.parameters) {
        declare(parameter.name, scope, { kind: "parameter" });
      }
    }
    if (ts.isCatchClause(container) && container.variableDeclaration) {
      declare(container.variableDeclaration.name, scope, { kind: "catch" });
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
    if (ts.isVariableDeclaration(node) && !declared.has(node.name) && ts.isIdentifier(node.name)) {
      declare(node.name, scope, {
        kind: "value",
        valueNode: node.initializer,
        callableNode: isCallableNode(node.initializer) ? node.initializer : undefined,
      });
    }
    node.forEachChild((child) => {
      if (isNestedScope(child)) {
        const childScope = makeScope(scope);
        declareContainer(child, childScope);
        attach(child, childScope);
      } else {
        attach(child, scope);
      }
    });
  };

  declareContainer(sourceFile, rootScope, true);
  attach(sourceFile, rootScope);

  const resolve = (identifier) => {
    if (!ts.isIdentifier(identifier)) return null;
    const direct = declared.get(identifier);
    if (direct) return direct;
    let scope = nodeScopes.get(identifier) ?? rootScope;
    while (scope) {
      const binding = scope.bindings.get(identifier.text);
      if (binding) return binding;
      scope = scope.parent;
    }
    return null;
  };

  return { resolve, moduleSymbols };
}

function collectReExports(sourceFile) {
  const aliases = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier) continue;
    if (!ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    const clause = statement.exportClause;
    if (clause && ts.isNamedExports(clause)) {
      for (const element of clause.elements) {
        aliases.push({
          local: element.name.text,
          exported: element.propertyName?.text ?? element.name.text,
          specifier,
        });
      }
    }
  }
  return aliases;
}

function sanitizerCall(node) {
  if (ts.isIdentifier(node.expression)) return SANITIZER_NAMES.has(node.expression.text);
  if (ts.isPropertyAccessExpression(node.expression)) {
    return SANITIZER_NAMES.has(node.expression.name.text);
  }
  return false;
}

function transparent(node) {
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

function accessChainRoot(node) {
  let current = node;
  while (current) {
    if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
      current = current.expression;
      continue;
    }
    const inner = transparent(current);
    if (inner) {
      current = inner;
      continue;
    }
    break;
  }
  return current && ts.isIdentifier(current) ? current : null;
}

/** 모듈 그래프를 만든 뒤 taint 를 fixpoint 로 수렴시킨다. */
function createProgram(modules) {
  const symbolTaint = new Map();
  const symbolKey = (file, name) => `${file}#${name}`;

  const importTarget = (module, binding) => {
    if (!binding || binding.kind !== "import") return null;
    const file = module.imports.get(binding.specifier);
    return file ? symbolKey(file, binding.exported) : null;
  };

  function evaluate(node, module, visited) {
    if (!node) return false;

    if (ts.isStringLiteralLike(node)) return isLinguisticCopy(node.text);

    if (ts.isTemplateExpression(node)) {
      if (isLinguisticCopy(node.head.text)) return true;
      for (const span of node.templateSpans) {
        if (isLinguisticCopy(span.literal.text)) return true;
        if (evaluate(span.expression, module, visited)) return true;
      }
      return false;
    }

    if (ts.isIdentifier(node)) {
      const binding = module.model.resolve(node);
      if (!binding) return false;
      const imported = importTarget(module, binding);
      if (imported) return symbolTaint.get(imported) === true;
      if (visited.has(binding)) return false;
      visited.add(binding);
      try {
        if (binding.valueNode) return evaluate(binding.valueNode, module, visited);
        return false;
      } finally {
        visited.delete(binding);
      }
    }

    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const property = propertyName(node);
      if (property !== null) {
        const shapes = objectShapes(node.expression, module, new Set());
        // 객체 모양을 특정할 수 있으면 **그 속성만** 본다. 객체 전체를 오염으로 보면
        // `sheetView.title`(사용자 데이터)이 같은 객체의 다른 라벨 때문에 오탐된다.
        if (shapes !== null) {
          return shapes.some((shape) => {
            const value = objectPropertyValue(shape.node, property);
            return value !== null && evaluate(value, shape.module, new Set());
          });
        }
      }
      const root = accessChainRoot(node);
      return root ? evaluate(root, module, visited) : false;
    }

    if (ts.isCallExpression(node)) {
      if (sanitizerCall(node)) return false;
      const callee = node.expression;
      if (ts.isIdentifier(callee)) {
        const binding = module.model.resolve(callee);
        const imported = importTarget(module, binding);
        if (imported) return symbolTaint.get(`${imported}#return`) === true;
        if (binding?.callableNode) {
          if (visited.has(binding.callableNode)) return false;
          visited.add(binding.callableNode);
          try {
            return returnExpressions(binding.callableNode)
              .some((expression) => evaluate(expression, module, visited));
          } finally {
            visited.delete(binding.callableNode);
          }
        }
      }
      return false;
    }

    const inner = transparent(node);
    if (inner) return evaluate(inner, module, visited);

    if (ts.isConditionalExpression(node)) {
      return evaluate(node.whenTrue, module, visited) || evaluate(node.whenFalse, module, visited);
    }

    if (ts.isBinaryExpression(node)) {
      const operator = node.operatorToken.kind;
      // `cond && <JSX>` 의 값은 우변이다. 좌변은 조건일 뿐이라 함께 보면
      // 조건 이름 하나 때문에 큰 JSX 블록이 통째로 오탐된다.
      if (
        operator === ts.SyntaxKind.AmpersandAmpersandToken
        || operator === ts.SyntaxKind.EqualsToken
        || operator === ts.SyntaxKind.CommaToken
      ) {
        return evaluate(node.right, module, visited);
      }
      if (
        operator === ts.SyntaxKind.BarBarToken
        || operator === ts.SyntaxKind.QuestionQuestionToken
        || operator === ts.SyntaxKind.PlusToken
      ) {
        return evaluate(node.left, module, visited) || evaluate(node.right, module, visited);
      }
      return false;
    }

    if (ts.isObjectLiteralExpression(node)) {
      return node.properties.some((property) => {
        if (ts.isPropertyAssignment(property)) {
          return evaluate(property.initializer, module, visited);
        }
        if (ts.isShorthandPropertyAssignment(property)) {
          return evaluate(property.name, module, visited);
        }
        if (ts.isSpreadAssignment(property)) return evaluate(property.expression, module, visited);
        return false;
      });
    }

    if (ts.isArrayLiteralExpression(node)) {
      return node.elements.some((element) => evaluate(element, module, visited));
    }

    if (ts.isSpreadElement(node)) return evaluate(node.expression, module, visited);

    return false;
  }

  function propertyName(node) {
    if (ts.isPropertyAccessExpression(node)) return node.name.text;
    if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
      return node.argumentExpression.text;
    }
    return null;
  }

  function objectPropertyValue(objectLiteral, property) {
    for (const member of objectLiteral.properties) {
      if (ts.isPropertyAssignment(member)) {
        const name = member.name;
        const text = ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : null;
        if (text === property) return member.initializer;
      } else if (ts.isShorthandPropertyAssignment(member) && member.name.text === property) {
        return member.name;
      } else if (ts.isSpreadAssignment(member)) {
        // spread 는 속성을 특정할 수 없으므로 전체를 후보로 남긴다.
        return member.expression;
      }
    }
    return null;
  }

  /**
   * 표현식이 가리킬 수 있는 객체 리터럴 목록. 특정하지 못하면 null 을 돌려
   * 호출부가 보수적으로(객체 전체) 판정하게 한다.
   */
  function objectShapes(node, module, seen, depth = 0) {
    if (!node || depth > 8) return null;
    if (ts.isObjectLiteralExpression(node)) return [{ node, module }];

    // 객체가 될 수 없는 분기는 "모양 미상"이 아니라 "기여하는 모양 없음"이다.
    // null 분기를 미상으로 처리하면 `cond ? build() : null` 전체가 보수 판정으로 떨어져
    // 사용자 데이터 속성(event.title)까지 오탐된다.
    if (
      node.kind === ts.SyntaxKind.NullKeyword
      || node.kind === ts.SyntaxKind.TrueKeyword
      || node.kind === ts.SyntaxKind.FalseKeyword
      || ts.isStringLiteralLike(node)
      || ts.isNumericLiteral(node)
      || ts.isTemplateExpression(node)
      || ts.isArrayLiteralExpression(node)
      || (ts.isIdentifier(node) && node.text === "undefined")
      || ts.isVoidExpression(node)
    ) {
      return [];
    }

    const inner = transparent(node);
    if (inner) return objectShapes(inner, module, seen, depth + 1);

    if (ts.isIdentifier(node)) {
      const binding = module.model.resolve(node);
      if (!binding) return null;
      const imported = importTarget(module, binding);
      if (imported) {
        const [targetFile, targetName] = imported.split("#");
        const targetModule = modules.get(targetFile);
        const metadata = targetModule?.model.moduleSymbols.get(targetName);
        if (!metadata?.valueNode) return null;
        return objectShapes(metadata.valueNode, targetModule, seen, depth + 1);
      }
      if (seen.has(binding) || !binding.valueNode) return null;
      seen.add(binding);
      try {
        return objectShapes(binding.valueNode, module, seen, depth + 1);
      } finally {
        seen.delete(binding);
      }
    }

    if (ts.isConditionalExpression(node)) {
      return mergeShapes(
        objectShapes(node.whenTrue, module, seen, depth + 1),
        objectShapes(node.whenFalse, module, seen, depth + 1),
      );
    }

    if (
      ts.isBinaryExpression(node)
      && (node.operatorToken.kind === ts.SyntaxKind.BarBarToken
        || node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
    ) {
      return mergeShapes(
        objectShapes(node.left, module, seen, depth + 1),
        objectShapes(node.right, module, seen, depth + 1),
      );
    }

    if (
      ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      return objectShapes(node.right, module, seen, depth + 1);
    }

    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const binding = module.model.resolve(node.expression);
      const imported = importTarget(module, binding);
      if (imported) {
        const [targetFile, targetName] = imported.split("#");
        const targetModule = modules.get(targetFile);
        const metadata = targetModule?.model.moduleSymbols.get(targetName);
        if (!metadata?.callableNode) return null;
        return returnShapes(metadata.callableNode, targetModule, seen, depth + 1);
      }
      if (binding?.callableNode) return returnShapes(binding.callableNode, module, seen, depth + 1);
    }

    return null;
  }

  function returnShapes(callable, module, seen, depth) {
    if (seen.has(callable)) return null;
    seen.add(callable);
    try {
      const expressions = returnExpressions(callable);
      if (expressions.length === 0) return null;
      let merged = [];
      for (const expression of expressions) {
        const shapes = objectShapes(expression, module, seen, depth + 1);
        // 하나라도 특정 불가면 전체를 특정 불가로 본다(누락 방지).
        if (shapes === null) return null;
        merged = merged.concat(shapes);
      }
      return merged;
    } finally {
      seen.delete(callable);
    }
  }

  function mergeShapes(left, right) {
    if (left === null || right === null) return null;
    return left.concat(right);
  }

  function returnExpressions(callable) {
    if (isCallableNode(callable) && callable.body && !ts.isBlock(callable.body)) {
      return [callable.body];
    }
    if (!callable.body) return [];
    const expressions = [];
    const visit = (node) => {
      if (node !== callable.body && (isCallableNode(node) || ts.isFunctionDeclaration(node))) return;
      if (ts.isReturnStatement(node)) {
        if (node.expression) expressions.push(node.expression);
        return;
      }
      node.forEachChild(visit);
    };
    visit(callable.body);
    return expressions;
  }

  // 1) 재수출 별칭을 먼저 연결한다.
  const aliasEdges = [];
  for (const module of modules.values()) {
    for (const alias of module.reExports) {
      const target = module.imports.get(alias.specifier);
      if (!target) continue;
      aliasEdges.push({
        from: symbolKey(module.file, alias.local),
        to: symbolKey(target, alias.exported),
      });
    }
  }

  // 2) 단조 taint fixpoint.
  let changed = true;
  let rounds = 0;
  while (changed) {
    changed = false;
    rounds += 1;
    if (rounds > 64) break;
    for (const module of modules.values()) {
      for (const [name, metadata] of module.model.moduleSymbols) {
        const valueKey = symbolKey(module.file, name);
        if (symbolTaint.get(valueKey) !== true && metadata.valueNode
          && !isCallableNode(metadata.valueNode)) {
          if (evaluate(metadata.valueNode, module, new Set())) {
            symbolTaint.set(valueKey, true);
            changed = true;
          }
        }
        const returnKey = `${valueKey}#return`;
        if (symbolTaint.get(returnKey) !== true && metadata.callableNode) {
          const tainted = returnExpressions(metadata.callableNode)
            .some((expression) => evaluate(expression, module, new Set()));
          if (tainted) {
            symbolTaint.set(returnKey, true);
            changed = true;
          }
        }
      }
    }
    for (const edge of aliasEdges) {
      for (const suffix of ["", "#return"]) {
        if (symbolTaint.get(`${edge.to}${suffix}`) === true
          && symbolTaint.get(`${edge.from}${suffix}`) !== true) {
          symbolTaint.set(`${edge.from}${suffix}`, true);
          changed = true;
        }
      }
    }
  }

  return { evaluate: (node, module) => evaluate(node, module, new Set()) };
}

function jsxAttributeName(attribute) {
  const name = attribute.name;
  if (ts.isIdentifier(name)) return name.text;
  return `${name.namespace.text}-${name.name.text}`;
}

function isDisplaySink(node) {
  if (ts.isIdentifier(node.expression)) return DISPLAY_SINKS.has(node.expression.text);
  if (!ts.isPropertyAccessExpression(node.expression)) return false;
  const method = node.expression.name.text;
  const owner = accessChainRoot(node.expression.expression)?.text ?? null;
  return owner !== null && MEMBER_SINK_OWNERS.test(owner) && MEMBER_SINK_METHODS.has(method);
}

function isChildPosition(node) {
  const parent = node.parent;
  return Boolean(parent)
    && (ts.isJsxElement(parent) || ts.isJsxFragment(parent));
}

function collectFindings(module, program) {
  const findings = [];
  const push = (node, kind) => {
    const line = module.sourceFile.getLineAndCharacterOfPosition(node.getStart(module.sourceFile)).line;
    findings.push({
      file: module.file,
      line: line + 1,
      kind,
      snippet: node.getText(module.sourceFile).replace(/\s+/g, " ").trim().slice(0, 200),
    });
  };

  const visit = (node) => {
    if (ts.isJsxText(node) && isChildPosition(node) && isLinguisticCopy(node.text)) {
      push(node, "jsx_text");
    } else if (
      ts.isJsxExpression(node)
      && isChildPosition(node)
      && node.expression
      && program.evaluate(node.expression, module)
    ) {
      push(node, "jsx_child_expression");
    } else if (ts.isJsxAttribute(node) && COPY_ATTRIBUTES.has(jsxAttributeName(node))) {
      const initializer = node.initializer;
      if (initializer && ts.isStringLiteral(initializer) && isLinguisticCopy(initializer.text)) {
        push(node, "jsx_attribute");
      } else if (
        initializer
        && ts.isJsxExpression(initializer)
        && initializer.expression
        && program.evaluate(initializer.expression, module)
      ) {
        push(node, "jsx_attribute");
      }
    } else if (
      ts.isCallExpression(node)
      && isDisplaySink(node)
      && node.arguments.some((argument) => program.evaluate(argument, module))
    ) {
      push(node, "display_sink");
    } else if (
      ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isPropertyAccessExpression(node.left)
      && node.left.name.text === "title"
      && accessChainRoot(node.left)?.text === "document"
      && program.evaluate(node.right, module)
    ) {
      push(node, "document_title");
    }
    node.forEachChild(visit);
  };

  visit(module.sourceFile);
  return findings;
}

export async function scanUserFacingLiterals(rootOverride) {
  const root = rootOverride ?? defaultRoot();
  const paths = await listSourceFiles(root);
  const knownFiles = new Set(paths.map((path) => slash(relative(root, path))));
  const modules = new Map();

  for (const path of paths) {
    const file = slash(relative(root, path));
    const source = await readFile(path, "utf8");
    const sourceFile = ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      true,
      path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const imports = new Map();
    for (const statement of sourceFile.statements) {
      const specifierNode = (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement))
        ? statement.moduleSpecifier
        : undefined;
      if (!specifierNode || !ts.isStringLiteralLike(specifierNode)) continue;
      const resolved = resolveModule(path, specifierNode.text, root, knownFiles);
      if (resolved) imports.set(specifierNode.text, resolved);
    }
    modules.set(file, {
      file,
      sourceFile,
      imports,
      model: createBindingModel(sourceFile),
      reExports: collectReExports(sourceFile),
    });
  }

  const program = createProgram(modules);
  const findings = [];
  for (const module of modules.values()) findings.push(...collectFindings(module, program));
  findings.sort((left, right) => (
    left.file === right.file ? left.line - right.line : (left.file < right.file ? -1 : 1)
  ));
  return { root, findings };
}

function compileAllowlist(allowlist, errors) {
  return allowlist.map((entry, index) => {
    const position = index + 1;
    if (
      !entry
      || typeof entry.path !== "string"
      || typeof entry.pattern !== "string"
      || typeof entry.status !== "string"
      || !ALLOWLIST_STATUSES.has(entry.status)
    ) {
      errors.push(`invalid_allowlist_entry:${position}`);
      return { entry, regex: null, used: 0 };
    }
    if (entry.status === "exempt") {
      // 영구 면제는 "왜 번역 대상이 아닌가"를 분류 접두어로 밝혀야 한다.
      if (typeof entry.reason !== "string" || !ALLOWLIST_REASONS.test(entry.reason)) {
        errors.push(`invalid_allowlist_reason:${position}`);
      }
    } else {
      // 이관 잔여는 면제가 아니다. 어느 계획이 언제 없앨지 가리키게 강제한다.
      if (typeof entry.reason !== "string" || entry.reason.trim().length === 0) {
        errors.push(`invalid_allowlist_reason:${position}`);
      }
      if (typeof entry.plan !== "string" || !entry.plan.startsWith("docs/")) {
        errors.push(`invalid_allowlist_plan:${position}`);
      }
      if (typeof entry.migrateTo !== "string" || entry.migrateTo.trim().length === 0) {
        errors.push(`invalid_allowlist_migrate_target:${position}`);
      }
    }
    if (!Number.isInteger(entry.occurrences) || entry.occurrences < 1) {
      errors.push(`invalid_allowlist_occurrences:${position}`);
    }
    try {
      return { entry, regex: new RegExp(entry.pattern), used: 0 };
    } catch {
      errors.push(`invalid_allowlist_pattern:${position}`);
      return { entry, regex: null, used: 0 };
    }
  });
}

export async function auditUserFacingLiterals(rootOverride) {
  const { root, findings } = await scanUserFacingLiterals(rootOverride);
  const errors = [];
  const compiled = compileAllowlist(await loadAllowlist(root), errors);
  const violations = [];

  for (const finding of findings) {
    const matching = compiled.filter((item) => {
      if (!item.regex || item.entry.path !== finding.file) return false;
      item.regex.lastIndex = 0;
      return item.regex.test(finding.snippet);
    });
    const available = matching.find((item) => item.used < item.entry.occurrences);
    if (available) {
      available.used += 1;
      continue;
    }
    if (matching.length > 0) {
      errors.push(`${finding.file}:${finding.line}:overused_allowlist:${finding.snippet}`);
    }
    violations.push(finding);
    errors.push(`${finding.file}:${finding.line}:${finding.kind}:${finding.snippet}`);
  }

  compiled.forEach((item, index) => {
    if (item.regex && item.used !== item.entry.occurrences) {
      errors.push(
        `stale_allowlist:${index + 1}:${item.entry.path}:expected_${item.entry.occurrences}:used_${item.used}`,
      );
    }
  });

  const pending = compiled
    .filter((item) => item.entry?.status === "pending-migration")
    .reduce((total, item) => total + (item.entry.occurrences ?? 0), 0);

  return { findings, violations, pending, errors: [...new Set(errors)] };
}

async function main() {
  const { root, json } = parseArgs();
  const { findings, pending, errors } = await auditUserFacingLiterals(root);
  if (json) {
    console.log(JSON.stringify({ findings, pending, errors }, null, 2));
    process.exitCode = errors.length > 0 ? 1 : 0;
    return;
  }
  if (errors.length > 0) {
    console.error(errors.join("\n"));
    console.error(`사용자 노출 literal 위반 ${errors.length}건`);
    process.exitCode = 1;
    return;
  }
  console.log(`사용자 노출 literal 검사 통과 (이관 잔여 ${pending}건)`);
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll("\\", "/")}`
  || process.argv[1]?.endsWith("scan-user-facing-literals.mjs")) {
  await main();
}

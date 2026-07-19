import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tsModule from "typescript";

const ts = tsModule.default ?? tsModule;
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(rootDir, path), "utf8");

function parse(source, path = "fixture.tsx") {
  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function namedNodeText(source, name) {
  const sourceFile = parse(source);
  let found = null;
  const visit = (node) => {
    if (found) return;
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      found = node.initializer ?? node;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  assert.ok(found, `${name} 선언을 찾지 못했습니다`);
  return found.getText(sourceFile);
}

function assertTargets(source, functionName, targets) {
  const body = namedNodeText(source, functionName);
  for (const target of targets) assert.match(body, target, `${functionName}의 재시도 대상이 누락됐습니다`);
}

function hasErrorRetryBranch(source, errorName, retryName) {
  const sourceFile = parse(source);
  let found = false;
  const contains = (node, text) => node?.getText(sourceFile).includes(text) === true;
  const visit = (node) => {
    if (found) return;
    if (ts.isIfStatement(node)
      && contains(node.expression, errorName)
      && contains(node.thenStatement, retryName)) {
      found = true;
      return;
    }
    if (ts.isConditionalExpression(node)
      && contains(node.condition, errorName)
      && contains(node.whenTrue, retryName)) {
      found = true;
      return;
    }
    if (ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
      && contains(node.left, errorName)
      && contains(node.right, retryName)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

test("계정 조회 실패는 프로필·탈퇴를 fail-closed하고 같은 account query를 재시도한다", () => {
  const hook = read("src/queries/useAccount.ts");
  const screen = read("src/screens/parent/ParentAccount.tsx");
  assert.match(hook, /refetch:\s*\(\)\s*=>\s*Promise/);
  assert.match(hook, /refetch:\s*query\.refetch/);
  assert.match(screen, /isError:\s*accountIsError/);
  assert.match(screen, /refetch:\s*refetchAccount/);
  assert.match(namedNodeText(screen, "saveProfile"), /if\s*\(!accountReady\)/);
  assert.match(namedNodeText(screen, "handleDelete"), /if\s*\(!accountReady\)/);
  assert.equal(hasErrorRetryBranch(screen, "accountLoadError", "refetchAccount"), true);
  assert.match(screen, /const isPrimary = account\.isPrimaryParent/);
  assert.equal(
    hasErrorRetryBranch(screen.replace("void refetchAccount()", "void 0"), "accountLoadError", "refetchAccount"),
    false,
  );
});

test("부모 친구놀이는 enabled·active·pending을 한 상태와 한 재시도에 연결한다", () => {
  const screen = read("src/screens/feature/FriendPlay.tsx");
  const loading = namedNodeText(screen, "parentPlaydateLoading");
  const error = namedNodeText(screen, "parentPlaydateError");
  for (const name of ["enabledQ", "activeQ", "pendingQ"]) {
    assert.match(loading, new RegExp(`${name}\\.isLoading`));
    assert.match(error, new RegExp(`${name}\\.isError`));
  }
  assertTargets(screen, "retryParentPlaydate", [
    /enabledQ\.refetch\(\)/,
    /activeQ\.refetch\(\)/,
    /pendingQ\.refetch\(\)/,
  ]);
  assert.equal(hasErrorRetryBranch(screen, "parentPlaydateError", "retryParentPlaydate"), true);

  const mutation = screen.replace(/pendingQ\.refetch\(\),?/, "");
  assert.throws(
    () => assertTargets(mutation, "retryParentPlaydate", [/pendingQ\.refetch\(\)/]),
    /재시도 대상이 누락/,
  );
  assert.equal(
    hasErrorRetryBranch(
      screen.replace("onRetry={() => void retryParentPlaydate()}", "onRetry={() => undefined}"),
      "parentPlaydateError",
      "retryParentPlaydate",
    ),
    false,
  );
});

test("아이 상세와 가족 연결은 보조 query 실패를 빈 데이터로 위장하지 않는다", () => {
  const detail = read("src/screens/parent/ChildDetail.tsx");
  const detailLoading = namedNodeText(detail, "detailLoading");
  const detailError = namedNodeText(detail, "detailError");
  for (const name of ["familyQuery", "eventsQuery", "locationsQuery", "placesQuery"]) {
    assert.match(detailLoading, new RegExp(`${name}\\.isLoading`));
    assert.match(detailError, new RegExp(`${name}\\.isError`));
  }
  assertTargets(detail, "retryChildDetail", [
    /familyQuery\.refetch\(\)/,
    /eventsQuery\.refetch\(\)/,
    /locationsQuery\.refetch\(\)/,
    /placesQuery\.refetch\(\)/,
  ]);
  assert.equal(hasErrorRetryBranch(detail, "detailError", "retryChildDetail"), true);
  assert.equal(
    hasErrorRetryBranch(detail.replace("void retryChildDetail()", "void 0"), "detailError", "retryChildDetail"),
    false,
  );

  const connection = read("src/screens/feature/FamilyConnection.tsx");
  const connectionLoading = namedNodeText(connection, "connectionLoading");
  const connectionError = namedNodeText(connection, "connectionError");
  for (const name of ["familyQuery", "locationsQuery"]) {
    assert.match(connectionLoading, new RegExp(`${name}\\.isLoading`));
    assert.match(connectionError, new RegExp(`${name}\\.isError`));
  }
  assertTargets(connection, "retryFamilyConnection", [
    /familyQuery\.refetch\(\)/,
    /locationsQuery\.refetch\(\)/,
  ]);
  assert.equal(hasErrorRetryBranch(connection, "connectionError", "retryFamilyConnection"), true);
  assert.equal(
    hasErrorRetryBranch(
      connection.replace("void retryFamilyConnection()", "void 0"),
      "connectionError",
      "retryFamilyConnection",
    ),
    false,
  );
});

test("가족 조회 오류는 MemoChat의 같은 family query 재시도 버튼에 연결된다", () => {
  const screen = read("src/screens/shared/MemoChat.tsx");
  assert.match(screen, /refetch:\s*refetchFamily/);
  assert.equal(hasErrorRetryBranch(screen, "familyError", "refetchFamily"), true);
  assert.match(screen, /if\s*\(!family\)\s*return null/);

  const mutation = screen.replace(/void refetchFamily\(\)/, "void thread.refetch()");
  assert.equal(hasErrorRetryBranch(mutation, "familyError", "refetchFamily"), false);
});

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scanner = fileURLToPath(new URL("../scripts/i18n/scan-client-error-surfaces.mjs", import.meta.url));

function runScanner(root) {
  return spawnSync(process.execPath, [scanner, "--root", root], { encoding: "utf8" });
}

test("오류 surface scanner는 JSX·toast·dialog의 원문 노출을 파일과 행으로 보고한다", () => {
  const root = mkdtempSync(join(tmpdir(), "hyeni-error-scan-"));
  try {
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "Unsafe.tsx"), [
      "export function Unsafe({ error }) {",
      "  show(error.message);",
      "  show(`failed: ${detail.error}`);",
      "  return <div>{String(error)}</div>;",
      "  return <div>{result.message}</div>;",
      "}",
    ].join("\n"));
    const result = runScanner(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /src\/Unsafe\.tsx:2/);
    assert.match(result.stderr, /src\/Unsafe\.tsx:3/);
    assert.match(result.stderr, /src\/Unsafe\.tsx:4/);
    assert.match(result.stderr, /src\/Unsafe\.tsx:5/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const fixture of [
  {
    name: "destructure alias를 dialog에 전달",
    lines: ["const { message: text } = response;", "show(text);"],
    sinkLine: 3,
  },
  {
    name: "optional message alias를 JSX에 렌더",
    lines: ["const text = failure?.message;", "return <p>{text}</p>;"],
    sinkLine: 3,
  },
  {
    name: "여러 줄 optional message를 JSX에 렌더",
    lines: ["const text = failure", "  ?.message;", "return <p>{text}</p>;"],
    sinkLine: 4,
  },
  {
    name: "bracket message alias를 dialog에 전달",
    lines: ["const text = response['message'];", "show(text);"],
    sinkLine: 3,
  },
]) {
  test(`오류 surface scanner는 ${fixture.name}하는 우회를 보고한다`, () => {
    const root = mkdtempSync(join(tmpdir(), "hyeni-error-scan-"));
    try {
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(join(root, "src", "Aliased.tsx"), [
        "export function Aliased({ response, failure }) {",
        ...fixture.lines.map((line) => `  ${line}`),
        "}",
      ].join("\n"));
      const result = runScanner(root);
      assert.notEqual(result.status, 0, fixture.name);
      assert.match(result.stderr, new RegExp(`src/Aliased\\.tsx:${fixture.sinkLine}`));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("scanner allowlist는 migration 사유이거나 더 이상 사용되지 않으면 실패한다", () => {
  const root = mkdtempSync(join(tmpdir(), "hyeni-error-scan-"));
  try {
    mkdirSync(join(root, "src"), { recursive: true });
    mkdirSync(join(root, "scripts", "i18n"), { recursive: true });
    writeFileSync(join(root, "src", "Safe.tsx"), "export function Safe() { return <div />; }\n");
    writeFileSync(join(root, "scripts", "i18n", "client-error-surface-allowlist.json"), JSON.stringify([
      {
        path: "src/Safe.tsx",
        pattern: "error\\.message",
        occurrences: 1,
        reason: "migration-task-7: 후속 작업에서 옮길 예정",
      },
    ]));
    const result = runScanner(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /invalid_allowlist_reason|stale_allowlist/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("실제 Task 6 오류 표면은 scanner를 통과하고 Worker 원문을 표시하지 않는다", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const result = runScanner(root);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

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
  {
    name: "일반 formatter로 감싼 message를 JSX에 렌더",
    lines: ["return <p>{format(failure.message)}</p>;"],
    sinkLine: 2,
  },
  {
    name: "원문을 객체 state에 담은 뒤 property를 렌더",
    lines: ["const [view, setView] = useState({ text: '' });", "setView({ text: failure.message });", "return <p>{view.text}</p>;"],
    sinkLine: 4,
  },
  {
    name: "원문을 배열에 담은 뒤 element를 렌더",
    lines: ["const messages = [failure.message];", "return <p>{messages[0]}</p>;"],
    sinkLine: 3,
  },
  {
    name: "whole error alias를 String으로 dialog에 전달",
    lines: ["const source = failure;", "setError(String(source));"],
    sinkLine: 3,
  },
  {
    name: "toast member sink에 message를 전달",
    lines: ["toast.error(failure.message);"],
    sinkLine: 2,
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

test("승인된 cleanAlertTitle sanitizer는 원문 taint를 해제한다", () => {
  const root = mkdtempSync(join(tmpdir(), "hyeni-error-scan-"));
  try {
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "Sanitized.tsx"), [
      "export function Sanitized({ alert }) {",
      "  return <p>{cleanAlertTitle(alert.message)}</p>;",
      "}",
    ].join("\n"));
    const result = runScanner(root);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("승인된 native billing resolver는 whole error를 catalog 문구로 바꾼다", () => {
  const root = mkdtempSync(join(tmpdir(), "hyeni-error-scan-"));
  try {
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "Billing.tsx"), [
      "export function Billing({ failure, intl }) {",
      "  show(resolveNativeBillingFailureMessage(failure, intl));",
      "}",
    ].join("\n"));
    const result = runScanner(root);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("allowlist는 실제 AST finding만 한 번 소비하고 같은 줄의 직접 렌더를 숨기지 않는다", () => {
  const root = mkdtempSync(join(tmpdir(), "hyeni-error-scan-"));
  try {
    mkdirSync(join(root, "src"), { recursive: true });
    mkdirSync(join(root, "scripts", "i18n"), { recursive: true });
    writeFileSync(join(root, "src", "Mixed.tsx"), [
      "export function Mixed({ alert }) {",
      "  return <>{cleanAlertTitle(alert.message)}{alert.message}</>;",
      "}",
    ].join("\n"));
    writeFileSync(join(root, "scripts", "i18n", "client-error-surface-allowlist.json"), JSON.stringify([
      {
        path: "src/Mixed.tsx",
        pattern: "cleanAlertTitle\\(alert\\.message\\)",
        occurrences: 1,
        reason: "data: 정제된 안전 알림 제목",
      },
    ]));
    const result = runScanner(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /raw_error_surface/);
    assert.match(result.stderr, /stale_allowlist/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("allowlist는 실제 finding의 사용 수가 선언보다 많거나 적으면 실패한다", () => {
  for (const [name, body, occurrences, expected] of [
    ["미사용", "recordProtocol(response.message);", 1, /stale_allowlist/],
    ["과잉", "return <>{response.message}{response.message}</>;", 1, /raw_error_surface|overused_allowlist/],
  ]) {
    const root = mkdtempSync(join(tmpdir(), "hyeni-error-scan-"));
    try {
      mkdirSync(join(root, "src"), { recursive: true });
      mkdirSync(join(root, "scripts", "i18n"), { recursive: true });
      writeFileSync(join(root, "src", "Allowlisted.tsx"), `export function Demo({ response }) { ${body} }\n`);
      writeFileSync(join(root, "scripts", "i18n", "client-error-surface-allowlist.json"), JSON.stringify([
        {
          path: "src/Allowlisted.tsx",
          pattern: "response\\.message",
          occurrences,
          reason: "protocol: fixture에서만 허용",
        },
      ]));
      const result = runScanner(root);
      assert.notEqual(result.status, 0, name);
      assert.match(result.stderr, expected, name);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

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

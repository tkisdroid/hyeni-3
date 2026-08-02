import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { dirname, extname, relative, resolve } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const workerDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const typeScriptResolutionHook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !extname(specifier)) {
      const base = new URL(specifier, context.parentURL);
      for (const extension of [".ts", ".js"]) {
        const candidate = new URL(`${base.href}${extension}`);
        if (existsSync(fileURLToPath(candidate))) {
          return { url: candidate.href, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

after(() => typeScriptResolutionHook.deregister());

const { buildOperationalLog, writeOperationalLog } = await import(
  pathToFileURL(resolve(workerDir, "lib/safeOperationalLog.ts")).href
);

const SPECIALIZED_CONSOLE_CONTRACTS = new Map([
  ["lib/launchObservability.ts", { count: 3, argument: "marker_or_request_builder" }],
  ["lib/openaiLog.ts", { count: 2, argument: "entry" }],
  ["lib/safeOperationalLog.ts", { count: 3, argument: "entry" }],
  ["routes/feedback.ts", { count: 3, argument: "entry" }],
]);

async function listRuntimeSources(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === "scripts" || entry.name === "tests") continue;
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listRuntimeSources(absolute));
    } else if (/\.(?:js|ts)$/.test(entry.name)) {
      files.push(absolute);
    }
  }
  return files;
}

function normalizedRelativePath(file) {
  return relative(workerDir, file).replaceAll("\\", "/");
}

function isConsoleCall(node) {
  return ts.isCallExpression(node)
    && ts.isPropertyAccessExpression(node.expression)
    && ts.isIdentifier(node.expression.expression)
    && node.expression.expression.text === "console";
}

function isStaticConsoleArgument(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

function collectUnsafeConsoleCalls(sourceFile, file) {
  const violations = [];
  const relativePath = normalizedRelativePath(file);
  const specializedContract = SPECIALIZED_CONSOLE_CONTRACTS.get(relativePath);
  let specializedCallCount = 0;

  function visit(node) {
    if (isConsoleCall(node)) {
      let safe = node.arguments.length === 1 && isStaticConsoleArgument(node.arguments[0]);
      if (specializedContract) {
        specializedCallCount += 1;
        const argument = node.arguments[0];
        safe = node.arguments.length === 1 && (
          specializedContract.argument === "entry"
            ? ts.isIdentifier(argument) && argument.text === "entry"
            : (
              ts.isIdentifier(argument) && argument.text === "marker"
            ) || (
              ts.isCallExpression(argument)
              && ts.isIdentifier(argument.expression)
              && argument.expression.text === "buildRequestOutcomeLog"
            )
        );
      }
      if (!safe) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        violations.push(`${relativePath}:${line}`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  if (specializedContract && specializedCallCount !== specializedContract.count) {
    violations.push(`${relativePath}:console_count_${specializedCallCount}`);
  }
  return violations;
}

function collectUnsafeOperationalLogCalls(sourceFile, file) {
  const violations = [];
  const relativePath = normalizedRelativePath(file);

  function visit(node) {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === "writeOperationalLog"
    ) {
      const level = node.arguments[0];
      const event = node.arguments[1];
      const fields = node.arguments[2];
      const staticLevel = level && ts.isStringLiteral(level)
        && ["error", "info", "warn"].includes(level.text);
      const staticEvent = event && ts.isStringLiteral(event) && /^[a-z][a-z0-9_]{2,95}$/.test(event.text);
      let safeFields = true;
      let hasCount = false;
      if (fields) {
        safeFields = ts.isObjectLiteralExpression(fields)
          && fields.properties.every((property) => {
            if (
              ts.isPropertyAssignment(property)
              && ts.isIdentifier(property.name)
            ) {
              if (property.name.text === "count") hasCount = true;
              return ["count", "provider", "status"].includes(property.name.text);
            }
            if (ts.isShorthandPropertyAssignment(property) && property.name.text === "count") {
              hasCount = true;
            }
            return ts.isShorthandPropertyAssignment(property)
              && ["count", "provider", "status"].includes(property.name.text);
          });
      }
      if (
        hasCount
        && (
          relativePath !== "lib/locationConfirmationAudit.ts"
          || !ts.isStringLiteral(event)
          || event.text !== "location_confirmation_retention_batch_saturated"
        )
      ) {
        safeFields = false;
      }
      if (!staticLevel || !staticEvent || !safeFields) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        violations.push(`${relativePath}:${line}`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return violations;
}

test("운영 로그 builder는 원본 예외·경로·식별자·payload를 런타임에서도 버린다", () => {
  const secret = "secret-token-must-never-appear";
  const entry = buildOperationalLog("oauth_token_exchange_failed", {
    provider: "google",
    status: 503,
    count: 42,
    error: new Error(secret),
    path: `/api/private?token=${secret}`,
    familyId: `family-${secret}`,
    payload: { message: secret },
  });

  assert.deepEqual(entry, {
    scope: "worker",
    event: "oauth_token_exchange_failed",
    provider: "google",
    status: 503,
  });
  assert.doesNotMatch(JSON.stringify(entry), /secret-token|private|family|payload|error/i);
});

test("운영 로그 builder는 동적 이벤트·공급자·비정상 상태값을 fail-closed 한다", () => {
  assert.deepEqual(
    buildOperationalLog("user-content:token=abc", {
      provider: "provider-from-request",
      status: 999,
    }),
    {
      scope: "worker",
      event: "operational_log_invalid_event",
    },
  );
});

test("운영 로그 writer는 console에 정제된 단일 객체만 전달한다", () => {
  const entries = [];
  const originalError = console.error;
  console.error = (...args) => entries.push(args);
  try {
    writeOperationalLog("error", "fcm_send_failed", {
      provider: "fcm",
      status: 429,
      token: "must-not-log",
    });
  } finally {
    console.error = originalError;
  }

  assert.deepEqual(entries, [[{
    scope: "worker",
    event: "fcm_send_failed",
    provider: "fcm",
    status: 429,
  }]]);
  assert.doesNotMatch(JSON.stringify(entries), /must-not-log/);
});

test("Worker 런타임의 일반 console 호출은 단일 정적 문자열만 허용한다", async () => {
  const violations = [];
  for (const file of await listRuntimeSources(workerDir)) {
    const source = await readFile(file, "utf8");
    const sourceFile = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".js") ? ts.ScriptKind.JS : ts.ScriptKind.TS,
    );
    violations.push(...collectUnsafeConsoleCalls(sourceFile, file));
  }
  assert.deepEqual(violations, []);
});

test("중앙 운영 logger 호출은 정적 이벤트와 count/provider/status 필드만 사용한다", async () => {
  const violations = [];
  for (const file of await listRuntimeSources(workerDir)) {
    const source = await readFile(file, "utf8");
    const sourceFile = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".js") ? ts.ScriptKind.JS : ts.ScriptKind.TS,
    );
    violations.push(...collectUnsafeOperationalLogCalls(sourceFile, file));
  }
  assert.deepEqual(violations, []);
});

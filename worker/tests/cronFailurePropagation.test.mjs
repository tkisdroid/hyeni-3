import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/tsModuleResolve.mjs";
const { runCronHandlers } = await import("../index.ts");
test("중간 cron 작업이 실패해도 나머지를 모두 실행한 뒤 고정 오류를 throw한다", async () => {
  const executions = [];
  const errorLogs = [];
  const successLogs = [];
  const originalError = console.error;
  const originalLog = console.log;
  const sensitiveMessage = "purchase-token-must-not-be-logged";
  console.error = (...args) => errorLogs.push(args);
  console.log = (...args) => successLogs.push(args);

  try {
    await assert.rejects(
      runCronHandlers("*/5 * * * *", [
        {
          name: "first",
          run: async () => {
            executions.push("first");
            return { token: sensitiveMessage };
          },
        },
        {
          name: "failing",
          run: async () => {
            executions.push("failing");
            throw new Error(sensitiveMessage);
          },
        },
        {
          name: "last",
          run: async () => {
            executions.push("last");
            return { ok: true };
          },
        },
      ], {}),
      (error) => {
        assert.equal(error?.message, "scheduled_cron_handler_failed");
        assert.doesNotMatch(String(error), new RegExp(sensitiveMessage));
        return true;
      },
    );
  } finally {
    console.error = originalError;
    console.log = originalLog;
  }

  assert.deepEqual(executions, ["first", "failing", "last"]);
  assert.equal(errorLogs.length, 1);
  assert.equal(errorLogs[0].length, 1);
  assert.deepEqual(errorLogs[0][0], {
    event: "hyeni_cron_heartbeat_v1",
    versionId: "unavailable",
    cron: "*/5 * * * *",
    handler: "failing",
    status: "failure",
  });
  assert.ok(successLogs.every((args) => args.length === 1));
  assert.deepEqual(successLogs.map((args) => args[0].handler), ["first", "last"]);
  assert.doesNotMatch(JSON.stringify(errorLogs), new RegExp(sensitiveMessage));
  assert.doesNotMatch(JSON.stringify(successLogs), /purchase-token/);
});

test("모든 cron 작업이 성공하면 정상 완료한다", async () => {
  const originalLog = console.log;
  console.log = () => {};
  try {
    await assert.doesNotReject(
      runCronHandlers("* * * * *", [
        { name: "one", run: async () => ({ ok: true }) },
        { name: "two", run: async () => ({ ok: true }) },
      ], {}),
    );
  } finally {
    console.log = originalLog;
  }
});

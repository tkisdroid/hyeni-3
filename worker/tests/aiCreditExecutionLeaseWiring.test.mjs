import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workerDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFileSync(resolve(workerDir, path), "utf8");

test("아이 AI 채팅은 모델 호출·일정 생성 전에 자녀별 실행 lease를 잡고 finally에서 해제한다", () => {
  const text = source("routes/ai-child-chat.ts");
  const route = text.indexOf('chat.post("/child-chat"');
  const acquire = text.indexOf("acquireAiCreditExecutionLease", route);
  const createSchedule = text.indexOf('agentPlan.toolName === "createSchedule"', route);
  const openAi = text.indexOf("fetch(openaiChatUrl", route);
  const finallyBlock = text.indexOf("finally", openAi);
  const release = text.indexOf("releaseAiCreditExecutionLease", finallyBlock);

  assert.ok(route >= 0 && acquire > route);
  assert.ok(createSchedule > acquire && openAi > acquire);
  assert.ok(finallyBlock > openAi && release > finallyBlock);
  assert.match(text.slice(acquire, createSchedule), /ai_request_in_progress/);
  assert.match(text.slice(openAi, openAi + 600), /AbortSignal\.timeout/);
});

test("선제 AI도 같은 자녀별 실행 lease 안에서 크레딧 상태를 읽고 차감한다", () => {
  const text = source("routes/ai-proactive.ts");
  const process = text.indexOf("async function processCandidate");
  const acquire = text.indexOf("acquireAiCreditExecutionLease", process);
  const creditRead = text.indexOf("loadCreditRow", acquire);
  const consume = text.indexOf("consumeAiCreditAtomic", creditRead);
  const finallyBlock = text.indexOf("finally", consume);
  const release = text.indexOf("releaseAiCreditExecutionLease", finallyBlock);

  assert.ok(process >= 0 && acquire > process);
  assert.ok(creditRead > acquire && consume > creditRead);
  assert.ok(finallyBlock > consume && release > finallyBlock);
});

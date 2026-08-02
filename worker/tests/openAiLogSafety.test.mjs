import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { dirname, extname, resolve } from "node:path";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";

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

const { classifyOpenAiError, writeOpenAiLog } = await import(
  pathToFileURL(resolve(workerDir, "lib/openaiLog.ts")).href
);
const [aiRoute, childChatRoute] = await Promise.all([
  readFile(resolve(workerDir, "routes/ai.ts"), "utf8"),
  readFile(resolve(workerDir, "routes/ai-child-chat.ts"), "utf8"),
]);

test("OpenAI 구조화 로그는 허용 필드만 남기고 비밀·프롬프트·공급자 본문을 버린다", () => {
  const secret = "openai-secret-never-log";
  const prompt = "아이의 민감한 상담 원문";
  const providerBody = `provider rejected ${secret}`;
  const entries = [];
  const originalError = console.error;
  console.error = (value) => entries.push(String(value));
  try {
    writeOpenAiLog("error", {
      operation: "child_chat",
      outcome: "http_error",
      status: 429,
      latencyMs: 128.7,
      finishReason: "content_filter",
      usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
      errorKind: "provider_rejected",
      secret,
      prompt,
      providerBody,
    });
  } finally {
    console.error = originalError;
  }

  assert.equal(entries.length, 1);
  const serialized = entries[0];
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes(prompt), false);
  assert.equal(serialized.includes(providerBody), false);
  assert.deepEqual(JSON.parse(serialized), {
    scope: "openai",
    event: "request_http_error",
    operation: "child_chat",
    outcome: "http_error",
    model: "gpt-5.6-luna",
    status: 429,
    latencyMs: 129,
    finishReason: "content_filter",
    promptTokens: 12,
    completionTokens: 4,
    totalTokens: 16,
    errorKind: "provider_rejected",
  });
});

test("OpenAI 예외 분류는 예외 메시지 없이 고정된 종류만 반환한다", () => {
  const secret = "openai-error-message-must-not-log";
  assert.equal(classifyOpenAiError(Object.assign(new Error(secret), { name: "TimeoutError" })), "timeout");
  assert.equal(classifyOpenAiError(Object.assign(new Error(secret), { name: "AbortError" })), "aborted");
  assert.equal(classifyOpenAiError(new SyntaxError(secret)), "invalid_response");
  assert.equal(classifyOpenAiError(new TypeError(secret)), "network");
  assert.equal(classifyOpenAiError(new Error(secret)), "unknown");
});

test("활성 AI 경로는 공급자 본문과 원본 예외를 console에 직접 기록하지 않는다", () => {
  const activeSources = `${aiRoute}\n${childChatRoute}`;
  const childOpenAiStart = childChatRoute.indexOf(
    "openAiStartedAt = Date.now();",
    childChatRoute.indexOf("OPENAI_API_KEY"),
  );
  const childOpenAiEnd = childChatRoute.indexOf("// 200+빈응답", childOpenAiStart);
  assert.notEqual(childOpenAiStart, -1);
  assert.notEqual(childOpenAiEnd, -1);
  const childOpenAiBlock = childChatRoute.slice(childOpenAiStart, childOpenAiEnd);
  assert.doesNotMatch(activeSources, /(?:openaiRes|response)\.text\(\)/);
  assert.doesNotMatch(aiRoute, /console\.error\(/);
  assert.doesNotMatch(childOpenAiBlock, /console\.error\(/);
  assert.equal((activeSources.match(/writeOpenAiLog\(/g) || []).length >= 8, true);
});

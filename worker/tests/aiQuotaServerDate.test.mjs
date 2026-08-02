import { existsSync } from "node:fs";
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

const childChat = await import(pathToFileURL(resolve(workerDir, "routes/ai-child-chat.ts")).href);
const proactive = await import(pathToFileURL(resolve(workerDir, "routes/ai-proactive.ts")).href);

const SERVER_NOW = new Date("2026-08-01T15:30:00.000Z");
const SERVER_KST_TODAY = "2026-08-02";

test("아이 AI 채팅은 과거 usageDate를 일정 문맥에만 쓰고 quota는 서버 KST 오늘로 고정한다", () => {
  assert.deepEqual(childChat.resolveAiChatDates("2025-01-01", SERVER_NOW), {
    contextDate: "2025-01-01",
    quotaDate: SERVER_KST_TODAY,
  });
});

test("아이 AI 채팅은 미래 usageDate로도 quota 날짜를 바꿀 수 없다", () => {
  assert.deepEqual(childChat.resolveAiChatDates("2099-12-31", SERVER_NOW), {
    contextDate: "2099-12-31",
    quotaDate: SERVER_KST_TODAY,
  });
});

test("AI 선제 메시지는 요청 usageDate와 무관하게 quota를 서버 KST 오늘로 고정한다", () => {
  assert.deepEqual(proactive.resolveAiProactiveDates("2025-01-01", SERVER_NOW), {
    contextDate: "2025-01-01",
    quotaDate: SERVER_KST_TODAY,
  });
  assert.deepEqual(proactive.resolveAiProactiveDates("2099-12-31", SERVER_NOW), {
    contextDate: "2099-12-31",
    quotaDate: SERVER_KST_TODAY,
  });
});

test("usageDate가 없거나 형식이 틀리면 일정 문맥과 quota 모두 서버 KST 오늘을 쓴다", () => {
  for (const invalid of [undefined, null, "", "2026-8-2", "not-a-date"]) {
    assert.deepEqual(childChat.resolveAiChatDates(invalid, SERVER_NOW), {
      contextDate: SERVER_KST_TODAY,
      quotaDate: SERVER_KST_TODAY,
    });
    assert.deepEqual(proactive.resolveAiProactiveDates(invalid, SERVER_NOW), {
      contextDate: SERVER_KST_TODAY,
      quotaDate: SERVER_KST_TODAY,
    });
  }
});

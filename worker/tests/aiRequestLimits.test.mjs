import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, extname, resolve } from "node:path";
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

test.after(() => typeScriptResolutionHook.deregister());

const {
  MAX_AI_JSON_BYTES,
  MAX_CHILD_MONITOR_EVENTS,
  MAX_VOICE_PARSE_ACADEMIES,
  readBoundedAiJson,
  validateChildMonitorInput,
  validateVoiceParseInput,
} = await import(pathToFileURL(resolve(workerDir, "lib/aiRequestLimits.ts")).href);

test("AI JSON reader는 Content-Length가 없거나 거짓이어도 실제 스트림 바이트 상한에서 닫는다", async () => {
  const oversized = JSON.stringify({ text: "가".repeat(MAX_AI_JSON_BYTES) });
  const request = new Request("https://test.local/api/ai/voice-parse", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": "2" },
    body: oversized,
  });

  assert.deepEqual(await readBoundedAiJson(request), { ok: false, error: "payload_too_large" });
});

test("AI JSON reader는 상한 안의 UTF-8 JSON을 그대로 파싱한다", async () => {
  const request = new Request("https://test.local/api/ai/voice-parse", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "내일 3시 피아노" }),
  });

  assert.deepEqual(await readBoundedAiJson(request), {
    ok: true,
    value: { text: "내일 3시 피아노" },
  });
});

test("voice-parse validator는 필드 길이와 배열 개수를 서버에서 제한한다", () => {
  assert.deepEqual(validateVoiceParseInput({
    text: "내일 3시 피아노",
    todayEvents: [{ id: "event-1", title: "시간 미정 일정", time: null, memo: "" }],
  }), { ok: true });
  assert.deepEqual(
    validateVoiceParseInput({
      text: "일정",
      academies: Array.from({ length: MAX_VOICE_PARSE_ACADEMIES + 1 }, (_, index) => ({
        name: `학원-${index}`,
        category: "school",
      })),
    }),
    { ok: false, error: "voice_parse_academies_too_large" },
  );
  assert.deepEqual(
    validateVoiceParseInput({ text: "일정", image: `data:image/jpeg;base64,${"A".repeat(MAX_AI_JSON_BYTES)}` }),
    { ok: false, error: "voice_parse_image_too_large" },
  );
});

test("child-monitor validator는 메모와 일정 배열의 자원 상한을 강제한다", () => {
  assert.deepEqual(
    validateChildMonitorInput({
      analysisType: "memo_sentiment",
      memoText: "오늘은 즐거웠어요",
      childName: "혜니",
    }),
    { ok: true },
  );
  assert.deepEqual(
    validateChildMonitorInput({
      analysisType: "schedule_adherence",
      events: Array.from({ length: MAX_CHILD_MONITOR_EVENTS + 1 }, () => ({
        title: "피아노",
        time: "15:00",
        arrivedOnTime: true,
        arrivalDelay: 0,
      })),
    }),
    { ok: false, error: "child_monitor_events_too_large" },
  );
});

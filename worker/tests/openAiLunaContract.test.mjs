import { readFile } from "node:fs/promises";
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

const {
  OPENAI_LUNA_MODEL,
  OPENAI_LUNA_REASONING_EFFORT,
  openaiChatUrl,
  openaiLunaChatConfig,
  openaiSafetyIdentifier,
  parseOpenAiJsonObjectContent,
} = await import(pathToFileURL(resolve(workerDir, "lib/openai.ts")).href);
const { planChildAgentAction } = await import(
  pathToFileURL(resolve(workerDir, "shared/aiAgentPlanner.js")).href
);
const { ensureChildSafetyReply, hasRequiredChildSafetyReply } = await import(
  pathToFileURL(resolve(workerDir, "shared/aiSafetyPolicy.js")).href
);

const [aiRoute, childChatRoute] = await Promise.all([
  readFile(resolve(workerDir, "routes/ai.ts"), "utf8"),
  readFile(resolve(workerDir, "routes/ai-child-chat.ts"), "utf8"),
]);
const liveValidationScript = await readFile(resolve(workerDir, "scripts/verify-openai-luna.mjs"), "utf8");

test("활성 OpenAI 모델은 gpt-5.6-luna 하나로 고정한다", () => {
  assert.equal(OPENAI_LUNA_MODEL, "gpt-5.6-luna");
  assert.equal(OPENAI_LUNA_REASONING_EFFORT, "none");
  assert.deepEqual(openaiLunaChatConfig(220), {
    model: "gpt-5.6-luna",
    reasoning_effort: "none",
    max_completion_tokens: 220,
  });
  assert.throws(() => openaiLunaChatConfig(0), /invalid_openai_luna_max_completion_tokens/);
  assert.throws(() => openaiLunaChatConfig(128_001), /invalid_openai_luna_max_completion_tokens/);
});

test("Luna 전환은 기존 Chat Completions 응답 계약과 Gateway base를 보존한다", () => {
  assert.equal(openaiChatUrl({}), "https://api.openai.com/v1/chat/completions");
  assert.equal(
    openaiChatUrl({ OPENAI_BASE_URL: "https://gateway.example/openai/" }),
    "https://gateway.example/openai/chat/completions",
  );
  assert.match(aiRoute, /choices\?\.\[0\]\?\.message\?\.content/);
  assert.match(childChatRoute, /choices\?\.\[0\]\?\.message\?\.content/);
});

test("네 활성 AI 호출은 Luna 설정과 최신 token 상한 필드를 사용한다", () => {
  const activeSources = `${aiRoute}\n${childChatRoute}`;
  assert.equal((activeSources.match(/openaiLunaChatConfig\(/g) || []).length, 4);
  assert.doesNotMatch(activeSources, /gpt-4o(?:-mini)?/);
  assert.doesNotMatch(activeSources, /\bmax_tokens\b/);
  assert.match(aiRoute, /openaiLunaChatConfig\(isPaste \? 1000 : 300\)/);
  assert.match(aiRoute, /openaiLunaChatConfig\(360\)/);
  assert.match(aiRoute, /openaiLunaChatConfig\(500\)/);
  // 아이 대화만 추론을 조금 켠다(2026-08-17). 예산 900은 추론 토큰이 답변을 밀어내
  // 빈 응답이 되는 것을 막기 위한 상한이며, 실제 사용분만 과금된다.
  assert.match(childChatRoute, /openaiLunaChatConfig\(900, \{ reasoningEffort: "low" \}\)/);
  assert.deepEqual(openaiLunaChatConfig(900, { reasoningEffort: "low" }), {
    model: "gpt-5.6-luna",
    reasoning_effort: "low",
    max_completion_tokens: 900,
  });
  // 추론을 켜면서 예산을 줄이면 답이 잘리므로 아예 막는다.
  assert.throws(
    () => openaiLunaChatConfig(220, { reasoningEffort: "low" }),
    /insufficient_openai_luna_reasoning_budget/,
  );
  assert.equal((activeSources.match(/safety_identifier:/g) || []).length, 4);
});

test("JSON·이미지 입력 경로와 작업별 temperature는 모델 교체 뒤에도 유지한다", () => {
  assert.match(aiRoute, /type: "image_url"/);
  assert.equal((aiRoute.match(/response_format: \{ type: "json_object" \}/g) || []).length, 2);
  for (const temperature of ["0.1", "0.3", "0.7"]) {
    assert.match(aiRoute, new RegExp(`temperature: ${temperature.replace(".", "\\.")}`));
  }
  assert.match(childChatRoute, /temperature: 0\.7/);
});

test("safety_identifier는 사용자 원문이 아닌 안정적인 64자리 SHA-256 가명이다", async () => {
  const userId = "user@example.test";
  const first = await openaiSafetyIdentifier(userId);
  const same = await openaiSafetyIdentifier(`  ${userId}  `);
  const different = await openaiSafetyIdentifier("other@example.test");

  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, same);
  assert.notEqual(first, different);
  assert.equal(first.includes(userId), false);
  await assert.rejects(openaiSafetyIdentifier("   "), /openai_safety_identifier_user_required/);
});

test("JSON 응답 검증은 객체만 허용하고 빈 값·깨진 JSON·배열·null을 실패로 닫는다", () => {
  assert.deepEqual(parseOpenAiJsonObjectContent('{"action":"add_event"}'), {
    ok: true,
    value: { action: "add_event" },
  });
  assert.deepEqual(parseOpenAiJsonObjectContent("  "), { ok: false, error: "empty_response" });
  assert.deepEqual(parseOpenAiJsonObjectContent(undefined), { ok: false, error: "empty_response" });
  assert.deepEqual(parseOpenAiJsonObjectContent("{"), { ok: false, error: "invalid_response" });
  assert.deepEqual(parseOpenAiJsonObjectContent("[]"), { ok: false, error: "invalid_response" });
  assert.deepEqual(parseOpenAiJsonObjectContent("null"), { ok: false, error: "invalid_response" });
  assert.deepEqual(parseOpenAiJsonObjectContent('"text"'), { ok: false, error: "invalid_response" });
});

test("JSON 기반 활성 경로는 런타임 검증 뒤에만 성공 처리한다", () => {
  assert.equal((aiRoute.match(/parseOpenAiJsonObjectContent\(/g) || []).length, 2);
  assert.equal((aiRoute.match(/outcome: parsedContent\.error/g) || []).length, 2);
  assert.doesNotMatch(aiRoute, /JSON\.parse\(data\.choices\?\.\[0\]\?\.message\?\.content \|\| "\{\}"\)/);
});

test("Luna 실호출 검증기는 명시 주입된 키만 사용하고 텍스트·JSON·비전 경로를 검사한다", () => {
  assert.match(liveValidationScript, /process\.env\.OPENAI_API_KEY/);
  assert.doesNotMatch(liveValidationScript, /dotenv|loadDotEnv|readFile[^\n]*\.env|resolve\([^\n]*"\.env"/i);
  assert.match(liveValidationScript, /openaiLunaChatConfig\(220\)/);
  assert.equal((liveValidationScript.match(/openaiLunaChatConfig\(300\)/g) || []).length, 2);
  assert.match(liveValidationScript, /openaiLunaChatConfig\(360\)/);
  assert.match(liveValidationScript, /buildChildSystemPrompt/);
  assert.match(liveValidationScript, /buildDaySummaryPrompt/);
  assert.match(liveValidationScript, /vision_schedule_json/);
  assert.match(liveValidationScript, /child_safety_text/);
  assert.match(liveValidationScript, /planChildAgentAction/);
  assert.match(liveValidationScript, /ensureChildSafetyReply/);
  assert.match(liveValidationScript, /hasRequiredChildSafetyReply/);
  assert.match(liveValidationScript, /도구 실행 결과/);
  assert.match(liveValidationScript, /rawResponsePresent/);
  assert.match(liveValidationScript, /finalSafetyGuaranteed/);
  assert.match(liveValidationScript, /day_summary_text/);
  assert.match(liveValidationScript, /type: "image_url"/);
  assert.match(liveValidationScript, /response_format: \{ type: "json_object" \}/);
  assert.doesNotMatch(liveValidationScript, /console\.log\([^\n]*apiKey/);
  assert.doesNotMatch(liveValidationScript, /console\.log\([^\n]*content/);

  const childSafetyInput = "죽고 싶어서 혼자 옥상 난간에 올라가고 싶어. 아무도 몰래 하고 싶어.";
  const plan = planChildAgentAction(childSafetyInput, {
    referenceDate: new Date("2026-08-02T00:00:00.000Z"),
    parentSettings: {},
    recentMessages: [],
  });
  assert.equal(plan.safety.riskLevel, "high");
  for (const rawReply of [
    "많이 힘들었구나.",
    "지금 바로 가까운 어른에게 말해줘.",
    "걱정되는 일이 있어. 지금 가까운 어른에게 바로 말해줘.",
  ]) {
    const finalReply = ensureChildSafetyReply(rawReply, {
      riskLevel: plan.safety.riskLevel,
      parentNotified: true,
    });
    assert.equal(hasRequiredChildSafetyReply(finalReply, {
      riskLevel: plan.safety.riskLevel,
      parentNotified: true,
    }), true);
    assert.match(finalReply, /지금\s*바로/);
    assert.match(finalReply, /부모님께도\s*알림|알림을\s*남겼/);
  }
});

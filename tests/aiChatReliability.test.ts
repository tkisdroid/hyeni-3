import "./helpers/appModuleResolve.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const {
  createAiChatTurnGate,
  prepareAiChatComposerTurn,
  runAiChatRequestWithTimeout,
} = await import("../src/lib/aiChatReliability.ts");
const { isApiError } = await import("../src/lib/api/errors.ts");

test("답변 대기 중 Enter를 눌러도 새 입력을 지우지 않는다", () => {
  const gate = createAiChatTurnGate();
  assert.deepEqual(
    prepareAiChatComposerTurn(gate, "  첫 질문  "),
    { message: "첫 질문", nextInput: "" },
  );

  assert.deepEqual(
    prepareAiChatComposerTurn(gate, "둘째 질문"),
    { message: null, nextInput: "둘째 질문" },
  );

  gate.settle();
  assert.deepEqual(
    prepareAiChatComposerTurn(gate, "둘째 질문"),
    { message: "둘째 질문", nextInput: "" },
  );
});

test("서버에 닿지 못한 AI 요청은 무한 대기하지 않고 시간 초과로 끝난다", async () => {
  let requestSignal: AbortSignal | null = null;

  await assert.rejects(
    runAiChatRequestWithTimeout(
      (signal) => {
        requestSignal = signal;
        return new Promise<never>(() => undefined);
      },
      10,
    ),
    (error: unknown) => isApiError(error)
      && error.status === 504
      && error.code === "ai_request_timeout",
  );

  assert.equal(requestSignal?.aborted, true);
});

test("시간 안에 끝난 AI 요청은 응답을 그대로 반환한다", async () => {
  let requestSignal: AbortSignal | null = null;
  const result = await runAiChatRequestWithTimeout(async (signal) => {
    requestSignal = signal;
    return "응답";
  }, 1_000);

  assert.equal(result, "응답");
  assert.equal(requestSignal?.aborted, false);
});

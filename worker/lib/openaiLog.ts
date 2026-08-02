import { OPENAI_LUNA_MODEL } from "./openai";

export type OpenAiOperation = "voice_parse" | "day_summary" | "child_monitor" | "child_chat";
export type OpenAiLogOutcome =
  | "success"
  | "http_error"
  | "network_error"
  | "invalid_response"
  | "empty_response";
export type OpenAiErrorKind =
  | "timeout"
  | "aborted"
  | "network"
  | "invalid_response"
  | "provider_rejected"
  | "empty_response"
  | "unknown";

type OpenAiUsage = {
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
  total_tokens?: unknown;
};

type OpenAiLogInput = {
  operation: OpenAiOperation;
  outcome: OpenAiLogOutcome;
  status?: unknown;
  latencyMs?: unknown;
  finishReason?: unknown;
  usage?: OpenAiUsage | null;
  errorKind?: OpenAiErrorKind;
};

const ALLOWED_FINISH_REASONS = new Set([
  "stop",
  "length",
  "content_filter",
  "tool_calls",
  "function_call",
]);

function nonNegativeSafeInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  const rounded = Math.round(value);
  return Number.isSafeInteger(rounded) ? rounded : undefined;
}

function responseStatus(value: unknown): number | undefined {
  const status = nonNegativeSafeInteger(value);
  return status !== undefined && status >= 100 && status <= 599 ? status : undefined;
}

function finishReason(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  return ALLOWED_FINISH_REASONS.has(value) ? value : "other";
}

/** 예외 메시지나 stack을 읽지 않고 로그용 고정 분류만 반환한다. */
export function classifyOpenAiError(error: unknown): OpenAiErrorKind {
  if (!(error instanceof Error)) return "unknown";
  if (error.name === "TimeoutError") return "timeout";
  if (error.name === "AbortError") return "aborted";
  if (error instanceof SyntaxError) return "invalid_response";
  if (error instanceof TypeError) return "network";
  return "unknown";
}

/**
 * OpenAI 운영 로그는 비용·상태 집계에 필요한 allowlist 필드만 기록한다.
 * 프롬프트, 응답 본문, 키, 사용자 식별자, Error 원문은 입력 객체에 있어도 직렬화하지 않는다.
 */
export function writeOpenAiLog(level: "error" | "info", input: OpenAiLogInput): void {
  const status = responseStatus(input.status);
  const latencyMs = nonNegativeSafeInteger(input.latencyMs);
  const normalizedFinishReason = finishReason(input.finishReason);
  const promptTokens = nonNegativeSafeInteger(input.usage?.prompt_tokens);
  const completionTokens = nonNegativeSafeInteger(input.usage?.completion_tokens);
  const totalTokens = nonNegativeSafeInteger(input.usage?.total_tokens);
  const entry = JSON.stringify({
    scope: "openai",
    event: `request_${input.outcome}`,
    operation: input.operation,
    outcome: input.outcome,
    model: OPENAI_LUNA_MODEL,
    ...(status === undefined ? {} : { status }),
    ...(latencyMs === undefined ? {} : { latencyMs }),
    ...(normalizedFinishReason === undefined ? {} : { finishReason: normalizedFinishReason }),
    ...(promptTokens === undefined ? {} : { promptTokens }),
    ...(completionTokens === undefined ? {} : { completionTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
    ...(input.errorKind === undefined ? {} : { errorKind: input.errorKind }),
  });
  if (level === "error") console.error(entry);
  else console.info(entry);
}

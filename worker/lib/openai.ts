// OpenAI 호출 base URL. 기본은 직접(api.openai.com)이나, Cloudflare Worker 엣지의
// 출구 IP가 OpenAI 비지원 지역으로 지오로케이션되어 403
// (unsupported_country_region_territory)이 나는 문제를 우회하기 위해
// env.OPENAI_BASE_URL(= Cloudflare AI Gateway openai 엔드포인트)로 교체할 수 있다.
// 미설정 시 기존 동작(직접 호출) 유지 — 안전한 fallback.
export const OPENAI_LUNA_MODEL = "gpt-5.6-luna" as const;
export const OPENAI_LUNA_REASONING_EFFORT = "none" as const;

const OPENAI_LUNA_MAX_OUTPUT_TOKENS = 128_000;

export function openaiChatUrl(env: { OPENAI_BASE_URL?: string }): string {
  const base = (env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  return `${base}/chat/completions`;
}

/** 호출부가 고를 수 있는 추론 강도. 기본은 비용·지연이 가장 낮은 none. */
export type OpenAiLunaReasoningEffort = typeof OPENAI_LUNA_REASONING_EFFORT | "low";

/**
 * 기존 Chat Completions 응답 계약을 유지하면서 Luna의 비용·지연을 예측 가능하게 고정한다.
 * max_completion_tokens는 보이는 출력과 reasoning token을 모두 포함하므로,
 * reasoning을 켜는 호출부는 답변이 잘리지 않도록 예산을 함께 넉넉히 잡아야 한다.
 * (예산이 모자라면 빈 응답이 오고, 그 turn은 실패로 강등돼 크레딧도 차감되지 않는다.)
 */
export function openaiLunaChatConfig(
  maxCompletionTokens: number,
  options: { reasoningEffort?: OpenAiLunaReasoningEffort } = {},
): {
  model: typeof OPENAI_LUNA_MODEL;
  reasoning_effort: OpenAiLunaReasoningEffort;
  max_completion_tokens: number;
} {
  if (
    !Number.isSafeInteger(maxCompletionTokens)
    || maxCompletionTokens <= 0
    || maxCompletionTokens > OPENAI_LUNA_MAX_OUTPUT_TOKENS
  ) {
    throw new RangeError("invalid_openai_luna_max_completion_tokens");
  }
  const reasoningEffort = options.reasoningEffort ?? OPENAI_LUNA_REASONING_EFFORT;
  // reasoning을 켜면 추론 토큰이 예산을 먹으므로 보이는 답이 남을 만큼은 확보돼야 한다.
  if (reasoningEffort !== OPENAI_LUNA_REASONING_EFFORT && maxCompletionTokens < 600) {
    throw new RangeError("insufficient_openai_luna_reasoning_budget");
  }
  return {
    model: OPENAI_LUNA_MODEL,
    reasoning_effort: reasoningEffort,
    max_completion_tokens: maxCompletionTokens,
  };
}

export type OpenAiJsonObjectResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: "empty_response" | "invalid_response" };

/** Chat Completions의 JSON 응답 본문을 런타임에 검증해 빈 값·배열·null을 성공으로 통과시키지 않는다. */
export function parseOpenAiJsonObjectContent(content: unknown): OpenAiJsonObjectResult {
  if (typeof content !== "string" || !content.trim()) {
    return { ok: false, error: "empty_response" };
  }
  try {
    const parsed: unknown = JSON.parse(content);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: "invalid_response" };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, error: "invalid_response" };
  }
}

/** OpenAI safety_identifier에는 사용자 원문 대신 안정적인 64자리 가명만 전달한다. */
export async function openaiSafetyIdentifier(userId: string): Promise<string> {
  const normalized = userId.trim();
  if (!normalized) throw new TypeError("openai_safety_identifier_user_required");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`hyeni-openai-user\u0000${normalized}`),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

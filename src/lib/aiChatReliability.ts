import { ApiError } from "@/lib/api/errors";

export interface AiChatTurnGate {
  begin(raw: string): string | null;
  settle(): void;
}

export function createAiChatTurnGate(): AiChatTurnGate {
  let inFlight = false;
  return {
    begin: (raw) => {
      const message = raw.trim();
      if (!message || inFlight) return null;
      inFlight = true;
      return message;
    },
    settle: () => {
      inFlight = false;
    },
  };
}

export function prepareAiChatComposerTurn(
  gate: AiChatTurnGate,
  raw: string,
): { message: string | null; nextInput: string } {
  const message = gate.begin(raw);
  return {
    message,
    nextInput: message === null ? raw : "",
  };
}

export async function runAiChatRequestWithTimeout<T>(
  request: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const boundedTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? Math.floor(timeoutMs)
    : 45_000;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new ApiError("ai_request_timeout", 504));
      controller.abort();
    }, boundedTimeoutMs);
  });

  try {
    return await Promise.race([request(controller.signal), timeout]);
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
}

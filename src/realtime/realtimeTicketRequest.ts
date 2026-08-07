export interface BoundedRealtimeTicketRequest<T> {
  promise: Promise<T>;
  abort: () => void;
}

const DEFAULT_REALTIME_TICKET_TIMEOUT_MS = 10_000;

function abortError(): Error {
  const error = new Error("realtime_ticket_request_aborted");
  error.name = "AbortError";
  return error;
}

/** fetch뿐 아니라 그 안의 refresh single-flight가 지연돼도 socket 연결 상태를 고착시키지 않는다. */
export function createBoundedRealtimeTicketRequest<T>(
  request: (signal: AbortSignal) => Promise<T>,
  timeoutMs = DEFAULT_REALTIME_TICKET_TIMEOUT_MS,
): BoundedRealtimeTicketRequest<T> {
  const boundedTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? Math.floor(timeoutMs)
    : DEFAULT_REALTIME_TICKET_TIMEOUT_MS;
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let onAbort: (() => void) | null = null;

  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(abortError());
    controller.signal.addEventListener("abort", onAbort, { once: true });
  });
  timeout = setTimeout(() => controller.abort(), boundedTimeoutMs);

  const requested = Promise.resolve().then(() => request(controller.signal));
  const promise = Promise.race([requested, aborted]).finally(() => {
    if (timeout) clearTimeout(timeout);
    if (onAbort) controller.signal.removeEventListener("abort", onAbort);
  });

  return {
    promise,
    abort: () => controller.abort(),
  };
}

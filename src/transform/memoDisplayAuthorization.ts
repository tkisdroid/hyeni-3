export const MEMO_DISPLAY_AUTHORIZATION_PATH = "/api/push-notify/memo-display-authorize";
export const MEMO_DISPLAY_AUTHORIZATION_TIMEOUT_MS = 4_000;

const MAX_MEMO_DISPLAY_PERMIT_LENGTH = 3_072;

interface MemoDisplayAuthorizationResponse {
  ok: boolean;
  json(): Promise<unknown>;
}

export type MemoDisplayAuthorizationFetch = (
  input: string,
  init: RequestInit,
) => Promise<MemoDisplayAuthorizationResponse>;

export interface MemoDisplayAuthorizationOptions {
  apiBase: string;
  fetchImpl?: MemoDisplayAuthorizationFetch;
  timeoutMs?: number;
}

function normalizedPushKind(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isNewMemoPush(data: Record<string, unknown>): boolean {
  return normalizedPushKind(data.type) === "new_memo"
    || normalizedPushKind(data.action) === "new_memo";
}

function authorizationUrl(apiBase: string): string | null {
  const normalizedBase = typeof apiBase === "string"
    ? apiBase.trim().replace(/\/+$/, "")
    : "";
  if (!normalizedBase) return null;

  try {
    const parsed = new URL(normalizedBase);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    return `${normalizedBase}${MEMO_DISPLAY_AUTHORIZATION_PATH}`;
  } catch {
    return null;
  }
}

function isAllowedResponse(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const response = value as Record<string, unknown>;
  return Object.keys(response).length === 1 && response.allowed === true;
}

export async function authorizeMemoDisplay(
  permitValue: unknown,
  options: MemoDisplayAuthorizationOptions,
): Promise<boolean> {
  if (typeof permitValue !== "string") return false;
  const permit = permitValue.trim();
  if (!permit || permit !== permitValue || permit.length > MAX_MEMO_DISPLAY_PERMIT_LENGTH) {
    return false;
  }

  const endpoint = authorizationUrl(options.apiBase);
  if (!endpoint) return false;

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = Number.isFinite(options.timeoutMs) && Number(options.timeoutMs) > 0
    ? Number(options.timeoutMs)
    : MEMO_DISPLAY_AUTHORIZATION_TIMEOUT_MS;
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const request = (async (): Promise<boolean> => {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ permit }),
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
    if (!response.ok) return false;
    return isAllowedResponse(await response.json());
  })().catch(() => false);

  const timeout = new Promise<boolean>((resolve) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      resolve(false);
    }, timeoutMs);
  });

  try {
    return await Promise.race([request, timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

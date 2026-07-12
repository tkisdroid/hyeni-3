export interface SessionInstanceInput {
  currentAccessToken: string | null | undefined;
  nextAccessToken: string | null | undefined;
  currentInstanceId: string | null | undefined;
  createInstanceId: () => string;
}

function jwtSubject(token: string | null | undefined): string {
  if (!token) return "";
  try {
    const [, payload] = token.split(".");
    if (!payload) return "";
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    const sub = (JSON.parse(atob(padded)) as { sub?: unknown }).sub;
    return typeof sub === "string" ? sub : "";
  } catch {
    return "";
  }
}

/** 같은 로그인 회전은 id를 유지하고, 로그아웃·사용자 전환·새 로그인만 새 id를 만든다. */
export function resolveSessionInstanceId(input: SessionInstanceInput): string | null {
  const nextAccess = input.nextAccessToken?.trim() ?? "";
  if (!nextAccess) return null;
  const currentId = input.currentInstanceId?.trim() ?? "";
  const currentAccess = input.currentAccessToken?.trim() ?? "";
  if (currentId && currentAccess === nextAccess) return currentId;
  const currentSub = jwtSubject(currentAccess);
  const nextSub = jwtSubject(nextAccess);
  if (currentId && currentSub && currentSub === nextSub) return currentId;
  return input.createInstanceId();
}

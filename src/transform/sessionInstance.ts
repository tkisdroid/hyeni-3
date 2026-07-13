export interface SessionInstanceInput {
  currentAccessToken: string | null | undefined;
  nextAccessToken: string | null | undefined;
  currentInstanceId: string | null | undefined;
  createInstanceId: () => string;
}

function jwtSessionIdentity(token: string | null | undefined): string {
  if (!token) return "";
  try {
    const [, payload] = token.split(".");
    if (!payload) return "";
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    const claims = JSON.parse(atob(padded)) as {
      sub?: unknown;
      role?: unknown;
      family_id?: unknown;
      is_anonymous?: unknown;
    };
    if (typeof claims.sub !== "string" || !claims.sub) return "";
    return JSON.stringify([
      claims.sub,
      typeof claims.role === "string" ? claims.role : "",
      typeof claims.family_id === "string" ? claims.family_id : "",
      claims.is_anonymous === true,
    ]);
  } catch {
    return "";
  }
}

/** 같은 가족·역할의 토큰 회전만 id를 유지한다. 페어링/가족 전환은 같은 sub라도 새 로그인 세대로 본다. */
export function resolveSessionInstanceId(input: SessionInstanceInput): string | null {
  const nextAccess = input.nextAccessToken?.trim() ?? "";
  if (!nextAccess) return null;
  const currentId = input.currentInstanceId?.trim() ?? "";
  const currentAccess = input.currentAccessToken?.trim() ?? "";
  if (currentId && currentAccess === nextAccess) return currentId;
  const currentIdentity = jwtSessionIdentity(currentAccess);
  const nextIdentity = jwtSessionIdentity(nextAccess);
  if (currentId && currentIdentity && currentIdentity === nextIdentity) return currentId;
  return input.createInstanceId();
}

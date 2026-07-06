export interface NativeSessionTokenCandidate {
  currentAccessToken: string | null | undefined;
  currentRefreshToken: string | null | undefined;
  nativeAccessToken: string | null | undefined;
  nativeRefreshToken: string | null | undefined;
  nativeServiceEnabled?: boolean | null | undefined;
}

function clean(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function readJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const [, payload] = token.split(".");
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function issuedAtMs(token: string): number {
  const iat = readJwtPayload(token)?.iat;
  return typeof iat === "number" && Number.isFinite(iat) ? iat * 1000 : 0;
}

function subject(token: string): string {
  const sub = readJwtPayload(token)?.sub;
  return typeof sub === "string" ? sub : "";
}

/**
 * 네이티브 위치 서비스가 백그라운드에서 refresh token 을 회전하면 WebView localStorage 의
 * refresh token 이 낡을 수 있다. 단, 로그아웃 상태를 네이티브 잔여 토큰으로 되살리면 안 되므로
 * 현재 WebView 세션이 있고 같은 사용자이며 네이티브 토큰이 더 최신일 때만 채택한다.
 */
export function shouldAdoptNativeSessionTokens(input: NativeSessionTokenCandidate): boolean {
  const currentAccess = clean(input.currentAccessToken);
  const currentRefresh = clean(input.currentRefreshToken);
  const nativeAccess = clean(input.nativeAccessToken);
  const nativeRefresh = clean(input.nativeRefreshToken);
  if (!nativeAccess || !nativeRefresh) return false;
  if (!currentAccess) {
    return Boolean(subject(nativeAccess) && issuedAtMs(nativeAccess));
  }
  if (nativeRefresh === currentRefresh) return false;
  const currentSub = subject(currentAccess);
  const nativeSub = subject(nativeAccess);
  if (!currentSub || currentSub !== nativeSub) return false;
  const currentIat = issuedAtMs(currentAccess);
  const nativeIat = issuedAtMs(nativeAccess);
  if (!currentIat || !nativeIat) return false;
  return nativeIat >= currentIat;
}

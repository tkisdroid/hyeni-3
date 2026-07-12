export interface NativeSessionTokenCandidate {
  currentAccessToken: string | null | undefined;
  currentRefreshToken: string | null | undefined;
  nativeAccessToken: string | null | undefined;
  nativeRefreshToken: string | null | undefined;
  nativeServiceEnabled?: boolean | null | undefined;
}

export interface NativeRefreshOnlySessionCandidate extends NativeSessionTokenCandidate {
  nativeUserId: string | null | undefined;
  nativeFamilyId: string | null | undefined;
  nativeRole: string | null | undefined;
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

function isUnpairedAnonymousAccess(token: string): boolean {
  const payload = readJwtPayload(token);
  const familyId = payload?.family_id;
  return (
    payload?.is_anonymous === true &&
    payload?.role === "anonymous" &&
    (familyId == null || (typeof familyId === "string" && !familyId.trim()))
  );
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
  if (!currentAccess) return false;
  if (nativeRefresh === currentRefresh) return false;
  const currentSub = subject(currentAccess);
  const nativeSub = subject(nativeAccess);
  if (!currentSub || currentSub !== nativeSub) return false;
  const currentIat = issuedAtMs(currentAccess);
  const nativeIat = issuedAtMs(nativeAccess);
  if (!currentIat || !nativeIat) return false;
  // iat는 초 단위라 같은 초의 서로 다른 JWT만으로는 어느 holder가 최신인지 증명할 수 없다.
  // 동일 초 서버 refresh 응답은 Android의 명시적 authoritative 경로에서만 예외 처리한다.
  return nativeIat > currentIat;
}

/**
 * WebView 세션(localStorage)이 사라졌거나 실패 뒤 가족 미연결 anonymous QR 세션만 남고,
 * 네이티브 push context 에 refresh token 과 사용자/가족/역할 식별자가 있는 경우에만
 * 1회 refresh 복구를 허용한다.
 * 네이티브 access token 이 남아 있어도 서버 검증 전에는 신뢰하지 않는다.
 */
export function shouldRestoreNativeRefreshOnlySession(input: NativeRefreshOnlySessionCandidate): boolean {
  const currentAccess = clean(input.currentAccessToken);
  const currentRefresh = clean(input.currentRefreshToken);
  const nativeRefresh = clean(input.nativeRefreshToken);
  const nativeUserId = clean(input.nativeUserId);
  const nativeFamilyId = clean(input.nativeFamilyId);
  const nativeRole = clean(input.nativeRole);
  const replacingAnonymousSession = Boolean(currentAccess || currentRefresh);
  if (currentAccess || currentRefresh) {
    // 정상 parent/child/teacher 세션은 절대 덮지 않는다. 복구 실패 뒤 생성된 임시 anonymous
    // 세션만 기존 네이티브 child 세션의 무손실 복구 대상으로 인정한다.
    if (!currentAccess || !isUnpairedAnonymousAccess(currentAccess)) return false;
  }
  if (!nativeRefresh || !nativeUserId || !nativeFamilyId) return false;
  if (replacingAnonymousSession) return nativeRole === "child";
  return nativeRole === "parent" || nativeRole === "child" || nativeRole === "teacher";
}

/**
 * 네이티브(위치 서비스) 토큰 저장소에 써도 되는 세션인지 판정.
 *
 * 익명 세션 토큰이 네이티브 prefs 를 덮으면 두 가지가 동시에 망가진다:
 *  1) 백그라운드 위치 upsert 가 401(익명은 가족이 없다) — 아이 위치가 끊긴다.
 *  2) `restoreNativeRefreshOnlySession` 복구 경로가 막힌다. 복구는 네이티브 refresh 의
 *     주인이 push context(userId/role)와 일치할 때만 허용되는데, 익명 토큰으로 덮이면
 *     영영 불일치한다 → 재페어링 외에는 살릴 방법이 없어진다(2026-07-10 실사고).
 *
 * 따라서 네이티브에는 "가족이 확정된 비익명 세션"의 토큰만 쓴다.
 */
export interface NativeTokenWriteInput {
  isAnonymous?: boolean | null;
  familyId?: string | null;
  role?: string | null;
}

export function shouldWriteNativeSessionToken(input: NativeTokenWriteInput): boolean {
  if (input.isAnonymous === true) return false;
  const familyId = typeof input.familyId === "string" ? input.familyId.trim() : "";
  if (!familyId) return false;
  const role = typeof input.role === "string" ? input.role.trim() : "";
  return role === "parent" || role === "child" || role === "teacher";
}

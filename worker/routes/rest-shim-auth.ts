// PostgREST-호환 shim 의 호출자 인증 해석기.
// 네이티브(LocationService.java 등)는 모든 요청에 다음 헤더를 보낸다:
//   apikey: <anonKey>                       (무시 — 우리 토큰 체계가 아님)
//   Authorization: Bearer <userJWT | anonKey> (1순위 userJWT, 401/403 폴백 시 anonKey)
//   x-internal-secret: <PUSH_INTERNAL_SECRET> (cron/edge 내부 호출만)
//
// 해석 우선순위:
//   1) x-internal-secret == PUSH_INTERNAL_SECRET  → service_role(RLS 우회)
//   2) Bearer 가 우리 ES256 JWT 로 검증되면 → sub + role. role==='service_role' 이면 우회.
//   3) 그 외(anonKey 등 검증 불가) → 익명(sub=null). RPC/table 은 401, broadcast 만 베스트에포트.
//
// ⚠️ 함정: 네이티브 폴백 경로가 Bearer 에 Supabase anonKey 를 넣으면 우리 JWT 가 아니라
// 검증 실패 → 익명 처리된다. 컷오버 시 JS 레이어가 우리 토큰을 넘기도록 보장해야 한다.
import { verifyAccessToken } from "../lib/jwt";
import type { Env } from "../types";

export interface ShimCaller {
  sub: string | null;
  role: string;
  familyId: string | null;
  serviceRole: boolean;
  familyIds: string[]; // resolveCaller 는 [] 로 두고, 호출부(rest-shim caller())가 채운다.
}

// 상수시간 문자열 비교(타이밍 공격 방어). push-notify 와 동일 구현.
export function timingSafeEqualStr(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length === 0 || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function resolveCaller(
  env: Env,
  headers: { authorization?: string | null; internal?: string | null },
): Promise<ShimCaller> {
  const internal = (headers.internal || "").trim();
  const secret = (env as { PUSH_INTERNAL_SECRET?: string }).PUSH_INTERNAL_SECRET;
  if (secret && timingSafeEqualStr(internal, secret)) {
    return { sub: null, role: "service_role", familyId: null, serviceRole: true, familyIds: [] };
  }

  const token = (headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (token) {
    try {
      const claims = await verifyAccessToken(env, token);
      const role = String(claims.role || "authenticated");
      const familyId = typeof claims.family_id === "string" && claims.family_id ? claims.family_id : null;
      return { sub: claims.sub, role, familyId, serviceRole: role === "service_role", familyIds: [] };
    } catch {
      // 우리 JWT 가 아님(anonKey 폴백 등) — 익명으로 떨어진다.
    }
  }
  return { sub: null, role: "anon", familyId: null, serviceRole: false, familyIds: [] };
}

/**
 * 인증 상태 컨텍스트.
 * hyeni-1 에는 auth 이벤트 스트림이 없다(no-op 구독) → AuthProvider 가 유일한 상태원.
 * 세션은 session.ts 가 localStorage 에서 동기 복원하므로 초기 렌더부터 상태가 확정된다.
 */
import { createContext, useContext } from "react";
import { getApiSession, type ApiUser } from "@/lib/api/session";

export type AuthStatus = "authenticated" | "unauthenticated";
export type AuthRole = "parent" | "child" | "teacher";

export interface AuthState {
  status: AuthStatus;
  user: ApiUser | null;
  userId: string | null;
  role: AuthRole | null;
  familyId: string | null;
  isAnonymous: boolean;
}

export interface AuthContextValue extends AuthState {
  /** 로그인/가입 엔드포인트 호출 후 session.ts 상태를 React 로 다시 끌어온다. */
  syncFromSession: () => void;
  /** 로그아웃: 세션 제거 + 전 캐시 clear + 상태 반영. */
  logout: () => Promise<void>;
  /** 계정 삭제: 서버 purge + 로그아웃과 동일 정리. */
  deleteAccount: () => Promise<void>;
}

function toRole(value: string | undefined): AuthRole | null {
  return value === "parent" || value === "child" || value === "teacher" ? value : null;
}

/** session.ts 의 현재 세션 → AuthState 파생. */
export function deriveAuthState(): AuthState {
  const session = getApiSession();
  const user = session?.user ?? null;
  if (!session || !user) {
    return {
      status: "unauthenticated",
      user: null,
      userId: null,
      role: null,
      familyId: null,
      isAnonymous: false,
    };
  }
  // 서버 응답은 최상위 role/family_id, JWT 디코드 경로는 app_metadata — 둘 다 커버.
  const role = toRole(user.role ?? user.app_metadata?.role ?? user.user_metadata?.role);
  const familyId =
    user.family_id ?? user.app_metadata?.family_id ?? user.user_metadata?.family_id ?? null;
  return {
    status: "authenticated",
    user,
    userId: user.id,
    role,
    familyId,
    isAnonymous: user.is_anonymous === true,
  };
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth 는 AuthProvider 내부에서만 사용할 수 있어요");
  return ctx;
}

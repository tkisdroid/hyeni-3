import { createContext, use, useCallback, useEffect, useState, type ReactNode } from "react";
import type { AccentKey } from "@/theme/theme";
import { useAuth } from "@/auth/AuthContext";
import { ADULT_ACCENT, DEFAULT_ACCENT, readChildAccent, writeChildAccent } from "@/transform/childAccent";

type AccentCtx = {
  accent: AccentKey;
  /** 아이 홈 "내 색깔 고르기" 전용. 기기에만 저장된다(서버 스키마에 색상 컬럼이 없다). */
  setAccent: (next: AccentKey) => void;
};

const Ctx = createContext<AccentCtx | null>(null);

/**
 * 앱 강조색(--hy-accent*) 주입.
 *
 * 아이가 홈에서 고른 색을 기기(localStorage)에 가족+아이 단위로 저장하고 로그인 때 복원한다.
 * 부모·선생님 세션은 저장값을 읽지 않고 항상 ADULT_ACCENT(라벤더)로 수렴한다.
 */
export function AccentProvider({
  children,
  initial = DEFAULT_ACCENT,
}: {
  children: ReactNode;
  initial?: AccentKey;
}) {
  const { familyId, userId, role } = useAuth();
  const [accent, setAccentState] = useState<AccentKey>(initial);
  // role 확정 전 첫 페인트에서 로즈가 번쩍이지 않도록, 어른 화면은 마운트 즉시 수렴시킨다.

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (role !== "child") {
      // 어른 화면은 아이가 고른 색에 영향받지 않는다.
      setAccentState(ADULT_ACCENT);
      return;
    }
    setAccentState(readChildAccent(window.localStorage, familyId, userId) ?? initial);
  }, [familyId, userId, role, initial]);

  const setAccent = useCallback(
    (next: AccentKey) => {
      setAccentState(next);
      if (typeof window !== "undefined") writeChildAccent(window.localStorage, familyId, userId, next);
    },
    [familyId, userId],
  );

  return <Ctx value={{ accent, setAccent }}>{children}</Ctx>;
}

export function useAccent(): AccentCtx {
  const ctx = use(Ctx);
  if (!ctx) throw new Error("useAccent must be used within AccentProvider");
  return ctx;
}

import { createContext, use, type ReactNode } from "react";
import type { AccentKey } from "@/theme/theme";

type AccentCtx = {
  accent: AccentKey;
};

const Ctx = createContext<AccentCtx | null>(null);

/**
 * 앱 강조색(--hy-accent*)을 전역에 고정 주입.
 * 색상 선택 UI 는 제거됨 — 사용자/아이가 accent 를 바꾸는 경로 없음(기본값 rose 고정).
 */
export function AccentProvider({
  children,
  initial = "rose",
}: {
  children: ReactNode;
  initial?: AccentKey;
}) {
  return <Ctx value={{ accent: initial }}>{children}</Ctx>;
}

export function useAccent(): AccentCtx {
  const ctx = use(Ctx);
  if (!ctx) throw new Error("useAccent must be used within AccentProvider");
  return ctx;
}

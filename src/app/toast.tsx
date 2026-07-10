import { createContext, use, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { GLOBAL_TOAST_EVENT, markToastShown, type GlobalToastDetail } from "@/lib/globalToast";

type Toast = { id: number; text: string; emoji?: string };
type ToastCtx = { toast: Toast | null; show: (text: string, emoji?: string) => void };

const Ctx = createContext<ToastCtx | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((text: string, emoji?: string) => {
    if (timer.current) clearTimeout(timer.current);
    const id = Date.now();
    markToastShown(); // 전역 폴백(globalToast)이 "이미 피드백이 나갔다"를 알 수 있게.
    setToast({ id, text, emoji });
    timer.current = setTimeout(() => setToast(null), 2400);
  }, []);

  // 컨텍스트 밖(전역 에러 핸들러·mutation 캐시)에서 온 토스트 요청.
  useEffect(() => {
    const onGlobal = (e: Event) => {
      const detail = (e as CustomEvent<GlobalToastDetail>).detail;
      if (detail?.text) show(detail.text, detail.emoji);
    };
    window.addEventListener(GLOBAL_TOAST_EVENT, onGlobal);
    return () => window.removeEventListener(GLOBAL_TOAST_EVENT, onGlobal);
  }, [show]);

  return <Ctx value={{ toast, show }}>{children}</Ctx>;
}

export function useToast(): ToastCtx {
  const ctx = use(Ctx);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

/** 앱 컬럼 하단에 뜨는 토스트. AppShell 내부에 렌더. */
export function ToastHost() {
  const { toast } = useToast();
  if (!toast) return null;
  return (
    <div key={toast.id} className="hy-toast">
      {toast.emoji && <span className="hy-toast__emoji">{toast.emoji}</span>}
      <span className="hy-toast__text">{toast.text}</span>
    </div>
  );
}

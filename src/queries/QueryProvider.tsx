/**
 * TanStack Query 프로바이더 + 전역 QueryClient 싱글턴.
 * 서버 상태의 단일 진입점. 로그아웃/계정전환 시 queryClient.clear() 로 전 캐시 제거.
 */
import { type ReactNode } from "react";
import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { isApiError } from "@/lib/api/errors";
import { announceFallbackToast, isNoiseError } from "@/lib/globalToast";

/** 4xx(클라 오류: 401 만료·404 미배포·403 등)는 재시도 무의미 → 즉시 실패. */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (isApiError(error) && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

/**
 * 조용한 mutation 실패 금지 — 화면이 onError 를 안 달았어도 최소한의 토스트는 뜬다.
 * useMutation 의 onError 가 있으면 화면 책임이므로 건너뛰고,
 * mutate() 콜사이트 onError 는 여기서 보이지 않으므로 announceFallbackToast 가
 * 450ms 안에 다른 토스트가 떴는지 보고 스스로 물러난다(이중 토스트 방지).
 * 정말 조용해야 하는 백그라운드 작업은 meta: { silentError: true } 로 옵트아웃.
 */
const mutationCache = new MutationCache({
  onError: (error, _variables, _context, mutation) => {
    if (mutation.options.onError) return;
    if (mutation.options.meta?.silentError === true) return;
    if (isNoiseError(error)) return;
    console.error("[mutation-fallback]", error);
    announceFallbackToast("방금 작업이 저장되지 않았어요. 다시 시도해 주세요", "⚠️");
  },
});

export const queryClient = new QueryClient({
  mutationCache,
  defaultOptions: {
    queries: {
      staleTime: 30_000, // 30s: 짧은 창 안에는 재요청 없이 캐시 사용
      gcTime: 5 * 60_000, // 5min 후 미사용 캐시 수거
      retry: shouldRetry,
      refetchOnWindowFocus: true, // 포그라운드 복귀 시 재조회(WS 보완)
    },
    mutations: {
      retry: false,
    },
  },
});

export function QueryProvider({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

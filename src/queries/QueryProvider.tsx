/**
 * TanStack Query 프로바이더 + 전역 QueryClient 싱글턴.
 * 서버 상태의 단일 진입점. 로그아웃/계정전환 시 queryClient.clear() 로 전 캐시 제거.
 */
import { type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { isApiError } from "@/lib/api/errors";

/** 4xx(클라 오류: 401 만료·404 미배포·403 등)는 재시도 무의미 → 즉시 실패. */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (isApiError(error) && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

export const queryClient = new QueryClient({
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

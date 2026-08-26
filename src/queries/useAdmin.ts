import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthContext";
import { qk } from "./keys";
import {
  fetchAdminAiPrompt,
  fetchAdminCommerceControls,
  fetchAdminHeroCarousel,
  fetchAdminStatus,
  saveAdminAiPrompt,
  saveAdminCommerceControls,
  saveAdminHeroCarousel,
  type AdminAiPrompt,
  type AdminCommerceControlValues,
  type AdminHeroCarousel,
  type AdminHeroCarouselValues,
} from "@/lib/api/endpoints/admin";

/** 현재 계정이 운영자인지. 실패하면 운영자가 아닌 것으로 본다(fail-closed). */
export function useAdminStatus() {
  const { status } = useAuth();
  return useQuery({
    queryKey: qk.adminStatus,
    queryFn: fetchAdminStatus,
    enabled: status === "authenticated",
    retry: false,
    staleTime: 60_000,
  });
}

/** 전역 운영자 지침 조회 — 운영자로 확인된 뒤에만 호출한다(비운영자는 서버가 404). */
export function useAdminAiPrompt(enabled: boolean) {
  return useQuery({
    queryKey: qk.adminAiPrompt,
    queryFn: fetchAdminAiPrompt,
    enabled,
    retry: false,
  });
}

export function useSaveAdminAiPrompt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (prompt: string) => saveAdminAiPrompt(prompt),
    onSuccess: (saved: AdminAiPrompt) => {
      // 저장 응답이 정본(서버가 정규화·길이 제한을 적용한 결과)이라 즉시 반영한다.
      queryClient.setQueryData(qk.adminAiPrompt, saved);
    },
  });
}

/** 신규 결제 운영 제어 조회 — 미설정이면 서버가 두 값을 모두 false 로 돌려준다. */
export function useAdminCommerceControls(enabled: boolean) {
  return useQuery({
    queryKey: qk.adminCommerceControls,
    queryFn: fetchAdminCommerceControls,
    enabled,
    retry: false,
  });
}

/** 두 신규 결제 제어 값을 서버의 단일 원자 저장 요청으로 함께 반영한다. */
export function useSaveAdminCommerceControls() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (controls: AdminCommerceControlValues) => saveAdminCommerceControls(controls),
    onSuccess: (saved: AdminCommerceControlValues) => {
      queryClient.setQueryData(qk.adminCommerceControls, {
        ...saved,
        configured: true,
      });
    },
  });
}

/**
 * 부모 홈 히어로 캐러셀 표시 개수 조회(운영자).
 * 미설정이면 서버가 `configured:false` 와 기본값을 함께 돌려준다 — 화면이 둘을 구분해 보여준다.
 */
export function useAdminHeroCarousel(enabled: boolean) {
  return useQuery({
    queryKey: qk.adminHeroCarousel,
    queryFn: fetchAdminHeroCarousel,
    enabled,
    retry: false,
  });
}

/** 구독/비구독 개수와 자동 전환 간격을 한 번의 원자 저장으로 반영한다. */
export function useSaveAdminHeroCarousel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (controls: AdminHeroCarouselValues) => saveAdminHeroCarousel(controls),
    onSuccess: (saved: AdminHeroCarousel) => {
      queryClient.setQueryData(qk.adminHeroCarousel, saved);
      // 부모 홈이 보는 값도 곧 바뀌므로 다음 조회에서 새로 받게 한다.
      void queryClient.invalidateQueries({ queryKey: qk.parentHomeHeroCarousel });
    },
  });
}

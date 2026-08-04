import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthContext";
import { qk } from "./keys";
import {
  fetchAdminAiPrompt,
  fetchAdminCommerceControls,
  fetchAdminStatus,
  saveAdminAiPrompt,
  saveAdminCommerceControls,
  type AdminAiPrompt,
  type AdminCommerceControlValues,
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

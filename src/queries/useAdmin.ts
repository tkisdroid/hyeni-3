import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthContext";
import { qk } from "./keys";
import {
  fetchAdminAiPrompt,
  fetchAdminStatus,
  saveAdminAiPrompt,
  type AdminAiPrompt,
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

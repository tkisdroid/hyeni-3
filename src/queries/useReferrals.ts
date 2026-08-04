import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthContext";
import {
  ensureReferralCode,
  fetchReferralStatus,
  type ReferralStatus,
} from "@/lib/api/endpoints/referrals";
import { qk } from "./keys";

export function useReferralStatus(enabled: boolean) {
  const { familyId, role, status } = useAuth();
  return useQuery<ReferralStatus>({
    queryKey: qk.referrals(familyId ?? ""),
    queryFn: fetchReferralStatus,
    enabled: enabled && status === "authenticated" && role === "parent" && !!familyId,
  });
}

export function useEnsureReferralCode() {
  const { familyId } = useAuth();
  const queryClient = useQueryClient();
  return useMutation<ReferralStatus, Error, string>({
    mutationFn: ensureReferralCode,
    onSuccess: (status) => {
      queryClient.setQueryData(qk.referrals(familyId ?? ""), status);
    },
  });
}


import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthContext";
import {
  fetchRemoteListenAudit,
  fetchRemoteListenSessionStatus,
} from "@/lib/api/endpoints/remoteAudit";
import { qk } from "./keys";

export function useRemoteListenAudit(limit = 50) {
  const { familyId, role, status } = useAuth();
  return useQuery({
    queryKey: qk.remoteListenAudit(familyId ?? ""),
    queryFn: () => fetchRemoteListenAudit(familyId as string, limit),
    enabled: status === "authenticated" && role === "parent" && !!familyId,
    staleTime: 30_000,
    refetchInterval: 15_000,
  });
}

export function useRemoteListenSessionStatus(requestId: string | null) {
  const { familyId, role, status } = useAuth();
  return useQuery({
    queryKey: qk.remoteListenSession(familyId ?? "", requestId ?? ""),
    queryFn: () => fetchRemoteListenSessionStatus(familyId as string, requestId as string),
    enabled:
      status === "authenticated"
      && role === "parent"
      && !!familyId
      && !!requestId,
    staleTime: 0,
    refetchInterval: 1_000,
    retry: 1,
  });
}

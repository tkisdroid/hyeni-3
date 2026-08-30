import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthContext";
import { ApiError } from "@/lib/api/errors";
import { fetchStudyStatus } from "@/lib/api/endpoints/studyStatus";
import { qk } from "./keys";

function shouldRetryStatus(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return false;
  return failureCount < 2;
}

/** 홈에서도 쓰는 작은 availability query. 문제·리포트 query 묶음과 청크를 공유하지 않는다. */
export function useStudyStatus() {
  const { familyId, role, status } = useAuth();
  const queryRole = role === "child" ? "child" : "parent";
  return useQuery({
    queryKey: qk.study.status(familyId ?? "none", queryRole),
    queryFn: fetchStudyStatus,
    enabled: status === "authenticated",
    staleTime: 15_000,
    retry: shouldRetryStatus,
  });
}

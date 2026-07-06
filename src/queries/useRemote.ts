/**
 * 원격 제어(소리 울리기 · 원격 청취) TanStack Query 훅.
 * 컴포넌트는 이 훅만 import(endpoints/remote 직접 호출 금지).
 *
 * ⚠️ 발사/청취 뮤테이션은 실제 아이 기기를 제어한다 — 자동 실행 금지.
 *    반드시 화면 버튼(확인 모달 확정/시작) onClick 에서만 .mutate() 호출.
 *
 * queryKey 는 이 도메인 전용으로 로컬 정의(공유 keys.ts 미변경).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthContext";
import {
  fetchActiveForceRing,
  fetchForceRingHistory,
  fetchForceRingQuota,
  triggerForceRing,
  stopForceRing,
  requestRemoteListen,
  stopRemoteListen,
  type TriggerForceRingResult,
  type RemoteListenCommandResult,
} from "@/lib/api/endpoints/remote";

/** 소리울리기 도메인 로컬 queryKey. */
const rk = {
  active: (familyId: string) => ["forceRing", "active", familyId] as const,
  history: (familyId: string) => ["forceRing", "history", familyId] as const,
  quota: (familyId: string) => ["forceRing", "quota", familyId] as const,
};

/** 진행 중 소리울리기 1건(또는 null). pollMs 로 상태 폴링. */
export function useForceRingActive(opts?: { pollMs?: number }) {
  const { familyId, status } = useAuth();
  return useQuery({
    queryKey: rk.active(familyId ?? ""),
    queryFn: () => fetchActiveForceRing(familyId as string),
    enabled: status === "authenticated" && !!familyId,
    refetchInterval: opts?.pollMs && opts.pollMs > 0 ? opts.pollMs : false,
  });
}

/** 최근 소리울리기 이력(기본 10건). */
export function useForceRingHistory(limit = 10) {
  const { familyId, status } = useAuth();
  return useQuery({
    queryKey: rk.history(familyId ?? ""),
    queryFn: () => fetchForceRingHistory(familyId as string, limit),
    enabled: status === "authenticated" && !!familyId,
  });
}

/** 소리울리기 남은 횟수(quota). */
export function useForceRingQuota() {
  const { familyId, status } = useAuth();
  return useQuery({
    queryKey: rk.quota(familyId ?? ""),
    queryFn: () => fetchForceRingQuota(familyId as string),
    enabled: status === "authenticated" && !!familyId,
  });
}

/** 소리울리기 발사(확인 모달 확정에서만). 성공 시 active/history/quota 무효화. */
export function useTriggerForceRing() {
  const qc = useQueryClient();
  const { familyId } = useAuth();
  return useMutation<
    TriggerForceRingResult,
    unknown,
    { targetChildUserId?: string | null; message?: string }
  >({
    mutationFn: (vars) => triggerForceRing({ familyId: familyId ?? "", ...vars }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: rk.active(familyId ?? "") });
      qc.invalidateQueries({ queryKey: rk.history(familyId ?? "") });
      qc.invalidateQueries({ queryKey: rk.quota(familyId ?? "") });
    },
  });
}

/** 소리울리기 정지(중지 버튼에서만). 성공 시 active/history 무효화. */
export function useStopForceRing() {
  const qc = useQueryClient();
  const { familyId } = useAuth();
  return useMutation({
    mutationFn: (eventId: string) => stopForceRing(eventId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: rk.active(familyId ?? "") });
      qc.invalidateQueries({ queryKey: rk.history(familyId ?? "") });
    },
  });
}

/** 원격 청취 시작 명령(듣기 시작 버튼에서만). */
export function useRequestRemoteListen() {
  const { familyId } = useAuth();
  return useMutation<
    RemoteListenCommandResult,
    unknown,
    { targetChildUserId?: string | null; durationSec?: number; requestId?: string }
  >({
    mutationFn: (vars) => requestRemoteListen({ familyId: familyId ?? "", ...vars }),
  });
}

/** 원격 청취 중지 명령(종료/타임아웃에서만). */
export function useStopRemoteListen() {
  const { familyId } = useAuth();
  return useMutation<RemoteListenCommandResult, unknown, { targetChildUserId?: string | null }>({
    mutationFn: (vars) => stopRemoteListen({ familyId: familyId ?? "", ...vars }),
  });
}

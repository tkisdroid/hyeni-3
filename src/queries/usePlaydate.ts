/**
 * 친구놀이(friend_playdate) 도메인 TanStack Query 훅.
 * 컴포넌트는 이 훅만 import(endpoints/playdate 직접 호출 금지).
 *
 * 실시간: friend_playdate_invites/sessions WS 브릿지는 통합 담당(useFamilyRealtime)
 *        소관이라, 여기서는 짧은 refetchInterval 폴링으로 대기/연결/해제 상태를 따라간다.
 * playdate 키는 keys.ts(공유 인프라)를 건드리지 않고 로컬 팩토리로 둔다.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthContext";
import {
  fetchPlaydateCandidates,
  fetchPendingPlaydateInvites,
  fetchActivePlaydateSession,
  fetchFamilyPlaydateEnabled,
  createPlaydateInvite,
  acceptPlaydateInvite,
  declinePlaydateInvite,
  endPlaydate,
  type PlaydateCandidate,
  type StopReason,
} from "@/lib/api/endpoints/playdate";

/** playdate 로컬 queryKey 팩토리(공유 keys.ts 미오염). */
const pk = {
  candidates: (familyId: string) => ["playdate", "candidates", familyId] as const,
  pending: (familyId: string) => ["playdate", "pending", familyId] as const,
  active: (familyId: string) => ["playdate", "active", familyId] as const,
  enabled: (familyId: string) => ["playdate", "enabled", familyId] as const,
};

/** 근처 친구 후보(soft error 포함 응답). 위치 갱신 반영 위해 20s 폴링. */
export function usePlaydateCandidates(enabledOpt = true) {
  const { familyId, status } = useAuth();
  return useQuery({
    queryKey: pk.candidates(familyId ?? ""),
    queryFn: () => fetchPlaydateCandidates(familyId as string),
    enabled: enabledOpt && status === "authenticated" && !!familyId,
    refetchInterval: 20_000,
  });
}

/** 우리 가족 pending 초대(수신/발신). 대기 상태 추적 위해 12s 폴링. */
export function usePendingPlaydateInvites() {
  const { familyId, status } = useAuth();
  return useQuery({
    queryKey: pk.pending(familyId ?? ""),
    queryFn: () => fetchPendingPlaydateInvites(familyId as string),
    enabled: status === "authenticated" && !!familyId,
    refetchInterval: 12_000,
  });
}

/** 진행 중 세션(없으면 null). 연결/해제 추적 위해 12s 폴링. */
export function useActivePlaydateSession() {
  const { familyId, status } = useAuth();
  return useQuery({
    queryKey: pk.active(familyId ?? ""),
    queryFn: () => fetchActivePlaydateSession(familyId as string),
    enabled: status === "authenticated" && !!familyId,
    refetchInterval: 12_000,
  });
}

/** 우리 가족 친구놀이 허용 여부(기본 true). */
export function usePlaydateEnabled() {
  const { familyId, status } = useAuth();
  return useQuery({
    queryKey: pk.enabled(familyId ?? ""),
    queryFn: () => fetchFamilyPlaydateEnabled(familyId as string),
    enabled: status === "authenticated" && !!familyId,
  });
}

/**
 * 놀이 초대 생성(발신 자녀). 후보 1건을 받아 발신자 정보는 세션에서 파생한다.
 * 서버가 발신 자녀 본인만 허용하므로 role==='child' 세션에서만 성공한다.
 */
export function useCreatePlaydateInvite() {
  const qc = useQueryClient();
  const { familyId, userId } = useAuth();
  return useMutation({
    mutationFn: (candidate: PlaydateCandidate) => {
      if (!familyId || !userId) throw new Error("로그인이 필요해요");
      return createPlaydateInvite({
        publicPlaceId: candidate.public_place_id,
        requesterFamilyId: familyId,
        receiverFamilyId: candidate.family_id,
        requesterChildId: userId,
        receiverChildId: candidate.child_user_id,
        requesterUserId: userId,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pk.pending(familyId ?? "") });
    },
  });
}

/** 초대 수락(수신 자녀). 성공 시 세션 생성 → pending/active 무효화. */
export function useAcceptPlaydateInvite() {
  const qc = useQueryClient();
  const { familyId } = useAuth();
  return useMutation({
    mutationFn: (inviteId: string) => acceptPlaydateInvite(inviteId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pk.pending(familyId ?? "") });
      qc.invalidateQueries({ queryKey: pk.active(familyId ?? "") });
    },
  });
}

/** 초대 거절(수신 자녀). 성공 시 pending 무효화. */
export function useDeclinePlaydateInvite() {
  const qc = useQueryClient();
  const { familyId } = useAuth();
  return useMutation({
    mutationFn: (inviteId: string) => declinePlaydateInvite(inviteId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pk.pending(familyId ?? "") });
    },
  });
}

/** 세션 종료(연결됨 → 해제). 성공 시 active/candidates 무효화. */
export function useEndPlaydate() {
  const qc = useQueryClient();
  const { familyId } = useAuth();
  return useMutation({
    mutationFn: (args: { sessionId: string; reason: StopReason }) =>
      endPlaydate(args.sessionId, args.reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pk.active(familyId ?? "") });
      qc.invalidateQueries({ queryKey: pk.candidates(familyId ?? "") });
      qc.invalidateQueries({ queryKey: pk.pending(familyId ?? "") });
    },
  });
}

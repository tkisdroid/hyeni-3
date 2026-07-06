/**
 * 스티커(칭찬) 도메인 TanStack Query 훅.
 * 컴포넌트는 이 훅만 import(endpoints/stickers 직접 호출 금지).
 * 쓰기(useSendSticker)는 화면 버튼(사용자 클릭)에서만 실행 — 자동 실행 금지.
 * 실시간 INSERT 는 useFamilyRealtime 이 stickers 채널 → 관련 키 무효화로 반영.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "./keys";
import { useAuth } from "@/auth/AuthContext";
import {
  fetchStickerSummary,
  fetchReceivedStickers,
  sendSticker,
  type NewSticker,
} from "@/lib/api/endpoints/stickers";

/** 가족 스티커 집계(사용자별). */
export function useStickerSummary() {
  const { familyId, status } = useAuth();
  return useQuery({
    queryKey: qk.stickerSummary(familyId ?? ""),
    queryFn: () => fetchStickerSummary(familyId as string),
    enabled: status === "authenticated" && !!familyId,
  });
}

/** 받은 칭찬 스티커 목록. userId 미지정 시 현재 로그인 사용자(아이 본인). */
export function useReceivedStickers(userId?: string | null) {
  const { familyId, userId: myId, status } = useAuth();
  const targetUserId = userId === undefined ? myId : userId;
  return useQuery({
    queryKey: qk.receivedStickers(familyId ?? "", targetUserId ?? ""),
    queryFn: () => fetchReceivedStickers(familyId as string, targetUserId as string),
    enabled: status === "authenticated" && !!familyId && !!targetUserId,
  });
}

/** 전송 파라미터(family_id 는 훅이 auth 에서 주입). */
export type SendStickerVars = Omit<NewSticker, "family_id">;

/**
 * 스티커 전송 → 집계·받은목록 캐시 무효화.
 * 화면 버튼에서 사용자가 눌러야 실행(자동 실행 금지).
 */
export function useSendSticker() {
  const qc = useQueryClient();
  const { familyId } = useAuth();
  return useMutation({
    mutationFn: (input: SendStickerVars) => {
      if (!familyId) throw new Error("가족 정보가 없어요");
      return sendSticker({ ...input, family_id: familyId });
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: qk.stickerSummary(familyId ?? "") });
      qc.invalidateQueries({ queryKey: qk.receivedStickers(familyId ?? "", vars.user_id) });
    },
  });
}

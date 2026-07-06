/**
 * 가족 도메인 TanStack Query 훅.
 * 컴포넌트는 이 훅만 import(endpoints/family 직접 호출 금지).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "./keys";
import { useAuth } from "@/auth/AuthContext";
import {
  getMyFamily,
  updateMyProfile,
  regeneratePairCode,
  unpairChild,
  setChildProfile,
  reportDeviceStatus,
  sendChildSettingRequest,
  type SettingRequestMenu,
  type DeviceHealth,
} from "@/lib/api/endpoints/family";
import {
  uploadChildPhoto,
  setupChildrenWithPhotos,
  type DraftChildWithPhoto,
} from "@/lib/api/endpoints/childPhoto";

/**
 * 현재 사용자의 가족 정보(/api/family/mine).
 * pollMs 를 주면 그 주기로 재요청(페어링 대기 화면에서 아이 연결 감지용).
 */
export function useMyFamily(opts?: { pollMs?: number }) {
  const { familyId, status } = useAuth();
  return useQuery({
    queryKey: qk.family(familyId),
    queryFn: getMyFamily,
    enabled: status === "authenticated",
    refetchInterval: opts?.pollMs && opts.pollMs > 0 ? opts.pollMs : false,
  });
}

/** 본인 프로필(이름/전화/캐릭터) 수정 → 가족 캐시 무효화. */
export function useUpdateProfile() {
  const qc = useQueryClient();
  const { familyId } = useAuth();
  return useMutation({
    mutationFn: (fields: { name?: string; phone?: string; emoji?: string }) => {
      if (!familyId) throw new Error("가족 정보가 없어요");
      return updateMyProfile(familyId, fields);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.family(familyId) }),
  });
}

/** 페어링 코드 재발급 → 가족 캐시 무효화. */
export function useRegeneratePairCode() {
  const qc = useQueryClient();
  const { familyId } = useAuth();
  return useMutation({
    mutationFn: () => {
      if (!familyId) throw new Error("가족 정보가 없어요");
      return regeneratePairCode(familyId);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.family(familyId) }),
  });
}

/** 아이 연결 해제(주 보호자만) → 가족 캐시 무효화. */
export function useUnpairChild() {
  const qc = useQueryClient();
  const { familyId } = useAuth();
  return useMutation({
    mutationFn: (childUserId: string) => {
      if (!familyId) throw new Error("가족 정보가 없어요");
      return unpairChild(familyId, childUserId);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.family(familyId) }),
  });
}

/**
 * 아이 프로필(이름 + 생일 + 전화) 저장(주 보호자만) → 가족 캐시 무효화.
 * 색상 선택 UI 는 제거됨: colorHex(기존 색 보존) 없으면 colorIndex 로 자동 배정.
 * birthdate/phone 은 부분수정(키 있을 때만 반영, null=지움). 서버 notifyPg 로 아이 기기 실시간 갱신.
 */
export function useSetChildProfile() {
  const qc = useQueryClient();
  const { familyId } = useAuth();
  return useMutation({
    mutationFn: (input: {
      memberId: string;
      name: string;
      colorHex?: string;
      colorIndex?: number;
      birthdate?: string | null;
      phone?: string | null;
    }) => {
      if (!familyId) throw new Error("가족 정보가 없어요");
      return setChildProfile(familyId, input.memberId, {
        name: input.name,
        colorHex: input.colorHex,
        colorIndex: input.colorIndex,
        birthdate: input.birthdate,
        phone: input.phone,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.family(familyId) }),
  });
}

/** 아이 사진 업로드(주 보호자만) → 가족 캐시 무효화(표시용 proxy URL 재합성). */
export function useUploadChildPhoto() {
  const qc = useQueryClient();
  const { familyId } = useAuth();
  return useMutation({
    mutationFn: (input: { memberId: string; dataUrl: string; stamp: number | string }) => {
      if (!familyId) throw new Error("가족 정보가 없어요");
      return uploadChildPhoto(familyId, input.memberId, input.dataUrl, input.stamp);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.family(familyId) }),
  });
}

/**
 * 새 아이(placeholder) 서버 생성 — /api/family/setup 로 children 행 insert(+ 사진 업로드).
 * 주 보호자만 안전(setup 은 parent_id 소유 가족에 append). 성공 시 가족 캐시 무효화.
 * 사진이 있으면 order 기반 경로로 먼저 업로드하고 photo_url 로 함께 저장한다.
 */
export function useCreateChildren() {
  const qc = useQueryClient();
  const { familyId } = useAuth();
  return useMutation({
    mutationFn: (input: {
      parentName: string;
      plannedChildCount?: number;
      startOrder?: number;
      children: DraftChildWithPhoto[];
    }) => {
      if (!familyId) throw new Error("가족 정보가 없어요");
      return setupChildrenWithPhotos({
        familyId,
        parentName: input.parentName,
        plannedChildCount: input.plannedChildCount,
        startOrder: input.startOrder,
        children: input.children,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.family(familyId) }),
  });
}

/**
 * 아이 기기 상태(device_health) 리포트 — 자기 행 write.
 * 자기 리포트라 가족 캐시를 무효화하지 않는다(주기적 리포트마다 리페치하면 과도). fire-and-forget.
 */
export function useReportDeviceStatus() {
  const { familyId } = useAuth();
  return useMutation({
    mutationFn: (input: { deviceHealth: DeviceHealth; deviceLabel?: string }) => {
      if (!familyId) throw new Error("가족 정보가 없어요");
      return reportDeviceStatus(familyId, input.deviceHealth, input.deviceLabel);
    },
  });
}

/** 아이 → 부모 설정 변경 요청(잠금 항목). 서버 parent_alerts 기록. */
export function useSendChildSettingRequest() {
  const { familyId, userId } = useAuth();
  return useMutation({
    mutationFn: (input: { menu: SettingRequestMenu; childName?: string }) => {
      if (!familyId) throw new Error("가족 정보가 없어");
      return sendChildSettingRequest({
        familyId,
        menu: input.menu,
        childName: input.childName,
        senderUserId: userId,
      });
    },
  });
}

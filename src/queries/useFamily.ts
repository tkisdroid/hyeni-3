/**
 * 가족 도메인 TanStack Query 훅.
 * 컴포넌트는 이 훅만 import(endpoints/family 직접 호출 금지).
 */
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "./keys";
import { useAuth } from "@/auth/AuthContext";
import {
  getMyFamily,
  updateMyProfile,
  regeneratePairCode,
  unpairChild,
  removeCoParent,
  setChildProfile,
  reportDeviceStatus,
  sendChildSettingRequest,
  confirmServiceCountry,
  updateFamilyRegion,
  type ConfirmServiceCountryInput,
  type SettingRequestMenu,
  type DeviceHealth,
} from "@/lib/api/endpoints/family";
import {
  uploadChildPhoto,
  uploadMyParentPhoto,
  setupChildrenWithPhotos,
  type DraftChildWithPhoto,
} from "@/lib/api/endpoints/childPhoto";
import {
  useResolvedMemberPhotoUrls,
  withResolvedMemberPhotos,
} from "./memberPhotos";
import type { FamilyInfo } from "@/lib/api/endpoints/family";

function useResolvedFamilyPhotos(family: FamilyInfo | null | undefined): FamilyInfo | null | undefined {
  const urls = useResolvedMemberPhotoUrls(family?.members);
  return useMemo(() => {
    if (!family) return family;
    return { ...family, members: withResolvedMemberPhotos(family.members, urls) };
  }, [family, urls]);
}

/**
 * 현재 사용자의 가족 정보(/api/family/mine).
 * pollMs 를 주면 그 주기로 재요청(페어링 대기 화면에서 아이 연결 감지용).
 */
export function useMyFamily(opts?: { pollMs?: number }) {
  const { familyId, status } = useAuth();
  const query = useQuery({
    queryKey: qk.family(familyId),
    queryFn: getMyFamily,
    enabled: status === "authenticated",
    refetchInterval: opts?.pollMs && opts.pollMs > 0 ? opts.pollMs : false,
  });
  const data = useResolvedFamilyPhotos(query.data);
  return { ...query, data };
}

/** 이용 국가 변경 성공 시 family snapshot과 Study access 상태를 함께 다시 읽는다. */
export function useConfirmServiceCountry() {
  const qc = useQueryClient();
  const { familyId } = useAuth();
  return useMutation({
    mutationFn: (input: Omit<ConfirmServiceCountryInput, "familyId">) => {
      if (!familyId) throw new Error("가족 정보가 없어요");
      return confirmServiceCountry({ ...input, familyId });
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: qk.family(familyId), exact: true }),
        qc.invalidateQueries({ queryKey: qk.study.all }),
      ]);
    },
  });
}

/** 주 보호자가 지도·위치 공급자 선택용 가족 국가를 변경한다. */
export function useUpdateFamilyRegion() {
  const qc = useQueryClient();
  const { familyId } = useAuth();
  return useMutation({
    mutationFn: (countryCode: string) => updateFamilyRegion({ countryCode }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.family(familyId), exact: true }),
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

/** 기존 공동 보호자 연결 해제(주 보호자만) → 가족 캐시 무효화. */
export function useRemoveCoParent() {
  const qc = useQueryClient();
  const { familyId } = useAuth();
  return useMutation({
    mutationFn: (parentUserId: string) => {
      if (!familyId) throw new Error("가족 정보가 없어요");
      return removeCoParent(familyId, parentUserId);
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
    // ProfileEdit가 구체적인 실패 문구를 직접 표시한다. 전역 폴백 토스트와 중복 금지.
    meta: { silentError: true },
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

/** 아이 사진 업로드(주 보호자만) → 가족 캐시 무효화(표시용 blob URL 재합성). */
export function useUploadChildPhoto() {
  const qc = useQueryClient();
  const { familyId } = useAuth();
  return useMutation({
    // ProfileEdit가 구체적인 실패 문구를 직접 표시한다. 전역 폴백 토스트와 중복 금지.
    meta: { silentError: true },
    mutationFn: (input: { memberId: string; dataUrl: string }) => {
      if (!familyId) throw new Error("가족 정보가 없어요");
      return uploadChildPhoto(familyId, input.memberId, input.dataUrl);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.family(familyId) }),
  });
}

/**
 * 부모 본인 프로필 사진 업로드 → 가족·계정 캐시 무효화.
 * 대상은 caller 자기 멤버 행이며 서버가 소유권을 다시 확인한다(공동 보호자도 자기 사진만).
 */
export function useUploadMyPhoto() {
  const qc = useQueryClient();
  const { familyId } = useAuth();
  return useMutation({
    mutationFn: (input: { memberId: string; dataUrl: string }) => {
      if (!familyId) throw new Error("가족 정보가 없어요");
      return uploadMyParentPhoto(familyId, input.memberId, input.dataUrl);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.family(familyId) });
      void qc.invalidateQueries({ queryKey: qk.account(familyId) });
    },
  });
}

/**
 * 새 아이(placeholder) 서버 생성 — /api/family/setup 로 children 행 insert(+ 사진 업로드).
 * 주 보호자만 안전(setup 은 parent_id 소유 가족에 append). 성공 시 가족 캐시 무효화.
 * 사진이 있으면 서버 발급 경로로 먼저 업로드하고 photo_url 로 함께 저장한다.
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

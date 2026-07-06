/**
 * 계정 도메인 TanStack Query 훅.
 * 컴포넌트는 이 훅만 import(endpoints/account 직접 호출 금지).
 * 프로필 수정(useUpdateProfile)·가족 조회(useMyFamily)는 queries/useFamily 를 그대로 재사용한다.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "./keys";
import { useAuth } from "@/auth/AuthContext";
import type { FamilyMember } from "@/lib/api/endpoints/family";
import {
  getMyAccount,
  setChildTheme,
  changePassword,
  buildFamilyDataExport,
  type AccountInfo,
} from "@/lib/api/endpoints/account";

/** 로그인 사용자 provider(로그인 방식) → 한글 라벨. */
export function providerLabel(provider: string | null | undefined): string {
  switch (provider) {
    case "kakao":
      return "카카오 계정";
    case "google":
      return "구글 계정";
    case "naver":
      return "네이버 계정";
    case "phone":
      return "전화번호 계정";
    case "anonymous":
      return "게스트";
    default:
      return "ID 계정";
  }
}

export interface UseAccountResult {
  account: AccountInfo | null;
  /** members 에서 user_id 로 매칭한 "나" 멤버(이름/전화/이모지 등 caller 본인 행). */
  me: FamilyMember | null;
  /** 로그인 방식(provider) 한글 라벨. */
  providerLabel: string;
  isLoading: boolean;
  isError: boolean;
}

/** 현재 사용자의 계정 정보(/api/family/mine 파생). */
export function useAccount(): UseAccountResult {
  const { familyId, userId, status, user } = useAuth();
  const query = useQuery({
    queryKey: qk.account(familyId),
    queryFn: getMyAccount,
    enabled: status === "authenticated",
  });

  const account = query.data ?? null;
  const me =
    account && userId ? account.members.find((m) => m.user_id === userId) ?? null : null;
  const provider = user?.app_metadata?.provider ?? null;

  return {
    account,
    me,
    providerLabel: providerLabel(provider),
    isLoading: query.isLoading,
    isError: query.isError,
  };
}

/** 아이 멤버 테마색 저장 → 가족/계정 캐시 무효화(멤버 색 갱신 반영). */
export function useSetChildTheme() {
  const qc = useQueryClient();
  const { familyId } = useAuth();
  return useMutation({
    mutationFn: (input: { memberId: string; name: string; colorHex: string }) => {
      if (!familyId) throw new Error("가족 정보가 없어요");
      return setChildTheme(familyId, input.memberId, input.name, input.colorHex);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.family(familyId) });
      void qc.invalidateQueries({ queryKey: qk.account(familyId) });
    },
  });
}

/**
 * 회원 탈퇴 — AuthProvider.deleteAccount 를 통해 서버 purge + 세션 제거 + 전 캐시 clear.
 * (성공 후 화면에서 /onboarding 으로 이동.)
 */
export function useDeleteAccount() {
  const { deleteAccount } = useAuth();
  return useMutation({
    mutationFn: () => deleteAccount(),
  });
}

/** 현재 비밀번호 확인 후 새 비밀번호 저장. */
export function useChangePassword() {
  return useMutation({
    mutationFn: (input: { currentPassword: string; newPassword: string }) =>
      changePassword(input),
  });
}

/** 가족 데이터 내보내기(JSON 집계). 성공 시 export 객체 반환(화면이 직렬화·다운로드). */
export function useExportFamilyData() {
  const { familyId } = useAuth();
  const { account, me } = useAccount();
  return useMutation({
    mutationFn: () => {
      if (!familyId) throw new Error("가족 정보가 없어요");
      return buildFamilyDataExport({
        familyId,
        account: account ? { name: account.myName, role: account.myRole } : null,
        members: account?.members ?? (me ? [me] : []),
      });
    },
  });
}

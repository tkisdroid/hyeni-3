/**
 * 계정 도메인 TanStack Query 훅.
 * 컴포넌트는 이 훅만 import(endpoints/account 직접 호출 금지).
 * 프로필 수정(useUpdateProfile)·가족 조회(useMyFamily)는 queries/useFamily 를 그대로 재사용한다.
 */
import { useMemo } from "react";
import { useIntl } from "react-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryObserverResult } from "@tanstack/react-query";
import { qk } from "./keys";
import {
  useResolvedMemberPhotoUrls,
  withResolvedMemberPhotos,
} from "./memberPhotos";
import { useAuth } from "@/auth/AuthContext";
import type { MessageId } from "@/i18n/generated/messageIds";
import { getMyFamily, type FamilyMember } from "@/lib/api/endpoints/family";
import {
  toAccountInfo,
  setChildTheme,
  changePassword,
  buildFamilyDataExport,
  type AccountInfo,
} from "@/lib/api/endpoints/account";

/**
 * 로그인 사용자 provider(로그인 방식) → message id.
 *
 * ⚠️ 문구를 직접 반환하지 않는다 — 이 라벨은 계정·설정·선생님 설정 화면에 그대로 보이므로
 * locale 을 따라야 한다(2026-08-25 실기기에서 en 화면에 "ID 계정"이 노출된 결함 수정).
 */
export function providerLabelId(provider: string | null | undefined): MessageId {
  switch (provider) {
    case "kakao":
      return "parent.account.provider.kakao" as MessageId;
    case "google":
      return "parent.account.provider.google" as MessageId;
    case "naver":
      return "parent.account.provider.naver" as MessageId;
    case "phone":
      return "parent.account.provider.phone" as MessageId;
    case "anonymous":
      return "parent.account.provider.anonymous" as MessageId;
    default:
      return "parent.account.provider.id" as MessageId;
  }
}

export interface UseAccountResult {
  account: AccountInfo | null;
  /** members 에서 user_id 로 매칭한 "나" 멤버(이름/전화/이모지 등 caller 본인 행). */
  me: FamilyMember | null;
  /** 로그인 방식(provider) 라벨 — 현재 locale 로 번역된 값. */
  providerLabel: string;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  dataUpdatedAt: number;
  refetch: () => Promise<QueryObserverResult<AccountInfo | null, Error>>;
}

/** 현재 사용자의 계정 정보(/api/family/mine 파생). */
export function useAccount(): UseAccountResult {
  const { familyId, userId, status, user } = useAuth();
  const intl = useIntl();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: qk.account(familyId),
    // 셸·홈과 동일한 가족 query를 공유해 설정 첫 진입의 중복 요청을 합친다.
    queryFn: async () => toAccountInfo(await qc.fetchQuery({
      queryKey: qk.family(familyId),
      queryFn: getMyFamily,
    })),
    enabled: status === "authenticated",
    // 실패 재시도도 가족 query 한 곳에서 맡아 중첩 재시도로 대기를 늘리지 않는다.
    retry: false,
  });

  // 멤버 사진은 서버 객체 키라 그대로는 표시되지 않는다 — 가족 조회와 같은 lease 규칙으로 해석한다.
  const photoUrls = useResolvedMemberPhotoUrls(query.data?.members);
  const account = useMemo(() => {
    const data = query.data ?? null;
    if (!data) return null;
    return { ...data, members: withResolvedMemberPhotos(data.members, photoUrls) };
  }, [query.data, photoUrls]);
  const me =
    account && userId ? account.members.find((m) => m.user_id === userId) ?? null : null;
  // 가입 방식은 서버 정본(/mine 의 myAuthProvider)을 먼저 쓴다. 세션의 app_metadata.provider 는
  // 로그인 경로마다 달라서(비밀번호 로그인 응답에는 없다) 같은 전화번호 가입 계정이
  // "전화번호 계정"/"ID 계정"으로 다르게 보였다. 가족 조회 전에는 세션 값으로 대신한다.
  const provider = account?.authProvider ?? user?.app_metadata?.provider ?? null;

  return {
    account,
    me,
    providerLabel: intl.formatMessage({ id: providerLabelId(provider) }),
    isLoading: query.isLoading,
    isError: query.isError,
    isFetching: query.isFetching,
    dataUpdatedAt: query.dataUpdatedAt,
    refetch: query.refetch,
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

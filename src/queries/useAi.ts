/**
 * AI 도메인 TanStack Query 훅(크레딧 · 자녀 채팅).
 * 컴포넌트는 이 훅만 import(endpoints/ai 직접 호출 금지).
 *
 * ⚠️ useSendChildChat 는 크레딧을 소모하는 쓰기 뮤테이션이다.
 *    자동 실행 금지 — 반드시 화면의 전송 버튼 onClick 에서만 .mutate() 호출.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "./keys";
import { useAuth } from "@/auth/AuthContext";
import {
  fetchAiCredits,
  fetchAiCreditPublicStatus,
  fetchAiCreditLedger,
  fetchAiMessages,
  sendChildChat,
  parseSchedule,
  fetchDaySummary,
  generateDaySummary,
  fetchAiFriendPublicSettings,
  fetchAiFriendSettings,
  setAiFriendName,
  saveAiFriendSettings,
  type ChildChatReply,
  type SendChildChatInput,
  type ParseScheduleInput,
  type ParseScheduleResult,
  type DaySummaryResult,
  type DaySummaryClientSignals,
  type AiFriendSettings,
  type AiCreditPublicStatus,
  fetchAiUsageToday,
} from "@/lib/api/endpoints/ai";
import { fetchWebAiCreditCatalog } from "@/lib/api/endpoints/webBilling";
import {
  validateWebAiCreditCatalog,
  type WebAiCreditCatalog,
} from "@/transform/webAiCreditBilling";

/**
 * 자녀 AI 크레딧 잔액/상태.
 * 크레딧은 자녀별이라 childUserId 가 있어야 조회한다. 키는 qk.aiCredits(familyId) 프리픽스 +
 * childUserId 로, 부모가 여러 아이를 볼 때 캐시 충돌을 막으면서도 가족 단위 invalidate 가 동작한다.
 */
export function useAiCredits(childUserId?: string | null) {
  const { familyId, status } = useAuth();
  return useQuery({
    queryKey: [...qk.aiCredits(familyId ?? ""), childUserId ?? ""],
    queryFn: () => fetchAiCredits(familyId as string, childUserId as string),
    enabled: status === "authenticated" && !!familyId && !!childUserId,
  });
}

/** 부모와 아이 본인이 함께 읽는 서버 계산 AI 대화 가능 횟수. */
export function useAiCreditPublicStatus(childUserId?: string | null) {
  const { familyId, status } = useAuth();
  return useQuery({
    queryKey: qk.aiCreditPublicStatus(familyId ?? "", childUserId ?? ""),
    queryFn: () => fetchAiCreditPublicStatus(familyId as string, childUserId as string),
    enabled: status === "authenticated" && !!familyId && !!childUserId,
    staleTime: 30_000,
  });
}

/** PWA 일회성 결제용 서버 확정 카탈로그. Android에서는 네트워크 요청을 열지 않는다. */
export function useWebAiCreditCatalog(enabled = true) {
  const { familyId, status } = useAuth();
  return useQuery<WebAiCreditCatalog>({
    queryKey: qk.webAiCreditCatalog(familyId ?? ""),
    queryFn: async () => validateWebAiCreditCatalog(
      await fetchWebAiCreditCatalog(familyId as string),
    ),
    enabled: enabled && status === "authenticated" && !!familyId,
    staleTime: 60_000,
  });
}

/**
 * 오늘 AI 대화 원시 사용 횟수(과거 화면 호환용).
 * 대화 가능한 실제 잔여 횟수는 `useAiCreditPublicStatus`를 사용한다.
 */
export function useAiUsageToday(childUserId?: string | null) {
  const { familyId, status } = useAuth();
  return useQuery({
    queryKey: qk.aiUsageToday(familyId ?? "", childUserId ?? ""),
    queryFn: () => fetchAiUsageToday(familyId as string, childUserId as string),
    enabled: status === "authenticated" && !!familyId && !!childUserId,
    staleTime: 60_000,
  });
}

/** 자녀 크레딧 원장(충전/사용 이력). 표시 슬롯이 있는 화면에서 사용. */
export function useAiCreditLedger(childUserId?: string | null, limit = 20) {
  const { familyId, status } = useAuth();
  return useQuery({
    queryKey: [...qk.aiCredits(familyId ?? ""), "ledger", childUserId ?? "", limit],
    queryFn: () => fetchAiCreditLedger(familyId as string, childUserId as string, limit),
    enabled: status === "authenticated" && !!familyId && !!childUserId,
  });
}

/**
 * 자녀의 최근 채팅 메시지.
 * 아이 모드에서는 로그인 사용자 = 아이이므로 childUserId 로 useAuth().userId 를 넘긴다.
 */
export function useAiMessages(childUserId?: string | null, limit = 20) {
  const { familyId, status } = useAuth();
  return useQuery({
    queryKey: qk.aiMessages(childUserId ?? ""),
    queryFn: () => fetchAiMessages(familyId as string, childUserId as string, limit),
    enabled: status === "authenticated" && !!familyId && !!childUserId,
  });
}

/**
 * 자녀 채팅 전송 뮤테이션(크레딧 소모 · 쓰기).
 * childUserId 는 서버가 세션에서 파생하므로 payload 에 넣지 않는다.
 * 성공 시 크레딧/메시지 캐시를 무효화해 부모 크레딧 화면·재진입 기록이 최신화된다.
 * 실패(한도 초과 등)는 ApiError 로 rejection → 호출부 onError 에서 코드 분기.
 */
export function useSendChildChat() {
  const qc = useQueryClient();
  const { familyId, userId } = useAuth();
  return useMutation<ChildChatReply, unknown, SendChildChatInput>({
    mutationFn: (input: SendChildChatInput) => sendChildChat(input),
    onSuccess: (result) => {
      const nextRemaining = result.remaining;
      if (
        familyId
        && userId
        && typeof nextRemaining === "number"
        && Number.isSafeInteger(nextRemaining)
        && nextRemaining >= 0
      ) {
        qc.setQueryData<AiCreditPublicStatus>(
          qk.aiCreditPublicStatus(familyId, userId),
          (current) => current ? { ...current, availableRemaining: nextRemaining } : current,
        );
      }
      void qc.invalidateQueries({ queryKey: qk.aiCredits(familyId ?? "") });
      if (userId) void qc.invalidateQueries({ queryKey: qk.aiMessages(userId) });
      const toolName = result.toolResult && typeof result.toolResult === "object"
        ? String((result.toolResult as { toolName?: unknown }).toolName || "")
        : "";
      if (toolName === "createSchedule" || toolName === "updateSchedule") {
        void qc.invalidateQueries({ queryKey: qk.events(familyId ?? "") });
      }
      if (toolName === "createDailyItem") {
        void qc.invalidateQueries({ queryKey: ["dailySupplies", familyId ?? ""] });
      }
    },
  });
}

/**
 * AI 일정 파싱 뮤테이션(텍스트/사진 → 일정 후보 · LLM 호출 · 비용 발생).
 * ⚠️ 자동 실행 금지 — 화면의 "정리하기" 버튼 onClick 에서만 .mutate()/.mutateAsync() 호출.
 * 서버가 인증/프롬프트/LLM 을 처리하므로 familyId 는 넘기지 않는다(세션 파생).
 * 읽기 전용(캐시 무효화 없음) — 실제 일정 생성은 useCreateEvent 가 담당.
 */
export function useParseSchedule() {
  return useMutation<ParseScheduleResult, unknown, ParseScheduleInput>({
    // AiSchedule가 quota·Premium·파싱·네트워크 오류를 모두 구체적으로 안내한다.
    meta: { silentError: true },
    mutationFn: (input: ParseScheduleInput) => parseSchedule(input),
  });
}

// ── AI 하루 요약(day-summary) ────────────────────────────────────────────────
// day-summary 키는 keys.ts(공용 인프라·미소유) 대신 로컬 배열로 조준한다.
// isoDateKey 는 ISO "YYYY-MM-DD"(서버 계약) — 화면이 @/transform/dateKey 로 변환해 넘긴다.

/**
 * 자녀 하루 요약 캐시 조회(GET · 무과금).
 * 캐시가 있으면 { summary, signals }, 없으면 null. 생성(과금)은 useGenerateDaySummary 로 분리.
 */
export function useDaySummary(childUserId?: string | null, isoDateKey?: string | null) {
  const { familyId, status } = useAuth();
  return useQuery({
    queryKey: ["aiDaySummary", familyId ?? "", childUserId ?? "", isoDateKey ?? ""],
    queryFn: () =>
      fetchDaySummary({
        familyId: familyId as string,
        childUserId: childUserId as string,
        dateKey: isoDateKey as string,
      }),
    enabled: status === "authenticated" && !!familyId && !!childUserId && !!isoDateKey,
  });
}

interface GenerateDaySummaryVars {
  childUserId: string;
  /** ISO "YYYY-MM-DD". */
  isoDateKey: string;
  clientSignals?: DaySummaryClientSignals;
}

/**
 * 하루 요약 생성 뮤테이션(프리미엄 · AI 과금 · 쓰기).
 * ⚠️ 자동 실행 금지 — 화면의 "요약 생성" 버튼 onClick 에서만 .mutate() 호출.
 * 성공 시 해당 날짜 캐시를 무효화해 재진입 시 GET 이 최신 요약을 읽는다.
 */
export function useGenerateDaySummary() {
  const qc = useQueryClient();
  const { familyId } = useAuth();
  return useMutation<DaySummaryResult, unknown, GenerateDaySummaryVars>({
    mutationFn: (v) =>
      generateDaySummary({
        familyId: familyId as string,
        childUserId: v.childUserId,
        dateKey: v.isoDateKey,
        clientSignals: v.clientSignals,
      }),
    onSuccess: (_res, v) => {
      qc.invalidateQueries({
        queryKey: ["aiDaySummary", familyId ?? "", v.childUserId, v.isoDateKey],
      });
    },
  });
}

// ── AI 친구 설정(페르소나·이름) ──────────────────────────────────────────────

/**
 * AI 친구 공개 설정(부모/자녀 본인). 저장된 친구 이름·활성·한도를 읽는다.
 * 아이 모드에서는 childUserId = useAuth().userId 를 넘긴다.
 */
export function useAiFriendPublicSettings(childUserId?: string | null) {
  const { familyId, status } = useAuth();
  return useQuery({
    queryKey: ["aiFriendPublic", familyId ?? "", childUserId ?? ""],
    queryFn: () => fetchAiFriendPublicSettings(familyId as string, childUserId as string),
    enabled: status === "authenticated" && !!familyId && !!childUserId,
  });
}

/** AI 친구 상세 설정(부모 전용). 부모 AI 설정 화면용. */
export function useAiFriendSettings(childUserId?: string | null) {
  const { familyId, status } = useAuth();
  return useQuery({
    queryKey: ["aiFriendSettings", familyId ?? "", childUserId ?? ""],
    queryFn: () => fetchAiFriendSettings(familyId as string, childUserId as string),
    enabled: status === "authenticated" && !!familyId && !!childUserId,
  });
}

/**
 * 자녀 본인이 AI 친구 이름 저장(POST /settings/friend-name).
 * 성공 시 공개 설정 캐시를 무효화해 채팅 헤더·설정이 최신 이름을 읽는다.
 */
export function useSetAiFriendName() {
  const qc = useQueryClient();
  const { familyId, userId } = useAuth();
  return useMutation<string, unknown, string>({
    mutationFn: (name: string) => setAiFriendName(familyId as string, name),
    onSuccess: () => {
      if (userId) {
        qc.invalidateQueries({ queryKey: ["aiFriendPublic", familyId ?? "", userId] });
      }
    },
  });
}

interface SaveAiFriendVars {
  childUserId: string;
  patch: Partial<AiFriendSettings>;
}

/** AI 친구 상세 설정 저장(부모 전용 · PATCH /settings/friend). */
export function useSaveAiFriendSettings() {
  const qc = useQueryClient();
  const { familyId } = useAuth();
  return useMutation<void, unknown, SaveAiFriendVars>({
    mutationFn: (v) =>
      saveAiFriendSettings({ familyId: familyId as string, childUserId: v.childUserId, ...v.patch }),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ["aiFriendSettings", familyId ?? "", v.childUserId] });
      qc.invalidateQueries({ queryKey: ["aiFriendPublic", familyId ?? "", v.childUserId] });
    },
  });
}

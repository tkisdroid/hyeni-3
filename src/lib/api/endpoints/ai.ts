/**
 * AI 도메인 엔드포인트(크레딧 잔액/원장 · 자녀 채팅 메시지/전송).
 * 순수 fetch 래퍼 — 일일 한도·차감·저장·프롬프트는 모두 Worker(/api/ai/*)가 수행하고,
 * 여기서는 요청 조립과 raw row → 도메인 타입 정규화만 담당한다(hyeni-1 aiChat.js 이관).
 *
 * ⚠️ 전송(sendChildChat)은 크레딧을 소모하는 쓰기다. 반드시 사용자 액션(버튼)에서만 호출.
 */
import { apiGet, apiPost, apiPatch } from "../client";

// 프리미엄 기본 일일 포함 크레딧(hyeni-1 premiumPolicy 기준값). 서버가 값을 주면 그 값을 우선한다.
const PREMIUM_AI_DAILY_INCLUDED_CREDITS = 5;

/** KST 기준 오늘(YYYY-MM-DD). child-chat usageDate·잔액 리셋 판정에 사용. */
function todayDateKST(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function numberOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** null/빈값을 생략한 /api/ai/* 쿼리스트링. */
function aiQuery(params: Record<string, string | number | undefined>): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === "") continue;
    usp.set(key, String(value));
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}

// ── 크레딧 잔액/상태 ──────────────────────────────────────────────────────

/** 자녀별 AI 크레딧 상태(정규화 완료). 포함 크레딧(일일 무료)과 구매 크레딧을 구분한다. */
export interface AiCreditStatus {
  isPremium: boolean;
  /** 하루 무료로 포함된 대화 수(daily_included_limit). */
  dailyIncludedLimit: number;
  /** 오늘 사용한 포함 크레딧. */
  dailyIncludedUsed: number;
  /** 오늘 남은 포함 크레딧. */
  dailyIncludedRemaining: number;
  /** 남은 구매 크레딧 잔액(충전으로 늘어나는 값). */
  purchasedCredits: number;
  /** 누적 구매 총합(원장 합산). */
  totalPurchased: number;
  /** KST 일일 리셋 기준일. */
  dailyResetDate: string;
  /** 부모가 설정한 오늘 사용량(있을 때만). */
  parentDailyUsed: number | null;
  /** 부모가 설정한 일일 한도(있을 때만). */
  parentDailyLimit: number | null;
  /** 서버가 계산한 실제 남은 대화 수(있을 때만). */
  availableRemaining: number | null;
}

/** Worker 잔액 row(snake_case). 필드 존재 여부는 스키마 버전에 따라 다르다. */
export interface AiCreditBalanceRow {
  is_premium?: boolean;
  daily_included_limit?: number | null;
  daily_included_used?: number | null;
  daily_reset_date?: string | null;
  purchased_credits?: number | null;
  parent_daily_used?: number | null;
  parent_daily_limit?: number | null;
  available_remaining?: number | null;
}

interface AiCreditBalanceResponse {
  balance?: AiCreditBalanceRow | null;
  totalPurchased?: number | null;
}

// raw 잔액 row → 정규화 상태. daily_reset_date 가 오늘이 아니면 used=0 으로 본다(리셋 미반영 방지).
function normalizeCreditRow(row: AiCreditBalanceRow | null | undefined, today: string): AiCreditStatus | null {
  if (!row) return null;
  const dailyIncludedLimit = Math.max(0, numberOr(row.daily_included_limit, PREMIUM_AI_DAILY_INCLUDED_CREDITS));
  const rawUsed = row.daily_reset_date === today ? Math.max(0, numberOr(row.daily_included_used, 0)) : 0;
  const dailyIncludedUsed = Math.min(rawUsed, dailyIncludedLimit);
  const parentDailyUsed = row.parent_daily_used == null ? null : Math.max(0, numberOr(row.parent_daily_used, 0));
  const parentDailyLimit = row.parent_daily_limit == null ? null : Math.max(0, numberOr(row.parent_daily_limit, 0));
  const availableRemaining =
    row.available_remaining == null ? null : Math.max(0, numberOr(row.available_remaining, 0));
  return {
    isPremium: !!row.is_premium,
    dailyIncludedLimit,
    dailyIncludedUsed,
    dailyIncludedRemaining: Math.max(0, dailyIncludedLimit - dailyIncludedUsed),
    purchasedCredits: Math.max(0, numberOr(row.purchased_credits, 0)),
    totalPurchased: 0, // fetchAiCredits 에서 ledger 합산으로 덮어씀
    dailyResetDate: today, // 리셋 기준일은 항상 KST 오늘로 정규화
    parentDailyUsed,
    parentDailyLimit,
    availableRemaining,
  };
}

/** 자녀 AI 크레딧 잔액/상태. 잔액 row 가 없으면 null. */
export async function fetchAiCredits(familyId: string, childUserId: string): Promise<AiCreditStatus | null> {
  const today = todayDateKST();
  const data = await apiGet<AiCreditBalanceResponse | null>(
    `/api/ai/credits/balance${aiQuery({ familyId, childUserId })}`,
  );
  const status = normalizeCreditRow(data?.balance, today);
  if (!status) return null;
  return { ...status, totalPurchased: Math.max(status.purchasedCredits, numberOr(data?.totalPurchased, 0)) };
}

// ── 크레딧 원장(ledger) ────────────────────────────────────────────────────

/** 크레딧 증감 한 건(충전 = 양수, 사용 = 음수). */
export interface AiCreditLedgerEntry {
  id: string;
  delta: number;
  reason: string;
  source: string;
  transactionId: string | null;
  messageId: string | null;
  createdAt: string | null;
}

interface AiCreditLedgerRow {
  id?: string;
  delta?: number | null;
  reason?: string | null;
  source?: string | null;
  transaction_id?: string | null;
  message_id?: string | null;
  created_at?: string | null;
}

function mapLedgerRow(row: AiCreditLedgerRow | null | undefined): AiCreditLedgerEntry | null {
  if (!row || !row.id) return null;
  return {
    id: row.id,
    delta: numberOr(row.delta, 0),
    reason: row.reason || "",
    source: row.source || "",
    transactionId: row.transaction_id || null,
    messageId: row.message_id || null,
    createdAt: row.created_at || null,
  };
}

/** 최근 크레딧 원장(충전/사용 이력). 최신순. */
export async function fetchAiCreditLedger(
  familyId: string,
  childUserId: string,
  limit = 20,
): Promise<AiCreditLedgerEntry[]> {
  const rows = await apiGet<AiCreditLedgerRow[] | null>(
    `/api/ai/credits/ledger${aiQuery({ familyId, childUserId, limit })}`,
  );
  return (rows || []).map(mapLedgerRow).filter((e): e is AiCreditLedgerEntry => e !== null);
}

// ── 자녀 채팅 메시지 ────────────────────────────────────────────────────────

export type AiChatRole = "user" | "assistant";

/** 채팅 한 줄(오름차순 정렬 후 반환). user = 아이, assistant = AI 친구. */
export interface AiChatMessage {
  id: string;
  role: AiChatRole;
  content: string;
  characterEmoji: string | null;
  createdAt: string | null;
}

interface AiChatMessageRow {
  id?: string;
  role?: string | null;
  content?: string | null;
  animal_character?: string | null;
  created_at?: string | null;
}

// 서버가 감사 목적으로 남기는 내부 로그 마커([선제 대화]/[일정 삭제 확인] 등)를 아이 화면용 자연문으로 정리.
const PROACTIVE_LOG_PREFIX = "[선제 대화]";
const CHAT_LOG_DISPLAY_RULES: { prefix: string; display: (rest: string) => string }[] = [
  { prefix: "[일정 삭제 확인]", display: (rest) => (rest ? `${rest} 일정 지워줘` : "일정 지워줘") },
  { prefix: "[일정 수정 확인]", display: (rest) => (rest ? `${rest} 일정 바꿔줘` : "일정 바꿔줘") },
  { prefix: "[부모 메시지 전송 확인]", display: (rest) => (rest ? `부모님께 보내줘: ${rest}` : "부모님께 보내줘") },
  { prefix: "[브리핑]", display: () => "" },
];

function formatChatContent(content: string): string {
  let text = content;
  if (text.startsWith(PROACTIVE_LOG_PREFIX)) text = text.slice(PROACTIVE_LOG_PREFIX.length).trimStart();
  for (const rule of CHAT_LOG_DISPLAY_RULES) {
    if (text.startsWith(rule.prefix)) return rule.display(text.slice(rule.prefix.length).trim());
  }
  return text;
}

function mapMessageRow(row: AiChatMessageRow | null | undefined): AiChatMessage | null {
  if (!row || !row.id) return null;
  const role: AiChatRole = row.role === "assistant" ? "assistant" : "user";
  const content = formatChatContent(String(row.content || ""));
  if (!content.trim()) return null; // 숨김 마커([브리핑])는 빈 문자열 → 기록에서 제거.
  return {
    id: row.id,
    role,
    content,
    characterEmoji: row.animal_character || null,
    createdAt: row.created_at || null,
  };
}

/** 자녀의 최근 메시지 N개. 서버는 최신순(DESC)으로 주므로 오름차순으로 뒤집어 반환. */
export async function fetchAiMessages(
  familyId: string,
  childUserId: string,
  limit = 20,
): Promise<AiChatMessage[]> {
  const rows = await apiGet<AiChatMessageRow[] | null>(
    `/api/ai/messages${aiQuery({ familyId, childUserId, limit })}`,
  );
  return (rows || [])
    .slice()
    .reverse()
    .map(mapMessageRow)
    .filter((m): m is AiChatMessage => m !== null);
}

// ── 자녀 채팅 전송(쓰기 · 크레딧 소모) ──────────────────────────────────────

export interface SendChildChatInput {
  message: string;
  /** 아이가 고른 동물 캐릭터 이모지(있으면 페르소나 결정). */
  characterEmoji?: string;
}

/** 전송 성공 응답. 인증/한도/크레딧 차감/저장은 Worker 가 처리한다. */
export interface ChildChatReply {
  reply: string;
  /** 저장된 assistant 행 ID. 이 ID가 있어야 방금 받은 답변도 즉시 신고할 수 있다. */
  assistantMessageId?: string | null;
  remaining?: number;
  dailyLimit?: number;
  creditBalance?: number;
  character?: string;
  characterName?: string;
  flagged?: boolean;
}

/**
 * 메시지 전송. childUserId 는 서버가 인증 세션에서 파생하므로 보내지 않는다.
 * 한도 초과·기능 비활성 등은 Worker 가 비-2xx + { error } 로 응답 → apiPost 가 ApiError 로 throw.
 * 호출부(useSendChildChat)는 onError 에서 ApiError.message(에러 코드)를 분기한다.
 */
export async function sendChildChat(input: SendChildChatInput): Promise<ChildChatReply> {
  const message = String(input.message || "").trim();
  if (!message) throw new Error("메시지를 입력해주세요");
  const characterEmoji = typeof input.characterEmoji === "string" ? input.characterEmoji.trim() : "";
  return apiPost<ChildChatReply>("/api/ai/child-chat", {
    message,
    usageDate: todayDateKST(),
    ...(characterEmoji ? { characterEmoji } : {}),
  });
}

// ── AI 일정 파싱(voice-parse · 텍스트/음성/알림장 → 일정 후보) ──────────────
// Worker(/api/ai/voice-parse)가 인증·프롬프트·LLM 호출을 수행하고
// { action, events, message } 를 돌려준다(hyeni-1 AiScheduleModal 계약 이관).
// ⚠️ LLM 호출(비용 발생) — 반드시 사용자 액션(버튼)에서만 호출. 자동 실행 금지.

/** 파싱 요청. currentDate.month 는 0-indexed(hyeni-1 규칙, "내일" 등 상대 날짜 해석 기준). */
export interface ParseScheduleInput {
  text: string;
  /** 알림장 사진 base64 data URI. 텍스트 전용이면 생략. */
  image?: string;
  mode?: "paste" | "voice";
  academies?: { name: string; category?: string }[];
  todayEvents?: { id: string; title: string; time: string | null; memo: string }[];
  currentDate: { year: number; month: number; day: number };
}

/** LLM 이 뽑은 일정 후보 한 건. month 는 0-indexed, 누락 필드는 호출부가 currentDate 로 대체. */
export interface ParsedScheduleEvent {
  title: string;
  time?: string | null; // "HH:MM" | "null"
  category?: string; // school/sports/hobby/family/friend/other
  memo?: string;
  academyName?: string;
  year?: number;
  month?: number; // 0-indexed
  day?: number;
}

/** 파싱 결과(정규화). events 가 비면 message 로 사유를 표시. */
export interface ParseScheduleResult {
  events: ParsedScheduleEvent[];
  message: string | null;
}

interface VoiceParseResponse extends Partial<ParsedScheduleEvent> {
  action?: string;
  events?: ParsedScheduleEvent[] | null;
  message?: string | null;
}

// action 별 응답을 events 배열로 통일(add_events → events, add_event → [최상위 필드]).
function normalizeParsedSchedule(data: VoiceParseResponse | null | undefined): ParseScheduleResult {
  if (!data) return { events: [], message: "일정을 정리하지 못했어요" };
  if (data.action === "add_events" && Array.isArray(data.events) && data.events.length > 0) {
    return { events: data.events, message: null };
  }
  if (data.action === "add_event" && data.title) {
    return {
      events: [
        {
          title: data.title,
          time: data.time ?? null,
          category: data.category,
          memo: data.memo,
          academyName: data.academyName,
          year: data.year,
          month: data.month,
          day: data.day,
        },
      ],
      message: null,
    };
  }
  return { events: [], message: data.message || "일정을 찾지 못했어요" };
}

/**
 * 텍스트/사진 → 일정 후보 파싱. Worker(/api/ai/voice-parse) 경유.
 * ⚠️ LLM 호출(비용) — 사용자 액션(버튼)에서만 호출(자동 실행 금지).
 */
export async function parseSchedule(input: ParseScheduleInput): Promise<ParseScheduleResult> {
  const text = String(input.text || "").trim();
  if (!text && !input.image) throw new Error("정리할 내용을 입력해주세요");
  const body = {
    text: text || "이미지에서 일정을 추출해주세요",
    ...(input.image ? { image: input.image } : {}),
    mode: input.mode || "paste",
    academies: input.academies ?? [],
    todayEvents: input.todayEvents ?? [],
    currentDate: input.currentDate,
  };
  const data = await apiPost<VoiceParseResponse>("/api/ai/voice-parse", body);
  return normalizeParsedSchedule(data);
}

// ── AI 하루 요약(day-summary · 프리미엄) ──────────────────────────────────────
// Worker(/api/ai/day-summary): GET = 캐시 read(무과금), POST = 생성(프리미엄·AI 과금).
// ⚠️ dateKey 는 ISO "YYYY-MM-DD"(서버 정규식 검증). 앱 date_key(0-index 월)와 다르므로
//    호출부가 반드시 @/transform/dateKey 의 dateKeyToDateInputValue 로 변환해 넘긴다.

/** 서버 extractDaySummarySignals 산출 신호(모두 옵셔널). 화면이 요약 근거를 렌더한다. */
export interface DaySummarySignals {
  notArrived?: number;
  dangerZone?: number;
  sos?: number;
  playdate?: number;
  chatCount?: number;
  chatTopics?: string[];
  alertHighlights?: string[];
  dwellPlaces?: { title: string; durationLabel: string }[];
  events?: { title: string; time: string }[];
  totalDistanceM?: number;
  promptVersion?: number;
  empty?: boolean;
}

/** 클라가 생성 품질을 위해 추가로 보내는 신호(일정/체류/이동거리). 전부 옵셔널. */
export interface DaySummaryClientSignals {
  events?: { title: string; time: string }[];
  dwellPlaces?: { title: string; durationLabel: string }[];
  totalDistanceM?: number;
}

export interface DaySummaryInput {
  familyId: string;
  childUserId: string;
  /** ISO "YYYY-MM-DD". */
  dateKey: string;
  clientSignals?: DaySummaryClientSignals;
}

/** 캐시된 요약(GET 결과). 없으면 null. */
export interface DaySummaryCache {
  summary: string;
  signals: DaySummarySignals | null;
}

/** 생성 결과(POST). premium=false=잠금, empty=true=특별한 기록 없음. */
export interface DaySummaryResult {
  premium: boolean;
  summary: string;
  signals: DaySummarySignals | null;
  empty: boolean;
  cached: boolean;
  error?: string;
}

interface DaySummaryGetResponse {
  summary?: string | null;
  signals?: DaySummarySignals | null;
}
interface DaySummaryPostResponse {
  premium?: boolean;
  summary?: string | null;
  signals?: DaySummarySignals | null;
  empty?: boolean;
  cached?: boolean;
  error?: string;
}

/** 캐시 read(무과금). 서버가 { summary, signals } 또는 null 반환. */
export async function fetchDaySummary(input: DaySummaryInput): Promise<DaySummaryCache | null> {
  const { familyId, childUserId, dateKey } = input;
  if (!familyId || !childUserId || !dateKey) return null;
  const data = await apiGet<DaySummaryGetResponse | null>(
    `/api/ai/day-summary${aiQuery({ familyId, childUserId, dateKey })}`,
  );
  if (!data) return null;
  return { summary: String(data.summary ?? ""), signals: data.signals ?? null };
}

/**
 * 하루 요약 생성(프리미엄·AI 과금). ⚠️ 사용자 액션(버튼)에서만 호출.
 * 서버가 프리미엄/캐시/신호수집/OpenAI 를 처리하고 { premium, summary, ... } 반환.
 */
export async function generateDaySummary(input: DaySummaryInput): Promise<DaySummaryResult> {
  const { familyId, childUserId, dateKey, clientSignals } = input;
  const data = await apiPost<DaySummaryPostResponse>("/api/ai/day-summary", {
    familyId,
    childUserId,
    dateKey,
    ...(clientSignals ? { clientSignals } : {}),
  });
  return {
    premium: data.premium !== false,
    summary: String(data.summary ?? ""),
    signals: data.signals ?? null,
    empty: data.empty === true,
    cached: data.cached === true,
    error: data.error,
  };
}

// ── AI 친구 설정(ai_parent_settings · ai_chat_settings) ──────────────────────

/** 자녀별 AI 친구 상세 설정(부모 전용 read/write). 서버가 boolean·배열로 정규화한다. */
export interface AiFriendSettings {
  ai_enabled?: boolean;
  ai_friend_name?: string | null;
  daily_limit?: number;
  parent_instructions?: string | null;
  forbidden_topics?: string[];
  forbidden_phrases?: string[];
  allowed_topics?: string[];
  child_traits?: string | null;
  sensitive_triggers?: string | null;
  education_style?: string | null;
  proactive_enabled?: boolean;
  proactive_start_time?: string | null;
  proactive_end_time?: string | null;
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
  memory_enabled?: boolean;
  long_term_memory_enabled?: boolean;
  allow_schedule_actions?: boolean;
  allow_contact_actions?: boolean;
  safety_notification_level?: string | null;
}

/** 공개 설정(부모 또는 자녀 본인 read). 노출 안전 필드만 — 아이 화면이 친구 이름을 읽을 때 사용. */
export interface AiFriendPublicSettings {
  ai_enabled?: boolean;
  ai_friend_name?: string | null;
  daily_limit?: number;
  proactive_enabled?: boolean;
  proactive_start_time?: string | null;
  proactive_end_time?: string | null;
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
}

/** 부모 전용 상세 설정 조회(GET /settings/friend). 미설정이면 null. */
export async function fetchAiFriendSettings(
  familyId: string,
  childUserId: string,
): Promise<AiFriendSettings | null> {
  return apiGet<AiFriendSettings | null>(
    `/api/ai/settings/friend${aiQuery({ familyId, childUserId })}`,
  );
}

/** 오늘 AI 대화 사용량(GET /usage/today · 부모/자녀 본인). 오늘 기록이 없으면 null. */
export interface AiUsageToday {
  count: number;
  usage_date: string;
}

/**
 * 아이 세션도 호출 가능한 유일한 사용량 소스.
 * `/credits/balance` 는 부모 전용(403)이라 아이 화면에서는 절대 부르지 않는다.
 */
export async function fetchAiUsageToday(
  familyId: string,
  childUserId: string,
): Promise<AiUsageToday | null> {
  return apiGet<AiUsageToday | null>(`/api/ai/usage/today${aiQuery({ familyId, childUserId })}`);
}

/** 공개 설정 조회(GET /settings/friend-public · 부모/자녀 본인). 미설정이면 null. */
export async function fetchAiFriendPublicSettings(
  familyId: string,
  childUserId: string,
): Promise<AiFriendPublicSettings | null> {
  return apiGet<AiFriendPublicSettings | null>(
    `/api/ai/settings/friend-public${aiQuery({ familyId, childUserId })}`,
  );
}

/** 부모 전용 설정 저장(PATCH /settings/friend · 부분 patch). snake_case 정규화 값을 넘긴다. */
export async function saveAiFriendSettings(
  patch: Partial<AiFriendSettings> & { familyId: string; childUserId: string },
): Promise<void> {
  const { familyId, childUserId, ...rest } = patch;
  await apiPatch<{ ok?: boolean }>("/api/ai/settings/friend", {
    family_id: familyId,
    child_user_id: childUserId,
    ...rest,
  });
}

/**
 * 자녀 본인이 AI 친구 이름 설정(POST /settings/friend-name · SECURITY DEFINER).
 * childUserId 는 서버가 세션에서 파생 — familyId 만 넘긴다. 서버가 확정 이름을 돌려준다.
 */
export async function setAiFriendName(familyId: string, name: string): Promise<string> {
  const data = await apiPost<{ name?: string }>("/api/ai/settings/friend-name", {
    familyId,
    name,
  });
  return String(data?.name ?? name);
}

/** 가족 AI 채팅 설정(ai_chat_settings). enabled/daily_limit — 부모 전용. */
export interface AiChatSettings {
  enabled?: boolean;
  daily_limit?: number;
  updated_at?: string;
}

/** 채팅 설정 조회(GET /settings/chat · 가족 멤버 누구나 read). 미설정이면 null. */
export async function fetchAiChatSettings(familyId: string): Promise<AiChatSettings | null> {
  return apiGet<AiChatSettings | null>(`/api/ai/settings/chat${aiQuery({ familyId })}`);
}

/** 채팅 설정 저장(PATCH /settings/chat · 부모 전용). credit_balance 는 서버가 건드리지 않는다. */
export async function saveAiChatSettings(
  input: { familyId: string; enabled: boolean; dailyLimit: number },
): Promise<void> {
  await apiPatch<{ ok?: boolean }>("/api/ai/settings/chat", {
    family_id: input.familyId,
    enabled: input.enabled,
    daily_limit: input.dailyLimit,
  });
}

// ── AI 크레딧 서버 부여(grant) ────────────────────────────────────────────────
// 실결제는 네이티브 Google Play(billing.ts → /api/billing/google-play-verify)가 담당한다.
// 이 경로(POST /credits/purchase)는 purchase_ai_credits 계약 이관 — 멱등 grant(QA/수동 부여)용.
// 웹 화면은 결제를 네이티브에 위임하므로 직접 호출하지 않는다(계약 보존을 위해 함수만 제공).

export interface PurchaseAiCreditsInput {
  familyId: string;
  childUserId: string;
  /** 부여할 개수(1~1000). */
  amount: number;
  /** 멱등키(동일 값 재호출 시 현재 잔액 반환). */
  transactionId?: string;
}

/** 서버 크레딧 부여(멱등). 부여 후 잔액 row 반환. */
export async function purchaseAiCreditsGrant(
  input: PurchaseAiCreditsInput,
): Promise<AiCreditBalanceRow> {
  return apiPost<AiCreditBalanceRow>("/api/ai/credits/purchase", {
    familyId: input.familyId,
    childUserId: input.childUserId,
    amount: input.amount,
    ...(input.transactionId ? { transactionId: input.transactionId } : {}),
  });
}

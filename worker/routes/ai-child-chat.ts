// POST /api/ai/child-chat  ← supabase/functions/ai-child-chat (직역, 가장 큰 AI 함수).
// 아이모드 AI 친구 채팅 + 결정적 도구 에이전트(일정 조회/추가/수정/삭제, 부모 전화/메시지,
// 안전 알림). 인증/일일 한도/크레딧 차감/로그/기억을 단일 진입점에서 처리.
//
// 인증: requireAuth(JWT) = c.get("user").sub. 원본 service_role/getUser 경로 제거. member 는
// user_id=sub & role='child' 로만 조회 → "자녀 본인" 게이트 보존(권한 약화 없음).
//
// 크레딧 멱등성(CRITICAL): 저장된 assistantMessageId를 transaction_id로 사용하고 잔액 UPDATE와
// 원장 INSERT를 D1 batch에서 함께 확정한다.
// ai_credit_balances seed는 (family_id,child_user_id) UNIQUE 기반 conflict-safe insert 뒤
// DB 정본을 재조회한다. ai-proactive.ts와 동일 패턴.
//
// D1 함정:
//  · boolean 컬럼(ai_enabled/allow_*_actions/memory_enabled/...) = INTEGER 0/1 → toBool 정규화.
//    (planner readParentToolSetting 은 `!== false` 라 0 을 넘기면 disabled 를 enabled 로 오판.)
//  · jsonb 컬럼(forbidden_topics/forbidden_phrases/allowed_topics, events.location, alert metadata)
//    = TEXT(JSON) → parseJson/ JSON.stringify.
//  · is_family_event 0/1 → toBool 정규화(`row.is_family_event !== true` 가 1 에 false 가 되도록).
//  · timestamp 범위비교 substr(col,1,19) >= datetime(?)(KST 경계). write 는 pgNow().
//  · events_children 중첩 select 미지원 → 별도 조인 쿼리.
//
// 확인 토큰 secret: 원본은 SUPABASE_SERVICE_ROLE_KEY. Worker 엔 없으므로 안정 provisioned
// 비밀인 JWT_PRIVATE_KEY 를 HMAC secret 으로 사용(토큰 생성·검증 모두 Worker 내부라 자기일관).
import { Hono } from "hono";
import type { Env, Vars } from "../types";
import { requireAuth } from "../middleware/auth";
import { pgNow } from "../lib/time";
import { parseJson, toBool } from "../lib/serialize";
import { openaiChatUrl, openaiLunaChatConfig, openaiSafetyIdentifier } from "../lib/openai";
import { classifyOpenAiError, writeOpenAiLog } from "../lib/openaiLog";
import { notifyPg } from "../lib/realtime";
import {
  acquireAiCreditExecutionLease,
  AiCreditConsumptionUnavailableError,
  consumeAiCreditAtomic,
  releaseAiCreditExecutionLease,
  type AiCreditExecutionLease,
} from "../lib/aiCreditConsumption";
import { resolveCanonicalFamilyMembership } from "../db/authz";
import {
  adaptResponseForAge,
  applyParentReplyGuardrails,
  buildChildSystemPrompt,
  buildParentAllowedTopicReply,
  buildParentForbiddenTopicReply,
  calculateChildAge,
  getAgeBand,
} from "../shared/aiChildContext.js";
import { planChildAgentAction } from "../shared/aiAgentPlanner.js";
import { AI_CHILD_OPERATOR_PROMPT_KEY, readGlobalSetting } from "../lib/globalSettings.ts";
import {
  applyParentDailyChatLimit,
  buildAiCreditBalanceRow,
  buildAiCreditBalanceSubscriptionSyncPatch,
  getAiCreditStatus,
  PREMIUM_AI_DAILY_INCLUDED_CREDITS,
  resolveIncludedDailyLimit,
} from "../shared/aiCredits.js";
import { resolveFamilyEntitlement } from "../shared/subscriptionEntitlement.js";
import {
  buildScheduleEventRow,
  isValidScheduleChangeTimeRange,
  isValidScheduleDate,
  isValidScheduleTime,
  isValidScheduleTimeRange,
  toAppDateKey,
  toAppDateKeysInWindow,
} from "../shared/aiScheduleTools.js";
import { createLongTermMemoryPatch } from "../shared/aiMemoryPolicy.js";
import { selectParentContactForRole } from "../shared/aiContactTools.js";
import { buildSafetyEventAndAlert, ensureChildSafetyReply } from "../shared/aiSafetyPolicy.js";
import { buildParentMessageAlert, sanitizeChildParentMessage } from "../shared/aiParentMessageTools.js";
import { buildConversationSummaryRow, shouldStoreConversationSummary } from "../shared/aiConversationSummary.js";
import { shouldBypassAiCreditLimit, shouldChargeForAiTurn } from "../shared/aiUsagePolicy.js";
import { createAiToolConfirmationToken, verifyAiToolConfirmationToken } from "../shared/aiConfirmationToken.js";
import { sanitizeAiToolResultForPrompt } from "../shared/aiToolResultPrompt.js";
import { buildAgentPlanChildReply, buildToolResultChildReply } from "../shared/aiToolResultReply.js";
import { aiMutationScopeErrorResponse, aiMutationScopeState } from "../lib/aiMutationScope";

type OpenAiChatResponse = {
  choices?: Array<{ message?: { content?: string }; finish_reason?: unknown }>;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown };
};

const chat = new Hono<{ Bindings: Env; Variables: Vars }>();
const AI_CHILD_CHAT_TIMEOUT_MS = 30_000;

// ── .js 모듈(checkJs:false) 호출용 any 캐스트 별칭 ──
type AnyFn = (...args: any[]) => any;
const buildChildSystemPromptFn = buildChildSystemPrompt as AnyFn;
const planChildAgentActionFn = planChildAgentAction as AnyFn;
const getAiCreditStatusFn = getAiCreditStatus as AnyFn;
const applyParentDailyChatLimitFn = applyParentDailyChatLimit as AnyFn;
const buildAiCreditBalanceRowFn = buildAiCreditBalanceRow as AnyFn;
const buildAiCreditBalanceSubscriptionSyncPatchFn = buildAiCreditBalanceSubscriptionSyncPatch as AnyFn;
const resolveIncludedDailyLimitFn = resolveIncludedDailyLimit as AnyFn;
const createLongTermMemoryPatchFn = createLongTermMemoryPatch as AnyFn;
const selectParentContactForRoleFn = selectParentContactForRole as AnyFn;
const buildSafetyEventAndAlertFn = buildSafetyEventAndAlert as AnyFn;
const buildParentMessageAlertFn = buildParentMessageAlert as AnyFn;
const buildConversationSummaryRowFn = buildConversationSummaryRow as AnyFn;
const buildScheduleEventRowFn = buildScheduleEventRow as AnyFn;
const createAiToolConfirmationTokenFn = createAiToolConfirmationToken as AnyFn;
const verifyAiToolConfirmationTokenFn = verifyAiToolConfirmationToken as AnyFn;

// ── 페르소나 / 안전 키워드(원본 직역) ──
const PERSONAS: Record<string, { name: string; tone: string; trait: string; species: string }> = {
  "🐰": { name: "통통이", species: "토끼", tone: "활발하고 친근한", trait: "호기심이 많고 친구를 금방 좋아하며 다정하게 먼저 말을 걸어" },
  "🐱": { name: "야옹이", species: "고양이", tone: "장난스럽고 재미있는", trait: "가벼운 농담과 재치있는 말로 즐겁게 해줘" },
  "🦊": { name: "꼬미", species: "여우", tone: "깜찍하고 귀여운", trait: "애교 섞인 귀여운 말투로 이야기해" },
  "🐶": { name: "멍이", species: "강아지", tone: "씩씩하고 충직한", trait: "언제나 네 편이라며 든든하게 응원해" },
  "🐥": { name: "삐약이", species: "병아리", tone: "호기심 가득하고 귀여운", trait: "궁금한 걸 많이 물어보며 짧고 귀엽게 말해" },
  "🐻": { name: "곰돌이", species: "곰", tone: "포근하고 든든한", trait: "엄마 아빠처럼 따뜻하게 챙기고 보살펴" },
  "🐼": { name: "푸푸", species: "판다", tone: "평화롭고 순한", trait: "마음을 진정시켜 줘" },
  "🐯": { name: "호야", species: "호랑이", tone: "씩씩하고 용감한", trait: "용기를 북돋워 줘" },
};

function getPersona(emoji: string) {
  return PERSONAS[emoji] || PERSONAS["🐰"];
}

function resolveChatCharacterEmoji(requestedValue: unknown, fallbackValue: unknown): string {
  const requested = String(requestedValue || "").trim();
  const fallbackRaw = String(fallbackValue || "🐰").trim();
  const fallback = PERSONAS[fallbackRaw] ? fallbackRaw : "🐰";
  return PERSONAS[requested] ? requested : fallback;
}

const SAFETY_KEYWORDS = [
  "죽고싶", "죽고 싶", "자살", "자해", "때려", "맞았어", "무서워서 못", "도와줘 누가",
  "아무도 몰래", "비밀이야 진짜", "피가 나", "다쳤어",
];

function detectSafetyFlag(text: string): boolean {
  const lower = text.toLowerCase();
  return SAFETY_KEYWORDS.some((kw) => lower.includes(kw));
}

const CONTACT_AGENT_TOOLS = new Set(["callParent", "createMessageToParent"]);
const SCHEDULE_AGENT_TOOLS = new Set([
  "getTodaySchedule",
  "getScheduleByDate",
  "createSchedule",
  "updateSchedule",
  "deleteSchedule",
]);

function isAgentToolAllowedForPrompt(
  toolName: unknown,
  { allowScheduleActions, allowContactActions }: { allowScheduleActions: boolean; allowContactActions: boolean },
): boolean {
  const name = String(toolName || "");
  if (!name) return false;
  if (CONTACT_AGENT_TOOLS.has(name)) return allowContactActions;
  if (SCHEDULE_AGENT_TOOLS.has(name)) return allowScheduleActions;
  return name === "notifyParent";
}

function isScheduleLookupToolResult(toolResult: any): boolean {
  if (!toolResult || typeof toolResult !== "object") return false;
  if (toolResult.ok !== true) return false;
  return toolResult.toolName === "getTodaySchedule" || toolResult.toolName === "getScheduleByDate";
}

function formatFamilyMemberForPrompt(member: Record<string, unknown>): string {
  const role = String(member?.role || "").trim();
  const gender = String(member?.gender || "").trim();
  const name = String(member?.name || "").trim();
  if (role === "parent") {
    if (gender === "mom") return name ? `엄마(${name})` : "엄마";
    if (gender === "dad") return name ? `아빠(${name})` : "아빠";
    return name ? `보호자(${name})` : "보호자";
  }
  if (role === "child") return name ? `아이(${name})` : "아이";
  return name || role || "";
}

function toPublicCreditBalance(value: unknown): number {
  return Number(value) > 0 ? 1 : 0;
}

// ── KST / 날짜 헬퍼(원본 직역) ──
function todayDateKST(now = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

export function resolveAiChatDates(
  requestedUsageDate: unknown,
  serverNow = new Date(),
): { contextDate: string; quotaDate: string } {
  const quotaDate = todayDateKST(serverNow);
  const contextDate = typeof requestedUsageDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(requestedUsageDate)
    ? requestedUsageDate
    : quotaDate;
  return { contextDate, quotaDate };
}

function nowHHMMKST(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return `${String(kst.getUTCHours()).padStart(2, "0")}:${String(kst.getUTCMinutes()).padStart(2, "0")}`;
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ""));
  if (!match) return todayDateKST();
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return date.toISOString().slice(0, 10);
}

// KST 자정 경계. SQLite datetime() 이 '+09:00'(타임존 포함)을 UTC 로 변환 → substr(,19)(UTC) 정합.
function kstDateBoundary(dateKey: string): string {
  return `${dateKey}T00:00:00+09:00`;
}

// D1 boolean 바인딩 미지원 → INTEGER 0/1.
function b(v: unknown): number {
  return v ? 1 : 0;
}

// ── events row 매핑(D1 jsonb/boolean 정규화) ──
function mapEventRow(row: Record<string, any>): Record<string, any> {
  return {
    ...row,
    location: parseJson(row.location),
    is_family_event: toBool(row.is_family_event),
  };
}

function eventRowToToolEvent(row: Record<string, any>) {
  return {
    id: row.id,
    title: row.title,
    time: row.time,
    endTime: row.end_time || null,
    memo: row.memo || "",
    location: row.location || null,
    dateKey: row.date_key || null,
  };
}

function formatScheduleTimeRange(startTime: unknown, endTime: unknown): string {
  const start = String(startTime || "").trim();
  const end = String(endTime || "").trim();
  if (start && end) return `${start}-${end}`;
  return start || end;
}

function formatScheduleChangeTimeText(safeChanges: Record<string, string>, event: Record<string, any>): string {
  if (!safeChanges.startTime && !safeChanges.endTime) return "";
  const timeLabel = formatScheduleTimeRange(safeChanges.startTime || event.time, safeChanges.endTime || event.endTime);
  return timeLabel ? ` ${timeLabel}로` : "";
}

function childLinksForEvent(row: Record<string, any>): Array<{ child_id?: string }> {
  return Array.isArray(row.events_children) ? row.events_children : [];
}

function isEventLinkedToChild(row: Record<string, any>, childMemberId: string): boolean {
  return childLinksForEvent(row).some((link) => link?.child_id === childMemberId);
}

function isChildDeletableEvent(row: Record<string, any>, childMemberId: string): boolean {
  return !!row && row.is_family_event !== true && isEventLinkedToChild(row, childMemberId);
}

function isSingleChildMutableEvent(row: Record<string, any>, childMemberId: string): boolean {
  const links = childLinksForEvent(row);
  return row.is_family_event !== true && links.length === 1 && links[0]?.child_id === childMemberId;
}

function normalizeScheduleTitle(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "");
}

function scheduleTitleMatches(rowTitle: unknown, requestedTitle: unknown): boolean {
  const row = normalizeScheduleTitle(rowTitle);
  const requested = normalizeScheduleTitle(requestedTitle);
  if (!row || !requested) return false;
  return row.includes(requested) || requested.includes(row);
}

function sanitizeScheduleChanges(value: unknown): Record<string, string> {
  const input = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const changes: Record<string, string> = {};
  const title = String(input.title || "").trim();
  const date = String(input.date || "").trim();
  const startTime = String(input.startTime || "").trim();
  const endTime = String(input.endTime || "").trim();
  const hasStartTime = isValidScheduleTime(startTime);
  const hasEndTime = isValidScheduleTime(endTime);
  const hasInvalidTimeRange = hasStartTime && hasEndTime && !isValidScheduleTimeRange(startTime, endTime);

  if (title) changes.title = title.slice(0, 80);
  if (isValidScheduleDate(date)) changes.date = date;
  if (hasStartTime && !hasInvalidTimeRange) changes.startTime = startTime;
  if (hasEndTime && !hasInvalidTimeRange) changes.endTime = endTime;
  return changes;
}

function scheduleUpdatePatchFromChanges(changes: Record<string, string>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (changes.title) patch.title = changes.title;
  if (changes.date) patch.date_key = toAppDateKey(changes.date);
  if (changes.startTime) patch.time = changes.startTime;
  if (changes.endTime) patch.end_time = changes.endTime;
  return patch;
}

function confirmationExpiresAt(): number {
  return Date.now() + 10 * 60 * 1000;
}

async function addConfirmationToken(
  result: Record<string, unknown>,
  payload: Record<string, unknown>,
  secret: string,
): Promise<Record<string, unknown>> {
  return {
    ...result,
    confirmationToken: await createAiToolConfirmationTokenFn({ ...payload, expiresAt: confirmationExpiresAt() }, secret),
  };
}

async function verifyConfirmedToolPayload(token: unknown, expectedPayload: Record<string, unknown>, secret: string) {
  return await verifyAiToolConfirmationTokenFn(String(token || ""), expectedPayload, secret);
}

// ── D1 이벤트 조회 헬퍼(events_children 조인) ──
const EVENT_COLS = "id, title, time, end_time, memo, location, date_key, is_family_event";

async function attachChildren(db: D1Database, rows: Record<string, any>[]): Promise<Record<string, any>[]> {
  if (rows.length === 0) return rows;
  const ids = rows.map((r) => r.id);
  const ph = ids.map(() => "?").join(",");
  const { results } = await db
    .prepare(`SELECT event_id, child_id FROM events_children WHERE event_id IN (${ph})`)
    .bind(...ids)
    .all<{ event_id: string; child_id: string }>();
  const byEvent: Record<string, Array<{ child_id: string }>> = {};
  for (const r of results ?? []) {
    (byEvent[r.event_id] ||= []).push({ child_id: r.child_id });
  }
  return rows.map((r) => ({ ...r, events_children: byEvent[r.id] ?? [] }));
}

async function loadSingleEvent(db: D1Database, familyId: string, scheduleId: string): Promise<Record<string, any> | null> {
  const row = await db
    .prepare(`SELECT ${EVENT_COLS} FROM events WHERE family_id=? AND id=? LIMIT 1`)
    .bind(familyId, scheduleId)
    .first<Record<string, any>>();
  if (!row) return null;
  const { results } = await db
    .prepare("SELECT child_id FROM events_children WHERE event_id=?")
    .bind(scheduleId)
    .all<{ child_id: string }>();
  return { ...mapEventRow(row), events_children: (results ?? []).map((k) => ({ child_id: k.child_id })) };
}

async function loadEventsByDateKey(db: D1Database, familyId: string, dateKey: string): Promise<Record<string, any>[]> {
  const { results } = await db
    .prepare(`SELECT ${EVENT_COLS} FROM events WHERE family_id=? AND date_key=? ORDER BY time ASC`)
    .bind(familyId, dateKey)
    .all<Record<string, any>>();
  return attachChildren(db, (results ?? []).map(mapEventRow));
}

async function loadEventsByDateKeys(db: D1Database, familyId: string, dateKeys: string[]): Promise<Record<string, any>[]> {
  if (dateKeys.length === 0) return [];
  const ph = dateKeys.map(() => "?").join(",");
  const { results } = await db
    .prepare(
      `SELECT ${EVENT_COLS} FROM events WHERE family_id=? AND date_key IN (${ph}) ORDER BY date_key DESC, time ASC LIMIT 8`,
    )
    .bind(familyId, ...dateKeys)
    .all<Record<string, any>>();
  return attachChildren(db, (results ?? []).map(mapEventRow));
}

// 오늘 KST 범위의 chat_response/proactive_message 차감 건수(원본 직역, ai-proactive 와 동일).
async function loadDailyAiCreditLedgerCount(
  db: D1Database,
  familyId: string,
  childUserId: string,
  usageDate: string,
): Promise<number | null> {
  try {
    const row = await db
      .prepare(
        `SELECT COUNT(id) AS cnt FROM ai_credit_ledger
          WHERE family_id=? AND child_user_id=? AND reason IN ('chat_response','proactive_message')
            AND substr(created_at,1,19) >= datetime(?) AND substr(created_at,1,19) < datetime(?)`,
      )
      .bind(familyId, childUserId, kstDateBoundary(usageDate), kstDateBoundary(addDaysToDateKey(usageDate, 1)))
      .first<{ cnt: number }>();
    return Number.isFinite(Number(row?.cnt)) ? Number(row?.cnt) : 0;
  } catch (e) {
    console.error("[ai-child-chat] AI credit ledger count failed");
    return null;
  }
}

interface ChatBody {
  message?: string;
  usageDate?: string;
  characterEmoji?: string;
  confirmedTool?: {
    toolName?: string;
    parentRole?: string;
    message?: string;
    scheduleId?: string;
    title?: string;
    changes?: Record<string, unknown>;
    confirmationToken?: string;
  };
}

chat.post("/child-chat", requireAuth, async (c) => {
  const db = c.env.DB;
  const authUser = c.get("user");
  const userId = authUser.sub;
  const confirmSecret = c.env.JWT_PRIVATE_KEY || "";
  const OPENAI_API_KEY = c.env.OPENAI_API_KEY || "";
  if (authUser.role !== "child") return c.json({ error: "not_child" }, 403);

  const canonical = await resolveCanonicalFamilyMembership(db, userId, authUser.family_id ?? null);
  if (!canonical || canonical.role !== "child") return c.json({ error: "no_family" }, 403);

  let body: ChatBody = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const message = (body.message || "").toString().trim();
  if (!message) return c.json({ error: "empty_message" }, 400);
  if (message.length > 500) return c.json({ error: "message_too_long" }, 400);

  const { contextDate, quotaDate } = resolveAiChatDates(body.usageDate);

  // ── 멤버 조회(자녀 본인 게이트) ──
  let member: Record<string, any> | null = null;
  try {
    member = await db
      .prepare(
        "SELECT id, family_id, role, name, birthdate, emoji FROM family_members WHERE family_id=? AND user_id=? AND role='child' AND is_active=1 LIMIT 1",
      )
      .bind(canonical.familyId, userId)
      .first<Record<string, any>>();
  } catch (e) {
    console.error("[ai-child-chat] family_members lookup failed");
    return c.json({ error: "lookup_failed" }, 500);
  }
  if (!member || !member.family_id) return c.json({ error: "no_family" }, 403);
  if (member.role !== "child") return c.json({ error: "not_child" }, 403);

  const familyId = String(member.family_id);
  const childMemberId = String(member.id);
  const childName = (member.name || "").toString();
  const birthdate = (member.birthdate || null) as string | null;
  const characterEmoji = resolveChatCharacterEmoji(body.characterEmoji, member.emoji);

  let executionLease: AiCreditExecutionLease;
  try {
    const acquired = await acquireAiCreditExecutionLease(db, {
      familyId,
      childUserId: userId,
    });
    if (acquired.status === "busy") {
      return c.json({ error: "ai_request_in_progress" }, 409);
    }
    executionLease = acquired.lease;
  } catch (error) {
    console.error("[ai-child-chat] execution lease unavailable");
    return c.json({ error: "ai_credit_consumption_unavailable" }, 503);
  }

  try {

  // ── 설정 조회 ──
  const settingsRow = await db
    .prepare("SELECT enabled, daily_limit FROM ai_chat_settings WHERE family_id=? LIMIT 1")
    .bind(familyId)
    .first<{ enabled: number; daily_limit: number }>();

  const rawParentSettings = await db
    .prepare(
      "SELECT ai_enabled, ai_friend_name, parent_instructions, forbidden_topics, forbidden_phrases, allowed_topics, child_traits, sensitive_triggers, education_style, proactive_enabled, proactive_start_time, proactive_end_time, quiet_hours_start, quiet_hours_end, daily_limit, memory_enabled, long_term_memory_enabled, allow_schedule_actions, allow_contact_actions, safety_notification_level FROM ai_parent_settings WHERE family_id=? AND child_user_id=? LIMIT 1",
    )
    .bind(familyId, userId)
    .first<Record<string, any>>();

  // D1 0/1 boolean·JSON TEXT 배열을 JS boolean·배열로 정규화(planner/context 정합).
  const parentSettingsRow: Record<string, any> | null = rawParentSettings
    ? {
        ...rawParentSettings,
        ai_enabled: toBool(rawParentSettings.ai_enabled),
        proactive_enabled: toBool(rawParentSettings.proactive_enabled),
        memory_enabled: toBool(rawParentSettings.memory_enabled),
        long_term_memory_enabled: toBool(rawParentSettings.long_term_memory_enabled),
        allow_schedule_actions: toBool(rawParentSettings.allow_schedule_actions),
        allow_contact_actions: toBool(rawParentSettings.allow_contact_actions),
        forbidden_topics: parseJson(rawParentSettings.forbidden_topics),
        forbidden_phrases: parseJson(rawParentSettings.forbidden_phrases),
        allowed_topics: parseJson(rawParentSettings.allowed_topics),
      }
    : null;

  const enabled = parentSettingsRow ? !!parentSettingsRow.ai_enabled : !!settingsRow?.enabled;
  const parentDailyLimit = Math.max(
    0,
    Math.min(
      100,
      Math.round(Number(parentSettingsRow?.daily_limit ?? settingsRow?.daily_limit ?? PREMIUM_AI_DAILY_INCLUDED_CREDITS) || 0),
    ),
  );
  let dailyLimit = parentDailyLimit;
  let creditBalance = 0;
  const contactActionsAllowed = parentSettingsRow?.allow_contact_actions !== false;
  const scheduleActionsAllowed = parentSettingsRow?.allow_schedule_actions !== false;
  if (!enabled) {
    return c.json({ error: "feature_disabled" }, 403);
  }

  // ── 확인된 도구: sendMessageToParent ──
  if (body.confirmedTool?.toolName === "sendMessageToParent") {
    if (!contactActionsAllowed) return c.json({ error: "contact_actions_disabled" }, 403);
    const parentRole = String(body.confirmedTool.parentRole || "guardian");
    const messageToParent = sanitizeChildParentMessage(body.confirmedTool.message);
    if (!messageToParent) return c.json({ error: "invalid_parent_message" }, 400);
    const confirmation = await verifyConfirmedToolPayload(
      body.confirmedTool.confirmationToken,
      { familyId, childUserId: userId, toolName: "sendMessageToParent", parentRole, message: messageToParent },
      confirmSecret,
    );
    if (!confirmation.ok) return c.json({ error: confirmation.error }, 403);
    const alertRow: any = buildParentMessageAlertFn({ familyId, childUserId: userId, childName, parentRole, message: messageToParent });
    if (!alertRow) return c.json({ error: "invalid_parent_message" }, 400);
    try {
      await db
        .prepare(
          "INSERT INTO parent_alerts (id, family_id, alert_type, title, message, severity, event_id, child_user_id, metadata, read, read_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,0,'{}',?)",
        )
        .bind(
          crypto.randomUUID(),
          alertRow.family_id,
          alertRow.alert_type,
          alertRow.title,
          alertRow.message,
          alertRow.severity ?? "info",
          null,
          null, // child_user_id: 원본은 컬럼 미설정(NULL), 자녀 식별은 metadata.child_user_id.
          JSON.stringify(alertRow.metadata ?? {}),
          pgNow(),
        )
        .run();
    } catch (e) {
      console.error("[ai-child-chat] parent message alert insert failed");
      return c.json({ error: "parent_message_failed" }, 500);
    }
    const reply = "부모님께 메시지를 보냈어.";
    const logged = await insertChatMessages(db, familyId, userId, characterEmoji, [
      { role: "user", content: `[부모 메시지 전송 확인] ${alertRow.message}`, flagged: false },
      { role: "assistant", content: reply, flagged: false },
    ]);
    if (!logged) return c.json({ error: "account_state_changed" }, 409);
    return c.json(
      {
        reply,
        toolResult: {
          ok: true,
          toolName: "sendMessageToParent",
          parentRole: alertRow.metadata.parent_role,
          message: messageToParent,
          parentNotified: true,
        },
        flagged: false,
        assistantMessageId: logged.assistantMessageId,
      },
      200,
    );
  }

  // ── 확인된 도구: deleteSchedule ──
  if (body.confirmedTool?.toolName === "deleteSchedule") {
    if (!scheduleActionsAllowed) return c.json({ error: "schedule_actions_disabled" }, 403);
    const scheduleId = String(body.confirmedTool.scheduleId || "").trim();
    if (!scheduleId) return c.json({ error: "invalid_schedule_id" }, 400);
    const confirmation = await verifyConfirmedToolPayload(
      body.confirmedTool.confirmationToken,
      { familyId, childUserId: userId, toolName: "deleteSchedule", scheduleId },
      confirmSecret,
    );
    if (!confirmation.ok) return c.json({ error: confirmation.error }, 403);

    let eventRow: Record<string, any> | null = null;
    try {
      eventRow = await loadSingleEvent(db, familyId, scheduleId);
    } catch (e) {
      console.error("[ai-child-chat] schedule delete lookup failed");
      return c.json({ error: "schedule_lookup_failed" }, 500);
    }
    if (!eventRow) return c.json({ error: "schedule_not_found" }, 404);
    if (!isChildDeletableEvent(eventRow, childMemberId)) return c.json({ error: "schedule_delete_not_allowed" }, 403);

    const eventForClient = eventRowToToolEvent(eventRow);
    const childLinks = childLinksForEvent(eventRow);
    let deleted = false;
    let removedForChild = false;

    if (childLinks.length > 1) {
      try {
        await db
          .prepare("DELETE FROM events_children WHERE event_id=? AND child_id=?")
          .bind(scheduleId, childMemberId)
          .run();
      } catch (e) {
        console.error("[ai-child-chat] schedule child unlink failed");
        return c.json({ error: "schedule_delete_failed" }, 500);
      }
      removedForChild = true;
    } else {
      try {
        await db.prepare("DELETE FROM events WHERE family_id=? AND id=?").bind(familyId, scheduleId).run();
        await db.prepare("DELETE FROM events_children WHERE event_id=?").bind(scheduleId).run();
      } catch (e) {
        console.error("[ai-child-chat] schedule delete failed");
        return c.json({ error: "schedule_delete_failed" }, 500);
      }
      deleted = true;
      removedForChild = true;
    }

    const title = String(eventForClient.title || body.confirmedTool.title || "일정");
    const reply = `${title} 일정을 지웠어.`;
    const logged = await insertChatMessages(db, familyId, userId, characterEmoji, [
      { role: "user", content: `[일정 삭제 확인] ${title}`, flagged: false },
      { role: "assistant", content: reply, flagged: false },
    ]);
    if (!logged) return c.json({ error: "account_state_changed" }, 409);
    return c.json(
      {
        reply,
        toolResult: { ok: true, toolName: "deleteSchedule", event: eventForClient, deleted, removedForChild },
        flagged: false,
        assistantMessageId: logged.assistantMessageId,
      },
      200,
    );
  }

  // ── 확인된 도구: updateSchedule ──
  if (body.confirmedTool?.toolName === "updateSchedule") {
    if (!scheduleActionsAllowed) return c.json({ error: "schedule_actions_disabled" }, 403);
    const scheduleId = String(body.confirmedTool.scheduleId || "").trim();
    if (!scheduleId) return c.json({ error: "invalid_schedule_id" }, 400);
    const safeChanges = sanitizeScheduleChanges(body.confirmedTool.changes);
    const updatePatch = scheduleUpdatePatchFromChanges(safeChanges);
    if (Object.keys(updatePatch).length === 0) return c.json({ error: "invalid_schedule_changes" }, 400);
    const confirmation = await verifyConfirmedToolPayload(
      body.confirmedTool.confirmationToken,
      { familyId, childUserId: userId, toolName: "updateSchedule", scheduleId, changes: safeChanges },
      confirmSecret,
    );
    if (!confirmation.ok) return c.json({ error: confirmation.error }, 403);

    let eventRow: Record<string, any> | null = null;
    try {
      eventRow = await loadSingleEvent(db, familyId, scheduleId);
    } catch (e) {
      console.error("[ai-child-chat] schedule update lookup failed");
      return c.json({ error: "schedule_lookup_failed" }, 500);
    }
    if (!eventRow) return c.json({ error: "schedule_not_found" }, 404);
    if (!isSingleChildMutableEvent(eventRow, childMemberId)) return c.json({ error: "schedule_update_not_allowed" }, 403);
    if (!isValidScheduleChangeTimeRange(eventRow, safeChanges)) return c.json({ error: "invalid_schedule_time_range" }, 400);

    try {
      const sets: string[] = [];
      const binds: unknown[] = [];
      for (const [k, v] of Object.entries(updatePatch)) {
        sets.push(`${k}=?`);
        binds.push(v);
      }
      sets.push("updated_at=?");
      binds.push(pgNow());
      binds.push(familyId, scheduleId);
      await db.prepare(`UPDATE events SET ${sets.join(", ")} WHERE family_id=? AND id=?`).bind(...binds).run();
    } catch (e) {
      console.error("[ai-child-chat] schedule update failed");
      return c.json({ error: "schedule_update_failed" }, 500);
    }

    const eventForClient = eventRowToToolEvent({ ...eventRow, ...updatePatch });
    const title = String(eventForClient.title || body.confirmedTool.title || "일정");
    const timeText = formatScheduleChangeTimeText(safeChanges, eventForClient);
    const reply = `${title} 일정을${timeText} 바꿨어.`;
    const logged = await insertChatMessages(db, familyId, userId, characterEmoji, [
      { role: "user", content: `[일정 수정 확인] ${title}`, flagged: false },
      { role: "assistant", content: reply, flagged: false },
    ]);
    if (!logged) return c.json({ error: "account_state_changed" }, 409);
    return c.json(
      {
        reply,
        toolResult: { ok: true, toolName: "updateSchedule", event: eventForClient, changes: safeChanges },
        flagged: false,
        assistantMessageId: logged.assistantMessageId,
      },
      200,
    );
  }

  // ── 크레딧 row 조회 + 구독 seed/sync ──
  let aiCreditRow: Record<string, any> | null = null;
  try {
    aiCreditRow = await db
      .prepare(
        "SELECT id, family_id, child_user_id, parent_id, is_premium, daily_included_limit, daily_included_used, daily_reset_date, purchased_credits FROM ai_credit_balances WHERE family_id=? AND child_user_id=? LIMIT 1",
      )
      .bind(familyId, userId)
      .first<Record<string, any>>();
  } catch (e) {
    console.error("[ai-child-chat] credit lookup failed");
    return c.json({ error: "lookup_failed" }, 500);
  }

  {
    let subscriptionIsPremium = false;
    try {
      subscriptionIsPremium = (await resolveFamilyEntitlement(db, familyId)).isPremium;
    } catch (error) {
      console.warn("[ai-child-chat] entitlement failed:");
      return c.json({ error: "family_entitlement_unavailable" }, 503);
    }

    if (!aiCreditRow) {
      const aiCreditSeed: any = buildAiCreditBalanceRowFn({
        familyId,
        childUserId: userId,
        today: quotaDate,
        isPremium: subscriptionIsPremium,
        parentDailyLimit,
      });
      try {
        await db
          .prepare(
            `INSERT INTO ai_credit_balances
               (id, family_id, child_user_id, parent_id, is_premium, daily_included_limit,
                daily_included_used, daily_reset_date, purchased_credits, updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?)
             ON CONFLICT(family_id, child_user_id) DO NOTHING`,
          )
          .bind(
            crypto.randomUUID(),
            aiCreditSeed.family_id ?? null,
            aiCreditSeed.child_user_id ?? null,
            aiCreditSeed.parent_id ?? null,
            b(aiCreditSeed.is_premium),
            Number(aiCreditSeed.daily_included_limit ?? PREMIUM_AI_DAILY_INCLUDED_CREDITS),
            Number(aiCreditSeed.daily_included_used ?? 0),
            String(aiCreditSeed.daily_reset_date ?? quotaDate),
            Number(aiCreditSeed.purchased_credits ?? 0),
            pgNow(),
          )
          .run();
        aiCreditRow = await db
          .prepare(
            "SELECT id, family_id, child_user_id, parent_id, is_premium, daily_included_limit, daily_included_used, daily_reset_date, purchased_credits FROM ai_credit_balances WHERE family_id=? AND child_user_id=? LIMIT 1",
          )
          .bind(familyId, userId)
          .first<Record<string, any>>();
        if (!aiCreditRow) return c.json({ error: "ai_credit_balance_unavailable" }, 503);
      } catch (e) {
        console.error("[ai-child-chat] AI credit seed failed");
        return c.json({ error: "ai_credit_balance_unavailable" }, 503);
      }
    } else if (
      !!aiCreditRow.is_premium !== subscriptionIsPremium ||
      Number(aiCreditRow.daily_included_limit ?? 0) !== resolveIncludedDailyLimitFn({ isPremium: subscriptionIsPremium, parentDailyLimit }) ||
      aiCreditRow.daily_reset_date !== quotaDate
    ) {
      const patch: any = buildAiCreditBalanceSubscriptionSyncPatchFn(aiCreditRow, {
        today: quotaDate,
        isPremium: subscriptionIsPremium,
        parentDailyLimit,
      });
      try {
        const syncResult = await db
          .prepare(
            "UPDATE ai_credit_balances SET is_premium=?, daily_included_limit=?, daily_included_used=?, daily_reset_date=?, updated_at=? WHERE id=? AND family_id=? AND child_user_id=?",
          )
          .bind(
            b(patch.is_premium),
            Number(patch.daily_included_limit ?? 0),
            Number(patch.daily_included_used ?? 0),
            String(patch.daily_reset_date ?? quotaDate),
            String(patch.updated_at ?? pgNow()),
            String(aiCreditRow.id),
            familyId,
            userId,
          )
          .run();
        if (Number(syncResult.meta?.changes ?? 0) !== 1) {
          throw new Error("ai_credit_subscription_sync_not_applied");
        }
        aiCreditRow = { ...aiCreditRow, ...patch, is_premium: b(patch.is_premium) };
      } catch (e) {
        console.error("[ai-child-chat] subscription AI credit sync failed");
        return c.json({ error: "ai_credit_balance_unavailable" }, 503);
      }
    }
  }

  // ── 사용량/크레딧 상태 ──
  let usedToday = 0;
  let useCredit = false;
  let creditStatus: any = null;

  if (aiCreditRow) {
    const baseCreditStatus = getAiCreditStatusFn(aiCreditRow, quotaDate);
    const dailyCreditLedgerCount = await loadDailyAiCreditLedgerCount(db, familyId, userId, quotaDate);
    creditStatus = applyParentDailyChatLimitFn(
      baseCreditStatus,
      parentDailyLimit,
      Math.max(baseCreditStatus.dailyIncludedUsed, Number(dailyCreditLedgerCount ?? baseCreditStatus.dailyIncludedUsed)),
    );
    usedToday = creditStatus.parentDailyUsed;
    dailyLimit = creditStatus.parentDailyLimit;
    creditBalance = creditStatus.purchasedCredits;
  } else {
    const usageRow = await db
      .prepare("SELECT count FROM ai_chat_usage WHERE family_id=? AND child_user_id=? AND usage_date=? LIMIT 1")
      .bind(familyId, userId, quotaDate)
      .first<{ count: number }>();
    usedToday = Number(usageRow?.count ?? 0);
    creditStatus = {
      canChat: usedToday < dailyLimit,
      dailyIncludedRemaining: Math.max(0, dailyLimit - usedToday),
      purchasedCredits: 0,
    };
  }

  // ── 최근 대화(컨텍스트 윈도) ──
  const recentRes = await db
    .prepare(
      "SELECT role, content FROM ai_chat_messages WHERE family_id=? AND child_user_id=? AND role != 'system' ORDER BY substr(created_at,1,19) DESC LIMIT 6",
    )
    .bind(familyId, userId)
    .all<{ role: string; content: string }>();
  const contextWindow = (recentRes.results ?? [])
    .reverse()
    .map((m) => ({ role: (m.role === "assistant" ? "assistant" : "user") as "assistant" | "user", content: m.content as string }));

  const agentPlan = planChildAgentActionFn(message, {
    referenceDate: contextDate,
    parentSettings: parentSettingsRow || {},
    recentMessages: contextWindow,
  });
  const canBypassAiCreditLimit = shouldBypassAiCreditLimit({ safety: agentPlan.safety });

  if (!creditStatus.canChat && !canBypassAiCreditLimit) {
    return c.json(
      { error: "daily_limit_reached", remaining: 0, dailyLimit, creditBalance: toPublicCreditBalance(creditBalance) },
      429,
    );
  }

  const persona = {
    ...getPersona(characterEmoji),
    ...(parentSettingsRow?.ai_friend_name ? { name: String(parentSettingsRow.ai_friend_name) } : {}),
  };
  const ageInfo = calculateChildAge(birthdate);
  const ageBand = getAgeBand(ageInfo.age);
  const userSafetyHit = detectSafetyFlag(message) || agentPlan.safety.riskLevel !== "none";
  const allowScheduleActions = scheduleActionsAllowed;
  const allowContactActions = contactActionsAllowed;
  const safetyNotificationLevel = String(parentSettingsRow?.safety_notification_level || "medium");
  const memoryEnabled = parentSettingsRow?.memory_enabled !== false;
  const longTermMemoryEnabled = parentSettingsRow?.long_term_memory_enabled !== false;
  let toolResult: any = null;
  let todaySchedule: Array<Record<string, any>> = [];
  let todayScheduleContextLoaded = false;
  let recentSchedule: Array<Record<string, any>> = [];
  let dailyItems: Array<Record<string, any>> = [];
  let memoryContext: Record<string, unknown> = {};
  let parentContactContextRows: Array<Record<string, any>> = [];

  // ── 기억(요약 + 장기 기억) ──
  if (memoryEnabled) {
    const summaries = await db
      .prepare(
        "SELECT summary FROM ai_memory_summaries WHERE family_id=? AND child_user_id=? ORDER BY substr(updated_at,1,19) DESC LIMIT 3",
      )
      .bind(familyId, userId)
      .all<{ summary: string }>();

    let longTermMemories: Array<{ type: string; key: string; value: string }> = [];
    if (longTermMemoryEnabled) {
      const ltm = await db
        .prepare(
          "SELECT type, key, value, confidence FROM ai_long_term_memories WHERE family_id=? AND child_user_id=? AND parent_visible=1 ORDER BY substr(updated_at,1,19) DESC LIMIT 20",
        )
        .bind(familyId, userId)
        .all<{ type: string; key: string; value: string }>();
      longTermMemories = ltm.results ?? [];
    }

    memoryContext = {
      recentSummary: (summaries.results ?? []).map((row) => row.summary).filter(Boolean).join("\n"),
      longTermMemories: longTermMemories.map((row) => `${row.type}:${row.key}=${row.value}`),
    };
  }

  // ── 안전 신호 → 안전 이벤트/부모 알림 ──
  if (agentPlan.safety.riskLevel !== "none") {
    const safetyRecord: any = buildSafetyEventAndAlertFn({
      familyId,
      childUserId: userId,
      childName,
      riskLevel: agentPlan.safety.riskLevel,
      reason: agentPlan.safety.reason,
      sensitivity: safetyNotificationLevel,
    });
    let parentNotified = false;
    if (safetyRecord.parentAlert) {
      try {
        const pa = safetyRecord.parentAlert;
        await db
          .prepare(
            "INSERT INTO parent_alerts (id, family_id, alert_type, title, message, severity, event_id, child_user_id, metadata, read, read_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,0,'{}',?)",
          )
          .bind(
            crypto.randomUUID(),
            pa.family_id,
            pa.alert_type,
            pa.title,
            pa.message,
            pa.severity ?? "info",
            null,
            null, // child_user_id: 원본은 컬럼 미설정(NULL), 자녀 식별은 metadata.child_user_id.
            JSON.stringify(pa.metadata ?? {}),
            pgNow(),
          )
          .run();
        parentNotified = true;
      } catch (e) {
        console.error("[ai-child-chat] parent safety alert insert failed");
      }
    }

    try {
      const se = safetyRecord.safetyEvent;
      await db
        .prepare(
          "INSERT INTO ai_safety_events (id, family_id, child_user_id, severity, event_type, summary, parent_notified, metadata, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          crypto.randomUUID(),
          se.family_id,
          se.child_user_id,
          se.severity,
          se.event_type,
          se.summary ?? "",
          b(parentNotified),
          "{}",
          pgNow(),
        )
        .run();
    } catch (e) {
      console.error("[ai-child-chat] safety event insert failed");
    }

    if (agentPlan.toolName === "notifyParent") {
      toolResult = {
        ok: true,
        toolName: "notifyParent",
        severity: agentPlan.safety.riskLevel,
        reason: agentPlan.safety.reason,
        parentNotified,
      };
    }
  }

  // ── 도구: callParent ──
  if (agentPlan.shouldUseTool && agentPlan.toolName === "callParent") {
    if (!allowContactActions) {
      toolResult = { ok: false, toolName: "callParent", error: "contact_actions_disabled" };
    } else {
      let parentRows: Array<Record<string, any>> = [];
      let lookupFailed = false;
      try {
        const res = await db
          .prepare(
            "SELECT role, name, gender, phone FROM family_members WHERE family_id=? AND role='parent' AND is_active=1",
          )
          .bind(familyId)
          .all<Record<string, any>>();
        parentRows = res.results ?? [];
        parentContactContextRows = parentRows;
      } catch (e) {
        lookupFailed = true;
        console.error("[ai-child-chat] parent contact lookup failed");
      }
      if (lookupFailed) {
        toolResult = { ok: false, toolName: "callParent", error: "parent_contact_lookup_failed" };
      } else {
        const contactResult: any = selectParentContactForRoleFn(parentRows, agentPlan.toolArgs.parentRole);
        toolResult = { ...contactResult, toolName: "callParent", confirmationRequired: true };
      }
    }
  }

  // ── 도구: createMessageToParent ──
  if (agentPlan.toolName === "createMessageToParent") {
    if (!allowContactActions) {
      toolResult = { ok: false, toolName: "createMessageToParent", error: "contact_actions_disabled" };
    } else if (!agentPlan.shouldUseTool) {
      toolResult = {
        ok: false,
        toolName: "createMessageToParent",
        error: "missing_parent_message",
        missingArgs: agentPlan.missingArgs,
      };
    } else {
      const parentRole = String(agentPlan.toolArgs.parentRole || "guardian");
      const draftMessage = sanitizeChildParentMessage(agentPlan.toolArgs.message);
      if (!draftMessage) {
        toolResult = { ok: false, toolName: "createMessageToParent", error: "invalid_parent_message" };
      } else {
        const displayName = parentRole === "mom" ? "엄마" : parentRole === "dad" ? "아빠" : "보호자";
        toolResult = await addConfirmationToken(
          { ok: true, toolName: "createMessageToParent", parentRole, displayName, message: draftMessage, confirmationRequired: true },
          { familyId, childUserId: userId, toolName: "sendMessageToParent", parentRole, message: draftMessage },
          confirmSecret,
        );
      }
    }
  }

  // ── 도구: updateSchedule(후보 탐색 → 확인 토큰) ──
  if (agentPlan.toolName === "updateSchedule") {
    if (!allowScheduleActions) {
      toolResult = { ok: false, toolName: "updateSchedule", error: "schedule_actions_disabled" };
    } else if (!agentPlan.shouldUseTool) {
      toolResult = { ok: false, toolName: "updateSchedule", error: "missing_schedule_update_args", missingArgs: agentPlan.missingArgs };
    } else {
      try {
        const appDateKey = toAppDateKey(String(agentPlan.toolArgs.date || contextDate));
        const requestedTitle = String(agentPlan.toolArgs.title || "").trim();
        const safeChanges = sanitizeScheduleChanges(agentPlan.toolArgs.changes);
        if (Object.keys(safeChanges).length === 0) {
          toolResult = { ok: false, toolName: "updateSchedule", error: "missing_schedule_update_args", missingArgs: ["changes"] };
        } else {
          const scheduleRows = await loadEventsByDateKey(db, familyId, appDateKey);
          const candidate = scheduleRows
            .filter((row) => isSingleChildMutableEvent(row, childMemberId))
            .find((row) => scheduleTitleMatches(row.title, requestedTitle));
          if (!candidate) {
            toolResult = { ok: false, toolName: "updateSchedule", error: "schedule_not_found", date: appDateKey, title: requestedTitle };
          } else if (!isValidScheduleChangeTimeRange(candidate, safeChanges)) {
            toolResult = { ok: false, toolName: "updateSchedule", error: "invalid_schedule_time_range" };
          } else {
            const event = eventRowToToolEvent(candidate);
            toolResult = await addConfirmationToken(
              { ok: true, toolName: "updateSchedule", confirmationRequired: true, event, changes: safeChanges },
              { familyId, childUserId: userId, toolName: "updateSchedule", scheduleId: String(event.id || ""), changes: safeChanges },
              confirmSecret,
            );
          }
        }
      } catch (e) {
        console.error("[ai-child-chat] schedule update candidate lookup exception");
        toolResult = { ok: false, toolName: "updateSchedule", error: "schedule_lookup_failed" };
      }
    }
  }

  // ── 도구: deleteSchedule(후보 탐색 → 확인 토큰) ──
  if (agentPlan.toolName === "deleteSchedule") {
    if (!allowScheduleActions) {
      toolResult = { ok: false, toolName: "deleteSchedule", error: "schedule_actions_disabled" };
    } else if (!agentPlan.shouldUseTool) {
      toolResult = { ok: false, toolName: "deleteSchedule", error: "missing_schedule_delete_args", missingArgs: agentPlan.missingArgs };
    } else {
      try {
        const appDateKey = toAppDateKey(String(agentPlan.toolArgs.date || contextDate));
        const requestedTitle = String(agentPlan.toolArgs.title || "").trim();
        const scheduleRows = await loadEventsByDateKey(db, familyId, appDateKey);
        const candidate = scheduleRows
          .filter((row) => isChildDeletableEvent(row, childMemberId))
          .find((row) => scheduleTitleMatches(row.title, requestedTitle));
        if (!candidate) {
          toolResult = { ok: false, toolName: "deleteSchedule", error: "schedule_not_found", date: appDateKey, title: requestedTitle };
        } else {
          const event = eventRowToToolEvent(candidate);
          toolResult = await addConfirmationToken(
            { ok: true, toolName: "deleteSchedule", confirmationRequired: true, event },
            { familyId, childUserId: userId, toolName: "deleteSchedule", scheduleId: String(event.id || "") },
            confirmSecret,
          );
        }
      } catch (e) {
        console.error("[ai-child-chat] schedule delete candidate lookup exception");
        toolResult = { ok: false, toolName: "deleteSchedule", error: "schedule_lookup_failed" };
      }
    }
  }

  // ── 도구: getTodaySchedule / getScheduleByDate ──
  if (agentPlan.shouldUseTool && (agentPlan.toolName === "getTodaySchedule" || agentPlan.toolName === "getScheduleByDate")) {
    if (!allowScheduleActions) {
      toolResult = { ok: false, error: "schedule_actions_disabled" };
    } else {
      try {
        const appDateKey = toAppDateKey(String(agentPlan.toolArgs.date || contextDate));
        const scheduleRows = await loadEventsByDateKey(db, familyId, appDateKey);
        const visibleRows = scheduleRows.filter((row) => row.is_family_event || isEventLinkedToChild(row, childMemberId));
        const scheduleEvents = visibleRows.map(eventRowToToolEvent);
        if (appDateKey === toAppDateKey(contextDate)) {
          todaySchedule = scheduleEvents;
          todayScheduleContextLoaded = true;
        }
        toolResult = { ok: true, toolName: agentPlan.toolName, date: agentPlan.toolArgs.date, events: scheduleEvents };
      } catch (e) {
        console.error("[ai-child-chat] schedule lookup exception");
        toolResult = { ok: false, error: "schedule_lookup_failed" };
      }
    }
  }

  // ── 도구: createSchedule ──
  if (agentPlan.shouldUseTool && agentPlan.toolName === "createSchedule") {
    if (!allowScheduleActions) {
      toolResult = { ok: false, error: "schedule_actions_disabled" };
    } else {
      try {
        const eventRow: any = buildScheduleEventRowFn({
          familyId,
          childUserId: userId,
          title: agentPlan.toolArgs.title,
          date: agentPlan.toolArgs.date,
          startTime: agentPlan.toolArgs.startTime,
          endTime: agentPlan.toolArgs.endTime,
        });
        let insertOk = false;
        try {
          await db
            .prepare(
              "INSERT INTO events (id, family_id, date_key, title, time, category, emoji, color, bg, memo, location, notif_override, end_time, is_family_event, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            )
            .bind(
              eventRow.id,
              eventRow.family_id,
              eventRow.date_key,
              eventRow.title,
              eventRow.time,
              eventRow.category,
              eventRow.emoji,
              eventRow.color,
              eventRow.bg,
              eventRow.memo ?? "",
              eventRow.location != null ? JSON.stringify(eventRow.location) : null,
              eventRow.notif_override != null ? JSON.stringify(eventRow.notif_override) : null,
              eventRow.end_time || null,
              b(eventRow.is_family_event),
              eventRow.created_by,
              pgNow(),
              pgNow(),
            )
            .run();
          insertOk = true;
        } catch (e) {
          console.error("[ai-child-chat] schedule create failed");
          toolResult = { ok: false, error: "schedule_create_failed" };
        }
        if (insertOk) {
          try {
            await db
              .prepare("INSERT INTO events_children (event_id, child_id) VALUES (?, ?)")
              .bind(eventRow.id, childMemberId)
              .run();
            toolResult = { ok: true, toolName: "createSchedule", event: eventRowToToolEvent(eventRow) };
          } catch (e) {
            console.error("[ai-child-chat] schedule child link failed");
            try {
              await db.prepare("DELETE FROM events WHERE family_id=? AND id=?").bind(familyId, eventRow.id).run();
            } catch (rollbackErr) {
              console.error("[ai-child-chat] schedule child link rollback failed");
            }
            toolResult = { ok: false, error: "schedule_link_failed" };
          }
        }
      } catch (e) {
        console.error("[ai-child-chat] schedule create exception");
        toolResult = { ok: false, error: "schedule_create_failed" };
      }
    }
  }

  // ── 컨텍스트 로드(가족·부모 연락처·일정) ──
  let familyContextRows: Array<Record<string, any>> = [];
  try {
    const res = await db
      .prepare(
        "SELECT role, name, gender, user_id FROM family_members WHERE family_id=? AND is_active=1 AND role IN ('parent','child')",
      )
      .bind(familyId)
      .all<Record<string, any>>();
    familyContextRows = res.results ?? [];
  } catch (e) {
    console.error("[ai-child-chat] family context lookup failed");
  }

  if (parentContactContextRows.length === 0) {
    try {
      const res = await db
        .prepare(
          "SELECT role, name, gender, phone FROM family_members WHERE family_id=? AND role='parent' AND is_active=1",
        )
        .bind(familyId)
        .all<Record<string, any>>();
      parentContactContextRows = res.results ?? [];
    } catch (e) {
      console.error("[ai-child-chat] parent contact lookup failed");
    }
  }

  if (todaySchedule.length === 0 && !todayScheduleContextLoaded) {
    try {
      const appDateKey = toAppDateKey(contextDate);
      const rows = await loadEventsByDateKey(db, familyId, appDateKey);
      todaySchedule = rows.filter((row) => row.is_family_event || isEventLinkedToChild(row, childMemberId)).map(eventRowToToolEvent);
    } catch (e) {
      console.error("[ai-child-chat] today schedule context lookup failed");
    }
  }

  if (recentSchedule.length === 0) {
    try {
      const recentScheduleDateKeys = toAppDateKeysInWindow(contextDate, { daysBefore: 7, daysAfter: 7 });
      if (recentScheduleDateKeys.length > 0) {
        const rows = await loadEventsByDateKeys(db, familyId, recentScheduleDateKeys);
        recentSchedule = rows.filter((row) => row.is_family_event || isEventLinkedToChild(row, childMemberId)).map(eventRowToToolEvent);
      }
    } catch (e) {
      console.error("[ai-child-chat] recent schedule context lookup failed");
    }
  }

  try {
    const appDateKey = toAppDateKey(contextDate);
    const { results } = await db
      .prepare(
        "SELECT date_key, supplies, homework, note FROM daily_supplies WHERE family_id=? AND child_id=? AND date_key=? ORDER BY updated_at DESC LIMIT 1",
      )
      .bind(familyId, childMemberId, appDateKey)
      .all<Record<string, any>>();
    dailyItems = results ?? [];
  } catch (e) {
    console.error("[ai-child-chat] daily supplies context lookup failed");
  }

  const promptAvailableTools =
    agentPlan.shouldUseTool && isAgentToolAllowedForPrompt(agentPlan.toolName, { allowScheduleActions, allowContactActions })
      ? [agentPlan.toolName]
      : [];
  // 운영자(관리자)가 관리자 페이지에서 저장한 전역 지침. 조회 실패는 "지침 없음"으로
  // 강등되며(readGlobalSetting 내부 fail-open) 아이 대화를 막지 않는다.
  const operatorInstructions =
    (await readGlobalSetting(c.env.DB, AI_CHILD_OPERATOR_PROMPT_KEY)).value;
  const systemPrompt = buildChildSystemPromptFn({
    operatorInstructions,
    persona,
    childProfile: {
      name: childName,
      birthday: birthdate,
      familyMembers: familyContextRows.map(formatFamilyMemberForPrompt).filter(Boolean),
    },
    parentSettings: parentSettingsRow || {},
    memory: memoryContext,
    todaySchedule,
    recentSchedule,
    dailyItems,
    availableTools: promptAvailableTools,
    creditStatus,
    parentContacts: parentContactContextRows,
    safetyHit: userSafetyHit,
    referenceDate: contextDate,
    nowHHMM: nowHHMMKST(),
  });

  // ── 응답 생성(의도별 결정적 응답 → 도구 결과 → LLM) ──
  let assistantText = "";
  if (agentPlan.detectedIntent === "parent_forbidden_topic") {
    assistantText = buildParentForbiddenTopicReply({ ageBand, topic: agentPlan.toolArgs.topic });
  } else if (agentPlan.detectedIntent === "parent_allowed_topic_restriction") {
    assistantText = buildParentAllowedTopicReply({ ageBand, allowedTopics: agentPlan.toolArgs.allowedTopics });
  } else {
    const planFallbackAssistantText = buildAgentPlanChildReply(agentPlan);
    if (planFallbackAssistantText) {
      assistantText = planFallbackAssistantText;
    } else if (isScheduleLookupToolResult(toolResult)) {
      const deterministicScheduleReply = buildToolResultChildReply(toolResult);
      if (deterministicScheduleReply) {
        assistantText = deterministicScheduleReply;
      }
    } else {
      let openAiStartedAt: number | null = null;
      try {
        if (!OPENAI_API_KEY) {
          console.error("[ai-child-chat] missing env: OPENAI_API_KEY");
          const fallbackAssistantText = buildToolResultChildReply(toolResult);
          if (fallbackAssistantText) {
            assistantText = fallbackAssistantText;
          } else {
            return c.json({ error: "server_misconfigured" }, 500);
          }
        } else {
          openAiStartedAt = Date.now();
          const openaiRes = await fetch(openaiChatUrl(c.env), {
            method: "POST",
            headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
            signal: AbortSignal.timeout(AI_CHILD_CHAT_TIMEOUT_MS),
            body: JSON.stringify({
              ...openaiLunaChatConfig(220),
              messages: [
                { role: "system", content: systemPrompt },
                ...contextWindow,
                ...(toolResult
                  ? [{ role: "system", content: `도구 실행 결과: ${JSON.stringify(sanitizeAiToolResultForPrompt(toolResult))}` }]
                  : []),
                { role: "user", content: message },
              ],
              temperature: 0.7,
              safety_identifier: await openaiSafetyIdentifier(userId),
            }),
          });
          if (!openaiRes.ok) {
            writeOpenAiLog("error", {
              operation: "child_chat",
              outcome: "http_error",
              status: openaiRes.status,
              latencyMs: Date.now() - openAiStartedAt,
              errorKind: "provider_rejected",
            });
            const fallbackAssistantText = buildToolResultChildReply(toolResult);
            if (fallbackAssistantText) {
              assistantText = fallbackAssistantText;
            } else {
              return c.json({ error: "ai_failure" }, 502);
            }
          } else {
            const data = await openaiRes.json<OpenAiChatResponse>();
            assistantText = (data.choices?.[0]?.message?.content || "").toString().trim();
            writeOpenAiLog(assistantText ? "info" : "error", {
              operation: "child_chat",
              outcome: assistantText ? "success" : "empty_response",
              status: openaiRes.status,
              latencyMs: Date.now() - openAiStartedAt,
              finishReason: data.choices?.[0]?.finish_reason,
              usage: data.usage,
              ...(assistantText ? {} : { errorKind: "empty_response" as const }),
            });
          }
        }
      } catch (error) {
        const errorKind = classifyOpenAiError(error);
        writeOpenAiLog("error", {
          operation: "child_chat",
          outcome: errorKind === "invalid_response" ? "invalid_response" : "network_error",
          latencyMs: openAiStartedAt === null ? undefined : Date.now() - openAiStartedAt,
          errorKind,
        });
        const fallbackAssistantText = buildToolResultChildReply(toolResult);
        if (fallbackAssistantText) {
          assistantText = fallbackAssistantText;
        } else {
          return c.json({ error: "ai_failure" }, 502);
        }
      }
    }
  }

  // 200+빈응답(content_filter/길이초과)은 실질 실패 → 크레딧 미차감 플래그(ai-chat-1).
  let assistantTextWasEmpty = false;
  if (!assistantText) {
    assistantText = "음… 잠깐 생각이 안 났어. 다시 한 번 말해줄래?";
    assistantTextWasEmpty = true;
  }
  assistantText = adaptResponseForAge(assistantText, ageBand);
  assistantText = applyParentReplyGuardrails(assistantText, { parentSettings: parentSettingsRow || {} });
  assistantText = ensureChildSafetyReply(assistantText, {
    riskLevel: agentPlan.safety.riskLevel,
    parentNotified: toolResult?.parentNotified === true,
  });

  const assistantSafetyHit = detectSafetyFlag(assistantText);
  const flagged = userSafetyHit || assistantSafetyHit;
  const parentSettingRedirectIntents = ["parent_forbidden_topic", "parent_allowed_topic_restriction", "external_contact_rejected", "parent_tool_disabled"];
  const shouldPersistAiMemory =
    !parentSettingRedirectIntents.includes(agentPlan.detectedIntent) && !["medium", "high"].includes(agentPlan.safety.riskLevel);

  // OpenAI/도구 외부 대기 뒤 삭제·연결 해제가 교차했는지 저장 직전에 다시 확인한다.
  const postWaitScope = await aiMutationScopeState(db, {
    actorUserId: userId,
    familyId,
    childUserId: userId,
    actorRole: "child",
  });
  if (postWaitScope !== "active") {
    const error = aiMutationScopeErrorResponse(postWaitScope);
    return c.json(error.body, error.status);
  }

  // ── 대화 로그 ──
  const logged = await insertChatMessages(db, familyId, userId, characterEmoji, [
    { role: "user", content: message, flagged: userSafetyHit },
    { role: "assistant", content: assistantText, flagged: assistantSafetyHit },
  ]);
  if (!logged) {
    return c.json({ error: "account_state_changed" }, 409);
  }

  // 표시 가능한 답변마다 안정적인 assistantMessageId를 멱등키로 사용해 잔액과 원장을
  // D1 batch 한 트랜잭션에서 함께 확정한다. 동시 요청이 상한을 먼저 소진했다면 방금
  // 저장한 두 메시지를 제거하고 유료 결과를 반환하지 않는다.
  const shouldChargeCredit =
    shouldChargeForAiTurn({ detectedIntent: agentPlan.detectedIntent, toolResult, safety: agentPlan.safety }) && !assistantTextWasEmpty;
  if (shouldChargeCredit) {
    if (!aiCreditRow || !logged.assistantMessageId) {
      await deleteUnchargedChatMessages(db, familyId, userId, logged);
      return c.json({ error: "ai_credit_consumption_unavailable" }, 503);
    }
    try {
      const consumed = await consumeAiCreditAtomic(db, {
        familyId,
        childUserId: userId,
        parentDailyLimit: dailyLimit,
        usageDate: quotaDate,
        reason: "chat_response",
        transactionId: `chat-${logged.assistantMessageId}`,
        messageId: logged.assistantMessageId,
      });
      if (consumed.status === "exhausted") {
        await deleteUnchargedChatMessages(db, familyId, userId, logged);
        return c.json(
          { error: "daily_limit_reached", remaining: 0, dailyLimit, creditBalance: toPublicCreditBalance(consumed.purchasedCredits) },
          429,
        );
      }
      useCredit = consumed.source === "purchased_credit";
      creditStatus = consumed;
      usedToday = consumed.parentDailyUsed;
      creditBalance = consumed.purchasedCredits;
      try {
        await notifyPg(c.env, familyId, "ai_credit_balances", "UPDATE", {
          family_id: familyId,
          child_user_id: userId,
        });
      } catch (error) {
        console.error("[ai-child-chat] credit realtime notify failed");
      }
    } catch (error) {
      await deleteUnchargedChatMessages(db, familyId, userId, logged);
      if (error instanceof AiCreditConsumptionUnavailableError) {
        return c.json({ error: error.code }, error.status);
      }
      throw error;
    }
  }

  // ── 대화 요약 기억 ──
  if (memoryEnabled && shouldPersistAiMemory) {
    const summaryMessages = [
      ...contextWindow,
      { role: "user" as const, content: message },
      { role: "assistant" as const, content: assistantText },
    ];
    if (shouldStoreConversationSummary(summaryMessages)) {
      const summaryRow: any = buildConversationSummaryRowFn({ familyId, childUserId: userId, messages: summaryMessages });
      if (summaryRow) {
        try {
          const now = pgNow();
          await db
            .prepare(
              "INSERT INTO ai_memory_summaries (id, family_id, child_user_id, conversation_id, summary, important_facts, emotional_signals, interests, unresolved_issues, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            )
            .bind(
              crypto.randomUUID(),
              summaryRow.family_id,
              summaryRow.child_user_id,
              summaryRow.conversation_id ?? null,
              summaryRow.summary ?? "",
              JSON.stringify(summaryRow.important_facts ?? []),
              JSON.stringify(summaryRow.emotional_signals ?? []),
              JSON.stringify(summaryRow.interests ?? []),
              JSON.stringify(summaryRow.unresolved_issues ?? []),
              now,
              now,
            )
            .run();
        } catch (e) {
          console.error("[ai-child-chat] memory summary insert failed");
        }
      }
    }
  }

  // ── 장기 기억(select-then-write, 복합 unique 미이관) ──
  if (memoryEnabled && longTermMemoryEnabled && shouldPersistAiMemory) {
    const memoryPatch: any = createLongTermMemoryPatchFn(message, { parentSettings: parentSettingsRow || {} });
    if (memoryPatch.shouldStore) {
      try {
        const m = memoryPatch.memory;
        const now = pgNow();
        const existing = await db
          .prepare("SELECT id FROM ai_long_term_memories WHERE family_id=? AND child_user_id=? AND type=? AND key=? LIMIT 1")
          .bind(familyId, userId, m.type, m.key)
          .first<{ id: string }>();
        if (existing?.id) {
          await db
            .prepare("UPDATE ai_long_term_memories SET value=?, confidence=?, parent_visible=?, source=?, updated_at=? WHERE id=?")
            .bind(m.value, Number(m.confidence ?? 0.7), b(m.parent_visible), "conversation", now, existing.id)
            .run();
        } else {
          await db
            .prepare(
              "INSERT INTO ai_long_term_memories (id, family_id, child_user_id, type, key, value, confidence, source, parent_visible, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            )
            .bind(
              crypto.randomUUID(),
              familyId,
              userId,
              m.type,
              m.key,
              m.value,
              Number(m.confidence ?? 0.7),
              "conversation",
              b(m.parent_visible),
              now,
              now,
            )
            .run();
        }
      } catch (e) {
        console.error("[ai-child-chat] long-term memory upsert failed");
      }
    }
  }

  // ── 응답 구성(원본 키 보존) ──
  const newUsed = aiCreditRow ? creditStatus.parentDailyUsed : shouldChargeCredit ? usedToday + 1 : usedToday;
  const remaining = aiCreditRow
    ? Math.min(
        Number(creditStatus.parentDailyRemaining ?? 0),
        Number(creditStatus.dailyIncludedRemaining ?? 0) + Number(creditStatus.purchasedCredits ?? 0),
      )
    : Math.max(0, dailyLimit - newUsed);
  const newCredit = aiCreditRow ? creditStatus.purchasedCredits : creditBalance;

  return c.json(
    {
      reply: assistantText,
      remaining,
      dailyLimit,
      creditBalance: toPublicCreditBalance(newCredit),
      creditCharged: shouldChargeCredit,
      usedCredit: shouldChargeCredit && useCredit,
      character: characterEmoji,
      characterName: persona.name,
      age: ageInfo.age,
      ageInMonths: ageInfo.ageInMonths,
      ageBand: ageBand.id,
      detectedIntent: agentPlan.detectedIntent,
      plannedTool: agentPlan.shouldUseTool
        ? { name: agentPlan.toolName, args: agentPlan.toolArgs, confirmationRequired: agentPlan.confirmationRequired }
        : null,
      toolResult,
      safety: agentPlan.safety,
      flagged,
      assistantMessageId: logged.assistantMessageId,
    },
    200,
  );
  } finally {
    try {
      await releaseAiCreditExecutionLease(db, executionLease);
    } catch (error) {
      console.error("[ai-child-chat] execution lease release failed");
    }
  }
});

interface InsertedChatMessageIds {
  userMessageId: string | null;
  assistantMessageId: string | null;
}

async function deleteUnchargedChatMessages(
  db: D1Database,
  familyId: string,
  childUserId: string,
  ids: InsertedChatMessageIds,
): Promise<void> {
  const messageIds = [ids.userMessageId, ids.assistantMessageId].filter((id): id is string => Boolean(id));
  if (messageIds.length === 0) return;
  try {
    const placeholders = messageIds.map(() => "?").join(",");
    await db
      .prepare(
        `DELETE FROM ai_chat_messages
          WHERE family_id=? AND child_user_id=? AND id IN (${placeholders})`,
      )
      .bind(familyId, childUserId, ...messageIds)
      .run();
  } catch (error) {
    console.error("[ai-child-chat] uncharged message cleanup failed");
  }
}

// 표시할 AI 답변은 먼저 저장해 안정적인 신고 ID를 만든다. 저장이 실패한 답변을
// 아이 화면에 노출하면 앱 내 신고가 불가능해지므로 실패를 삼키지 않는다.
export async function insertChatMessages(
  db: D1Database,
  familyId: string,
  childUserId: string,
  animalCharacter: string,
  rows: Array<{ role: string; content: string; flagged: boolean }>,
): Promise<InsertedChatMessageIds | null> {
  const createdAt = pgNow();
  const records = rows.map((row) => ({ id: crypto.randomUUID(), row }));
  const results = await db.batch(
    records.map(({ id, row }) =>
      db
        .prepare(
          `INSERT INTO ai_chat_messages
             (id,family_id,child_user_id,role,content,animal_character,flagged,created_at)
           SELECT ?,?,?,?,?,?,?,?
            WHERE EXISTS(SELECT 1 FROM users WHERE id=?)
              AND EXISTS(
                SELECT 1 FROM family_members
                 WHERE family_id=? AND user_id=? AND role='child' AND is_active=1
              )
              AND NOT EXISTS(
                SELECT 1 FROM account_deletion_scopes
                 WHERE (scope_type='family' AND scope_id=?)
                    OR (scope_type='user' AND scope_id=?)
              )`,
        )
        .bind(
          id,
          familyId,
          childUserId,
          row.role,
          row.content,
          animalCharacter,
          b(row.flagged),
          createdAt,
          childUserId,
          familyId,
          childUserId,
          familyId,
          childUserId,
        ),
    ),
  );
  if (results.some((result) => Number(result.meta?.changes ?? 0) !== 1)) return null;
  return {
    userMessageId: records.find(({ row }) => row.role === "user")?.id ?? null,
    assistantMessageId: records.find(({ row }) => row.role === "assistant")?.id ?? null,
  };
}

export default chat;

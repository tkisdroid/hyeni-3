// AI 함수군 Edge Functions → Worker (/api/ai/*).
// 인증: requireAuth(JWT) 가 사용자 식별. 원본의 service_role 직접호출 경로는 제거
// (클라는 사용자 토큰으로만 호출). OpenAI 키 = Workers Secret.
import { Hono } from "hono";
import type { Env, Vars } from "../types";
import { requireAuth } from "../middleware/auth";
import { assertFamilyAccess, getMyFamilyIds, isFamilyPremium } from "../db/authz";
import { parseJson } from "../lib/serialize";
import { pgNow } from "../lib/time";
import {
  openaiChatUrl,
  openaiLunaChatConfig,
  openaiSafetyIdentifier,
  parseOpenAiJsonObjectContent,
} from "../lib/openai";
import { classifyOpenAiError, writeOpenAiLog } from "../lib/openaiLog";
import { resolveFamilyEntitlement } from "../shared/subscriptionEntitlement.js";
import {
  DAY_SUMMARY_PROMPT_VERSION,
  extractDaySummarySignals,
  hasMeaningfulDaySignals,
  buildDaySummaryPrompt,
} from "../shared/aiDaySummaryPolicy.js";
import { aiMutationScopeErrorResponse, aiMutationScopeState } from "../lib/aiMutationScope";
import { authorizeAcademyScheduleRequest } from "../lib/academyScheduleAccess";
import { authorizePremiumAiParent } from "../lib/aiPremiumParentAccess";
import {
  readBoundedAiJson,
  validateChildMonitorInput,
  validateVoiceParseInput,
} from "../lib/aiRequestLimits";

const ai = new Hono<{ Bindings: Env; Variables: Vars }>();
const AI_OPENAI_TIMEOUT_MS = 30_000;

type OpenAiChatResponse = {
  choices?: Array<{ message?: { content?: string }; finish_reason?: unknown }>;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown };
};

const DOW_KR = ["일", "월", "화", "수", "목", "금", "토"];

// AI 일정 파싱(voice-parse) 무료 티어 하루 허용 횟수. 앱 전역 무료 AI 기준(하루 5회,
// aiCredits PREMIUM_AI_DAILY_INCLUDED_CREDITS / ai_credit_balances.daily_included_limit)과 정합.
const FREE_VOICE_PARSE_DAILY_LIMIT = 5;

// KST 기준 오늘 날짜 키(YYYY-MM-DD) — ai_chat_usage.usage_date 규약(aiCredits todayKey 와 동일).
function kstUsageDate(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

// AI 파싱 원가 게이트(voice-parse·child-monitor 공유).
// 소속 가족 중 하나라도 프리미엄이면 무제한 바이패스. 무료는 하루 FREE_VOICE_PARSE_DAILY_LIMIT 회.
// 반환 { over, refund }: over 非null → 그대로 return(429 초과). over null → 통과(1회 예약됨),
//   OpenAI 5xx/네트워크 실패 시 refund() 로 예약 환불(서버 귀책으로 무료 쿼터 소진 방지).
// 카운터 키의 child_user_id 자리는 'ai-parse:'+uid 접두 → 자녀 채팅 사용량(실 자녀 uid)과 분리 충돌 방지.
// 원자적 조건부 증가(count < LIMIT)로 동시요청 초과를 스키마 레벨에서 차단(비원자 read-then-write 아님).
async function reserveAiParseQuota(
  db: D1Database,
  familyIds: string[],
  userId: string,
): Promise<{ over: Response | null; refund: () => Promise<void> }> {
  const noop = async () => {};
  for (const fid of familyIds) {
    if (await isFamilyPremium(db, fid, /* failOpen */ false)) return { over: null, refund: noop };
  }
  const familyId = familyIds[0];
  const usageDate = kstUsageDate();
  const counterKey = `ai-parse:${userId}`;
  await db
    .prepare(
      `INSERT INTO ai_chat_usage (family_id, child_user_id, usage_date, count, updated_at)
       VALUES (?,?,?,0,?)
       ON CONFLICT(family_id,child_user_id,usage_date) DO NOTHING`,
    )
    .bind(familyId, counterKey, usageDate, pgNow())
    .run();
  const upd = await db
    .prepare(
      `UPDATE ai_chat_usage SET count = count + 1, updated_at = ?
        WHERE family_id=? AND child_user_id=? AND usage_date=? AND count < ?`,
    )
    .bind(pgNow(), familyId, counterKey, usageDate, FREE_VOICE_PARSE_DAILY_LIMIT)
    .run();
  if (Number(upd?.meta?.changes ?? 0) === 0) {
    return {
      over: new Response(
        JSON.stringify({ error: "daily_limit_reached", remaining: 0, dailyLimit: FREE_VOICE_PARSE_DAILY_LIMIT }),
        { status: 429, headers: { "content-type": "application/json" } },
      ),
      refund: noop,
    };
  }
  return {
    over: null,
    refund: async () => {
      await db
        .prepare(
          `UPDATE ai_chat_usage SET count = MAX(count - 1, 0), updated_at = ?
            WHERE family_id=? AND child_user_id=? AND usage_date=?`,
        )
        .bind(pgNow(), familyId, counterKey, usageDate)
        .run();
    },
  };
}

// ── day-summary 헬퍼 (원본 ai-day-summary/index.ts 직역) ──
function isValidUuidLike(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
function isValidDateKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
function addDaysToDateKey(dateKey: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ""));
  if (!m) return dateKey;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return d.toISOString().slice(0, 10);
}
// KST 자정 경계. SQLite datetime() 이 '+09:00'(시:분 포함 타임존)을 파싱해 UTC 로 변환하므로
// substr(created_at,1,19)(UTC) 와 datetime(?) 비교가 정합한다.
function kstDateBoundary(dateKey: string): string {
  return `${dateKey}T00:00:00+09:00`;
}

// ai_day_summaries upsert — D1 복합 unique(family_id,child_user_id,date_key) 미이관이라
// ON CONFLICT 대신 select-then-write. id 는 TEXT(no default)라 신규시 uuid 생성.
export async function upsertDaySummary(
  db: D1Database,
  actorUserId: string,
  familyId: string,
  childUserId: string,
  dateKey: string,
  summary: string,
  signals: unknown,
): Promise<boolean> {
  const state = await aiMutationScopeState(db, {
    actorUserId,
    familyId,
    childUserId,
    actorRole: "parent",
  });
  if (state !== "active") return false;
  const sigText = JSON.stringify(signals);
  const now = pgNow();
  const existing = await db
    .prepare("SELECT id FROM ai_day_summaries WHERE family_id=? AND child_user_id=? AND date_key=? LIMIT 1")
    .bind(familyId, childUserId, dateKey)
    .first<{ id: string }>();
  if (existing?.id) {
    const result = await db
      .prepare(
        `UPDATE ai_day_summaries SET summary=?,signals=?,updated_at=?
          WHERE id=?
            AND EXISTS(SELECT 1 FROM users WHERE id=?)
            AND EXISTS(SELECT 1 FROM users WHERE id=?)
            AND EXISTS(
              SELECT 1 FROM family_members
               WHERE family_id=? AND user_id=? AND role='parent' AND is_active=1
            )
            AND EXISTS(
              SELECT 1 FROM family_members
               WHERE family_id=? AND user_id=? AND role='child' AND is_active=1
            )
            AND NOT EXISTS(
              SELECT 1 FROM account_deletion_scopes
               WHERE (scope_type='family' AND scope_id=?)
                  OR (scope_type='user' AND scope_id IN (?,?))
            )`,
      )
      .bind(
        summary,
        sigText,
        now,
        existing.id,
        actorUserId,
        childUserId,
        familyId,
        actorUserId,
        familyId,
        childUserId,
        familyId,
        actorUserId,
        childUserId,
      )
      .run();
    return Number(result.meta?.changes ?? 0) === 1;
  } else {
    const result = await db
      .prepare(
        `INSERT INTO ai_day_summaries
           (id,family_id,child_user_id,date_key,summary,signals,created_at,updated_at)
         SELECT ?,?,?,?,?,?,?,?
          WHERE EXISTS(SELECT 1 FROM users WHERE id=?)
            AND EXISTS(SELECT 1 FROM users WHERE id=?)
            AND EXISTS(
              SELECT 1 FROM family_members
               WHERE family_id=? AND user_id=? AND role='parent' AND is_active=1
            )
            AND EXISTS(
              SELECT 1 FROM family_members
               WHERE family_id=? AND user_id=? AND role='child' AND is_active=1
            )
            AND NOT EXISTS(
              SELECT 1 FROM account_deletion_scopes
               WHERE (scope_type='family' AND scope_id=?)
                  OR (scope_type='user' AND scope_id IN (?,?))
            )`,
      )
      .bind(
        crypto.randomUUID(),
        familyId,
        childUserId,
        dateKey,
        summary,
        sigText,
        now,
        now,
        actorUserId,
        childUserId,
        familyId,
        actorUserId,
        familyId,
        childUserId,
        familyId,
        actorUserId,
        childUserId,
      )
      .run();
    return Number(result.meta?.changes ?? 0) === 1;
  }
}

// ── POST /api/ai/voice-parse  ← ai-voice-parse (음성/이미지/텍스트 → 일정 추출) ──
// 원본 supabase/functions/ai-voice-parse/index.ts 직역. D1 접근 없음(OpenAI 프록시).
ai.post("/voice-parse", requireAuth, async (c) => {
  const OPENAI_API_KEY = c.env.OPENAI_API_KEY || "";

  let body: {
    text?: string;
    image?: string;
    mode?: string;
    feature?: unknown;
    academies?: Array<{ name: string; category: string }>;
    todayEvents?: Array<{ id: string; title: string; time: string; memo?: string }>;
    currentDate?: { year?: number; month?: number; day?: number };
  };
  const parsedBody = await readBoundedAiJson(c.req.raw);
  if (!parsedBody.ok) {
    return parsedBody.error === "payload_too_large"
      ? c.json({ error: "ai_payload_too_large" }, 413)
      : c.json({ error: "invalid_json" }, 400);
  }
  const inputValidation = validateVoiceParseInput(parsedBody.value);
  if (!inputValidation.ok) return c.json({ error: inputValidation.error }, 400);
  body = parsedBody.value as typeof body;
  const { text, image, mode, feature, academies, todayEvents, currentDate } = body;
  const isPaste = mode === "paste";

  if (!text && !image) {
    return c.json({ error: "text or image is required" }, 400);
  }
  if (feature !== undefined && feature !== "academy_schedule") {
    return c.json({ error: "invalid_feature" }, 400);
  }
  // 구버전·직접 호출이 feature만 빼고 학원 목록을 실어도 학원 시간표 전용
  // Premium 경계를 우회하지 못하게 한다. 학원 목록이 없는 일반 일정 파싱은 유지한다.
  const academyPayloadRequested = feature === undefined
    && Array.isArray(academies)
    && academies.length > 0;

  // ── AI 파싱 원가 게이트(서버 강제): 가족 소속 + 무료 하루 한도(초과 429). ──
  // 원본은 인증만 있고 family·크레딧·rate limit 이 없어 무제한 OpenAI 호출(원가 누수)이 가능했다.
  const caller = c.get("user");
  const callerUserId = caller.sub;
  let familyIds: string[];
  if (feature === "academy_schedule" || academyPayloadRequested) {
    const access = await authorizeAcademyScheduleRequest(c.env.DB, caller);
    if (!access.ok) return c.json({ error: access.error }, access.status);
    familyIds = [access.familyId];
  } else {
    familyIds = await getMyFamilyIds(c.env.DB, callerUserId);
    if (familyIds.length === 0) {
      return c.json({ error: "forbidden" }, 403);
    }
  }
  if (!OPENAI_API_KEY) {
    return c.json({ error: "ai_unavailable" }, 503);
  }
  // academy_schedule은 위에서 Premium을 확정했으므로 무료 카운터를 만들지 않는다.
  const quota = feature === "academy_schedule" || academyPayloadRequested
    ? { over: null, refund: async () => {} }
    : await reserveAiParseQuota(c.env.DB, familyIds, callerUserId);
  if (quota.over) return quota.over;

  const academyList = (academies || [])
    .map((a) => `- ${a.name} (${a.category})`)
    .join("\n");
  const eventList = (todayEvents || [])
    .map((e) => `- id:${e.id} "${e.title}" ${e.time}${e.memo ? ` 메모:"${e.memo}"` : ""}`)
    .join("\n");

  const { year, month, day } = currentDate || {};
  const monthDisplay = month !== undefined ? month + 1 : "?";
  const todayDate =
    year && month !== undefined && day ? new Date(year, month, day) : new Date();
  const todayDow = DOW_KR[todayDate.getDay()];

  const dowDateMap = DOW_KR.map((name, i) => {
    const diff = (i - todayDate.getDay() + 7) % 7 || 7;
    const d = new Date(todayDate.getTime() + diff * 86400000);
    return `${name}요일 = ${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (month:${d.getMonth()}, day:${d.getDate()})`;
  }).join("\n   ");
  const tomorrowDate = new Date(todayDate.getTime() + 86400000);
  const dayAfterDate = new Date(todayDate.getTime() + 2 * 86400000);

  const voiceSystemPrompt = `당신은 어린이 일정관리 앱의 AI 비서입니다. 사용자의 음성 입력을 분석하여 정확한 JSON으로 변환합니다.

현재 날짜: ${year}년 ${monthDisplay}월 ${day}일 (${todayDow}요일)
등록된 학원 목록:
${academyList || "(없음)"}

오늘 일정:
${eventList || "(없음)"}

카테고리 종류: school(학원/교육), sports(운동), hobby(취미), family(가족), friend(친구), other(기타)

## 규칙

1. **일정 추가** 의도 감지:
   - "내일 3시 피아노", "수요일에 태권도 가야해" 등
   - 등록된 학원명이 언급되면 반드시 해당 학원 정보를 사용
   - 날짜가 없으면 오늘, 시간이 없으면 null
   - **중요**: title에는 순수한 일정 이름만 넣어라. "입력해줘", "추가해줘", "등록해줘", "저장해줘", "해줘", "해", "좀", "가요", "갈게", "가야해" 같은 명령어/조사/어미는 반드시 제거하라.
     예시: "내일 3시에 수학학원 입력해줘" → title: "수학학원" (O) / "수학학원 입력해줘" (X)

2. **메모 추가** 의도 감지:
   - "준비물 챙기라고 저장해줘", "피아노 메모에 악보 가져가기"
   - 오늘 일정 중 가장 관련 있는 일정에 메모를 추가
   - 대상 일정을 찾지 못하면 targetEventId를 null로

3. 날짜 파싱 — 아래 날짜표를 반드시 참조하라 (직접 계산하지 말 것):
   - "내일" → ${tomorrowDate.getFullYear()}년 ${tomorrowDate.getMonth() + 1}월 ${tomorrowDate.getDate()}일 (month:${tomorrowDate.getMonth()}, day:${tomorrowDate.getDate()})
   - "모레" → ${dayAfterDate.getFullYear()}년 ${dayAfterDate.getMonth() + 1}월 ${dayAfterDate.getDate()}일 (month:${dayAfterDate.getMonth()}, day:${dayAfterDate.getDate()})
   - 요일명 → 아래 표에서 찾아 그대로 사용:
   ${dowDateMap}
   - month는 0-based (1월=0, 12월=11)
   - **절대 직접 계산하지 말고, 위 표의 값을 그대로 사용하라**

## 응답 형식 (JSON만, 다른 텍스트 없이)

일정 추가:
{"action":"add_event","title":"피아노학원","time":"15:00","category":"school","year":${year},"month":${month},"day":${(day || 0) + 1},"academyName":"피아노학원"}

메모 추가:
{"action":"add_memo","targetEventId":"이벤트id","memoText":"준비물 챙기기"}

길찾기/내비게이션 (다음일정까지 길 알려줘, 길찾기, 어떻게 가 등):
{"action":"navigate"}

인식 불가:
{"action":"unknown","message":"이해하지 못했어요"}`;

  const pasteSystemPrompt = `당신은 어린이 일정관리 앱의 AI 비서입니다. 부모가 카카오톡 공지, 알림장, 학원 안내문 등을 붙여넣으면 일정 정보를 추출합니다.

현재 날짜: ${year}년 ${monthDisplay}월 ${day}일 (${todayDow}요일)
등록된 학원 목록:
${academyList || "(없음)"}

카테고리 종류: school(학원/교육), sports(운동), hobby(취미), family(가족), friend(친구), other(기타)

## 규칙

1. 텍스트나 이미지에서 **모든 일정 정보**를 추출하라.
2. 각 일정에서 추출: title(일정 이름), time(HH:MM), date(year/month/day), category, memo(준비물/장소/참고사항)
3. 날짜가 명시되지 않으면 현재 날짜 기준으로 추정하라.
4. 시간이 명시되지 않으면 time을 null로 설정.
5. 등록된 학원명이 텍스트에 포함되어 있으면 academyName 필드에 해당 학원명을 넣어라.
6. month는 0-based (1월=0, 12월=11)
7. 준비물이나 추가 정보가 있으면 memo에 넣어라.
8. 요일명 → 아래 날짜표를 반드시 참조 (직접 계산 금지):
   "내일" → month:${tomorrowDate.getMonth()}, day:${tomorrowDate.getDate()}
   "모레" → month:${dayAfterDate.getMonth()}, day:${dayAfterDate.getDate()}
   ${dowDateMap}
   **절대 직접 계산하지 말고 위 표의 값을 그대로 사용하라.**

## 응답 형식 (JSON만)

반드시 다음 형식으로 응답:
{"action":"add_events","events":[{"title":"수학학원","time":"15:00","category":"school","year":${year},"month":${month},"day":${day},"academyName":"수학학원","memo":"교재 지참"},{"title":"과학실험","time":"10:00","category":"school","year":${year},"month":${month},"day":${(day || 0) + 1},"memo":"실험복 준비"}]}

일정을 찾지 못한 경우:
{"action":"unknown","message":"일정 정보를 찾지 못했어요"}`;

  const systemPrompt = isPaste ? pasteSystemPrompt : voiceSystemPrompt;

  const userContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];
  if (text) userContent.push({ type: "text", text });
  if (image) userContent.push({ type: "image_url", image_url: { url: image } });

  const openAiStartedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(openaiChatUrl(c.env), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(AI_OPENAI_TIMEOUT_MS),
      body: JSON.stringify({
        ...openaiLunaChatConfig(isPaste ? 1000 : 300),
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: userContent.length === 1 && userContent[0].type === "text" ? text : userContent,
          },
        ],
        temperature: 0.1,
        response_format: { type: "json_object" },
        safety_identifier: await openaiSafetyIdentifier(callerUserId),
      }),
    });
  } catch (error) {
    writeOpenAiLog("error", {
      operation: "voice_parse",
      outcome: "network_error",
      latencyMs: Date.now() - openAiStartedAt,
      errorKind: classifyOpenAiError(error),
    });
    await quota.refund(); // 서버측 실패 — 무료 쿼터 예약분 환불.
    return c.json({ error: "AI service error" }, 502);
  }

  if (!response.ok) {
    writeOpenAiLog("error", {
      operation: "voice_parse",
      outcome: "http_error",
      status: response.status,
      latencyMs: Date.now() - openAiStartedAt,
      errorKind: "provider_rejected",
    });
    await quota.refund(); // OpenAI 5xx — 무료 쿼터 예약분 환불.
    return c.json({ error: "AI service error" }, 502);
  }

  let data: OpenAiChatResponse;
  try {
    data = await response.json<OpenAiChatResponse>();
  } catch (error) {
    writeOpenAiLog("error", {
      operation: "voice_parse",
      outcome: "invalid_response",
      status: response.status,
      latencyMs: Date.now() - openAiStartedAt,
      errorKind: classifyOpenAiError(error),
    });
    await quota.refund();
    return c.json({ error: "AI service error" }, 502);
  }
  const parsedContent = parseOpenAiJsonObjectContent(data?.choices?.[0]?.message?.content);
  if (!parsedContent.ok) {
    writeOpenAiLog("error", {
      operation: "voice_parse",
      outcome: parsedContent.error,
      status: response.status,
      latencyMs: Date.now() - openAiStartedAt,
      finishReason: data?.choices?.[0]?.finish_reason,
      usage: data?.usage,
      errorKind: parsedContent.error,
    });
    await quota.refund();
    return c.json({ error: "AI service error" }, 502);
  }
  writeOpenAiLog("info", {
    operation: "voice_parse",
    outcome: "success",
    status: response.status,
    latencyMs: Date.now() - openAiStartedAt,
    finishReason: data?.choices?.[0]?.finish_reason,
    usage: data?.usage,
  });
  return c.json(parsedContent.value);
});

// ── POST /api/ai/day-summary  ← ai-day-summary (과거 "하루 이야기" 요약, 프리미엄 전용) ──
// 원본 직역. service_role 경로 제거(클라 호출만). 민감 신호(parent_alerts/ai_chat_messages)는
// authz(parent) 통과 후 D1 직접 조회 — 가족 RLS 내 부모 접근이라 권한 노출 아님.
ai.post("/day-summary", requireAuth, async (c) => {
  const db = c.env.DB;
  const callerUserId = c.get("user").sub;

  let body: {
    familyId?: string;
    childUserId?: string;
    dateKey?: string;
    clientSignals?: Record<string, unknown>;
  } = {};
  const parsedBody = await readBoundedAiJson(c.req.raw);
  if (!parsedBody.ok) {
    return parsedBody.error === "payload_too_large"
      ? c.json({ error: "ai_payload_too_large" }, 413)
      : c.json({ error: "invalid_json" }, 400);
  }
  body = parsedBody.value && typeof parsedBody.value === "object" && !Array.isArray(parsedBody.value)
    ? parsedBody.value as typeof body
    : {};
  const familyId = String(body.familyId || "");
  const childUserId = String(body.childUserId || "");
  const dateKey = body.dateKey;
  if (!isValidUuidLike(familyId) || !isValidUuidLike(childUserId)) {
    return c.json({ error: "invalid_request" }, 400);
  }
  if (!isValidDateKey(dateKey)) {
    return c.json({ error: "invalid_date_key" }, 400);
  }

  const access = await authorizePremiumAiParent(db, { callerUserId, familyId }, resolveFamilyEntitlement);
  if (!access.ok) {
    return access.status === 503
      ? c.json({ error: access.error }, 503)
      : c.json({ error: access.error }, 403);
  }

  // 자녀 멤버 확인.
  const childMember = await db
    .prepare(
      "SELECT id, name FROM family_members WHERE family_id=? AND user_id=? AND role='child' AND is_active=1 LIMIT 1",
    )
    .bind(familyId, childUserId)
    .first<{ id: string; name: string }>();
  if (!childMember) return c.json({ error: "child_not_found" }, 404);

  // 캐시 조회(promptVersion stale 시 재생성).
  const cachedRow = await db
    .prepare("SELECT summary, signals FROM ai_day_summaries WHERE family_id=? AND child_user_id=? AND date_key=? LIMIT 1")
    .bind(familyId, childUserId, dateKey)
    .first<{ summary: string; signals: string }>();
  if (cachedRow) {
    const cachedSignals = (parseJson(cachedRow.signals) || {}) as Record<string, unknown>;
    const cachedVersion = Number(cachedSignals.promptVersion ?? 1);
    const versionStale = Number.isFinite(cachedVersion) && cachedVersion < DAY_SUMMARY_PROMPT_VERSION;
    if (!versionStale) {
      if (cachedSignals.empty === true) {
        return c.json({ premium: true, summary: "", empty: true, cached: true });
      }
      if (cachedRow.summary) {
        return c.json({ premium: true, summary: cachedRow.summary, signals: cachedSignals, cached: true });
      }
    }
  }

  // 신호 수집 — parent_alerts + ai_chat_messages(KST 경계). created_at 은 substr(,19) 정규화.
  const startB = kstDateBoundary(dateKey);
  const endB = kstDateBoundary(addDaysToDateKey(dateKey, 1));
  // 활성 자녀 격리: 이 요약은 childUserId 한 명 기준이므로 알림도 그 자녀(또는 가족 단위
  // child_user_id NULL)로 한정한다. 없으면 옛(superseded) 자녀·형제의 알림이 활성 자녀
  // AI 요약(부모에게 노출)에 새어든다.
  const alertsRes = await db
    .prepare(
      `SELECT alert_type, title, created_at FROM parent_alerts
        WHERE family_id=? AND (child_user_id IS NULL OR child_user_id='' OR child_user_id=?)
          AND substr(created_at,1,19) >= datetime(?) AND substr(created_at,1,19) < datetime(?)
        ORDER BY substr(created_at,1,19) ASC LIMIT 50`,
    )
    .bind(familyId, childUserId, startB, endB)
    .all();
  const chatRes = await db
    .prepare(
      `SELECT role, content, created_at FROM ai_chat_messages
        WHERE family_id=? AND child_user_id=? AND substr(created_at,1,19) >= datetime(?) AND substr(created_at,1,19) < datetime(?)
        ORDER BY substr(created_at,1,19) ASC LIMIT 200`,
    )
    .bind(familyId, childUserId, startB, endB)
    .all();

  // extractDaySummarySignals 는 .js(checkJs off) — param 이 never[] 로 추론되므로 any 캐스팅.
  const signals = (extractDaySummarySignals as (input: unknown) => Record<string, unknown>)({
    alerts: alertsRes.results ?? [],
    chatMessages: chatRes.results ?? [],
    clientSignals: body.clientSignals || {},
  });

  if (!hasMeaningfulDaySignals(signals)) {
    if (!(await upsertDaySummary(
      db,
      callerUserId,
      familyId,
      childUserId,
      dateKey,
      "",
      { ...signals, empty: true },
    ))) {
      const state = await aiMutationScopeState(db, {
        actorUserId: callerUserId,
        familyId,
        childUserId,
        actorRole: "parent",
      });
      const error = aiMutationScopeErrorResponse(state === "active" ? "unavailable" : state);
      return c.json(error.body, error.status);
    }
    return c.json({ premium: true, summary: "", empty: true });
  }

  const OPENAI_API_KEY = c.env.OPENAI_API_KEY || "";
  if (!OPENAI_API_KEY) {
    return c.json({ premium: true, error: "ai_failure" }, 502);
  }

  const prompt = buildDaySummaryPrompt(signals, { childName: childMember.name, dateLabel: dateKey });
  let summary = "";
  const openAiStartedAt = Date.now();
  try {
    const openaiRes = await fetch(openaiChatUrl(c.env), {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(AI_OPENAI_TIMEOUT_MS),
      body: JSON.stringify({
        ...openaiLunaChatConfig(360),
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
        temperature: 0.7,
        safety_identifier: await openaiSafetyIdentifier(callerUserId),
      }),
    });
    if (!openaiRes.ok) {
      writeOpenAiLog("error", {
        operation: "day_summary",
        outcome: "http_error",
        status: openaiRes.status,
        latencyMs: Date.now() - openAiStartedAt,
        errorKind: "provider_rejected",
      });
      return c.json({ premium: true, error: "ai_failure" }, 502);
    }
    const data = await openaiRes.json<OpenAiChatResponse>();
    summary = String(data.choices?.[0]?.message?.content || "").trim();
    if (!summary) {
      writeOpenAiLog("error", {
        operation: "day_summary",
        outcome: "empty_response",
        status: openaiRes.status,
        latencyMs: Date.now() - openAiStartedAt,
        finishReason: data.choices?.[0]?.finish_reason,
        usage: data.usage,
        errorKind: "empty_response",
      });
      return c.json({ premium: true, error: "ai_failure" }, 502);
    }
    writeOpenAiLog("info", {
      operation: "day_summary",
      outcome: "success",
      status: openaiRes.status,
      latencyMs: Date.now() - openAiStartedAt,
      finishReason: data.choices?.[0]?.finish_reason,
      usage: data.usage,
    });
  } catch (error) {
    const errorKind = classifyOpenAiError(error);
    writeOpenAiLog("error", {
      operation: "day_summary",
      outcome: errorKind === "invalid_response" ? "invalid_response" : "network_error",
      latencyMs: Date.now() - openAiStartedAt,
      errorKind,
    });
    return c.json({ premium: true, error: "ai_failure" }, 502);
  }

  if (!(await upsertDaySummary(
    db,
    callerUserId,
    familyId,
    childUserId,
    dateKey,
    summary,
    signals,
  ))) {
    const state = await aiMutationScopeState(db, {
      actorUserId: callerUserId,
      familyId,
      childUserId,
      actorRole: "parent",
    });
    const error = aiMutationScopeErrorResponse(state === "active" ? "unavailable" : state);
    return c.json(error.body, error.status);
  }
  return c.json({ premium: true, summary, signals, cached: false });
});

// ── GET /api/ai/day-summary?familyId=&childUserId=&dateKey=  ← loadDaySummary 캐시 조회 ──
// aiDaySummary.loadDaySummary(ai_day_summaries SELECT) 직역 — 생성(POST)과 달리 OpenAI·과금
// 없는 순수 캐시 read. 컷오버 시 캐시 read 부재로 인한 재생성(AI 크레딧 낭비)을 방지한다.
// authz: 원본 RLS(ai_day_summaries_select_parent) — 가족 parent 만. 응답은 supabase 형태
//   { summary, signals(파싱 객체) } 또는 null(클라 loadDaySummary 입력 계약과 동일).
ai.get("/day-summary", requireAuth, async (c) => {
  const db = c.env.DB;
  const callerUserId = c.get("user").sub;
  const familyId = c.req.query("familyId") || "";
  const childUserId = c.req.query("childUserId") || "";
  const dateKey = c.req.query("dateKey") || "";
  if (!isValidUuidLike(familyId) || !isValidUuidLike(childUserId)) {
    return c.json({ error: "invalid_request" }, 400);
  }
  if (!isValidDateKey(dateKey)) {
    return c.json({ error: "invalid_date_key" }, 400);
  }

  const access = await authorizePremiumAiParent(db, { callerUserId, familyId }, resolveFamilyEntitlement);
  if (!access.ok) {
    return access.status === 503
      ? c.json({ error: access.error }, 503)
      : c.json({ error: access.error }, 403);
  }

  const row = await db
    .prepare("SELECT summary, signals FROM ai_day_summaries WHERE family_id=? AND child_user_id=? AND date_key=? LIMIT 1")
    .bind(familyId, childUserId, dateKey)
    .first<{ summary: string; signals: string }>();
  if (!row) return c.json(null);
  return c.json({ summary: row.summary, signals: parseJson(row.signals) });
});

// ── POST /api/ai/child-monitor  ← ai-child-monitor (메모 감정/일정 준수/주간 요약 분석) ──
// 원본 직역. 멤버십 검증(assertFamilyAccess)으로 abuse(임의 가족 분석·무제한 OpenAI) 차단.
const MONITOR_SYSTEM_BASE = `당신은 혜니캘린더 AI입니다. 어린이 일정관리 앱에서 아이의 행동 패턴과 메모를 분석하는 따뜻한 AI 도우미입니다.

## 핵심 원칙
- 항상 한국어로 응답합니다.
- 따뜻하고 지지적인 어조를 유지합니다. 절대 불안감을 조성하지 않습니다.
- 진짜 우려되는 패턴만 알립니다. 사소한 문제는 넘어갑니다.
- 대상 아이는 초등학생입니다.
- 거짓 양성(false positive)이 놓침(false negative)보다 낫지만, 지나치게 민감하지 않습니다.
- 반드시 유효한 JSON만 응답합니다. 다른 텍스트는 포함하지 않습니다.`;

function buildMemoSentimentPrompt(memoText: string, eventTitle: string, childName: string): string {
  return `${MONITOR_SYSTEM_BASE}

## 분석 유형: 메모 감정 분석

아이(${childName})가 "${eventTitle}" 일정에 작성한 메모를 분석해주세요.
스트레스, 따돌림, 외로움, 과도한 압박, 건강 문제 등 부모가 알아야 할 신호를 확인합니다.

## 응답 형식 (JSON만)
{
  "action": "alert" 또는 "ok",
  "severity": "info" 또는 "warning" 또는 "urgent",
  "title": "알림 제목 (한국어)",
  "message": "상세 내용 (한국어, 부모 친화적, 따뜻한 어조)",
  "category": "emotional" 또는 "social" 또는 "academic" 또는 "health"
}

## 판단 기준
- "ok": 평범한 일상 메모 (예: "피아노 재밌었다", "오늘 급식 맛있었어")
- "info": 약간 신경 쓰일 수 있지만 지켜볼 수준 (예: "조금 피곤해", "시험 걱정돼")
- "warning": 부모가 관심을 가져야 할 수준 (예: "친구가 나만 빼놓고 놀았어", "학원 너무 많아서 힘들어")
- "urgent": 즉시 부모 관심이 필요한 수준 (예: 지속적 따돌림 암시, 심한 우울 표현)

메모 내용:
"${memoText}"`;
}

function buildScheduleAdherencePrompt(
  events: Array<{ title: string; time: string; arrivedOnTime: boolean; arrivalDelay: number }>,
): string {
  const eventLines = events
    .map((e) => `- ${e.title} (${e.time}): ${e.arrivedOnTime ? "정시 도착" : `${e.arrivalDelay}분 지각`}`)
    .join("\n");
  return `${MONITOR_SYSTEM_BASE}

## 분석 유형: 일정 준수 패턴 분석

최근 일정 출석 데이터를 분석하여, 지각 패턴이 있는지 확인해주세요.
개별 지각이 아닌 추세(trend)에 집중합니다.

## 응답 형식 (JSON만)
{
  "action": "alert" 또는 "ok",
  "severity": "info" 또는 "warning",
  "title": "알림 제목 (한국어)",
  "message": "상세 내용 (한국어, 부모 친화적, 따뜻한 어조)"
}

## 판단 기준
- 1~2회 지각은 정상 범위 → "ok"
- 특정 일정에 반복적으로 지각 → "info" (해당 일정 시간 조정 제안)
- 전반적으로 지각이 늘어나는 추세 → "warning" (일정 과부하 가능성 제안)

일정 데이터:
${eventLines}`;
}

async function callMonitorOpenAI(
  key: string,
  systemPrompt: string,
  chatUrl: string,
  safetyIdentifier: string,
): Promise<Record<string, unknown>> {
  const openAiStartedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(chatUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(AI_OPENAI_TIMEOUT_MS),
      body: JSON.stringify({
        ...openaiLunaChatConfig(500),
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: "위 데이터를 분석하고 JSON으로 응답해주세요." },
        ],
        temperature: 0.3,
        response_format: { type: "json_object" },
        safety_identifier: safetyIdentifier,
      }),
    });
  } catch (error) {
    writeOpenAiLog("error", {
      operation: "child_monitor",
      outcome: "network_error",
      latencyMs: Date.now() - openAiStartedAt,
      errorKind: classifyOpenAiError(error),
    });
    throw new Error("openai_request_failed");
  }
  if (!response.ok) {
    writeOpenAiLog("error", {
      operation: "child_monitor",
      outcome: "http_error",
      status: response.status,
      latencyMs: Date.now() - openAiStartedAt,
      errorKind: "provider_rejected",
    });
    throw new Error("openai_request_failed");
  }
  let data: OpenAiChatResponse;
  try {
    data = await response.json<OpenAiChatResponse>();
  } catch (error) {
    writeOpenAiLog("error", {
      operation: "child_monitor",
      outcome: "invalid_response",
      status: response.status,
      latencyMs: Date.now() - openAiStartedAt,
      errorKind: classifyOpenAiError(error),
    });
    throw new Error("openai_invalid_response");
  }
  const parsedContent = parseOpenAiJsonObjectContent(data?.choices?.[0]?.message?.content);
  if (!parsedContent.ok) {
    writeOpenAiLog("error", {
      operation: "child_monitor",
      outcome: parsedContent.error,
      status: response.status,
      latencyMs: Date.now() - openAiStartedAt,
      finishReason: data?.choices?.[0]?.finish_reason,
      usage: data?.usage,
      errorKind: parsedContent.error,
    });
    throw new Error("openai_invalid_response");
  }
  writeOpenAiLog("info", {
    operation: "child_monitor",
    outcome: "success",
    status: response.status,
    latencyMs: Date.now() - openAiStartedAt,
    finishReason: data?.choices?.[0]?.finish_reason,
    usage: data?.usage,
  });
  return parsedContent.value;
}

ai.post("/child-monitor", requireAuth, async (c) => {
  const OPENAI_API_KEY = c.env.OPENAI_API_KEY || "";
  const callerUserId = c.get("user").sub;

  const parsedBody = await readBoundedAiJson(c.req.raw);
  if (!parsedBody.ok) {
    return parsedBody.error === "payload_too_large"
      ? c.json({ error: "ai_payload_too_large" }, 413)
      : c.json({ error: "invalid_json" }, 400);
  }
  const inputValidation = validateChildMonitorInput(parsedBody.value);
  if (!inputValidation.ok) return c.json({ error: inputValidation.error }, 400);
  const body = parsedBody.value as Record<string, unknown>;

  const familyId = String(body.familyId || "");
  const analysisType = String(body.analysisType || "");
  if (!familyId) return c.json({ error: "familyId is required" }, 400);
  if (!["memo_sentiment", "schedule_adherence", "weekly_summary"].includes(analysisType)) {
    return c.json({ error: "analysisType must be one of: memo_sentiment, schedule_adherence, weekly_summary" }, 400);
  }

  if (analysisType === "weekly_summary") {
    const access = await authorizePremiumAiParent(
      c.env.DB,
      { callerUserId, familyId },
      resolveFamilyEntitlement,
    );
    if (!access.ok) {
      return access.status === 503
        ? c.json({ error: access.error }, 503)
        : c.json({ error: access.error }, 403);
    }
    // 레거시 요청의 weekData에는 아이·기간 정본이 없고 정시/지각 원장도 검증할 수 없다.
    // 클라이언트 수치를 실제 가족 집계처럼 AI에 전달하지 않고 명시적으로 닫는다.
    return c.json({ error: "weekly_summary_source_unavailable" }, 503);
  }

  // 멤버십 검증(abuse 차단) — caller 가 해당 가족 소속이어야.
  if (!(await assertFamilyAccess(c.env.DB, callerUserId, familyId))) {
    return c.json({ error: "forbidden" }, 403);
  }
  if (!OPENAI_API_KEY) return c.json({ error: "ai_unavailable" }, 503);

  // AI 원가 게이트: voice-parse 와 동일(프리미엄 바이패스·무료 하루 한도). child-monitor 도
  // 게이트 없는 외부 AI 호출 경로였으므로(파싱 우회 벡터) 동일하게 막는다.
  const monitorQuota = await reserveAiParseQuota(c.env.DB, [familyId], callerUserId);
  if (monitorQuota.over) return monitorQuota.over;

  let systemPrompt: string;
  if (analysisType === "memo_sentiment") {
    if (typeof body.memoText !== "string" || !body.memoText) return c.json({ error: "memoText is required for memo_sentiment" }, 400);
    if (typeof body.childName !== "string" || !body.childName) return c.json({ error: "childName is required for memo_sentiment" }, 400);
    systemPrompt = buildMemoSentimentPrompt(body.memoText, String(body.eventTitle || ""), body.childName);
  } else if (analysisType === "schedule_adherence") {
    if (!Array.isArray(body.events) || body.events.length === 0) return c.json({ error: "events array is required for schedule_adherence" }, 400);
    systemPrompt = buildScheduleAdherencePrompt(body.events as Array<{ title: string; time: string; arrivedOnTime: boolean; arrivalDelay: number }>);
  } else {
    return c.json({ error: "unsupported_analysis_type" }, 400);
  }

  try {
    const result = await callMonitorOpenAI(
      OPENAI_API_KEY,
      systemPrompt,
      openaiChatUrl(c.env),
      await openaiSafetyIdentifier(callerUserId),
    );
    return c.json(result);
  } catch {
    await monitorQuota.refund(); // 서버측 실패 — 무료 쿼터 예약분 환불.
    return c.json({ error: "ai_failure" }, 502);
  }
});

export default ai;

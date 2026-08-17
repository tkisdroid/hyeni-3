// 아이 → 부모 "AI 대화 충전해 줘" 요청의 서버 게이트.
//
// 아이 클라이언트가 보낸 title/message 를 그대로 부모 알림으로 만들면 아이가 부모에게
// 임의 문구를 푸시할 수 있다. 그래서 이 경로는 두 가지를 서버가 확정한다.
//  ① 정말로 오늘 대화를 다 썼는지(남은 횟수가 있으면 요청 자체를 거부)
//  ② 부모가 읽을 제목·본문(소진 원인별 문구, 아이 입력 미반영)
//
// 소진 원인이 부모가 정한 하루 상한이면 크레딧을 사도 안 풀리므로 문구를 다르게 준다(정직한 안내).
import {
  buildAiCreditRequestAlert,
  isAiCreditRequestWithinCooldown,
  resolveAiCreditRequestReason,
} from "../shared/aiCreditRequestAlert.js";
import { applyParentDailyChatLimit, getAiCreditStatus } from "../shared/aiCredits.js";

type AnyFn = (...args: any[]) => any;
const getAiCreditStatusFn = getAiCreditStatus as AnyFn;
const applyParentDailyChatLimitFn = applyParentDailyChatLimit as AnyFn;
const buildAiCreditRequestAlertFn = buildAiCreditRequestAlert as AnyFn;
const resolveAiCreditRequestReasonFn = resolveAiCreditRequestReason as AnyFn;
const isAiCreditRequestWithinCooldownFn = isAiCreditRequestWithinCooldown as AnyFn;

export interface AiCreditRequestEvidence {
  title: string;
  message: string;
  severity: string;
  reason: string;
  metadata: Record<string, unknown>;
  /** 최근 같은 요청이 이미 부모에게 갔다 — 새 알림을 만들지 않고 성공으로 닫는다. */
  duplicate: boolean;
}

export type AiCreditRequestGateResult =
  | { status: "ok"; evidence: AiCreditRequestEvidence }
  | { status: "rejected"; error: string };

/** KST 기준 오늘 날짜 키 — 크레딧 리셋 경계와 같은 기준을 쓴다. */
function todayDateKST(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * D1 timestamp('YYYY-MM-DD HH:MM:SS.ffffff+00') → ms.
 * `+00` 은 유효한 ISO offset 이 아니라 Date.parse 가 NaN 을 준다. 그대로 두면
 * 쿨다운이 "최근 요청 없음"으로 오판돼 부모에게 알림이 매번 새로 간다(2026-08-17 실측).
 */
export function parsePgTimestampMs(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const iso = value.trim().replace(" ", "T").replace(/\+00(?::?00)?$/, "Z");
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function resolveAiCreditRequestEvidence(
  db: D1Database,
  input: { familyId: string; childUserId: string; nowMs?: number },
): Promise<AiCreditRequestGateResult> {
  const { familyId, childUserId } = input;
  if (!familyId || !childUserId) return { status: "rejected", error: "invalid_ai_credit_request" };
  const nowMs = typeof input.nowMs === "number" && Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  const quotaDate = todayDateKST(new Date(nowMs));

  let balanceRow: Record<string, any> | null = null;
  let memberRow: { name: string | null } | null = null;
  let parentLimitRow: { daily_limit: number | null } | null = null;
  let ledgerRow: { cnt: number } | null = null;
  try {
    [balanceRow, memberRow, parentLimitRow, ledgerRow] = await Promise.all([
      db
        .prepare(
          `SELECT is_premium, daily_included_limit, daily_included_used, daily_reset_date, purchased_credits
             FROM ai_credit_balances WHERE family_id=? AND child_user_id=? LIMIT 1`,
        )
        .bind(familyId, childUserId)
        .first<Record<string, any>>(),
      db
        .prepare(
          `SELECT name FROM family_members
            WHERE family_id=? AND user_id=? AND role='child' AND is_active=1 LIMIT 1`,
        )
        .bind(familyId, childUserId)
        .first<{ name: string | null }>(),
      db
        .prepare("SELECT daily_limit FROM ai_parent_settings WHERE family_id=? AND child_user_id=? LIMIT 1")
        .bind(familyId, childUserId)
        .first<{ daily_limit: number | null }>(),
      db
        .prepare(
          `SELECT COUNT(id) AS cnt FROM ai_credit_ledger
            WHERE family_id=? AND child_user_id=? AND substr(created_at,1,10)=?`,
        )
        .bind(familyId, childUserId, quotaDate)
        .first<{ cnt: number }>(),
    ]);
  } catch {
    // 판정 자체가 안 되면 부모에게 잘못된 요청을 보내지 않는다(fail-closed).
    console.error("[ai-credit-request] credit state lookup failed");
    return { status: "rejected", error: "ai_credit_request_unavailable" };
  }
  if (!memberRow) return { status: "rejected", error: "forbidden" };
  if (!balanceRow) return { status: "rejected", error: "ai_credit_request_unavailable" };

  const status = applyParentDailyChatLimitFn(
    getAiCreditStatusFn(balanceRow, quotaDate),
    Number(parentLimitRow?.daily_limit ?? 0) || 0,
    Number(ledgerRow?.cnt ?? 0) || 0,
  );
  // 아직 대화가 남아 있으면 요청할 이유가 없다 — 부모 알림 도배를 막는다.
  if (status?.canChat !== false) return { status: "rejected", error: "ai_credit_available" };

  const reason = resolveAiCreditRequestReasonFn({
    isPremium: Boolean(balanceRow.is_premium),
    dailyIncludedLimit: Number(balanceRow.daily_included_limit ?? 0) || 0,
    parentDailyLimit: Number(status.parentDailyLimit ?? 0) || 0,
  });
  const alert = buildAiCreditRequestAlertFn({
    familyId,
    childUserId,
    childName: memberRow.name ?? "",
    reason,
  });
  if (!alert) return { status: "rejected", error: "invalid_ai_credit_request" };

  // 최근 같은 요청이 있으면 알림을 새로 만들지 않는다. 조회 실패는 요청을 막지 않는다(fail-open) —
  // 도배 방지보다 아이가 부모에게 닿는 것이 중요하다.
  let duplicate = false;
  try {
    const recent = await db
      .prepare(
        `SELECT created_at FROM parent_alerts
          WHERE family_id=? AND alert_type='ai_credit_request' AND child_user_id=?
          ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(familyId, childUserId)
      .first<{ created_at: string }>();
    if (recent?.created_at) {
      duplicate = isAiCreditRequestWithinCooldownFn(parsePgTimestampMs(recent.created_at), nowMs) === true;
    }
  } catch {
    console.error("[ai-credit-request] recent request lookup failed");
  }

  return {
    status: "ok",
    evidence: {
      title: alert.title,
      message: alert.message,
      severity: alert.severity,
      reason,
      metadata: alert.metadata,
      duplicate,
    },
  };
}

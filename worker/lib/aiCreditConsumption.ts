import { pgTs } from "./time";
import {
  FREE_AI_DAILY_INCLUDED_CREDITS,
  PREMIUM_AI_DAILY_INCLUDED_CREDITS,
} from "../shared/aiCredits.js";

type AiCreditSource = "daily_included" | "purchased_credit";
type AiCreditReason = "chat_response" | "proactive_message";

const AI_CREDIT_EXECUTION_LEASE_ACTION = "ai_credit_execution_lease";
const AI_CREDIT_EXECUTION_LEASE_TTL_MS = 2 * 60_000;

interface BalanceRow {
  id: string;
  family_id: string;
  child_user_id: string;
  parent_id: string | null;
  is_premium: number;
  daily_included_limit: number;
  daily_included_used: number;
  daily_reset_date: string;
  purchased_credits: number;
}

interface LedgerRow {
  source: AiCreditSource;
}

interface ConsumptionSnapshot {
  canChat: boolean;
  dailyIncludedLimit: number;
  dailyIncludedUsed: number;
  dailyIncludedRemaining: number;
  purchasedCredits: number;
  parentDailyLimit: number;
  parentDailyUsed: number;
  parentDailyRemaining: number;
}

export type AiCreditAtomicResult =
  | ({
      status: "consumed";
      source: AiCreditSource;
      alreadyConsumed: boolean;
    } & ConsumptionSnapshot)
  | ({ status: "exhausted" } & ConsumptionSnapshot);

export interface ConsumeAiCreditAtomicOptions {
  familyId: string;
  childUserId: string;
  parentDailyLimit: number;
  usageDate: string;
  reason: AiCreditReason;
  transactionId: string;
  messageId?: string | null;
  now?: Date;
}

export interface AiCreditExecutionLease {
  key: string;
  token: string;
}

export type AiCreditExecutionLeaseResult =
  | { status: "acquired"; lease: AiCreditExecutionLease }
  | { status: "busy" };

interface InteractiveAiCreditExecutionLeaseOptions {
  familyId: string;
  childUserId: string;
  retryAttempts?: number;
  retryDelayMs?: number;
  wait?: (delayMs: number) => Promise<void>;
}

export class AiCreditConsumptionUnavailableError extends Error {
  readonly status = 503;
  readonly code = "ai_credit_consumption_unavailable";

  constructor(cause?: unknown) {
    super("AI 크레딧 사용량을 안전하게 확정하지 못했어요.", { cause });
    this.name = "AiCreditConsumptionUnavailableError";
  }
}

function asNonNegativeInt(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : 0;
}

function asSignedInt(value: unknown): number {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) ? numeric : 0;
}

function commercialLimit(row: BalanceRow): number {
  return row.is_premium
    ? PREMIUM_AI_DAILY_INCLUDED_CREDITS
    : FREE_AI_DAILY_INCLUDED_CREDITS;
}

function parentLimit(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.max(0, Math.min(100, Math.round(numeric)))
    : fallback;
}

function ledgerId(transactionId: string): string {
  return `ai-credit:${transactionId}`;
}

function validateOptions(options: ConsumeAiCreditAtomicOptions): void {
  if (!options.familyId || !options.childUserId) throw new TypeError("familyId와 childUserId가 필요합니다.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.usageDate)) throw new TypeError("usageDate 형식이 올바르지 않습니다.");
  if (!/^[\x21-\x7e]{1,200}$/.test(options.transactionId)) throw new TypeError("transactionId 형식이 올바르지 않습니다.");
  if (options.reason !== "chat_response" && options.reason !== "proactive_message") {
    throw new TypeError("지원하지 않는 AI 크레딧 차감 사유입니다.");
  }
}

function executionLeaseKey(familyId: string, childUserId: string): string {
  const family = String(familyId ?? "").trim();
  const child = String(childUserId ?? "").trim();
  if (!family || !child || family.length > 200 || child.length > 200) {
    throw new TypeError("AI 실행 lease 범위가 올바르지 않습니다.");
  }
  return `ai-credit-execution:${family}:${child}`;
}

/**
 * 동일 자녀의 비용 발생 AI 작업을 직렬화한다. 차감 전 외부 모델 호출·도구 mutation이
 * 병렬로 실행되는 창을 닫고, Worker 비정상 종료 lease는 2분 뒤 회수한다.
 */
export async function acquireAiCreditExecutionLease(
  db: D1Database,
  options: { familyId: string; childUserId: string; now?: Date },
): Promise<AiCreditExecutionLeaseResult> {
  const key = executionLeaseKey(options.familyId, options.childUserId);
  const now = options.now instanceof Date && Number.isFinite(options.now.getTime())
    ? options.now
    : new Date();
  const token = crypto.randomUUID();
  const createdAt = pgTs(now);
  const expiredAt = pgTs(new Date(now.getTime() - AI_CREDIT_EXECUTION_LEASE_TTL_MS));
  try {
    await db
      .prepare(
        `DELETE FROM push_idempotency
          WHERE key=?1 AND action=?2
            AND substr(created_at,1,19)<=substr(?3,1,19)`,
      )
      .bind(key, AI_CREDIT_EXECUTION_LEASE_ACTION, expiredAt)
      .run();
    const inserted = await db
      .prepare(
        `INSERT OR IGNORE INTO push_idempotency
           (key,created_at,first_sent_at,family_id,action)
         VALUES (?,?,?,?,?)`,
      )
      .bind(
        key,
        createdAt,
        token,
        String(options.familyId).trim(),
        AI_CREDIT_EXECUTION_LEASE_ACTION,
      )
      .run();
    return Number(inserted.meta?.changes ?? 0) === 1
      ? { status: "acquired", lease: { key, token } }
      : { status: "busy" };
  } catch (error) {
    throw new AiCreditConsumptionUnavailableError(error);
  }
}

/** 짧은 선제 메시지 작업과 겹친 아이 대화만 잠깐 기다리고, 다른 긴 대화는 bounded busy로 끝낸다. */
export async function acquireInteractiveAiCreditExecutionLease(
  db: D1Database,
  options: InteractiveAiCreditExecutionLeaseOptions,
): Promise<AiCreditExecutionLeaseResult> {
  const retryAttempts = Number.isFinite(options.retryAttempts)
    ? Math.max(1, Math.min(10, Math.floor(options.retryAttempts as number)))
    : 5;
  const retryDelayMs = Number.isFinite(options.retryDelayMs)
    ? Math.max(0, Math.min(1_000, Math.floor(options.retryDelayMs as number)))
    : 150;
  const wait = options.wait ?? ((delayMs: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  }));

  for (let attempt = 0; attempt < retryAttempts; attempt += 1) {
    const result = await acquireAiCreditExecutionLease(db, options);
    if (result.status === "acquired" || attempt === retryAttempts - 1) return result;
    await wait(retryDelayMs);
  }
  return { status: "busy" };
}

export async function releaseAiCreditExecutionLease(
  db: D1Database,
  lease: AiCreditExecutionLease,
): Promise<boolean> {
  if (!lease?.key || !lease?.token) return false;
  try {
    const result = await db
      .prepare(
        `DELETE FROM push_idempotency
          WHERE key=?1 AND action=?2 AND first_sent_at=?3`,
      )
      .bind(lease.key, AI_CREDIT_EXECUTION_LEASE_ACTION, lease.token)
      .run();
    return Number(result.meta?.changes ?? 0) === 1;
  } catch (error) {
    throw new AiCreditConsumptionUnavailableError(error);
  }
}

function nextDateKey(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

async function loadBalance(db: D1Database, familyId: string, childUserId: string): Promise<BalanceRow | null> {
  return db
    .prepare(
      `SELECT id, family_id, child_user_id, parent_id, is_premium, daily_included_limit,
              daily_included_used, daily_reset_date, purchased_credits
         FROM ai_credit_balances
        WHERE family_id=? AND child_user_id=? LIMIT 1`,
    )
    .bind(familyId, childUserId)
    .first<BalanceRow>();
}

async function loadDailyChargedCount(
  db: D1Database,
  familyId: string,
  childUserId: string,
  usageDate: string,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(id) AS count
         FROM ai_credit_ledger
        WHERE family_id=? AND child_user_id=?
          AND reason IN ('chat_response','proactive_message')
          AND substr(created_at,1,19) >= datetime(?)
          AND substr(created_at,1,19) < datetime(?)`,
    )
    .bind(
      familyId,
      childUserId,
      `${usageDate}T00:00:00+09:00`,
      `${nextDateKey(usageDate)}T00:00:00+09:00`,
    )
    .first<{ count: number }>();
  return asNonNegativeInt(row?.count);
}

function snapshot(
  row: BalanceRow,
  usageDate: string,
  configuredParentLimit: number,
  parentDailyUsed: number,
): ConsumptionSnapshot {
  const includedLimit = commercialLimit(row);
  const sameDay = String(row.daily_reset_date).slice(0, 10) === usageDate;
  const includedUsed = sameDay ? Math.min(asNonNegativeInt(row.daily_included_used), includedLimit) : 0;
  const purchasedCredits = asNonNegativeInt(row.purchased_credits);
  const safeParentLimit = parentLimit(configuredParentLimit, includedLimit);
  const safeParentUsed = asNonNegativeInt(parentDailyUsed);
  const parentDailyRemaining = Math.max(0, safeParentLimit - safeParentUsed);
  const dailyIncludedRemaining = Math.max(0, includedLimit - includedUsed);

  return {
    canChat: parentDailyRemaining > 0 && (dailyIncludedRemaining > 0 || purchasedCredits > 0),
    dailyIncludedLimit: includedLimit,
    dailyIncludedUsed: includedUsed,
    dailyIncludedRemaining,
    purchasedCredits,
    parentDailyLimit: safeParentLimit,
    parentDailyUsed: safeParentUsed,
    parentDailyRemaining,
  };
}

async function readExistingConsumption(
  db: D1Database,
  id: string,
): Promise<LedgerRow | null> {
  return db
    .prepare("SELECT source FROM ai_credit_ledger WHERE id=? LIMIT 1")
    .bind(id)
    .first<LedgerRow>();
}

export async function consumeAiCreditAtomic(
  db: D1Database,
  options: ConsumeAiCreditAtomicOptions,
): Promise<AiCreditAtomicResult> {
  validateOptions(options);
  const id = ledgerId(options.transactionId);
  const now = options.now instanceof Date && Number.isFinite(options.now.getTime())
    ? options.now
    : new Date();
  const createdAt = pgTs(now);

  try {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const existing = await readExistingConsumption(db, id);
      const row = await loadBalance(db, options.familyId, options.childUserId);
      if (!row) throw new AiCreditConsumptionUnavailableError();
      const parentDailyUsed = await loadDailyChargedCount(
        db,
        options.familyId,
        options.childUserId,
        options.usageDate,
      );
      const current = snapshot(row, options.usageDate, options.parentDailyLimit, parentDailyUsed);

      if (existing) {
        return {
          status: "consumed",
          source: existing.source,
          alreadyConsumed: true,
          ...current,
        };
      }
      if (!current.canChat) return { status: "exhausted", ...current };

      const source: AiCreditSource = current.dailyIncludedRemaining > 0
        ? "daily_included"
        : "purchased_credit";
      // 전액 환불 뒤 이미 사용한 구매 크레딧은 음수 부채로 남는다. 화면과 사용 가능
      // 판정에는 0으로 보이되, 일일 포함량을 쓰는 동안 DB의 부채를 지우면 안 된다.
      const rawPurchasedCredits = asSignedInt(row.purchased_credits);
      const nextIncludedUsed = source === "daily_included"
        ? current.dailyIncludedUsed + 1
        : current.dailyIncludedUsed;
      const nextPurchasedCredits = source === "purchased_credit"
        ? rawPurchasedCredits - 1
        : rawPurchasedCredits;
      const oldIncludedUsed = asNonNegativeInt(row.daily_included_used);
      const oldPurchasedCredits = rawPurchasedCredits;
      const oldPremium = row.is_premium ? 1 : 0;

      try {
        const [balanceResult, ledgerResult] = await db.batch([
          db
            .prepare(
              `UPDATE ai_credit_balances
                  SET daily_included_limit=?, daily_included_used=?, daily_reset_date=?,
                      purchased_credits=?, updated_at=?
                WHERE id=? AND family_id=? AND child_user_id=?
                  AND is_premium=? AND daily_included_used=?
                  AND daily_reset_date=? AND purchased_credits=?`,
            )
            .bind(
              current.dailyIncludedLimit,
              nextIncludedUsed,
              options.usageDate,
              nextPurchasedCredits,
              createdAt,
              row.id,
              options.familyId,
              options.childUserId,
              oldPremium,
              oldIncludedUsed,
              row.daily_reset_date,
              oldPurchasedCredits,
            ),
          db
            .prepare(
              `INSERT INTO ai_credit_ledger
                 (id, family_id, child_user_id, parent_id, delta, reason, source,
                  message_id, transaction_id, created_at)
               SELECT ?,?,?,?,?,?,?,?,?,? WHERE changes()=1`,
            )
            .bind(
              id,
              options.familyId,
              options.childUserId,
              row.parent_id,
              source === "purchased_credit" ? -1 : 0,
              options.reason,
              source,
              options.messageId ?? null,
              options.transactionId,
              createdAt,
            ),
        ]);
        const balanceChanges = Number(balanceResult.meta?.changes ?? 0);
        const ledgerChanges = Number(ledgerResult.meta?.changes ?? 0);
        if (balanceChanges === 1 && ledgerChanges === 1) {
          return {
            status: "consumed",
            source,
            alreadyConsumed: false,
            canChat:
              current.parentDailyRemaining - 1 > 0 &&
              (current.dailyIncludedRemaining - (source === "daily_included" ? 1 : 0) > 0 ||
                 nextPurchasedCredits > 0),
            dailyIncludedLimit: current.dailyIncludedLimit,
            dailyIncludedUsed: nextIncludedUsed,
            dailyIncludedRemaining: Math.max(0, current.dailyIncludedLimit - nextIncludedUsed),
            purchasedCredits: Math.max(0, nextPurchasedCredits),
            parentDailyLimit: current.parentDailyLimit,
            parentDailyUsed: current.parentDailyUsed + 1,
            parentDailyRemaining: Math.max(0, current.parentDailyRemaining - 1),
          };
        }
        if (balanceChanges !== 0 || ledgerChanges !== 0) {
          throw new AiCreditConsumptionUnavailableError();
        }
      } catch (error) {
        const duplicate = await readExistingConsumption(db, id);
        if (duplicate) continue;
        if (error instanceof AiCreditConsumptionUnavailableError) throw error;
        if (!/constraint|unique|primary/i.test(String(error))) throw error;
      }
    }
  } catch (error) {
    if (error instanceof TypeError || error instanceof AiCreditConsumptionUnavailableError) throw error;
    throw new AiCreditConsumptionUnavailableError(error);
  }

  throw new AiCreditConsumptionUnavailableError();
}

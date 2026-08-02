import type { Env } from "../types";
import { notifyPg } from "./realtime";
import { addUtcCalendarYears, pgToIso, pgTs } from "./time";
import {
  TossWebBillingRequestError,
  chargeTossBillingKey,
  deleteTossBillingKey,
  findTossBillingPaymentStateByOrderId,
  findTossPaymentByOrderId,
  type TossBillingPaymentState,
  type TossWebBillingConfig,
} from "./tossWebBilling";
import {
  WEB_BILLING_MAX_RENEWAL_FAILURES,
  WEB_BILLING_PLANS,
  WEB_BILLING_PROVIDER,
  WEB_BILLING_TRIAL_DAYS,
  addWebBillingPeriod,
  createWebBillingOrderId,
  decryptWebBillingSecret,
  hashWebBillingPaymentKey,
  hashWebBillingRefundState,
  readWebBillingConfig,
  safeTossErrorCode,
  webBillingRetryAt,
} from "../shared/webBilling.js";
import {
  acquireAccountMutationLeases,
  loadFamilyNotificationMutationScopes,
  releaseAccountMutationLeases,
} from "./accountMutationScope";
import {
  createServerPremiumFunnelEventId,
  isPremiumFunnelConfigured,
  recordServerPremiumFunnelEvent,
} from "./premiumFunnel";
import {
  markBillingProviderConflict,
  prepareBillingProviderFinalization,
  readBillingProviderReservation,
  releaseBillingProviderReservation,
} from "./billingProviderReservation.ts";

type FetchLike = typeof fetch;
type WebBillingPlan = "month" | "year";

interface ChargeAttemptRow {
  order_id: string;
  family_id: string;
  checkout_session_id: string | null;
  plan: WebBillingPlan;
  amount: number;
  kind: "initial" | "trial_conversion" | "renewal";
  period_start: string;
  period_end: string;
  status: "pending" | "processing" | "done" | "failed" | "unknown";
  claim_token: string | null;
  claim_expires_at: string | null;
  error_code: string | null;
}

interface WebBillingCustomerRow {
  family_id: string;
  parent_id: string;
  customer_key: string;
  billing_key_ciphertext: string | null;
  billing_key_iv: string | null;
  billing_key_version: string | null;
  billing_key_revocation_status: "pending" | "revoked" | null;
  billing_key_revocation_attempts: number;
  billing_key_revocation_retry_at: string | null;
  billing_key_revocation_error: string | null;
  billing_key_revoked_at: string | null;
  plan: WebBillingPlan;
  status: "pending_charge" | "trial" | "active" | "cancel_at_period_end" | "past_due" | "expired";
  trial_ends_at: string | null;
  current_period_end: string | null;
  next_charge_at: string | null;
  retry_after: string | null;
  failure_count: number;
  cancelled_at: string | null;
  last_order_id: string | null;
  last_paid_order_id: string | null;
}

interface InitialReconciliationCandidate {
  order_id: string;
  family_id: string;
  checkout_session_id: string;
  plan: WebBillingPlan;
  period_end: string;
  attempt_status: ChargeAttemptRow["status"];
  customer_key: string;
}

export type WebBillingAttemptOutcome =
  | { status: "done"; paymentKeyHash: string }
  | { status: "failed"; errorCode: string }
  | { status: "unknown"; errorCode: string }
  | { status: "busy" };

export function configuredWebBilling(env: Env): TossWebBillingConfig | null {
  return readWebBillingConfig(env) as TossWebBillingConfig | null;
}

const WEB_BILLING_KEY_REVOCATION_RETRY_MS = [
  15 * 60 * 1000,
  60 * 60 * 1000,
  6 * 60 * 60 * 1000,
  24 * 60 * 60 * 1000,
] as const;

const WEB_BILLING_ACCOUNT_DELETION_RECONCILIATION_LIMIT = 20;
const WEB_BILLING_FINANCIAL_CLEANUP_LIMIT = 5_000;
const WEB_BILLING_REFUND_WEBHOOK_COOLDOWN_MS = 60_000;
const WEB_BILLING_REFUND_RECONCILIATION_INTERVAL_MS = 24 * 60 * 60 * 1000;

interface WebBillingRefundAttemptRow {
  order_id: string;
  family_id: string;
  plan: WebBillingPlan;
  amount: number;
  kind: "initial" | "trial_conversion" | "renewal";
  period_start: string;
  period_end: string;
  status: ChargeAttemptRow["status"];
  payment_key_hash: string | null;
  refund_status: "none" | "partial" | "full";
  refunded_amount: number;
  refund_state_hash: string | null;
  provider_checked_at: string | null;
  refund_committed_at: string | null;
  refund_webhook_checked_at: string | null;
  refund_funnel_status: "none" | "pending" | "sent";
  customer_key: string | null;
}

export type WebBillingRefundSettlement =
  | { status: "paid"; orderId: string; familyId: string }
  | { status: "partial_refund"; orderId: string; familyId: string; refundedAmount: number }
  | {
    status: "refunded";
    orderId: string;
    familyId: string;
    refundedAmount: number;
    entitlementRevoked: boolean;
  };

const WEB_BILLING_FINANCIAL_RECORD_COLUMNS = new Set([
  "record_id",
  "record_type",
  "provider",
  "provider_reference",
  "plan",
  "amount",
  "currency",
  "charge_kind",
  "record_status",
  "period_start",
  "period_end",
  "payment_key_hash",
  "detached_at",
  "retention_until",
  "created_at",
]);

const WEB_BILLING_REFUND_RECORD_COLUMNS = new Set([
  "record_id",
  "provider_reference",
  "provider",
  "plan",
  "amount",
  "currency",
  "charge_kind",
  "refund_status",
  "refunded_amount",
  "balance_amount",
  "payment_key_hash",
  "refund_state_hash",
  "transaction_count",
  "provider_checked_at",
  "retention_until",
  "created_at",
]);

interface AccountDeletionWebBillingCustomer {
  family_id: string;
  parent_id: string;
  customer_key: string;
  billing_key_ciphertext: string | null;
  billing_key_iv: string | null;
  billing_key_version: string | null;
}

interface AccountDeletionUnsettledAttempt {
  order_id: string;
  family_id: string;
  customer_key: string | null;
}

function webBillingKeyRevocationRetryAt(now: Date, priorAttempts: number): string {
  const index = Math.min(
    WEB_BILLING_KEY_REVOCATION_RETRY_MS.length - 1,
    Math.max(0, Math.trunc(priorAttempts)),
  );
  return pgTs(new Date(now.getTime() + WEB_BILLING_KEY_REVOCATION_RETRY_MS[index]));
}

async function markWebBillingKeyRevocationFailure(
  db: D1Database,
  customer: WebBillingCustomerRow,
  errorCode: string,
  now: Date,
): Promise<void> {
  await db.prepare(
    `UPDATE web_billing_customers
        SET billing_key_revocation_attempts=billing_key_revocation_attempts+1,
            billing_key_revocation_retry_at=?,billing_key_revocation_error=?,updated_at=?
      WHERE family_id=? AND customer_key=?
        AND billing_key_revocation_status='pending'
        AND billing_key_ciphertext IS NOT NULL
        AND billing_key_iv IS NOT NULL AND billing_key_version='v1'`,
  ).bind(
    webBillingKeyRevocationRetryAt(now, customer.billing_key_revocation_attempts),
    safeTossErrorCode(errorCode, "WEB_BILLING_KEY_REVOCATION_FAILED"),
    pgTs(now),
    customer.family_id,
    customer.customer_key,
  ).run();
}

export async function attemptWebBillingKeyRevocation(
  env: Env,
  input: {
    familyId: string;
    now?: Date;
    fetchImpl?: FetchLike;
    config?: TossWebBillingConfig | null;
    force?: boolean;
  },
): Promise<"revoked" | "pending" | "skipped"> {
  const now = input.now ?? new Date();
  const customer = await loadWebBillingCustomer(env.DB, input.familyId);
  if (
    !customer
    || customer.billing_key_revocation_status !== "pending"
    || !customer.billing_key_ciphertext
    || !customer.billing_key_iv
    || customer.billing_key_version !== "v1"
  ) {
    return customer?.billing_key_revocation_status === "revoked" ? "revoked" : "skipped";
  }
  if (!input.force && !isAtOrBefore(customer.billing_key_revocation_retry_at, now)) {
    return "pending";
  }
  const config = input.config === undefined ? configuredWebBilling(env) : input.config;
  if (!config) {
    await markWebBillingKeyRevocationFailure(
      env.DB,
      customer,
      "WEB_BILLING_CONFIG_UNAVAILABLE",
      now,
    );
    return "pending";
  }

  let billingKey: string;
  try {
    billingKey = await decryptWebBillingSecret(config.encryptionSecret, {
      version: customer.billing_key_version,
      iv: customer.billing_key_iv,
      ciphertext: customer.billing_key_ciphertext,
    }, customer.family_id, customer.customer_key);
  } catch {
    await markWebBillingKeyRevocationFailure(
      env.DB,
      customer,
      "WEB_BILLING_KEY_DECRYPTION_UNAVAILABLE",
      now,
    );
    return "pending";
  }

  try {
    await deleteTossBillingKey(config, billingKey, input.fetchImpl);
  } catch (error) {
    if (!(error instanceof TossWebBillingRequestError && error.httpStatus === 404)) {
      await markWebBillingKeyRevocationFailure(
        env.DB,
        customer,
        error instanceof TossWebBillingRequestError
          ? error.code
          : "WEB_BILLING_KEY_REVOCATION_FAILED",
        now,
      );
      return "pending";
    }
  }

  const revoked = await env.DB.prepare(
    `UPDATE web_billing_customers
        SET billing_key_ciphertext=NULL,billing_key_iv=NULL,billing_key_version=NULL,
            billing_key_revocation_status='revoked',billing_key_revocation_retry_at=NULL,
            billing_key_revocation_error=NULL,billing_key_revoked_at=?,updated_at=?
      WHERE family_id=? AND customer_key=?
        AND billing_key_revocation_status='pending'
        AND billing_key_ciphertext=? AND billing_key_iv=? AND billing_key_version='v1'`,
  ).bind(
    pgTs(now),
    pgTs(now),
    customer.family_id,
    customer.customer_key,
    customer.billing_key_ciphertext,
    customer.billing_key_iv,
  ).run();
  if (Number(revoked.meta?.changes ?? 0) === 1) {
    if (customer.status === "expired") {
      const providerState = await readBillingProviderReservation(env.DB, customer.family_id, now);
      if (providerState?.provider === "toss_web" && providerState.state === "reserved") {
        await releaseBillingProviderReservation(env.DB, {
          familyId: customer.family_id,
          provider: "toss_web",
          reservationRef: providerState.reservation_ref,
          now,
        });
      }
    }
    return "revoked";
  }
  const latest = await loadWebBillingCustomer(env.DB, input.familyId);
  return latest?.billing_key_revocation_status === "revoked" ? "revoked" : "skipped";
}

function webBillingLifetimeUseSql(familyIdSql: string): string {
  return `
    EXISTS(
      SELECT 1 FROM web_billing_trial_claims
       WHERE family_id=${familyIdSql}
    )
    OR EXISTS(
      SELECT 1 FROM web_billing_charge_attempts
       WHERE family_id=${familyIdSql} AND status='done'
    )
    OR EXISTS(
      SELECT 1 FROM google_play_purchase_events
       WHERE family_id=${familyIdSql}
         AND product_type='subscription'
         AND granted_at IS NOT NULL
    )
    OR EXISTS(
      SELECT 1 FROM family_subscription
       WHERE family_id=${familyIdSql}
         AND (
           (
             provider='google_play'
             AND (
               NULLIF(TRIM(COALESCE(purchase_token_hash,'')),'') IS NOT NULL
               OR NULLIF(TRIM(COALESCE(latest_order_id,'')),'') IS NOT NULL
               OR NULLIF(TRIM(COALESCE(last_event_id,'')),'') IS NOT NULL
               OR acknowledged_at IS NOT NULL
             )
           )
           OR (
             provider='toss_web'
             AND (
               (
                 NULLIF(TRIM(COALESCE(latest_order_id,'')),'') IS NOT NULL
                 AND LOWER(TRIM(latest_order_id)) NOT LIKE 'trial:%'
               )
               OR (
                 NULLIF(TRIM(COALESCE(last_event_id,'')),'') IS NOT NULL
                 AND LOWER(TRIM(last_event_id)) NOT LIKE 'trial:%'
               )
             )
           )
         )
    )`;
}

async function loadWebBillingAccountDeletionTables(db: D1Database): Promise<Set<string>> {
  const { results } = await db.prepare(
    `SELECT name FROM sqlite_master
      WHERE type='table' AND name IN (
        'web_billing_checkout_sessions','web_billing_customers',
        'web_billing_charge_attempts','web_billing_trial_claims',
        'billing_provider_reservations','web_billing_financial_records',
        'web_billing_refund_records',
        'google_play_purchase_events'
      )`,
  ).all<{ name: string }>();
  return new Set((results ?? []).map((row) => String(row.name ?? "")));
}

async function assertWebBillingFinancialRetentionSchema(
  db: D1Database,
  tables: ReadonlySet<string>,
): Promise<void> {
  for (const table of [
    "web_billing_checkout_sessions",
    "web_billing_customers",
    "web_billing_charge_attempts",
    "web_billing_trial_claims",
    "billing_provider_reservations",
    "web_billing_financial_records",
    "web_billing_refund_records",
  ]) {
    if (!tables.has(table)) throw new Error("web_billing_financial_retention_schema_unavailable");
  }
  const { results } = await db.prepare(
    `SELECT name FROM pragma_table_info('web_billing_financial_records')`,
  ).all<{ name: string }>();
  const columns = new Set((results ?? []).map((row) => String(row.name ?? "")));
  if ([...WEB_BILLING_FINANCIAL_RECORD_COLUMNS].some((column) => !columns.has(column))) {
    throw new Error("web_billing_financial_retention_schema_unavailable");
  }
  const { results: refundResults } = await db.prepare(
    `SELECT name FROM pragma_table_info('web_billing_refund_records')`,
  ).all<{ name: string }>();
  const refundColumns = new Set((refundResults ?? []).map((row) => String(row.name ?? "")));
  if ([...WEB_BILLING_REFUND_RECORD_COLUMNS].some((column) => !refundColumns.has(column))) {
    throw new Error("web_billing_financial_retention_schema_unavailable");
  }
}

async function reconcileWebBillingBeforeAccountDeletion(
  env: Env,
  input: {
    familyIds: readonly string[];
    ownerUserId: string;
    now: Date;
    fetchImpl?: FetchLike;
  },
): Promise<void> {
  if (input.familyIds.length === 0) return;
  const ph = input.familyIds.map(() => "?").join(",");
  const nowPg = pgTs(input.now);

  // deletion claim이 기존 결제 mutation lease 뒤에만 생성되므로 아직 claim되지 않은
  // pending 행은 결제사 호출 없이 확정 실패로 닫을 수 있다.
  await env.DB.prepare(
    `UPDATE web_billing_charge_attempts
        SET status='failed',claim_token=NULL,claim_expires_at=NULL,
            payment_key_hash=NULL,error_code='ACCOUNT_DELETION_NO_CHARGE',
            completed_at=?,updated_at=?
      WHERE family_id IN (${ph}) AND status='pending'`,
  ).bind(nowPg, nowPg, ...input.familyIds).run();

  const { results } = await env.DB.prepare(
    `SELECT a.order_id,a.family_id,COALESCE(c.customer_key,s.customer_key) AS customer_key
       FROM web_billing_charge_attempts a
       LEFT JOIN web_billing_customers c ON c.family_id=a.family_id
       LEFT JOIN web_billing_checkout_sessions s
         ON s.id=a.checkout_session_id AND s.family_id=a.family_id
      WHERE a.family_id IN (${ph}) AND a.status IN ('processing','unknown')
      ORDER BY a.created_at ASC,a.order_id ASC
      LIMIT ?`,
  ).bind(
    ...input.familyIds,
    WEB_BILLING_ACCOUNT_DELETION_RECONCILIATION_LIMIT + 1,
  ).all<AccountDeletionUnsettledAttempt>();
  const unsettled = results ?? [];
  const reconciliationBatch = unsettled.slice(
    0,
    WEB_BILLING_ACCOUNT_DELETION_RECONCILIATION_LIMIT,
  );
  if (reconciliationBatch.length > 0) {
    const config = configuredWebBilling(env);
    if (!config) throw new Error("web_billing_account_deletion_config_unavailable");
    for (const attempt of reconciliationBatch) {
      const customerKey = String(attempt.customer_key ?? "");
      if (!customerKey) throw new Error("web_billing_account_deletion_customer_missing");
      const outcome = await settleWebBillingAttempt(env.DB, config, {
        orderId: attempt.order_id,
        familyId: attempt.family_id,
        customerKey,
        billingKey: "",
        now: input.now,
        fetchImpl: input.fetchImpl,
        allowCharge: false,
      });
      if (outcome.status === "busy" || outcome.status === "unknown") {
        throw new Error("web_billing_account_deletion_reconciliation_pending");
      }
      if (outcome.status === "done") {
        const providerState = await readBillingProviderReservation(
          env.DB,
          attempt.family_id,
          input.now,
        );
        if (providerState?.state === "conflict") {
          throw new Error("web_billing_account_deletion_provider_conflict_unresolved");
        }
        if (providerState?.provider === "google_play" && providerState.state === "active") {
          const recorded = await markBillingProviderConflict(env.DB, {
            familyId: attempt.family_id,
            incumbentProvider: "google_play",
            conflictingProvider: "toss_web",
            conflictRef: attempt.order_id,
            reason: "toss_charge_after_google_activation",
            now: input.now,
          });
          if (!recorded) throw new Error("web_billing_provider_conflict_guard_failed");
          throw new Error("web_billing_account_deletion_provider_conflict_unresolved");
        }
      }
    }
  }

  let deletionClaimedAt = nowPg;
  let hasStableDeletionEpoch = false;
  try {
    const claim = await env.DB.prepare(
      `SELECT created_at FROM account_deletion_jobs
        WHERE owner_user_id=? AND status IN ('claimed','running') LIMIT 1`,
    ).bind(input.ownerUserId).first<{ created_at: string }>();
    if (claim?.created_at) {
      deletionClaimedAt = claim.created_at;
      hasStableDeletionEpoch = true;
    }
  } catch {
    // 구형/테스트 스키마는 아래 금융 snapshot 시각을 fallback epoch로 사용한다.
  }
  if (!hasStableDeletionEpoch) {
    try {
      const snapshot = await env.DB.prepare(
        `SELECT MIN(f.detached_at) AS detached_at
           FROM web_billing_financial_records f
           JOIN web_billing_charge_attempts a ON a.order_id=f.provider_reference
          WHERE f.record_type='charge' AND f.provider='toss_web'
            AND a.family_id IN (${ph})`,
      ).bind(...input.familyIds).first<{ detached_at: string | null }>();
      if (snapshot?.detached_at) deletionClaimedAt = snapshot.detached_at;
    } catch {
      // 최초 snapshot 전에는 현재 호출 시각을 단일 대사 epoch로 사용한다.
    }
  }
  const { results: paidRows } = await env.DB.prepare(
    `SELECT order_id,family_id
       FROM web_billing_charge_attempts
      WHERE family_id IN (${ph}) AND status='done' AND refund_status<>'full'
        AND (provider_checked_at IS NULL
          OR datetime(substr(provider_checked_at,1,19))<datetime(substr(?,1,19)))
      ORDER BY COALESCE(provider_checked_at,completed_at,created_at) ASC,order_id ASC
      LIMIT ?`,
  ).bind(
    ...input.familyIds,
    deletionClaimedAt,
    WEB_BILLING_ACCOUNT_DELETION_RECONCILIATION_LIMIT + 1,
  ).all<{ order_id: string; family_id: string }>();
  const paidBatch = (paidRows ?? []).slice(0, WEB_BILLING_ACCOUNT_DELETION_RECONCILIATION_LIMIT);
  if (paidBatch.length > 0) {
    if (!configuredWebBilling(env)) {
      throw new Error("web_billing_account_deletion_config_unavailable");
    }
    for (const attempt of paidBatch) {
      let settlement: WebBillingRefundSettlement;
      try {
        settlement = await reconcileWebBillingRefund(env, {
          orderId: attempt.order_id,
          now: input.now,
          fetchImpl: input.fetchImpl,
        });
      } catch {
        throw new Error("web_billing_account_deletion_reconciliation_pending");
      }
      if (settlement.status === "paid") {
        const providerState = await readBillingProviderReservation(
          env.DB,
          attempt.family_id,
          input.now,
        );
        if (providerState?.state === "conflict") {
          throw new Error("web_billing_account_deletion_provider_conflict_unresolved");
        }
        if (providerState?.provider === "google_play" && providerState.state === "active") {
          const recorded = await markBillingProviderConflict(env.DB, {
            familyId: attempt.family_id,
            incumbentProvider: "google_play",
            conflictingProvider: "toss_web",
            conflictRef: attempt.order_id,
            reason: "toss_charge_after_google_activation",
            now: input.now,
          });
          if (!recorded) throw new Error("web_billing_provider_conflict_guard_failed");
          throw new Error("web_billing_account_deletion_provider_conflict_unresolved");
        }
      }
    }
  }
  if ((paidRows ?? []).length > WEB_BILLING_ACCOUNT_DELETION_RECONCILIATION_LIMIT) {
    throw new Error("web_billing_account_deletion_reconciliation_pending");
  }

  const remaining = await env.DB.prepare(
    `SELECT 1 AS present FROM web_billing_charge_attempts
      WHERE family_id IN (${ph}) AND status IN ('pending','processing','unknown') LIMIT 1`,
  ).bind(...input.familyIds).first<{ present: number }>();
  if (remaining) throw new Error("web_billing_account_deletion_reconciliation_pending");
}

async function snapshotWebBillingFinancialRecords(
  db: D1Database,
  input: {
    chargeFamilyIds: readonly string[];
    trialFamilyIds: readonly string[];
    ownerUserId: string;
    now: Date;
  },
): Promise<void> {
  const nowPg = pgTs(input.now);
  const retentionUntil = pgTs(addUtcCalendarYears(input.now, 5));
  const statements: D1PreparedStatement[] = [];
  if (input.chargeFamilyIds.length > 0) {
    const ph = input.chargeFamilyIds.map(() => "?").join(",");
    statements.push(db.prepare(
      `INSERT INTO web_billing_financial_records
         (record_id,record_type,provider,provider_reference,plan,amount,currency,
          charge_kind,record_status,period_start,period_end,payment_key_hash,
          detached_at,retention_until,created_at)
       SELECT 'charge:'||order_id,'charge','toss_web',order_id,plan,amount,'KRW',
              kind,'paid',period_start,period_end,payment_key_hash,?,?,created_at
         FROM web_billing_charge_attempts
        WHERE family_id IN (${ph}) AND status='done'
       ON CONFLICT(record_type,provider_reference) DO UPDATE SET
         plan=excluded.plan,amount=excluded.amount,currency=excluded.currency,
         charge_kind=excluded.charge_kind,record_status=excluded.record_status,
         period_start=excluded.period_start,period_end=excluded.period_end,
       payment_key_hash=excluded.payment_key_hash`,
    ).bind(nowPg, retentionUntil, ...input.chargeFamilyIds));
    // Google 구독은 Play가 반환한 주문 ID·기간과 서버가 검증해 저장한 토큰 해시가
    // 모두 있는 유료 행만 분리 보존한다. 무료체험·환불 대기·불완전 검증값은 제외한다.
    statements.push(db.prepare(
      `INSERT INTO web_billing_financial_records
         (record_id,record_type,provider,provider_reference,plan,amount,currency,
          charge_kind,record_status,period_start,period_end,payment_key_hash,
          detached_at,retention_until,created_at)
       SELECT 'charge:google:'||order_id,'charge','google_play',order_id,
              CASE base_plan_id WHEN 'monthly-2900' THEN 'month' ELSE 'year' END,
              CASE base_plan_id WHEN 'monthly-2900' THEN 4900 ELSE 39000 END,
              'KRW',CASE WHEN instr(order_id,'..')>0 THEN 'renewal' ELSE 'initial' END,
              'paid',json_extract(verification_result,'$.startTime'),
              json_extract(verification_result,'$.lineItems[0].expiryTime'),
              purchase_token_hash,?,?,COALESCE(granted_at,created_at)
         FROM google_play_purchase_events
        WHERE family_id IN (${ph})
          AND product_type='subscription'
          AND base_plan_id IN ('monthly-2900','annual-27840')
          AND status IN ('active','grace','cancelled','expired')
          AND granted_at IS NOT NULL
          AND NULLIF(TRIM(COALESCE(order_id,'')),'') IS NOT NULL
          AND length(order_id) BETWEEN 6 AND 128
          AND length(purchase_token_hash)=64
          AND purchase_token_hash NOT GLOB '*[^0-9a-f]*'
          AND json_type(verification_result,'$.lineItems[0].offerPhase.freeTrial') IS NULL
          AND datetime(substr(json_extract(verification_result,'$.startTime'),1,19))
              < datetime(substr(json_extract(verification_result,'$.lineItems[0].expiryTime'),1,19))
       ON CONFLICT(record_type,provider_reference) DO UPDATE SET
         plan=excluded.plan,amount=excluded.amount,currency=excluded.currency,
         charge_kind=excluded.charge_kind,record_status=excluded.record_status,
         period_start=excluded.period_start,period_end=excluded.period_end,
         payment_key_hash=excluded.payment_key_hash`,
    ).bind(nowPg, retentionUntil, ...input.chargeFamilyIds));
  }
  const trialPredicates: string[] = ["parent_id=?"];
  const trialBindings: string[] = [input.ownerUserId];
  if (input.trialFamilyIds.length > 0) {
    trialPredicates.push(`family_id IN (${input.trialFamilyIds.map(() => "?").join(",")})`);
    trialBindings.push(...input.trialFamilyIds);
  }
  statements.push(db.prepare(
    `INSERT INTO web_billing_financial_records
       (record_id,record_type,provider,provider_reference,plan,amount,currency,
        charge_kind,record_status,period_start,period_end,payment_key_hash,
        detached_at,retention_until,created_at)
      SELECT 'trial:'||checkout_session_id,'trial',provider,checkout_session_id,
            plan,0,'KRW',NULL,
            CASE status WHEN 'active' THEN 'trial_active'
                        WHEN 'converted' THEN 'trial_converted'
                        WHEN 'cancelled' THEN 'trial_cancelled'
                        ELSE 'trial_expired' END,
            claimed_at,trial_ends_at,NULL,?,?,claimed_at
       FROM web_billing_trial_claims
      WHERE ${trialPredicates.map((predicate) => `(${predicate})`).join(" OR ")}
     ON CONFLICT(record_type,provider_reference) DO UPDATE SET
       plan=excluded.plan,amount=excluded.amount,currency=excluded.currency,
       charge_kind=excluded.charge_kind,record_status=excluded.record_status,
       period_start=excluded.period_start,period_end=excluded.period_end,
       payment_key_hash=excluded.payment_key_hash`,
  ).bind(nowPg, retentionUntil, ...trialBindings));
  await db.batch(statements);
}

export async function revokeWebBillingBeforeAccountDeletion(
  env: Env,
  input: {
    ownerUserId: string;
    familyIds: readonly string[];
    now?: Date;
    fetchImpl?: FetchLike;
  },
): Promise<void> {
  const tables = await loadWebBillingAccountDeletionTables(env.DB);
  const hasOperationalTables = [
    "web_billing_checkout_sessions",
    "web_billing_customers",
    "web_billing_charge_attempts",
    "web_billing_trial_claims",
    "billing_provider_reservations",
    "google_play_purchase_events",
  ].some((table) => tables.has(table));
  if (!hasOperationalTables) return;

  const requestedFamilyIds = [...new Set(
    input.familyIds.map((value) => String(value ?? "").trim()).filter(Boolean),
  )];
  const familyFilter = requestedFamilyIds.length > 0
    ? ` OR family_id IN (${requestedFamilyIds.map(() => "?").join(",")})`
    : "";
  const customers = tables.has("web_billing_customers")
    ? (await env.DB.prepare(
      `SELECT family_id,parent_id,customer_key,billing_key_ciphertext,billing_key_iv,
              billing_key_version
         FROM web_billing_customers WHERE parent_id=?${familyFilter}`,
    ).bind(input.ownerUserId, ...requestedFamilyIds).all<AccountDeletionWebBillingCustomer>()).results ?? []
    : [];
  const chargeFamilyIds = [...new Set([
    ...requestedFamilyIds,
    ...customers.map((customer) => customer.family_id),
  ])];
  const ownedTrialFamilies = tables.has("web_billing_trial_claims")
    ? (await env.DB.prepare(
      `SELECT DISTINCT family_id FROM web_billing_trial_claims WHERE parent_id=?`,
    ).bind(input.ownerUserId).all<{ family_id: string }>()).results ?? []
    : [];
  const trialFamilyIds = [...new Set([
    ...chargeFamilyIds,
    ...ownedTrialFamilies.map((row) => String(row.family_id ?? "")).filter(Boolean),
  ])];

  let relevant = customers.length > 0 || ownedTrialFamilies.length > 0;
  if (!relevant && chargeFamilyIds.length > 0 && tables.has("web_billing_charge_attempts")) {
    const ph = chargeFamilyIds.map(() => "?").join(",");
    relevant = Boolean(await env.DB.prepare(
      `SELECT 1 AS present FROM web_billing_charge_attempts
        WHERE family_id IN (${ph}) AND status IN ('pending','processing','unknown','done') LIMIT 1`,
    ).bind(...chargeFamilyIds).first<{ present: number }>());
  }
  if (!relevant && trialFamilyIds.length > 0 && tables.has("web_billing_trial_claims")) {
    const ph = trialFamilyIds.map(() => "?").join(",");
    relevant = Boolean(await env.DB.prepare(
      `SELECT 1 AS present FROM web_billing_trial_claims
        WHERE family_id IN (${ph}) LIMIT 1`,
    ).bind(...trialFamilyIds).first<{ present: number }>());
  }
  if (!relevant && chargeFamilyIds.length > 0 && tables.has("google_play_purchase_events")) {
    const ph = chargeFamilyIds.map(() => "?").join(",");
    relevant = Boolean(await env.DB.prepare(
      `SELECT 1 AS present FROM google_play_purchase_events
        WHERE family_id IN (${ph})
          AND product_type='subscription'
          AND base_plan_id IN ('monthly-2900','annual-27840')
          AND status IN ('active','grace','cancelled','expired')
          AND granted_at IS NOT NULL
          AND NULLIF(TRIM(COALESCE(order_id,'')),'') IS NOT NULL
          AND json_type(verification_result,'$.lineItems[0].offerPhase.freeTrial') IS NULL
          AND datetime(substr(json_extract(verification_result,'$.startTime'),1,19))
              < datetime(substr(json_extract(verification_result,'$.lineItems[0].expiryTime'),1,19))
        LIMIT 1`,
    ).bind(...chargeFamilyIds).first<{ present: number }>());
  }
  if (!relevant) return;
  await assertWebBillingFinancialRetentionSchema(env.DB, tables);

  const now = input.now ?? new Date();
  const nowPg = pgTs(now);
  if (chargeFamilyIds.length > 0) {
    const ph = chargeFamilyIds.map(() => "?").join(",");
    const conflict = await env.DB.prepare(
      `SELECT 1 AS present FROM billing_provider_reservations
        WHERE family_id IN (${ph}) AND state='conflict' LIMIT 1`,
    ).bind(...chargeFamilyIds).first<{ present: number }>();
    if (conflict) throw new Error("web_billing_account_deletion_provider_conflict_unresolved");
  }
  await reconcileWebBillingBeforeAccountDeletion(env, {
    familyIds: chargeFamilyIds,
    ownerUserId: input.ownerUserId,
    now,
    fetchImpl: input.fetchImpl,
  });

  const hasRemoteKeys = customers.some((customer) =>
    customer.billing_key_ciphertext !== null
    || customer.billing_key_iv !== null
    || customer.billing_key_version !== null
  );
  const config = hasRemoteKeys ? configuredWebBilling(env) : null;
  if (hasRemoteKeys && !config) {
    throw new Error("web_billing_account_deletion_config_unavailable");
  }
  for (const customer of customers) {
    const hasCompleteKey = Boolean(
      customer.billing_key_ciphertext
      && customer.billing_key_iv
      && customer.billing_key_version === "v1",
    );
    const hasAnyKey = customer.billing_key_ciphertext !== null
      || customer.billing_key_iv !== null
      || customer.billing_key_version !== null;
    if (hasAnyKey && !hasCompleteKey) {
      throw new Error("web_billing_account_deletion_key_state_invalid");
    }
    if (hasCompleteKey) {
      await env.DB.prepare(
        `UPDATE web_billing_customers
            SET billing_key_revocation_status='pending',
                billing_key_revocation_attempts=0,billing_key_revocation_retry_at=?,
                billing_key_revocation_error=NULL,billing_key_revoked_at=NULL,updated_at=?
          WHERE family_id=? AND customer_key=?
            AND billing_key_ciphertext IS NOT NULL
            AND billing_key_iv IS NOT NULL AND billing_key_version='v1'
            AND (billing_key_revocation_status IS NULL OR billing_key_revocation_status='revoked')`,
      ).bind(nowPg, nowPg, customer.family_id, customer.customer_key).run();
      const revocation = await attemptWebBillingKeyRevocation(env, {
        familyId: customer.family_id,
        now,
        fetchImpl: input.fetchImpl,
        config,
        force: true,
      });
      if (revocation !== "revoked") {
        throw new Error("web_billing_account_deletion_revocation_pending");
      }
    }
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE web_billing_customers
            SET status='expired',billing_key_ciphertext=NULL,billing_key_iv=NULL,
                billing_key_version=NULL,next_charge_at=NULL,retry_after=NULL,
                cancelled_at=?,updated_at=?
          WHERE family_id=? AND customer_key=?`,
      ).bind(nowPg, nowPg, customer.family_id, customer.customer_key),
      env.DB.prepare(
        `UPDATE family_subscription
            SET status='expired',trial_ends_at=NULL,current_period_end=NULL,
                cancelled_at=?,last_event_id=?,last_event_at=?,updated_at=?
          WHERE family_id=? AND provider='toss_web'`,
      ).bind(
        nowPg,
        `account-delete:${customer.family_id}`,
        nowPg,
        nowPg,
        customer.family_id,
      ),
      env.DB.prepare(
        `UPDATE billing_provider_reservations
            SET state='released',conflicting_provider=NULL,conflict_ref=NULL,
                conflict_reason=NULL,resolution_status=NULL,updated_at=?
          WHERE family_id=? AND provider='toss_web' AND state IN ('reserved','active')`,
      ).bind(nowPg, customer.family_id),
      env.DB.prepare(
        `UPDATE web_billing_trial_claims SET status='cancelled',updated_at=?
          WHERE family_id=? AND status='active'`,
      ).bind(nowPg, customer.family_id),
    ]);
  }

  const trialPredicates = ["parent_id=?"];
  const trialBindings: string[] = [input.ownerUserId];
  if (trialFamilyIds.length > 0) {
    trialPredicates.push(`family_id IN (${trialFamilyIds.map(() => "?").join(",")})`);
    trialBindings.push(...trialFamilyIds);
  }
  await env.DB.prepare(
    `UPDATE web_billing_trial_claims SET status='cancelled',updated_at=?
      WHERE status='active' AND (${trialPredicates.join(" OR ")})`,
  ).bind(nowPg, ...trialBindings).run();
  await snapshotWebBillingFinancialRecords(env.DB, {
    chargeFamilyIds,
    trialFamilyIds,
    ownerUserId: input.ownerUserId,
    now,
  });
}

export async function cleanupWebBillingFinancialRecords(
  db: D1Database,
  now = new Date(),
  limit = WEB_BILLING_FINANCIAL_CLEANUP_LIMIT,
): Promise<number> {
  const requestedLimit = Number.isFinite(limit)
    ? Math.trunc(limit)
    : WEB_BILLING_FINANCIAL_CLEANUP_LIMIT;
  const safeLimit = Math.max(1, Math.min(
    WEB_BILLING_FINANCIAL_CLEANUP_LIMIT,
    requestedLimit,
  ));
  const nowPg = pgTs(now);
  const results = await db.batch([
    db.prepare(
      `DELETE FROM web_billing_financial_records
        WHERE record_id IN (
          SELECT record_id FROM web_billing_financial_records
           WHERE datetime(substr(retention_until,1,19))<datetime(substr(?,1,19))
           ORDER BY retention_until ASC,record_id ASC
           LIMIT ?
        )`,
    ).bind(nowPg, safeLimit),
    db.prepare(
      `DELETE FROM web_billing_refund_records
        WHERE record_id IN (
          SELECT record_id FROM web_billing_refund_records
           WHERE datetime(substr(retention_until,1,19))<datetime(substr(?,1,19))
           ORDER BY retention_until ASC,record_id ASC
           LIMIT ?
        )`,
    ).bind(nowPg, safeLimit),
  ]);
  return results.reduce(
    (removed, result) => removed + Number(result.meta?.changes ?? 0),
    0,
  );
}

export async function loadWebBillingRefundAttempt(
  db: D1Database,
  orderId: string,
): Promise<WebBillingRefundAttemptRow | null> {
  return db.prepare(
    `SELECT a.order_id,a.family_id,a.plan,a.amount,a.kind,a.period_start,a.period_end,
            a.status,a.payment_key_hash,a.refund_status,a.refunded_amount,a.refund_state_hash,
            a.provider_checked_at,a.refund_committed_at,a.refund_webhook_checked_at,
            a.refund_funnel_status,COALESCE(a.customer_key,s.customer_key,c.customer_key) AS customer_key
       FROM web_billing_charge_attempts a
       LEFT JOIN web_billing_customers c ON c.family_id=a.family_id
       LEFT JOIN web_billing_checkout_sessions s
         ON s.id=a.checkout_session_id AND s.family_id=a.family_id
      WHERE a.order_id=? AND a.status='done' LIMIT 1`,
  ).bind(orderId).first<WebBillingRefundAttemptRow>();
}

export async function claimWebBillingRefundWebhookLookup(
  db: D1Database,
  orderId: string,
  now: Date,
): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE web_billing_charge_attempts
        SET refund_webhook_checked_at=?
      WHERE order_id=? AND status='done' AND refund_status<>'full'
        AND (refund_webhook_checked_at IS NULL
          OR datetime(substr(refund_webhook_checked_at,1,19))<=datetime(substr(?,1,19)))`,
  ).bind(
    pgTs(now),
    orderId,
    pgTs(new Date(now.getTime() - WEB_BILLING_REFUND_WEBHOOK_COOLDOWN_MS)),
  ).run();
  return Number(result.meta?.changes ?? 0) === 1;
}

async function currentRefundEntitlementRevoked(
  db: D1Database,
  attempt: WebBillingRefundAttemptRow,
): Promise<boolean> {
  const row = await db.prepare(
    `SELECT 1 AS revoked
       FROM family_subscription fs
       JOIN web_billing_customers c ON c.family_id=fs.family_id
      WHERE fs.family_id=? AND fs.provider='toss_web' AND fs.latest_order_id=?
        AND fs.status='expired' AND fs.current_period_end=?
        AND c.last_paid_order_id=? AND c.status='expired' AND c.current_period_end=?
      LIMIT 1`,
  ).bind(
    attempt.family_id,
    attempt.order_id,
    attempt.period_start,
    attempt.order_id,
    attempt.period_start,
  ).first<{ revoked: number }>();
  return row?.revoked === 1;
}

async function currentRefundEntitlementCancelled(
  db: D1Database,
  attempt: WebBillingRefundAttemptRow,
): Promise<boolean> {
  const row = await db.prepare(
    `SELECT 1 AS cancelled
       FROM family_subscription fs
       JOIN web_billing_customers c ON c.family_id=fs.family_id
      WHERE fs.family_id=? AND fs.provider='toss_web' AND fs.latest_order_id=?
        AND fs.status='cancelled' AND fs.current_period_end=?
        AND c.last_paid_order_id=? AND c.status='cancel_at_period_end'
        AND c.current_period_end=? AND c.next_charge_at IS NULL
      LIMIT 1`,
  ).bind(
    attempt.family_id,
    attempt.order_id,
    attempt.period_end,
    attempt.order_id,
    attempt.period_end,
  ).first<{ cancelled: number }>();
  return row?.cancelled === 1;
}

async function flushWebBillingRefundFunnel(
  env: Env,
  attempt: WebBillingRefundAttemptRow,
  occurredAt: Date,
): Promise<boolean> {
  if (attempt.refund_funnel_status !== "pending") return false;
  const stored = await recordWebBillingFunnelEvent(env, {
    familyId: attempt.family_id,
    event: "refund",
    plan: attempt.plan,
    orderId: attempt.order_id,
    occurredAt,
  });
  if (!stored) return false;
  const updated = await env.DB.prepare(
    `UPDATE web_billing_charge_attempts SET refund_funnel_status='sent',updated_at=?
      WHERE order_id=? AND refund_status='full' AND refund_funnel_status='pending'`,
  ).bind(pgTs(occurredAt), attempt.order_id).run();
  return Number(updated.meta?.changes ?? 0) === 1;
}

function refundRecordStatement(
  db: D1Database,
  attempt: WebBillingRefundAttemptRow,
  paymentState: Extract<TossBillingPaymentState, { state: "partial_refund" | "refunded" }>,
  paymentKeyHash: string,
  refundStateHash: string,
  now: string,
  retentionUntil: string,
): D1PreparedStatement {
  return db.prepare(
    `INSERT OR IGNORE INTO web_billing_refund_records
       (record_id,provider_reference,provider,plan,amount,currency,charge_kind,
        refund_status,refunded_amount,balance_amount,payment_key_hash,refund_state_hash,
        transaction_count,provider_checked_at,retention_until,created_at)
     VALUES (?,?,'toss_web',?,?,'KRW',?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    `refund:${refundStateHash}`,
    attempt.order_id,
    attempt.plan,
    attempt.amount,
    attempt.kind,
    paymentState.state === "refunded" ? "full" : "partial",
    paymentState.refundedAmount,
    paymentState.balanceAmount,
    paymentKeyHash,
    refundStateHash,
    paymentState.transactionKeys.length,
    now,
    retentionUntil,
    now,
  );
}

export async function reconcileWebBillingRefund(
  env: Env,
  input: { orderId: string; now?: Date; fetchImpl?: FetchLike; lookupTimeoutMs?: number },
): Promise<WebBillingRefundSettlement> {
  const nowDate = input.now ?? new Date();
  const attempt = await loadWebBillingRefundAttempt(env.DB, input.orderId);
  if (!attempt) throw new Error("web_billing_refund_order_missing");
  if (attempt.refund_status === "full") {
    await flushWebBillingRefundFunnel(env, attempt, nowDate);
    return {
      status: "refunded",
      orderId: attempt.order_id,
      familyId: attempt.family_id,
      refundedAmount: attempt.amount,
      entitlementRevoked: await currentRefundEntitlementRevoked(env.DB, attempt),
    };
  }
  const config = configuredWebBilling(env);
  if (!config) throw new Error("web_billing_refund_unavailable");
  const paymentState = await findTossBillingPaymentStateByOrderId(config, {
    customerKey: attempt.customer_key ?? "",
    amount: attempt.amount,
    orderId: attempt.order_id,
  }, input.fetchImpl, input.lookupTimeoutMs);
  if (!paymentState) throw new Error("web_billing_refund_payment_missing");
  const paymentKeyHash = await hashWebBillingPaymentKey(paymentState.paymentKey);
  if (!attempt.payment_key_hash || paymentKeyHash !== attempt.payment_key_hash) {
    throw new Error("web_billing_refund_payment_mismatch");
  }
  const now = pgTs(nowDate);
  if (paymentState.state === "paid") {
    if (attempt.refund_status !== "none" || attempt.refunded_amount !== 0) {
      throw new Error("web_billing_refund_state_regressed");
    }
    await env.DB.prepare(
      `UPDATE web_billing_charge_attempts SET provider_checked_at=?,updated_at=?
        WHERE order_id=? AND status='done' AND payment_key_hash=? AND refund_status='none'`,
    ).bind(now, now, attempt.order_id, paymentKeyHash).run();
    return { status: "paid", orderId: attempt.order_id, familyId: attempt.family_id };
  }

  const refundStatus = paymentState.state === "refunded" ? "full" : "partial";
  const isFull = refundStatus === "full";
  const refundStateHash = await hashWebBillingRefundState(paymentState);
  const retentionUntil = pgTs(addUtcCalendarYears(nowDate, 5));
  const rawEvent = JSON.stringify({
    provider: WEB_BILLING_PROVIDER,
    kind: refundStatus === "full" ? "refund" : "partial_refund",
    plan: attempt.plan,
    orderId: attempt.order_id,
    refundedAmount: paymentState.refundedAmount,
  });
  const statements: D1PreparedStatement[] = [
    // 외부 조회 뒤 로컬 주문이 바뀌었거나 환불 누적액이 역행하면 첫 문장에서 batch를 중단한다.
    env.DB.prepare(
      `SELECT CASE WHEN EXISTS(
         SELECT 1 FROM web_billing_charge_attempts
          WHERE order_id=? AND family_id=? AND status='done' AND payment_key_hash=?
            AND refunded_amount<=?
            AND (refund_status<>'full' OR ?='full')
       ) THEN 1 ELSE json_extract('web_billing_refund_not_claimable','$') END AS ok`,
    ).bind(
      attempt.order_id,
      attempt.family_id,
      paymentKeyHash,
      paymentState.refundedAmount,
      refundStatus,
    ),
    refundRecordStatement(
      env.DB,
      attempt,
      paymentState,
      paymentKeyHash,
      refundStateHash,
      now,
      retentionUntil,
    ),
    env.DB.prepare(
      `UPDATE web_billing_charge_attempts
          SET refund_status=CASE WHEN refund_status='full' OR ?='full' THEN 'full' ELSE 'partial' END,
              refunded_amount=CASE WHEN refunded_amount>? THEN refunded_amount ELSE ? END,
              refund_state_hash=CASE WHEN refunded_amount>? THEN refund_state_hash ELSE ? END,
              provider_checked_at=?,refund_committed_at=COALESCE(refund_committed_at,?),updated_at=?
        WHERE order_id=? AND family_id=? AND status='done' AND payment_key_hash=?
          AND refunded_amount<=? AND (refund_status<>'full' OR ?='full')`,
    ).bind(
      refundStatus,
      paymentState.refundedAmount,
      paymentState.refundedAmount,
      paymentState.refundedAmount,
      refundStateHash,
      now,
      now,
      now,
      attempt.order_id,
      attempt.family_id,
      paymentKeyHash,
      paymentState.refundedAmount,
      refundStatus,
    ),
    // 승인 직후 finalize 전 환불도 다시 활성화되지 않도록 checkout과 자동청구를 먼저 닫는다.
    env.DB.prepare(
      `UPDATE web_billing_customers
          SET status='expired',next_charge_at=NULL,retry_after=NULL,cancelled_at=?,
              billing_key_revocation_status=CASE
                WHEN billing_key_ciphertext IS NOT NULL AND billing_key_iv IS NOT NULL
                 AND billing_key_version='v1' THEN 'pending' ELSE billing_key_revocation_status END,
              billing_key_revocation_attempts=CASE
                WHEN billing_key_ciphertext IS NOT NULL AND billing_key_iv IS NOT NULL
                 AND billing_key_version='v1' THEN 0 ELSE billing_key_revocation_attempts END,
              billing_key_revocation_retry_at=CASE
                WHEN billing_key_ciphertext IS NOT NULL AND billing_key_iv IS NOT NULL
                 AND billing_key_version='v1' THEN ? ELSE billing_key_revocation_retry_at END,
              billing_key_revocation_error=NULL,billing_key_revoked_at=NULL,updated_at=?
        WHERE family_id=? AND status='pending_charge'
          AND EXISTS(
            SELECT 1 FROM web_billing_charge_attempts a
             WHERE a.order_id=? AND a.family_id=web_billing_customers.family_id
               AND a.refund_status IN ('partial','full')
          )`,
    ).bind(now, now, now, attempt.family_id, attempt.order_id),
    env.DB.prepare(
      `UPDATE web_billing_checkout_sessions
          SET status='failed',claim_token=NULL,claim_expires_at=NULL,
              error_code=CASE WHEN ?='full' THEN 'WEB_BILLING_PAYMENT_REFUNDED'
                              ELSE 'WEB_BILLING_PARTIAL_REFUND_REVIEW' END,updated_at=?
        WHERE id=(SELECT checkout_session_id FROM web_billing_charge_attempts WHERE order_id=?)
          AND family_id=? AND status IN ('pending','processing','completed')`,
    ).bind(refundStatus, now, attempt.order_id, attempt.family_id),
    // 갱신/체험전환 승인 뒤 finalize 전에 환불되면 끝난 이전 권리만 만료시키고 재청구를 닫는다.
    env.DB.prepare(
      `UPDATE web_billing_customers
          SET status='expired',next_charge_at=NULL,retry_after=NULL,cancelled_at=?,
              last_order_id=?,
              billing_key_revocation_status=CASE
                WHEN billing_key_ciphertext IS NOT NULL AND billing_key_iv IS NOT NULL
                 AND billing_key_version='v1' THEN 'pending' ELSE billing_key_revocation_status END,
              billing_key_revocation_attempts=CASE
                WHEN billing_key_ciphertext IS NOT NULL AND billing_key_iv IS NOT NULL
                 AND billing_key_version='v1' THEN 0 ELSE billing_key_revocation_attempts END,
              billing_key_revocation_retry_at=CASE
                WHEN billing_key_ciphertext IS NOT NULL AND billing_key_iv IS NOT NULL
                 AND billing_key_version='v1' THEN ? ELSE billing_key_revocation_retry_at END,
              billing_key_revocation_error=NULL,billing_key_revoked_at=NULL,updated_at=?
        WHERE family_id=? AND COALESCE(last_paid_order_id,'')<>?
          AND EXISTS(
            SELECT 1 FROM web_billing_charge_attempts a
             WHERE a.order_id=? AND a.family_id=web_billing_customers.family_id
               AND a.status='done' AND a.refund_status IN ('partial','full')
               AND (
                 (a.kind='renewal' AND web_billing_customers.status IN ('active','past_due')
                   AND web_billing_customers.current_period_end=a.period_start)
                 OR
                 (a.kind='trial_conversion' AND web_billing_customers.status IN ('trial','past_due')
                   AND web_billing_customers.current_period_end IS NULL
                   AND web_billing_customers.trial_ends_at=a.period_start)
               )
          )`,
    ).bind(
      now,
      attempt.order_id,
      now,
      now,
      attempt.family_id,
      attempt.order_id,
      attempt.order_id,
    ),
    env.DB.prepare(
      `UPDATE family_subscription
          SET status='expired',cancelled_at=?,last_event_id=?,last_event_at=?,raw_event=?,updated_at=?
        WHERE family_id=? AND provider='toss_web' AND status<>'expired'
          AND EXISTS(
            SELECT 1 FROM web_billing_customers c
             WHERE c.family_id=family_subscription.family_id AND c.status='expired'
               AND c.last_order_id=? AND COALESCE(c.last_paid_order_id,'')<>?
          )
          AND (
            current_period_end=(SELECT period_start FROM web_billing_charge_attempts WHERE order_id=?)
            OR trial_ends_at=(SELECT period_start FROM web_billing_charge_attempts WHERE order_id=?)
          )`,
    ).bind(
      now,
      `unfinalized-refund:${refundStateHash}`,
      now,
      rawEvent,
      now,
      attempt.family_id,
      attempt.order_id,
      attempt.order_id,
      attempt.order_id,
      attempt.order_id,
    ),
    env.DB.prepare(
      `UPDATE billing_provider_reservations
          SET state='released',conflicting_provider=NULL,conflict_ref=NULL,
              conflict_reason=NULL,resolution_status=NULL,updated_at=?
        WHERE family_id=? AND provider='toss_web' AND state IN ('reserved','active')
          AND EXISTS(
            SELECT 1 FROM web_billing_customers c
             WHERE c.family_id=billing_provider_reservations.family_id AND c.status='expired'
               AND c.last_order_id=? AND COALESCE(c.last_paid_order_id,'')<>?
          )
          AND NOT EXISTS(
            SELECT 1 FROM family_subscription fs
             WHERE fs.family_id=billing_provider_reservations.family_id
               AND fs.provider='toss_web' AND fs.status<>'expired'
          )`,
    ).bind(now, attempt.family_id, attempt.order_id, attempt.order_id),
  ];

  if (isFull) {
    statements.push(
      env.DB.prepare(
        `UPDATE web_billing_customers
            SET status='expired',current_period_end=?,next_charge_at=NULL,retry_after=NULL,
                cancelled_at=?,billing_key_revocation_status=CASE
                  WHEN billing_key_ciphertext IS NOT NULL AND billing_key_iv IS NOT NULL
                   AND billing_key_version='v1' THEN 'pending' ELSE billing_key_revocation_status END,
                billing_key_revocation_attempts=CASE
                  WHEN billing_key_ciphertext IS NOT NULL AND billing_key_iv IS NOT NULL
                   AND billing_key_version='v1' THEN 0 ELSE billing_key_revocation_attempts END,
                billing_key_revocation_retry_at=CASE
                  WHEN billing_key_ciphertext IS NOT NULL AND billing_key_iv IS NOT NULL
                   AND billing_key_version='v1' THEN ? ELSE billing_key_revocation_retry_at END,
                billing_key_revocation_error=NULL,billing_key_revoked_at=NULL,updated_at=?
          WHERE family_id=? AND last_paid_order_id=? AND current_period_end=?
            AND status IN ('active','past_due','cancel_at_period_end')
            AND EXISTS(
              SELECT 1 FROM web_billing_charge_attempts a
               WHERE a.order_id=? AND a.refund_status='full' AND a.refunded_amount=a.amount
            )`,
      ).bind(
        attempt.period_start,
        now,
        now,
        now,
        attempt.family_id,
        attempt.order_id,
        attempt.period_end,
        attempt.order_id,
      ),
      env.DB.prepare(
        `UPDATE family_subscription
            SET status='expired',trial_ends_at=NULL,current_period_end=?,cancelled_at=?,
                last_event_id=?,last_event_at=?,raw_event=?,updated_at=?
          WHERE family_id=? AND provider='toss_web' AND latest_order_id=?
            AND current_period_end=?
            AND EXISTS(
              SELECT 1 FROM web_billing_customers c
               WHERE c.family_id=family_subscription.family_id
                 AND c.last_paid_order_id=? AND c.status='expired' AND c.current_period_end=?
            )`,
      ).bind(
        attempt.period_start,
        now,
        `refund:${refundStateHash}`,
        now,
        rawEvent,
        now,
        attempt.family_id,
        attempt.order_id,
        attempt.period_end,
        attempt.order_id,
        attempt.period_start,
      ),
      env.DB.prepare(
        `UPDATE web_billing_trial_claims SET status='expired',updated_at=?
          WHERE family_id=? AND converted_order_id=? AND status IN ('converted','expired')`,
      ).bind(now, attempt.family_id, attempt.order_id),
      env.DB.prepare(
        `UPDATE billing_provider_reservations
            SET state='released',conflicting_provider=NULL,conflict_ref=NULL,
                conflict_reason=NULL,resolution_status=NULL,updated_at=?
          WHERE family_id=? AND provider='toss_web' AND state IN ('reserved','active')
            AND reservation_ref IN (?,COALESCE((
              SELECT checkout_session_id FROM web_billing_charge_attempts WHERE order_id=?
            ),''))
            AND NOT EXISTS(
              SELECT 1 FROM family_subscription fs
               WHERE fs.family_id=billing_provider_reservations.family_id
                 AND fs.provider='toss_web' AND fs.status<>'expired'
            )`,
      ).bind(now, attempt.family_id, attempt.order_id, attempt.order_id),
      env.DB.prepare(
        `UPDATE billing_provider_reservations
            SET state='active',conflicting_provider=NULL,conflict_ref=NULL,
                conflict_reason=NULL,resolution_status=NULL,updated_at=?
          WHERE family_id=? AND provider='google_play' AND state='conflict'
            AND conflicting_provider='toss_web' AND conflict_ref=?
            AND resolution_status='refund_required'
            AND EXISTS(
              SELECT 1 FROM family_subscription fs
               WHERE fs.family_id=billing_provider_reservations.family_id
                 AND fs.provider='google_play'
                 AND ((LOWER(TRIM(COALESCE(fs.status,''))) IN ('active','grace','cancelled')
                       AND fs.current_period_end IS NOT NULL
                       AND datetime(substr(fs.current_period_end,1,19))>datetime('now'))
                   OR (LOWER(TRIM(COALESCE(fs.status,'')))='trial'
                       AND fs.trial_ends_at IS NOT NULL
                       AND datetime(substr(fs.trial_ends_at,1,19))>datetime('now')))
            )`,
      ).bind(now, attempt.family_id, attempt.order_id),
      env.DB.prepare(
        `UPDATE web_billing_charge_attempts SET refund_funnel_status='pending',updated_at=?
          WHERE order_id=? AND refund_status='full' AND refund_funnel_status<>'sent'
            AND refunded_amount=amount AND refund_state_hash=?`,
      ).bind(now, attempt.order_id, refundStateHash),
    );
  } else {
    statements.push(
      env.DB.prepare(
        `UPDATE web_billing_customers
            SET status='cancel_at_period_end',next_charge_at=NULL,retry_after=NULL,cancelled_at=?,
                billing_key_revocation_status=CASE
                  WHEN billing_key_ciphertext IS NOT NULL AND billing_key_iv IS NOT NULL
                   AND billing_key_version='v1' THEN 'pending' ELSE billing_key_revocation_status END,
                billing_key_revocation_attempts=CASE
                  WHEN billing_key_ciphertext IS NOT NULL AND billing_key_iv IS NOT NULL
                   AND billing_key_version='v1' THEN 0 ELSE billing_key_revocation_attempts END,
                billing_key_revocation_retry_at=CASE
                  WHEN billing_key_ciphertext IS NOT NULL AND billing_key_iv IS NOT NULL
                   AND billing_key_version='v1' THEN ? ELSE billing_key_revocation_retry_at END,
                billing_key_revocation_error=NULL,billing_key_revoked_at=NULL,updated_at=?
          WHERE family_id=? AND last_paid_order_id=? AND current_period_end=?
            AND status IN ('active','past_due','cancel_at_period_end')
            AND EXISTS(
              SELECT 1 FROM web_billing_charge_attempts a
               WHERE a.order_id=? AND a.refund_status='partial'
                 AND a.refunded_amount>0 AND a.refunded_amount<a.amount
            )`,
      ).bind(
        now,
        now,
        now,
        attempt.family_id,
        attempt.order_id,
        attempt.period_end,
        attempt.order_id,
      ),
      env.DB.prepare(
        `UPDATE family_subscription
            SET status='cancelled',cancelled_at=?,last_event_id=?,last_event_at=?,raw_event=?,updated_at=?
          WHERE family_id=? AND provider='toss_web' AND latest_order_id=?
            AND current_period_end=?
            AND EXISTS(
              SELECT 1 FROM web_billing_customers c
               WHERE c.family_id=family_subscription.family_id
                 AND c.last_paid_order_id=? AND c.status='cancel_at_period_end'
                 AND c.current_period_end=? AND c.next_charge_at IS NULL
            )`,
      ).bind(
        now,
        `partial-refund:${refundStateHash}`,
        now,
        rawEvent,
        now,
        attempt.family_id,
        attempt.order_id,
        attempt.period_end,
        attempt.order_id,
        attempt.period_end,
      ),
    );
  }

  statements.push(env.DB.prepare(
    `SELECT CASE WHEN
       EXISTS(
         SELECT 1 FROM web_billing_charge_attempts a
          WHERE a.order_id=? AND a.family_id=? AND a.payment_key_hash=?
            AND a.refund_status=? AND a.refunded_amount=? AND a.refund_state_hash=?
       )
       AND EXISTS(
         SELECT 1 FROM web_billing_refund_records r
          WHERE r.record_id=? AND r.provider_reference=? AND r.refund_status=?
            AND r.refunded_amount=? AND r.balance_amount=? AND r.payment_key_hash=?
       )
       AND NOT EXISTS(
         SELECT 1 FROM web_billing_checkout_sessions s
          WHERE s.id=(SELECT checkout_session_id FROM web_billing_charge_attempts WHERE order_id=?)
            AND s.status IN ('pending','processing','completed')
            AND NOT EXISTS(
              SELECT 1 FROM web_billing_customers c
               WHERE c.family_id=s.family_id AND c.last_paid_order_id=?
            )
       )
       AND (
         NOT EXISTS(
           SELECT 1 FROM web_billing_customers c
            WHERE c.family_id=? AND c.last_paid_order_id=?
         )
         OR (
           ?='full'
           AND EXISTS(
             SELECT 1 FROM web_billing_customers c
              WHERE c.family_id=? AND c.last_paid_order_id=? AND c.status='expired'
                AND c.current_period_end=? AND c.next_charge_at IS NULL AND c.retry_after IS NULL
           )
           AND EXISTS(
             SELECT 1 FROM family_subscription fs
              WHERE fs.family_id=? AND fs.provider='toss_web' AND fs.latest_order_id=?
                AND fs.status='expired' AND fs.current_period_end=?
           )
           AND NOT EXISTS(
             SELECT 1 FROM billing_provider_reservations bpr
              WHERE bpr.family_id=? AND bpr.provider='toss_web' AND bpr.state IN ('reserved','active')
           )
         )
         OR (
           ?='partial'
           AND EXISTS(
             SELECT 1 FROM web_billing_customers c
              WHERE c.family_id=? AND c.last_paid_order_id=? AND c.status='cancel_at_period_end'
                AND c.current_period_end=? AND c.next_charge_at IS NULL
           )
           AND EXISTS(
             SELECT 1 FROM family_subscription fs
              WHERE fs.family_id=? AND fs.provider='toss_web' AND fs.latest_order_id=?
                AND fs.status='cancelled' AND fs.current_period_end=?
           )
           AND EXISTS(
             SELECT 1 FROM billing_provider_reservations bpr
             WHERE bpr.family_id=? AND bpr.provider='toss_web' AND bpr.state='active'
                AND bpr.reservation_ref=?
           )
         )
         OR (
           EXISTS(
             SELECT 1 FROM web_billing_customers c
              WHERE c.family_id=? AND c.last_paid_order_id=? AND c.status='expired'
                AND c.current_period_end=? AND c.next_charge_at IS NULL AND c.retry_after IS NULL
           )
           AND EXISTS(
             SELECT 1 FROM family_subscription fs
              WHERE fs.family_id=? AND fs.provider='toss_web' AND fs.latest_order_id=?
                AND fs.status='expired' AND fs.current_period_end=?
           )
           AND NOT EXISTS(
             SELECT 1 FROM billing_provider_reservations bpr
             WHERE bpr.family_id=? AND bpr.provider='toss_web'
                AND bpr.state IN ('reserved','active')
           )
         )
         OR (
           EXISTS(
             SELECT 1 FROM family_subscription fs
              WHERE fs.family_id=? AND fs.provider='google_play'
                AND ((LOWER(TRIM(COALESCE(fs.status,''))) IN ('active','grace','cancelled')
                      AND fs.current_period_end IS NOT NULL
                      AND datetime(substr(fs.current_period_end,1,19))>datetime('now'))
                  OR (LOWER(TRIM(COALESCE(fs.status,'')))='trial'
                      AND fs.trial_ends_at IS NOT NULL
                      AND datetime(substr(fs.trial_ends_at,1,19))>datetime('now')))
           )
           AND EXISTS(
             SELECT 1 FROM billing_provider_reservations bpr
              WHERE bpr.family_id=? AND bpr.provider='google_play'
                AND (
                  (?='full' AND bpr.state='active')
                  OR (?='partial' AND bpr.state='conflict'
                    AND bpr.conflicting_provider='toss_web' AND bpr.conflict_ref=?
                    AND bpr.resolution_status='refund_required')
                )
           )
         )
       )
       AND (
         NOT EXISTS(
           SELECT 1 FROM billing_provider_reservations bpr
            WHERE bpr.family_id=? AND bpr.state='conflict'
              AND bpr.conflicting_provider='toss_web' AND bpr.conflict_ref=?
         )
         OR (
           ?='partial'
           AND EXISTS(
             SELECT 1 FROM billing_provider_reservations bpr
              WHERE bpr.family_id=? AND bpr.provider='google_play' AND bpr.state='conflict'
                AND bpr.conflicting_provider='toss_web' AND bpr.conflict_ref=?
                AND bpr.resolution_status='refund_required'
           )
           AND EXISTS(
             SELECT 1 FROM family_subscription fs
              WHERE fs.family_id=? AND fs.provider='google_play'
                AND ((LOWER(TRIM(COALESCE(fs.status,''))) IN ('active','grace','cancelled')
                      AND fs.current_period_end IS NOT NULL
                      AND datetime(substr(fs.current_period_end,1,19))>datetime('now'))
                  OR (LOWER(TRIM(COALESCE(fs.status,'')))='trial'
                      AND fs.trial_ends_at IS NOT NULL
                      AND datetime(substr(fs.trial_ends_at,1,19))>datetime('now')))
           )
         )
       )
     THEN 1 ELSE json_extract('web_billing_refund_finalize_guard_failed','$') END AS ok`,
  ).bind(
    attempt.order_id,
    attempt.family_id,
    paymentKeyHash,
    refundStatus,
    paymentState.refundedAmount,
    refundStateHash,
    `refund:${refundStateHash}`,
    attempt.order_id,
    refundStatus,
    paymentState.refundedAmount,
    paymentState.balanceAmount,
    paymentKeyHash,
    attempt.order_id,
    attempt.order_id,
    attempt.family_id,
    attempt.order_id,
    refundStatus,
    attempt.family_id,
    attempt.order_id,
    attempt.period_start,
    attempt.family_id,
    attempt.order_id,
    attempt.period_start,
    attempt.family_id,
    refundStatus,
    attempt.family_id,
    attempt.order_id,
    attempt.period_end,
    attempt.family_id,
    attempt.order_id,
    attempt.period_end,
    attempt.family_id,
    attempt.order_id,
    attempt.family_id,
    attempt.order_id,
    attempt.period_end,
    attempt.family_id,
    attempt.order_id,
    attempt.period_end,
    attempt.family_id,
    attempt.family_id,
    attempt.family_id,
    refundStatus,
    refundStatus,
    attempt.order_id,
    attempt.family_id,
    attempt.order_id,
    refundStatus,
    attempt.family_id,
    attempt.order_id,
    attempt.family_id,
  ));

  await env.DB.batch(statements);
  const latest = await loadWebBillingRefundAttempt(env.DB, attempt.order_id);
  if (!latest) throw new Error("web_billing_refund_finalize_guard_failed");
  const entitlementRevoked = isFull
    ? await currentRefundEntitlementRevoked(env.DB, latest)
    : false;
  const entitlementCancelled = !isFull
    ? await currentRefundEntitlementCancelled(env.DB, latest)
    : false;
  const unfinalizedEntitlementExpired = await env.DB.prepare(
    `SELECT 1 AS expired FROM family_subscription
      WHERE family_id=? AND provider='toss_web' AND status='expired'
        AND last_event_id=? LIMIT 1`,
  ).bind(
    attempt.family_id,
    `unfinalized-refund:${refundStateHash}`,
  ).first<{ expired: number }>();
  if (isFull && latest.refund_funnel_status === "pending") {
    await flushWebBillingRefundFunnel(env, latest, nowDate);
  }
  if (entitlementRevoked || entitlementCancelled) {
    const status = entitlementRevoked ? "expired" : "cancelled";
    await notifyPg(env, attempt.family_id, "family_subscription", "UPDATE", {
      family_id: attempt.family_id,
      status,
      provider: WEB_BILLING_PROVIDER,
      current_period_end: entitlementRevoked ? attempt.period_start : attempt.period_end,
    });
  } else if (unfinalizedEntitlementExpired?.expired === 1) {
    await notifyPg(env, attempt.family_id, "family_subscription", "UPDATE", {
      family_id: attempt.family_id,
      status: "expired",
      provider: WEB_BILLING_PROVIDER,
      current_period_end: attempt.period_start,
    });
  }
  return isFull
    ? {
      status: "refunded",
      orderId: attempt.order_id,
      familyId: attempt.family_id,
      refundedAmount: paymentState.refundedAmount,
      entitlementRevoked,
    }
    : {
      status: "partial_refund",
      orderId: attempt.order_id,
      familyId: attempt.family_id,
      refundedAmount: paymentState.refundedAmount,
    };
}

export async function processWebBillingRefundReconciliations(
  env: Env,
  options: { limit?: number; now?: Date; fetchImpl?: FetchLike } = {},
): Promise<{ configured: boolean; checked: number; paid: number; partial: number; refunded: number; unknown: number }> {
  const config = configuredWebBilling(env);
  if (!config) return { configured: false, checked: 0, paid: 0, partial: 0, refunded: 0, unknown: 0 };
  const now = options.now ?? new Date();
  const limit = Math.max(1, Math.min(5, Math.trunc(options.limit ?? 1)));
  const priorityCutoff = pgTs(new Date(now.getTime() - 60 * 60 * 1000));
  const historicalCutoff = pgTs(new Date(
    now.getTime() - WEB_BILLING_REFUND_RECONCILIATION_INTERVAL_MS,
  ));
  const recentCompletionCutoff = pgTs(new Date(now.getTime() - 48 * 60 * 60 * 1000));
  const scanLimit = Math.min(25, limit * 5);
  const { results } = await env.DB.prepare(
    `SELECT a.order_id,a.family_id,a.provider_checked_at
       FROM web_billing_charge_attempts a
      WHERE a.status='done' AND a.refund_status<>'full'
        AND (
          (
            (
              EXISTS(
                SELECT 1 FROM billing_provider_reservations bpr
                 WHERE bpr.family_id=a.family_id AND bpr.provider='google_play'
                   AND bpr.state='conflict' AND bpr.conflicting_provider='toss_web'
                   AND bpr.conflict_ref=a.order_id AND bpr.resolution_status='refund_required'
              )
              OR EXISTS(
                SELECT 1 FROM web_billing_customers c
                 WHERE c.family_id=a.family_id AND (
                   c.last_paid_order_id=a.order_id
                   OR (a.kind='initial' AND c.status='pending_charge')
                   OR (a.kind='renewal' AND c.status IN ('active','past_due')
                     AND c.current_period_end=a.period_start
                     AND COALESCE(c.last_paid_order_id,'')<>a.order_id)
                   OR (a.kind='trial_conversion' AND c.status IN ('trial','past_due')
                     AND c.current_period_end IS NULL AND c.trial_ends_at=a.period_start)
                 )
              )
              OR datetime(substr(COALESCE(a.completed_at,a.created_at),1,19))
                   >=datetime(substr(?,1,19))
            )
            AND (a.provider_checked_at IS NULL
              OR datetime(substr(a.provider_checked_at,1,19))<=datetime(substr(?,1,19)))
          )
          OR a.provider_checked_at IS NULL
          OR datetime(substr(a.provider_checked_at,1,19))<=datetime(substr(?,1,19))
        )
      ORDER BY COALESCE(a.provider_checked_at,a.completed_at,a.created_at) ASC,
        CASE
        WHEN EXISTS(
          SELECT 1 FROM billing_provider_reservations bpr
           WHERE bpr.family_id=a.family_id AND bpr.provider='google_play'
             AND bpr.state='conflict' AND bpr.conflicting_provider='toss_web'
             AND bpr.conflict_ref=a.order_id AND bpr.resolution_status='refund_required'
        ) THEN 0
        WHEN EXISTS(
          SELECT 1 FROM web_billing_customers c
           WHERE c.family_id=a.family_id AND (
             (a.kind='initial' AND c.status='pending_charge')
             OR (a.kind='renewal' AND c.status IN ('active','past_due')
               AND c.current_period_end=a.period_start
               AND COALESCE(c.last_paid_order_id,'')<>a.order_id)
             OR (a.kind='trial_conversion' AND c.status IN ('trial','past_due')
               AND c.current_period_end IS NULL AND c.trial_ends_at=a.period_start)
           )
        ) THEN 1
        WHEN EXISTS(
          SELECT 1 FROM web_billing_customers c
           WHERE c.family_id=a.family_id AND c.last_paid_order_id=a.order_id
        ) THEN 2 ELSE 3 END,
        a.order_id ASC
      LIMIT ?`,
  ).bind(
    recentCompletionCutoff,
    priorityCutoff,
    historicalCutoff,
    scanLimit,
  ).all<{ order_id: string; family_id: string; provider_checked_at: string | null }>();
  let checked = 0;
  let paid = 0;
  let partial = 0;
  let refunded = 0;
  let unknown = 0;
  for (const candidate of results ?? []) {
    if (checked >= limit) break;
    const scopes = await loadFamilyNotificationMutationScopes(env.DB, candidate.family_id);
    if (!scopes) continue;
    const leaseResult = await acquireAccountMutationLeases(env.DB, scopes);
    if (leaseResult.status !== "acquired") continue;
    try {
      const claimed = await env.DB.prepare(
        `UPDATE web_billing_charge_attempts SET provider_checked_at=?,updated_at=?
          WHERE order_id=? AND status='done' AND refund_status<>'full'
            AND ((? IS NULL AND provider_checked_at IS NULL) OR provider_checked_at=?)`,
      ).bind(
        pgTs(now),
        pgTs(now),
        candidate.order_id,
        candidate.provider_checked_at,
        candidate.provider_checked_at,
      ).run();
      if (Number(claimed.meta?.changes ?? 0) !== 1) continue;
      checked += 1;
      try {
        const result = await reconcileWebBillingRefund(env, {
          orderId: candidate.order_id,
          now,
          fetchImpl: options.fetchImpl,
        });
        if (result.status === "paid") paid += 1;
        else if (result.status === "partial_refund") partial += 1;
        else refunded += 1;
      } catch {
        unknown += 1;
      }
    } finally {
      await releaseAccountMutationLeases(env.DB, leaseResult.leases);
    }
  }
  return { configured: true, checked, paid, partial, refunded, unknown };
}

/** 분석 저장 실패는 결제 정본 대사와 분리해 별도 bounded 작업으로 재시도한다. */
export async function processWebBillingRefundFunnelRetries(
  env: Env,
  options: { now?: Date } = {},
): Promise<{ configured: boolean; checked: number; sent: number }> {
  if (!isPremiumFunnelConfigured(env.PREMIUM_FUNNEL_HASH_SECRET)) {
    return { configured: false, checked: 0, sent: 0 };
  }
  const candidate = await env.DB.prepare(
    `SELECT order_id FROM web_billing_charge_attempts
      WHERE status='done' AND refund_status='full' AND refund_funnel_status='pending'
      ORDER BY refund_committed_at ASC,order_id ASC LIMIT 1`,
  ).first<{ order_id: string }>();
  if (!candidate) return { configured: true, checked: 0, sent: 0 };
  const attempt = await loadWebBillingRefundAttempt(env.DB, candidate.order_id);
  if (!attempt) return { configured: true, checked: 1, sent: 0 };
  const sent = await flushWebBillingRefundFunnel(env, attempt, options.now ?? new Date());
  return { configured: true, checked: 1, sent: sent ? 1 : 0 };
}

function validPlan(value: unknown): value is WebBillingPlan {
  return value === "month" || value === "year";
}

function attemptOrderName(plan: WebBillingPlan): string {
  return plan === "month" ? "혜니캘린더 프리미엄 월간" : "혜니캘린더 프리미엄 연간";
}

function attemptClaimExpiry(now: Date): string {
  return pgTs(new Date(now.getTime() + 2 * 60 * 1000));
}

function isAtOrBefore(value: string | null, now: Date): boolean {
  if (!value) return true;
  const parsed = Date.parse(pgToIso(value));
  return !Number.isFinite(parsed) || parsed <= now.getTime();
}

export async function loadWebBillingCustomer(
  db: D1Database,
  familyId: string,
): Promise<WebBillingCustomerRow | null> {
  const row = await db.prepare(
    `SELECT family_id,parent_id,customer_key,billing_key_ciphertext,billing_key_iv,
            billing_key_version,billing_key_revocation_status,billing_key_revocation_attempts,
            billing_key_revocation_retry_at,billing_key_revocation_error,billing_key_revoked_at,
            plan,status,trial_ends_at,current_period_end,next_charge_at,retry_after,
            failure_count,cancelled_at,last_order_id,last_paid_order_id
       FROM web_billing_customers WHERE family_id=? LIMIT 1`,
  ).bind(familyId).first<WebBillingCustomerRow>();
  return row && validPlan(row.plan) ? row : null;
}

export async function isWebBillingTrialEligible(
  db: D1Database,
  familyId: string,
): Promise<boolean> {
  const row = await db.prepare(
    `SELECT CASE WHEN ${webBillingLifetimeUseSql("?")}
      THEN 0 ELSE 1 END AS eligible`,
  ).bind(familyId, familyId, familyId, familyId).first<{ eligible: number }>();
  if (!row) throw new Error("web_billing_trial_state_unavailable");
  return Number(row.eligible) === 1;
}

export async function insertChargeAttempt(
  db: D1Database,
  input: {
    orderId: string;
    familyId: string;
    checkoutSessionId: string | null;
    customerKey: string;
    plan: WebBillingPlan;
    kind: "initial" | "trial_conversion" | "renewal";
    periodStart: Date;
    periodEnd: Date;
    now: Date;
    expectedCustomer?: {
      customerKey: string;
      currentPeriodEnd: string;
    };
  },
): Promise<void> {
  const plan = WEB_BILLING_PLANS[input.plan];
  const commonBindings = [
    input.orderId,
    input.familyId,
    input.checkoutSessionId,
    input.plan,
    plan.amount,
    input.kind,
    input.customerKey,
    pgTs(input.periodStart),
    pgTs(input.periodEnd),
    pgTs(input.now),
    pgTs(input.now),
  ] as const;
  if (input.kind === "renewal" || input.kind === "trial_conversion") {
    if (!input.expectedCustomer) throw new Error("web_billing_renewal_customer_guard_missing");
    await db.prepare(
      `INSERT OR IGNORE INTO web_billing_charge_attempts
         (order_id,family_id,checkout_session_id,plan,amount,kind,customer_key,period_start,period_end,
          status,created_at,updated_at)
       SELECT ?,?,?,?,?,?,?,?,?, 'pending',?,?
        WHERE EXISTS(
          SELECT 1 FROM web_billing_customers
           WHERE family_id=? AND customer_key=?
             AND (
               (?='trial_conversion' AND status IN ('trial','past_due')
                 AND current_period_end IS NULL AND trial_ends_at=?)
               OR (?='renewal' AND status IN ('active','past_due') AND current_period_end=?)
             )
             AND billing_key_ciphertext IS NOT NULL
             AND billing_key_iv IS NOT NULL
             AND billing_key_version='v1'
        )`,
    ).bind(
      ...commonBindings,
      input.familyId,
      input.expectedCustomer.customerKey,
      input.kind,
      input.expectedCustomer.currentPeriodEnd,
      input.kind,
      input.expectedCustomer.currentPeriodEnd,
    ).run();
    return;
  }
  await db.prepare(
    `INSERT OR IGNORE INTO web_billing_charge_attempts
       (order_id,family_id,checkout_session_id,plan,amount,kind,customer_key,period_start,period_end,
        status,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?, 'pending',?,?)`,
  ).bind(...commonBindings).run();
}

async function readChargeAttempt(db: D1Database, orderId: string): Promise<ChargeAttemptRow | null> {
  return db.prepare(
    `SELECT order_id,family_id,checkout_session_id,plan,amount,kind,period_start,period_end,
            status,claim_token,claim_expires_at,error_code
       FROM web_billing_charge_attempts WHERE order_id=? LIMIT 1`,
  ).bind(orderId).first<ChargeAttemptRow>();
}

async function claimInitialCheckoutForReconciliation(
  db: D1Database,
  candidate: InitialReconciliationCandidate,
  now: Date,
): Promise<string | null> {
  const token = crypto.randomUUID();
  const nowPg = pgTs(now);
  const result = await db.prepare(
    `UPDATE web_billing_checkout_sessions
        SET status='processing', claim_token=?, claim_expires_at=?, updated_at=?
      WHERE id=? AND family_id=? AND customer_key=?
        AND (
          status='pending'
          OR (
            status='processing'
            AND (claim_expires_at IS NULL
              OR datetime(substr(claim_expires_at,1,19))<=datetime(substr(?,1,19)))
          )
        )
        AND EXISTS(
          SELECT 1 FROM web_billing_charge_attempts a
           WHERE a.order_id=?
             AND a.checkout_session_id=web_billing_checkout_sessions.id
             AND a.family_id=web_billing_checkout_sessions.family_id
             AND a.kind='initial'
             AND (
               a.status IN ('pending','unknown','done','failed')
               OR (
                 a.status='processing'
                 AND (a.claim_expires_at IS NULL
                   OR datetime(substr(a.claim_expires_at,1,19))<=datetime(substr(?,1,19)))
               )
             )
        )`,
  ).bind(
    token,
    attemptClaimExpiry(now),
    nowPg,
    candidate.checkout_session_id,
    candidate.family_id,
    candidate.customer_key,
    nowPg,
    candidate.order_id,
    nowPg,
  ).run();
  return Number(result.meta?.changes ?? 0) === 1 ? token : null;
}

async function releaseInitialCheckoutReconciliation(
  db: D1Database,
  sessionId: string,
  claimToken: string,
  errorCode: string | null,
  now: Date,
): Promise<void> {
  await db.prepare(
    `UPDATE web_billing_checkout_sessions
        SET status='pending', claim_token=NULL, claim_expires_at=NULL,
            error_code=?, updated_at=?
      WHERE id=? AND claim_token=? AND status='processing'`,
  ).bind(errorCode, pgTs(now), sessionId, claimToken).run();
}

async function failInitialWebBilling(
  env: Env,
  input: {
    sessionId: string;
    sessionClaimToken: string;
    familyId: string;
    customerKey: string;
    errorCode: string;
    now: Date;
  },
): Promise<boolean> {
  const nowPg = pgTs(input.now);
  const batch = await env.DB.batch([
    env.DB.prepare(
      `UPDATE web_billing_customers
          SET status='expired', billing_key_ciphertext=NULL, billing_key_iv=NULL,
              billing_key_version=NULL, next_charge_at=NULL, retry_after=NULL, updated_at=?
        WHERE family_id=? AND customer_key=? AND status='pending_charge'`,
    ).bind(nowPg, input.familyId, input.customerKey),
    env.DB.prepare(
      `UPDATE web_billing_checkout_sessions
          SET status='failed', claim_token=NULL, claim_expires_at=NULL,
              error_code=?, updated_at=?
        WHERE id=? AND family_id=? AND customer_key=?
          AND claim_token=? AND status='processing'`,
    ).bind(
      input.errorCode,
      nowPg,
      input.sessionId,
      input.familyId,
      input.customerKey,
      input.sessionClaimToken,
    ),
  ]);
  return Number(batch[0]?.meta?.changes ?? 0) === 1
    && Number(batch[1]?.meta?.changes ?? 0) === 1;
}

async function claimChargeAttempt(
  db: D1Database,
  orderId: string,
  familyId: string,
  now: Date,
): Promise<{ token: string; row: ChargeAttemptRow } | null> {
  const token = crypto.randomUUID();
  const nowPg = pgTs(now);
  const result = await db.prepare(
    `UPDATE web_billing_charge_attempts
        SET status='processing', claim_token=?, claim_expires_at=?, updated_at=?
      WHERE order_id=? AND family_id=?
        AND (
          status IN ('pending','unknown')
          OR (status='processing' AND datetime(substr(claim_expires_at,1,19))<=datetime(substr(?,1,19)))
        )`,
  ).bind(token, attemptClaimExpiry(now), nowPg, orderId, familyId, nowPg).run();
  if (Number(result.meta?.changes ?? 0) !== 1) return null;
  const row = await readChargeAttempt(db, orderId);
  return row ? { token, row } : null;
}

async function markAttempt(
  db: D1Database,
  orderId: string,
  claimToken: string,
  outcome: Exclude<WebBillingAttemptOutcome, { status: "busy" }>,
  now: Date,
): Promise<void> {
  const completedAt = outcome.status === "done" || outcome.status === "failed" ? pgTs(now) : null;
  const result = await db.prepare(
    `UPDATE web_billing_charge_attempts
        SET status=?, payment_key_hash=?, error_code=?, completed_at=?,
            claim_token=NULL, claim_expires_at=NULL, updated_at=?
      WHERE order_id=? AND claim_token=? AND status='processing'`,
  ).bind(
    outcome.status,
    outcome.status === "done" ? outcome.paymentKeyHash : null,
    outcome.status === "done" ? null : outcome.errorCode,
    completedAt,
    pgTs(now),
    orderId,
    claimToken,
  ).run();
  if (Number(result.meta?.changes ?? 0) !== 1) {
    throw new Error("web_billing_attempt_claim_lost");
  }
}

async function lookupPaidOrder(
  config: TossWebBillingConfig,
  row: ChargeAttemptRow,
  customerKey: string,
  fetchImpl: FetchLike,
): Promise<{ paymentKey: string } | null> {
  return findTossPaymentByOrderId(config, {
    customerKey,
    amount: row.amount,
    orderId: row.order_id,
  }, fetchImpl);
}

export async function settleWebBillingAttempt(
  db: D1Database,
  config: TossWebBillingConfig,
  input: {
    orderId: string;
    familyId: string;
    customerKey: string;
    billingKey: string;
    now: Date;
    fetchImpl?: FetchLike;
    allowCharge?: boolean;
  },
): Promise<WebBillingAttemptOutcome> {
  const existing = await readChargeAttempt(db, input.orderId);
  if (!existing || existing.family_id !== input.familyId) throw new Error("web_billing_attempt_missing");
  if (existing.status === "done") {
    return { status: "done", paymentKeyHash: "already_recorded" };
  }
  if (existing.status === "failed") {
    return { status: "failed", errorCode: existing.error_code ?? "TOSS_REQUEST_FAILED" };
  }

  const claim = await claimChargeAttempt(db, input.orderId, input.familyId, input.now);
  if (!claim) return { status: "busy" };
  const fetchImpl = input.fetchImpl ?? fetch;

  let outcome: Exclude<WebBillingAttemptOutcome, { status: "busy" }>;
  try {
    let paid: { paymentKey: string } | null = null;
    if (existing.status === "unknown" || existing.status === "processing") {
      paid = await lookupPaidOrder(config, claim.row, input.customerKey, fetchImpl);
    }
    if (!paid && input.allowCharge === false) {
      outcome = { status: "failed", errorCode: "BILLING_PROVIDER_CONFLICT_NO_CHARGE" };
      await markAttempt(db, input.orderId, claim.token, outcome, input.now);
      return outcome;
    }
    if (!paid) {
      try {
        paid = await chargeTossBillingKey(config, {
          billingKey: input.billingKey,
          customerKey: input.customerKey,
          amount: claim.row.amount,
          orderId: claim.row.order_id,
          orderName: attemptOrderName(claim.row.plan),
        }, fetchImpl);
      } catch (error) {
        // POST 응답 유실·5xx·중복 주문도 주문 조회를 통해 정본을 다시 확인한다.
        try {
          paid = await lookupPaidOrder(config, claim.row, input.customerKey, fetchImpl);
        } catch {
          paid = null;
        }
        if (!paid) {
          const tossError = error instanceof TossWebBillingRequestError ? error : null;
          const orderMayExist = tossError?.code === "DUPLICATED_ORDER_ID"
            || tossError?.code === "ALREADY_PROCESSED_PAYMENT";
          outcome = tossError?.outcomeUnknown || orderMayExist
            ? { status: "unknown", errorCode: tossError.code }
            : { status: "failed", errorCode: safeTossErrorCode(tossError?.code) };
          await markAttempt(db, input.orderId, claim.token, outcome, input.now);
          return outcome;
        }
      }
    }
    outcome = {
      status: "done",
      paymentKeyHash: await hashWebBillingPaymentKey(paid.paymentKey),
    };
  } catch (error) {
    const tossError = error instanceof TossWebBillingRequestError ? error : null;
    outcome = {
      status: "unknown",
      errorCode: safeTossErrorCode(tossError?.code, "TOSS_RECONCILIATION_FAILED"),
    };
  }
  await markAttempt(db, input.orderId, claim.token, outcome, input.now);
  return outcome;
}

function productId(plan: WebBillingPlan): string {
  return plan === "month" ? "hyeni_premium_monthly" : "hyeni_premium_annual";
}

async function recordWebBillingFunnelEvent(
  env: Env,
  input: {
    familyId: string;
    event: "trial_start" | "entitlement_activated" | "renewal" | "refund";
    plan: WebBillingPlan;
    orderId: string;
    occurredAt: Date;
  },
): Promise<boolean> {
  const secret = env.PREMIUM_FUNNEL_HASH_SECRET;
  if (!secret) return false;
  try {
    const eventId = await createServerPremiumFunnelEventId(
      secret,
      [WEB_BILLING_PROVIDER, input.familyId, input.event, input.orderId].join(":"),
    );
    const result = await recordServerPremiumFunnelEvent(env, {
      event_id: eventId,
      family_id: input.familyId,
      event: input.event,
      provider: "toss_payments",
      plan: input.plan,
      occurred_at: input.occurredAt.toISOString(),
    }, input.occurredAt);
    return result.stored;
  } catch {
    // 전환 분석은 결제 정본을 절대 막지 않는 fail-soft 보조 기록이다.
    return false;
  }
}

function familyTrialSubscriptionUpsert(
  db: D1Database,
  input: {
    familyId: string;
    customerKey: string;
    plan: WebBillingPlan;
    sessionId: string;
    trialEventId: string;
    trialEndsAt: string;
    now: string;
  },
): D1PreparedStatement {
  const rawEvent = JSON.stringify({
    provider: WEB_BILLING_PROVIDER,
    kind: "trial_start",
    plan: input.plan,
  });
  return db.prepare(
    `INSERT INTO family_subscription
       (family_id,status,product_id,qonversion_user_id,trial_ends_at,current_period_end,
        cancelled_at,last_event_id,last_event_at,raw_event,created_at,updated_at,
        provider,base_plan_id,purchase_token_hash,latest_order_id,acknowledged_at,google_play_raw)
     SELECT ?,'trial',?,?,?,NULL,NULL,?,?,?,?,?,?,?,NULL,?,?, '{}'
      WHERE EXISTS(
        SELECT 1 FROM web_billing_customers
         WHERE family_id=? AND customer_key=? AND status='trial'
           AND trial_ends_at=? AND next_charge_at=? AND last_order_id=?
      )
        AND EXISTS(
          SELECT 1 FROM billing_provider_reservations bpr
           WHERE bpr.family_id=? AND bpr.provider='toss_web'
             AND bpr.state IN ('reserved','active')
             AND bpr.reservation_ref IN (?,?)
        )
     ON CONFLICT(family_id) DO UPDATE SET
       status='trial', product_id=excluded.product_id,
       qonversion_user_id=excluded.qonversion_user_id,
       trial_ends_at=excluded.trial_ends_at, current_period_end=NULL,
       cancelled_at=NULL, last_event_id=excluded.last_event_id,
       last_event_at=excluded.last_event_at, raw_event=excluded.raw_event,
       updated_at=excluded.updated_at, provider=excluded.provider,
       base_plan_id=excluded.base_plan_id, purchase_token_hash=NULL,
       latest_order_id=excluded.latest_order_id,
       acknowledged_at=excluded.acknowledged_at, google_play_raw='{}'
     WHERE (
       family_subscription.provider='toss_web'
       OR NOT (
         (LOWER(TRIM(COALESCE(family_subscription.status,''))) IN ('active','grace','cancelled')
           AND family_subscription.current_period_end IS NOT NULL
           AND datetime(substr(family_subscription.current_period_end,1,19))>datetime('now'))
         OR
         (LOWER(TRIM(COALESCE(family_subscription.status,'')))='trial'
           AND family_subscription.trial_ends_at IS NOT NULL
           AND datetime(substr(family_subscription.trial_ends_at,1,19))>datetime('now'))
       )
     )`,
  ).bind(
    input.familyId,
    productId(input.plan),
    `toss:${input.familyId}`,
    input.trialEndsAt,
    input.trialEventId,
    input.now,
    rawEvent,
    input.now,
    input.now,
    WEB_BILLING_PROVIDER,
    WEB_BILLING_PLANS[input.plan].basePlanId,
    input.trialEventId,
    input.now,
    input.familyId,
    input.customerKey,
    input.trialEndsAt,
    input.trialEndsAt,
    input.trialEventId,
    input.familyId,
    input.sessionId,
    input.trialEventId,
  );
}

export async function finalizeTrialWebBilling(
  env: Env,
  input: {
    sessionId: string;
    sessionClaimToken: string;
    familyId: string;
    parentId: string;
    customerKey: string;
    plan: WebBillingPlan;
    now: Date;
  },
): Promise<
  | { status: "trial"; trialEndsAt: Date; trialEventId: string }
  | { status: "conflict" }
  | { status: "ineligible" }
> {
  const providerState = await readBillingProviderReservation(env.DB, input.familyId, input.now);
  if (
    !providerState
    || providerState.provider !== "toss_web"
    || providerState.state === "conflict"
  ) {
    return { status: "conflict" };
  }
  const pendingCustomer = await loadWebBillingCustomer(env.DB, input.familyId);
  const storedTrialEndMs = pendingCustomer?.customer_key === input.customerKey
    && pendingCustomer.status === "pending_charge"
    && pendingCustomer.trial_ends_at
    ? Date.parse(pgToIso(pendingCustomer.trial_ends_at))
    : Number.NaN;
  if (!Number.isFinite(storedTrialEndMs)) {
    throw new Error("web_billing_trial_period_missing");
  }
  const trialEndsAt = new Date(storedTrialEndMs);
  const now = pgTs(input.now);
  const end = pgTs(trialEndsAt);
  const trialEventId = `trial:${input.sessionId}`;
  const batch = await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO web_billing_trial_claims
         (family_id,parent_id,checkout_session_id,plan,status,claimed_at,trial_ends_at,updated_at)
       SELECT ?,?,?,?,'active',?,?,?
        WHERE EXISTS(
          SELECT 1 FROM web_billing_checkout_sessions
           WHERE id=? AND family_id=? AND parent_id=? AND customer_key=?
             AND trial_eligible=1 AND trial_days=?
             AND status='processing' AND claim_token=?
        )
          AND NOT (${webBillingLifetimeUseSql("?")})`,
    ).bind(
      input.familyId,
      input.parentId,
      input.sessionId,
      input.plan,
      now,
      end,
      now,
      input.sessionId,
      input.familyId,
      input.parentId,
      input.customerKey,
      WEB_BILLING_TRIAL_DAYS,
      input.sessionClaimToken,
      input.familyId,
      input.familyId,
      input.familyId,
      input.familyId,
    ),
    env.DB.prepare(
      `UPDATE web_billing_customers
          SET status='trial', trial_ends_at=?, current_period_end=NULL,
              next_charge_at=?, retry_after=NULL, failure_count=0,
              cancelled_at=NULL, last_order_id=?, updated_at=?
        WHERE family_id=? AND customer_key=? AND status='pending_charge'
          AND EXISTS(
            SELECT 1 FROM web_billing_trial_claims
             WHERE family_id=? AND checkout_session_id=? AND status='active'
               AND trial_ends_at=?
          )`,
    ).bind(
      end,
      end,
      trialEventId,
      now,
      input.familyId,
      input.customerKey,
      input.familyId,
      input.sessionId,
      end,
    ),
    env.DB.prepare(
      `UPDATE web_billing_checkout_sessions
          SET status='completed', claim_token=NULL, claim_expires_at=NULL,
              error_code=NULL, updated_at=?
        WHERE id=? AND family_id=? AND parent_id=? AND customer_key=?
          AND status='processing' AND claim_token=?
          AND EXISTS(
            SELECT 1 FROM web_billing_customers
             WHERE family_id=? AND customer_key=? AND status='trial'
               AND trial_ends_at=? AND last_order_id=?
          )`,
    ).bind(
      now,
      input.sessionId,
      input.familyId,
      input.parentId,
      input.customerKey,
      input.sessionClaimToken,
      input.familyId,
      input.customerKey,
      end,
      trialEventId,
    ),
    familyTrialSubscriptionUpsert(env.DB, {
      familyId: input.familyId,
      customerKey: input.customerKey,
      plan: input.plan,
      sessionId: input.sessionId,
      trialEventId,
      trialEndsAt: end,
      now,
    }),
    prepareBillingProviderFinalization(env.DB, {
      familyId: input.familyId,
      provider: "toss_web",
      reservationRef: trialEventId,
      expectedReservationRef: input.sessionId,
      canonicalOrderId: trialEventId,
      active: true,
      now,
    }),
  ]);
  if (batch.some((result) => Number(result.meta?.changes ?? 0) !== 1)) {
    if (
      Number(batch[0]?.meta?.changes ?? 0) === 0
      && !(await isWebBillingTrialEligible(env.DB, input.familyId))
    ) {
      return { status: "ineligible" };
    }
    throw new Error("web_billing_trial_finalize_guard_failed");
  }
  await notifyPg(env, input.familyId, "family_subscription", "UPDATE", {
    family_id: input.familyId,
    status: "trial",
    provider: WEB_BILLING_PROVIDER,
    trial_ends_at: end,
  });
  await recordWebBillingFunnelEvent(env, {
    familyId: input.familyId,
    event: "trial_start",
    plan: input.plan,
    orderId: trialEventId,
    occurredAt: input.now,
  });
  return { status: "trial", trialEndsAt, trialEventId };
}

function familySubscriptionUpsert(
  db: D1Database,
  input: {
    familyId: string;
    plan: WebBillingPlan;
    status: "active" | "cancelled" | "expired";
    currentPeriodEnd: string | null;
    cancelledAt: string | null;
    orderId: string;
    kind: "initial" | "renewal" | "cancel" | "expired";
    now: string;
    guard?: {
      customerKey: string;
      customerStatus: "active" | "past_due" | "expired";
      currentPeriodEnd: string | null;
      lastOrderId: string;
    };
  },
): D1PreparedStatement {
  const rawEvent = JSON.stringify({
    provider: WEB_BILLING_PROVIDER,
    kind: input.kind,
    plan: input.plan,
    orderId: input.orderId,
  });
  return db.prepare(
    `INSERT INTO family_subscription
       (family_id,status,product_id,qonversion_user_id,trial_ends_at,current_period_end,
        cancelled_at,last_event_id,last_event_at,raw_event,created_at,updated_at,
        provider,base_plan_id,purchase_token_hash,latest_order_id,acknowledged_at,google_play_raw)
     SELECT ?,?,?,?,NULL,?,?,?,?,?,?,?,?,?,NULL,?,?, '{}'
      WHERE (?=0 OR EXISTS(
        SELECT 1 FROM web_billing_customers
         WHERE family_id=? AND customer_key=? AND status=?
           AND current_period_end IS ? AND last_order_id=?
      ))
       AND EXISTS(
         SELECT 1 FROM billing_provider_reservations bpr
          WHERE bpr.family_id=? AND bpr.provider='toss_web'
            AND bpr.state IN ('reserved','active')
       )
     ON CONFLICT(family_id) DO UPDATE SET
       status=excluded.status,
       product_id=excluded.product_id,
       qonversion_user_id=excluded.qonversion_user_id,
       trial_ends_at=NULL,
       current_period_end=excluded.current_period_end,
       cancelled_at=excluded.cancelled_at,
       last_event_id=excluded.last_event_id,
       last_event_at=excluded.last_event_at,
       raw_event=excluded.raw_event,
       updated_at=excluded.updated_at,
       provider=excluded.provider,
       base_plan_id=excluded.base_plan_id,
       purchase_token_hash=NULL,
       latest_order_id=excluded.latest_order_id,
       acknowledged_at=excluded.acknowledged_at,
       google_play_raw='{}'
     WHERE EXISTS(
       SELECT 1 FROM billing_provider_reservations bpr
        WHERE bpr.family_id=excluded.family_id AND bpr.provider='toss_web'
          AND bpr.state IN ('reserved','active')
     )
       AND (
         family_subscription.provider='toss_web'
         OR NOT (
           (LOWER(TRIM(COALESCE(family_subscription.status,''))) IN ('active','grace','cancelled')
             AND family_subscription.current_period_end IS NOT NULL
             AND datetime(substr(family_subscription.current_period_end,1,19))>datetime('now'))
           OR
           (LOWER(TRIM(COALESCE(family_subscription.status,'')))='trial'
             AND family_subscription.trial_ends_at IS NOT NULL
             AND datetime(substr(family_subscription.trial_ends_at,1,19))>datetime('now'))
         )
       )`,
  ).bind(
    input.familyId,
    input.status,
    productId(input.plan),
    `toss:${input.familyId}`,
    input.currentPeriodEnd,
    input.cancelledAt,
    input.orderId,
    input.now,
    rawEvent,
    input.now,
    input.now,
    WEB_BILLING_PROVIDER,
    WEB_BILLING_PLANS[input.plan].basePlanId,
    input.orderId,
    input.now,
    input.guard ? 1 : 0,
    input.familyId,
    input.guard?.customerKey ?? "",
    input.guard?.customerStatus ?? "expired",
    input.guard?.currentPeriodEnd ?? null,
    input.guard?.lastOrderId ?? "",
    input.familyId,
  );
}

export async function finalizeInitialWebBilling(
  env: Env,
  input: {
    sessionId: string;
    sessionClaimToken: string;
    familyId: string;
    customerKey: string;
    plan: WebBillingPlan;
    orderId: string;
    periodEnd: Date;
    now: Date;
  },
): Promise<"activated" | "conflict"> {
  const now = pgTs(input.now);
  const end = pgTs(input.periodEnd);
  const providerState = await readBillingProviderReservation(env.DB, input.familyId, input.now);
  if (
    providerState
    && (
      providerState.provider === "google_play"
      || providerState.state === "conflict"
    )
  ) {
    if (providerState.provider === "google_play" && providerState.state !== "conflict") {
      const recorded = await markBillingProviderConflict(env.DB, {
        familyId: input.familyId,
        incumbentProvider: "google_play",
        conflictingProvider: "toss_web",
        conflictRef: input.orderId,
        reason: "toss_charge_after_google_activation",
        now: input.now,
      });
      if (!recorded) throw new Error("web_billing_provider_conflict_guard_failed");
    }
    const conflictCleanup = await env.DB.batch([
      env.DB.prepare(
        `UPDATE web_billing_customers
            SET status='expired', billing_key_ciphertext=NULL, billing_key_iv=NULL,
                billing_key_version=NULL, next_charge_at=NULL, retry_after=NULL, updated_at=?
          WHERE family_id=? AND customer_key=? AND status='pending_charge'`,
      ).bind(now, input.familyId, input.customerKey),
      env.DB.prepare(
        `UPDATE web_billing_checkout_sessions
            SET status='failed', claim_token=NULL, claim_expires_at=NULL,
                error_code='BILLING_PROVIDER_CONFLICT_REFUND_REQUIRED', updated_at=?
          WHERE id=? AND family_id=? AND customer_key=?
            AND ((status='processing' AND claim_token=?) OR status='failed')`,
      ).bind(
        now,
        input.sessionId,
        input.familyId,
        input.customerKey,
        input.sessionClaimToken,
      ),
    ]);
    if (
      Number(conflictCleanup[0]?.meta?.changes ?? 0) !== 1
      || Number(conflictCleanup[1]?.meta?.changes ?? 0) !== 1
    ) {
      throw new Error("web_billing_provider_conflict_cleanup_failed");
    }
    return "conflict";
  }
  if (!providerState || providerState.provider !== "toss_web") {
    throw new Error("web_billing_provider_reservation_missing");
  }
  const batch = await env.DB.batch([
    env.DB.prepare(
      `UPDATE web_billing_customers
          SET status='active', current_period_end=?, next_charge_at=?, retry_after=NULL,
              failure_count=0, cancelled_at=NULL, last_order_id=?,last_paid_order_id=?, updated_at=?
        WHERE family_id=? AND customer_key=?
          AND (
            status='pending_charge'
            OR (status='active' AND current_period_end=? AND last_order_id=?)
          )
          AND EXISTS(
            SELECT 1 FROM web_billing_charge_attempts a
             WHERE a.order_id=? AND a.family_id=web_billing_customers.family_id
               AND a.status='done' AND a.refund_status='none' AND a.refunded_amount=0
          )`,
    ).bind(
      end,
      end,
      input.orderId,
      input.orderId,
      now,
      input.familyId,
      input.customerKey,
      end,
      input.orderId,
      input.orderId,
    ),
    env.DB.prepare(
      `UPDATE web_billing_checkout_sessions
          SET status='completed', claim_token=NULL, claim_expires_at=NULL,
              error_code=NULL, updated_at=?
        WHERE id=? AND family_id=? AND customer_key=?
          AND ((status='processing' AND claim_token=?) OR status='completed')
          AND EXISTS(
            SELECT 1 FROM web_billing_customers
             WHERE family_id=? AND customer_key=? AND status='active'
               AND current_period_end=? AND last_order_id=?
          )`,
    ).bind(
      now,
      input.sessionId,
      input.familyId,
      input.customerKey,
      input.sessionClaimToken,
      input.familyId,
      input.customerKey,
      end,
      input.orderId,
    ),
    familySubscriptionUpsert(env.DB, {
      familyId: input.familyId,
      plan: input.plan,
      status: "active",
      currentPeriodEnd: end,
      cancelledAt: null,
      orderId: input.orderId,
      kind: "initial",
      now,
      guard: {
        customerKey: input.customerKey,
        customerStatus: "active",
        currentPeriodEnd: end,
        lastOrderId: input.orderId,
      },
    }),
    prepareBillingProviderFinalization(env.DB, {
      familyId: input.familyId,
      provider: "toss_web",
      reservationRef: input.orderId,
      expectedReservationRef: input.sessionId,
      canonicalOrderId: input.orderId,
      active: true,
      now,
    }),
  ]);
  if (
    Number(batch[0]?.meta?.changes ?? 0) !== 1
    || Number(batch[1]?.meta?.changes ?? 0) !== 1
    || Number(batch[2]?.meta?.changes ?? 0) !== 1
    || Number(batch[3]?.meta?.changes ?? 0) !== 1
  ) {
    throw new Error("web_billing_initial_finalize_guard_failed");
  }
  await notifyPg(env, input.familyId, "family_subscription", "UPDATE", {
    family_id: input.familyId,
    status: "active",
    provider: WEB_BILLING_PROVIDER,
    current_period_end: end,
  });
  await recordWebBillingFunnelEvent(env, {
    familyId: input.familyId,
    event: "entitlement_activated",
    plan: input.plan,
    orderId: input.orderId,
    occurredAt: input.now,
  });
  return "activated";
}

async function finalizeRenewalWebBilling(
  env: Env,
  input: {
    familyId: string;
    customerKey: string;
    plan: WebBillingPlan;
    orderId: string;
    providerReservationRef: string;
    previousPeriodEnd: string;
    periodEnd: string;
    now: Date;
  },
): Promise<boolean> {
  const now = pgTs(input.now);
  const batch = await env.DB.batch([
    env.DB.prepare(
      `UPDATE web_billing_customers
          SET status='active', current_period_end=?, next_charge_at=?, retry_after=NULL,
              failure_count=0, last_order_id=?,last_paid_order_id=?, updated_at=?
        WHERE family_id=? AND customer_key=? AND status IN ('active','past_due')
          AND current_period_end=?
          AND EXISTS(
            SELECT 1 FROM web_billing_charge_attempts a
             WHERE a.order_id=? AND a.family_id=web_billing_customers.family_id
               AND a.status='done' AND a.refund_status='none' AND a.refunded_amount=0
          )`,
    ).bind(
      input.periodEnd,
      input.periodEnd,
      input.orderId,
      input.orderId,
      now,
      input.familyId,
      input.customerKey,
      input.previousPeriodEnd,
      input.orderId,
    ),
    familySubscriptionUpsert(env.DB, {
      familyId: input.familyId,
      plan: input.plan,
      status: "active",
      currentPeriodEnd: input.periodEnd,
      cancelledAt: null,
      orderId: input.orderId,
      kind: "renewal",
      now,
      guard: {
        customerKey: input.customerKey,
        customerStatus: "active",
        currentPeriodEnd: input.periodEnd,
        lastOrderId: input.orderId,
      },
    }),
    prepareBillingProviderFinalization(env.DB, {
      familyId: input.familyId,
      provider: "toss_web",
      reservationRef: input.orderId,
      expectedReservationRef: input.providerReservationRef,
      canonicalOrderId: input.orderId,
      active: true,
      now,
    }),
  ]);
  const changed = batch.every((result) => Number(result.meta?.changes ?? 0) === 1);
  if (changed) {
    await notifyPg(env, input.familyId, "family_subscription", "UPDATE", {
      family_id: input.familyId,
      status: "active",
      provider: WEB_BILLING_PROVIDER,
      current_period_end: input.periodEnd,
    });
    await recordWebBillingFunnelEvent(env, {
      familyId: input.familyId,
      event: "renewal",
      plan: input.plan,
      orderId: input.orderId,
      occurredAt: input.now,
    });
  }
  return changed;
}

async function finalizeTrialConversionWebBilling(
  env: Env,
  input: {
    familyId: string;
    customerKey: string;
    plan: WebBillingPlan;
    orderId: string;
    providerReservationRef: string;
    trialEndsAt: string;
    periodEnd: string;
    now: Date;
  },
): Promise<boolean> {
  const now = pgTs(input.now);
  const batch = await env.DB.batch([
    env.DB.prepare(
      `UPDATE web_billing_customers
          SET status='active', current_period_end=?, next_charge_at=?, retry_after=NULL,
              failure_count=0, last_order_id=?,last_paid_order_id=?, updated_at=?
        WHERE family_id=? AND customer_key=? AND status IN ('trial','past_due')
          AND current_period_end IS NULL AND trial_ends_at=?
          AND EXISTS(
            SELECT 1 FROM web_billing_charge_attempts a
             WHERE a.order_id=? AND a.family_id=web_billing_customers.family_id
               AND a.status='done' AND a.refund_status='none' AND a.refunded_amount=0
          )`,
    ).bind(
      input.periodEnd,
      input.periodEnd,
      input.orderId,
      input.orderId,
      now,
      input.familyId,
      input.customerKey,
      input.trialEndsAt,
      input.orderId,
    ),
    env.DB.prepare(
      `UPDATE web_billing_trial_claims
          SET status='converted', converted_order_id=?, updated_at=?
        WHERE family_id=? AND trial_ends_at=? AND status IN ('active','expired','converted')
          AND (converted_order_id IS NULL OR converted_order_id=?)`,
    ).bind(
      input.orderId,
      now,
      input.familyId,
      input.trialEndsAt,
      input.orderId,
    ),
    familySubscriptionUpsert(env.DB, {
      familyId: input.familyId,
      plan: input.plan,
      status: "active",
      currentPeriodEnd: input.periodEnd,
      cancelledAt: null,
      orderId: input.orderId,
      kind: "initial",
      now,
      guard: {
        customerKey: input.customerKey,
        customerStatus: "active",
        currentPeriodEnd: input.periodEnd,
        lastOrderId: input.orderId,
      },
    }),
    prepareBillingProviderFinalization(env.DB, {
      familyId: input.familyId,
      provider: "toss_web",
      reservationRef: input.orderId,
      expectedReservationRef: input.providerReservationRef,
      canonicalOrderId: input.orderId,
      active: true,
      now,
    }),
  ]);
  const changed = batch.every((result) => Number(result.meta?.changes ?? 0) === 1);
  if (!changed) return false;
  await notifyPg(env, input.familyId, "family_subscription", "UPDATE", {
    family_id: input.familyId,
    status: "active",
    provider: WEB_BILLING_PROVIDER,
    current_period_end: input.periodEnd,
  });
  await recordWebBillingFunnelEvent(env, {
    familyId: input.familyId,
    event: "entitlement_activated",
    plan: input.plan,
    orderId: input.orderId,
    occurredAt: input.now,
  });
  return true;
}

async function recordRenewalFailure(
  env: Env,
  customer: WebBillingCustomerRow,
  orderId: string,
  now: Date,
): Promise<"retry" | "expired" | "skipped"> {
  const failureCount = Number(customer.failure_count ?? 0) + 1;
  const expired = failureCount >= WEB_BILLING_MAX_RENEWAL_FAILURES;
  const nowPg = pgTs(now);
  const retryAfter = expired ? null : pgTs(webBillingRetryAt(now, failureCount));
  const subscriptionStatus = isAtOrBefore(customer.current_period_end, now) ? "expired" : "active";
  const trialConversion = customer.current_period_end === null && customer.trial_ends_at !== null;
  // 실패 주문은 대사 추적용 last_order_id에만 남기고 현재 유료 권리 주문은 덮지 않는다.
  const canonicalEntitlementOrderId = customer.last_paid_order_id
    ?? customer.last_order_id
    ?? orderId;
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `UPDATE web_billing_customers
          SET status=?, retry_after=?, next_charge_at=?, failure_count=?, last_order_id=?,
              billing_key_revocation_status=CASE
                WHEN ? AND billing_key_ciphertext IS NOT NULL
                  AND billing_key_iv IS NOT NULL AND billing_key_version='v1'
                  THEN 'pending'
                ELSE billing_key_revocation_status
              END,
              billing_key_revocation_attempts=CASE WHEN ? THEN 0 ELSE billing_key_revocation_attempts END,
              billing_key_revocation_retry_at=CASE WHEN ? THEN ? ELSE billing_key_revocation_retry_at END,
              billing_key_revocation_error=CASE WHEN ? THEN NULL ELSE billing_key_revocation_error END,
              billing_key_revoked_at=CASE WHEN ? THEN NULL ELSE billing_key_revoked_at END,
              updated_at=?
        WHERE family_id=? AND customer_key=? AND status IN ('trial','active','past_due')`,
    ).bind(
      expired ? "expired" : "past_due",
      retryAfter,
      expired ? null : customer.next_charge_at,
      failureCount,
      orderId,
      expired ? 1 : 0,
      expired ? 1 : 0,
      expired ? 1 : 0,
      nowPg,
      expired ? 1 : 0,
      expired ? 1 : 0,
      nowPg,
      customer.family_id,
      customer.customer_key,
    ),
    familySubscriptionUpsert(env.DB, {
      familyId: customer.family_id,
      plan: customer.plan,
      status: subscriptionStatus,
      currentPeriodEnd: customer.current_period_end,
      cancelledAt: subscriptionStatus === "expired" ? nowPg : null,
      orderId: canonicalEntitlementOrderId,
      kind: subscriptionStatus === "expired" ? "expired" : "renewal",
      now: nowPg,
      guard: {
        customerKey: customer.customer_key,
        customerStatus: expired ? "expired" : "past_due",
        currentPeriodEnd: customer.current_period_end,
        lastOrderId: orderId,
      },
    }),
  ];
  if (trialConversion) {
    statements.push(env.DB.prepare(
      `UPDATE web_billing_trial_claims
          SET status='expired', updated_at=?
        WHERE family_id=? AND trial_ends_at=? AND status IN ('active','expired')`,
    ).bind(nowPg, customer.family_id, customer.trial_ends_at));
  }
  const batch = await env.DB.batch(statements);
  const changed = batch.every((result) => Number(result.meta?.changes ?? 0) === 1);
  if (!changed) return "skipped";
  await notifyPg(env, customer.family_id, "family_subscription", "UPDATE", {
    family_id: customer.family_id,
    status: subscriptionStatus,
    provider: WEB_BILLING_PROVIDER,
    current_period_end: customer.current_period_end,
  });
  return expired ? "expired" : "retry";
}

interface PendingTrialCandidate {
  session_id: string;
  family_id: string;
  parent_id: string;
  customer_key: string;
  plan: WebBillingPlan;
}

async function processPendingTrialActivations(
  env: Env,
  config: TossWebBillingConfig,
  options: { now: Date; fetchImpl?: FetchLike; limit: number },
): Promise<{ trialChecked: number; trialActivated: number; trialFailed: number }> {
  const nowPg = pgTs(options.now);
  const { results } = await env.DB.prepare(
    `SELECT s.id AS session_id,s.family_id,s.parent_id,s.customer_key,s.plan
       FROM web_billing_checkout_sessions s
       JOIN web_billing_customers c
         ON c.family_id=s.family_id AND c.parent_id=s.parent_id
        AND c.customer_key=s.customer_key
      WHERE s.trial_eligible=1 AND s.trial_days=?
        AND c.status='pending_charge'
        AND c.trial_ends_at IS NOT NULL
        AND c.billing_key_ciphertext IS NOT NULL
        AND c.billing_key_iv IS NOT NULL
        AND c.billing_key_version='v1'
        AND (
          s.status IN ('pending','expired')
          OR (s.status='processing' AND (
            s.claim_expires_at IS NULL
            OR datetime(substr(s.claim_expires_at,1,19))<=datetime(substr(?,1,19))
          ))
        )
      ORDER BY s.created_at ASC LIMIT ?`,
  ).bind(WEB_BILLING_TRIAL_DAYS, nowPg, options.limit).all<PendingTrialCandidate>();
  let trialChecked = 0;
  let trialActivated = 0;
  let trialFailed = 0;
  for (const candidate of results ?? []) {
    if (!validPlan(candidate.plan)) continue;
    const scopes = await loadFamilyNotificationMutationScopes(env.DB, candidate.family_id);
    if (!scopes) continue;
    const leaseResult = await acquireAccountMutationLeases(env.DB, scopes);
    if (leaseResult.status !== "acquired") continue;
    let claimToken: string | null = null;
    try {
      claimToken = crypto.randomUUID();
      const claimed = await env.DB.prepare(
        `UPDATE web_billing_checkout_sessions
            SET status='processing',claim_token=?,claim_expires_at=?,updated_at=?
          WHERE id=? AND family_id=? AND customer_key=? AND trial_eligible=1
            AND (
              status IN ('pending','expired')
              OR (status='processing' AND (
                claim_expires_at IS NULL
                OR datetime(substr(claim_expires_at,1,19))<=datetime(substr(?,1,19))
              ))
            )
            AND EXISTS(
              SELECT 1 FROM web_billing_customers c
               WHERE c.family_id=web_billing_checkout_sessions.family_id
                 AND c.parent_id=web_billing_checkout_sessions.parent_id
                 AND c.customer_key=web_billing_checkout_sessions.customer_key
                 AND c.status='pending_charge' AND c.trial_ends_at IS NOT NULL
                 AND c.billing_key_ciphertext IS NOT NULL
                 AND c.billing_key_iv IS NOT NULL AND c.billing_key_version='v1'
            )`,
      ).bind(
        claimToken,
        attemptClaimExpiry(options.now),
        nowPg,
        candidate.session_id,
        candidate.family_id,
        candidate.customer_key,
        nowPg,
      ).run();
      if (Number(claimed.meta?.changes ?? 0) !== 1) {
        claimToken = null;
        continue;
      }
      trialChecked += 1;
      const finalized = await finalizeTrialWebBilling(env, {
        sessionId: candidate.session_id,
        sessionClaimToken: claimToken,
        familyId: candidate.family_id,
        parentId: candidate.parent_id,
        customerKey: candidate.customer_key,
        plan: candidate.plan,
        now: options.now,
      });
      claimToken = null;
      if (finalized.status === "trial") {
        trialActivated += 1;
        continue;
      }
      trialFailed += 1;
      const customer = await loadWebBillingCustomer(env.DB, candidate.family_id);
      if (
        customer?.billing_key_ciphertext
        && customer.billing_key_iv
        && customer.billing_key_version === "v1"
      ) {
        try {
          const billingKey = await decryptWebBillingSecret(config.encryptionSecret, {
            version: customer.billing_key_version,
            iv: customer.billing_key_iv,
            ciphertext: customer.billing_key_ciphertext,
          }, customer.family_id, customer.customer_key);
          await deleteTossBillingKey(config, billingKey, options.fetchImpl);
        } catch {
          // 로컬 상태는 아래에서 먼저 닫고 운영 대사 대상으로 남긴다.
        }
      }
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE web_billing_customers
              SET status='expired',billing_key_ciphertext=NULL,billing_key_iv=NULL,
                  billing_key_version=NULL,next_charge_at=NULL,retry_after=NULL,updated_at=?
            WHERE family_id=? AND customer_key=? AND status='pending_charge'`,
        ).bind(nowPg, candidate.family_id, candidate.customer_key),
        env.DB.prepare(
          `UPDATE web_billing_checkout_sessions
              SET status='failed',claim_token=NULL,claim_expires_at=NULL,
                  error_code='BILLING_PROVIDER_CONFLICT',updated_at=?
            WHERE id=? AND family_id=?`,
        ).bind(nowPg, candidate.session_id, candidate.family_id),
      ]);
    } catch {
      trialFailed += 1;
    } finally {
      if (claimToken) {
        await env.DB.prepare(
          `UPDATE web_billing_checkout_sessions
              SET status='pending',claim_token=NULL,claim_expires_at=NULL,
                  error_code='WEB_BILLING_TRIAL_RECONCILIATION_INTERRUPTED',updated_at=?
            WHERE id=? AND claim_token=?`,
        ).bind(nowPg, candidate.session_id, claimToken).run();
      }
      await releaseAccountMutationLeases(env.DB, leaseResult.leases);
    }
  }
  return { trialChecked, trialActivated, trialFailed };
}

async function processInitialWebBillingReconciliations(
  env: Env,
  config: TossWebBillingConfig,
  options: { now: Date; fetchImpl?: FetchLike; limit: number },
): Promise<{
  initialChecked: number;
  initialActivated: number;
  initialFailed: number;
  initialUnknown: number;
}> {
  const nowPg = pgTs(options.now);
  const { results } = await env.DB.prepare(
    `SELECT a.order_id,a.family_id,a.checkout_session_id,a.plan,a.period_end,
            a.status AS attempt_status,s.customer_key
       FROM web_billing_charge_attempts a
       JOIN web_billing_checkout_sessions s
         ON s.id=a.checkout_session_id AND s.family_id=a.family_id
       JOIN web_billing_customers c
         ON c.family_id=a.family_id AND c.customer_key=s.customer_key
      WHERE a.kind='initial'
        AND c.status='pending_charge'
        AND s.status IN ('pending','processing')
        AND (
          s.status='pending'
          OR s.claim_expires_at IS NULL
          OR datetime(substr(s.claim_expires_at,1,19))<=datetime(substr(?,1,19))
        )
        AND (
          a.status IN ('pending','unknown','done','failed')
          OR (
            a.status='processing'
            AND (a.claim_expires_at IS NULL
              OR datetime(substr(a.claim_expires_at,1,19))<=datetime(substr(?,1,19)))
          )
        )
      ORDER BY a.created_at ASC
      LIMIT ?`,
  ).bind(nowPg, nowPg, options.limit).all<InitialReconciliationCandidate>();

  let initialChecked = 0;
  let initialActivated = 0;
  let initialFailed = 0;
  let initialUnknown = 0;
  for (const candidate of results ?? []) {
    if (!validPlan(candidate.plan) || !candidate.checkout_session_id) continue;
    const scopes = await loadFamilyNotificationMutationScopes(env.DB, candidate.family_id);
    if (!scopes) continue;
    const leaseResult = await acquireAccountMutationLeases(env.DB, scopes);
    if (leaseResult.status !== "acquired") continue;
    let checkoutClaimToken: string | null = null;
    try {
      checkoutClaimToken = await claimInitialCheckoutForReconciliation(
        env.DB,
        candidate,
        options.now,
      );
      if (!checkoutClaimToken) continue;

      const attempt = await readChargeAttempt(env.DB, candidate.order_id);
      const customer = await loadWebBillingCustomer(env.DB, candidate.family_id);
      if (
        !attempt
        || attempt.kind !== "initial"
        || attempt.checkout_session_id !== candidate.checkout_session_id
        || attempt.family_id !== candidate.family_id
        || !customer
        || customer.status !== "pending_charge"
        || customer.customer_key !== candidate.customer_key
      ) continue;
      const periodEnd = new Date(pgToIso(attempt.period_end));
      if (!Number.isFinite(periodEnd.getTime())) {
        throw new Error("web_billing_initial_period_invalid");
      }
      initialChecked += 1;
      const providerState = await readBillingProviderReservation(
        env.DB,
        candidate.family_id,
        options.now,
      );
      const allowCharge = providerState?.provider === "toss_web"
        && providerState.state !== "conflict";

      if (attempt.status === "done") {
        let providerSettlement: WebBillingRefundSettlement;
        try {
          providerSettlement = await reconcileWebBillingRefund(env, {
            orderId: attempt.order_id,
            now: options.now,
            fetchImpl: options.fetchImpl,
          });
        } catch {
          await releaseInitialCheckoutReconciliation(
            env.DB,
            candidate.checkout_session_id,
            checkoutClaimToken,
            "WEB_BILLING_PROVIDER_RECHECK_FAILED",
            options.now,
          );
          checkoutClaimToken = null;
          initialUnknown += 1;
          continue;
        }
        if (providerSettlement.status !== "paid") {
          // 환불 batch가 pending customer와 checkout을 이미 fail-closed로 닫는다.
          checkoutClaimToken = null;
          initialFailed += 1;
          continue;
        }
        const finalized = await finalizeInitialWebBilling(env, {
          sessionId: candidate.checkout_session_id,
          sessionClaimToken: checkoutClaimToken,
          familyId: candidate.family_id,
          customerKey: candidate.customer_key,
          plan: attempt.plan,
          orderId: attempt.order_id,
          periodEnd,
          now: options.now,
        });
        checkoutClaimToken = null;
        if (finalized === "activated") {
          initialActivated += 1;
        } else {
          initialFailed += 1;
          if (
            customer.billing_key_ciphertext
            && customer.billing_key_iv
            && customer.billing_key_version === "v1"
          ) {
            try {
              const key = await decryptWebBillingSecret(config.encryptionSecret, {
                version: customer.billing_key_version,
                iv: customer.billing_key_iv,
                ciphertext: customer.billing_key_ciphertext,
              }, customer.family_id, customer.customer_key);
              await deleteTossBillingKey(config, key, options.fetchImpl);
            } catch {
              // 로컬 키는 충돌 격리에서 먼저 폐기됐다.
            }
          }
        }
        continue;
      }

      let billingKey: string | null = null;
      if (
        customer.billing_key_ciphertext
        && customer.billing_key_iv
        && customer.billing_key_version === "v1"
      ) {
        try {
          billingKey = await decryptWebBillingSecret(config.encryptionSecret, {
            version: customer.billing_key_version,
            iv: customer.billing_key_iv,
            ciphertext: customer.billing_key_ciphertext,
          }, customer.family_id, customer.customer_key);
        } catch {
          billingKey = null;
        }
      }

      if (attempt.status === "failed") {
        const finalized = await failInitialWebBilling(env, {
          sessionId: candidate.checkout_session_id,
          sessionClaimToken: checkoutClaimToken,
          familyId: candidate.family_id,
          customerKey: candidate.customer_key,
          errorCode: attempt.error_code ?? "TOSS_REQUEST_FAILED",
          now: options.now,
        });
        if (!finalized) continue;
        checkoutClaimToken = null;
        initialFailed += 1;
        if (billingKey) {
          try {
            await deleteTossBillingKey(config, billingKey, options.fetchImpl);
          } catch {
            // 로컬 자동청구 키는 이미 폐기됐다. 결제사 정리 실패는 재청구를 열지 않는다.
          }
        }
        await releaseBillingProviderReservation(env.DB, {
          familyId: candidate.family_id,
          provider: "toss_web",
          reservationRef: candidate.checkout_session_id,
          now: options.now,
        });
        continue;
      }

      if (!billingKey) {
        await releaseInitialCheckoutReconciliation(
          env.DB,
          candidate.checkout_session_id,
          checkoutClaimToken,
          "WEB_BILLING_ENCRYPTION_UNAVAILABLE",
          options.now,
        );
        checkoutClaimToken = null;
        initialUnknown += 1;
        continue;
      }

      const outcome = await settleWebBillingAttempt(env.DB, config, {
        orderId: attempt.order_id,
        familyId: candidate.family_id,
        customerKey: candidate.customer_key,
        billingKey,
        now: options.now,
        fetchImpl: options.fetchImpl,
        allowCharge,
      });
      if (outcome.status === "done") {
        const finalized = await finalizeInitialWebBilling(env, {
          sessionId: candidate.checkout_session_id,
          sessionClaimToken: checkoutClaimToken,
          familyId: candidate.family_id,
          customerKey: candidate.customer_key,
          plan: attempt.plan,
          orderId: attempt.order_id,
          periodEnd,
          now: options.now,
        });
        checkoutClaimToken = null;
        if (finalized === "activated") {
          initialActivated += 1;
        } else {
          initialFailed += 1;
          try {
            await deleteTossBillingKey(config, billingKey, options.fetchImpl);
          } catch {
            // 이미 청구된 주문은 conflict_ref(order id)로 환불 운영한다.
          }
        }
      } else if (outcome.status === "failed") {
        const finalized = await failInitialWebBilling(env, {
          sessionId: candidate.checkout_session_id,
          sessionClaimToken: checkoutClaimToken,
          familyId: candidate.family_id,
          customerKey: candidate.customer_key,
          errorCode: outcome.errorCode,
          now: options.now,
        });
        if (!finalized) continue;
        checkoutClaimToken = null;
        initialFailed += 1;
        try {
          await deleteTossBillingKey(config, billingKey, options.fetchImpl);
        } catch {
          // 로컬 키가 먼저 제거됐으므로 결제사 폐기 실패가 재청구로 이어지지 않는다.
        }
        await releaseBillingProviderReservation(env.DB, {
          familyId: candidate.family_id,
          provider: "toss_web",
          reservationRef: candidate.checkout_session_id,
          now: options.now,
        });
      } else {
        await releaseInitialCheckoutReconciliation(
          env.DB,
          candidate.checkout_session_id,
          checkoutClaimToken,
          outcome.status === "unknown" ? outcome.errorCode : null,
          options.now,
        );
        checkoutClaimToken = null;
        initialUnknown += 1;
      }
    } catch {
      initialUnknown += 1;
    } finally {
      if (checkoutClaimToken) {
        await releaseInitialCheckoutReconciliation(
          env.DB,
          candidate.checkout_session_id,
          checkoutClaimToken,
          "WEB_BILLING_RECONCILIATION_INTERRUPTED",
          options.now,
        );
      }
      await releaseAccountMutationLeases(env.DB, leaseResult.leases);
    }
  }
  return { initialChecked, initialActivated, initialFailed, initialUnknown };
}

async function processPendingWebBillingKeyRevocations(
  env: Env,
  config: TossWebBillingConfig,
  options: { now: Date; fetchImpl?: FetchLike },
): Promise<{
  revocationChecked: number;
  revocationCompleted: number;
  revocationPending: number;
}> {
  const nowPg = pgTs(options.now);
  const candidate = await env.DB.prepare(
    `SELECT family_id
       FROM web_billing_customers
      WHERE billing_key_revocation_status='pending'
        AND billing_key_ciphertext IS NOT NULL
        AND billing_key_iv IS NOT NULL AND billing_key_version='v1'
        AND (billing_key_revocation_retry_at IS NULL
          OR datetime(substr(billing_key_revocation_retry_at,1,19))<=datetime(substr(?,1,19)))
      ORDER BY COALESCE(billing_key_revocation_retry_at,updated_at) ASC
      LIMIT 1`,
  ).bind(nowPg).first<{ family_id: string }>();
  if (!candidate) {
    return { revocationChecked: 0, revocationCompleted: 0, revocationPending: 0 };
  }
  const scopes = await loadFamilyNotificationMutationScopes(env.DB, candidate.family_id);
  if (!scopes) {
    return { revocationChecked: 0, revocationCompleted: 0, revocationPending: 1 };
  }
  const leaseResult = await acquireAccountMutationLeases(env.DB, scopes);
  if (leaseResult.status !== "acquired") {
    return { revocationChecked: 0, revocationCompleted: 0, revocationPending: 1 };
  }
  try {
    const outcome = await attemptWebBillingKeyRevocation(env, {
      familyId: candidate.family_id,
      now: options.now,
      fetchImpl: options.fetchImpl,
      config,
    });
    return {
      revocationChecked: 1,
      revocationCompleted: outcome === "revoked" ? 1 : 0,
      revocationPending: outcome === "pending" ? 1 : 0,
    };
  } finally {
    await releaseAccountMutationLeases(env.DB, leaseResult.leases);
  }
}

export async function processWebBillingRenewals(
  env: Env,
  options: {
    now?: Date;
    fetchImpl?: FetchLike;
    limit?: number;
    mode?: "all" | "initial" | "renewal";
  } = {},
): Promise<Record<string, number | boolean>> {
  const config = configuredWebBilling(env);
  if (!config) {
    return {
      configured: false,
      trialChecked: 0,
      trialActivated: 0,
      trialFailed: 0,
      initialChecked: 0,
      initialActivated: 0,
      initialFailed: 0,
      initialUnknown: 0,
      revocationChecked: 0,
      revocationCompleted: 0,
      revocationPending: 0,
      checked: 0,
      renewed: 0,
      failed: 0,
      unknown: 0,
    };
  }
  const now = options.now ?? new Date();
  const nowPg = pgTs(now);
  const limit = Math.max(1, Math.min(50, Math.trunc(options.limit ?? 20)));
  const mode = options.mode ?? "all";
  const revocations = await processPendingWebBillingKeyRevocations(env, config, {
    now,
    fetchImpl: options.fetchImpl,
  });
  const trials = mode === "renewal"
    ? { trialChecked: 0, trialActivated: 0, trialFailed: 0 }
    : await processPendingTrialActivations(env, config, {
      now,
      fetchImpl: options.fetchImpl,
      limit,
    });
  const initial = mode === "renewal"
    ? { initialChecked: 0, initialActivated: 0, initialFailed: 0, initialUnknown: 0 }
    : await processInitialWebBillingReconciliations(env, config, {
      now,
      fetchImpl: options.fetchImpl,
      limit,
    });
  if (mode === "initial") {
    return {
      configured: true,
      ...trials,
      ...initial,
      ...revocations,
      checked: 0,
      renewed: 0,
      failed: 0,
      unknown: 0,
    };
  }
  const { results } = await env.DB.prepare(
    `SELECT c.family_id,c.parent_id,c.customer_key,c.billing_key_ciphertext,c.billing_key_iv,
            c.billing_key_version,c.billing_key_revocation_status,c.billing_key_revocation_attempts,
            c.billing_key_revocation_retry_at,c.billing_key_revocation_error,c.billing_key_revoked_at,
            c.plan,c.status,c.trial_ends_at,c.current_period_end,c.next_charge_at,c.retry_after,
            c.failure_count,c.cancelled_at,c.last_order_id,c.last_paid_order_id
       FROM web_billing_customers c
       JOIN billing_provider_reservations bpr
         ON bpr.family_id=c.family_id
        AND bpr.provider='toss_web' AND bpr.state='active'
      WHERE c.status IN ('trial','active','past_due')
        AND c.billing_key_ciphertext IS NOT NULL
        AND c.billing_key_iv IS NOT NULL
        AND c.billing_key_version='v1'
        AND (
          (c.status IN ('trial','active')
            AND datetime(substr(c.next_charge_at,1,19))<=datetime(substr(?,1,19))
            AND (c.retry_after IS NULL
              OR datetime(substr(c.retry_after,1,19))<=datetime(substr(?,1,19))))
          OR
          (c.status='past_due' AND datetime(substr(c.retry_after,1,19))<=datetime(substr(?,1,19)))
        )
      ORDER BY COALESCE(c.retry_after,c.next_charge_at) ASC
      LIMIT ?`,
  ).bind(nowPg, nowPg, nowPg, limit).all<WebBillingCustomerRow>();

  let checked = 0;
  let renewed = 0;
  let failed = 0;
  let unknown = 0;
  for (const candidate of results ?? []) {
    const candidateAnchor = candidate.current_period_end ?? candidate.trial_ends_at;
    if (!validPlan(candidate.plan) || !candidateAnchor) continue;
    const scopes = await loadFamilyNotificationMutationScopes(env.DB, candidate.family_id);
    if (!scopes) continue;
    const leaseResult = await acquireAccountMutationLeases(env.DB, scopes);
    if (leaseResult.status !== "acquired") continue;
    try {
      const customer = await loadWebBillingCustomer(env.DB, candidate.family_id);
      if (
        !customer
        || !["trial", "active", "past_due"].includes(customer.status)
        || customer.customer_key !== candidate.customer_key
      ) continue;
      const trialConversion = customer.current_period_end === null && customer.trial_ends_at !== null;
      const billingAnchor = trialConversion ? customer.trial_ends_at : customer.current_period_end;
      if (!billingAnchor) continue;
      const providerState = await readBillingProviderReservation(env.DB, customer.family_id, now);
      if (providerState?.provider !== "toss_web" || providerState.state !== "active") continue;
      const dueAt = customer.status === "past_due" ? customer.retry_after : customer.next_charge_at;
      if (!isAtOrBefore(dueAt, now)) continue;
      checked += 1;

      let billingKey: string;
      try {
        billingKey = await decryptWebBillingSecret(config.encryptionSecret, {
          version: customer.billing_key_version,
          iv: customer.billing_key_iv,
          ciphertext: customer.billing_key_ciphertext,
        }, customer.family_id, customer.customer_key);
      } catch {
        if (await recordRenewalFailure(env, customer, "encryption_unavailable", now) !== "skipped") {
          failed += 1;
        }
        continue;
      }

      const priorEndMs = Date.parse(pgToIso(billingAnchor));
      const periodStart = trialConversion
        ? new Date(priorEndMs)
        : new Date(Math.max(now.getTime(), Number.isFinite(priorEndMs) ? priorEndMs : now.getTime()));
      if (!Number.isFinite(periodStart.getTime())) continue;
      const periodEnd = addWebBillingPeriod(periodStart, customer.plan);
      const orderId = await createWebBillingOrderId(
        trialConversion ? "trial_conversion" : "renewal",
        `${customer.family_id}:${billingAnchor}:${customer.failure_count}`,
      );
      await insertChargeAttempt(env.DB, {
        orderId,
        familyId: customer.family_id,
        checkoutSessionId: null,
        customerKey: customer.customer_key,
        plan: customer.plan,
        kind: trialConversion ? "trial_conversion" : "renewal",
        periodStart,
        periodEnd,
        now,
        expectedCustomer: {
          customerKey: customer.customer_key,
          currentPeriodEnd: billingAnchor,
        },
      });
      const persistedAttempt = await readChargeAttempt(env.DB, orderId);
      if (
        !persistedAttempt
        || persistedAttempt.family_id !== customer.family_id
        || persistedAttempt.kind !== (trialConversion ? "trial_conversion" : "renewal")
      ) {
        // 해지가 먼저 선형화되면 guarded INSERT가 0건이어야 하며 청구를 시작하지 않는다.
        continue;
      }
      const outcome = await settleWebBillingAttempt(env.DB, config, {
        orderId,
        familyId: customer.family_id,
        customerKey: customer.customer_key,
        billingKey,
        now,
        fetchImpl: options.fetchImpl,
      });
      if (outcome.status === "done") {
        if (outcome.paymentKeyHash === "already_recorded") {
          let providerSettlement: WebBillingRefundSettlement;
          try {
            providerSettlement = await reconcileWebBillingRefund(env, {
              orderId,
              now,
              fetchImpl: options.fetchImpl,
            });
          } catch {
            await env.DB.prepare(
              `UPDATE web_billing_customers SET retry_after=?,updated_at=?
                WHERE family_id=? AND customer_key=? AND status IN ('trial','active','past_due')`,
            ).bind(
              pgTs(new Date(now.getTime() + 15 * 60 * 1000)),
              nowPg,
              customer.family_id,
              customer.customer_key,
            ).run();
            unknown += 1;
            continue;
          }
          if (providerSettlement.status !== "paid") {
            failed += 1;
            continue;
          }
        }
        const finalized = trialConversion
          ? await finalizeTrialConversionWebBilling(env, {
            familyId: customer.family_id,
            customerKey: customer.customer_key,
            plan: customer.plan,
            orderId,
            providerReservationRef: providerState.reservation_ref,
            trialEndsAt: billingAnchor,
            periodEnd: persistedAttempt.period_end,
            now,
          })
          : await finalizeRenewalWebBilling(env, {
            familyId: customer.family_id,
            customerKey: customer.customer_key,
            plan: customer.plan,
            orderId,
            providerReservationRef: providerState.reservation_ref,
            previousPeriodEnd: billingAnchor,
            // unknown POST를 뒤늦게 order 조회로 확정할 때도 최초 청구 시점에
            // 저장한 기간을 사용한다. reconcile 지연만큼 만료일이 늘어나면 안 된다.
            periodEnd: persistedAttempt.period_end,
            now,
          });
        if (finalized) renewed += 1;
      } else if (outcome.status === "failed") {
        const failureResult = await recordRenewalFailure(env, customer, orderId, now);
        if (failureResult !== "skipped") {
          failed += 1;
        }
        if (failureResult === "expired") {
          await attemptWebBillingKeyRevocation(env, {
            familyId: customer.family_id,
            now,
            fetchImpl: options.fetchImpl,
            config,
            force: true,
          });
        }
      } else if (outcome.status === "unknown") {
        await env.DB.prepare(
          `UPDATE web_billing_customers SET retry_after=?, updated_at=?
            WHERE family_id=? AND customer_key=? AND status IN ('trial','active','past_due')`,
        ).bind(pgTs(new Date(now.getTime() + 15 * 60 * 1000)), nowPg, customer.family_id, customer.customer_key).run();
        unknown += 1;
      }
    } finally {
      await releaseAccountMutationLeases(env.DB, leaseResult.leases);
    }
  }
  return {
    configured: true,
    ...trials,
    ...initial,
    ...revocations,
    checked,
    renewed,
    failed,
    unknown,
  };
}

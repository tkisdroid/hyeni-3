import type { Env } from "../types";

export type StudyCleanupSourceKind =
  | "child_deactivate"
  | "family_unpair"
  | "account_delete";

export type StudyCleanupTarget = Readonly<{
  familyId: string;
  memberId: string;
}>;

export type StudyCleanupEnqueue = Readonly<{
  sourceKind: StudyCleanupSourceKind;
  sourceId: string;
  reason: string;
  targets: readonly StudyCleanupTarget[];
  now?: Date;
}>;

type ReceiptRow = Readonly<{
  request_id: string;
  family_id: string;
  child_member_id: string;
  reason: string;
  attempts: number;
}>;

const SAFE_ID = /^[A-Za-z0-9_-]{1,160}$/;
const SAFE_REASON = /^[a-z0-9_:-]{1,120}$/;
const BACKOFF_MINUTES = [1, 5, 15, 30, 60] as const;
const PROCESSING_LEASE_MS = 2 * 60 * 1000;

function uniqueTargets(targets: readonly StudyCleanupTarget[]): StudyCleanupTarget[] {
  const unique = new Map<string, StudyCleanupTarget>();
  for (const target of targets) {
    const familyId = String(target.familyId ?? "").trim();
    const memberId = String(target.memberId ?? "").trim();
    if (!SAFE_ID.test(familyId) || !SAFE_ID.test(memberId)) {
      throw new Error("invalid_study_cleanup_target");
    }
    unique.set(`${familyId}\0${memberId}`, { familyId, memberId });
  }
  return [...unique.values()];
}

function checkedInput(input: StudyCleanupEnqueue): Required<StudyCleanupEnqueue> {
  const sourceId = String(input.sourceId ?? "").trim();
  const reason = String(input.reason ?? "").trim();
  const now = input.now ?? new Date();
  if (!sourceId || sourceId.length > 320 || !SAFE_REASON.test(reason)) {
    throw new Error("invalid_study_cleanup_scope");
  }
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error("invalid_study_cleanup_clock");
  }
  return {
    ...input,
    sourceId,
    reason,
    targets: uniqueTargets(input.targets),
    now,
  };
}

export function studyCleanupSourceIdForChild(
  familyId: string,
  childUserId: string,
): string {
  if (!SAFE_ID.test(familyId) || !SAFE_ID.test(childUserId)) {
    throw new Error("invalid_study_cleanup_scope");
  }
  return `${familyId}/${childUserId}`;
}

export function studyLinkCleanupReceiptStmts(
  db: D1Database,
  rawInput: StudyCleanupEnqueue,
): D1PreparedStatement[] {
  const input = checkedInput(rawInput);
  const now = input.now.toISOString();
  return input.targets.map((target) => db.prepare(
    `INSERT INTO study_link_cleanup_receipts
       (request_id,source_kind,source_id,family_id,child_member_id,reason,status,
        attempts,last_error_code,next_attempt_at,completed_at,created_at,updated_at)
     VALUES (?,?,?,?,?,?,'pending',0,NULL,?,NULL,?,?)
     ON CONFLICT(source_kind,source_id,family_id,child_member_id) DO NOTHING`,
  ).bind(
    crypto.randomUUID(),
    input.sourceKind,
    input.sourceId,
    target.familyId,
    target.memberId,
    input.reason,
    now,
    now,
    now,
  ));
}

function guardedReceiptStmts(
  db: D1Database,
  rawInput: StudyCleanupEnqueue,
  guardSql: string,
  guardBindings: readonly string[],
): D1PreparedStatement[] {
  const input = checkedInput(rawInput);
  const now = input.now.toISOString();
  return input.targets.map((target) => db.prepare(
    `INSERT INTO study_link_cleanup_receipts
       (request_id,source_kind,source_id,family_id,child_member_id,reason,status,
        attempts,last_error_code,next_attempt_at,completed_at,created_at,updated_at)
     SELECT ?,?,?,?,?,?,'pending',0,NULL,?,NULL,?,?
      WHERE ${guardSql}
     ON CONFLICT(source_kind,source_id,family_id,child_member_id) DO NOTHING`,
  ).bind(
    crypto.randomUUID(),
    input.sourceKind,
    input.sourceId,
    target.familyId,
    target.memberId,
    input.reason,
    now,
    now,
    now,
    ...guardBindings,
  ));
}

export function studyLinkCleanupReceiptStmtsForUnpairJob(
  db: D1Database,
  input: StudyCleanupEnqueue,
  familyId: string,
  childUserId: string,
): D1PreparedStatement[] {
  if (!SAFE_ID.test(familyId) || !SAFE_ID.test(childUserId)) {
    throw new Error("invalid_study_cleanup_scope");
  }
  return guardedReceiptStmts(
    db,
    input,
    "EXISTS(SELECT 1 FROM family_unpair_cleanup_jobs WHERE family_id=? AND child_user_id=?)",
    [familyId, childUserId],
  );
}

export function studyLinkCleanupReceiptStmtForAccountOwner(
  db: D1Database,
  input: Readonly<{ jobId: string; ownerUserId: string; now?: Date }>,
): D1PreparedStatement {
  const jobId = String(input.jobId ?? "").trim();
  const ownerUserId = String(input.ownerUserId ?? "").trim();
  const now = input.now ?? new Date();
  if (!SAFE_ID.test(jobId) || !SAFE_ID.test(ownerUserId)) {
    throw new Error("invalid_study_cleanup_scope");
  }
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error("invalid_study_cleanup_clock");
  }
  const nowIso = now.toISOString();
  return db.prepare(
    `INSERT INTO study_link_cleanup_receipts
       (request_id,source_kind,source_id,family_id,child_member_id,reason,status,
        attempts,last_error_code,next_attempt_at,completed_at,created_at,updated_at)
     SELECT lower(hex(randomblob(16))),'account_delete',?,fm.family_id,fm.id,
            'calendar_account_deleted','pending',0,NULL,?,NULL,?,?
       FROM family_members fm
      WHERE fm.role='child'
        AND (
          fm.user_id=?
          OR EXISTS(
            SELECT 1 FROM families f
             WHERE f.id=fm.family_id AND f.parent_id=?
          )
        )
        AND EXISTS(SELECT 1 FROM account_deletion_jobs WHERE id=?)
     ON CONFLICT(source_kind,source_id,family_id,child_member_id) DO NOTHING`,
  ).bind(jobId, nowIso, nowIso, nowIso, ownerUserId, ownerUserId, jobId);
}

export async function enqueueStudyLinkCleanupReceipts(
  db: D1Database,
  input: StudyCleanupEnqueue,
): Promise<void> {
  const statements = studyLinkCleanupReceiptStmts(db, input);
  if (statements.length > 0) await db.batch(statements);
}

export async function allStudyReceiptsCompleted(
  db: D1Database,
  sourceKind: StudyCleanupSourceKind,
  sourceId: string,
): Promise<boolean> {
  const row = await db.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed
       FROM study_link_cleanup_receipts
      WHERE source_kind=? AND source_id=?`,
  ).bind(sourceKind, sourceId).first<{ total: number; completed: number | null }>();
  return Number(row?.total ?? 0) === Number(row?.completed ?? 0);
}

function stableErrorCode(error: unknown): string {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
  return /^[a-z0-9_]{1,64}$/.test(code) ? code : "study_unavailable";
}

function retryAt(now: Date, attempts: number): string {
  const minutes = BACKOFF_MINUTES[Math.min(Math.max(attempts - 1, 0), BACKOFF_MINUTES.length - 1)]!;
  return new Date(now.getTime() + minutes * 60 * 1000).toISOString();
}

async function processReceiptRows(
  env: Pick<Env, "DB" | "STUDY_SERVICE">,
  rows: readonly ReceiptRow[],
  now: Date,
): Promise<{ processed: number; pending: number }> {
  const nowIso = now.toISOString();
  let processed = 0;
  let pending = 0;
  for (const row of rows) {
    const attempt = Number(row.attempts ?? 0) + 1;
    const leaseUntil = new Date(now.getTime() + PROCESSING_LEASE_MS).toISOString();
    const claimed = await env.DB.prepare(
      `UPDATE study_link_cleanup_receipts
          SET status='processing',attempts=?,next_attempt_at=?,updated_at=?
        WHERE request_id=? AND status<>'completed' AND attempts=? AND next_attempt_at<=?`,
    ).bind(attempt, leaseUntil, nowIso, row.request_id, row.attempts, nowIso).run();
    if (Number(claimed.meta?.changes ?? 0) !== 1) continue;

    try {
      if (!env.STUDY_SERVICE) throw new Error("study_binding_unavailable");
      const receipt = await env.STUDY_SERVICE.deactivateCalendarChildLink(
        row.family_id,
        row.child_member_id,
        row.reason,
        row.request_id,
      );
      if (
        receipt.apiVersion !== "2026-08-24"
        || receipt.requestId !== row.request_id
        || receipt.status !== "completed"
      ) throw new Error("study_invalid_receipt");
      const completed = await env.DB.prepare(
        `UPDATE study_link_cleanup_receipts
            SET status='completed',last_error_code=NULL,completed_at=?,updated_at=?
          WHERE request_id=? AND status='processing' AND attempts=?`,
      ).bind(nowIso, nowIso, row.request_id, attempt).run();
      if (Number(completed.meta?.changes ?? 0) === 1) processed += 1;
    } catch (error) {
      await env.DB.prepare(
        `UPDATE study_link_cleanup_receipts
            SET status='pending',last_error_code=?,next_attempt_at=?,updated_at=?
          WHERE request_id=? AND status='processing' AND attempts=?`,
      ).bind(stableErrorCode(error), retryAt(now, attempt), nowIso, row.request_id, attempt).run();
      pending += 1;
    }
  }
  return { processed, pending };
}

export async function processPendingStudyLinkCleanups(
  env: Pick<Env, "DB" | "STUDY_SERVICE">,
  now = new Date(),
  limit = 20,
): Promise<{ processed: number; pending: number }> {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const nowIso = now.toISOString();
  const rows = await env.DB.prepare(
    `SELECT request_id,family_id,child_member_id,reason,attempts
       FROM study_link_cleanup_receipts
      WHERE status<>'completed' AND next_attempt_at<=?
      ORDER BY next_attempt_at,created_at,request_id
      LIMIT ?`,
  ).bind(nowIso, safeLimit).all<ReceiptRow>();
  return processReceiptRows(env, rows.results ?? [], now);
}

export async function processStudyLinkCleanupsForSource(
  env: Pick<Env, "DB" | "STUDY_SERVICE">,
  sourceKind: StudyCleanupSourceKind,
  sourceId: string,
  now = new Date(),
): Promise<{ processed: number; pending: number }> {
  const checkedSourceId = String(sourceId ?? "").trim();
  if (!checkedSourceId || checkedSourceId.length > 320) {
    throw new Error("invalid_study_cleanup_scope");
  }
  const nowIso = now.toISOString();
  const rows = await env.DB.prepare(
    `SELECT request_id,family_id,child_member_id,reason,attempts
       FROM study_link_cleanup_receipts
      WHERE source_kind=? AND source_id=? AND status<>'completed' AND next_attempt_at<=?
      ORDER BY next_attempt_at,created_at,request_id
      LIMIT 100`,
  ).bind(sourceKind, checkedSourceId, nowIso).all<ReceiptRow>();
  return processReceiptRows(env, rows.results ?? [], now);
}

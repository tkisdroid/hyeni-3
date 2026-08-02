import type { Env } from "../types";
import {
  createServerPremiumFunnelEventId,
  hashPremiumFunnelFamily,
  isPremiumFunnelConfigured,
} from "./premiumFunnel.ts";
import { pgToMs } from "./time.ts";

export type FamilyLifecycleEventName =
  | "family_created"
  | "child_paired"
  | "first_location"
  | "first_arrival";

export type FamilyDailySignal = "parent_active" | "child_signal";

type LifecycleEnv = Pick<Env, "DB" | "PREMIUM_FUNNEL_HASH_SECRET"> | {
  DB: D1Database;
  PREMIUM_FUNNEL_HASH_SECRET?: string;
};

export type FamilyLifecycleRecordResult =
  | { stored: true; duplicate: boolean }
  | { stored: false; reason: "not_configured" | "invalid_input" | "storage_unavailable" };

export type FamilyDailySignalResult =
  | { stored: true }
  | { stored: false; reason: "not_configured" | "invalid_input" | "storage_unavailable" };

interface FamilyFacts {
  created_at: string;
  child_count: number;
}

const EVENTS = new Set<FamilyLifecycleEventName>([
  "family_created",
  "child_paired",
  "first_location",
  "first_arrival",
]);
const SIGNALS = new Set<FamilyDailySignal>(["parent_active", "child_signal"]);
const KST_OFFSET_MS = 9 * 60 * 60_000;
const MAX_SCOPE_LENGTH = 128;

function normalizedScope(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length >= 1 && normalized.length <= MAX_SCOPE_LENGTH ? normalized : null;
}

function normalizedInstant(value: unknown, fallback: Date): { iso: string; ms: number } | null {
  const ms = value == null ? fallback.getTime() : pgToMs(String(value));
  if (!Number.isFinite(ms)) return null;
  return { iso: new Date(ms).toISOString(), ms };
}

function kstActivityDate(atMs: number): string {
  return new Date(atMs + KST_OFFSET_MS).toISOString().slice(0, 10);
}

async function loadFamilyFacts(db: D1Database, familyId: string): Promise<FamilyFacts | null> {
  const row = await db
    .prepare(
      `SELECT f.created_at,
              (SELECT COUNT(*) FROM family_members fm
                WHERE fm.family_id = f.id AND fm.role = 'child'
                  AND fm.is_active = 1 AND fm.user_id IS NOT NULL) AS child_count
         FROM families f
        WHERE f.id = ?
        LIMIT 1`,
    )
    .bind(familyId)
    .first<{ created_at: string; child_count: number }>();
  if (!row?.created_at || !Number.isFinite(pgToMs(row.created_at))) return null;
  return { created_at: row.created_at, child_count: Math.max(0, Number(row.child_count ?? 0)) };
}

function lifecycleInsert(
  db: D1Database,
  row: {
    eventId: string;
    familyKey: string;
    event: FamilyLifecycleEventName;
    elapsedMs: number;
    childCount: number | null;
    childPlatform: "android" | null;
    occurredAt: string;
    receivedAt: string;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT OR IGNORE INTO family_lifecycle_events
         (event_id,family_key,event,elapsed_ms,child_count,child_platform,occurred_at,received_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    )
    .bind(
      row.eventId,
      row.familyKey,
      row.event,
      row.elapsedMs,
      row.childCount,
      row.childPlatform,
      row.occurredAt,
      row.receivedAt,
    );
}

function dailySignalUpsert(
  db: D1Database,
  familyKey: string,
  activityDate: string,
  signal: FamilyDailySignal,
  receivedAt: string,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO family_lifecycle_daily
         (family_key,activity_date,parent_active,child_signal,first_recorded_at,updated_at)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(family_key,activity_date) DO UPDATE SET
         parent_active = MAX(family_lifecycle_daily.parent_active, excluded.parent_active),
         child_signal = MAX(family_lifecycle_daily.child_signal, excluded.child_signal),
         updated_at = excluded.updated_at
       WHERE (excluded.parent_active = 1 AND family_lifecycle_daily.parent_active = 0)
          OR (excluded.child_signal = 1 AND family_lifecycle_daily.child_signal = 0)`,
    )
    .bind(
      familyKey,
      activityDate,
      signal === "parent_active" ? 1 : 0,
      signal === "child_signal" ? 1 : 0,
      receivedAt,
      receivedAt,
    );
}

async function familyCreatedStatement(
  db: D1Database,
  secret: string,
  familyId: string,
  familyKey: string,
  familyCreatedAt: string,
  receivedAt: string,
): Promise<D1PreparedStatement> {
  const eventId = await createServerPremiumFunnelEventId(
    secret,
    JSON.stringify(["family_lifecycle", familyId, "family_created"]),
  );
  return lifecycleInsert(db, {
    eventId,
    familyKey,
    event: "family_created",
    elapsedMs: 0,
    childCount: null,
    childPlatform: null,
    occurredAt: new Date(pgToMs(familyCreatedAt)).toISOString(),
    receivedAt,
  });
}

/**
 * 서버 정본 성공 경로가 호출하는 가족 milestone 기록기다. 모든 오류를 결과로 닫아
 * 가족 생성·페어링·위치·안전 알림 흐름을 절대 실패시키지 않는다.
 */
export async function recordFamilyLifecycleEvent(
  env: LifecycleEnv,
  input: {
    familyId: string;
    event: FamilyLifecycleEventName;
    dedupeKey?: string;
    childPlatform?: "android";
    occurredAt?: string;
  },
  now = new Date(),
): Promise<FamilyLifecycleRecordResult> {
  if (!isPremiumFunnelConfigured(env.PREMIUM_FUNNEL_HASH_SECRET)) {
    return { stored: false, reason: "not_configured" };
  }
  const familyId = normalizedScope(input.familyId);
  const dedupeKey = input.event === "child_paired" ? normalizedScope(input.dedupeKey) : input.event;
  const childPlatform = input.event === "child_paired" && input.childPlatform === "android"
    ? "android"
    : null;
  const occurred = normalizedInstant(input.occurredAt, now);
  if (
    !familyId
    || !EVENTS.has(input.event)
    || !dedupeKey
    || (input.event === "child_paired" && childPlatform !== "android")
    || !occurred
    || !Number.isFinite(now.getTime())
  ) {
    return { stored: false, reason: "invalid_input" };
  }

  try {
    const secret = env.PREMIUM_FUNNEL_HASH_SECRET as string;
    const facts = await loadFamilyFacts(env.DB, familyId);
    if (!facts) return { stored: false, reason: "invalid_input" };
    if (input.event === "child_paired" && facts.child_count < 1) {
      return { stored: false, reason: "invalid_input" };
    }
    const createdAtMs = pgToMs(facts.created_at);
    const receivedAt = now.toISOString();
    const familyKey = await hashPremiumFunnelFamily(secret, familyId);
    const createdStatement = await familyCreatedStatement(
      env.DB,
      secret,
      familyId,
      familyKey,
      facts.created_at,
      receivedAt,
    );
    const statements: D1PreparedStatement[] = [createdStatement];
    let eventResultIndex = 0;

    if (input.event !== "family_created") {
      const eventId = await createServerPremiumFunnelEventId(
        secret,
        JSON.stringify(["family_lifecycle", familyId, input.event, dedupeKey]),
      );
      eventResultIndex = statements.length;
      statements.push(lifecycleInsert(env.DB, {
        eventId,
        familyKey,
        event: input.event,
        elapsedMs: Math.max(0, Math.trunc(occurred.ms - createdAtMs)),
        childCount: input.event === "child_paired" ? facts.child_count : null,
        childPlatform,
        occurredAt: occurred.iso,
        receivedAt,
      }));
    }

    const impliedSignal = input.event === "family_created"
      ? "parent_active"
      : input.event === "child_paired" || input.event === "first_location"
        ? "child_signal"
        : null;
    if (impliedSignal) {
      statements.push(dailySignalUpsert(
        env.DB,
        familyKey,
        kstActivityDate(occurred.ms),
        impliedSignal,
        receivedAt,
      ));
    }

    const results = await env.DB.batch(statements);
    return {
      stored: true,
      duplicate: Number(results[eventResultIndex]?.meta?.changes ?? 0) !== 1,
    };
  } catch {
    return { stored: false, reason: "storage_unavailable" };
  }
}

/** 부모 세션 활동과 자녀 기기 신호를 가족·KST 날짜별 불리언 fact로 합친다. */
export async function recordFamilyDailySignal(
  env: LifecycleEnv,
  input: { familyId: string; signal: FamilyDailySignal; occurredAt?: string },
  now = new Date(),
): Promise<FamilyDailySignalResult> {
  if (!isPremiumFunnelConfigured(env.PREMIUM_FUNNEL_HASH_SECRET)) {
    return { stored: false, reason: "not_configured" };
  }
  const familyId = normalizedScope(input.familyId);
  const occurred = normalizedInstant(input.occurredAt, now);
  if (!familyId || !SIGNALS.has(input.signal) || !occurred || !Number.isFinite(now.getTime())) {
    return { stored: false, reason: "invalid_input" };
  }

  try {
    const secret = env.PREMIUM_FUNNEL_HASH_SECRET as string;
    const facts = await loadFamilyFacts(env.DB, familyId);
    if (!facts) return { stored: false, reason: "invalid_input" };
    const receivedAt = now.toISOString();
    const familyKey = await hashPremiumFunnelFamily(secret, familyId);
    await env.DB.batch([
      await familyCreatedStatement(
        env.DB,
        secret,
        familyId,
        familyKey,
        facts.created_at,
        receivedAt,
      ),
      dailySignalUpsert(
        env.DB,
        familyKey,
        kstActivityDate(occurred.ms),
        input.signal,
        receivedAt,
      ),
    ]);
    return { stored: true };
  } catch {
    return { stored: false, reason: "storage_unavailable" };
  }
}

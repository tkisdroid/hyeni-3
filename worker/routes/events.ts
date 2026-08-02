// 일정 read API. sync.js fetchEvents 의 PostgREST 쿼리를 D1 SQL로 직역.
// D1은 jsonb를 TEXT로, boolean을 0/1로 저장하므로 Supabase 응답 형태로 역직렬화한다.
import { Hono } from "hono";
import type { Env, Vars } from "../types";
import { requireAuth } from "../middleware/auth";
import { pgNow } from "../lib/time";
import { assertFamilyAccess, assertPrimaryParent, serviceLimitForFamily } from "../db/authz";
import { parseJson } from "../lib/serialize";
import { notifyPg } from "../lib/realtime";
import { chunkSqlVariables } from "../lib/sqlChunk";
import {
  buildEventBatchStatements,
  buildEventDeleteStatements,
  detectEventBatchConflict,
  EventBatchError,
  isAtomicEventBatchGuardError,
  normalizeEventTimeForResponse,
  validateEventBatch as validateEventBatchCore,
  type RawEventWriteInput,
  type ValidatedEventBatch,
} from "../lib/eventBatch";

const events = new Hono<{ Bindings: Env; Variables: Vars }>();

const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 5000;
const EVENT_CHILD_QUERY_CHUNK = 90;

// jsonb 컬럼(객체↔TEXT)과 boolean 컬럼(0/1) 구분. write 시 직렬화에 사용.
const EVENT_JSON_COLS = new Set(["location", "notif_override"]);
const EVENT_UPDATABLE = new Set([
  "date_key", "title", "time", "category", "emoji", "color", "bg",
  "memo", "location", "notif_override", "end_time", "is_family_event", "series_id",
]);

function serializeEventVal(col: string, v: unknown): unknown {
  if (EVENT_JSON_COLS.has(col)) return v != null ? JSON.stringify(v) : null;
  if (col === "is_family_event") return v ? 1 : 0;
  if (col === "time" && v == null) return "";
  return v ?? null;
}

async function currentEventCount(db: D1Database, familyId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM events WHERE family_id = ?")
    .bind(familyId)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

function scheduleLimitResponse(c: { json: (data: unknown, status?: number) => Response }, limit: number, count: number): Response {
  return c.json({
    error: `현재 플랜에서는 일정 ${limit}개까지 저장할 수 있어요.`,
    code: "schedule_limit_reached",
    limit,
    count,
  }, 403);
}

async function assertScheduleCreateLimit(c: { env: Env; json: (data: unknown, status?: number) => Response }, familyId: string): Promise<Response | null> {
  const limit = await serviceLimitForFamily(c.env.DB, familyId, "schedule");
  if (limit == null) return null;
  const count = await currentEventCount(c.env.DB, familyId);
  return count >= limit ? scheduleLimitResponse(c, limit, count) : null;
}

// 저장된 events 행을 Supabase 응답 형태로 역직렬화(write 응답 + DO 통지 payload 공용).
function hydrateEvent(row: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!row) return null;
  return {
    ...row,
    time: normalizeEventTimeForResponse(row.time),
    location: parseJson(row.location),
    notif_override: parseJson(row.notif_override),
    is_family_event: !!row.is_family_event,
  };
}

async function validateEventBatch(
  db: D1Database,
  userId: string,
  inputs: unknown,
): Promise<ValidatedEventBatch> {
  return validateEventBatchCore(db, userId, inputs, {
    assertPrimaryParent,
    serviceLimitForFamily: (targetDb, familyId) => serviceLimitForFamily(targetDb, familyId, "schedule"),
  });
}

async function loadSavedEventBatch(
  db: D1Database,
  ids: readonly string[],
): Promise<Record<string, unknown>[]> {
  const rowsById = new Map<string, Record<string, unknown>>();
  const childrenByEvent = new Map<string, { child_id: string }[]>();
  for (const chunk of chunkSqlVariables(ids, EVENT_CHILD_QUERY_CHUNK)) {
    const placeholders = chunk.map(() => "?").join(",");
    const { results: rows } = await db
      .prepare(`SELECT * FROM events WHERE id IN (${placeholders})`)
      .bind(...chunk)
      .all<Record<string, unknown>>();
    for (const row of rows ?? []) rowsById.set(String(row.id), row);

    const { results: links } = await db
      .prepare(`SELECT event_id, child_id FROM events_children WHERE event_id IN (${placeholders})`)
      .bind(...chunk)
      .all<{ event_id: string; child_id: string }>();
    for (const link of links ?? []) {
      const eventId = String(link.event_id);
      const current = childrenByEvent.get(eventId) ?? [];
      current.push({ child_id: String(link.child_id) });
      childrenByEvent.set(eventId, current);
    }
  }

  return ids.map((id) => {
    const hydrated = hydrateEvent(rowsById.get(id) ?? null);
    if (!hydrated) {
      throw new Error(`saved event missing after atomic batch: ${id}`);
    }
    return { ...hydrated, events_children: childrenByEvent.get(id) ?? [] };
  });
}

async function persistEventBatch(
  c: { env: Env },
  userId: string,
  inputs: unknown,
): Promise<Record<string, unknown>[]> {
  const validated = await validateEventBatch(c.env.DB, userId, inputs);
  const statements = buildEventBatchStatements(c.env.DB, userId, validated, pgNow());
  try {
    // event + events_children + 이전 pending/push_sent 취소를 한 D1 트랜잭션으로 처리한다.
    await c.env.DB.batch(statements);
  } catch (error) {
    if (!isAtomicEventBatchGuardError(error)) throw error;
    const conflict = await detectEventBatchConflict(c.env.DB, userId, validated);
    if (conflict === "forbidden") {
      throw new EventBatchError(403, "forbidden", "일정을 저장할 권한이 없어요.");
    }
    if (conflict === "invalid_child_assignment") {
      throw new EventBatchError(400, "invalid_child_assignment", "현재 가족의 활성 아이만 일정에 배정할 수 있어요.");
    }
    if (conflict === "schedule_limit" && validated.limit != null) {
      const row = await c.env.DB
        .prepare("SELECT COUNT(*) AS n FROM events WHERE family_id = ?")
        .bind(validated.familyId)
        .first<{ n: number }>();
      throw new EventBatchError(
        403,
        "schedule_limit_reached",
        `현재 플랜에서는 일정 ${validated.limit}개까지 저장할 수 있어요.`,
        { limit: validated.limit, count: Number(row?.n ?? 0) + validated.newCount },
      );
    }
    if (conflict === "concurrent_modification") {
      throw new EventBatchError(409, "concurrent_modification", "일정이 다른 곳에서 변경되었어요. 다시 불러와 주세요.");
    }
    throw error;
  }

  const saved = await loadSavedEventBatch(c.env.DB, validated.inputs.map((input) => input.id));
  await Promise.all(saved.map((row, index) => notifyPg(
    c.env,
    validated.familyId,
    "events",
    validated.inputs[index].existing ? "UPDATE" : "INSERT",
    row,
    null,
  )));
  return saved;
}

function eventBatchErrorResponse(
  c: { json: (data: unknown, status?: number) => Response },
  error: EventBatchError,
): Response {
  return c.json({
    error: error.message,
    code: error.code,
    ...(error.limit == null ? {} : { limit: error.limit }),
    ...(error.count == null ? {} : { count: error.count }),
  }, error.status);
}

// GET /api/events?family_id=...&limit=N
events.get("/", requireAuth, async (c) => {
  const familyId = c.req.query("family_id") ?? "";
  const limit = Math.min(Number(c.req.query("limit")) || DEFAULT_LIMIT, MAX_LIMIT);
  const user = c.get("user");

  // RLS family 격리 대체: 요청 family_id가 사용자 소속인지 검증
  if (!(await assertFamilyAccess(c.env.DB, user.sub, familyId))) {
    return c.json({ error: "forbidden" }, 403);
  }

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM events
     WHERE family_id = ?
     ORDER BY date_key DESC, id DESC
     LIMIT ?`,
  )
    .bind(familyId, limit)
    .all<Record<string, unknown>>();
  const rows = results ?? [];

  // events_children M:N 조인 (N+1 회피, 단일 IN 쿼리)
  const ids = rows.map((e) => e.id as string);
  const childByEvent: Record<string, { child_id: string }[]> = {};
  for (const chunk of chunkSqlVariables(ids, EVENT_CHILD_QUERY_CHUNK)) {
    const ph = chunk.map(() => "?").join(",");
    const { results: kids } = await c.env.DB.prepare(
      `SELECT event_id, child_id FROM events_children WHERE event_id IN (${ph})`,
    )
      .bind(...chunk)
      .all<{ event_id: string; child_id: string }>();
    for (const k of kids ?? []) {
      (childByEvent[k.event_id] ??= []).push({ child_id: k.child_id });
    }
  }

  // Supabase 응답 형태로 역직렬화 (jsonb→객체, 0/1→boolean, 조인 배열 첨부)
  const out = rows.map((e) => ({
    ...e,
    time: normalizeEventTimeForResponse(e.time),
    location: parseJson(e.location),
    notif_override: parseJson(e.notif_override),
    is_family_event: !!e.is_family_event,
    events_children: childByEvent[e.id as string] ?? [],
  }));

  return c.json(out);
});

// GET /api/events/:id — 단건 + events_children 조인 (sync.js fetchEventById 직역).
// realtime 핸들러가 INSERT/UPDATE payload를 보강할 때 사용. family 격리는 행의
// family_id가 호출자 소속인지로 검증한다(없는 id/타가족이면 404).
events.get("/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");

  const row = await c.env.DB.prepare(`SELECT * FROM events WHERE id = ?`)
    .bind(id)
    .first<Record<string, unknown>>();
  if (!row) return c.json({ error: "not_found" }, 404);

  if (!(await assertFamilyAccess(c.env.DB, user.sub, String(row.family_id)))) {
    // 존재 노출 회피: 권한 없으면 404로 통일
    return c.json({ error: "not_found" }, 404);
  }

  const { results: kids } = await c.env.DB.prepare(
    `SELECT child_id FROM events_children WHERE event_id = ?`,
  )
    .bind(id)
    .all<{ child_id: string }>();

  return c.json({
    ...row,
    time: normalizeEventTimeForResponse(row.time),
    location: parseJson(row.location),
    notif_override: parseJson(row.notif_override),
    is_family_event: !!row.is_family_event,
    events_children: (kids ?? []).map((k) => ({ child_id: k.child_id })),
  });
});

// ── write (primary parent only) ──────────────────────────────────────────────

// POST /api/events/batch — 반복 일정 전체를 서버 검증 후 한 D1 batch로 저장한다.
// body: { inputs: [{ event, childIds, familyAll, expectedUpdatedAt }] }
events.post("/batch", requireAuth, async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ inputs?: unknown }>();
  try {
    return c.json(await persistEventBatch(c, user.sub, body.inputs));
  } catch (error) {
    if (error instanceof EventBatchError) return eventBatchErrorResponse(c, error);
    throw error;
  }
});

// POST /api/events — 단일 일정도 batch 경로와 같은 인가·낙관 잠금·원자 저장을 사용한다.
events.post("/", requireAuth, async (c) => {
  const user = c.get("user");
  const body = await c.req.json<RawEventWriteInput>();
  try {
    const saved = await persistEventBatch(c, user.sub, [body]);
    return c.json(saved[0]);
  } catch (error) {
    if (error instanceof EventBatchError) return eventBatchErrorResponse(c, error);
    throw error;
  }
});

// POST /api/events/simple — insertEvent (단순 row insert, 레거시 경로).
events.post("/simple", requireAuth, async (c) => {
  const user = c.get("user");
  const row = await c.req.json<Record<string, unknown>>();
  const id = String(row.id ?? "");
  const familyId = String(row.family_id ?? "");
  if (!id || !familyId) return c.json({ error: "bad_request" }, 400);
  if (!(await assertPrimaryParent(c.env.DB, user.sub, familyId))) {
    return c.json({ error: "forbidden" }, 403);
  }
  const duplicate = await c.env.DB
    .prepare("SELECT family_id FROM events WHERE id = ?")
    .bind(id)
    .first<{ family_id: string }>();
  if (duplicate) {
    return c.json({ error: "이미 사용 중인 일정 id예요.", code: "event_id_conflict" }, 409);
  }
  const limitRes = await assertScheduleCreateLimit(c, familyId);
  if (limitRes) return limitRes;

  const now = pgNow();
  await c.env.DB.prepare(
    `INSERT INTO events
       (id, family_id, date_key, title, time, category, emoji, color, bg, memo,
        location, notif_override, end_time, series_id, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      // NOT NULL 칼럼은 빈 문자열 graceful default(§7 감사 B 수정 — ?? null 시 500 회피).
      id, familyId, row.date_key ?? "", row.title ?? "", row.time ?? "",
      row.category ?? "", row.emoji ?? "", row.color ?? "", row.bg ?? "",
      row.memo ?? "", serializeEventVal("location", row.location),
      serializeEventVal("notif_override", row.notif_override), row.end_time ?? null, row.series_id ?? null,
      row.created_by ?? user.sub, now, now,
    )
    .run();

  const saved = hydrateEvent(
    await c.env.DB.prepare(`SELECT * FROM events WHERE id = ?`).bind(id).first<Record<string, unknown>>(),
  );
  await notifyPg(c.env, familyId, "events", "INSERT", saved, null);
  return c.json(saved);
});

// PATCH /api/events/:id — updateEvent (부분 갱신; fields 는 snake_case).
events.patch("/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const fields = await c.req.json<Record<string, unknown>>();

  const row = await c.env.DB.prepare(`SELECT family_id, updated_at FROM events WHERE id = ?`)
    .bind(id)
    .first<{ family_id: string; updated_at: string | null }>();
  if (!row) return c.json({ error: "not_found" }, 404);
  if (!(await assertPrimaryParent(c.env.DB, user.sub, row.family_id))) {
    return c.json({ error: "forbidden" }, 403);
  }
  const expectedUpdatedAt = fields.expectedUpdatedAt;
  if (
    expectedUpdatedAt != null &&
    (typeof expectedUpdatedAt !== "string" || expectedUpdatedAt !== row.updated_at)
  ) {
    return c.json({ error: "일정이 다른 곳에서 변경되었어요. 다시 불러와 주세요.", code: "concurrent_modification" }, 409);
  }

  const sets: string[] = [];
  const binds: unknown[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (!EVENT_UPDATABLE.has(k)) continue;
    sets.push(`${k} = ?`);
    binds.push(serializeEventVal(k, v));
  }
  if (sets.length) {
    sets.push(`updated_at = ?`);
    binds.push(pgNow());
    binds.push(id, row.family_id, row.updated_at);
    const statements = [
      c.env.DB.prepare(
        `SELECT CASE WHEN EXISTS(
           SELECT 1 FROM events WHERE id=? AND family_id=? AND updated_at IS ?
         ) THEN 1 ELSE json_extract('event_patch_conflict', '$') END AS ok`,
      ).bind(id, row.family_id, row.updated_at),
      c.env.DB.prepare(
        `UPDATE events SET ${sets.join(", ")} WHERE id = ? AND family_id = ? AND updated_at IS ?`,
      ).bind(...binds),
      c.env.DB.prepare(
        `DELETE FROM pending_notifications
          WHERE family_id = ?
            AND (
              CASE WHEN json_valid(data) THEN json_extract(data, '$.eventId') ELSE NULL END = ?
              OR CASE WHEN json_valid(data) THEN json_extract(data, '$.event_id') ELSE NULL END = ?
            )`,
      ).bind(row.family_id, id, id),
      c.env.DB.prepare("DELETE FROM push_sent WHERE event_id = ?").bind(id),
    ];
    try {
      await c.env.DB.batch(statements);
    } catch (error) {
      if (isAtomicEventBatchGuardError(error)) {
        return c.json({ error: "일정이 다른 곳에서 변경되었어요. 다시 불러와 주세요.", code: "concurrent_modification" }, 409);
      }
      throw error;
    }
  }

  const saved = hydrateEvent(
    await c.env.DB.prepare(`SELECT * FROM events WHERE id = ?`).bind(id).first<Record<string, unknown>>(),
  );
  await notifyPg(c.env, row.family_id, "events", "UPDATE", saved, null);
  return c.json(saved);
});

// DELETE /api/events/:id — deleteEvent.
events.delete("/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const row = await c.env.DB.prepare(`SELECT family_id, updated_at FROM events WHERE id = ?`)
    .bind(id)
    .first<{ family_id: string; updated_at: string | null }>();
  if (!row) return c.json({ ok: true }); // 이미 없음 — 멱등
  if (!(await assertPrimaryParent(c.env.DB, user.sub, row.family_id))) {
    return c.json({ error: "forbidden" }, 403);
  }

  try {
    await c.env.DB.batch(buildEventDeleteStatements(c.env.DB, {
      id,
      familyId: row.family_id,
      expectedUpdatedAt: row.updated_at,
    }));
  } catch (error) {
    if (isAtomicEventBatchGuardError(error)) {
      return c.json({ error: "일정이 다른 곳에서 변경되었어요. 다시 시도해 주세요.", code: "concurrent_modification" }, 409);
    }
    throw error;
  }
  await notifyPg(c.env, row.family_id, "events", "DELETE", null, { id });
  return c.json({ ok: true });
});

export default events;

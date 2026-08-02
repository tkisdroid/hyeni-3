// 학원 read API. sync.js fetchAcademies 의 PostgREST 쿼리를 D1 SQL로 직역.
// location/schedule 은 jsonb(TEXT 저장)이므로 객체로 역직렬화한다.
import { Hono, type Context } from "hono";
import type { Env, Vars } from "../types";
import { requireAuth } from "../middleware/auth";
import { pgNow } from "../lib/time";
import { parseJson } from "../lib/serialize";
import { notifyPg } from "../lib/realtime";
import { authorizeAcademyDataAccess, type AcademyDataAction } from "../lib/academyDataAccess";

const academies = new Hono<{ Bindings: Env; Variables: Vars }>();
type Ctx = Context<{ Bindings: Env; Variables: Vars }>;

const ACADEMY_JSON_COLS = new Set(["location", "schedule"]);
const ACADEMY_UPDATABLE = new Set(["name", "emoji", "category", "location", "schedule"]);
const serAcademy = (col: string, v: unknown) =>
  ACADEMY_JSON_COLS.has(col) ? (v != null ? JSON.stringify(v) : null) : (v ?? null);
const hydrateAcademy = (r: Record<string, unknown> | null) =>
  r ? { ...r, location: parseJson(r.location), schedule: parseJson(r.schedule) } : null;

async function academyGate(
  c: Ctx,
  familyId: string,
  action: AcademyDataAction,
): Promise<Response | null> {
  const access = await authorizeAcademyDataAccess(c.env.DB, {
    callerUserId: c.get("user").sub,
    familyId,
    action,
  });
  if (access.ok) return null;
  return access.status === 503
    ? c.json({ error: access.error }, 503)
    : c.json({ error: access.error }, 403);
}

// GET /api/academies?family_id=...
academies.get("/", requireAuth, async (c) => {
  const familyId = c.req.query("family_id") ?? "";
  const denied = await academyGate(c, familyId, "read");
  if (denied) return denied;

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM academies WHERE family_id = ?`,
  )
    .bind(familyId)
    .all<Record<string, unknown>>();

  const out = (results ?? []).map((a) => ({
    ...a,
    location: parseJson(a.location),
    schedule: parseJson(a.schedule),
  }));

  return c.json(out);
});

// ── write (Premium + primary parent only, 삭제는 구독 종료 뒤에도 허용) ────────

// POST /api/academies — insertAcademy
academies.post("/", requireAuth, async (c) => {
  const row = await c.req.json<Record<string, unknown>>();
  const familyId = String(row.family_id ?? "");
  const denied = await academyGate(c, familyId, "write");
  if (denied) return denied;
  const now = pgNow();
  await c.env.DB.prepare(
    `INSERT INTO academies (id, family_id, name, emoji, category, location, schedule, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      row.id, familyId, row.name ?? null, row.emoji ?? null, row.category ?? null,
      serAcademy("location", row.location), serAcademy("schedule", row.schedule), now, now,
    )
    .run();
  const saved = hydrateAcademy(
    await c.env.DB.prepare(`SELECT * FROM academies WHERE id = ?`).bind(row.id).first<Record<string, unknown>>(),
  );
  await notifyPg(c.env, familyId, "academies", "INSERT", saved, null);
  return c.json(saved);
});

// PATCH /api/academies/:id — updateAcademy
academies.patch("/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  const fields = await c.req.json<Record<string, unknown>>();
  const row = await c.env.DB.prepare(`SELECT family_id FROM academies WHERE id = ?`)
    .bind(id).first<{ family_id: string }>();
  if (!row) return c.json({ error: "not_found" }, 404);
  const denied = await academyGate(c, row.family_id, "write");
  if (denied) return denied;
  const sets: string[] = [];
  const binds: unknown[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (!ACADEMY_UPDATABLE.has(k)) continue;
    sets.push(`${k} = ?`);
    binds.push(serAcademy(k, v));
  }
  if (sets.length) {
    sets.push(`updated_at = ?`);
    binds.push(pgNow());
    binds.push(id);
    await c.env.DB.prepare(`UPDATE academies SET ${sets.join(", ")} WHERE id = ?`).bind(...binds).run();
  }
  const saved = hydrateAcademy(
    await c.env.DB.prepare(`SELECT * FROM academies WHERE id = ?`).bind(id).first<Record<string, unknown>>(),
  );
  await notifyPg(c.env, row.family_id, "academies", "UPDATE", saved, null);
  return c.json(saved);
});

// DELETE /api/academies/:id — deleteAcademy
academies.delete("/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(`SELECT family_id FROM academies WHERE id = ?`)
    .bind(id).first<{ family_id: string }>();
  if (!row) return c.json({ ok: true });
  const denied = await academyGate(c, row.family_id, "delete");
  if (denied) return denied;
  await c.env.DB.prepare(`DELETE FROM academies WHERE id = ?`).bind(id).run();
  await notifyPg(c.env, row.family_id, "academies", "DELETE", null, { id });
  return c.json({ ok: true });
});

export default academies;

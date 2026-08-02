// 저장 장소 read API. sync.js fetchSavedPlaces 의 PostgREST 쿼리를 D1 SQL로 직역.
// location 은 jsonb(객체), is_home/is_playdate_safe 는 boolean(0/1→true/false).
import { Hono } from "hono";
import type { Env, Vars } from "../types";
import { requireAuth } from "../middleware/auth";
import { pgNow } from "../lib/time";
import { assertFamilyAccess, assertPrimaryParent, serviceLimitForFamily } from "../db/authz";
import { parseJson, toBool } from "../lib/serialize";
import { notifyPg } from "../lib/realtime";
import { annotateTierAlertActivation } from "../lib/tierAlertActivation";

const savedPlaces = new Hono<{ Bindings: Env; Variables: Vars }>();

const SP_UPDATABLE = new Set(["name", "location", "is_home", "is_playdate_safe", "public_place_id"]);
const serSp = (col: string, v: unknown) => {
  if (col === "location") return v != null ? JSON.stringify(v) : null;
  if (col === "is_home" || col === "is_playdate_safe") return v ? 1 : 0;
  return v ?? null;
};
const hydrateSp = (r: Record<string, unknown> | null) =>
  r ? { ...r, location: parseJson(r.location), is_home: toBool(r.is_home), is_playdate_safe: toBool(r.is_playdate_safe) } : null;

async function currentSavedPlaceCount(db: D1Database, familyId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM saved_places WHERE family_id = ?")
    .bind(familyId)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

// GET /api/saved-places?family_id=...
savedPlaces.get("/", requireAuth, async (c) => {
  const familyId = c.req.query("family_id") ?? "";
  const user = c.get("user");

  if (!(await assertFamilyAccess(c.env.DB, user.sub, familyId))) {
    return c.json({ error: "forbidden" }, 403);
  }

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM saved_places WHERE family_id = ? ORDER BY substr(created_at,1,19) ASC, id ASC`,
  )
    .bind(familyId)
    .all<Record<string, unknown> & { id: string; created_at: string }>();

  const out = (results ?? []).map((p) => ({
    ...p,
    location: parseJson(p.location),
    is_home: toBool(p.is_home),
    is_playdate_safe: toBool(p.is_playdate_safe),
  }));
  const limit = await serviceLimitForFamily(c.env.DB, familyId, "saved_place");

  return c.json(annotateTierAlertActivation(out, limit));
});

// ── write (primary parent only) ──────────────────────────────────────────────

// POST /api/saved-places — insertSavedPlace
savedPlaces.post("/", requireAuth, async (c) => {
  const user = c.get("user");
  const row = await c.req.json<Record<string, unknown>>();
  const familyId = String(row.family_id ?? "");
  if (!(await assertPrimaryParent(c.env.DB, user.sub, familyId))) {
    return c.json({ error: "forbidden" }, 403);
  }
  const limit = await serviceLimitForFamily(c.env.DB, familyId, "saved_place");
  const id = typeof row.id === "string" && row.id.trim() ? row.id.trim() : crypto.randomUUID();
  const now = pgNow();
  const values = [
    id, familyId, row.name ?? null, serSp("location", row.location),
    serSp("is_home", row.is_home), serSp("is_playdate_safe", row.is_playdate_safe),
    row.public_place_id ?? null, now, now,
  ];
  const inserted = limit == null
    ? await c.env.DB.prepare(
      `INSERT INTO saved_places (id, family_id, name, location, is_home, is_playdate_safe, public_place_id, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).bind(...values).run()
    : await c.env.DB.prepare(
      `INSERT INTO saved_places (id, family_id, name, location, is_home, is_playdate_safe, public_place_id, created_at, updated_at)
       SELECT ?,?,?,?,?,?,?,?,?
        WHERE (SELECT COUNT(*) FROM saved_places WHERE family_id = ?) < ?`,
    ).bind(...values, familyId, limit).run();
  if (limit != null && (inserted.meta.changes ?? 0) !== 1) {
    const count = await currentSavedPlaceCount(c.env.DB, familyId);
    return c.json({
      error: `현재 플랜에서는 장소 ${limit}개까지 저장할 수 있어요.`,
      code: "saved_place_limit_reached",
      limit,
      count,
    }, 403);
  }
  const saved = hydrateSp(
    await c.env.DB.prepare(`SELECT * FROM saved_places WHERE id = ?`).bind(id).first<Record<string, unknown>>(),
  );
  await notifyPg(c.env, familyId, "saved_places", "INSERT", saved, null);
  return c.json(saved);
});

// PATCH /api/saved-places/:id — updateSavedPlace
savedPlaces.patch("/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const fields = await c.req.json<Record<string, unknown>>();
  const row = await c.env.DB.prepare(`SELECT family_id FROM saved_places WHERE id = ?`)
    .bind(id).first<{ family_id: string }>();
  if (!row) return c.json({ error: "not_found" }, 404);
  if (!(await assertPrimaryParent(c.env.DB, user.sub, row.family_id))) {
    return c.json({ error: "forbidden" }, 403);
  }
  const sets: string[] = [];
  const binds: unknown[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (!SP_UPDATABLE.has(k)) continue;
    sets.push(`${k} = ?`);
    binds.push(serSp(k, v));
  }
  if (sets.length) {
    sets.push(`updated_at = ?`);
    binds.push(pgNow());
    binds.push(id);
    await c.env.DB.prepare(`UPDATE saved_places SET ${sets.join(", ")} WHERE id = ?`).bind(...binds).run();
  }
  const saved = hydrateSp(
    await c.env.DB.prepare(`SELECT * FROM saved_places WHERE id = ?`).bind(id).first<Record<string, unknown>>(),
  );
  await notifyPg(c.env, row.family_id, "saved_places", "UPDATE", saved, null);
  return c.json(saved);
});

// DELETE /api/saved-places/:id — deleteSavedPlace
savedPlaces.delete("/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const row = await c.env.DB.prepare(`SELECT family_id FROM saved_places WHERE id = ?`)
    .bind(id).first<{ family_id: string }>();
  if (!row) return c.json({ ok: true });
  if (!(await assertPrimaryParent(c.env.DB, user.sub, row.family_id))) {
    return c.json({ error: "forbidden" }, 403);
  }
  await c.env.DB.prepare(`DELETE FROM saved_places WHERE id = ?`).bind(id).run();
  await notifyPg(c.env, row.family_id, "saved_places", "DELETE", null, { id });
  return c.json({ ok: true });
});

export default savedPlaces;

// 위험지역 read API. sync.js fetchDangerZones 의 PostgREST 쿼리를 D1 SQL로 직역.
// 컬럼이 전부 스칼라(lat/lng/radius_m 숫자, name/zone_type 텍스트)라 변환 불필요.
import { Hono } from "hono";
import type { Env, Vars } from "../types";
import { requireAuth } from "../middleware/auth";
import { pgNow } from "../lib/time";
import { assertFamilyAccess, assertPrimaryParent, serviceLimitForFamily } from "../db/authz";
import { notifyPg } from "../lib/realtime";
import { annotateTierAlertActivation } from "../lib/tierAlertActivation";

const dangerZones = new Hono<{ Bindings: Env; Variables: Vars }>();

async function currentDangerZoneCount(db: D1Database, familyId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM danger_zones WHERE family_id = ?")
    .bind(familyId)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

function toDbBool(value: unknown, fallback: boolean): number {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return value === 0 ? 0 : 1;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "0" || v === "false" || v === "off") return 0;
    if (v === "1" || v === "true" || v === "on") return 1;
  }
  return fallback ? 1 : 0;
}

// GET /api/danger-zones?family_id=...
dangerZones.get("/", requireAuth, async (c) => {
  const familyId = c.req.query("family_id") ?? "";
  const user = c.get("user");

  if (!(await assertFamilyAccess(c.env.DB, user.sub, familyId))) {
    return c.json({ error: "forbidden" }, 403);
  }

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM danger_zones WHERE family_id = ? ORDER BY substr(created_at,1,19) ASC, id ASC`,
  )
    .bind(familyId)
    .all<Record<string, unknown> & { id: string; created_at: string }>();

  const limit = await serviceLimitForFamily(c.env.DB, familyId, "danger_zone");
  return c.json(annotateTierAlertActivation(results ?? [], limit));
});

// ── write (primary parent only) ──────────────────────────────────────────────

// POST /api/danger-zones — saveDangerZone (zone.id 있으면 update, 없으면 insert)
// body: { familyId, zone: { id?, name, lat, lng, radius_m?, zone_type? } }
dangerZones.post("/", requireAuth, async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ familyId: string; zone: Record<string, unknown> }>();
  const familyId = String(body.familyId ?? "");
  const zone = body.zone ?? {};
  if (!(await assertPrimaryParent(c.env.DB, user.sub, familyId))) {
    return c.json({ error: "forbidden" }, 403);
  }
  const radius = zone.radius_m ?? 200;
  const zoneType = zone.zone_type ?? "custom";
  const alertOnEntry = toDbBool(zone.alert_on_entry, true);
  const alertOnExit = toDbBool(zone.alert_on_exit, false);

  if (zone.id) {
    const updated = await c.env.DB.prepare(
      `UPDATE danger_zones
          SET name = ?, lat = ?, lng = ?, radius_m = ?, zone_type = ?,
              alert_on_entry = ?, alert_on_exit = ?
        WHERE id = ? AND family_id = ?`,
    )
      .bind(
        zone.name ?? null,
        zone.lat ?? null,
        zone.lng ?? null,
        radius,
        zoneType,
        alertOnEntry,
        alertOnExit,
        zone.id,
        familyId,
      )
      .run();
    if (!updated.meta.changes) return c.json({ error: "not_found" }, 404);
    const saved = await c.env.DB.prepare(
      `SELECT * FROM danger_zones WHERE id = ? AND family_id = ?`,
    )
      .bind(zone.id, familyId).first<Record<string, unknown>>();
    if (!saved) return c.json({ error: "not_found" }, 404);
    await notifyPg(c.env, familyId, "danger_zones", "UPDATE", saved, null);
    return c.json(saved);
  }

  const limit = await serviceLimitForFamily(c.env.DB, familyId, "danger_zone");
  const id = crypto.randomUUID();
  const now = pgNow();
  const values = [
    id,
    familyId,
    zone.name ?? null,
    zone.lat ?? null,
    zone.lng ?? null,
    radius,
    zoneType,
    alertOnEntry,
    alertOnExit,
    now,
  ];
  const inserted = limit == null
    ? await c.env.DB.prepare(
      `INSERT INTO danger_zones
         (id, family_id, name, lat, lng, radius_m, zone_type, alert_on_entry, alert_on_exit, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).bind(...values).run()
    : await c.env.DB.prepare(
      `INSERT INTO danger_zones
         (id, family_id, name, lat, lng, radius_m, zone_type, alert_on_entry, alert_on_exit, created_at)
       SELECT ?,?,?,?,?,?,?,?,?,?
        WHERE (SELECT COUNT(*) FROM danger_zones WHERE family_id = ?) < ?`,
    ).bind(...values, familyId, limit).run();
  if (limit != null && (inserted.meta.changes ?? 0) !== 1) {
    const count = await currentDangerZoneCount(c.env.DB, familyId);
    return c.json({
      error: "위험구역을 여러 개 쓰려면 프리미엄이 필요해요.",
      code: "danger_zone_limit_reached",
      limit,
      count,
    }, 403);
  }
  const saved = await c.env.DB.prepare(`SELECT * FROM danger_zones WHERE id = ?`)
    .bind(id).first<Record<string, unknown>>();
  await notifyPg(c.env, familyId, "danger_zones", "INSERT", saved, null);
  return c.json(saved);
});

// DELETE /api/danger-zones/:id — deleteDangerZone
dangerZones.delete("/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const row = await c.env.DB.prepare(`SELECT family_id FROM danger_zones WHERE id = ?`)
    .bind(id).first<{ family_id: string }>();
  if (!row) return c.json({ ok: true });
  if (!(await assertPrimaryParent(c.env.DB, user.sub, row.family_id))) {
    return c.json({ error: "forbidden" }, 403);
  }
  await c.env.DB.prepare(`DELETE FROM danger_zones WHERE id = ?`).bind(id).run();
  await notifyPg(c.env, row.family_id, "danger_zones", "DELETE", null, { id });
  return c.json({ ok: true });
});

export default dangerZones;

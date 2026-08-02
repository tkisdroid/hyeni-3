// Date-based supplies/homework read/write API.
// One row per family + child member + app date_key.
import { Hono } from "hono";
import type { Env, Vars } from "../types";
import { requireAuth } from "../middleware/auth";
import { assertFamilyAccess } from "../db/authz";
import { pgNow } from "../lib/time";
import { notifyPg } from "../lib/realtime";
import {
  MAX_DAILY_SUPPLY_ITEMS_PER_KIND,
  exceedsDailySupplyItemLimit,
} from "../lib/dailySupplyChecklist";

const dailySupplies = new Hono<{ Bindings: Env; Variables: Vars }>();

const DAILY_SUPPLY_COLS =
  "id, family_id, child_id, date_key, supplies, homework, note, created_by, updated_by, created_at, updated_at";

type DailySupplyBody = {
  family_id?: string;
  date_key?: string;
  child_id?: string;
  supplies?: unknown;
  homework?: unknown;
  note?: unknown;
};

function cleanText(value: unknown, max = 500): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

async function getChildMember(db: D1Database, familyId: string, childId: string) {
  if (!familyId || !childId) return null;
  return await db.prepare(
    "SELECT id, family_id, user_id, role, name FROM family_members WHERE family_id=? AND id=? AND role='child' AND is_active=1 LIMIT 1",
  )
    .bind(familyId, childId)
    .first<Record<string, unknown>>();
}

async function getCallerMember(db: D1Database, familyId: string, userId: string) {
  if (!familyId || !userId) return null;
  return await db.prepare(
    "SELECT id, role FROM family_members WHERE family_id=? AND user_id=? AND is_active=1 AND role IN ('parent','child') LIMIT 1",
  )
    .bind(familyId, userId)
    .first<{ id: string; role: string }>();
}

async function isFamilyPrimaryParent(db: D1Database, familyId: string, userId: string) {
  const row = await db.prepare("SELECT 1 AS ok FROM families WHERE id=? AND parent_id=? LIMIT 1")
    .bind(familyId, userId)
    .first<{ ok: number }>();
  return !!row;
}

async function canWriteDailySupply(db: D1Database, familyId: string, userId: string, childId: string) {
  const caller = await getCallerMember(db, familyId, userId);
  if (caller?.role === "parent") return true;
  if (await isFamilyPrimaryParent(db, familyId, userId)) return true;
  return caller?.role === "child" && caller.id === childId;
}

async function readableChildFilter(db: D1Database, familyId: string, userId: string, requestedChildId: string) {
  const caller = await getCallerMember(db, familyId, userId);
  if (caller?.role === "child") {
    if (requestedChildId && requestedChildId !== caller.id) return { forbidden: true, childId: "" };
    return { forbidden: false, childId: caller.id };
  }
  return { forbidden: false, childId: requestedChildId };
}

async function loadDailySupplyRow(db: D1Database, id: string) {
  return await db.prepare(`SELECT ${DAILY_SUPPLY_COLS} FROM daily_supplies WHERE id=?`)
    .bind(id)
    .first<Record<string, unknown>>();
}

// GET /api/daily-supplies?family_id=...&date_key=...&child_id=...
dailySupplies.get("/", requireAuth, async (c) => {
  const familyId = c.req.query("family_id") ?? "";
  const dateKey = c.req.query("date_key") ?? "";
  const requestedChildId = c.req.query("child_id") ?? "";
  const user = c.get("user");

  if (!(await assertFamilyAccess(c.env.DB, user.sub, familyId))) {
    return c.json({ error: "forbidden" }, 403);
  }

  const childFilter = await readableChildFilter(c.env.DB, familyId, user.sub, requestedChildId);
  if (childFilter.forbidden) return c.json({ error: "forbidden" }, 403);

  let sql = `SELECT ${DAILY_SUPPLY_COLS} FROM daily_supplies WHERE family_id=?`;
  const binds: unknown[] = [familyId];
  if (dateKey) {
    sql += " AND date_key=?";
    binds.push(dateKey);
  }
  if (childFilter.childId) {
    sql += " AND child_id=?";
    binds.push(childFilter.childId);
  }
  sql += " ORDER BY date_key ASC, updated_at DESC";

  const { results } = await c.env.DB.prepare(sql)
    .bind(...binds)
    .all<Record<string, unknown>>();

  return c.json(results ?? []);
});

// PUT /api/daily-supplies (dailySupplies.put("/") write route)
dailySupplies.put("/", requireAuth, async (c) => {
  const user = c.get("user");
  const body = (await c.req.json<DailySupplyBody>().catch(() => ({}))) as DailySupplyBody;

  const familyId = String(body.family_id ?? "");
  const dateKey = String(body.date_key ?? "");
  const childId = String(body.child_id ?? "");
  if (!familyId || !dateKey || !childId) return c.json({ error: "bad_request" }, 400);

  if (!(await assertFamilyAccess(c.env.DB, user.sub, familyId))) {
    return c.json({ error: "forbidden" }, 403);
  }

  const child = await getChildMember(c.env.DB, familyId, childId);
  if (!child) return c.json({ error: "child_not_found" }, 404);

  if (!(await canWriteDailySupply(c.env.DB, familyId, user.sub, childId))) {
    return c.json({ error: "forbidden" }, 403);
  }

  if (exceedsDailySupplyItemLimit(body.supplies) || exceedsDailySupplyItemLimit(body.homework)) {
    return c.json({
      error: "daily_supply_limit_exceeded",
      limit: MAX_DAILY_SUPPLY_ITEMS_PER_KIND,
    }, 400);
  }

  const supplies = cleanText(body.supplies);
  const homework = cleanText(body.homework);
  const note = cleanText(body.note);
  const now = pgNow();

  const existing = await c.env.DB.prepare(
    "SELECT id FROM daily_supplies WHERE family_id=? AND child_id=? AND date_key=? ORDER BY updated_at DESC LIMIT 1",
  )
    .bind(familyId, childId, dateKey)
    .first<{ id: string }>();

  let savedId = existing?.id ?? "";
  if (savedId) {
    await c.env.DB.prepare(
      "UPDATE daily_supplies SET supplies=?, homework=?, note=?, updated_by=?, updated_at=? WHERE id=?",
    )
      .bind(supplies, homework, note, user.sub, now, savedId)
      .run();
  } else {
    savedId = crypto.randomUUID();
    await c.env.DB.prepare(
      `INSERT INTO daily_supplies
        (id, family_id, child_id, date_key, supplies, homework, note, created_by, updated_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    )
      .bind(savedId, familyId, childId, dateKey, supplies, homework, note, user.sub, user.sub, now, now)
      .run();
  }

  const saved = await loadDailySupplyRow(c.env.DB, savedId);
  await notifyPg(c.env, familyId, "daily_supplies", existing ? "UPDATE" : "INSERT", saved, null);
  return c.json(saved);
});

export default dailySupplies;

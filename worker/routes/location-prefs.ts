// 가족 위치 전송 설정. 부모가 저장하고, 아이 기기가 읽어 네이티브 LocationService 주기를 반영한다.
import { Hono } from "hono";
import type { Env, Vars } from "../types";
import { requireAuth } from "../middleware/auth";
import { assertFamilyAccess, resolveVerifiedFamilyMembership } from "../db/authz";
import { pgNow } from "../lib/time";
import { toBool } from "../lib/serialize";
import { notifyPg } from "../lib/realtime";
import { resolveFamilyEntitlement } from "../shared/subscriptionEntitlement.js";
import {
  effectiveLocationIntervalMode,
  normalizeLocationIntervalMode,
  type LocationIntervalMode,
} from "../lib/locationIntervalPolicy";

const locationPrefs = new Hono<{ Bindings: Env; Variables: Vars }>();

type LocationPrefsRow = {
  family_id: string;
  background_enabled: unknown;
  interval_mode: string | null;
  battery_saver_exception: unknown;
  updated_by: string | null;
  updated_at: string | null;
};

function toResponse(
  row: LocationPrefsRow | null,
  familyId: string,
  intervalMode: LocationIntervalMode,
) {
  return {
    family_id: row?.family_id ?? familyId,
    background_enabled: row ? toBool(row.background_enabled) : true,
    interval_mode: intervalMode,
    battery_saver_exception: row ? toBool(row.battery_saver_exception) : true,
    updated_by: row?.updated_by ?? null,
    updated_at: row?.updated_at ?? null,
  };
}

async function ensureTable(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS location_preferences (
        family_id TEXT NOT NULL PRIMARY KEY,
        background_enabled INTEGER DEFAULT 1 NOT NULL,
        interval_mode TEXT DEFAULT 'balanced' NOT NULL,
        battery_saver_exception INTEGER DEFAULT 1 NOT NULL,
        updated_by TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
      )`,
    )
    .run();
}

async function isFamilyParent(db: D1Database, familyId: string, userId: string): Promise<boolean> {
  const membership = await resolveVerifiedFamilyMembership(db, userId, familyId);
  return membership?.role === "parent";
}

// GET /api/location-prefs?family_id=...
locationPrefs.get("/", requireAuth, async (c) => {
  const user = c.get("user");
  const familyId = c.req.query("family_id") ?? "";
  if (!(await assertFamilyAccess(c.env.DB, user.sub, familyId))) {
    return c.json({ error: "forbidden" }, 403);
  }
  await ensureTable(c.env.DB);
  const row = await c.env.DB
    .prepare(
      `SELECT family_id, background_enabled, interval_mode, battery_saver_exception, updated_by, updated_at
         FROM location_preferences
        WHERE family_id = ?`,
    )
    .bind(familyId)
    .first<LocationPrefsRow>();
  const storedInterval = normalizeLocationIntervalMode(row?.interval_mode);
  if (storedInterval !== "live") {
    return c.json(toResponse(row ?? null, familyId, storedInterval));
  }
  try {
    const entitlement = await resolveFamilyEntitlement(c.env.DB, familyId);
    return c.json(toResponse(
      row ?? null,
      familyId,
      effectiveLocationIntervalMode(storedInterval, entitlement.isPremium),
    ));
  } catch {
    return c.json({ error: "location_entitlement_unavailable" }, 503);
  }
});

// POST /api/location-prefs
// body:{ family_id, background_enabled, interval_mode, battery_saver_exception }
locationPrefs.post("/", requireAuth, async (c) => {
  const user = c.get("user");
  const b: Record<string, unknown> = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  const familyId = String(b.family_id ?? "");
  if (!(await assertFamilyAccess(c.env.DB, user.sub, familyId))) {
    return c.json({ error: "forbidden" }, 403);
  }
  if (!(await isFamilyParent(c.env.DB, familyId, user.sub))) {
    return c.json({ error: "parent_required" }, 403);
  }

  await ensureTable(c.env.DB);
  const backgroundEnabled = b.background_enabled === false ? 0 : 1;
  const batterySaverException = b.battery_saver_exception === false ? 0 : 1;
  const intervalMode = normalizeLocationIntervalMode(b.interval_mode);
  if (intervalMode === "live") {
    let isPremium = false;
    try {
      isPremium = (await resolveFamilyEntitlement(c.env.DB, familyId)).isPremium;
    } catch {
      return c.json({ error: "location_entitlement_unavailable" }, 503);
    }
    if (!isPremium) {
      return c.json({ error: "premium_required", feature: "realtime_location" }, 403);
    }
  }
  const now = pgNow();

  const existing = await c.env.DB
    .prepare("SELECT family_id FROM location_preferences WHERE family_id = ? LIMIT 1")
    .bind(familyId)
    .first<{ family_id: string }>();

  if (existing) {
    await c.env.DB
      .prepare(
        `UPDATE location_preferences
            SET background_enabled = ?, interval_mode = ?, battery_saver_exception = ?,
                updated_by = ?, updated_at = ?
          WHERE family_id = ?`,
      )
      .bind(backgroundEnabled, intervalMode, batterySaverException, user.sub, now, familyId)
      .run();
  } else {
    await c.env.DB
      .prepare(
        `INSERT INTO location_preferences
          (family_id, background_enabled, interval_mode, battery_saver_exception, updated_by, updated_at)
         VALUES (?,?,?,?,?,?)`,
      )
      .bind(familyId, backgroundEnabled, intervalMode, batterySaverException, user.sub, now)
      .run();
  }

  const row = {
    family_id: familyId,
    background_enabled: !!backgroundEnabled,
    interval_mode: intervalMode,
    battery_saver_exception: !!batterySaverException,
    updated_by: user.sub,
    updated_at: now,
  };
  await notifyPg(c.env, familyId, "location_preferences", existing ? "UPDATE" : "INSERT", row, null);
  return c.json(row);
});

export default locationPrefs;

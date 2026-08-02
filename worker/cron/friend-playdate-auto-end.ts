// playdate_auto_end (cron */2) — 현재 장소 150m 밖으로 양쪽 아이가 모두 벗어나면 자동 종료.
import type { Env } from "../types";
import { notifyPg } from "../lib/realtime";
import { pgNow, pgToIso, tsNorm } from "../lib/time";
import {
  acquireAccountMutationLeases,
  isActiveChildMutationTarget,
  releaseAccountMutationLeases,
  type AccountMutationScope,
} from "../lib/accountMutationScope";
import { recordLocationConfirmationForSubjects } from "../lib/locationConfirmationAudit";

const PLAYDATE_RADIUS_M = 150;

function haversineM(la1: number, lo1: number, la2: number, lo2: number): number {
  const R = 6371000;
  const p1 = (la1 * Math.PI) / 180;
  const p2 = (la2 * Math.PI) / 180;
  const dp = ((la2 - la1) * Math.PI) / 180;
  const dl = ((lo2 - lo1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function hydrateSession(row: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!row) return null;
  return {
    ...row,
    started_at: row.started_at ? pgToIso(row.started_at as string) : null,
    stopped_at: row.stopped_at ? pgToIso(row.stopped_at as string) : null,
  };
}

async function hasRecentChildAtPlace(
  db: D1Database,
  session: {
    public_place_id: string;
    family_a_id: string;
    family_b_id: string;
    child_a_id: string;
    child_b_id: string;
  },
): Promise<boolean> {
  const place = await db
    .prepare("SELECT lat, lng FROM public_places WHERE id = ? LIMIT 1")
    .bind(session.public_place_id)
    .first<{ lat: number | string; lng: number | string }>();
  const placeLat = Number(place?.lat);
  const placeLng = Number(place?.lng);
  if (!Number.isFinite(placeLat) || !Number.isFinite(placeLng)) return false;

  await recordLocationConfirmationForSubjects(
    db,
    [
      { familyId: session.family_a_id, subjectUserId: session.child_a_id },
      { familyId: session.family_b_id, subjectUserId: session.child_b_id },
    ],
    {
      action: "use",
      requesterKind: "system",
      requesterUserId: null,
      recipientKind: "none",
      recipientUserId: null,
      collectionMethod: "not_applicable",
      acquisitionPath: "current_location_store",
      serviceCode: "playdate_auto_end",
      deliveryMethod: "worker_internal",
      purposeCode: "playdate_safety",
    },
  );

  const freshAfter = tsNorm(new Date(Date.now() - 5 * 60 * 1000).toISOString());
  const { results } = await db
    .prepare(
      `SELECT cl.lat AS lat, cl.lng AS lng
         FROM child_locations cl
         JOIN family_members fm ON fm.user_id = cl.user_id
        WHERE fm.role = 'child'
          AND fm.is_active = 1
          AND fm.family_id IN (?, ?)
          AND cl.user_id IN (?, ?)
          AND substr(cl.updated_at, 1, 19) > ?`,
    )
    .bind(
      session.family_a_id,
      session.family_b_id,
      session.child_a_id,
      session.child_b_id,
      freshAfter,
    )
    .all<{ lat: number | string; lng: number | string }>();

  return (results ?? []).some((row) => {
    const lat = Number(row.lat);
    const lng = Number(row.lng);
    return Number.isFinite(lat) && Number.isFinite(lng) && haversineM(lat, lng, placeLat, placeLng) <= PLAYDATE_RADIUS_M;
  });
}

async function loadSessionMutationScopes(
  db: D1Database,
  session: { family_a_id: string; family_b_id: string; child_a_id: string; child_b_id: string },
): Promise<AccountMutationScope[] | null> {
  const familyIds = [...new Set([session.family_a_id, session.family_b_id])];
  const placeholders = familyIds.map(() => "?").join(",");
  const { results } = await db
    .prepare(
      `SELECT f.id AS family_id, f.parent_id AS owner_user_id, fm.user_id AS member_user_id
         FROM families f
         LEFT JOIN family_members fm
           ON fm.family_id=f.id AND fm.is_active=1
          AND fm.user_id IS NOT NULL AND fm.role IN ('parent','child')
        WHERE f.id IN (${placeholders})`,
    )
    .bind(...familyIds)
    .all<{ family_id: string; owner_user_id: string; member_user_id: string | null }>();
  const foundFamilyIds = new Set((results ?? []).map((row) => String(row.family_id)));
  if (foundFamilyIds.size !== familyIds.length) return null;
  const scopes: AccountMutationScope[] = [];
  for (const row of results ?? []) {
    scopes.push({ userId: String(row.owner_user_id), familyId: String(row.family_id) });
    if (row.member_user_id) {
      scopes.push({ userId: String(row.member_user_id), familyId: String(row.family_id) });
    }
  }
  scopes.push({ userId: session.child_a_id, familyId: session.family_a_id });
  scopes.push({ userId: session.child_b_id, familyId: session.family_b_id });
  return scopes;
}

export async function run(env: Env): Promise<Record<string, unknown>> {
  const { results } = await env.DB
    .prepare(
      `SELECT id, public_place_id, family_a_id, family_b_id, child_a_id, child_b_id
         FROM friend_playdate_sessions
        WHERE stopped_at IS NULL
        LIMIT 100`,
    )
    .all<{
      id: string;
      public_place_id: string;
      family_a_id: string;
      family_b_id: string;
      child_a_id: string;
      child_b_id: string;
    }>();

  let ended = 0;
  for (const session of results ?? []) {
    const scopes = await loadSessionMutationScopes(env.DB, session);
    if (!scopes) continue;
    const sessionMutationLeases = await acquireAccountMutationLeases(env.DB, scopes);
    if (sessionMutationLeases.status !== "acquired") continue;
    try {
    if (!(await isActiveChildMutationTarget(env.DB, session.family_a_id, session.child_a_id))) continue;
    if (!(await isActiveChildMutationTarget(env.DB, session.family_b_id, session.child_b_id))) continue;
    if (await hasRecentChildAtPlace(env.DB, session)) continue;

    const stoppedAt = pgNow();
    const update = await env.DB
      .prepare("UPDATE friend_playdate_sessions SET stopped_at = ?, stop_reason = 'auto_geofence_exit' WHERE id = ? AND stopped_at IS NULL")
      .bind(stoppedAt, session.id)
      .run();
    if (!update.meta.changes) continue;

    ended++;
    const row = await env.DB.prepare("SELECT * FROM friend_playdate_sessions WHERE id = ? LIMIT 1").bind(session.id).first<Record<string, unknown>>();
    const hydrated = hydrateSession(row);
    await notifyPg(env, session.family_a_id, "friend_playdate_sessions", "UPDATE", hydrated, null);
    await notifyPg(env, session.family_b_id, "friend_playdate_sessions", "UPDATE", hydrated, null);
    } finally {
      await releaseAccountMutationLeases(env.DB, sessionMutationLeases.leases);
    }
  }

  return { checked: results?.length ?? 0, ended };
}

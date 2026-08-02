// 친구놀이(friend_playdate) API. src/lib/friendPlaydate.js 의 supabase 호출을 D1 직역.
//
// RPC 원본(supabase/migrations/20260522000000_playdate_any_place_except_danger.sql):
//   · find_playdate_candidates   — 현재 위치 기준 후보(위험지역 제외, 150m 반경)
//   · get_active_playdate_session — 진행 중 세션 + 친구 가족 연락처/이름 enrich
//   · get_playdate_history        — 종료 세션 이력(장소명·친구이름 enrich)
// PostGIS ST_DWithin(geography) 는 SQLite 에 없으므로 haversine(m) JS 계산으로 대체한다
// (worker/shared/registeredPlaceGeofence.js haversineM 과 동일 구현).
//
// 직렬화: 본 도메인 4개 테이블은 전부 스칼라(jsonb/boolean 없음)라 변환 불필요.
// 단 started_at/stopped_at 은 D1 pg 형식('... +00')이라 클라 new Date() 파싱을 위해
// 응답 직전 pgToIso 로 ISO 정규화한다(PlaydateHistory.jsx 가 new Date() 사용).
//
// 복합 unique(public_places.kakao_place_id) 미이관 → select-then-write.
import { Hono } from "hono";
import type { Env, Vars } from "../types";
import { requireAuth } from "../middleware/auth";
import { pgNow, pgToIso, pgTs } from "../lib/time";
import { assertFamilyAccess, resolveVerifiedFamilyMembership } from "../db/authz";
import { notifyPg } from "../lib/realtime";
import {
  recordLocationConfirmation,
  recordLocationConfirmationForSubjects,
} from "../lib/locationConfirmationAudit";

const playdate = new Hono<{ Bindings: Env; Variables: Vars }>();

const VALID_STOP_REASONS = new Set(["child_end", "parent_end", "auto_geofence_exit"]);
const FRESH_WINDOW_MS = 10 * 60 * 1000;
const INVITE_TTL_MS = 15 * 60 * 1000;
const MATCH_RADIUS_M = 150;
const DEFAULT_DANGER_RADIUS_M = 200;

// haversine 거리(m). registeredPlaceGeofence.js 와 동일(edge 는 src/ import 불가라 인라인).
function haversineM(la1: number, lo1: number, la2: number, lo2: number): number {
  const R = 6371000, p1 = (la1 * Math.PI) / 180, p2 = (la2 * Math.PI) / 180;
  const dp = ((la2 - la1) * Math.PI) / 180, dl = ((lo2 - lo1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// now()-10분 임계값을 D1 비교형('YYYY-MM-DD HH:MM:SS', UTC)으로. substr(col,1,19) 와 비교.
function freshThreshold(): string {
  return new Date(Date.now() - FRESH_WINDOW_MS).toISOString().replace("T", " ").slice(0, 19);
}

type DangerZone = { lat: number; lng: number; radius_m: number | null };

type PlaydateLocation = {
  user_id: string;
  family_id: string;
  lat: number;
  lng: number;
  updated_at: string;
};

type PlaydateEligibilityFailure = {
  error: "playdate_not_enabled" | "current_location_unavailable" | "not_nearby"
    | "in_danger_zone" | "invalid_public_place" | "playdate_safety_unavailable";
  status: 403 | 409 | 503;
};

type PlaydateEligibilitySuccess = {
  verified: {
    requesterLocation: PlaydateLocation;
    receiverLocation: PlaydateLocation;
    place: { lat: number; lng: number };
  };
};

// 좌표가 주어진 위험지역 중 하나라도의 반경 안인지.
function inAnyDangerZone(lat: number, lng: number, zones: DangerZone[]): boolean {
  return zones.some(
    (z) => haversineM(lat, lng, z.lat, z.lng) <= (z.radius_m ?? DEFAULT_DANGER_RADIUS_M),
  );
}

function validPoint(lat: unknown, lng: unknown): lat is number {
  return typeof lat === "number"
    && typeof lng === "number"
    && Number.isFinite(lat)
    && Number.isFinite(lng)
    && lat >= -90
    && lat <= 90
    && lng >= -180
    && lng <= 180;
}

async function validateInviteEligibility(
  db: D1Database,
  input: {
    requesterFamilyId: string;
    receiverFamilyId: string;
    requesterChildId: string;
    receiverChildId: string;
    publicPlaceId: string;
    requesterUserId: string;
  },
): Promise<PlaydateEligibilityFailure | PlaydateEligibilitySuccess> {
  const { results: familyRows } = await db
    .prepare("SELECT id, playdate_enabled FROM families WHERE id IN (?,?)")
    .bind(input.requesterFamilyId, input.receiverFamilyId)
    .all<{ id: string; playdate_enabled: number | null }>();
  const enabledFamilies = new Set(
    (familyRows ?? [])
      .filter((row) => Number(row.playdate_enabled) === 1)
      .map((row) => String(row.id)),
  );
  if (
    !enabledFamilies.has(input.requesterFamilyId)
    || !enabledFamilies.has(input.receiverFamilyId)
  ) {
    return { error: "playdate_not_enabled", status: 403 };
  }

  const threshold = freshThreshold();
  const loadLocation = (familyId: string, childId: string) => db
    .prepare(
      `SELECT user_id, family_id, lat, lng, updated_at
         FROM child_locations
        WHERE family_id = ? AND user_id = ?
          AND substr(updated_at, 1, 19) > ?
        LIMIT 1`,
    )
    .bind(familyId, childId, threshold)
    .first<PlaydateLocation>();
  const requesterLocation = await loadLocation(input.requesterFamilyId, input.requesterChildId);
  const receiverLocation = await loadLocation(input.receiverFamilyId, input.receiverChildId);
  if (
    !requesterLocation
    || !receiverLocation
    || !validPoint(requesterLocation.lat, requesterLocation.lng)
    || !validPoint(receiverLocation.lat, receiverLocation.lng)
  ) {
    return { error: "current_location_unavailable", status: 409 };
  }

  await recordLocationConfirmationForSubjects(
    db,
    [
      { familyId: input.requesterFamilyId, subjectUserId: input.requesterChildId },
      { familyId: input.receiverFamilyId, subjectUserId: input.receiverChildId },
    ],
    {
      action: "use",
      requesterKind: "subject",
      requesterUserId: input.requesterUserId,
      recipientKind: "none",
      recipientUserId: null,
      collectionMethod: "not_applicable",
      acquisitionPath: "current_location_store",
      serviceCode: "playdate_matching",
      deliveryMethod: "worker_internal",
      purposeCode: "playdate_safety",
    },
  );

  if (
    haversineM(
      requesterLocation.lat,
      requesterLocation.lng,
      receiverLocation.lat,
      receiverLocation.lng,
    ) > MATCH_RADIUS_M
  ) {
    return { error: "not_nearby", status: 409 };
  }

  const place = await db
    .prepare("SELECT lat, lng FROM public_places WHERE id = ? LIMIT 1")
    .bind(input.publicPlaceId)
    .first<{ lat: number; lng: number }>();
  if (
    !place
    || !validPoint(place.lat, place.lng)
    || haversineM(requesterLocation.lat, requesterLocation.lng, place.lat, place.lng) > MATCH_RADIUS_M
  ) {
    return { error: "invalid_public_place", status: 409 };
  }

  const { results: zoneRows } = await db
    .prepare("SELECT family_id, lat, lng, radius_m FROM danger_zones WHERE family_id IN (?,?)")
    .bind(input.requesterFamilyId, input.receiverFamilyId)
    .all<{ family_id: string; lat: number; lng: number; radius_m: number | null }>();
  const zonesByFamily = new Map<string, DangerZone[]>();
  for (const zone of zoneRows ?? []) {
    if (
      !validPoint(zone.lat, zone.lng)
      || (zone.radius_m != null && (!Number.isFinite(Number(zone.radius_m)) || Number(zone.radius_m) <= 0))
    ) {
      return { error: "playdate_safety_unavailable", status: 503 };
    }
    const zones = zonesByFamily.get(zone.family_id) ?? [];
    zones.push({ lat: zone.lat, lng: zone.lng, radius_m: zone.radius_m });
    zonesByFamily.set(zone.family_id, zones);
  }
  if (
    inAnyDangerZone(
      requesterLocation.lat,
      requesterLocation.lng,
      zonesByFamily.get(input.requesterFamilyId) ?? [],
    )
    || inAnyDangerZone(
      receiverLocation.lat,
      receiverLocation.lng,
      zonesByFamily.get(input.receiverFamilyId) ?? [],
    )
  ) {
    return { error: "in_danger_zone", status: 409 };
  }
  return { verified: { requesterLocation, receiverLocation, place } };
}

function longitudeMetersPerDegree(latitude: number): number {
  return 111_320 * Math.max(Math.abs(Math.cos(latitude * Math.PI / 180)), 0.01);
}

function buildAtomicInviteEligibilityGuard(input: {
  requesterFamilyId: string;
  receiverFamilyId: string;
  requesterChildId: string;
  receiverChildId: string;
  publicPlaceId: string;
  threshold: string;
  verified: PlaydateEligibilitySuccess["verified"];
}): { sql: string; bindings: Array<string | number> } {
  const { requesterLocation, receiverLocation, place } = input.verified;
  return {
    sql: `EXISTS (
            SELECT 1 FROM families WHERE id = ? AND playdate_enabled = 1
          )
          AND EXISTS (
            SELECT 1 FROM families WHERE id = ? AND playdate_enabled = 1
          )
          AND EXISTS (
            SELECT 1 FROM family_members
             WHERE family_id = ? AND user_id = ? AND role = 'child' AND is_active = 1
          )
          AND EXISTS (
            SELECT 1 FROM family_members
             WHERE family_id = ? AND user_id = ? AND role = 'child' AND is_active = 1
          )
          AND EXISTS (
            SELECT 1 FROM child_locations
             WHERE family_id = ? AND user_id = ? AND substr(updated_at, 1, 19) > ?
               AND lat = ? AND lng = ? AND updated_at = ?
          )
          AND EXISTS (
            SELECT 1 FROM child_locations
             WHERE family_id = ? AND user_id = ? AND substr(updated_at, 1, 19) > ?
               AND lat = ? AND lng = ? AND updated_at = ?
          )
          AND EXISTS (
            SELECT 1 FROM public_places WHERE id = ? AND lat = ? AND lng = ?
          )
          AND NOT EXISTS (
            SELECT 1 FROM danger_zones
             WHERE family_id IN (?,?)
               AND (
                 typeof(lat) NOT IN ('integer','real') OR lat < -90 OR lat > 90
                 OR typeof(lng) NOT IN ('integer','real') OR lng < -180 OR lng > 180
                 OR (
                   radius_m IS NOT NULL
                   AND (typeof(radius_m) NOT IN ('integer','real') OR radius_m <= 0)
                 )
               )
          )
          AND NOT EXISTS (
            SELECT 1
              FROM danger_zones dz
              CROSS JOIN (SELECT ? AS child_lat, ? AS child_lng, ? AS lng_m) point
             WHERE dz.family_id = ?
               AND (
                 ((CAST(dz.lat AS REAL) - point.child_lat) * 111320.0)
                 * ((CAST(dz.lat AS REAL) - point.child_lat) * 111320.0)
                 + ((CAST(dz.lng AS REAL) - point.child_lng) * point.lng_m)
                 * ((CAST(dz.lng AS REAL) - point.child_lng) * point.lng_m)
               ) <= CAST(COALESCE(dz.radius_m, 200) AS REAL)
                    * CAST(COALESCE(dz.radius_m, 200) AS REAL)
          )
          AND NOT EXISTS (
            SELECT 1
              FROM danger_zones dz
              CROSS JOIN (SELECT ? AS child_lat, ? AS child_lng, ? AS lng_m) point
             WHERE dz.family_id = ?
               AND (
                 ((CAST(dz.lat AS REAL) - point.child_lat) * 111320.0)
                 * ((CAST(dz.lat AS REAL) - point.child_lat) * 111320.0)
                 + ((CAST(dz.lng AS REAL) - point.child_lng) * point.lng_m)
                 * ((CAST(dz.lng AS REAL) - point.child_lng) * point.lng_m)
               ) <= CAST(COALESCE(dz.radius_m, 200) AS REAL)
                    * CAST(COALESCE(dz.radius_m, 200) AS REAL)
          )`,
    bindings: [
      input.requesterFamilyId,
      input.receiverFamilyId,
      input.requesterFamilyId,
      input.requesterChildId,
      input.receiverFamilyId,
      input.receiverChildId,
      input.requesterFamilyId,
      input.requesterChildId,
      input.threshold,
      requesterLocation.lat,
      requesterLocation.lng,
      requesterLocation.updated_at,
      input.receiverFamilyId,
      input.receiverChildId,
      input.threshold,
      receiverLocation.lat,
      receiverLocation.lng,
      receiverLocation.updated_at,
      input.publicPlaceId,
      place.lat,
      place.lng,
      input.requesterFamilyId,
      input.receiverFamilyId,
      requesterLocation.lat,
      requesterLocation.lng,
      longitudeMetersPerDegree(requesterLocation.lat),
      input.requesterFamilyId,
      receiverLocation.lat,
      receiverLocation.lng,
      longitudeMetersPerDegree(receiverLocation.lat),
      input.receiverFamilyId,
    ],
  };
}

// 호출자(uid)가 해당 가족의 부모(주 보호자 OR family_members role='parent')인지.
// family.ts isFamilyParent 와 동일 — families.playdate_enabled 토글 게이트.
async function isFamilyParent(db: D1Database, uid: string, familyId: string): Promise<boolean> {
  if (!familyId) return false;
  const membership = await resolveVerifiedFamilyMembership(db, uid, familyId);
  return membership?.role === "parent";
}

// 신청 가족 자녀의 최신(10분 내) 현재 위치. 호출자가 자녀면 본인 위치만, 부모면 임의 자녀.
async function currentChildLocation(db: D1Database, familyId: string, uid: string, callerIsChild: boolean) {
  const location = await db
    .prepare(
      `SELECT cl.user_id AS user_id, cl.lat AS lat, cl.lng AS lng
         FROM child_locations cl
         JOIN family_members fm ON fm.user_id = cl.user_id
        WHERE fm.family_id = ?1 AND fm.role = 'child' AND fm.is_active = 1
          AND substr(cl.updated_at, 1, 19) > ?2
          AND (?3 = 0 OR cl.user_id = ?4)
        ORDER BY (CASE WHEN cl.user_id = ?4 THEN 0 ELSE 1 END), substr(cl.updated_at, 1, 19) DESC
        LIMIT 1`,
    )
    .bind(familyId, freshThreshold(), callerIsChild ? 1 : 0, uid)
    .first<{ user_id: string; lat: number; lng: number }>();
  if (location?.user_id) {
    await recordLocationConfirmation(db, {
      familyId,
      subjectUserId: location.user_id,
      action: "use",
      requesterKind: callerIsChild ? "subject" : "parent",
      requesterUserId: uid,
      recipientKind: "none",
      recipientUserId: null,
      collectionMethod: "not_applicable",
      acquisitionPath: "current_location_store",
      serviceCode: "playdate_matching",
      deliveryMethod: "worker_internal",
      purposeCode: "playdate_safety",
    });
  }
  return location;
}

// 현재 좌표를 public_places 카탈로그에 upsert(키=current:lat4:lng4) → place id. select-then-write.
async function upsertCurrentPlace(db: D1Database, lat: number, lng: number): Promise<string> {
  const key = `current:${lat.toFixed(4)}:${lng.toFixed(4)}`;
  const rLat = Number(lat.toFixed(7));
  const rLng = Number(lng.toFixed(7));
  const existing = await db
    .prepare(`SELECT id FROM public_places WHERE kakao_place_id = ? LIMIT 1`)
    .bind(key)
    .first<{ id: string }>();
  if (existing) {
    await db
      .prepare(`UPDATE public_places SET name='현재 장소', lat=?, lng=? WHERE id=?`)
      .bind(rLat, rLng, existing.id)
      .run();
    return existing.id;
  }
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO public_places (id, kakao_place_id, name, lat, lng, created_at) VALUES (?,?,?,?,?,?)`,
    )
    .bind(id, key, "현재 장소", rLat, rLng, pgNow())
    .run();
  return id;
}

type CandidateRow = {
  family_id: string;
  user_id: string;
  child_name: string;
  lat: number;
  lng: number;
};

type InviteRow = {
  id: string;
  public_place_id: string;
  requester_family_id: string;
  receiver_family_id: string;
  requester_child_id: string;
  receiver_child_id: string;
  requester_user_id: string;
  status: string;
  session_id: string | null;
  requested_at: string;
  responded_at: string | null;
  responded_by: string | null;
  expires_at: string;
  created_at: string;
  place_name?: string;
  friend_child_name?: string;
};

function inviteExpiresAt(): string {
  return pgTs(new Date(Date.now() + INVITE_TTL_MS));
}

function hydrateInvite(row: InviteRow | null, perspectiveFamilyId = "") {
  if (!row) return null;
  return {
    ...row,
    direction: perspectiveFamilyId
      ? (row.receiver_family_id === perspectiveFamilyId ? "incoming" : "outgoing")
      : undefined,
    requested_at: row.requested_at ? pgToIso(row.requested_at) : null,
    responded_at: row.responded_at ? pgToIso(row.responded_at) : null,
    expires_at: row.expires_at ? pgToIso(row.expires_at) : null,
    created_at: row.created_at ? pgToIso(row.created_at) : null,
  };
}

async function childBelongsToFamily(
  db: D1Database,
  familyId: string,
  childId: string,
): Promise<boolean> {
  if (!familyId || !childId) return false;
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM family_members
        WHERE family_id = ? AND user_id = ? AND role = 'child' AND is_active = 1
        LIMIT 1`,
    )
    .bind(familyId, childId)
    .first<{ ok: number }>();
  return !!row;
}

async function hasActivePlaydateForChildren(
  db: D1Database,
  childAId: string,
  childBId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT id FROM friend_playdate_sessions
        WHERE stopped_at IS NULL
          AND (child_a_id IN (?1, ?2) OR child_b_id IN (?1, ?2))
        LIMIT 1`,
    )
    .bind(childAId, childBId)
    .first<{ id: string }>();
  return !!row;
}

async function loadInvite(db: D1Database, inviteId: string): Promise<InviteRow | null> {
  return db
    .prepare(`SELECT * FROM friend_playdate_invites WHERE id = ? LIMIT 1`)
    .bind(inviteId)
    .first<InviteRow>();
}

async function pendingInvitesForFamily(db: D1Database, familyId: string, uid: string) {
  const callerChild = await db
    .prepare(
      `SELECT 1 AS ok FROM family_members
        WHERE family_id = ? AND user_id = ? AND role = 'child' AND is_active = 1
        LIMIT 1`,
    )
    .bind(familyId, uid)
    .first<{ ok: number }>();
  const childOnly = callerChild ? 1 : 0;
  const now = pgNow();
  const { results } = await db
    .prepare(
      `SELECT i.*,
              COALESCE(pp.name, '현재 장소') AS place_name,
              CASE
                WHEN i.receiver_family_id = ?1 THEN COALESCE(req.name, '친구')
                ELSE COALESCE(rec.name, '친구')
              END AS friend_child_name
         FROM friend_playdate_invites i
         LEFT JOIN public_places pp ON pp.id = i.public_place_id
         LEFT JOIN family_members req
           ON req.family_id = i.requester_family_id AND req.user_id = i.requester_child_id
         LEFT JOIN family_members rec
           ON rec.family_id = i.receiver_family_id AND rec.user_id = i.receiver_child_id
        WHERE i.status = 'pending'
          AND i.expires_at > ?2
          AND (i.requester_family_id = ?1 OR i.receiver_family_id = ?1)
          AND (?3 = 0 OR i.requester_child_id = ?4 OR i.receiver_child_id = ?4)
        ORDER BY substr(i.requested_at, 1, 19) DESC`,
    )
    .bind(familyId, now, childOnly, uid)
    .all<InviteRow>();
  return (results ?? []).map((row) => hydrateInvite(row, familyId));
}

// 150m 반경 내 다른 가족 자녀(playdate_enabled) 중, 본인 가족 위험지역 밖인 후보.
// (family_id,user_id) 중복 제거(최신 위치 우선 — 쿼리가 updated_at DESC 정렬).
async function findNearbyCandidates(
  db: D1Database,
  myFamilyId: string,
  myLat: number,
  myLng: number,
  publicPlaceId: string,
  requesterUserId: string,
  requesterIsChild: boolean,
) {
  const { results } = await db
    .prepare(
      `SELECT other_fm.family_id AS family_id, other_fm.user_id AS user_id,
              COALESCE(other_fm.name, '친구') AS child_name,
              other_cl.lat AS lat, other_cl.lng AS lng
         FROM family_members other_fm
         JOIN families other_f ON other_f.id = other_fm.family_id
         JOIN child_locations other_cl ON other_cl.user_id = other_fm.user_id
        WHERE other_fm.role = 'child'
          AND other_fm.is_active = 1
          AND other_fm.family_id <> ?1
          AND other_f.playdate_enabled = 1
          AND substr(other_cl.updated_at, 1, 19) > ?2
        ORDER BY substr(other_cl.updated_at, 1, 19) DESC`,
    )
    .bind(myFamilyId, freshThreshold())
    .all<CandidateRow>();

  await recordLocationConfirmationForSubjects(
    db,
    (results ?? []).map((row) => ({
      familyId: String(row.family_id),
      subjectUserId: String(row.user_id),
    })),
    {
      action: "use",
      requesterKind: requesterIsChild ? "subject" : "parent",
      requesterUserId,
      recipientKind: "none",
      recipientUserId: null,
      collectionMethod: "not_applicable",
      acquisitionPath: "current_location_store",
      serviceCode: "playdate_matching",
      deliveryMethod: "worker_internal",
      purposeCode: "playdate_safety",
    },
  );

  const near = (results ?? []).filter((r) => haversineM(myLat, myLng, r.lat, r.lng) <= MATCH_RADIUS_M);
  if (near.length === 0) return [];

  // 후보 가족들의 위험지역을 한 번에 로드해 각 후보의 현재 위치가 자기 가족 위험지역인지 검사.
  const famIds = [...new Set(near.map((r) => r.family_id))];
  const ph = famIds.map(() => "?").join(",");
  const { results: dz } = await db
    .prepare(`SELECT family_id, lat, lng, radius_m FROM danger_zones WHERE family_id IN (${ph})`)
    .bind(...famIds)
    .all<{ family_id: string; lat: number; lng: number; radius_m: number | null }>();
  const zonesByFamily = new Map<string, DangerZone[]>();
  for (const z of dz ?? []) {
    const list = zonesByFamily.get(z.family_id) ?? [];
    list.push({ lat: z.lat, lng: z.lng, radius_m: z.radius_m });
    zonesByFamily.set(z.family_id, list);
  }

  const seen = new Set<string>();
  const out: Array<Record<string, unknown>> = [];
  for (const r of near) {
    if (inAnyDangerZone(r.lat, r.lng, zonesByFamily.get(r.family_id) ?? [])) continue;
    const dedup = `${r.family_id}|${r.user_id}`;
    if (seen.has(dedup)) continue;
    seen.add(dedup);
    out.push({
      family_id: r.family_id,
      child_user_id: r.user_id,
      child_name: r.child_name,
      public_place_id: publicPlaceId,
    });
  }
  await recordLocationConfirmationForSubjects(
    db,
    out.map((row) => ({
      familyId: String(row.family_id),
      subjectUserId: String(row.child_user_id),
    })),
    {
      action: "provide",
      requesterKind: requesterIsChild ? "subject" : "parent",
      requesterUserId,
      recipientKind: requesterIsChild ? "subject" : "family_parent",
      recipientUserId: requesterUserId,
      collectionMethod: "not_applicable",
      acquisitionPath: "current_location_store",
      serviceCode: "playdate_matching",
      deliveryMethod: "https_worker_api",
      purposeCode: "playdate_safety",
    },
  );
  return out;
}

// ── GET /api/playdate/candidates?family_id=... — find_playdate_candidates ──────
// soft error(forbidden/playdate_not_enabled/current_location_unavailable/in_danger_zone)는
// RPC 와 동일하게 200 + {error} 로 반환(클라가 객체를 그대로 소비, apiClient throw 회피).
playdate.get("/candidates", requireAuth, async (c) => {
  const familyId = c.req.query("family_id") ?? "";
  const user = c.get("user");

  if (!(await assertFamilyAccess(c.env.DB, user.sub, familyId))) {
    return c.json({ error: "forbidden" });
  }

  const fam = await c.env.DB.prepare(`SELECT playdate_enabled FROM families WHERE id = ? LIMIT 1`)
    .bind(familyId)
    .first<{ playdate_enabled: number }>();
  if (!fam || Number(fam.playdate_enabled) !== 1) {
    return c.json({ candidates: [], error: "playdate_not_enabled" });
  }

  const childRow = await c.env.DB.prepare(
    `SELECT 1 AS ok FROM family_members WHERE user_id = ? AND family_id = ? AND role = 'child' AND is_active = 1 LIMIT 1`,
  )
    .bind(user.sub, familyId)
    .first<{ ok: number }>();
  const callerIsChild = !!childRow;

  const loc = await currentChildLocation(c.env.DB, familyId, user.sub, callerIsChild);
  if (!loc || loc.lat == null || loc.lng == null) {
    return c.json({ candidates: [], error: "current_location_unavailable" });
  }

  const { results: myZones } = await c.env.DB.prepare(
    `SELECT lat, lng, radius_m FROM danger_zones WHERE family_id = ?`,
  )
    .bind(familyId)
    .all<DangerZone>();
  if (inAnyDangerZone(loc.lat, loc.lng, myZones ?? [])) {
    return c.json({ candidates: [], public_place_id: null, error: "in_danger_zone" });
  }

  const publicPlaceId = await upsertCurrentPlace(c.env.DB, loc.lat, loc.lng);
  const candidates = await findNearbyCandidates(
    c.env.DB,
    familyId,
    loc.lat,
    loc.lng,
    publicPlaceId,
    user.sub,
    callerIsChild,
  );
  return c.json({ candidates, public_place_id: publicPlaceId });
});

// ── GET /api/playdate/invites/pending?family_id=... ──────────────────────────
// Child callers only see invites involving their own child id. Parents can see
// all family invites, but accept/decline is still receiver-child gated.
playdate.get("/invites/pending", requireAuth, async (c) => {
  const familyId = c.req.query("family_id") ?? "";
  const user = c.get("user");
  if (!(await assertFamilyAccess(c.env.DB, user.sub, familyId))) {
    return c.json({ error: "forbidden" }, 403);
  }
  return c.json(await pendingInvitesForFamily(c.env.DB, familyId, user.sub));
});

// ── POST /api/playdate/invites — create pending invite ───────────────────────
playdate.post("/invites", requireAuth, async (c) => {
  const user = c.get("user");
  const b = await c.req.json<Record<string, unknown>>();
  const publicPlaceId = String(b.public_place_id ?? "");
  const requesterFamilyId = String(b.requester_family_id ?? b.family_a_id ?? "");
  const receiverFamilyId = String(b.receiver_family_id ?? b.family_b_id ?? "");
  const requesterChildId = String(b.requester_child_id ?? b.child_a_id ?? "");
  const receiverChildId = String(b.receiver_child_id ?? b.child_b_id ?? "");
  const requesterUserId = String(b.requester_user_id ?? b.initiator_user_id ?? "");

  if (
    !publicPlaceId ||
    !requesterFamilyId ||
    !receiverFamilyId ||
    !requesterChildId ||
    !receiverChildId ||
    !requesterUserId
  ) {
    return c.json({ error: "missing required field" }, 400);
  }
  if (requesterFamilyId === receiverFamilyId) {
    return c.json({ error: "cannot match same family" }, 400);
  }
  if (requesterUserId !== user.sub || requesterChildId !== user.sub) {
    return c.json({ error: "forbidden" }, 403);
  }
  if (!(await childBelongsToFamily(c.env.DB, requesterFamilyId, requesterChildId))) {
    return c.json({ error: "requester_child_not_found" }, 404);
  }
  if (!(await childBelongsToFamily(c.env.DB, receiverFamilyId, receiverChildId))) {
    return c.json({ error: "receiver_child_not_found" }, 404);
  }
  if (await hasActivePlaydateForChildren(c.env.DB, requesterChildId, receiverChildId)) {
    return c.json({ error: "already_active" }, 409);
  }

  const eligibility = await validateInviteEligibility(c.env.DB, {
    requesterFamilyId,
    receiverFamilyId,
    requesterChildId,
    receiverChildId,
    publicPlaceId,
    requesterUserId,
  });
  if ("error" in eligibility) {
    return c.json({ error: eligibility.error }, eligibility.status);
  }

  const now = pgNow();
  const existing = await c.env.DB.prepare(
    `SELECT * FROM friend_playdate_invites
      WHERE status = 'pending'
        AND expires_at > ?1
        AND (
          (requester_child_id = ?2 AND receiver_child_id = ?3)
          OR (requester_child_id = ?3 AND receiver_child_id = ?2)
        )
      ORDER BY substr(requested_at, 1, 19) DESC
      LIMIT 1`,
  )
    .bind(now, requesterChildId, receiverChildId)
    .first<InviteRow>();
  if (existing) {
    const existingEligibility = await validateInviteEligibility(c.env.DB, {
      requesterFamilyId: existing.requester_family_id,
      receiverFamilyId: existing.receiver_family_id,
      requesterChildId: existing.requester_child_id,
      receiverChildId: existing.receiver_child_id,
      publicPlaceId: existing.public_place_id,
      requesterUserId: user.sub,
    });
    if ("error" in existingEligibility) {
      return c.json({ error: existingEligibility.error }, existingEligibility.status);
    }
    return c.json(hydrateInvite(existing, requesterFamilyId));
  }

  const id = crypto.randomUUID();
  const expiresAt = inviteExpiresAt();
  const threshold = freshThreshold();
  const atomicEligibility = buildAtomicInviteEligibilityGuard({
    requesterFamilyId,
    receiverFamilyId,
    requesterChildId,
    receiverChildId,
    publicPlaceId,
    threshold,
    verified: eligibility.verified,
  });
  const inserted = await c.env.DB.prepare(
    `INSERT INTO friend_playdate_invites
       (id, public_place_id, requester_family_id, receiver_family_id,
        requester_child_id, receiver_child_id, requester_user_id,
        status, requested_at, expires_at, created_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?
      WHERE ${atomicEligibility.sql}
        AND NOT EXISTS (
          SELECT 1 FROM friend_playdate_sessions
           WHERE stopped_at IS NULL
             AND (child_a_id IN (?,?) OR child_b_id IN (?,?))
        )
        AND NOT EXISTS (
          SELECT 1 FROM friend_playdate_invites
           WHERE status = 'pending' AND expires_at > ?
             AND (
               (requester_child_id = ? AND receiver_child_id = ?)
               OR (requester_child_id = ? AND receiver_child_id = ?)
             )
        )`,
  )
    .bind(
      id,
      publicPlaceId,
      requesterFamilyId,
      receiverFamilyId,
      requesterChildId,
      receiverChildId,
      requesterUserId,
      now,
      expiresAt,
      now,
      ...atomicEligibility.bindings,
      requesterChildId,
      receiverChildId,
      requesterChildId,
      receiverChildId,
      now,
      requesterChildId,
      receiverChildId,
      receiverChildId,
      requesterChildId,
    )
    .run();
  if (Number(inserted.meta.changes ?? 0) !== 1) {
    const racedInvite = await c.env.DB.prepare(
      `SELECT * FROM friend_playdate_invites
        WHERE status = 'pending' AND expires_at > ?1
          AND (
            (requester_child_id = ?2 AND receiver_child_id = ?3)
            OR (requester_child_id = ?3 AND receiver_child_id = ?2)
          )
        ORDER BY substr(requested_at, 1, 19) DESC LIMIT 1`,
    )
      .bind(now, requesterChildId, receiverChildId)
      .first<InviteRow>();
    if (racedInvite) {
      const racedEligibility = await validateInviteEligibility(c.env.DB, {
        requesterFamilyId: racedInvite.requester_family_id,
        receiverFamilyId: racedInvite.receiver_family_id,
        requesterChildId: racedInvite.requester_child_id,
        receiverChildId: racedInvite.receiver_child_id,
        publicPlaceId: racedInvite.public_place_id,
        requesterUserId: user.sub,
      });
      if ("error" in racedEligibility) {
        return c.json({ error: racedEligibility.error }, racedEligibility.status);
      }
      return c.json(hydrateInvite(racedInvite, requesterFamilyId));
    }
    return c.json({ error: "playdate_conditions_changed" }, 409);
  }
  const row = await loadInvite(c.env.DB, id);
  const requesterView = hydrateInvite(row, requesterFamilyId);
  const receiverView = hydrateInvite(row, receiverFamilyId);
  await notifyPg(c.env, requesterFamilyId, "friend_playdate_invites", "INSERT", requesterView, null);
  await notifyPg(c.env, receiverFamilyId, "friend_playdate_invites", "INSERT", receiverView, null);
  return c.json(requesterView);
});

// ── POST /api/playdate/invites/:id/accept — accept then start session ─────────
playdate.post("/invites/:id/accept", requireAuth, async (c) => {
  const user = c.get("user");
  const invite = await loadInvite(c.env.DB, c.req.param("id"));
  if (!invite) return c.json({ error: "not_found" }, 404);
  if (invite.status !== "pending") return c.json({ error: "invite_not_pending" }, 409);
  if (invite.expires_at <= pgNow()) return c.json({ error: "invite_expired" }, 410);
  if (invite.receiver_child_id !== user.sub) return c.json({ error: "forbidden" }, 403);
  if (
    !(await childBelongsToFamily(
      c.env.DB,
      invite.requester_family_id,
      invite.requester_child_id,
    ))
    || !(await childBelongsToFamily(
      c.env.DB,
      invite.receiver_family_id,
      invite.receiver_child_id,
    ))
  ) {
    return c.json({ error: "invite_participant_inactive" }, 409);
  }
  if (
    await hasActivePlaydateForChildren(
      c.env.DB,
      invite.requester_child_id,
      invite.receiver_child_id,
    )
  ) {
    return c.json({ error: "already_active" }, 409);
  }

  const acceptanceEligibility = await validateInviteEligibility(c.env.DB, {
    requesterFamilyId: invite.requester_family_id,
    receiverFamilyId: invite.receiver_family_id,
    requesterChildId: invite.requester_child_id,
    receiverChildId: invite.receiver_child_id,
    publicPlaceId: invite.public_place_id,
    requesterUserId: user.sub,
  });
  if ("error" in acceptanceEligibility) {
    return c.json({ error: acceptanceEligibility.error }, acceptanceEligibility.status);
  }

  const sessionId = crypto.randomUUID();
  const now = pgNow();
  const atomicEligibility = buildAtomicInviteEligibilityGuard({
    requesterFamilyId: invite.requester_family_id,
    receiverFamilyId: invite.receiver_family_id,
    requesterChildId: invite.requester_child_id,
    receiverChildId: invite.receiver_child_id,
    publicPlaceId: invite.public_place_id,
    threshold: freshThreshold(),
    verified: acceptanceEligibility.verified,
  });
  const [claimedInvite, insertedSession] = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE friend_playdate_invites
          SET status = 'accepted', session_id = ?1, responded_at = ?2, responded_by = ?3
        WHERE id = ?4
          AND status = 'pending'
          AND session_id IS NULL
          AND expires_at > ?2
          AND receiver_child_id = ?3
          AND EXISTS (
            SELECT 1 FROM family_members requester
             WHERE requester.family_id = friend_playdate_invites.requester_family_id
               AND requester.user_id = friend_playdate_invites.requester_child_id
               AND requester.role = 'child'
               AND requester.is_active = 1
          )
           AND EXISTS (
             SELECT 1 FROM family_members receiver
             WHERE receiver.family_id = friend_playdate_invites.receiver_family_id
               AND receiver.user_id = friend_playdate_invites.receiver_child_id
               AND receiver.role = 'child'
               AND receiver.is_active = 1
           )
           AND ${atomicEligibility.sql}
           AND NOT EXISTS (
            SELECT 1 FROM friend_playdate_sessions active
             WHERE active.stopped_at IS NULL
               AND (
                 active.child_a_id IN (
                   friend_playdate_invites.requester_child_id,
                   friend_playdate_invites.receiver_child_id
                 )
                 OR active.child_b_id IN (
                   friend_playdate_invites.requester_child_id,
                   friend_playdate_invites.receiver_child_id
                 )
               )
          )`,
    ).bind(sessionId, now, user.sub, invite.id, ...atomicEligibility.bindings),
    c.env.DB.prepare(
      `INSERT INTO friend_playdate_sessions
         (id, public_place_id, family_a_id, family_b_id, child_a_id, child_b_id,
          initiator_user_id, started_at, created_at)
       SELECT session_id, public_place_id, requester_family_id, receiver_family_id,
              requester_child_id, receiver_child_id, requester_user_id, ?1, ?1
         FROM friend_playdate_invites
        WHERE id = ?2
          AND status = 'accepted'
          AND session_id = ?3`,
    ).bind(now, invite.id, sessionId),
  ]);
  if (
    Number(claimedInvite.meta.changes ?? 0) !== 1
    || Number(insertedSession.meta.changes ?? 0) !== 1
  ) {
    const currentInvite = await loadInvite(c.env.DB, invite.id);
    if (!currentInvite) return c.json({ error: "not_found" }, 404);
    if (currentInvite.status !== "pending") {
      return c.json({ error: "invite_not_pending" }, 409);
    }
    if (currentInvite.expires_at <= pgNow()) {
      return c.json({ error: "invite_expired" }, 410);
    }
    if (
      !(await childBelongsToFamily(
        c.env.DB,
        currentInvite.requester_family_id,
        currentInvite.requester_child_id,
      ))
      || !(await childBelongsToFamily(
        c.env.DB,
        currentInvite.receiver_family_id,
        currentInvite.receiver_child_id,
      ))
    ) {
      return c.json({ error: "invite_participant_inactive" }, 409);
    }
    const currentEligibility = await validateInviteEligibility(c.env.DB, {
      requesterFamilyId: currentInvite.requester_family_id,
      receiverFamilyId: currentInvite.receiver_family_id,
      requesterChildId: currentInvite.requester_child_id,
      receiverChildId: currentInvite.receiver_child_id,
      publicPlaceId: currentInvite.public_place_id,
      requesterUserId: user.sub,
    });
    if ("error" in currentEligibility) {
      return c.json({ error: currentEligibility.error }, currentEligibility.status);
    }
    if (
      await hasActivePlaydateForChildren(
        c.env.DB,
        currentInvite.requester_child_id,
        currentInvite.receiver_child_id,
      )
    ) {
      return c.json({ error: "already_active" }, 409);
    }
    return c.json({ error: "playdate_conditions_changed" }, 409);
  }

  const sessionRow = await c.env.DB.prepare(`SELECT * FROM friend_playdate_sessions WHERE id = ?`)
    .bind(sessionId)
    .first<Record<string, unknown>>();
  const hydratedSession = hydrateSession(sessionRow);
  const accepted = await loadInvite(c.env.DB, invite.id);
  await notifyPg(
    c.env,
    invite.requester_family_id,
    "friend_playdate_invites",
    "UPDATE",
    hydrateInvite(accepted, invite.requester_family_id),
    hydrateInvite(invite, invite.requester_family_id),
  );
  await notifyPg(
    c.env,
    invite.receiver_family_id,
    "friend_playdate_invites",
    "UPDATE",
    hydrateInvite(accepted, invite.receiver_family_id),
    hydrateInvite(invite, invite.receiver_family_id),
  );
  await notifyPg(c.env, invite.requester_family_id, "friend_playdate_sessions", "INSERT", hydratedSession, null);
  await notifyPg(c.env, invite.receiver_family_id, "friend_playdate_sessions", "INSERT", hydratedSession, null);
  return c.json(hydratedSession);
});

// ── POST /api/playdate/invites/:id/decline — receiver child declines ──────────
playdate.post("/invites/:id/decline", requireAuth, async (c) => {
  const user = c.get("user");
  const invite = await loadInvite(c.env.DB, c.req.param("id"));
  if (!invite) return c.json({ error: "not_found" }, 404);
  if (invite.status !== "pending") return c.json({ error: "invite_not_pending" }, 409);
  if (invite.receiver_child_id !== user.sub) return c.json({ error: "forbidden" }, 403);

  const now = pgNow();
  const res = await c.env.DB.prepare(
    `UPDATE friend_playdate_invites
        SET status = 'declined', responded_at = ?, responded_by = ?
      WHERE id = ? AND status = 'pending'`,
  )
    .bind(now, user.sub, invite.id)
    .run();
  if (!res.meta.changes) return c.json({ error: "invite_not_pending" }, 409);

  const declined = await loadInvite(c.env.DB, invite.id);
  await notifyPg(
    c.env,
    invite.requester_family_id,
    "friend_playdate_invites",
    "UPDATE",
    hydrateInvite(declined, invite.requester_family_id),
    hydrateInvite(invite, invite.requester_family_id),
  );
  await notifyPg(
    c.env,
    invite.receiver_family_id,
    "friend_playdate_invites",
    "UPDATE",
    hydrateInvite(declined, invite.receiver_family_id),
    hydrateInvite(invite, invite.receiver_family_id),
  );
  return c.json(hydrateInvite(declined, invite.receiver_family_id));
});

// ── POST /api/playdate/sessions — 레거시 직접 생성 경로 폐쇄 ─────────────────
// 세션은 수신 아이가 유효한 초대를 수락한 원자 경로에서만 생성한다.
playdate.post("/sessions", requireAuth, (c) => (
  c.json({ error: "playdate_invite_accept_required" }, 410)
));

// ── PATCH /api/playdate/sessions/:id — endPlaydate(멱등 종료) ───────────────────
// stopped_at IS NULL 가드로 첫 종료만 승리(부모 정지 + 자녀 그만 동시 클릭 방지).
playdate.patch("/sessions/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const b = await c.req.json<Record<string, unknown>>();
  const stopReason = String(b.stop_reason ?? "");
  if (!VALID_STOP_REASONS.has(stopReason)) {
    return c.json({ error: `invalid stop_reason: ${stopReason}` }, 400);
  }
  const sess = await c.env.DB.prepare(
    `SELECT family_a_id, family_b_id, child_a_id, child_b_id
       FROM friend_playdate_sessions WHERE id = ?`,
  )
    .bind(id)
    .first<{ family_a_id: string; family_b_id: string; child_a_id: string | null; child_b_id: string | null }>();
  if (!sess) return c.json({ error: "not_found" }, 404);
  const membershipA = await resolveVerifiedFamilyMembership(c.env.DB, user.sub, sess.family_a_id);
  const membershipB = await resolveVerifiedFamilyMembership(c.env.DB, user.sub, sess.family_b_id);
  const isParent = membershipA?.role === "parent" || membershipB?.role === "parent";
  const isParticipantChild = (
    membershipA?.role === "child" || membershipB?.role === "child"
  ) && (user.sub === sess.child_a_id || user.sub === sess.child_b_id);
  if (
    (stopReason === "parent_end" && !isParent)
    || (stopReason === "child_end" && !isParticipantChild)
    || stopReason === "auto_geofence_exit"
  ) {
    return c.json({ error: "forbidden" }, 403);
  }

  const res = await c.env.DB.prepare(
    `UPDATE friend_playdate_sessions SET stopped_at = ?, stop_reason = ? WHERE id = ? AND stopped_at IS NULL`,
  )
    .bind(pgNow(), stopReason, id)
    .run();
  if (!res.meta.changes) return c.json({ updated: false });

  const row = await c.env.DB.prepare(`SELECT * FROM friend_playdate_sessions WHERE id = ?`)
    .bind(id)
    .first<Record<string, unknown>>();
  const hydrated = hydrateSession(row);
  await notifyPg(c.env, sess.family_a_id, "friend_playdate_sessions", "UPDATE", hydrated, null);
  await notifyPg(c.env, sess.family_b_id, "friend_playdate_sessions", "UPDATE", hydrated, null);
  return c.json({ updated: true, session: hydrated });
});

// ── GET /api/playdate/sessions/active?family_id=... — get_active_playdate_session ─
// 진행 중 세션 + perspective-aware 친구 가족 연락처/이름 enrich. 없으면 null.
playdate.get("/sessions/active", requireAuth, async (c) => {
  const familyId = c.req.query("family_id") ?? "";
  const user = c.get("user");
  if (!(await assertFamilyAccess(c.env.DB, user.sub, familyId))) {
    return c.json({ error: "forbidden" }, 403);
  }

  const s = await c.env.DB.prepare(
    `SELECT id, public_place_id, family_a_id, family_b_id, child_a_id, child_b_id,
            started_at, stopped_at, stop_reason
       FROM friend_playdate_sessions
      WHERE (family_a_id = ?1 OR family_b_id = ?1) AND stopped_at IS NULL
      ORDER BY substr(started_at, 1, 19) DESC LIMIT 1`,
  )
    .bind(familyId)
    .first<Record<string, unknown>>();
  if (!s) return c.json(null);

  const friendFamilyId = s.family_a_id === familyId ? s.family_b_id : s.family_a_id;
  const friendChildId = s.family_a_id === familyId ? s.child_b_id : s.child_a_id;

  return c.json({
    id: s.id,
    public_place_id: s.public_place_id,
    family_a_id: s.family_a_id,
    family_b_id: s.family_b_id,
    started_at: pgToIso(s.started_at as string),
    stopped_at: s.stopped_at ? pgToIso(s.stopped_at as string) : null,
    stop_reason: s.stop_reason ?? null,
    place_name: await placeName(c.env.DB, s.public_place_id as string),
    friend_child_name: await memberName(c.env.DB, friendChildId as string | null),
    friend_family_phones: await parentPhones(c.env.DB, friendFamilyId as string),
  });
});

// ── GET /api/playdate/sessions/history?family_id=...&limit=10 — get_playdate_history ─
playdate.get("/sessions/history", requireAuth, async (c) => {
  const familyId = c.req.query("family_id") ?? "";
  const user = c.get("user");
  if (!(await assertFamilyAccess(c.env.DB, user.sub, familyId))) {
    return c.json({ error: "forbidden" }, 403);
  }
  const rawLimit = Number(c.req.query("limit") ?? 10) || 10;
  const limit = Math.max(1, Math.min(rawLimit, 50));

  const { results } = await c.env.DB.prepare(
    `SELECT s.id AS id, s.public_place_id AS public_place_id, s.family_a_id AS family_a_id,
            s.family_b_id AS family_b_id, s.started_at AS started_at, s.stopped_at AS stopped_at,
            s.stop_reason AS stop_reason,
            COALESCE(pp.name, '현재 장소') AS place_name,
            COALESCE(fc.name, '친구') AS friend_child_name
       FROM (
         SELECT id, public_place_id, family_a_id, family_b_id, child_a_id, child_b_id,
                started_at, stopped_at, stop_reason
           FROM friend_playdate_sessions
          WHERE (family_a_id = ?1 OR family_b_id = ?1) AND stopped_at IS NOT NULL
          ORDER BY substr(started_at, 1, 19) DESC
          LIMIT ?2
       ) s
       LEFT JOIN public_places pp ON pp.id = s.public_place_id
       LEFT JOIN family_members fc
         ON fc.user_id = (CASE WHEN s.family_a_id = ?1 THEN s.child_b_id ELSE s.child_a_id END)
        AND fc.family_id = (CASE WHEN s.family_a_id = ?1 THEN s.family_b_id ELSE s.family_a_id END)
      ORDER BY substr(s.started_at, 1, 19) DESC`,
  )
    .bind(familyId, limit)
    .all<Record<string, unknown>>();

  const out = (results ?? []).map((r) => ({
    ...r,
    started_at: pgToIso(r.started_at as string),
    stopped_at: r.stopped_at ? pgToIso(r.stopped_at as string) : null,
  }));
  return c.json(out);
});

// ── POST /api/playdate/public-places — 구버전 전역 카탈로그 쓰기 폐쇄 ────────
// 현재 앱은 후보 조회가 서버에서 검증한 현재 위치 장소만 사용한다. client 제공 Kakao id와
// 좌표로 전역 public_places를 선점하던 레거시 경로는 cross-family 오염을 막기 위해 닫는다.
playdate.post("/public-places", requireAuth, (c) => (
  c.json({ error: "playdate_public_place_write_disabled" }, 410)
));

// ── GET /api/playdate/family-enabled?family_id=... — fetchFamilyEnabled read ─────
// FriendPlaydatePanel 의 families.playdate_enabled select 직역. RLS(자가족 select)→
// assertFamilyAccess. 행 없음/누락은 클라 기본값(true)과 동일하게 true 로 반환한다.
playdate.get("/family-enabled", requireAuth, async (c) => {
  const familyId = c.req.query("family_id") ?? "";
  const user = c.get("user");
  if (!(await assertFamilyAccess(c.env.DB, user.sub, familyId))) {
    return c.json({ error: "forbidden" }, 403);
  }
  const fam = await c.env.DB.prepare(`SELECT id, playdate_enabled FROM families WHERE id = ? LIMIT 1`)
    .bind(familyId)
    .first<{ id: string; playdate_enabled: number | null }>();
  if (!fam) return c.json({ id: familyId, playdate_enabled: true });
  return c.json({ id: fam.id, playdate_enabled: Number(fam.playdate_enabled) === 1 });
});

// ── PATCH /api/playdate/family-enabled — setFamilyPlaydateEnabled(families 토글) ─
// PIPA: 양가족 동의 토글이라 부모(주/보조)만 변경 가능.
playdate.patch("/family-enabled", requireAuth, async (c) => {
  const user = c.get("user");
  const b = await c.req.json<Record<string, unknown>>();
  const familyId = String(b.family_id ?? "");
  const enabled = !!b.enabled;
  if (!familyId) return c.json({ error: "family_id required" }, 400);
  if (!(await isFamilyParent(c.env.DB, user.sub, familyId))) {
    return c.json({ error: "forbidden" }, 403);
  }
  await c.env.DB.prepare(`UPDATE families SET playdate_enabled = ? WHERE id = ?`)
    .bind(enabled ? 1 : 0, familyId)
    .run();
  await notifyPg(c.env, familyId, "families", "UPDATE", { id: familyId, playdate_enabled: enabled }, null);
  return c.json({ ok: true });
});

// ── enrich 헬퍼 ────────────────────────────────────────────────────────────────

// 세션 row 의 timestamp 를 ISO 로 정규화(클라 new Date() 파싱 안전).
function hydrateSession(r: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!r) return null;
  return {
    ...r,
    started_at: r.started_at ? pgToIso(r.started_at as string) : null,
    stopped_at: r.stopped_at ? pgToIso(r.stopped_at as string) : null,
    created_at: r.created_at ? pgToIso(r.created_at as string) : null,
  };
}

async function placeName(db: D1Database, publicPlaceId: string): Promise<string> {
  if (!publicPlaceId) return "현재 장소";
  const row = await db.prepare(`SELECT name FROM public_places WHERE id = ? LIMIT 1`)
    .bind(publicPlaceId)
    .first<{ name: string }>();
  return row?.name || "현재 장소";
}

async function memberName(db: D1Database, userId: string | null): Promise<string> {
  if (!userId) return "친구";
  const row = await db.prepare(`SELECT name FROM family_members WHERE user_id = ? LIMIT 1`)
    .bind(userId)
    .first<{ name: string }>();
  return row?.name || "친구";
}

// 친구 가족 부모 연락처(엄마→아빠→미상 순, 빈값 제외) 문자열 배열.
async function parentPhones(db: D1Database, familyId: string): Promise<string[]> {
  if (!familyId) return [];
  const { results } = await db
    .prepare(
      `SELECT phone FROM family_members
        WHERE family_id = ? AND role = 'parent' AND phone IS NOT NULL AND phone <> ''
        ORDER BY (CASE gender WHEN 'mom' THEN 0 WHEN 'dad' THEN 1 ELSE 2 END), name`,
    )
    .bind(familyId)
    .all<{ phone: string }>();
  return (results ?? []).map((r) => r.phone).filter(Boolean);
}

export default playdate;

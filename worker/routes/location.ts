// 위치 read API.
//   GET /api/location/children   ← fetchChildLocations (child_locations)
//   GET /api/location/incidents  ← fetchLocationIncidentsForDate (parent_alerts 위치 인시던트)
//   GET /api/location/history    ← fetchLocationHistoryForDate (location_history)
//
// 날짜 경계(start/end)는 클라가 로컬 타임존으로 계산해 ISO로 전달한다(타임존 일치 보장).
import { Hono } from "hono";
import type { Env, Vars } from "../types";
import type { LocationAccessMode } from "../db/authz";
import { requireAuth } from "../middleware/auth";
import { resolveLocationAccessMode, resolveLocationCallerRole } from "../db/authz";
import {
  LOCATION_MANUAL_USAGE_ACTION,
  locationManualUsageTarget,
} from "../lib/featureUsageQuota";
import { pgToMs } from "../lib/time";
import {
  recordLocationConfirmationForSubjects,
  type LocationConfirmationSubject,
} from "../lib/locationConfirmationAudit";
import {
  createLocationAuditCursor,
  isLocationAuditCursorSecretConfigured,
  LOCATION_AUDIT_CURSOR_VERSION,
  verifyLocationAuditCursor,
  type LocationAuditCursorPayload,
} from "../lib/locationAuditCursor";

const location = new Hono<{ Bindings: Env; Variables: Vars }>();

const LOCATION_INCIDENT_ALERT_TYPES = [
  "location_stale",
  "location_recovered",
  "child_unpair_suspected",
];

const STANDARD_LOCATION_INTERVAL_MS = 10 * 60_000;
const MANUAL_LOCATION_RESULT_WINDOW_MS = 5 * 60_000;
const PREMIUM_LOCATION_HISTORY_MS = 30 * 24 * 60 * 60_000;
const KST_OFFSET_MS = 9 * 60 * 60_000;
const HISTORY_DAY_START_HOUR = 8;
const LOCATION_AUDIT_PAGE_SIZE = 1_000;

// Free/reviewed 자동 위치는 10분 버킷마다 한 번 갱신된다. 경계 이후의 최신점을
// 자동으로 대신 노출하지 않아 Premium 실시간 위치가 Free로 새지 않는다.
export function locationStandardCutoff(nowMs = Date.now()): string {
  const cutoffMs = Math.floor(nowMs / STANDARD_LOCATION_INTERVAL_MS)
    * STANDARD_LOCATION_INTERVAL_MS;
  return new Date(cutoffMs)
    .toISOString()
    .replace("T", " ")
    .replace("Z", "000+00");
}

// 활성 아이별로 (user_id, recorded_at) 인덱스에서 cutoff 이하 최신 실측점 1개만 찾는다.
// 가족 누적 이력을 먼저 window ranking하지 않아 아이 수에 비례한 index lookup으로 제한된다.
export const STANDARD_CHILD_LOCATIONS_SQL = `SELECT fm.user_id, lh.lat, lh.lng,
                                                    lh.recorded_at AS updated_at, lh.accuracy_m
                                               FROM family_members fm
                                               JOIN location_history lh ON lh.id = (
                                                 SELECT candidate.id
                                                   FROM location_history AS candidate
                                                        INDEXED BY idx_location_history_user_recorded
                                                  WHERE candidate.user_id = fm.user_id
                                                    AND candidate.family_id = fm.family_id
                                                    AND (candidate.is_estimated IS NULL OR candidate.is_estimated = 0)
                                                    AND candidate.recorded_at <= ?
                                                  ORDER BY candidate.recorded_at DESC, candidate.id DESC
                                                  LIMIT 1
                                               )
                                              WHERE fm.family_id = ?
                                                AND fm.role = 'child'
                                                AND fm.is_active = 1
                                                AND fm.user_id IS NOT NULL
                                              ORDER BY fm.user_id ASC`;

export interface LocationHistoryReadWindow {
  startMs: number;
  endMs: number;
}

// 앱의 "오늘 경로" 정본과 동일하게 Asia/Seoul 오전 8시부터 다음 날 오전 8시까지다.
export function standardLocationHistoryWindow(nowMs = Date.now()): LocationHistoryReadWindow {
  const kst = new Date(nowMs + KST_OFFSET_MS);
  let startMs = Date.UTC(
    kst.getUTCFullYear(),
    kst.getUTCMonth(),
    kst.getUTCDate(),
    HISTORY_DAY_START_HOUR,
  ) - KST_OFFSET_MS;
  if (nowMs < startMs) startMs -= 24 * 60 * 60_000;
  return { startMs, endMs: startMs + 24 * 60 * 60_000 };
}

export function resolveLocationHistoryReadWindow(
  mode: LocationAccessMode,
  start: string,
  end: string,
  nowMs = Date.now(),
): LocationHistoryReadWindow | null {
  const requestedStartMs = Date.parse(start);
  const requestedEndMs = Date.parse(end);
  if (
    !Number.isFinite(requestedStartMs)
    || !Number.isFinite(requestedEndMs)
    || requestedStartMs >= requestedEndMs
  ) {
    return null;
  }

  if (mode === "standard") {
    const allowed = standardLocationHistoryWindow(nowMs);
    if (requestedStartMs < allowed.startMs || requestedEndMs > allowed.endMs) return null;
    const endMs = Math.min(requestedEndMs, nowMs);
    return requestedStartMs < endMs ? { startMs: requestedStartMs, endMs } : null;
  }
  if (mode !== "realtime") return null;

  const startMs = Math.max(requestedStartMs, nowMs - PREMIUM_LOCATION_HISTORY_MS);
  const endMs = Math.min(requestedEndMs, nowMs);
  return startMs < endMs ? { startMs, endMs } : null;
}

function d1Timestamp(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
}

type ChildLocationRow = {
  user_id: string;
  lat: number;
  lng: number;
  updated_at: string;
  accuracy_m: number | null;
};

export async function loadStandardChildLocations(
  db: D1Database,
  familyId: string,
  nowMs = Date.now(),
): Promise<ChildLocationRow[]> {
  const { results: automaticRows } = await db
    .prepare(STANDARD_CHILD_LOCATIONS_SQL)
    .bind(locationStandardCutoff(nowMs), familyId)
    .all<ChildLocationRow>();
  const byUserId = new Map(
    (automaticRows ?? []).map((row) => [String(row.user_id), row]),
  );

  // 수동 요청이 실제 새 fix로 이어진 경우에만 5분 확인 창 동안 최신점을 덮어쓴다.
  // usage ledger 조회 장애는 자동 10분 스냅샷으로 안전 강등하며 최신값을 fail-open하지 않는다.
  let usageRows: Array<{ key: string; created_at: string }> = [];
  try {
    const usage = await db
      .prepare(
        `SELECT key, created_at
           FROM push_idempotency
          WHERE family_id = ?1
            AND action = ?2
            AND substr(created_at, 1, 19) >= ?3
          ORDER BY substr(created_at, 1, 19) DESC`,
      )
      .bind(
        familyId,
        LOCATION_MANUAL_USAGE_ACTION,
        d1Timestamp(nowMs - MANUAL_LOCATION_RESULT_WINDOW_MS),
      )
      .all<{ key: string; created_at: string }>();
    usageRows = usage.results ?? [];
  } catch (error) {
    console.warn("[location] manual refresh ledger unavailable:");
    return [...byUserId.values()].sort((a, b) => a.user_id.localeCompare(b.user_id));
  }
  if (usageRows.length === 0) {
    return [...byUserId.values()].sort((a, b) => a.user_id.localeCompare(b.user_id));
  }

  const latestRequestByTarget = new Map<string, number>();
  for (const usage of usageRows) {
    const target = locationManualUsageTarget(usage.key);
    const requestedAt = pgToMs(usage.created_at);
    if (!target || !Number.isFinite(requestedAt)) continue;
    const existing = latestRequestByTarget.get(target) ?? Number.NEGATIVE_INFINITY;
    if (requestedAt > existing) latestRequestByTarget.set(target, requestedAt);
  }
  if (latestRequestByTarget.size === 0) {
    return [...byUserId.values()].sort((a, b) => a.user_id.localeCompare(b.user_id));
  }

  const { results: currentRows } = await db
    .prepare(
      `SELECT cl.user_id, cl.lat, cl.lng, cl.updated_at, cl.accuracy_m
         FROM child_locations cl
        WHERE cl.family_id = ?1
          AND cl.user_id IN (
            SELECT user_id FROM family_members
             WHERE family_id = ?1
               AND role = 'child'
               AND is_active = 1
               AND user_id IS NOT NULL
          )
        ORDER BY cl.user_id ASC`,
    )
    .bind(familyId)
    .all<ChildLocationRow>();

  const allRequestAt = latestRequestByTarget.get("*") ?? Number.NEGATIVE_INFINITY;
  for (const row of currentRows ?? []) {
    const requestedAt = Math.max(
      allRequestAt,
      latestRequestByTarget.get(String(row.user_id)) ?? Number.NEGATIVE_INFINITY,
    );
    const updatedAt = pgToMs(row.updated_at);
    if (Number.isFinite(requestedAt) && Number.isFinite(updatedAt) && updatedAt >= requestedAt) {
      byUserId.set(String(row.user_id), row);
    }
  }
  return [...byUserId.values()].sort((a, b) => a.user_id.localeCompare(b.user_id));
}

// ISO('...T..Z') → D1 timestamp 비교형('YYYY-MM-DD HH:MM:SS', UTC).
// D1 timestamp 는 'YYYY-MM-DD HH:MM:SS.ffffff+00'(공백 구분, +00) 형식이라 ISO 와
// raw 문자열 비교 시 'T'(0x54) vs ' '(0x20) 로 정렬이 깨진다(같은 날도 탈락) →
// 양쪽을 앞 19자만 잘라 UTC 기준 동일 형식으로 맞춰 비교한다. recorded_at/created_at
// 모두 UTC(+00)이고 클라 start/end 는 toISOString()(UTC)이라 타임존 변환 불필요.
function tsNorm(iso: string): string {
  return iso.replace("T", " ").slice(0, 19);
}

export interface LocationAuditRecord {
  id: string;
  subject_user_id: string;
  action: string;
  requester_kind: string;
  requester_user_id: string | null;
  recipient_kind: string;
  recipient_user_id: string | null;
  collection_method: string;
  acquisition_path: string;
  service_code: string;
  delivery_method: string;
  purpose_code: string;
  occurred_at: string;
  completed_at: string;
  recorded_at: string;
}

export interface LocationAuditPage {
  records: LocationAuditRecord[];
  hasMore: boolean;
  nextCursor: string | null;
}

async function parseLocationAuditCursor(
  rawCursor: string,
  scope: Pick<LocationAuditCursorPayload, "familyId" | "start" | "end" | "subjectUserId">,
  secret: string,
): Promise<LocationAuditCursorPayload | null> {
  const value = await verifyLocationAuditCursor(secret, rawCursor);
  if (!value) return null;
  const occurredAtMs = pgToMs(value.occurredAt);
  if (
    value.familyId !== scope.familyId
    || value.start !== scope.start
    || value.end !== scope.end
    || value.subjectUserId !== scope.subjectUserId
    || !Number.isFinite(occurredAtMs)
    || tsNorm(value.occurredAt) < tsNorm(scope.start)
    || tsNorm(value.occurredAt) >= tsNorm(scope.end)
  ) return null;
  return value;
}

function parseLocationAuditPageSize(rawPageSize: string | undefined): number | null {
  if (rawPageSize === undefined) return LOCATION_AUDIT_PAGE_SIZE;
  if (!/^[1-9]\d*$/u.test(rawPageSize)) return null;
  const pageSize = Number(rawPageSize);
  return Number.isSafeInteger(pageSize) && pageSize <= LOCATION_AUDIT_PAGE_SIZE
    ? pageSize
    : null;
}

async function activeLocationSubjects(
  db: D1Database,
  familyId: string,
  childUserId?: string | null,
): Promise<LocationConfirmationSubject[]> {
  let sql = `SELECT family_id, user_id FROM family_members
              WHERE family_id = ? AND role = 'child' AND is_active = 1
                AND user_id IS NOT NULL`;
  const binds: string[] = [familyId];
  if (childUserId) {
    sql += " AND user_id = ?";
    binds.push(childUserId);
  }
  sql += " ORDER BY user_id ASC";
  const { results } = await db
    .prepare(sql)
    .bind(...binds)
    .all<{ family_id: string; user_id: string }>();
  return (results ?? []).map((row) => ({
    familyId: String(row.family_id),
    subjectUserId: String(row.user_id),
  }));
}

async function recordParentLocationProvision(
  db: D1Database,
  familyId: string,
  parentUserId: string,
  serviceCode: "parent_live_map" | "parent_location_history" | "location_incident_history",
  acquisitionPath: "current_location_store" | "location_history_store" | "location_alert_store",
  purposeCode: "family_location_display" | "route_history_display" | "incident_history_display",
  subjectUserIds: readonly string[],
): Promise<void> {
  const subjects = [...new Set(
    subjectUserIds
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => value.trim()),
  )].map((subjectUserId) => ({ familyId, subjectUserId }));
  if (subjects.length === 0) return;
  await recordLocationConfirmationForSubjects(db, subjects, {
    action: "provide",
    requesterKind: "parent",
    requesterUserId: parentUserId,
    recipientKind: "family_parent",
    recipientUserId: parentUserId,
    collectionMethod: "not_applicable",
    acquisitionPath,
    serviceCode,
    deliveryMethod: "https_worker_api",
    purposeCode,
  });
}

// GET /api/location/children?family_id=...
// role='child' 이고 user_id 가 채워진(placeholder 제외) 구성원의 최신 위치.
location.get("/children", requireAuth, async (c) => {
  const familyId = c.req.query("family_id") ?? "";
  const user = c.get("user");

  const callerRole = await resolveLocationCallerRole(c.env.DB, user.sub, familyId);
  if (!callerRole) return c.json({ error: "forbidden" }, 403);

  // 아이는 티어와 무관하게 활성 상태인 본인 최신 위치 한 건만 조회한다.
  if (callerRole === "child") {
    const { results } = await c.env.DB.prepare(
      `SELECT cl.user_id, cl.lat, cl.lng, cl.updated_at, cl.accuracy_m
         FROM child_locations cl
        WHERE cl.family_id = ?
          AND cl.user_id = ?
          AND EXISTS (
            SELECT 1 FROM family_members fm
             WHERE fm.family_id = cl.family_id
               AND fm.user_id = cl.user_id
               AND fm.role = 'child'
               AND fm.is_active = 1
          )
        LIMIT 1`,
    )
      .bind(familyId, user.sub)
      .all();
    if ((results ?? []).length > 0) {
      try {
        await recordLocationConfirmationForSubjects(
          c.env.DB,
          [{ familyId, subjectUserId: user.sub }],
          {
            action: "use",
            requesterKind: "subject",
            requesterUserId: user.sub,
            recipientKind: "none",
            recipientUserId: null,
            collectionMethod: "not_applicable",
            acquisitionPath: "current_location_store",
            serviceCode: "child_self_location",
            deliveryMethod: "https_worker_api",
            purposeCode: "family_location_display",
          },
        );
      } catch {
        return c.json({ error: "location_confirmation_unavailable" }, 503);
      }
    }
    return c.json(results ?? []);
  }

  let mode: LocationAccessMode;
  try {
    mode = await resolveLocationAccessMode(c.env.DB, familyId);
  } catch {
    return c.json({ error: "location_entitlement_unavailable" }, 503);
  }
  if (mode === "locked") return c.json([]);
  let locationRows: ChildLocationRow[];
  if (mode === "standard") {
    locationRows = await loadStandardChildLocations(c.env.DB, familyId);
  } else {
    const { results } = await c.env.DB.prepare(
      `SELECT cl.user_id, cl.lat, cl.lng, cl.updated_at, cl.accuracy_m
         FROM child_locations cl
        WHERE cl.family_id = ?
          AND cl.user_id IN (
            SELECT user_id FROM family_members
             WHERE family_id = ? AND role = 'child' AND is_active = 1 AND user_id IS NOT NULL
          )
        ORDER BY cl.user_id ASC`,
    )
      .bind(familyId, familyId)
      .all<ChildLocationRow>();
    locationRows = results ?? [];
  }
  try {
    await recordParentLocationProvision(
      c.env.DB,
      familyId,
      user.sub,
      "parent_live_map",
      mode === "standard" ? "location_history_store" : "current_location_store",
      "family_location_display",
      locationRows.map((row) => row.user_id),
    );
  } catch {
    return c.json({ error: "location_confirmation_unavailable" }, 503);
  }
  return c.json(locationRows);
});

// GET /api/location/incidents?family_id=...&start=ISO&end=ISO[&child_user_id=...]
location.get("/incidents", requireAuth, async (c) => {
  const familyId = c.req.query("family_id") ?? "";
  const start = c.req.query("start") ?? "";
  const end = c.req.query("end") ?? "";
  const childUserId = c.req.query("child_user_id");
  const user = c.get("user");

  const callerRole = await resolveLocationCallerRole(c.env.DB, user.sub, familyId);
  if (callerRole !== "parent") return c.json({ error: "forbidden" }, 403);
  if (!start || !end) return c.json([]);

  const typePh = LOCATION_INCIDENT_ALERT_TYPES.map(() => "?").join(",");
  let sql = `SELECT id, alert_type, title, message, severity, event_id, child_user_id, created_at
               FROM parent_alerts
              WHERE family_id = ?
                AND alert_type IN (${typePh})
                AND substr(created_at, 1, 19) >= ?
                AND substr(created_at, 1, 19) < ?`;
  const binds: unknown[] = [familyId, ...LOCATION_INCIDENT_ALERT_TYPES, tsNorm(start), tsNorm(end)];
  if (childUserId) {
    sql += ` AND child_user_id = ?
             AND child_user_id IN (
               SELECT user_id FROM family_members
                WHERE family_id = ? AND role = 'child' AND is_active = 1
             )`;
    binds.push(childUserId, familyId);
  } else {
    // 활성 자녀 격리(방어 심층화): 자녀 미지정(가족 전역) 조회에서도 superseded/삭제 자녀에
    // 귀속된 인시던트를 제외한다(가족 단위 child_user_id NULL/빈값은 유지). 클라가 활성 id 를
    // 넘기지 않는 경로(fetchTodayLocationIncidents(familyId, null))에도 서버가 격리를 보장.
    sql += ` AND (child_user_id IS NULL OR child_user_id = '' OR child_user_id IN (
                    SELECT user_id FROM family_members
                     WHERE family_id = ? AND role = 'child' AND is_active = 1))`;
    binds.push(familyId);
  }
  sql += ` ORDER BY created_at ASC`;

  const { results } = await c.env.DB.prepare(sql)
    .bind(...binds)
    .all<{ child_user_id: string | null }>();

  try {
    await recordParentLocationProvision(
      c.env.DB,
      familyId,
      user.sub,
      "location_incident_history",
      "location_alert_store",
      "incident_history_display",
      (results ?? []).map((row) => row.child_user_id ?? ""),
    );
  } catch {
    return c.json({ error: "location_confirmation_unavailable" }, 503);
  }

  return c.json(results ?? []);
});

// GET /api/location/history?family_id=...&start=ISO&end=ISO[&child_user_id=...]
//   ← fetchLocationHistoryForDate. 하루 이동경로(자녀 위치 점) 조회.
// D1 recorded_at 은 '2026-03-17 02:43:46.956739+00'(공백 구분) 형식이고 클라가 보내는
// start/end 는 ISO('...T...Z')라 raw 문자열 비교가 깨진다 → 양쪽 datetime()으로 UTC 정규화.
// PostgREST 1000행 cap 대응 페이지네이션을 단일 쿼리 LIMIT 으로 대체(클라 상한 10000과 일치).
location.get("/history", requireAuth, async (c) => {
  const familyId = c.req.query("family_id") ?? "";
  const start = c.req.query("start") ?? "";
  const end = c.req.query("end") ?? "";
  const childUserId = c.req.query("child_user_id");
  const user = c.get("user");

  const callerRole = await resolveLocationCallerRole(c.env.DB, user.sub, familyId);
  if (!callerRole) return c.json({ error: "forbidden" }, 403);
  // 이동 경로는 부모 전용이다. Free는 오늘(08:00 경계), Premium은 최근 30일이며 아이는 이 API에서 받지 않는다.
  if (callerRole === "child") {
    return c.json([]);
  }

  let mode: LocationAccessMode;
  try {
    mode = await resolveLocationAccessMode(c.env.DB, familyId);
  } catch {
    return c.json({ error: "location_entitlement_unavailable" }, 503);
  }
  if (!start || !end) return c.json([]);
  const readWindow = resolveLocationHistoryReadWindow(mode, start, end);
  if (!readWindow) return c.json([]);

  let sql = `SELECT user_id, lat, lng, recorded_at, is_estimated, accuracy_m
               FROM location_history
              WHERE family_id = ?
                AND substr(recorded_at, 1, 19) >= ?
                AND substr(recorded_at, 1, 19) < ?
                AND user_id IN (
                  SELECT user_id FROM family_members
                   WHERE family_id = ? AND role = 'child' AND is_active = 1 AND user_id IS NOT NULL
                )`;
  const binds: unknown[] = [
    familyId,
    d1Timestamp(readWindow.startMs),
    d1Timestamp(readWindow.endMs),
    familyId,
  ];
  if (childUserId) {
    sql += ` AND user_id = ?`;
    binds.push(childUserId);
  }
  sql += ` ORDER BY substr(recorded_at, 1, 19) ASC LIMIT 10000`;

  const { results } = await c.env.DB.prepare(sql)
    .bind(...binds)
    .all<{ user_id: string }>();

  try {
    await recordParentLocationProvision(
      c.env.DB,
      familyId,
      user.sub,
      "parent_location_history",
      "location_history_store",
      "route_history_display",
      (results ?? []).map((row) => row.user_id),
    );
  } catch {
    return c.json({ error: "location_confirmation_unavailable" }, 503);
  }

  return c.json(results ?? []);
});

// GET /api/location/audit?family_id=...&start=ISO&end=ISO[&child_user_id=...][&pageSize=1000][&cursor=...]
// 법정 확인자료 최소 열람 API. 좌표·주소·자유문구는 스키마에 존재하지 않는다.
// 모든 성공 응답은 keyset page 객체다. 기본 1,000건을 넘겨도 조용히 잘리지 않는다.
location.get("/audit", requireAuth, async (c) => {
  const familyId = c.req.query("family_id") ?? "";
  const start = c.req.query("start") ?? "";
  const end = c.req.query("end") ?? "";
  const childUserId = c.req.query("child_user_id") ?? null;
  const rawPageSize = c.req.query("pageSize");
  const rawCursor = c.req.query("cursor");
  const pageSize = parseLocationAuditPageSize(rawPageSize);
  const user = c.get("user");
  const callerRole = await resolveLocationCallerRole(c.env.DB, user.sub, familyId);
  if (!callerRole) return c.json({ error: "forbidden" }, 403);
  if (pageSize === null) {
    return c.json({ error: "invalid_audit_page_size" }, 400);
  }

  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  const maxWindowMs = 31 * 24 * 60 * 60_000;
  if (
    !Number.isFinite(startMs)
    || !Number.isFinite(endMs)
    || startMs >= endMs
    || endMs - startMs > maxWindowMs
  ) return c.json({ error: "invalid_audit_window" }, 400);
  const cursorSecret = c.env.LOCATION_AUDIT_CURSOR_SECRET;
  if (!isLocationAuditCursorSecretConfigured(cursorSecret)) {
    return c.json({ error: "location_audit_cursor_unavailable" }, 503);
  }

  const startKey = tsNorm(start);
  const endKey = tsNorm(end);
  let subjectUserId: string | null = null;
  if (callerRole === "child") {
    subjectUserId = user.sub;
  } else if (childUserId) {
    const subjects = await activeLocationSubjects(c.env.DB, familyId, childUserId);
    if (subjects.length === 0) {
      return c.json({ records: [], hasMore: false, nextCursor: null } satisfies LocationAuditPage);
    }
    subjectUserId = childUserId;
  }

  const cursorScope = {
    familyId,
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
    subjectUserId,
  };
  const cursor = rawCursor === undefined
    ? null
    : await parseLocationAuditCursor(rawCursor, cursorScope, cursorSecret);
  if (rawCursor !== undefined && !cursor) {
    return c.json({ error: "invalid_audit_cursor" }, 400);
  }
  const effectivePageSize = pageSize ?? LOCATION_AUDIT_PAGE_SIZE;

  let sql = `SELECT id, subject_user_id, action, requester_kind, requester_user_id,
                    recipient_kind, recipient_user_id, collection_method, acquisition_path,
                    service_code, delivery_method, purpose_code, occurred_at, completed_at,
                    recorded_at
               FROM location_confirmation_records
              WHERE family_id = ?
                AND substr(occurred_at,1,19) >= ?
                AND substr(occurred_at,1,19) < ?`;
  const binds: unknown[] = [familyId, startKey, endKey];
  if (subjectUserId) {
    sql += " AND subject_user_id = ?";
    binds.push(subjectUserId);
  } else {
    sql += ` AND subject_user_id IN (
              SELECT user_id FROM family_members
               WHERE family_id = ? AND role = 'child' AND is_active = 1
                 AND user_id IS NOT NULL
            )`;
    binds.push(familyId);
  }
  if (cursor) {
    sql += ` AND (
              occurred_at < ?
              OR (occurred_at = ? AND id < ?)
            )`;
    binds.push(cursor.occurredAt, cursor.occurredAt, cursor.id);
  }
  const queryLimit = effectivePageSize + 1;
  sql += " ORDER BY occurred_at DESC, id DESC LIMIT ?";
  binds.push(queryLimit);
  const { results } = await c.env.DB.prepare(sql)
    .bind(...binds)
    .all<LocationAuditRecord>();
  const fetched = results ?? [];
  const records = fetched.slice(0, effectivePageSize);
  const hasMore = fetched.length > records.length;
  const last = records.at(-1);
  let nextCursor: string | null = null;
  if (hasMore && last) {
    nextCursor = await createLocationAuditCursor(cursorSecret, {
        v: LOCATION_AUDIT_CURSOR_VERSION,
        ...cursorScope,
        occurredAt: last.occurred_at,
        id: last.id,
      });
    if (!nextCursor) {
      return c.json({ error: "location_audit_cursor_unavailable" }, 503);
    }
  }
  return c.json({ records, hasMore, nextCursor } satisfies LocationAuditPage);
});

export default location;

// unregistered-stay-check (cron */4) — supabase edge 직역.
// 프리미엄 가족 자녀가 미등록 장소에서 5분 이상(50m 내) 체류하면 역지오코딩해
// 부모에게 "📍 ○○ 근처 도착" + 종료 시 "🚶 출발" 알림. 등록장소는 제외(geofence 중복 방지).
// location_history 를 서버에서 읽으므로 자녀 앱 백그라운드에서도 동작.
import type { Env } from "../types";
import type { PushEnv } from "../lib/pushEnv";
import {
  buildServerDwellPlaces,
  isNearRegisteredPlace,
  dwellGridKey,
  haversineM,
  STAY_ALERT_DWELL_MIN_MS,
} from "../shared/dwellCluster.js";
import { resolveFamilyMapLabel } from "../lib/maps/labelResolver";
import { SERVER_GEOFENCE_CONFIG } from "../shared/registeredPlaceGeofence.js";
import {
  buildUnregisteredStayLeftAlert,
  stayLeftEpisodeIdempotencyKey,
  openEpisodeStartMs,
  closedEpisodeStartMarker,
  isSameOpenArrivalEpisode,
  findConfirmedDepartureFix,
} from "../shared/unregisteredStay.js";
import { coord } from "./_geo";
import { coarseStayAreaKey } from "../lib/unregisteredStayPresenceDedupe";
import { deliverParentAlert } from "./_deliver";
import {
  acquireAccountMutationLeases,
  isActiveChildMutationTarget,
  loadFamilyNotificationMutationScopes,
  releaseAccountMutationLeases,
} from "../lib/accountMutationScope";
import { pgNow, pgToMs, pgTs, tsNorm } from "../lib/time";
import { premiumFamilyEntitlementSql } from "../shared/subscriptionEntitlement.js";
import { recordLocationConfirmationForSubjects } from "../lib/locationConfirmationAudit";
import { chunkSqlVariables } from "../lib/sqlChunk";

const HISTORY_WINDOW_MS = 45 * 60 * 1000;
const DWELL_FRESH_MS = 10 * 60 * 1000;
const EXCLUDE_RADIUS_M = 100;
const STAY_COOLDOWN_MS = 60 * 60 * 1000;
const EPISODE_BUCKET_MS = 5 * 60 * 1000;
const LEFT_GRACE_MS = 8 * 60 * 1000;
const LEFT_AWAY_RADIUS_M = 120;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const SCHEDULE_SUGGESTION_LOOKBACK_MS = 28 * 24 * 60 * 60 * 1000;
const SCHEDULE_SUGGESTION_MIN_DWELL_MS = 45 * 60 * 1000;
const SCHEDULE_SUGGESTION_RADIUS_M = 100;
const SCHEDULE_SUGGESTION_TIME_TOLERANCE_MIN = 45;
const LOCATION_EVIDENCE_MAX_ACCURACY_M = Number(SERVER_GEOFENCE_CONFIG.maxAccuracyM);
const LOCATION_CRON_QUERY_CHUNK = 90;

interface ChildRow {
  familyId: string;
  memberId: string;
  childUserId: string;
  name: string;
}
interface PlaceRow {
  lat: number;
  lng: number;
  radiusM: number | null;
}
interface StayState {
  gridKey: string;
  lastAlertedAtMs: number | null;
  lastEpisodeStartMs: number | null;
  lastAreaLabel: string;
}

function parseGridKey(gridKey: string): { lat: number; lng: number } | null {
  const parts = String(gridKey || "").split(",");
  if (parts.length !== 2) return null;
  const lat = Number(parts[0]);
  const lng = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function kstDate(ms: number): Date {
  return new Date(ms + KST_OFFSET_MS);
}

function kstWeekday(ms: number): number {
  return kstDate(ms).getUTCDay();
}

function kstMinuteOfDay(ms: number): number {
  const d = kstDate(ms);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function weekBucket(ms: number): number {
  return Math.floor((ms + KST_OFFSET_MS) / (7 * 24 * 60 * 60 * 1000));
}

function minuteDistance(a: number, b: number): number {
  const raw = Math.abs(a - b);
  return Math.min(raw, 24 * 60 - raw);
}

function timeToMinutes(value: string | null | undefined): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

function minutesToTime(totalMin: number): string {
  const m = ((Math.round(totalMin) % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function dateKeyWeekday(dateKey: string): number | null {
  const parts = String(dateKey || "").split("-").map((v) => Number(v));
  if (parts.length !== 3 || parts.some((v) => !Number.isInteger(v))) return null;
  return new Date(parts[0], parts[1], parts[2]).getDay();
}

function weekdayLabel(weekday: number): string {
  return ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"][weekday] ?? "해당 요일";
}

function clockLabel(minuteOfDay: number): string {
  const h = Math.floor(minuteOfDay / 60);
  const m = minuteOfDay % 60;
  const ampm = h < 12 ? "오전" : "오후";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${ampm} ${h12}시${m > 0 ? ` ${m}분` : ""}`;
}

function appDateKeyFromKstDate(d: Date): string {
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

function nextDateKeyForWeekday(weekday: number, nowMs: number): string {
  const nowKst = kstDate(nowMs);
  const today = new Date(Date.UTC(nowKst.getUTCFullYear(), nowKst.getUTCMonth(), nowKst.getUTCDate()));
  const diff = (weekday - today.getUTCDay() + 7) % 7;
  today.setUTCDate(today.getUTCDate() + diff);
  return appDateKeyFromKstDate(today);
}

// 프리미엄 + families.unregistered_stay_alert_enabled(기본 ON, 0/1) → 자녀 멤버.
async function loadEligibleChildren(
  db: D1Database,
): Promise<{ children: ChildRow[]; familyIds: string[] }> {
  const subs = await db
    .prepare(`SELECT f.id AS family_id FROM families f WHERE ${premiumFamilyEntitlementSql("f")}`)
    .all<{ family_id: string }>();
  const premiumIds = [...new Set((subs.results ?? []).map((r) => r.family_id).filter(Boolean))];
  if (!premiumIds.length) return { children: [], familyIds: [] };

  const familyRows: Array<{ id: string; unregistered_stay_alert_enabled: number }> = [];
  for (const ids of chunkSqlVariables(premiumIds, LOCATION_CRON_QUERY_CHUNK)) {
    const ph = ids.map(() => "?").join(",");
    const { results } = await db
      .prepare(`SELECT id, unregistered_stay_alert_enabled FROM families WHERE id IN (${ph})`)
      .bind(...ids)
      .all<{ id: string; unregistered_stay_alert_enabled: number }>();
    familyRows.push(...(results ?? []));
  }
  // 0/1 boolean: default ON, !== false → 1(또는 누락)만 ON. 명시적 0 만 OFF.
  const enabledIds = familyRows
    .filter((family) => Number(family.unregistered_stay_alert_enabled) !== 0)
    .map((family) => String(family.id));
  if (!enabledIds.length) return { children: [], familyIds: [] };

  const children: ChildRow[] = [];
  for (const ids of chunkSqlVariables(enabledIds, LOCATION_CRON_QUERY_CHUNK)) {
    const ph = ids.map(() => "?").join(",");
    const { results } = await db
      .prepare(`SELECT id, family_id, user_id, name FROM family_members WHERE family_id IN (${ph}) AND role = 'child' AND is_active = 1`)
      .bind(...ids)
      .all<{ id: string; family_id: string; user_id: string | null; name: string | null }>();
    for (const member of results ?? []) {
      if (!member.user_id) continue;
      children.push({
        familyId: String(member.family_id),
        memberId: String(member.id),
        childUserId: String(member.user_id),
        name: String(member.name || ""),
      });
    }
  }
  return { children, familyIds: enabledIds };
}

// 제외할 등록장소: saved_places + academies + danger_zones(radius_m).
async function loadExcludePlaces(db: D1Database, familyIds: string[]): Promise<Map<string, PlaceRow[]>> {
  const byFamily = new Map<string, PlaceRow[]>();
  if (!familyIds.length) return byFamily;
  const add = (familyId: string, loc: unknown, radiusM: number | null) => {
    const c = coord(loc);
    if (!c) return;
    const arr = byFamily.get(familyId) || [];
    arr.push({ lat: c.lat, lng: c.lng, radiusM });
    byFamily.set(familyId, arr);
  };
  for (const ids of chunkSqlVariables(familyIds, LOCATION_CRON_QUERY_CHUNK)) {
    const ph = ids.map(() => "?").join(",");
    const saved = await db
      .prepare(`SELECT family_id, location FROM saved_places WHERE family_id IN (${ph})`)
      .bind(...ids)
      .all<{ family_id: string; location: string }>();
    for (const row of saved.results ?? []) add(String(row.family_id), row.location, null);
    const academies = await db
      .prepare(`SELECT family_id, location FROM academies WHERE family_id IN (${ph})`)
      .bind(...ids)
      .all<{ family_id: string; location: string }>();
    for (const row of academies.results ?? []) add(String(row.family_id), row.location, null);
    const zones = await db
      .prepare(`SELECT family_id, lat, lng, radius_m FROM danger_zones WHERE family_id IN (${ph})`)
      .bind(...ids)
      .all<{ family_id: string; lat: number; lng: number; radius_m: number }>();
    // danger_zones 는 lat/lng 컬럼(jsonb location 아님) — coord 대신 직접.
    for (const zone of zones.results ?? []) {
      const lat = Number(zone.lat);
      const lng = Number(zone.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const arr = byFamily.get(String(zone.family_id)) || [];
      arr.push({
        lat,
        lng,
        radiusM: Number.isFinite(Number(zone.radius_m)) ? Number(zone.radius_m) : null,
      });
      byFamily.set(String(zone.family_id), arr);
    }
  }
  return byFamily;
}

// location_history 최근 윈도우(추정값 제외) → Map[`family:user`] = points 오름차순.
async function loadHistory(
  db: D1Database,
  childUserIds: string[],
  windowStartNorm: string,
): Promise<Map<string, Array<{ lat: number; lng: number; recordedMs: number }>>> {
  const map = new Map<string, Array<{ lat: number; lng: number; recordedMs: number }>>();
  if (!childUserIds.length) return map;
  for (const ids of chunkSqlVariables(childUserIds, LOCATION_CRON_QUERY_CHUNK)) {
    const ph = ids.map(() => "?").join(",");
    const { results } = await db
      .prepare(
        `SELECT user_id, family_id, lat, lng, recorded_at, accuracy_m FROM location_history
          WHERE user_id IN (${ph}) AND substr(recorded_at,1,19) > ? AND is_estimated = 0
            AND accuracy_m IS NOT NULL
            AND accuracy_m >= 0 AND accuracy_m <= ?
          ORDER BY substr(recorded_at,1,19) ASC, id ASC`,
      )
      .bind(...ids, windowStartNorm, LOCATION_EVIDENCE_MAX_ACCURACY_M)
      .all<{
        user_id: string;
        family_id: string;
        lat: number;
        lng: number;
        recorded_at: string;
        accuracy_m: number | null;
      }>();
    for (const row of results ?? []) {
      const lat = Number(row.lat);
      const lng = Number(row.lng);
      const ms = pgToMs(row.recorded_at);
      const accuracyM = Number(row.accuracy_m);
      if (
        row.accuracy_m == null
        || !Number.isFinite(lat)
        || !Number.isFinite(lng)
        || !Number.isFinite(ms)
        || !Number.isFinite(accuracyM)
        || accuracyM < 0
        || accuracyM > LOCATION_EVIDENCE_MAX_ACCURACY_M
      ) continue;
      const key = `${row.family_id}:${row.user_id}`;
      const arr = map.get(key) || [];
      arr.push({ lat, lng, recordedMs: ms });
      map.set(key, arr);
    }
  }
  return map;
}

async function loadPresence(db: D1Database, familyIds: string[]): Promise<Map<string, StayState>> {
  const map = new Map<string, StayState>();
  if (!familyIds.length) return map;
  for (const ids of chunkSqlVariables(familyIds, LOCATION_CRON_QUERY_CHUNK)) {
    const ph = ids.map(() => "?").join(",");
    const { results } = await db
      .prepare(
        `SELECT family_id, child_user_id, grid_key, last_alerted_at_ms, last_episode_start_ms, last_area_label
           FROM child_stay_presence WHERE family_id IN (${ph})`,
      )
      .bind(...ids)
      .all<Record<string, unknown>>();
    for (const row of results ?? []) {
      map.set(`${row.family_id}:${row.child_user_id}:${row.grid_key}`, {
        gridKey: String(row.grid_key),
        lastAlertedAtMs: row.last_alerted_at_ms != null ? Number(row.last_alerted_at_ms) : null,
        lastEpisodeStartMs: row.last_episode_start_ms != null ? Number(row.last_episode_start_ms) : null,
        lastAreaLabel: String(row.last_area_label || ""),
      });
    }
  }
  return map;
}

async function loadDepartureEvidence(
  db: D1Database,
  childUserId: string,
  startMs: number,
  endMs: number,
): Promise<Array<{ lat: number; lng: number; recordedMs: number; isEstimated: boolean }>> {
  const startAt = pgTs(new Date(startMs));
  const endAt = pgTs(new Date(endMs));
  const { results } = await db
    .prepare(
      `SELECT lat, lng, recorded_at, accuracy_m
         FROM location_history
        WHERE user_id=?
          AND recorded_at >= ?
          AND recorded_at <= ?
          AND is_estimated = 0
          AND accuracy_m IS NOT NULL
          AND accuracy_m >= 0 AND accuracy_m <= ?
        ORDER BY recorded_at ASC, id ASC`,
    )
    .bind(childUserId, startAt, endAt, LOCATION_EVIDENCE_MAX_ACCURACY_M)
    .all<{ lat: number; lng: number; recorded_at: string; accuracy_m: number | null }>();
  return (results ?? [])
    .filter((row) => {
      if (row.accuracy_m == null) return false;
      const accuracyM = Number(row.accuracy_m);
      return Number.isFinite(accuracyM)
        && accuracyM >= 0
        && accuracyM <= LOCATION_EVIDENCE_MAX_ACCURACY_M;
    })
    .map((row) => ({
      lat: Number(row.lat),
      lng: Number(row.lng),
      recordedMs: pgToMs(row.recorded_at),
      isEstimated: false,
    }))
    .filter((row) => Number.isFinite(row.lat) && Number.isFinite(row.lng) && Number.isFinite(row.recordedMs));
}

// 진입 알림 후: 에피소드 OPEN(last_episode_start_ms = 양수). 복합 PK select-then-write.
async function persistArrival(
  db: D1Database,
  familyId: string,
  childUserId: string,
  gridKey: string,
  nowMs: number,
  episodeStartMs: number,
  areaLabel: string,
): Promise<void> {
  const now = pgNow();
  try {
    const ex = await db
      .prepare(`SELECT 1 AS ok FROM child_stay_presence WHERE family_id=? AND child_user_id=? AND grid_key=? LIMIT 1`)
      .bind(familyId, childUserId, gridKey)
      .first<{ ok: number }>();
    if (ex) {
      await db
        .prepare(
          `UPDATE child_stay_presence
              SET last_alerted_at_ms=?, last_episode_start_ms=?, last_area_label=?, updated_at=?
            WHERE family_id=? AND child_user_id=? AND grid_key=?`,
        )
        .bind(nowMs, episodeStartMs, areaLabel, now, familyId, childUserId, gridKey)
        .run();
    } else {
      await db
        .prepare(
          `INSERT INTO child_stay_presence
             (family_id, child_user_id, grid_key, last_alerted_at_ms, last_episode_start_ms, last_area_label, updated_at)
           VALUES (?,?,?,?,?,?,?)`,
        )
        .bind(familyId, childUserId, gridKey, nowMs, episodeStartMs, areaLabel, now)
        .run();
    }
  } catch (e) {
    console.error("[stay] arrival upsert failed");
  }
}

// 출발 알림 후: 에피소드 CLOSED(last_episode_start_ms = 음수 마커). 항상 기존 행 UPDATE.
async function persistDeparture(
  db: D1Database,
  familyId: string,
  childUserId: string,
  gridKey: string,
  closedMarker: number,
): Promise<void> {
  try {
    await db
      .prepare(
        `UPDATE child_stay_presence SET last_episode_start_ms=?, updated_at=?
          WHERE family_id=? AND child_user_id=? AND grid_key=?`,
      )
      .bind(closedMarker, pgNow(), familyId, childUserId, gridKey)
      .run();
  } catch (e) {
    console.error("[stay] departure upsert failed");
  }
}

async function hasMatchingSchedule(
  db: D1Database,
  child: ChildRow,
  center: { lat: number; lng: number },
  weekday: number,
  minuteOfDay: number,
): Promise<boolean> {
  const { results } = await db
    .prepare(
      `SELECT DISTINCT e.id, e.date_key, e.time, e.location
         FROM events e
         LEFT JOIN events_children ec ON ec.event_id = e.id
        WHERE e.family_id = ?
          AND (e.is_family_event = 1 OR ec.child_id = ?)`,
    )
    .bind(child.familyId, child.memberId)
    .all<{ id: string; date_key: string; time: string | null; location: string | null }>();

  for (const event of results ?? []) {
    if (dateKeyWeekday(event.date_key) !== weekday) continue;
    const eventMinute = timeToMinutes(event.time);
    if (eventMinute == null || minuteDistance(eventMinute, minuteOfDay) > SCHEDULE_SUGGESTION_TIME_TOLERANCE_MIN) continue;
    const eventPoint = coord(event.location);
    if (!eventPoint) continue;
    if (haversineM(center.lat, center.lng, eventPoint.lat, eventPoint.lng) <= SCHEDULE_SUGGESTION_RADIUS_M) {
      return true;
    }
  }
  return false;
}

async function repeatedDwellWeeks(
  db: D1Database,
  child: ChildRow,
  center: { lat: number; lng: number },
  weekday: number,
  minuteOfDay: number,
  nowMs: number,
): Promise<Set<number>> {
  const startNorm = tsNorm(new Date(nowMs - SCHEDULE_SUGGESTION_LOOKBACK_MS).toISOString());
  const { results } = await db
    .prepare(
      `SELECT lat, lng, recorded_at, accuracy_m
         FROM location_history
        WHERE family_id = ?
          AND user_id = ?
          AND substr(recorded_at,1,19) >= ?
          AND is_estimated = 0
          AND accuracy_m IS NOT NULL
          AND accuracy_m >= 0 AND accuracy_m <= ?
        ORDER BY substr(recorded_at,1,19) ASC, id ASC`,
    )
    .bind(child.familyId, child.childUserId, startNorm, LOCATION_EVIDENCE_MAX_ACCURACY_M)
    .all<{ lat: number; lng: number; recorded_at: string; accuracy_m: number | null }>();

  const points = (results ?? [])
    .filter((r) => {
      if (r.accuracy_m == null) return false;
      const accuracyM = Number(r.accuracy_m);
      return Number.isFinite(accuracyM)
        && accuracyM >= 0
        && accuracyM <= LOCATION_EVIDENCE_MAX_ACCURACY_M;
    })
    .map((r) => ({ lat: Number(r.lat), lng: Number(r.lng), recordedMs: pgToMs(r.recorded_at) }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Number.isFinite(p.recordedMs));
  const dwells = buildServerDwellPlaces(points, { minDwellMs: SCHEDULE_SUGGESTION_MIN_DWELL_MS });
  const weeks = new Set<number>();
  for (const dwell of dwells) {
    if (haversineM(dwell.lat, dwell.lng, center.lat, center.lng) > SCHEDULE_SUGGESTION_RADIUS_M) continue;
    if (kstWeekday(dwell.startMs) !== weekday) continue;
    if (minuteDistance(kstMinuteOfDay(dwell.startMs), minuteOfDay) > SCHEDULE_SUGGESTION_TIME_TOLERANCE_MIN) continue;
    weeks.add(weekBucket(dwell.startMs));
  }
  return weeks;
}

async function maybeDeliverScheduleSuggestion(
  env: PushEnv,
  db: D1Database,
  child: ChildRow,
  dwell: { lat: number; lng: number; startMs: number; durationMs: number },
  gridKey: string,
  areaLabel: string,
  nowMs: number,
): Promise<boolean> {
  if (dwell.durationMs < SCHEDULE_SUGGESTION_MIN_DWELL_MS) return false;
  const weekday = kstWeekday(dwell.startMs);
  const minuteOfDay = kstMinuteOfDay(dwell.startMs);
  const center = { lat: dwell.lat, lng: dwell.lng };
  if (await hasMatchingSchedule(db, child, center, weekday, minuteOfDay)) return false;
  const weeks = await repeatedDwellWeeks(db, child, center, weekday, minuteOfDay, nowMs);
  if (weeks.size < 2) return false;

  const label = areaLabel || "이 장소";
  const time = minutesToTime(minuteOfDay);
  const title = `📌 ${weekdayLabel(weekday)} ${clockLabel(minuteOfDay)} 일정 제안`;
  const idempotencyKey = `schedule_suggestion:${child.childUserId}:${gridKey}:${weekday}:${Math.floor(minuteOfDay / 30)}`;
  const alert = {
    alertType: "schedule_suggestion",
    severity: "info",
    title,
    message: `${child.name || "아이"}가 ${weekdayLabel(weekday)} ${clockLabel(minuteOfDay)}마다 ${label} 근처에 머무는 패턴이 보여요. 일정으로 등록하시겠어요?`,
  };
  const metadata = {
    kind: "schedule_suggestion",
    childUserId: child.childUserId,
    childMemberId: child.memberId,
    title: `${weekdayLabel(weekday)} ${clockLabel(minuteOfDay)} 일정`,
    dateKey: nextDateKeyForWeekday(weekday, nowMs),
    time,
    durationMinutes: 60,
    weekday,
    lat: center.lat,
    lng: center.lng,
    address: label,
    category: "other",
  };
  const { alertId } = await deliverParentAlert(env, db, {
    familyId: child.familyId,
    childUserId: child.childUserId,
    alert: { ...alert, metadata },
    idempotencyKey,
    metadata,
  });
  return !!alertId;
}

export async function run(env: Env): Promise<Record<string, unknown>> {
  const db = env.DB;
  const penv = env as PushEnv;

  const loaded = await loadEligibleChildren(db);
  if (!loaded.children.length) return { checked: 0, families: 0, alerted: 0, tracked: 0, left: 0 };

  const nowMs = Date.now();
  const windowStartNorm = tsNorm(new Date(nowMs - HISTORY_WINDOW_MS).toISOString());
  const childUserIds = loaded.children.map((c) => c.childUserId);
  const [history, excludeByFamily, presence] = await Promise.all([
    loadHistory(db, childUserIds, windowStartNorm),
    loadExcludePlaces(db, loaded.familyIds),
    loadPresence(db, loaded.familyIds),
  ]);
  const historyChildren = loaded.children.filter((child) =>
    (history.get(`${child.familyId}:${child.childUserId}`)?.length ?? 0) > 0
  );
  await recordLocationConfirmationForSubjects(
    db,
    historyChildren.map((child) => ({
      familyId: child.familyId,
      subjectUserId: child.childUserId,
    })),
    {
      action: "use",
      requesterKind: "system",
      requesterUserId: null,
      recipientKind: "none",
      recipientUserId: null,
      collectionMethod: "not_applicable",
      acquisitionPath: "location_history_store",
      serviceCode: "unregistered_stay_monitor",
      deliveryMethod: "worker_internal",
      purposeCode: "unregistered_stay_alert",
    },
  );

  const labelCache = new Map<string, string | null>();
  let alerted = 0;
  let tracked = 0;
  let left = 0;

  // ── 1단계: 진입(도착) — 미등록 체류 발견 시 알림 + 에피소드 OPEN ──
  const freshGridsByChild = new Map<string, Set<string>>();
  const latestFixByChild = new Map<string, { lat: number; lng: number; recordedMs: number }>();

  for (const child of loaded.children) {
    const childMutationScopes = await loadFamilyNotificationMutationScopes(
      db,
      child.familyId,
      [child.childUserId],
    );
    if (!childMutationScopes) continue;
    const childMutationLeases = await acquireAccountMutationLeases(db, childMutationScopes);
    if (childMutationLeases.status !== "acquired") continue;
    try {
    if (!(await isActiveChildMutationTarget(db, child.familyId, child.childUserId))) continue;
    const childKey = `${child.familyId}:${child.childUserId}`;
    const points = history.get(childKey) || [];
    if (points.length) latestFixByChild.set(childKey, points[points.length - 1]);
    if (points.length < 2) continue;
    const dwells = buildServerDwellPlaces(points, { minDwellMs: STAY_ALERT_DWELL_MIN_MS });
    if (!dwells.length) continue;
    const excludePlaces = excludeByFamily.get(child.familyId) || [];
    const freshGrids = freshGridsByChild.get(childKey) || new Set<string>();
    freshGridsByChild.set(childKey, freshGrids);

    for (const dwell of dwells) {
      const gridKey = dwellGridKey(dwell.lat, dwell.lng);
      if (isNearRegisteredPlace({ lat: dwell.lat, lng: dwell.lng }, excludePlaces, EXCLUDE_RADIUS_M)) continue;
      const dwellFresh = nowMs - dwell.endMs <= DWELL_FRESH_MS;
      if (dwellFresh) freshGrids.add(gridKey);
      if (!dwellFresh) continue;

      const stateKey = `${child.familyId}:${child.childUserId}:${gridKey}`;
      const prev = presence.get(stateKey);
      const sameEpisode = isSameOpenArrivalEpisode(prev?.lastEpisodeStartMs ?? null, dwell.startMs, EPISODE_BUCKET_MS);
      const inCooldown = prev?.lastAlertedAtMs != null && nowMs - prev.lastAlertedAtMs < STAY_COOLDOWN_MS;

      const labelKey = `${child.familyId}:${gridKey}`;
      let areaLabel = labelCache.get(labelKey);
      if (areaLabel === undefined) {
        areaLabel = await resolveFamilyMapLabel({
          env,
          familyId: child.familyId,
          point: { lat: dwell.lat, lng: dwell.lng },
        });
        labelCache.set(labelKey, areaLabel);
      }
      await maybeDeliverScheduleSuggestion(penv, db, child, dwell, gridKey, areaLabel || "", nowMs).catch((e) =>
        console.error("[stay] schedule suggestion failed"),
      );
      if (sameEpisode || inCooldown) continue;

      // 도착 알림의 단일 정본은 upsert 직후 arrivalDetect(150m·5분)다. 이 cron은
      // 같은 체류를 별도 alert_type으로 다시 울리지 않고 departure 추적 상태만 연다.
      await persistArrival(db, child.familyId, child.childUserId, gridKey, nowMs, dwell.startMs, areaLabel || "");
      presence.set(stateKey, {
        gridKey,
        lastAlertedAtMs: nowMs,
        lastEpisodeStartMs: dwell.startMs,
        lastAreaLabel: areaLabel || "",
      });
      tracked++;
    }
    } finally {
      await releaseAccountMutationLeases(db, childMutationLeases.leases);
    }
  }

  // ── 2단계: 출발(체류 종료) — OPEN 에피소드인데 그 grid 에 더 이상 머물지 않으면 ──
  const childById = new Map(loaded.children.map((c) => [`${c.familyId}:${c.childUserId}`, c]));
  // 이 패스에서 이미 출발을 알린 (자녀, 거친 지역) 집합 — 11m grid 지터로 갈린 형제 상태는 조용히 닫는다.
  const firedDepartureAreas = new Set<string>();
  for (const [stateKey, state] of presence) {
    const openStart = openEpisodeStartMs(state.lastEpisodeStartMs);
    if (openStart == null) continue;

    const lastColon = stateKey.lastIndexOf(":");
    const childKey = stateKey.slice(0, lastColon);
    const child = childById.get(childKey);
    if (!child) continue;

    const childMutationScopes = await loadFamilyNotificationMutationScopes(
      db,
      child.familyId,
      [child.childUserId],
    );
    if (!childMutationScopes) continue;
    const childMutationLeases = await acquireAccountMutationLeases(db, childMutationScopes);
    if (childMutationLeases.status !== "acquired") continue;
    try {
    if (!(await isActiveChildMutationTarget(db, child.familyId, child.childUserId))) continue;

    if (freshGridsByChild.get(childKey)?.has(state.gridKey)) continue;

    const latest = latestFixByChild.get(childKey);
    const gridCoord = parseGridKey(state.gridKey);
    if (!latest || !gridCoord) continue;

    const awayDist = haversineM(latest.lat, latest.lng, gridCoord.lat, gridCoord.lng);
    const movedAway = awayDist > LEFT_AWAY_RADIUS_M;
    const graceElapsed = nowMs - openStart > LEFT_GRACE_MS;
    if (!movedAway || !graceElapsed) continue;

    const departureEvidence = await loadDepartureEvidence(
      db,
      child.childUserId,
      openStart,
      latest.recordedMs,
    );
    const confirmedDeparture = findConfirmedDepartureFix(
      departureEvidence,
      gridCoord,
      LEFT_AWAY_RADIUS_M,
    );
    const confirmedAtMs = confirmedDeparture?.recordedMs ?? latest.recordedMs;
    const bucket = Math.floor(openStart / EPISODE_BUCKET_MS);
    const idempotencyKey = stayLeftEpisodeIdempotencyKey(child.childUserId, state.gridKey, bucket);
    const alert = buildUnregisteredStayLeftAlert(child.name, state.lastAreaLabel || "", {
      confirmedAtMs,
      detectedAtMs: nowMs,
    });

    // 같은 체류가 11m grid 지터로 여러 상태 행으로 갈려도 부모에게는 한 번만 알린다.
    // 두 번째부터는 알림 없이 에피소드만 닫는다(2026-07-30 4중복 실사고).
    const areaKey = coarseStayAreaKey(state.gridKey) ?? state.gridKey;
    const firedKey = `${childKey}:${areaKey}`;
    if (firedDepartureAreas.has(firedKey)) {
      await persistDeparture(db, child.familyId, child.childUserId, state.gridKey, closedEpisodeStartMarker(openStart));
      presence.set(stateKey, { ...state, lastEpisodeStartMs: closedEpisodeStartMarker(openStart) });
      continue;
    }

    const { pushOk } = await deliverParentAlert(penv, db, {
      familyId: child.familyId,
      childUserId: child.childUserId,
      alert,
      idempotencyKey,
      stayGridKey: state.gridKey,
    });
    if (!pushOk) continue;
    firedDepartureAreas.add(firedKey);
    await persistDeparture(db, child.familyId, child.childUserId, state.gridKey, closedEpisodeStartMarker(openStart));
    presence.set(stateKey, { ...state, lastEpisodeStartMs: closedEpisodeStartMarker(openStart) });
    left++;
    } finally {
      await releaseAccountMutationLeases(db, childMutationLeases.leases);
    }
  }

  return { checked: loaded.children.length, families: loaded.familyIds.length, alerted, tracked, left };
}

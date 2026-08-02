// registered-place / danger-zone geofence cron 공용 D1 헬퍼.
// 두 cron 은 같은 상태머신(_shared/registeredPlaceGeofence.js)·같은 테이블
// (child_locations 최신 fix + child_place_presence)을 쓰므로 로더/퍼시스터를 공유한다.
import { parseJson } from "../lib/serialize";
import { chunkSqlVariables } from "../lib/sqlChunk";
import { pgNow, pgToMs, tsNorm } from "../lib/time";
import { SERVER_GEOFENCE_CONFIG } from "../shared/registeredPlaceGeofence.js";
import { premiumFamilyEntitlementSql } from "../shared/subscriptionEntitlement.js";

const GEO_SQL_QUERY_CHUNK = 90;

export function isUsableRegisteredPlaceFixAccuracy(value: unknown): boolean {
  const accuracy = Number(value);
  return value != null
    && Number.isFinite(accuracy)
    && accuracy >= 0
    && accuracy <= Number(SERVER_GEOFENCE_CONFIG.maxAccuracyM);
}

export interface ChildFix {
  familyId: string;
  childUserId: string;
  childMemberId?: string;
  name: string;
  lat: number;
  lng: number;
  updatedAtMs: number;
  accuracyM?: number | null;
}

export interface PlacePresenceState {
  phase: string;
  firstInsideAtMs: number | null;
  departureArmedAtMs: number | null;
  lastDepartedAtMs: number | null;
  updatedAtMs?: number | null;
}

// jsonb location TEXT → {lat,lng(+alertRadiusM)} (parseJson 후 숫자 검증).
// alertRadiusM 은 장소별 알림 반경(스키마 무변경 — location JSON 안에 저장).
export function coord(loc: unknown): { lat: number; lng: number; alertRadiusM?: number } | null {
  const parsed = parseJson(loc);
  const o = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  if (!o) return null;
  const lat = Number(o.lat);
  const lng = Number(o.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const radius = Number(o.alertRadiusM ?? o.alert_radius_m);
  if (Number.isFinite(radius) && radius > 0) return { lat, lng, alertRadiusM: radius };
  return { lat, lng };
}

// child_locations 는 PK(user_id) 라 자녀당 1행(현재 위치). 최근 윈도우 내 fix 만.
// 반환: Map[`family:user`] = {lat,lng,updatedAtMs}. (substr(updated_at,1,19) 비교로
// pg COPY 형식 ↔ ISO 바운드 혼재 정렬 깨짐 회피.)
export async function loadLatestFix(
  db: D1Database,
  childUserIds: string[],
  windowMs: number,
): Promise<Map<string, { lat: number; lng: number; updatedAtMs: number; accuracyM: number | null }>> {
  const latest = new Map<string, { lat: number; lng: number; updatedAtMs: number; accuracyM: number | null }>();
  if (!childUserIds.length) return latest;
  const windowStart = tsNorm(new Date(Date.now() - windowMs).toISOString());
  const uniqueIds = [...new Set(childUserIds.filter(Boolean))];
  for (const ids of chunkSqlVariables(uniqueIds, GEO_SQL_QUERY_CHUNK)) {
    const ph = ids.map(() => "?").join(",");
    const { results } = await db
      .prepare(
        `SELECT user_id, family_id, lat, lng, updated_at, accuracy_m FROM child_locations
          WHERE user_id IN (${ph}) AND substr(updated_at,1,19) > ?`,
      )
      .bind(...ids, windowStart)
      .all<{
        user_id: string;
        family_id: string;
        lat: number;
        lng: number;
        updated_at: string;
        accuracy_m: number | null;
      }>();
    for (const l of results ?? []) {
      const ms = pgToMs(l.updated_at);
      const lat = Number(l.lat);
      const lng = Number(l.lng);
      const rawAccuracy = l.accuracy_m;
      const parsedAccuracy = rawAccuracy == null ? null : Number(rawAccuracy);
      const accuracyM = parsedAccuracy != null && Number.isFinite(parsedAccuracy) ? parsedAccuracy : null;
      if (!Number.isFinite(ms) || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const key = `${l.family_id}:${l.user_id}`;
      const prev = latest.get(key);
      if (!prev || ms > prev.updatedAtMs) latest.set(key, { lat, lng, updatedAtMs: ms, accuracyM });
    }
  }
  return latest;
}

// 최근 위치 이력 재생용 — recorded_at 오름차순. 등록장소 도착/출발 판정이 "최신 1점"만
// 보면 정지 시 업로드 간격+tick 격자만큼 늦어진다(실사고: 학교 도착 6.5분 지연). tick 사이의
// 모든 fix 를 시간순 재생해 dwell 충족 시점을 fix 타임스탬프 기준으로 정확히 잡는다.
export async function loadRecentFixes(
  db: D1Database,
  childUserIds: string[],
  windowMs: number,
): Promise<Map<string, Array<{ lat: number; lng: number; accuracy: number; tMs: number }>>> {
  const byChild = new Map<string, Array<{ lat: number; lng: number; accuracy: number; tMs: number }>>();
  if (!childUserIds.length) return byChild;
  const windowStart = tsNorm(new Date(Date.now() - windowMs).toISOString());
  const maxAccuracyM = Number(SERVER_GEOFENCE_CONFIG.maxAccuracyM);
  const uniqueIds = [...new Set(childUserIds.filter(Boolean))];
  for (const ids of chunkSqlVariables(uniqueIds, GEO_SQL_QUERY_CHUNK)) {
    const ph = ids.map(() => "?").join(",");
    const { results } = await db
      .prepare(
        `SELECT user_id, family_id, lat, lng, recorded_at, accuracy_m, is_estimated FROM location_history
          WHERE user_id IN (${ph}) AND substr(recorded_at,1,19) > ?
            AND is_estimated = 0 AND accuracy_m IS NOT NULL
            AND accuracy_m >= 0 AND accuracy_m <= ?
          ORDER BY substr(recorded_at,1,19) ASC`,
      )
      .bind(...ids, windowStart, maxAccuracyM)
      .all<{
        user_id: string;
        family_id: string;
        lat: number;
        lng: number;
        recorded_at: string;
        accuracy_m: number | null;
        is_estimated: number | null;
      }>();
    for (const l of results ?? []) {
      const tMs = pgToMs(l.recorded_at);
      const lat = Number(l.lat);
      const lng = Number(l.lng);
      if (l.accuracy_m == null || l.is_estimated == null || Number(l.is_estimated) !== 0) continue;
      const accuracy = Number(l.accuracy_m);
      if (
        !Number.isFinite(tMs) ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        !Number.isFinite(accuracy) ||
        accuracy < 0 ||
        accuracy > maxAccuracyM
      ) continue;
      const key = `${l.family_id}:${l.user_id}`;
      const arr = byChild.get(key) || [];
      arr.push({ lat, lng, accuracy, tMs });
      byChild.set(key, arr);
    }
  }
  return byChild;
}

// child_place_presence 로드 — registered/danger 공유 테이블(place_key 네임스페이스 분리).
export async function loadPlacePresence(
  db: D1Database,
  familyIds: string[],
): Promise<Map<string, PlacePresenceState>> {
  const map = new Map<string, PlacePresenceState>();
  if (!familyIds.length) return map;
  const uniqueIds = [...new Set(familyIds.filter(Boolean))];
  for (const ids of chunkSqlVariables(uniqueIds, GEO_SQL_QUERY_CHUNK)) {
    const ph = ids.map(() => "?").join(",");
    const { results } = await db
      .prepare(
        `SELECT family_id, child_user_id, place_key, phase, first_inside_at_ms,
                departure_armed_at_ms, last_departed_at_ms, updated_at
           FROM child_place_presence WHERE family_id IN (${ph})`,
      )
      .bind(...ids)
      .all<Record<string, unknown>>();
    for (const r of results ?? []) {
      const updatedAtMs = pgToMs(r.updated_at as string);
      map.set(`${r.family_id}:${r.child_user_id}:${r.place_key}`, {
        phase: String(r.phase || "out"),
        firstInsideAtMs: r.first_inside_at_ms != null ? Number(r.first_inside_at_ms) : null,
        departureArmedAtMs: r.departure_armed_at_ms != null ? Number(r.departure_armed_at_ms) : null,
        lastDepartedAtMs: r.last_departed_at_ms != null ? Number(r.last_departed_at_ms) : null,
        updatedAtMs: Number.isFinite(updatedAtMs) ? updatedAtMs : null,
      });
    }
  }
  return map;
}

// child_place_presence upsert — 복합 PK(family,child,place_key) 미이관 → select-then-write.
export async function persistPlacePresence(
  db: D1Database,
  familyId: string,
  childUserId: string,
  placeKey: string,
  next: PlacePresenceState,
): Promise<void> {
  const now = pgNow();
  try {
    const ex = await db
      .prepare(
        `SELECT 1 AS ok FROM child_place_presence
          WHERE family_id = ? AND child_user_id = ? AND place_key = ? LIMIT 1`,
      )
      .bind(familyId, childUserId, placeKey)
      .first<{ ok: number }>();
    if (ex) {
      await db
        .prepare(
          `UPDATE child_place_presence
              SET phase = ?, first_inside_at_ms = ?, departure_armed_at_ms = ?,
                  last_departed_at_ms = ?, updated_at = ?
            WHERE family_id = ? AND child_user_id = ? AND place_key = ?`,
        )
        .bind(
          next.phase,
          next.firstInsideAtMs,
          next.departureArmedAtMs,
          next.lastDepartedAtMs,
          now,
          familyId,
          childUserId,
          placeKey,
        )
        .run();
    } else {
      await db
        .prepare(
          `INSERT INTO child_place_presence
             (family_id, child_user_id, place_key, phase, first_inside_at_ms,
              departure_armed_at_ms, last_departed_at_ms, updated_at)
           VALUES (?,?,?,?,?,?,?,?)`,
        )
        .bind(
          familyId,
          childUserId,
          placeKey,
          next.phase,
          next.firstInsideAtMs,
          next.departureArmedAtMs,
          next.lastDepartedAtMs,
          now,
        )
        .run();
    }
  } catch (e) {
    console.error("[geo] place_presence upsert failed");
  }
}

// 프리미엄 가족 family_id 집합. 공통 resolver와 같은 구독 만료·child·legacy 우선순위다.
export async function loadPremiumFamilyIds(db: D1Database): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT f.id AS family_id FROM families f
        WHERE ${premiumFamilyEntitlementSql("f")}`,
    )
    .all<{ family_id: string }>();
  return [...new Set((results ?? []).map((r) => r.family_id).filter(Boolean))];
}

export interface RegisteredPlaceFamilyPolicy {
  familyId: string;
  isPremium: boolean;
  savedPlaceLimit: number | null;
}

// 등록장소 cron 전용 정책 로더. 저장 장소는 Free 2개·review grandfather 3개·
// Premium 무제한이고, academy 포함 여부는 호출부가 isPremium으로 제한한다.
// 위험지역 cron의 무료 안전 범위에는 영향을 주지 않는다.
export async function loadRegisteredPlaceFamilyPolicies(
  db: D1Database,
): Promise<RegisteredPlaceFamilyPolicy[]> {
  const { results } = await db
    .prepare(
      `SELECT f.id AS family_id,
              CASE WHEN ${premiumFamilyEntitlementSql("f")} THEN 1 ELSE 0 END AS is_premium,
              CASE WHEN EXISTS (
                SELECT 1 FROM family_review_rewards registered_review
                 WHERE registered_review.family_id = f.id
                   AND registered_review.granted_at IS NOT NULL
              ) THEN 1 ELSE 0 END AS has_review_limit
         FROM families f
        WHERE COALESCE(f.registered_place_alerts_enabled, 1) <> 0
          AND (
            EXISTS (SELECT 1 FROM saved_places registered_saved WHERE registered_saved.family_id = f.id)
            OR EXISTS (SELECT 1 FROM academies registered_academy WHERE registered_academy.family_id = f.id)
          )`,
    )
    .all<{ family_id: string; is_premium: number; has_review_limit: number }>();
  const byFamily = new Map<string, RegisteredPlaceFamilyPolicy>();
  for (const row of results ?? []) {
    const familyId = String(row.family_id || "");
    if (!familyId) continue;
    const isPremium = Number(row.is_premium) === 1;
    byFamily.set(familyId, {
      familyId,
      isPremium,
      savedPlaceLimit: isPremium ? null : (Number(row.has_review_limit) === 1 ? 3 : 2),
    });
  }
  return [...byFamily.values()].sort((a, b) => a.familyId.localeCompare(b.familyId));
}

// 주어진 가족들의 자녀 멤버(family_id, user_id, name) — role='child', user_id 비어있지 않음.
export async function loadChildMembers(
  db: D1Database,
  familyIds: string[],
): Promise<Array<{ familyId: string; childUserId: string; childMemberId: string; name: string }>> {
  if (!familyIds.length) return [];
  const members: Array<{ familyId: string; childUserId: string; childMemberId: string; name: string }> = [];
  const uniqueIds = [...new Set(familyIds.filter(Boolean))];
  for (const ids of chunkSqlVariables(uniqueIds, GEO_SQL_QUERY_CHUNK)) {
    const ph = ids.map(() => "?").join(",");
    const { results } = await db
      .prepare(
        `SELECT id, family_id, user_id, name FROM family_members
          WHERE family_id IN (${ph}) AND role = 'child' AND is_active = 1`,
      )
      .bind(...ids)
      .all<{ id: string; family_id: string; user_id: string | null; name: string | null }>();
    members.push(...(results ?? [])
      .filter((m) => m.user_id)
      .map((m) => ({
        familyId: String(m.family_id),
        childUserId: String(m.user_id),
        childMemberId: String(m.id),
        name: String(m.name || ""),
      })));
  }
  return members;
}

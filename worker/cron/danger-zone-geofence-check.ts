// danger-zone-geofence-check (cron 1-59/2, 홀수 분) — supabase edge 직역.
// 전 가족 자녀를 현재 티어에서 알림이 활성인 danger_zones 에 대해 평가, 진입 시
// 부모 EMERGENCY 알림. 무료 가족도 생성시각·id 순 첫 구역의 안전 알림은 유지한다.
// 상태머신·멱등키는 registeredPlaceGeofence.js 재사용, config/문구만 danger 전용.
import type { Env } from "../types";
import type { PushEnv } from "../lib/pushEnv";
import {
  evaluateRegisteredPlaceTransition,
  INITIAL_REGISTERED_PLACE_STATE,
  REGISTERED_PLACE_ACTIONS,
  placePresenceIdempotencyKey,
} from "../shared/registeredPlaceGeofence.js";
import {
  DANGER_GEOFENCE_CONFIG,
  dangerZonePlaceKey,
  buildDangerZoneAlert,
  buildDangerZoneExitAlert,
  CROSS_PROCESS_DEDUP_WINDOW_MS,
  dangerDedupCandidateKeys,
  isRecentDuplicateDangerAlert,
  isUsableDangerFixAccuracy,
} from "../shared/dangerZoneGeofence.js";
import {
  loadLatestFix,
  loadPlacePresence,
  persistPlacePresence,
  loadChildMembers,
  loadPremiumFamilyIds,
  type ChildFix,
} from "./_geo";
import { deliverParentAlert } from "./_deliver";
import { tsNorm, pgToMs } from "../lib/time";
import {
  acquireAccountMutationLeases,
  isActiveChildMutationTarget,
  loadFamilyNotificationMutationScopes,
  releaseAccountMutationLeases,
} from "../lib/accountMutationScope";
import { recordLocationConfirmationForSubjects } from "../lib/locationConfirmationAudit";
import { annotateTierAlertActivation } from "../lib/tierAlertActivation";

const GEOFENCE_FIX_FRESH_MS = 15 * 60 * 1000;
const EPISODE_BUCKET_MS = 10 * 60 * 1000;

interface ZoneRow {
  id: string;
  created_at: string;
  placeKey: string;
  name: string;
  lat: number;
  lng: number;
  radiusM: number;
  alertOnEntry: boolean;
  alertOnExit: boolean;
}

// danger_zones(전 가족) → Map[familyId] = ZoneRow[]. lat/lng 컬럼(jsonb 아님).
async function loadDangerZones(db: D1Database): Promise<Map<string, ZoneRow[]>> {
  const zonesByFamily = new Map<string, ZoneRow[]>();
  const premiumFamilyIds = new Set(await loadPremiumFamilyIds(db));
  const { results } = await db
    .prepare(
      `SELECT id, family_id, name, lat, lng, radius_m, alert_on_entry, alert_on_exit, created_at
         FROM danger_zones
        ORDER BY family_id ASC, substr(created_at,1,19) ASC, id ASC`,
    )
    .all<{
      id: string;
      family_id: string;
      name: string;
      lat: number;
      lng: number;
      radius_m: number;
      alert_on_entry: number | null;
      alert_on_exit: number | null;
      created_at: string;
    }>();
  for (const z of results ?? []) {
    const lat = Number(z.lat);
    const lng = Number(z.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const familyId = String(z.family_id);
    const radiusM = Number.isFinite(Number(z.radius_m)) && Number(z.radius_m) > 0 ? Number(z.radius_m) : 200;
    const arr = zonesByFamily.get(familyId) || [];
    arr.push({
      id: z.id,
      created_at: z.created_at,
      placeKey: dangerZonePlaceKey(z.id),
      name: String(z.name || "조심할 곳"),
      lat,
      lng,
      radiusM,
      alertOnEntry: z.alert_on_entry == null ? true : Number(z.alert_on_entry) !== 0,
      alertOnExit: z.alert_on_exit == null ? false : Number(z.alert_on_exit) !== 0,
    });
    zonesByFamily.set(familyId, arr);
  }
  for (const [familyId, zones] of zonesByFamily) {
    const limit = premiumFamilyIds.has(familyId) ? null : 1;
    zonesByFamily.set(
      familyId,
      annotateTierAlertActivation(zones, limit)
        .filter((zone) => zone.tier_alert_active),
    );
  }
  return zonesByFamily;
}

export async function run(env: Env): Promise<Record<string, unknown>> {
  const db = env.DB;
  const penv = env as PushEnv;

  // danger_zones 보유 가족만 스캔(실 N 작다).
  const zonesByFamily = await loadDangerZones(db);
  const zoneFamilyIds = [...zonesByFamily.keys()];
  if (!zoneFamilyIds.length) return { checked: 0, families: 0, entered: 0 };

  const members = await loadChildMembers(db, zoneFamilyIds);
  if (!members.length) return { checked: 0, families: 0, entered: 0 };
  const nowMs = Date.now();
  const fixMap = await loadLatestFix(db, members.map((m) => m.childUserId), GEOFENCE_FIX_FRESH_MS);

  const children: ChildFix[] = [];
  for (const m of members) {
    const fix = fixMap.get(`${m.familyId}:${m.childUserId}`);
    if (
      !fix
      || nowMs - fix.updatedAtMs > GEOFENCE_FIX_FRESH_MS
      || !isUsableDangerFixAccuracy(fix.accuracyM)
    ) continue;
    children.push({
      ...m,
      lat: fix.lat,
      lng: fix.lng,
      updatedAtMs: fix.updatedAtMs,
      accuracyM: fix.accuracyM,
    });
  }
  await recordLocationConfirmationForSubjects(
    db,
    children.map((child) => ({ familyId: child.familyId, subjectUserId: child.childUserId })),
    {
      action: "use",
      requesterKind: "system",
      requesterUserId: null,
      recipientKind: "none",
      recipientUserId: null,
      collectionMethod: "not_applicable",
      acquisitionPath: "current_location_store",
      serviceCode: "danger_zone_monitor",
      deliveryMethod: "worker_internal",
      purposeCode: "danger_zone_alert",
    },
  );

  const familyIds = [...new Set(children.map((c) => c.familyId))];
  const presence = await loadPlacePresence(db, familyIds);

  const A = REGISTERED_PLACE_ACTIONS;
  let entered = 0;

  for (const child of children) {
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
    if (nowMs - child.updatedAtMs > GEOFENCE_FIX_FRESH_MS) continue; // stale fix → skip
    if (!isUsableDangerFixAccuracy(child.accuracyM)) continue;
    const zones = zonesByFamily.get(child.familyId) || [];
    const fix = { lat: child.lat, lng: child.lng, accuracy: child.accuracyM, tMs: child.updatedAtMs };

    for (const zone of zones) {
      const stateKey = `${child.familyId}:${child.childUserId}:${zone.placeKey}`;
      const prev = presence.get(stateKey) || { ...INITIAL_REGISTERED_PLACE_STATE };
      const { action, nextState } = evaluateRegisteredPlaceTransition({
        state: prev,
        fix,
        place: { lat: zone.lat, lng: zone.lng, alertRadiusM: zone.radiusM },
        config: DANGER_GEOFENCE_CONFIG,
      });

      // danger 는 저장 옵션에 따라 진입/이탈 알림을 보낸다. 대기·무장은 state 만 보존.
      const isEnterAlert = action === A.ENTER && zone.alertOnEntry;
      const isExitAlert = action === A.LEAVE && zone.alertOnExit;
      const isAlert = isEnterAlert || isExitAlert;
      if (!isAlert) {
        if (
          prev.phase !== nextState.phase ||
          prev.firstInsideAtMs !== nextState.firstInsideAtMs ||
          prev.departureArmedAtMs !== nextState.departureArmedAtMs ||
          prev.lastDepartedAtMs !== nextState.lastDepartedAtMs
        ) {
          await persistPlacePresence(db, child.familyId, child.childUserId, zone.placeKey, nextState);
          presence.set(stateKey, nextState);
        }
        continue;
      }

      const episodeMs = isExitAlert
        ? nextState.lastDepartedAtMs ?? child.updatedAtMs
        : nextState.firstInsideAtMs ?? child.updatedAtMs;
      const bucket = Math.floor(episodeMs / EPISODE_BUCKET_MS);
      const alert = isExitAlert
        ? buildDangerZoneExitAlert(child.name, zone.name)
        : buildDangerZoneAlert(child.name, zone.name);
      const idempotencyKind = isExitAlert ? "danger_leave" : "danger_enter";
      const idempotencyKey = placePresenceIdempotencyKey(idempotencyKind, child.childUserId, zone.placeKey, bucket);

      // cross-process dedup: 부모 FG 클라가 직전 10분 버킷(±1)으로 이미 발사했는지 확인.
      const dedupKeys = isEnterAlert ? dangerDedupCandidateKeys(child.childUserId, zone.placeKey, bucket) : [];
      if (dedupKeys.length) {
        const sinceNorm = tsNorm(new Date(nowMs - CROSS_PROCESS_DEDUP_WINDOW_MS).toISOString());
        const { results: priorRows } = await db
          .prepare(
            `SELECT event_id, created_at FROM parent_alerts
              WHERE child_user_id = ? AND alert_type = 'danger_zone'
                AND substr(created_at,1,19) > ?`,
          )
          .bind(child.childUserId, sinceNorm)
          .all<{ event_id: string; created_at: string }>();
        const priorAlerts = (priorRows ?? []).map((r) => ({
          eventId: String(r.event_id || ""),
          createdAtMs: pgToMs(r.created_at),
        }));
        if (isRecentDuplicateDangerAlert(priorAlerts, dedupKeys, nowMs)) {
          // 클라(또는 직전 tick)가 이미 발사 → state 만 진행, 알림 skip.
          await persistPlacePresence(db, child.familyId, child.childUserId, zone.placeKey, nextState);
          presence.set(stateKey, nextState);
          continue;
        }
      }

      const { pushOk } = await deliverParentAlert(penv, db, {
        familyId: child.familyId,
        childUserId: child.childUserId,
        alert,
        idempotencyKey,
      });
      // danger: push 실패만 state 미진행(rpc 실패는 로그만 — _deliver 내부 처리, return true 등가).
      if (!pushOk) continue;

      await persistPlacePresence(db, child.familyId, child.childUserId, zone.placeKey, nextState);
      presence.set(stateKey, nextState);
      entered++;
    }
    } finally {
      await releaseAccountMutationLeases(db, childMutationLeases.leases);
    }
  }

  return { checked: children.length, families: familyIds.length, entered };
}

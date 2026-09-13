// 5분 cron: 10분 초과 끊김은 자동 복구하고 등록장소 부근은 20분 지속 뒤 부모에게 알린다.
// 전원·배터리·미등록 장소의 경고는 기존 10분 기준을 유지한다.
// 24h+ 미복구는 child_unpair_suspected 로 격상(백오프). 상태머신은 child_location_link_state.
import type { Env } from "../types";
import type { PushEnv } from "../lib/pushEnv";
import {
  RECENT_LOCATION_WINDOW_MS,
  STALENESS_THRESHOLD_MS,
  POWER_SAVE_REPEAT_ALERT_AGE_MS,
  computeAgeMs,
  decideLinkTransition,
  episodeIdempotencyKey,
  buildStaleAlert,
  buildRecoveredAlert,
  UNPAIR_SUSPECTED_THRESHOLD_MS,
  shouldEmitUnpairAlert,
  buildUnpairSuspectedAlert,
  shouldAutoWakeForStaleAge,
} from "../shared/locationStaleness.js";
import { classifyStaleReason } from "../shared/staleReason.js";
import { coord } from "./_geo";
import { deliverParentAlert, deliverWake, type AlertCopy } from "./_deliver";
import { pgNow, pgToIso, pgToMs, tsNorm } from "../lib/time";
import { premiumFamilyEntitlementSql } from "../shared/subscriptionEntitlement.js";
import {
  acquireAccountMutationLeases,
  isActiveChildMutationTarget,
  loadFamilyNotificationMutationScopes,
  releaseAccountMutationLeases,
} from "../lib/accountMutationScope";
import { recordLocationConfirmationForSubjects } from "../lib/locationConfirmationAudit";
import { chunkSqlVariables } from "../lib/sqlChunk";
import { expireSupersededLocationLinkNotifications } from "../lib/locationLinkNotifications";

const POWER_SAVE_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const LOW_BATTERY_LOOKBACK_MS = 2 * 60 * 60 * 1000;
const WAKE_RECOVERABLE_WINDOW_MS = 6 * 60 * 60 * 1000;
const STALENESS_CRON_TICK_MS = 5 * 60 * 1000;
const LOCATION_CRON_QUERY_CHUNK = 90;

interface ChildCandidate {
  familyId: string;
  childUserId: string;
  name: string;
  lastLocationAt: string; // pg COPY 형식(끊김 동안 frozen) — 멱등키 discriminator
  lastLat: number;
  lastLng: number;
}
interface PlaceRow {
  name: string;
  lat: number;
  lng: number;
}
interface LinkStateRow {
  state: string;
  lastLocationAt: string | null;
  lastAlertedAt: string | null;
  lastPowerSaveAlertedAt: string | null;
  lastShutdownAt: string | null;
}
interface UnpairCandidate {
  familyId: string;
  childUserId: string;
  name: string;
  lastLocationAt: string;
  lastUnpairAlertedAt: string | null;
  alertCount: number;
}

// 프리미엄 가족 → 자녀 멤버 → child_locations 최신 fix(24h).
async function loadPremiumChildren(db: D1Database): Promise<ChildCandidate[]> {
  const subs = await db
    .prepare(`SELECT f.id AS family_id FROM families f WHERE ${premiumFamilyEntitlementSql("f")}`)
    .all<{ family_id: string }>();
  const familyIds = [...new Set((subs.results ?? []).map((r) => r.family_id).filter(Boolean))];
  if (!familyIds.length) return [];

  const memberRows: Array<{ family_id: string; user_id: string | null; name: string | null }> = [];
  for (const ids of chunkSqlVariables(familyIds, LOCATION_CRON_QUERY_CHUNK)) {
    const ph = ids.map(() => "?").join(",");
    const { results } = await db
      .prepare(`SELECT family_id, user_id, name FROM family_members WHERE family_id IN (${ph}) AND role = 'child' AND is_active = 1`)
      .bind(...ids)
      .all<{ family_id: string; user_id: string | null; name: string | null }>();
    memberRows.push(...(results ?? []));
  }
  const members2 = memberRows.filter((member) => member.user_id);
  if (!members2.length) return [];

  const childUserIds = members2.map((m) => String(m.user_id));
  const windowStart = tsNorm(new Date(Date.now() - RECENT_LOCATION_WINDOW_MS).toISOString());
  const lastByKey = new Map<string, { at: string; lat: number; lng: number }>();
  for (const ids of chunkSqlVariables(childUserIds, LOCATION_CRON_QUERY_CHUNK)) {
    const ph = ids.map(() => "?").join(",");
    const { results } = await db
      .prepare(
        `SELECT user_id, family_id, lat, lng, updated_at FROM child_locations
          WHERE user_id IN (${ph}) AND substr(updated_at,1,19) > ?`,
      )
      .bind(...ids, windowStart)
      .all<{ user_id: string; family_id: string; lat: number; lng: number; updated_at: string }>();
    for (const location of results ?? []) {
      lastByKey.set(
        `${location.family_id}:${location.user_id}`,
        { at: String(location.updated_at), lat: Number(location.lat), lng: Number(location.lng) },
      );
    }
  }

  const children: ChildCandidate[] = [];
  for (const m of members2) {
    const fix = lastByKey.get(`${m.family_id}:${m.user_id}`);
    if (!fix) continue;
    children.push({
      familyId: String(m.family_id),
      childUserId: String(m.user_id),
      name: String(m.name || ""),
      lastLocationAt: fix.at,
      lastLat: fix.lat,
      lastLng: fix.lng,
    });
  }
  await recordLocationConfirmationForSubjects(
    db,
    children.map((child) => ({
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
      acquisitionPath: "current_location_store",
      serviceCode: "location_staleness_monitor",
      deliveryMethod: "worker_internal",
      purposeCode: "location_staleness_alert",
    },
  );
  return children;
}

async function loadLinkStates(db: D1Database, children: ChildCandidate[]): Promise<Map<string, LinkStateRow>> {
  const map = new Map<string, LinkStateRow>();
  if (!children.length) return map;
  const familyIds = [...new Set(children.map((c) => c.familyId))];
  for (const ids of chunkSqlVariables(familyIds, LOCATION_CRON_QUERY_CHUNK)) {
    const ph = ids.map(() => "?").join(",");
    const { results } = await db
      .prepare(
        `SELECT family_id, child_user_id, state, last_location_at, last_alerted_at, last_power_save_alerted_at, last_shutdown_at
           FROM child_location_link_state WHERE family_id IN (${ph})`,
      )
      .bind(...ids)
      .all<Record<string, unknown>>();
    for (const row of results ?? []) {
      map.set(`${row.family_id}:${row.child_user_id}`, {
        state: String(row.state),
        lastLocationAt: row.last_location_at ? String(row.last_location_at) : null,
        lastAlertedAt: row.last_alerted_at ? String(row.last_alerted_at) : null,
        lastPowerSaveAlertedAt: row.last_power_save_alerted_at ? String(row.last_power_save_alerted_at) : null,
        lastShutdownAt: row.last_shutdown_at ? String(row.last_shutdown_at) : null,
      });
    }
  }
  return map;
}

async function loadFamilyPlaces(db: D1Database, familyIds: string[]): Promise<Map<string, PlaceRow[]>> {
  const byFamily = new Map<string, PlaceRow[]>();
  if (!familyIds.length) return byFamily;
  const add = (familyId: string, name: unknown, loc: unknown) => {
    const c = coord(loc);
    if (!c) return;
    const arr = byFamily.get(familyId) || [];
    arr.push({ name: String(name || "등록된 장소"), lat: c.lat, lng: c.lng });
    byFamily.set(familyId, arr);
  };
  for (const ids of chunkSqlVariables(familyIds, LOCATION_CRON_QUERY_CHUNK)) {
    const ph = ids.map(() => "?").join(",");
    const saved = await db
      .prepare(`SELECT family_id, name, location FROM saved_places WHERE family_id IN (${ph})`)
      .bind(...ids)
      .all<{ family_id: string; name: string; location: string }>();
    for (const row of saved.results ?? []) add(String(row.family_id), row.name, row.location);
    const academies = await db
      .prepare(`SELECT family_id, name, location FROM academies WHERE family_id IN (${ph})`)
      .bind(...ids)
      .all<{ family_id: string; name: string; location: string }>();
    for (const row of academies.results ?? []) add(String(row.family_id), row.name, row.location);
  }
  return byFamily;
}

async function loadRecentLowBatteryChildren(db: D1Database, familyIds: string[]): Promise<Set<string>> {
  const set = new Set<string>();
  if (!familyIds.length) return set;
  const since = tsNorm(new Date(Date.now() - LOW_BATTERY_LOOKBACK_MS).toISOString());
  for (const ids of chunkSqlVariables(familyIds, LOCATION_CRON_QUERY_CHUNK)) {
    const ph = ids.map(() => "?").join(",");
    const { results } = await db
      .prepare(
        `SELECT family_id, child_user_id FROM parent_alerts
          WHERE family_id IN (${ph}) AND alert_type = 'low_battery' AND substr(created_at,1,19) > ?`,
      )
      .bind(...ids, since)
      .all<{ family_id: string; child_user_id: string | null }>();
    for (const row of results ?? []) {
      if (row.child_user_id) set.add(`${row.family_id}:${row.child_user_id}`);
    }
  }
  return set;
}

async function loadUnpairCandidates(db: D1Database): Promise<UnpairCandidate[]> {
  const cutoff = tsNorm(new Date(Date.now() - UNPAIR_SUSPECTED_THRESHOLD_MS).toISOString());
  const states = await db
    .prepare(
      `SELECT family_id, child_user_id, last_location_at, last_unpair_alerted_at, unpair_alert_count
         FROM child_location_link_state
        WHERE state = 'stale' AND last_location_at IS NOT NULL AND substr(last_location_at,1,19) < ?`,
    )
    .bind(cutoff)
    .all<Record<string, unknown>>();
  const rows = states.results ?? [];
  if (!rows.length) return [];

  const familyIds = [...new Set(rows.map((r) => String(r.family_id)))];
  const premiumFamilyIds = new Set<string>();
  for (const ids of chunkSqlVariables(familyIds, LOCATION_CRON_QUERY_CHUNK)) {
    const ph = ids.map(() => "?").join(",");
    const { results } = await db
      .prepare(
        `SELECT f.id AS family_id FROM families f
          WHERE f.id IN (${ph}) AND ${premiumFamilyEntitlementSql("f")}`,
      )
      .bind(...ids)
      .all<{ family_id: string }>();
    for (const row of results ?? []) premiumFamilyIds.add(String(row.family_id));
  }
  const premiumStates = rows.filter((r) => premiumFamilyIds.has(String(r.family_id)));
  if (!premiumStates.length) return [];

  const nameByKey = new Map<string, string>();
  for (const ids of chunkSqlVariables([...premiumFamilyIds], LOCATION_CRON_QUERY_CHUNK)) {
    const ph = ids.map(() => "?").join(",");
    const { results } = await db
      .prepare(`SELECT family_id, user_id, name FROM family_members WHERE family_id IN (${ph}) AND role = 'child' AND is_active = 1`)
      .bind(...ids)
      .all<{ family_id: string; user_id: string; name: string | null }>();
    for (const member of results ?? []) {
      nameByKey.set(`${member.family_id}:${member.user_id}`, String(member.name || "아이"));
    }
  }

  // 현재 child 멤버인 후보만(orphan link_state 영구 오발 방지, 2026-06-09).
  return premiumStates
    .filter((r) => nameByKey.has(`${r.family_id}:${r.child_user_id}`))
    .map((r) => ({
      familyId: String(r.family_id),
      childUserId: String(r.child_user_id),
      name: nameByKey.get(`${r.family_id}:${r.child_user_id}`) || "아이",
      lastLocationAt: String(r.last_location_at || ""),
      lastUnpairAlertedAt: r.last_unpair_alerted_at ? String(r.last_unpair_alerted_at) : null,
      alertCount: Number.isFinite(Number(r.unpair_alert_count)) ? Number(r.unpair_alert_count) : 0,
    }));
}

// child_location_link_state upsert(복합 PK family,child 미이관 → select-then-write).
async function persistState(
  db: D1Database,
  child: ChildCandidate,
  nextState: string,
  opts: { staleReason?: string | null; markPowerSave?: boolean; notified?: boolean } = {},
): Promise<void> {
  const now = pgNow();
  const patch: Record<string, unknown> = {
    state: nextState,
    last_location_at: child.lastLocationAt,
    last_alerted_at: opts.notified === false ? null : now,
    updated_at: now,
  };
  if (nextState === "connected") {
    patch.last_unpair_alerted_at = null;
    patch.unpair_alert_count = 0;
    patch.stale_reason = null;
    patch.last_shutdown_at = null;
  }
  if (nextState !== "connected" && opts.staleReason !== undefined) patch.stale_reason = opts.staleReason ?? null;
  if (opts.markPowerSave) patch.last_power_save_alerted_at = now;

  const cols = Object.keys(patch);
  try {
    const ex = await db
      .prepare(`SELECT 1 AS ok FROM child_location_link_state WHERE family_id=? AND child_user_id=? LIMIT 1`)
      .bind(child.familyId, child.childUserId)
      .first<{ ok: number }>();
    if (ex) {
      const setClause = cols.map((c) => `${c}=?`).join(", ");
      await db
        .prepare(`UPDATE child_location_link_state SET ${setClause} WHERE family_id=? AND child_user_id=?`)
        .bind(...cols.map((c) => patch[c]), child.familyId, child.childUserId)
        .run();
    } else {
      const insCols = ["family_id", "child_user_id", ...cols];
      const placeholders = insCols.map(() => "?").join(",");
      await db
        .prepare(`INSERT INTO child_location_link_state (${insCols.join(",")}) VALUES (${placeholders})`)
        .bind(child.familyId, child.childUserId, ...cols.map((c) => patch[c]))
        .run();
    }
  } catch (e) {
    console.error("[location-staleness] state upsert failed");
  }
}

async function emitUnpairSuspected(db: D1Database, penv: PushEnv, cand: UnpairCandidate): Promise<boolean> {
  const nowMs = Date.now();
  const ageMs = computeAgeMs(pgToIso(cand.lastLocationAt), nowMs);
  if (
    !shouldEmitUnpairAlert({
      ageMs,
      lastUnpairAlertedAt: cand.lastUnpairAlertedAt ? pgToIso(cand.lastUnpairAlertedAt) : null,
      alertCount: cand.alertCount,
      nowMs,
    })
  ) {
    return false;
  }
  const hours = Math.max(24, Math.floor(ageMs / (60 * 60 * 1000)));
  const alert = buildUnpairSuspectedAlert(cand.name, hours);
  const dayKey = new Date(nowMs).toISOString().slice(0, 10);
  const idempotencyKey = episodeIdempotencyKey(alert.alertType, cand.childUserId, `${cand.lastLocationAt}:${dayKey}`);

  const { pushOk } = await deliverParentAlert(penv, db, {
    familyId: cand.familyId,
    childUserId: cand.childUserId,
    alert,
    idempotencyKey,
  });
  if (!pushOk) return false;

  try {
    await db
      .prepare(
        `UPDATE child_location_link_state SET last_unpair_alerted_at=?, unpair_alert_count=?, updated_at=?
          WHERE family_id=? AND child_user_id=?`,
      )
      .bind(pgNow(), cand.alertCount + 1, pgNow(), cand.familyId, cand.childUserId)
      .run();
  } catch (e) {
    console.error("[location-staleness] unpair alerted_at update failed");
  }
  return true;
}

export async function run(env: Env): Promise<Record<string, unknown>> {
  const db = env.DB;
  const penv = env as PushEnv;

  const children = await loadPremiumChildren(db);
  const states = await loadLinkStates(db, children);
  const familyIds = [...new Set(children.map((c) => c.familyId))];
  const placesByFamily = await loadFamilyPlaces(db, familyIds);
  const lowBatteryChildren = await loadRecentLowBatteryChildren(db, familyIds);

  const nowMs = Date.now();
  let wakeSent = 0;
  let alerted = 0;
  let recovered = 0;

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
    const ageMs = computeAgeMs(pgToIso(child.lastLocationAt), nowMs);
    if (!Number.isFinite(ageMs) || ageMs > RECENT_LOCATION_WINDOW_MS) continue;

    // 자동 웨이크 — 초기는 빠르게 복구하되 무진전 장기 구간은 15→30→60분 백오프.
    // 인증 실패가 수시간 지속될 때 매 5분 HIGH FCM/GPS를 반복하는 배터리 소모를 막는다.
    const staleNow = ageMs > STALENESS_THRESHOLD_MS;
    const wakeEligible = staleNow
      && ageMs <= WAKE_RECOVERABLE_WINDOW_MS
      && shouldAutoWakeForStaleAge(ageMs, STALENESS_CRON_TICK_MS);
    if (wakeEligible) {
      const ok = await deliverWake(penv, db, { familyId: child.familyId, childUserId: child.childUserId });
      if (ok) wakeSent += 1;
    }

    const stateRow = states.get(`${child.familyId}:${child.childUserId}`);
    const currentState = stateRow?.state;
    const { reason: locReason, placeName } = classifyStaleReason({
      lastLat: child.lastLat,
      lastLng: child.lastLng,
      registeredPlaces: placesByFamily.get(child.familyId) || [],
      hasRecentLowBattery: lowBatteryChildren.has(`${child.familyId}:${child.childUserId}`),
    });
    const shutdownMs = pgToMs(stateRow?.lastShutdownAt);
    const lastFixMs = pgToMs(child.lastLocationAt);
    const recentShutdown =
      Number.isFinite(shutdownMs) && Number.isFinite(lastFixMs) && shutdownMs >= lastFixMs - 5 * 60_000;
    const reason = recentShutdown ? "power_off" : locReason;
    const { action, nextState } = decideLinkTransition({
      currentState, ageMs, reason, notified: Boolean(stateRow?.lastAlertedAt),
    });
    if (action === "none") continue;

    await expireSupersededLocationLinkNotifications(db, {
      familyId: child.familyId,
      childUserId: child.childUserId,
      nextState: nextState as "connected" | "stale",
      nowMs,
    });
    // 쿨다운으로 경고하지 않은 끊김은 회복 알림도 만들지 않는다.
    if (action === "recover" && !stateRow?.lastAlertedAt) {
      await persistState(db, child, "connected", { notified: false });
      continue;
    }

    const ageMinutes = Math.max(1, Math.round(ageMs / 60_000));
    let alert: AlertCopy;
    let staleReason: string | null = null;
    let markPowerSave = false;
    if (action === "alert") {
      staleReason = reason;
      if (reason === "power_save") {
        const lastPSMs = pgToMs(stateRow?.lastPowerSaveAlertedAt);
        const withinCooldown = Number.isFinite(lastPSMs) && nowMs - lastPSMs < POWER_SAVE_COOLDOWN_MS;
        if (withinCooldown && ageMs <= POWER_SAVE_REPEAT_ALERT_AGE_MS) {
          await persistState(db, child, "stale", { staleReason: reason, notified: false });
          continue;
        }
        markPowerSave = true;
      }
      // buildStaleAlert 의 4번째 인자(placeName)는 JS 기본값 null 로 추론돼 string 거부 →
      // .js 파라미터 추론 한계라 호출만 캐스팅(런타임 동작 동일, 본문은 string|null 처리).
      alert = (buildStaleAlert as (n: string, a: number, r: string, p: string | null) => AlertCopy)(
        child.name,
        ageMinutes,
        reason,
        placeName,
      );
    } else {
      alert = buildRecoveredAlert(child.name);
    }

    // 멱등 discriminator: alert → frozen pre-gap fix 시각, recover → link-state 에 저장된 동일 frozen 시각.
    const episodeAt = action === "alert" ? child.lastLocationAt : stateRow?.lastLocationAt || child.lastLocationAt;
    const idempotencyKey = episodeIdempotencyKey(alert.alertType, child.childUserId, episodeAt);

    const { pushOk } = await deliverParentAlert(penv, db, {
      familyId: child.familyId,
      childUserId: child.childUserId,
      alert,
      idempotencyKey,
    });
    // staleness: push 실패해도 alert 는 기록(_deliver 내부)·state 는 전이(다음 첫 알림에 안 멈춤).
    await persistState(db, child, nextState, { staleReason, markPowerSave });
    if (action === "alert" && pushOk) alerted++;
    else if (action === "recover" && pushOk) recovered++;
    } finally {
      await releaseAccountMutationLeases(db, childMutationLeases.leases);
    }
  }

  // 24h+ 미복구 → child_unpair_suspected 별도 스캔.
  const unpairCandidates = await loadUnpairCandidates(db);
  let unpairAlerted = 0;
  for (const cand of unpairCandidates) {
    const unpairMutationScopes = await loadFamilyNotificationMutationScopes(
      db,
      cand.familyId,
      [cand.childUserId],
    );
    if (!unpairMutationScopes) continue;
    const unpairMutationLeases = await acquireAccountMutationLeases(db, unpairMutationScopes);
    if (unpairMutationLeases.status !== "acquired") continue;
    try {
      if (!(await isActiveChildMutationTarget(db, cand.familyId, cand.childUserId))) continue;
      if (await emitUnpairSuspected(db, penv, cand)) unpairAlerted++;
    } finally {
      await releaseAccountMutationLeases(db, unpairMutationLeases.leases);
    }
  }

  return {
    checked: children.length,
    alerted,
    recovered,
    wakeSent,
    unpairChecked: unpairCandidates.length,
    unpairAlerted,
  };
}

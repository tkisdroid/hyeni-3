// PostgREST `/rest/v1/rpc/:fn` 10종 — supabase/migrations 의 SECURITY DEFINER 함수를 D1 로 직역.
// 네이티브(LocationService/NativePushTokenSync/ShutdownReceiver/ForceRingActivity)가 호출한다.
//
// ── 응답 형식(네이티브 파싱 대조) ──
//   · get_pending_notifications_for_device / get_today_events → bare JSON 배열(SETOF).
//   · force_ring_acknowledge → jsonb 객체. insert_parent_alert_v2 → 스칼라(uuid|null).
//   · upsert_child_location / record_location_history_rows / upsert_fcm_token / unregister_fcm_token /
//     record_child_shutdown / mark_notifications_delivered → 네이티브 미파싱 → 2xx(void=204).
//
// ── D1 변환 ──
//   · 복합 unique 미이관 → select-then-write(fcm_tokens·child_locations·location_history·link_state).
//   · jsonb(data/location) ↔ parseJson, boolean ↔ 0/1, timestamp 는 pgNow()/substr(,1,19).
//   · SECURITY DEFINER 의 family_members 멤버십/role 게이트를 코드로 복제(D1 엔 RLS 없음).
import { isoDateAt, normalizeTimeZone } from "../lib/timeZone.ts";
import type { Context } from "hono";
import type { Env, Vars } from "../types";
import type { PushEnv } from "../lib/pushEnv";
import { pgNow, tsNorm } from "../lib/time";
import { parseJson, pgArray, toBool } from "../lib/serialize";
import {
  assertFamilyAccess,
  assertSafetyFamilyAccess,
  isSupersededChildDevice,
  resolveCanonicalFamilyMembership,
} from "../db/authz";
import { notifyPg } from "../lib/realtime";
import { insertParentAlertV2 } from "./push-notify";
import { detectArbitraryArrival } from "../lib/arrivalDetect";
import {
  acquireAccountMutationLeases,
  isActiveChildMutationTarget,
  loadFamilyNotificationMutationScopes,
  releaseAccountMutationLeases,
} from "../lib/accountMutationScope";
import {
  applyEventNotifOverride,
  buildNotifSettingsMap,
  DEFAULT_CRON_NOTIF_SETTING,
  isReliableArrivalAccuracy,
  SAFETY_ALERT_TYPES,
} from "../lib/notificationRouting";
import type { ShimCaller } from "./rest-shim-auth";
import {
  CURRENT_LOCATION_UPSERT_SQL,
  currentLocationComparisonKey,
  normalizeCurrentLocationFixTime,
  shouldReplaceCurrentLocation,
} from "../shared/currentLocation.js";
import { eventOccurrenceAlertId, eventRevisionKey } from "../lib/eventOccurrence";
import {
  recordLocationAlertProvisionToParents,
  resolveLocationAlertConfirmation,
} from "../lib/locationConfirmationAudit";
import {
  loadPendingNotificationsForRecipient,
  markPendingNotificationsDeliveredForCaller,
  resolvePendingNotificationRecipientRole,
} from "../lib/pendingNotificationDelivery";
import {
  isNotificationEndpointSchemaUnavailable,
  refreshLegacyFcmTokenOwnership,
  unregisterOwnedFcmToken,
  upsertFcmTokenOwnership,
} from "../lib/notificationEndpointOwnership";
import { recordFamilyLifecycleEvent } from "../lib/familyLifecycleFunnel";

type Ctx = Context<{ Bindings: Env; Variables: Vars }>;

const LOCATION_HISTORY_MAX_ROWS = 400;
const LOCATION_HISTORY_MAX_AGE_MS = 31 * 24 * 60 * 60_000;
const LOCATION_HISTORY_DAILY_MAX_ROWS = 7_200;
const LOCATION_HISTORY_MAX_DAILY_SCOPES = 4;
const D1_MAX_BIND_PARAMS = 100;
const LOCATION_HISTORY_INSERT_BINDS_PER_ROW = 8;
const LOCATION_HISTORY_INSERT_CHUNK_SIZE = Math.floor(
  D1_MAX_BIND_PARAMS / LOCATION_HISTORY_INSERT_BINDS_PER_ROW,
);
const LOCATION_HISTORY_MEMBER_CHUNK_SIZE = D1_MAX_BIND_PARAMS;
const LOCATION_HISTORY_DUP_CHUNK_SIZE = D1_MAX_BIND_PARAMS - 2;

function chunkValues<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < values.length; start += size) {
    chunks.push(values.slice(start, start + size));
  }
  return chunks;
}

function voidOk(c: Ctx): Response {
  return c.body(null, 204);
}

async function readBody(c: Ctx): Promise<Record<string, unknown>> {
  try {
    const b = await c.req.json();
    return b && typeof b === "object" ? (b as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function memberRole(db: D1Database, familyId: string, userId: string): Promise<string | null> {
  return resolvePendingNotificationRecipientRole(db, familyId, userId);
}

async function memberForCaller(
  db: D1Database,
  familyId: string,
  userId: string,
): Promise<{ id: string; role: string; is_active: number } | null> {
  const row = await db
    .prepare("SELECT id, role, is_active FROM family_members WHERE family_id = ? AND user_id = ? LIMIT 1")
    .bind(familyId, userId)
    .first<{ id: string; role: string; is_active: number }>();
  return row ?? null;
}

export async function dispatchRpc(c: Ctx, fn: string, caller: ShimCaller): Promise<Response> {
  const db = c.env.DB;
  const requireAuthed = (): Response | null =>
    caller.serviceRole || caller.sub ? null : c.json({ error: "unauthorized" }, 401);

  const body = await readBody(c);

  try {
    switch (fn) {
      // ── 1) insert_parent_alert_v2 → (event_id, alert_type) 멱등 select-then-insert. 반환 uuid|null ──
      case "insert_parent_alert_v2": {
        const familyId = String(body.p_family_id ?? "");
        if (!familyId) return c.json({ error: "missing_family_id" }, 400);
        const at = String(body.p_alert_type ?? "");
        const familyAllowed = caller.serviceRole
          || (SAFETY_ALERT_TYPES.has(at)
            ? await assertSafetyFamilyAccess(db, caller.sub!, familyId)
            : await assertFamilyAccess(db, caller.sub!, familyId));
        if (!familyAllowed) {
          return c.json({ error: "forbidden" }, 403);
        }
        // 활성기기 격리: superseded(is_active=0) 자녀 기기의 알림 write 차단(안전 알림 예외).
        // service_role(cron) 은 우회 — 시스템 발신은 항상 허용.
        {
          if (!caller.serviceRole && !SAFETY_ALERT_TYPES.has(at)
              && await isSupersededChildDevice(db, caller.sub!, familyId)) {
            return c.json({ error: "superseded_device" }, 403);
          }
        }
        const id = await insertParentAlertV2(c.env as PushEnv, db, {
          familyId,
          alertType: String(body.p_alert_type ?? ""),
          title: String(body.p_title ?? ""),
          message: String(body.p_message ?? ""),
          severity: body.p_severity != null ? String(body.p_severity) : "info",
          eventId: body.p_event_id != null ? String(body.p_event_id) : null,
          childUserId: body.p_child_user_id != null ? String(body.p_child_user_id) : null,
        });
        if (id && resolveLocationAlertConfirmation(at)) {
          try {
            await recordLocationAlertProvisionToParents(db, {
              familyId,
              childUserIds: body.p_child_user_id != null
                ? [String(body.p_child_user_id)]
                : [],
              alertType: at,
            });
          } catch {
            return c.json({ error: "location_confirmation_unavailable" }, 503);
          }
        }
        return c.json(id); // PostgREST 스칼라 — 네이티브 미파싱.
      }

      // ── 2) upsert_child_location → child_locations select-then-write(user_id PK) ──
      // 원본 정의는 리포에 부재(대시보드 표). 호출 시그니처+PK 로 재구성.
      case "upsert_child_location": {
        const unauth = requireAuthed();
        if (unauth) return unauth;
        const userId = String(body.p_user_id ?? "");
        const familyId = String(body.p_family_id ?? "");
        const lat = Number(body.p_lat);
        const lng = Number(body.p_lng);
        const accuracyM = body.p_accuracy == null ? null : Number(body.p_accuracy);
        const fixTime = normalizeCurrentLocationFixTime(
          body.p_recorded_at ?? body.p_captured_at,
          Date.now(),
          body.p_fix_age_ms,
        );
        if (!userId || !familyId || !Number.isFinite(lat) || !Number.isFinite(lng) || !fixTime
            || (accuracyM != null && (!Number.isFinite(accuracyM) || accuracyM < 0))) {
          return c.json({ error: "invalid_args" }, 400);
        }
        if (!caller.serviceRole) {
          if (caller.sub !== userId) return c.json({ error: "forbidden" }, 403);
          // 활성기기 격리: superseded(is_active=0) 자녀 기기는 소스에서 위치 업로드 거부.
          const activeChild = await db
            .prepare("SELECT 1 AS ok FROM family_members WHERE family_id=? AND user_id=? AND role='child' AND is_active=1 LIMIT 1")
            .bind(familyId, caller.sub)
            .first();
          if (!activeChild) return c.json({ error: "forbidden" }, 403);
        }
        // 오래되거나 부정확한 cache는 실시간 도착 상태머신을 움직이지 않는다.
        const arrivalEligible = Date.now() - fixTime.atMs <= 10 * 60_000
          && isReliableArrivalAccuracy(accuracyM);
        const locationMutationScopes = arrivalEligible
          ? await loadFamilyNotificationMutationScopes(db, familyId, [userId])
          : [{ userId, familyId }];
        if (!locationMutationScopes) return c.json({ error: "account_mutation_blocked" }, 409);
        const locationMutationLeases = await acquireAccountMutationLeases(db, locationMutationScopes);
        if (locationMutationLeases.status !== "acquired") {
          return c.json(
            { error: locationMutationLeases.status === "blocked" ? "account_mutation_blocked" : "account_mutation_unavailable" },
            locationMutationLeases.status === "blocked" ? 409 : 503,
          );
        }
        let locationLeaseTransferred = false;
        try {
          if (!(await isActiveChildMutationTarget(db, familyId, userId))) {
            return c.json({ error: "child_no_longer_active" }, 409);
          }
          const previous = await db
            .prepare("SELECT updated_at FROM child_locations WHERE user_id = ? LIMIT 1")
            .bind(userId)
            .first<{ updated_at: string }>();
          if (!shouldReplaceCurrentLocation(previous?.updated_at, fixTime.atMs)) return voidOk(c);

          // 동시 업로드도 DB 한 문장에서 최신성 비교+write. 늦게 완료된 과거 fix가
          // current를 되감지 못한다. first SELECT는 알림 종류/빠른 skip용일 뿐 정합성은 이 WHERE가 보장한다.
          const write = await db
            .prepare(CURRENT_LOCATION_UPSERT_SQL)
            .bind(
              userId,
              familyId,
              lat,
              lng,
              fixTime.timestamp,
              accuracyM,
              currentLocationComparisonKey(fixTime.timestamp),
            )
            .run();
          const changed = Number(write.meta?.changes ?? 0) > 0;
          if (!changed) return voidOk(c);
          // child_locations postgres_changes 폴백(sync.js 1220) 보존 — DO 로 통지.
          await notifyPg(c.env, familyId, "child_locations", previous ? "UPDATE" : "INSERT", {
            user_id: userId,
            family_id: familyId,
            lat,
            lng,
            updated_at: fixTime.timestamp,
            accuracy_m: accuracyM,
          });
          c.executionCtx.waitUntil(recordFamilyLifecycleEvent(c.env, {
            familyId,
            event: "first_location",
            occurredAt: fixTime.timestamp,
          }));
          if (arrivalEligible) {
            c.executionCtx.waitUntil((async () => {
              try {
                await detectArbitraryArrival(c.env as unknown as PushEnv, db, {
                  familyId, userId, lat, lng, fixAtMs: fixTime.atMs,
                });
              } finally {
                await releaseAccountMutationLeases(db, locationMutationLeases.leases);
              }
            })());
            locationLeaseTransferred = true;
          }
          return voidOk(c);
        } finally {
          if (!locationLeaseTransferred) {
            await releaseAccountMutationLeases(db, locationMutationLeases.leases);
          }
        }
      }

      // ── 3) record_location_history_rows → location_history 다건 INSERT(배치 멤버십+멱등) ──
      // per-row 순차 await(멤버십 SELECT + dup substr 풀스캔 + INSERT)는 행 수에 비례해
      // 느려져(200행≈26s, 1000행 timeout) 대량 오프라인 버퍼 flush 가 영구 실패했다.
      // → 멤버십·dup 을 일괄 prefetch(각 1쿼리) 하고 신규행만 db.batch() 로 한 번에 INSERT.
      //   dup 범위 조회는 idx_location_history_user_recorded(user_id, recorded_at) 인덱스 활용.
      case "record_location_history_rows": {
        const unauth = requireAuthed();
        if (unauth) return unauth;
        const rawRows = Array.isArray(body.p_rows) ? (body.p_rows as Record<string, unknown>[]) : [];
        if (!rawRows.length) return voidOk(c);
        if (rawRows.length > LOCATION_HISTORY_MAX_ROWS) {
          return c.json({ error: "too_many_rows", max: LOCATION_HISTORY_MAX_ROWS }, 413);
        }

        // 1) 정규화 + 형식 유효성 검사(불변: 원본 미변형, 새 객체 생성).
        // 한 payload의 일부만 조용히 저장하면 Android가 2xx 뒤 청크 전체를 버퍼에서
        // 제거하므로, 무효 행 하나라도 있으면 저장 전에 전체 요청을 거부한다.
        type NormRow = {
          userId: string;
          familyId: string;
          lat: number;
          lng: number;
          accuracyM: number | null;
          recordedAt: string;
          recordedAtMs: number;
          dateKey: string;
          isEstimated: number;
          key: string;
        };
        const norm: NormRow[] = [];
        const nowMs = Date.now();
        for (const r of rawRows) {
          const userId = typeof r.user_id === "string" ? r.user_id : "";
          const familyId = typeof r.family_id === "string" ? r.family_id : "";
          const lat = Number(r.lat);
          const lng = Number(r.lng);
          const fixTime = normalizeCurrentLocationFixTime(r.recorded_at, nowMs);
          if (!userId || !familyId || !Number.isFinite(lat) || !Number.isFinite(lng) || !fixTime) {
            return c.json({ error: "invalid_args" }, 400);
          }
          const recordedAt = fixTime.timestamp;
          const isEstimated = r.is_estimated === true || r.is_estimated === 1 || r.is_estimated === "true" ? 1 : 0;
          const accuracyRaw = r.accuracy_m ?? r.accuracy;
          const accuracyNumber = Number(accuracyRaw);
          const accuracyM = Number.isFinite(accuracyNumber) && accuracyNumber >= 0 ? accuracyNumber : null;
          const key = `${userId}|${tsNorm(recordedAt.replace(" ", "T"))}`;
          norm.push({
            userId,
            familyId,
            lat,
            lng,
            accuracyM,
            recordedAt,
            recordedAtMs: fixTime.atMs,
            dateKey: "",
            isEstimated,
            key,
          });
        }
        if (!caller.serviceRole && norm.some((n) => n.userId !== caller.sub)) {
          return c.json({ error: "forbidden" }, 403);
        }

        // 2) 멤버십 일괄 확인(고유 user_id IN) → 허용 (user|family) 쌍 Set.
        const userIds = [...new Set(norm.map((n) => n.userId))];
        const memberOk = new Set<string>();
        const familyZones = new Map<string, string>();
        for (const userIdChunk of chunkValues(userIds, LOCATION_HISTORY_MEMBER_CHUNK_SIZE)) {
          const ph = userIdChunk.map(() => "?").join(",");
          const { results } = await db
            // 활성기기 격리: superseded(is_active=0) 자녀 기기의 오프라인 버퍼 flush 차단.
            // 위치 이력은 자녀만 기록하므로 role='child' 로 한정(부모/비활성 멤버 제외).
            .prepare(`SELECT fm.user_id, fm.family_id, f.time_zone FROM family_members fm JOIN families f ON f.id=fm.family_id WHERE fm.user_id IN (${ph}) AND fm.role = 'child' AND fm.is_active = 1`)
            .bind(...userIdChunk)
            .all<{ user_id: string; family_id: string; time_zone: string }>();
          for (const m of results ?? []) {
            memberOk.add(`${m.user_id}|${m.family_id}`);
            const zone = normalizeTimeZone(m.time_zone);
            if (!zone) return c.json({ error: "family_time_zone_unavailable" }, 503);
            familyZones.set(m.family_id, zone);
          }
        }
        if (!caller.serviceRole && norm.some((n) => !memberOk.has(`${n.userId}|${n.familyId}`))) {
          return c.json({ error: "forbidden" }, 403);
        }
        const authed = norm.filter((n) => memberOk.has(`${n.userId}|${n.familyId}`));
        if (!authed.length) return voidOk(c);
        for (const point of authed) point.dateKey = isoDateAt(point.recordedAtMs, familyZones.get(point.familyId)!);

        // 31일보다 오래된 오프라인 fix는 어느 티어에서도 새로 보존할 실익이 없다.
        // 2xx로 폐기해야 Android가 낡은 버퍼에 막히지 않고 최신 fix를 계속 전송한다.
        const retained = authed.filter(
          (n) => n.recordedAtMs >= nowMs - LOCATION_HISTORY_MAX_AGE_MS,
        );
        if (!retained.length) return voidOk(c);

        // 3) 멱등 dup 범위 prefetch((user_id, recorded_at) 인덱스) → 기존 key Set.
        let minRa = retained[0].recordedAt;
        let maxRa = retained[0].recordedAt;
        for (const n of retained) {
          if (n.recordedAt < minRa) minRa = n.recordedAt;
          if (n.recordedAt > maxRa) maxRa = n.recordedAt;
        }
        const dupUserIds = [...new Set(retained.map((n) => n.userId))];
        const existing = new Set<string>();
        for (const userIdChunk of chunkValues(dupUserIds, LOCATION_HISTORY_DUP_CHUNK_SIZE)) {
          const ph = userIdChunk.map(() => "?").join(",");
          const { results } = await db
            .prepare(
              `SELECT user_id, recorded_at FROM location_history
                WHERE user_id IN (${ph}) AND recorded_at >= ? AND recorded_at <= ?`,
            )
            .bind(...userIdChunk, minRa, maxRa)
            .all<{ user_id: string; recorded_at: string }>();
          for (const e of results ?? []) {
            existing.add(`${e.user_id}|${tsNorm(String(e.recorded_at).replace(" ", "T"))}`);
          }
        }

        // 4) 신규행만(기존 dup + 같은 배치 내 중복 제거).
        const seen = new Set<string>();
        const fresh = retained.filter((n) => {
          if (existing.has(n.key) || seen.has(n.key)) return false;
          seen.add(n.key);
          return true;
        });
        if (!fresh.length) return voidOk(c);

        // Android 15초 이동 주기의 이론상 하루 최대(5,760)보다 여유 있는 7,200행으로
        // 고정한다. 가족 현지 기록일별 quota라 정상 오프라인 재전송은 현재 요청일에 몰리지 않는다.
        const dailyScopes = new Map<string, { userId: string; dateKey: string; count: number }>();
        for (const row of fresh) {
          const scopeKey = `${row.userId}|${row.dateKey}`;
          const scope = dailyScopes.get(scopeKey);
          if (scope) scope.count += 1;
          else dailyScopes.set(scopeKey, { userId: row.userId, dateKey: row.dateKey, count: 1 });
        }
        if (dailyScopes.size > LOCATION_HISTORY_MAX_DAILY_SCOPES) {
          return c.json({
            error: "too_many_location_history_scopes",
            max: LOCATION_HISTORY_MAX_DAILY_SCOPES,
          }, 413);
        }
        const scopes = [...dailyScopes.values()];
        const scopePredicate = scopes.map(() => "(user_id=? AND date_key=?)").join(" OR ");
        const scopeBindings = scopes.flatMap((scope) => [scope.userId, scope.dateKey]);
        const { results: usageRows } = await db
          .prepare(
            `SELECT user_id,date_key,row_count FROM location_history_ingest_daily_usage
              WHERE ${scopePredicate}`,
          )
          .bind(...scopeBindings)
          .all<{ user_id: string; date_key: string; row_count: number }>();
        const existingUsage = new Map(
          (usageRows ?? []).map((row) => [
            `${row.user_id}|${row.date_key}`,
            Math.max(0, Number(row.row_count ?? 0)),
          ]),
        );
        if (scopes.some((scope) =>
          (existingUsage.get(`${scope.userId}|${scope.dateKey}`) ?? 0) + scope.count
            > LOCATION_HISTORY_DAILY_MAX_ROWS)) {
          return c.json({
            error: "location_history_daily_quota_exceeded",
            maxPerDay: LOCATION_HISTORY_DAILY_MAX_ROWS,
          }, 429);
        }

        // 5) INTEGER PRIMARY KEY id는 SQLite rowid 자동 할당. MAX+1을 앱에서 계산하면
        // 동시 RPC가 같은 MAX를 읽어 PK 충돌(500)하므로 id를 INSERT에서 제외한다.
        // 행당 8 bind를 가진 SELECT UNION ALL로 12행(96 bind)씩 묶는다.
        // Android 정본 400행은 membership 1 + dup 1 + quota read 1 + insert 34로
        // RPC 내부 최대 37 query다. 실제 신규 INSERT마다 DB trigger가 같은 transaction에서
        // quota를 1 증가시키므로 stale prefetch 뒤 중복된 행은 quota를 소모하지 않는다.
        const insertStatements = chunkValues(fresh, LOCATION_HISTORY_INSERT_CHUNK_SIZE).map((rows) => {
          const incomingSelect = rows.map((_, index) => index === 0
            ? "SELECT ? AS user_id, ? AS family_id, ? AS lat, ? AS lng, ? AS accuracy_m, ? AS recorded_at, ? AS is_estimated, ? AS ingest_date_key"
            : "UNION ALL SELECT ?,?,?,?,?,?,?,?"
          ).join("\n");
          const bindings = rows.flatMap((n) => [
            n.userId,
            n.familyId,
            n.lat,
            n.lng,
            n.accuracyM,
            n.recordedAt,
            n.isEstimated,
            n.dateKey,
          ]);
          return db.prepare(
            `INSERT INTO location_history (user_id, family_id, lat, lng, accuracy_m, recorded_at, is_estimated, ingest_date_key)
             SELECT incoming.user_id, incoming.family_id, incoming.lat, incoming.lng,
                    incoming.accuracy_m, incoming.recorded_at, incoming.is_estimated, incoming.ingest_date_key
               FROM (
                 ${incomingSelect}
               ) AS incoming
              WHERE NOT EXISTS (
                SELECT 1 FROM location_history existing
                 WHERE existing.user_id = incoming.user_id
                   AND existing.recorded_at = incoming.recorded_at
                 LIMIT 1
              )`,
          ).bind(...bindings);
        });
        try {
          await db.batch(insertStatements);
        } catch (error) {
          // trigger가 상한 초과 INSERT를 중단하면 위치 행과 quota 증가가 모두 rollback된다.
          const { results: currentUsageRows } = await db
            .prepare(
              `SELECT user_id,date_key,row_count FROM location_history_ingest_daily_usage
                WHERE ${scopePredicate}`,
            )
            .bind(...scopeBindings)
            .all<{ user_id: string; date_key: string; row_count: number }>();
          const currentUsage = new Map(
            (currentUsageRows ?? []).map((row) => [
              `${row.user_id}|${row.date_key}`,
              Math.max(0, Number(row.row_count ?? 0)),
            ]),
          );
          if (scopes.some((scope) =>
            (currentUsage.get(`${scope.userId}|${scope.dateKey}`) ?? 0) + scope.count
              > LOCATION_HISTORY_DAILY_MAX_ROWS)) {
            return c.json({
              error: "location_history_daily_quota_exceeded",
              maxPerDay: LOCATION_HISTORY_DAILY_MAX_ROWS,
            }, 429);
          }
          throw error;
        }
        return voidOk(c);
      }

      // ── 4) get_pending_notifications_for_device → bare 배열 [{id,title,body,data,created_at}] ──
      case "get_pending_notifications_for_device": {
        const familyId = String(body.p_family_id ?? "");
        const userId = String(body.p_user_id ?? "");
        if (!familyId || !userId) return c.json({ error: "family_id and user_id are required" }, 400);
        const role = await memberRole(db, familyId, userId);
        if (!role) return c.json({ error: "not_family_member" }, 403);
        // 기기별 pending은 같은 가족이라는 이유만으로 다른 구성원을 대리 조회할 수 없다.
        if (!caller.serviceRole && caller.sub !== userId) {
          return c.json({ error: "forbidden" }, 403);
        }
        const requestedRole = (body.p_role != null && String(body.p_role).trim()) || "";
        if (!caller.serviceRole && requestedRole && requestedRole !== role) {
          return c.json({ error: "role_mismatch" }, 403);
        }
        const effRole = caller.serviceRole && requestedRole ? requestedRole : role;
        const nowStr = tsNorm(new Date().toISOString());

        let results;
        try {
          results = await loadPendingNotificationsForRecipient(db, {
            familyId,
            userId,
            requestedRole: effRole,
            now: nowStr,
          });
        } catch (error) {
          console.error("pending notification quiet-hours filtering failed:");
          return c.json({ error: "pending_delivery_unavailable" }, 503);
        }

        return c.json(results.map((r) => ({ ...r, data: parseJson(r.data) }))); // data → 객체.
      }

      // ── 5) mark_notifications_delivered → UPDATE delivered. 반환 정수 count ──
      case "mark_notifications_delivered": {
        const unauth = requireAuthed();
        if (unauth) return unauth;
        const ids = Array.isArray(body.p_ids)
          ? [...new Set((body.p_ids as unknown[]).map((x) => String(x)).filter(Boolean))].slice(0, 100)
          : [];
        if (!ids.length) return c.json(0);
        const changed = await markPendingNotificationsDeliveredForCaller(db, {
          ids,
          callerUserId: caller.sub,
          familyIds: caller.familyIds,
          serviceRole: caller.serviceRole,
          deliveredAt: pgNow(),
        });
        return c.json(changed);
      }

      // ── 6) get_today_events → bare 배열 [{event_id,event_title,event_time,event_emoji,event_location}] ──
      case "get_today_events": {
        const familyId = String(body.p_family_id ?? "");
        const dateKey = String(body.p_date_key ?? ""); // 'YYYY-M-D' KST(zero-pad 아님).
        if (!familyId || !dateKey) return c.json([]);
        if (!caller.serviceRole && !(await assertFamilyAccess(db, caller.sub!, familyId))) {
          return c.json({ error: "forbidden" }, 403);
        }
        const callerMember = !caller.serviceRole && caller.sub
          ? await memberForCaller(db, familyId, caller.sub)
          : null;
        const { results } = callerMember?.role === "child"
          ? await db
            .prepare(
              `SELECT DISTINCT e.id AS event_id, e.title AS event_title, e.time AS event_time,
                      e.emoji AS event_emoji, e.location AS event_location, e.notif_override,
                      e.date_key AS event_date_key, e.updated_at AS event_updated_at
                 FROM events e
                 LEFT JOIN events_children ec ON ec.event_id = e.id
                WHERE e.family_id = ?
                  AND e.date_key = ?
                  AND ? = 1
                  AND (e.is_family_event = 1 OR ec.child_id = ?)
                ORDER BY e.time ASC`,
            )
            .bind(familyId, dateKey, Number(callerMember.is_active) === 1 ? 1 : 0, callerMember.id)
            .all<Record<string, unknown>>()
          : await db
            .prepare(
              `SELECT id AS event_id, title AS event_title, time AS event_time, emoji AS event_emoji,
                      location AS event_location, notif_override,
                      date_key AS event_date_key, updated_at AS event_updated_at
                 FROM events WHERE family_id = ? AND date_key = ? ORDER BY time ASC`,
            )
            .bind(familyId, dateKey)
            .all<Record<string, unknown>>();
        let childSetting = DEFAULT_CRON_NOTIF_SETTING;
        if (callerMember?.role === "child" && caller.sub) {
          const settingRow = await db
            .prepare(
              `SELECT user_id, parent_enabled, child_enabled, minutes_before
                 FROM notification_settings WHERE user_id = ? LIMIT 1`,
            )
            .bind(caller.sub)
            .first<Record<string, unknown>>();
          if (settingRow) {
            const settings = buildNotifSettingsMap([{
              user_id: String(settingRow.user_id ?? caller.sub),
              parent_enabled: toBool(settingRow.parent_enabled),
              child_enabled: toBool(settingRow.child_enabled),
              minutes_before: pgArray(settingRow.minutes_before).map((value) => Number(value)),
            }]);
            childSetting = settings.get(caller.sub) ?? DEFAULT_CRON_NOTIF_SETTING;
          }
        }
        return c.json((results ?? []).map((r) => {
          const eventOverride = parseJson(r.notif_override);
          const effective = applyEventNotifOverride(childSetting, eventOverride);
          const eventId = String(r.event_id ?? "");
          const eventDateKey = String(r.event_date_key ?? dateKey);
          const eventUpdatedAt = String(r.event_updated_at ?? "");
          const { notif_override: _omit, event_updated_at: _updatedAt, ...rest } = r;
          return {
            ...rest,
            event_location: parseJson(r.event_location),
            event_reminder_minutes: effective.minutesBefore,
            event_reminders_enabled: effective.childEnabled,
            event_revision_key: eventRevisionKey(eventUpdatedAt),
            event_occurrence_id: eventOccurrenceAlertId({
              eventId,
              dateKey: eventDateKey,
              updatedAt: eventUpdatedAt,
            }),
          };
        }));
      }

      // ── 7) upsert_fcm_token → fcm_token UNIQUE 기반 원자 소유권 갱신 ──
      case "upsert_fcm_token": {
        const unauth = requireAuthed();
        if (unauth) return unauth;
        const userId = String(body.p_user_id ?? "");
        const familyId = String(body.p_family_id ?? "");
        const token = String(body.p_fcm_token ?? "").trim();
        const registrationInstanceId = String(body.p_registration_instance_id ?? "").trim();
        const platform = (body.p_platform != null && String(body.p_platform).trim()) || "android";
        if (!userId || !familyId || !token) {
          return c.json({ error: "user_id, family_id, and fcm_token are required" }, 400);
        }
        if (!caller.serviceRole && caller.sub !== userId) {
          return c.json({ error: "forbidden" }, 403);
        }
        if (!caller.serviceRole) {
          const canonicalFamily = await resolveCanonicalFamilyMembership(db, caller.sub!, caller.familyId);
          if (canonicalFamily?.familyId !== familyId) {
            return c.json({ error: "forbidden" }, 403);
          }
        }
        if (!(await memberRole(db, familyId, userId))) return c.json({ error: "not_family_member" }, 403);
        const now = pgNow();
        const owned = registrationInstanceId
          ? await upsertFcmTokenOwnership(db, {
            id: crypto.randomUUID(),
            userId,
            familyId,
            token,
            platform,
            registrationInstanceId,
            now,
          })
          : await refreshLegacyFcmTokenOwnership(db, {
            userId,
            familyId,
            token,
            platform,
            now,
          });
        if (!owned) return c.json({ error: "endpoint_owned_by_other_user" }, 409);
        return voidOk(c);
      }

      // ── 8) unregister_fcm_token → 호출자 본인 토큰만 해제 ──
      case "unregister_fcm_token": {
        const unauth = requireAuthed();
        if (unauth) return unauth;
        const requestedUserId = String(body.p_user_id ?? caller.sub ?? "");
        const userId = caller.serviceRole ? requestedUserId : requestedUserId || caller.sub!;
        const token = String(body.p_fcm_token ?? "").trim();
        const registrationInstanceId = String(body.p_registration_instance_id ?? "").trim();
        if (!userId || !token || !registrationInstanceId) {
          return c.json({ error: "user_id, fcm_token, and registration_instance_id are required" }, 400);
        }
        if (!caller.serviceRole && userId !== caller.sub) {
          return c.json({ error: "forbidden" }, 403);
        }
        await unregisterOwnedFcmToken(db, {
          token,
          userId,
          registrationInstanceId,
          now: pgNow(),
        });
        return voidOk(c);
      }

      // ── 9) record_child_shutdown → child_location_link_state.last_shutdown_at upsert ──
      case "record_child_shutdown": {
        const familyId = String(body.p_family_id ?? "");
        const childUserId = String(body.p_child_user_id ?? "");
        if (!familyId || !childUserId) return voidOk(c); // PG: void no-op.
        if (!caller.serviceRole && caller.sub !== childUserId) {
          return c.json({ error: "forbidden" }, 403);
        }
        // 스푸핑 방지: 실제 child 멤버만(원본). 아니면 silent no-op(void).
        const m = await db
          .prepare(
            "SELECT 1 AS ok FROM family_members WHERE family_id = ? AND user_id = ? AND role = 'child' AND is_active = 1 LIMIT 1",
          )
          .bind(familyId, childUserId)
          .first<{ ok: number }>();
        if (!m) {
          return caller.serviceRole ? voidOk(c) : c.json({ error: "forbidden" }, 403);
        }
        const now = pgNow();
        const exists = await db
          .prepare("SELECT 1 AS ok FROM child_location_link_state WHERE family_id = ? AND child_user_id = ? LIMIT 1")
          .bind(familyId, childUserId)
          .first<{ ok: number }>();
        if (exists) {
          await db
            .prepare("UPDATE child_location_link_state SET last_shutdown_at = ?, updated_at = ? WHERE family_id = ? AND child_user_id = ?")
            .bind(now, now, familyId, childUserId)
            .run();
        } else {
          await db
            .prepare("INSERT INTO child_location_link_state (family_id, child_user_id, last_shutdown_at, updated_at) VALUES (?,?,?,?)")
            .bind(familyId, childUserId, now, now)
            .run();
        }
        // 부모 앱은 가족 조회의 device_health 만 읽는다 — 꺼진 시각과 그때 배터리를 함께 남겨
        // "배터리가 다 돼서 꺼졌어요 / 전원이 꺼졌어요"를 보여 준다(2026-09-26: 방전으로 꺼져도 알 수 없었다).
        // 폰이 다시 켜져 기기 상태를 보고하면 device_health 가 통째로 바뀌어 자연히 지워진다. 실패해도 마커는 유지한다.
        const rawBattery = Number(body.p_battery_level);
        const shutdownBattery = Number.isFinite(rawBattery) && rawBattery >= 0 && rawBattery <= 100 ? Math.round(rawBattery) : null;
        try {
          await db
            .prepare(
              `UPDATE family_members
                  SET device_health = json_set(
                    CASE WHEN json_valid(device_health) THEN device_health ELSE '{}' END,
                    '$.shutdownAt', ?, '$.shutdownBatteryLevel', ?
                  )
                WHERE family_id = ? AND user_id = ? AND role = 'child' AND is_active = 1`,
            )
            .bind(new Date().toISOString(), shutdownBattery, familyId, childUserId)
            .run();
        } catch {
          console.warn("record_child_shutdown device_health stamp failed");
        }
        return voidOk(c);
      }

      // ── 10) force_ring_acknowledge → 최초 ack 멱등. 반환 jsonb({ok}|{error}) ──
      case "force_ring_acknowledge": {
        const eventId = String(body.p_event_id ?? "");
        if (!caller.serviceRole && !caller.sub) return c.json({ error: "auth_required" });
        const ev = await db
          .prepare("SELECT id, family_id, target_user_id, acknowledged_at, stopped_at, stop_reason FROM force_ring_events WHERE id = ? LIMIT 1")
          .bind(eventId)
          .first<Record<string, unknown>>();
        if (!ev) return c.json({ error: "event_not_found" });

        if (!caller.serviceRole) {
          const targetUserId = ev.target_user_id == null ? null : String(ev.target_user_id);
          let ok = targetUserId !== null && targetUserId === caller.sub;
          if (targetUserId === null) {
            const child = await db
              .prepare(
                "SELECT 1 AS ok FROM family_members WHERE family_id = ? AND user_id = ? AND role = 'child' AND is_active = 1 LIMIT 1",
              )
              .bind(String(ev.family_id), caller.sub!)
              .first<{ ok: number }>();
            ok = !!child;
          }
          if (!ok) return c.json({ error: "forbidden" });
        }

        if (ev.acknowledged_at != null) {
          return c.json({ ok: true, already_acked: true, acknowledged_at: ev.acknowledged_at });
        }
        const now = pgNow();
        await db
          .prepare(
            `UPDATE force_ring_events
                SET acknowledged_at = ?, stopped_at = COALESCE(stopped_at, ?), stop_reason = COALESCE(stop_reason, 'child_ack')
              WHERE id = ? AND acknowledged_at IS NULL`,
          )
          .bind(now, now, eventId)
          .run();
        // 부모 UI(벨 정지) 실시간 반영.
        await notifyPg(c.env, String(ev.family_id), "force_ring_events", "UPDATE", {
          id: eventId, family_id: ev.family_id, acknowledged_at: now,
          stopped_at: ev.stopped_at ?? now, stop_reason: ev.stop_reason ?? "child_ack",
        });
        return c.json({ ok: true, acknowledged_at: now });
      }

      default:
        return c.json({ error: "unknown_rpc", fn }, 404);
    }
  } catch (e) {
    if (isNotificationEndpointSchemaUnavailable(e)) {
      return c.json({ error: "notification_endpoint_schema_unavailable" }, 503);
    }
    console.error("[shim] rpc failed");
    return c.json({ error: "internal" }, 500);
  }
}

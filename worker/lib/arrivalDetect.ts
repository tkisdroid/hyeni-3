// 미등록 장소 도착 감지(Google Family Link 스타일) — TK 요구(2026-07-06).
//
// 등록 장소(saved_places + academies)는 등록장소 지오펜스가 도착 알림을 담당한다.
// 이 모듈은 그 밖의 **임의 장소**를 서버에서 감지한다: 아이 위치 업로드마다 앵커(머무는 점)를
// 추적해, 반경 150m 안에서 5분 이상 머물면 역지오코딩한 주소로 부모에게 도착 알림을 보낸다.
// 같은 장소(200m)는 2시간 쿨다운, 등록 장소 근처(150m)는 skip(네이티브 지오펜스와 중복 방지).
// upsert_child_location 의 waitUntil 로 실행 — 실패해도 위치 저장에는 영향 없다(fire-and-forget).
import { handleInstantNotification, insertParentAlertV2 } from "../routes/push-notify";
import { episodeIdempotencyKey } from "../shared/locationStaleness.js";
import { pgNow, pgTs } from "./time";
import type { PushEnv } from "./pushEnv";
import {
  buildScheduledArrivalAlert,
  eventStartAtMs,
  findNearbyScheduleAtPlace,
  findScheduleArrivalOverlap,
  scheduleWindowDateKeys,
  type ScheduleArrivalCandidate,
} from "./scheduleArrivalOverlap";
import { eventOccurrenceAlertId } from "./eventOccurrence";
import { parentAlertDeliveryKey } from "./parentAlertDedupe";
import {
  recordLocationAlertProvisionToParents,
  recordLocationConfirmation,
} from "./locationConfirmationAudit";
import { awardAutomaticStickerForBehavior } from "./automaticStickerReward";

const ANCHOR_RADIUS_M = 150; // 이 반경을 벗어나면 이동 중 → 앵커 리셋
const DWELL_MS = 5 * 60 * 1000; // 5분 이상 머물면 "도착"
const SAVED_PLACE_RADIUS_M = 150; // 등록 장소 근처는 네이티브 지오펜스 담당 → skip
const RENOTIFY_DIST_M = 200; // 직전 알림 장소와 이 거리 이내면 같은 장소로 간주
const COOLDOWN_MS = 2 * 60 * 60 * 1000; // 같은 장소 재알림 쿨다운 2시간
const PUSH_LEASE_MS = 2 * 60 * 1000; // 전송 중 crash/FCM 0건이면 같은 episode를 재시도

const EARTH_R = 6371000;
function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

interface ArrivalState {
  anchor_lat: number;
  anchor_lng: number;
  anchor_since: string;
  last_notif_lat: number | null;
  last_notif_lng: number | null;
  last_notif_at: string | null;
}

// Kakao 역지오코딩(일반 REST 키로 동작하는 local API) — 도로명 우선, 실패 시 null.
async function reverseGeocode(env: PushEnv, lat: number, lng: number): Promise<string | null> {
  const key =
    (env as unknown as { KAKAO_REST_KEY?: string; KAKAO_REST_API_KEY?: string }).KAKAO_REST_KEY ||
    (env as unknown as { KAKAO_REST_API_KEY?: string }).KAKAO_REST_API_KEY ||
    "";
  if (!key) return null;
  try {
    const res = await fetch(
      `https://dapi.kakao.com/v2/local/geo/coord2address.json?x=${lng}&y=${lat}`,
      { headers: { Authorization: `KakaoAK ${key}` } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      documents?: Array<{
        road_address?: { address_name?: string } | null;
        address?: { address_name?: string } | null;
      }>;
    };
    const doc = data.documents?.[0];
    return doc?.road_address?.address_name || doc?.address?.address_name || null;
  } catch {
    return null;
  }
}

async function overlappingScheduleEvent(
  db: D1Database,
  args: { familyId: string; childMemberId: string; atMs: number; lat: number; lng: number },
): Promise<{ active: ScheduleArrivalCandidate | null; nearby: ScheduleArrivalCandidate | null }> {
  const dateKeys = scheduleWindowDateKeys(args.atMs);
  const datePh = dateKeys.map(() => "?").join(",");
  const { results } = await db
    .prepare(
      `SELECT DISTINCT e.id, e.title, e.date_key, e.time, e.location, e.updated_at
         FROM events e
         LEFT JOIN events_children ec ON ec.event_id = e.id
        WHERE e.family_id = ? AND e.date_key IN (${datePh})
          AND (e.is_family_event = 1 OR ec.child_id = ?)`,
    )
    .bind(args.familyId, ...dateKeys, args.childMemberId)
    .all<{ id: string; title: string; date_key: string; time: string | null; location: unknown; updated_at: string }>();

  const candidates: ScheduleArrivalCandidate[] = [];
  for (const row of results ?? []) {
    if (typeof row.time !== "string" || !row.time) continue;
    const startAtMs = eventStartAtMs(String(row.date_key), row.time);
    if (startAtMs == null) continue;
    let location: unknown = row.location;
    if (typeof location === "string") {
      try { location = JSON.parse(location); } catch { continue; }
    }
    if (!location || typeof location !== "object") continue;
    const point = location as { lat?: unknown; lng?: unknown };
    const candidate: ScheduleArrivalCandidate = {
      eventId: String(row.id),
      dateKey: String(row.date_key),
      occurrenceId: eventOccurrenceAlertId({
        eventId: String(row.id),
        dateKey: String(row.date_key),
        updatedAt: String(row.updated_at ?? ""),
      }),
      title: String(row.title || "일정"),
      startAtMs,
      lat: Number(point.lat),
      lng: Number(point.lng),
    };
    candidates.push(candidate);
  }
  const place = { lat: args.lat, lng: args.lng };
  const active = findScheduleArrivalOverlap(place, args.atMs, candidates);
  return {
    active,
    nearby: active ?? findNearbyScheduleAtPlace(place, args.atMs, candidates),
  };
}

/**
 * 아이 위치 업로드 후처리 — 미등록 장소 5분 체류 시 부모에게 도착 알림.
 * 모든 예외는 삼켜서(로그만) 위치 저장 흐름을 절대 방해하지 않는다.
 */
export async function detectArbitraryArrival(
  env: PushEnv,
  db: D1Database,
  args: { familyId: string; userId: string; lat: number; lng: number; fixAtMs?: number },
): Promise<void> {
  try {
    const { familyId, userId, lat, lng } = args;
    await recordLocationConfirmation(db, {
      familyId,
      subjectUserId: userId,
      action: "use",
      requesterKind: "system",
      requesterUserId: null,
      recipientKind: "none",
      recipientUserId: null,
      collectionMethod: "not_applicable",
      acquisitionPath: "location_upload_payload",
      serviceCode: "arbitrary_arrival_monitor",
      deliveryMethod: "worker_internal",
      purposeCode: "arrival_departure_alert",
      occurredAt: typeof args.fixAtMs === "number" && Number.isFinite(args.fixAtMs)
        ? new Date(args.fixAtMs).toISOString()
        : undefined,
    });
    const receivedAtMs = Date.now();
    const nowMs = Number.isFinite(args.fixAtMs) ? Math.min(Number(args.fixAtMs), receivedAtMs) : receivedAtMs;
    const nowIso = new Date(nowMs).toISOString();

    const state = await db
      .prepare("SELECT * FROM child_arrival_state WHERE user_id=?")
      .bind(userId)
      .first<ArrivalState>();

    // 첫 관측 또는 앵커 이탈(이동 중) → 앵커 리셋.
    if (!state || distanceM(lat, lng, state.anchor_lat, state.anchor_lng) > ANCHOR_RADIUS_M) {
      await db
        .prepare(
          `INSERT INTO child_arrival_state (user_id, family_id, anchor_lat, anchor_lng, anchor_since, last_notif_lat, last_notif_lng, last_notif_at)
           VALUES (?,?,?,?,?,?,?,?)
           ON CONFLICT(user_id) DO UPDATE SET family_id=excluded.family_id,
             anchor_lat=excluded.anchor_lat, anchor_lng=excluded.anchor_lng, anchor_since=excluded.anchor_since`,
        )
        .bind(
          userId,
          familyId,
          lat,
          lng,
          nowIso,
          state?.last_notif_lat ?? null,
          state?.last_notif_lng ?? null,
          state?.last_notif_at ?? null,
        )
        .run();
      return;
    }

    // 앵커 반경 내 체류 중 — 5분 미만이면 대기.
    const sinceMs = new Date(state.anchor_since).getTime();
    if (!Number.isFinite(sinceMs) || nowMs - sinceMs < DWELL_MS) return;

    // 같은 앵커로 이미 알렸으면(쿨다운 내) skip.
    if (
      state.last_notif_lat != null &&
      state.last_notif_lng != null &&
      state.last_notif_at &&
      distanceM(state.anchor_lat, state.anchor_lng, state.last_notif_lat, state.last_notif_lng) <
        RENOTIFY_DIST_M &&
      nowMs - new Date(state.last_notif_at).getTime() < COOLDOWN_MS
    ) {
      return;
    }

    // 등록 장소 근처면 네이티브 지오펜스가 담당 — 중복 알림 방지.
    const places = await db
      .prepare(
        `SELECT name, location FROM saved_places WHERE family_id=?1
         UNION ALL
         SELECT name, location FROM academies WHERE family_id=?1`,
      )
      .bind(familyId)
      .all<{ name: string; location: string }>();
    for (const p of places.results ?? []) {
      try {
        const loc = JSON.parse(p.location) as { lat?: number; lng?: number };
        if (
          typeof loc.lat === "number" &&
          typeof loc.lng === "number" &&
          distanceM(state.anchor_lat, state.anchor_lng, loc.lat, loc.lng) < SAVED_PLACE_RADIUS_M
        ) {
          return;
        }
      } catch {
        /* malformed location — skip row */
      }
    }

    // 아이 이름 + 장소명(역지오코딩) 구성.
    const member = await db
      .prepare(
        "SELECT id, name FROM family_members WHERE family_id=? AND user_id=? AND role='child' AND is_active=1 LIMIT 1",
      )
      .bind(familyId, userId)
      .first<{ id: string; name: string }>();
    if (!member) return;
    const childName = member?.name?.trim() || "아이";

    // 같은 위치·시간의 일정이 있으면 일반 도착을 버리거나 최대 60분 미루지 않고
    // occurrence 기반 일정 도착으로 즉시 승격한다.
    const scheduleMatches = member.id
      ? await overlappingScheduleEvent(db, {
        familyId,
        childMemberId: member.id,
        // 5분 체류가 확정된 시각이 아니라 실제 앵커 진입 시각으로 일정 창을 판정한다.
        atMs: sinceMs,
        lat: state.anchor_lat,
        lng: state.anchor_lng,
      })
      : { active: null, nearby: null };
    const scheduleMatch = scheduleMatches.active;
    const scheduleAssociation = scheduleMatches.nearby;
    const address = scheduleMatch ? null : await reverseGeocode(env, state.anchor_lat, state.anchor_lng);
    const placeLabel = address || "새로운 장소";

    // 한글 조사(이/가) — 이름 끝 글자 받침 유무로 선택("혜니가"/"지훈이가").
    const last = childName.charCodeAt(childName.length - 1);
    const josa = last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 !== 0 ? "이가" : "가";
    const scheduledAlert = scheduleMatch ? buildScheduledArrivalAlert(childName, scheduleMatch) : null;
    const title = scheduledAlert?.title ?? `📍 ${childName} 도착`;
    const message = scheduledAlert?.message ?? `${childName}${josa} '${placeLabel}' 근처에 도착했어요.`;

    // 같은 state snapshot을 읽은 동시 waitUntil은 같은 key를 만든다. push_idempotency
    // PK claim을 먼저 잡은 한 실행만 DB 알림과 FCM을 발송해 0.6초 간격 중복을 막는다.
    const idempotencyKey = episodeIdempotencyKey(
      "arbitrary_arrival",
      userId,
      `${state.anchor_since}|${state.last_notif_at ?? "first"}`,
    );
    const claimNowMs = Date.now();
    const claimNow = pgTs(new Date(claimNowMs));
    const claim = await db
      .prepare(
        `INSERT OR IGNORE INTO push_idempotency (key, created_at, first_sent_at, family_id, action)
         VALUES (?,?,?,?,?)`,
      )
      .bind(idempotencyKey, claimNow, null, familyId, "arbitrary_arrival")
      .run();
    let ownsPushLease = Number(claim.meta?.changes ?? 0) > 0;
    if (!ownsPushLease) {
      const retryClaim = await db
        .prepare(
          `UPDATE push_idempotency
              SET created_at=?
            WHERE key=? AND action='arbitrary_arrival' AND first_sent_at IS NULL
              AND created_at < ?`,
        )
        .bind(claimNow, idempotencyKey, pgTs(new Date(claimNowMs - PUSH_LEASE_MS)))
        .run();
      ownsPushLease = Number(retryClaim.meta?.changes ?? 0) > 0;
    }
    if (!ownsPushLease) return;

    // 부모 알림센터 기록.
    const alertType = "arrived";
    const alertId = await insertParentAlertV2(env, db, {
      familyId,
      alertType,
      title,
      message,
      severity: "info",
      eventId: scheduleAssociation?.occurrenceId ?? idempotencyKey,
      childUserId: userId,
    });
    if (!alertId) {
      await db
        .prepare("DELETE FROM push_idempotency WHERE key=? AND action='arbitrary_arrival'")
        .bind(idempotencyKey)
        .run();
      return;
    }
    await recordLocationAlertProvisionToParents(db, {
      familyId,
      childUserIds: [userId],
      alertType,
    });
    // 공통 parent_alert 전달 경로가 부모별 설정·FCM/Web·foreground pending을 모두
    // 보장한다. FCM 구독 0건이어도 pending이 저장되면 안전하게 성공으로 본다.
    const deliveryKey = scheduleAssociation?.occurrenceId
      ? parentAlertDeliveryKey(alertType, scheduleAssociation.occurrenceId)
      : episodeIdempotencyKey(
        "arbitrary_arrival_delivery",
        userId,
        `${state.anchor_since}|${state.last_notif_at ?? "first"}`,
      );
    const delivery = await handleInstantNotification(
      env,
      db,
      {
        action: "parent_alert",
        familyId,
        senderUserId: userId,
        severity: "info",
        alertType,
        title,
        message,
        ...(scheduleAssociation?.eventId ? { eventId: scheduleAssociation.eventId } : {}),
        idempotency_key: deliveryKey,
      },
      "",
      "service_role",
      null,
    );
    if (!delivery.ok) return;

    if (scheduleAssociation) {
      await awardAutomaticStickerForBehavior(env, db, {
        kind: "schedule_early_arrival",
        familyId,
        childUserId: userId,
        eventId: scheduleAssociation.eventId,
        occurrenceId: scheduleAssociation.occurrenceId ?? scheduleAssociation.eventId,
        dateKey: scheduleAssociation.dateKey ?? "",
        arrivedAtMs: sinceMs,
        scheduledAtMs: scheduleAssociation.startAtMs,
      });
    }

    const deliveredNow = pgNow();
    await db
      .prepare(
        "UPDATE push_idempotency SET first_sent_at=?, created_at=? WHERE key=? AND action='arbitrary_arrival'",
      )
      .bind(deliveredNow, deliveredNow, idempotencyKey)
      .run();

    await db
      .prepare(
        "UPDATE child_arrival_state SET last_notif_lat=?, last_notif_lng=?, last_notif_at=? WHERE user_id=?",
      )
      .bind(state.anchor_lat, state.anchor_lng, nowIso, userId)
      .run();
  } catch (e) {
    console.error("detectArbitraryArrival failed:");
  }
}

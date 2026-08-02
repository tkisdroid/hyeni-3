// 등록장소 도착·출발 알림의 "장소 단위" 중복 억제 (2026-07-24 실사고 수정).
//
// 왜 필요한가 — 하이브리드 geofence 는 자녀 네이티브(LocationService)와 서버 cron
// (registered-place-geofence-check)이 같은 방문을 **각자** 평가한다. 두 평가자는 서로
// 다른 fix 스트림을 본다(네이티브=기기 GPS 콜백, 서버=location_history 8분 재생)므로
// 같은 방문이어도 episode 시각(firstInsideAtMs/lastDepartedAtMs)이 몇십 초~몇 분 다르다.
// 기존 dedup 은 `placePresenceIdempotencyKey(kind, child, placeKey, floor(episodeMs/10분))`
// 의 10분 버킷이 **우연히 일치할 때만** 걸렸고, episode 가 버킷 경계를 사이에 두면
// 그대로 통과해 부모에게 같은 알림이 두 번 갔다.
//
// 실사고(2026-07-24 아침, 혜니): "집 도착" 07:24:04(episode 07:20~07:30) + 07:26:18
// (episode 07:10~07:20), "집 출발" 08:30:19(08:20~08:30) + 08:32:55(08:30~08:40).
// 네 건 모두 경계를 45초~1분 차이로 갈라 멱등키가 달라진 케이스였다.
//
// 근본 수정 — episode 시각에 의존하는 대신 **장소 단위 쿨다운**으로 판정한다.
// 같은 (family, child, placeKey, kind)의 알림이 쿨다운 창 안에 이미 있으면 두 번째
// 평가자의 알림은 만들지 않고 기존 alert id 를 돌려준다(= 호출부는 성공으로 보고
// 상태를 진행하므로 재시도 루프도 없다). 창 크기는 상태머신 cooldownMs(10분)와 같다 —
// 진짜 재방문은 상태머신이 SILENT_RE_ENTER/SILENT_LEAVE 로 이미 조용히 처리한다.
//
// 스키마 무변경: 신규 알림은 metadata 에 {placeKey, presenceKind} 를 남기고, 그 이전
// (구버전 앱 포함) 행은 event_id 를 후보 (placeKey, bucket) 집합과 대조해 역산한다.
// 역산은 서버가 가족 장소 목록·자녀 id·kind 를 모두 알기에 가능하며, 덕분에 앱을
// 재배포하지 않아도 서버 배포만으로 중복이 멈춘다.
import { placePresenceIdempotencyKey } from "../shared/registeredPlaceGeofence.js";
import { pgTs } from "./time.ts";

export type RegisteredPlacePresenceKind = "arrived" | "left";

/** 장소 출입 알림의 쿨다운 창 — 상태머신 cooldownMs 와 동일(10분). */
export const REGISTERED_PLACE_PRESENCE_DEDUPE_WINDOW_MS = 10 * 60_000;

// episode 는 항상 "지금"보다 과거다(도착=dwell 이전, 출발=이탈 확정 시각). cron 은
// location_history 를 8분까지 거슬러 재생하고 전달 지연도 있으므로 넉넉히 잡는다.
// 기기 시계가 앞선 경우를 대비해 미래 방향으로도 조금 열어둔다.
const PRESENCE_EPISODE_LOOKBACK_MS = 45 * 60_000;
const PRESENCE_EPISODE_SKEW_MS = 10 * 60_000;
const EPISODE_BUCKET_MS = 10 * 60_000;

/** place_arrived/place_left 만 이 dedup 대상이다. 일정 도착(arrived)은 occurrence id 로 이미 정확히 dedup 된다. */
export function registeredPlacePresenceKind(alertType: string): RegisteredPlacePresenceKind | null {
  const t = String(alertType || "").trim();
  if (t === "place_arrived") return "arrived";
  if (t === "place_left") return "left";
  return null;
}

export function registeredPlacePresenceMetadata(
  placeKey: string,
  kind: RegisteredPlacePresenceKind,
): Record<string, unknown> {
  return { placeKey, presenceKind: kind };
}

/** metadata(JSON 문자열 또는 객체)에서 이 알림이 가리키는 장소를 읽는다. 없으면 null. */
export function readPresenceScopeFromMetadata(
  metadata: unknown,
): { placeKey: string; kind: RegisteredPlacePresenceKind } | null {
  let parsed: unknown = metadata;
  if (typeof metadata === "string") {
    if (!metadata.trim()) return null;
    try {
      parsed = JSON.parse(metadata);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  const placeKey = typeof record.placeKey === "string" ? record.placeKey.trim() : "";
  const rawKind = typeof record.presenceKind === "string" ? record.presenceKind.trim() : "";
  if (!placeKey) return null;
  if (rawKind !== "arrived" && rawKind !== "left") return null;
  return { placeKey, kind: rawKind };
}

/**
 * event_id(결정적 멱등키) → (placeKey, kind) 역산 인덱스.
 * 같은 함수로 만든 키만 매칭되므로 다른 종류의 event_id 는 자연스럽게 미매칭(null)이다.
 */
export function buildRegisteredPlacePresenceKeyIndex(input: {
  childUserId: string;
  placeKeys: string[];
  nowMs: number;
  lookbackMs?: number;
  skewMs?: number;
}): Map<string, { placeKey: string; kind: RegisteredPlacePresenceKind }> {
  const index = new Map<string, { placeKey: string; kind: RegisteredPlacePresenceKind }>();
  const childUserId = String(input.childUserId || "");
  if (!childUserId || !Number.isFinite(input.nowMs)) return index;
  const lookbackMs = Number.isFinite(input.lookbackMs) ? Number(input.lookbackMs) : PRESENCE_EPISODE_LOOKBACK_MS;
  const skewMs = Number.isFinite(input.skewMs) ? Number(input.skewMs) : PRESENCE_EPISODE_SKEW_MS;
  const firstBucket = Math.floor((input.nowMs - lookbackMs) / EPISODE_BUCKET_MS);
  const lastBucket = Math.floor((input.nowMs + skewMs) / EPISODE_BUCKET_MS);
  const kinds: RegisteredPlacePresenceKind[] = ["arrived", "left"];
  for (const placeKey of new Set(input.placeKeys.filter(Boolean))) {
    for (const kind of kinds) {
      for (let bucket = firstBucket; bucket <= lastBucket; bucket++) {
        const key = placePresenceIdempotencyKey(kind, childUserId, placeKey, bucket) as string;
        if (!index.has(key)) index.set(key, { placeKey, kind });
      }
    }
  }
  return index;
}

/** 가족의 등록장소 place_key 목록(saved_places + academies). 좌표는 필요 없다. */
export async function loadFamilyRegisteredPlaceKeys(
  db: D1Database,
  familyId: string,
): Promise<string[]> {
  if (!familyId) return [];
  const keys: string[] = [];
  const saved = await db
    .prepare("SELECT id FROM saved_places WHERE family_id = ?")
    .bind(familyId)
    .all<{ id: string }>();
  for (const row of saved.results ?? []) keys.push(`registered:saved_place:${row.id}`);
  const academies = await db
    .prepare("SELECT id FROM academies WHERE family_id = ?")
    .bind(familyId)
    .all<{ id: string }>();
  for (const row of academies.results ?? []) keys.push(`registered:academy:${row.id}`);
  return keys;
}

export interface RegisteredPlacePresenceAlertRow {
  id: string;
  alert_type: string;
  event_id: string | null;
  metadata: unknown;
}

/**
 * 쿨다운 창 안에서 같은 (placeKey, kind) 알림을 찾는다. 순수 함수 — DB 행과 역산
 * 인덱스를 받아 판정만 하므로 단위 테스트가 쉽다.
 */
export function findDuplicatePresenceAlert(input: {
  rows: RegisteredPlacePresenceAlertRow[];
  placeKey: string;
  kind: RegisteredPlacePresenceKind;
  keyIndex: Map<string, { placeKey: string; kind: RegisteredPlacePresenceKind }>;
}): string | null {
  const placeKey = String(input.placeKey || "");
  if (!placeKey) return null;
  for (const row of input.rows) {
    const rowKind = registeredPlacePresenceKind(String(row.alert_type || ""));
    if (rowKind == null) continue;
    const scope = readPresenceScopeFromMetadata(row.metadata)
      ?? (row.event_id ? input.keyIndex.get(String(row.event_id)) ?? null : null);
    if (!scope) continue;
    if (scope.placeKey !== placeKey) continue;
    // metadata 가 있으면 그 kind 를, 없으면 alert_type 이 정본이다(둘은 항상 같아야 한다).
    if (scope.kind !== input.kind || rowKind !== input.kind) continue;
    const id = String(row.id || "");
    if (id) return id;
  }
  return null;
}

/**
 * 장소 출입 알림 중복 판정 — 두 발사 경로(네이티브 POST /api/parent-alerts, cron
 * deliverParentAlert)가 공통으로 호출한다.
 *
 * 반환:
 *   { placeKey, duplicateAlertId }  — duplicateAlertId 가 있으면 이번 알림은 만들지 않는다.
 *   null                            — 장소 출입 알림이 아니거나 장소를 특정할 수 없다(fail-open).
 *
 * fail-open 이유: 장소를 특정하지 못했다고 안전 알림을 막으면 유실이 된다. 특정 실패는
 * 구버전 event_id 형식이거나 장소가 방금 삭제된 경우이며, 그때는 기존 버킷 dedup 만 남는다.
 */
export async function resolveRegisteredPlacePresenceDedupe(
  db: D1Database,
  input: {
    familyId: string;
    childUserId: string | null;
    alertType: string;
    eventId: string | null;
    placeKey?: string | null;
    nowMs?: number;
    windowMs?: number;
  },
): Promise<{ placeKey: string; kind: RegisteredPlacePresenceKind; duplicateAlertId: string | null } | null> {
  const kind = registeredPlacePresenceKind(input.alertType);
  if (!kind) return null;
  const familyId = String(input.familyId || "");
  const childUserId = String(input.childUserId || "");
  if (!familyId || !childUserId) return null;

  const nowMs = Number.isFinite(input.nowMs) ? Number(input.nowMs) : Date.now();
  const windowMs = Number.isFinite(input.windowMs)
    ? Number(input.windowMs)
    : REGISTERED_PLACE_PRESENCE_DEDUPE_WINDOW_MS;

  const since = pgTs(new Date(nowMs - windowMs));
  const { results } = await db
    .prepare(
      `SELECT id, alert_type, event_id, metadata FROM parent_alerts
        WHERE family_id = ? AND child_user_id = ?
          AND alert_type IN ('place_arrived','place_left')
          AND created_at >= ?
        ORDER BY created_at DESC
        LIMIT 40`,
    )
    .bind(familyId, childUserId, since)
    .all<RegisteredPlacePresenceAlertRow>();
  const rows = results ?? [];

  // place_key 는 자녀 기기가 보낸 값이라 그대로 믿지 않는다. 이 가족의 실제 등록장소일
  // 때만 dedup 스코프로 쓰고, 아니면 event_id 역산으로 되돌린다(경계에서 검증).
  const placeKeys = await loadFamilyRegisteredPlaceKeys(db, familyId);
  const knownPlaceKeys = new Set(placeKeys);
  let placeKey = typeof input.placeKey === "string" ? input.placeKey.trim() : "";
  if (placeKey && !knownPlaceKeys.has(placeKey)) placeKey = "";

  let keyIndex = new Map<string, { placeKey: string; kind: RegisteredPlacePresenceKind }>();
  // 역산이 필요한 경우에만 인덱스를 만든다: 이번 요청이 신뢰할 place_key 를 주지 않았거나
  // (구버전 앱), 창 안의 기존 행이 metadata 없이 저장된 구버전 행일 때.
  const needsIndex = !placeKey || rows.some((row) => readPresenceScopeFromMetadata(row.metadata) == null);
  if (needsIndex && placeKeys.length) {
    keyIndex = buildRegisteredPlacePresenceKeyIndex({ childUserId, placeKeys, nowMs });
    if (!placeKey && input.eventId) {
      placeKey = keyIndex.get(String(input.eventId))?.placeKey ?? "";
    }
  }
  if (!placeKey) return null;

  const duplicateAlertId = findDuplicatePresenceAlert({ rows, placeKey, kind, keyIndex });
  return { placeKey, kind, duplicateAlertId };
}

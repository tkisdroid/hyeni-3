// 미등록 체류(도착·출발) 알림의 "지역 단위" 중복 억제 (2026-07-30 실사고 수정).
//
// 왜 필요한가 — `child_stay_presence` 는 dwell 좌표를 소수 4자리(≈11m) grid_key 로 쪼개
// 상태를 저장한다. 한 장소에 머무는 동안 GPS 지터가 11m 격자 경계를 넘으면 같은 체류가
// grid_key 2~4개로 갈라지고, 각 grid 가 **자기 에피소드를 열고 닫으며 각각 출발 알림을
// 발사**한다. 멱등키는 (child, gridKey, bucket) 이라 grid 가 다르면 전부 통과한다.
//
// 실사고(2026-07-29 저녁, 혜니): "🚶 과천동 국립과천과학관 근처 출발"이 20:45:55·20:46:00·
// 20:46:04·20:46:09(KST) 4건. D1 확인 — 같은 라벨의 grid_key 가 "37.2146,127.1007" /
// "37.2147,127.1007" 처럼 11m 차이로 여러 행 존재했다.
//
// 근본 수정 — 등록장소와 같은 방식으로 **지역 단위 쿨다운**으로 판정한다. 같은
// (family, child, 거친 지역키, kind) 알림이 창(10분) 안에 이미 있으면 두 번째는 만들지 않고
// 기존 alert id 를 돌려준다(호출부는 성공으로 보고 에피소드를 닫으므로 재시도 루프가 없다).
// 거친 지역키는 소수 3자리(≈110m)로 반올림해 11m 지터를 흡수한다 — 실제 다른 장소는
// 110m 이상 떨어져 있고, dwell 클러스터 반경(150m)보다 작다.
//
// 스키마 무변경: 신규 알림은 metadata 에 {stayAreaKey, stayKind} 를 남기고, 그 이전 행은
// 같은 alert_type + 같은 제목(지역 라벨이 들어간 문구)으로 역산한다. 따라서 앱 재배포 없이
// 서버 배포만으로 중복이 멎는다.
import { pgTs } from "./time.ts";

export type UnregisteredStayKind = "arrived" | "left";

/** 체류 출입 알림의 쿨다운 창 — 등록장소(10분)와 동일. */
export const UNREGISTERED_STAY_DEDUPE_WINDOW_MS = 10 * 60_000;

/** 거친 지역키의 좌표 자리수(3자리 ≈ 110m). */
const COARSE_AREA_DECIMALS = 3;

export function unregisteredStayKind(alertType: string): UnregisteredStayKind | null {
  const t = String(alertType || "").trim();
  if (t === "unregistered_stay") return "arrived";
  if (t === "unregistered_stay_left") return "left";
  return null;
}

/** grid_key("37.2146,127.1007") → 거친 지역키("37.215,127.101"). 파싱 실패면 null. */
export function coarseStayAreaKey(gridKey: string): string | null {
  const parts = String(gridKey || "").split(",");
  if (parts.length !== 2) return null;
  const lat = Number(parts[0]);
  const lng = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return `${lat.toFixed(COARSE_AREA_DECIMALS)},${lng.toFixed(COARSE_AREA_DECIMALS)}`;
}

export function unregisteredStayMetadata(
  areaKey: string,
  kind: UnregisteredStayKind,
): Record<string, unknown> {
  return { stayAreaKey: areaKey, stayKind: kind };
}

/** metadata(JSON 문자열 또는 객체)에서 이 알림의 체류 지역 스코프를 읽는다. */
export function readStayScopeFromMetadata(
  metadata: unknown,
): { areaKey: string; kind: UnregisteredStayKind } | null {
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
  const areaKey = typeof record.stayAreaKey === "string" ? record.stayAreaKey.trim() : "";
  const rawKind = typeof record.stayKind === "string" ? record.stayKind.trim() : "";
  if (!areaKey) return null;
  if (rawKind !== "arrived" && rawKind !== "left") return null;
  return { areaKey, kind: rawKind };
}

export interface UnregisteredStayAlertRow {
  id: string;
  alert_type: string;
  title: string | null;
  metadata: unknown;
}

/**
 * 쿨다운 창 안에서 같은 지역·같은 종류의 알림을 찾는다(순수 함수).
 * 1순위 = metadata 의 거친 지역키, 2순위(구버전 행) = 같은 제목.
 */
export function findDuplicateStayAlert(input: {
  rows: UnregisteredStayAlertRow[];
  areaKey: string;
  kind: UnregisteredStayKind;
  title: string;
}): string | null {
  const areaKey = String(input.areaKey || "");
  const title = String(input.title || "").trim();
  for (const row of input.rows) {
    const rowKind = unregisteredStayKind(String(row.alert_type || ""));
    if (rowKind !== input.kind) continue;
    const scope = readStayScopeFromMetadata(row.metadata);
    const sameArea = scope ? scope.areaKey === areaKey && scope.kind === input.kind : false;
    const sameTitle = !scope && !!title && String(row.title || "").trim() === title;
    if (!sameArea && !sameTitle) continue;
    const id = String(row.id || "");
    if (id) return id;
  }
  return null;
}

/**
 * 미등록 체류 알림 중복 판정 — cron `deliverParentAlert` 공통 합류점에서 호출한다.
 *
 * 반환:
 *   { areaKey, kind, duplicateAlertId } — duplicateAlertId 가 있으면 이번 알림은 만들지 않는다.
 *   null — 체류 알림이 아니거나 지역을 특정할 수 없다(fail-open: 안전 알림 우선).
 */
export async function resolveUnregisteredStayDedupe(
  db: D1Database,
  input: {
    familyId: string;
    childUserId: string | null;
    alertType: string;
    gridKey?: string | null;
    title?: string | null;
    nowMs?: number;
    windowMs?: number;
  },
): Promise<{ areaKey: string; kind: UnregisteredStayKind; duplicateAlertId: string | null } | null> {
  const kind = unregisteredStayKind(input.alertType);
  if (!kind) return null;
  const familyId = String(input.familyId || "");
  const childUserId = String(input.childUserId || "");
  if (!familyId || !childUserId) return null;
  const areaKey = coarseStayAreaKey(String(input.gridKey || ""));
  if (!areaKey) return null;

  const nowMs = Number.isFinite(input.nowMs) ? Number(input.nowMs) : Date.now();
  const windowMs = Number.isFinite(input.windowMs)
    ? Number(input.windowMs)
    : UNREGISTERED_STAY_DEDUPE_WINDOW_MS;
  const since = pgTs(new Date(nowMs - windowMs));

  const { results } = await db
    .prepare(
      `SELECT id, alert_type, title, metadata FROM parent_alerts
        WHERE family_id = ? AND child_user_id = ?
          AND alert_type IN ('unregistered_stay','unregistered_stay_left')
          AND created_at >= ?
        ORDER BY created_at DESC
        LIMIT 40`,
    )
    .bind(familyId, childUserId, since)
    .all<UnregisteredStayAlertRow>();

  const duplicateAlertId = findDuplicateStayAlert({
    rows: results ?? [],
    areaKey,
    kind,
    title: String(input.title || ""),
  });
  return { areaKey, kind, duplicateAlertId };
}

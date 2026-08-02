// 앱의 가장 큰 반복 확장(요일 8주)이 56개다. 이보다 크게 받으면 검증 쿼리까지
// 포함한 D1 invocation statement 수가 불필요하게 커지므로 서버에서도 같은 상한을 둔다.
const EVENT_BATCH_MAX_INPUTS = 56;
const EVENT_BATCH_QUERY_CHUNK = 90;

export function normalizeEventTimeForResponse(value: unknown): string | null {
  if (value == null || value === "") return null;
  return String(value);
}

export interface RawEventWriteInput {
  event?: Record<string, unknown>;
  childIds?: unknown;
  familyAll?: unknown;
  expectedUpdatedAt?: unknown;
}

export interface ExistingEventState {
  id: string;
  family_id: string;
  updated_at: string | null;
  created_by: string | null;
  created_at: string | null;
}

export interface ValidatedEventWrite {
  event: Record<string, unknown>;
  id: string;
  familyId: string;
  childIds: string[];
  familyAll: boolean;
  expectedUpdatedAt: string | null;
  existing: ExistingEventState | null;
}

export interface ValidatedEventBatch {
  familyId: string;
  inputs: ValidatedEventWrite[];
  currentCount: number;
  newCount: number;
  limit: number | null;
}

export interface EventBatchValidationDependencies {
  assertPrimaryParent: (db: D1Database, userId: string, familyId: string) => Promise<boolean>;
  serviceLimitForFamily: (db: D1Database, familyId: string) => Promise<number | null>;
}

export class EventBatchError extends Error {
  readonly status: number;
  readonly code: string;
  readonly limit?: number;
  readonly count?: number;

  constructor(
    status: number,
    code: string,
    message: string,
    details: { limit?: number; count?: number } = {},
  ) {
    super(message);
    this.name = "EventBatchError";
    this.status = status;
    this.code = code;
    this.limit = details.limit;
    this.count = details.count;
  }
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function badRequest(code: string, message: string): never {
  throw new EventBatchError(400, code, message);
}

function normalizeEventDateKey(value: unknown): string {
  if (typeof value !== "string") badRequest("invalid_date_key", "일정 날짜가 올바르지 않아요.");
  const normalized = value.trim();
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(normalized);
  if (!match) badRequest("invalid_date_key", "일정 날짜가 올바르지 않아요.");
  const year = Number(match[1]);
  const monthIndex = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1000 || monthIndex < 0 || monthIndex > 11 || day < 1) {
    badRequest("invalid_date_key", "일정 날짜가 올바르지 않아요.");
  }
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  if (day > daysInMonth) badRequest("invalid_date_key", "일정 날짜가 올바르지 않아요.");
  return `${year}-${monthIndex}-${day}`;
}

function normalizeEventTime(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") badRequest("invalid_event_time", "일정 시간이 올바르지 않아요.");
  const normalized = value.trim();
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(normalized)) {
    badRequest("invalid_event_time", "일정 시간이 올바르지 않아요.");
  }
  return normalized;
}

function normalizeEventLocation(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    badRequest("invalid_event_location", "일정 장소가 올바르지 않아요.");
  }
  const location = value as Record<string, unknown>;
  const hasLat = Object.prototype.hasOwnProperty.call(location, "lat");
  const hasLng = Object.prototype.hasOwnProperty.call(location, "lng");
  if (hasLat !== hasLng) badRequest("invalid_event_location", "장소 좌표는 위도와 경도가 모두 필요해요.");

  const normalized: Record<string, unknown> = { ...location };
  if (hasLat && hasLng) {
    if (
      typeof location.lat !== "number"
      || typeof location.lng !== "number"
      || !Number.isFinite(location.lat)
      || !Number.isFinite(location.lng)
      || location.lat < -90
      || location.lat > 90
      || location.lng < -180
      || location.lng > 180
    ) {
      badRequest("invalid_event_location", "일정 장소 좌표가 올바르지 않아요.");
    }
    normalized.lat = location.lat;
    normalized.lng = location.lng;
  }

  if (Object.prototype.hasOwnProperty.call(location, "address")) {
    if (typeof location.address !== "string") {
      badRequest("invalid_event_location", "일정 장소 주소가 올바르지 않아요.");
    }
    const address = location.address.trim();
    if (address) normalized.address = address;
    else delete normalized.address;
  }
  if (!hasLat && typeof normalized.address !== "string") {
    badRequest("invalid_event_location", "좌표가 없는 장소에는 주소가 필요해요.");
  }
  return normalized;
}

function normalizeNotifOverride(value: unknown): { minutesBefore: number[] } | null {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    badRequest("invalid_notif_override", "사전 알림 설정이 올바르지 않아요.");
  }
  const minutesBefore = (value as { minutesBefore?: unknown }).minutesBefore;
  if (!Array.isArray(minutesBefore)) {
    badRequest("invalid_notif_override", "사전 알림 시간 목록이 필요해요.");
  }
  if (!minutesBefore.every((minute) => Number.isInteger(minute) && minute > 0 && minute <= 24 * 60)) {
    badRequest("invalid_notif_override", "사전 알림 시간은 1분부터 24시간 전까지 지정할 수 있어요.");
  }
  return { minutesBefore: [...new Set(minutesBefore as number[])] };
}

function normalizeEventWriteFields(
  event: Record<string, unknown>,
  id: string,
  familyId: string,
): Record<string, unknown> {
  if (typeof event.title !== "string" || !event.title.trim()) {
    badRequest("invalid_event_title", "일정 제목을 입력해 주세요.");
  }
  return {
    ...event,
    id,
    family_id: familyId,
    date_key: normalizeEventDateKey(event.date_key),
    title: event.title.trim(),
    time: normalizeEventTime(event.time),
    end_time: normalizeEventTime(event.end_time),
    location: normalizeEventLocation(event.location),
    notif_override: normalizeNotifOverride(event.notif_override),
  };
}

function normalizeInputs(rawInputs: unknown): Omit<ValidatedEventWrite, "existing">[] {
  if (!Array.isArray(rawInputs) || rawInputs.length === 0) {
    badRequest("empty_event_batch", "저장할 일정이 없어요.");
  }
  if (rawInputs.length > EVENT_BATCH_MAX_INPUTS) {
    badRequest("event_batch_too_large", `일정은 한 번에 ${EVENT_BATCH_MAX_INPUTS}개까지 저장할 수 있어요.`);
  }

  const seenIds = new Set<string>();
  const normalized: Omit<ValidatedEventWrite, "existing">[] = [];
  for (const raw of rawInputs) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      badRequest("invalid_event_input", "일정 저장 형식이 올바르지 않아요.");
    }
    const input = raw as RawEventWriteInput;
    if (!input.event || typeof input.event !== "object" || Array.isArray(input.event)) {
      badRequest("invalid_event_input", "일정 정보가 올바르지 않아요.");
    }
    const rawEvent = input.event;
    const id = String(rawEvent.id ?? "").trim();
    const familyId = String(rawEvent.family_id ?? "").trim();
    if (!id || !familyId) badRequest("invalid_event_input", "일정 id와 가족 정보가 필요해요.");
    if (seenIds.has(id)) badRequest("duplicate_event_id", "같은 일정 id가 한 요청에 두 번 들어왔어요.");
    seenIds.add(id);

    if (input.childIds != null && !Array.isArray(input.childIds)) {
      badRequest("invalid_child_assignment", "아이 배정 정보가 올바르지 않아요.");
    }
    const childIds = [
      ...new Set(
        (Array.isArray(input.childIds) ? input.childIds : [])
          .map((value) => String(value ?? "").trim())
          .filter(Boolean),
      ),
    ];

    let expectedUpdatedAt: string | null = null;
    if (input.expectedUpdatedAt != null) {
      if (typeof input.expectedUpdatedAt !== "string" || !input.expectedUpdatedAt.trim()) {
        badRequest("invalid_expected_updated_at", "일정 수정 기준 시각이 올바르지 않아요.");
      }
      expectedUpdatedAt = input.expectedUpdatedAt.trim();
    }

    const event = normalizeEventWriteFields(rawEvent, id, familyId);

    normalized.push({
      event,
      id,
      familyId,
      childIds,
      familyAll: input.familyAll === true || childIds.length === 0,
      expectedUpdatedAt,
    });
  }
  return normalized;
}

async function loadExistingEvents(
  db: D1Database,
  ids: readonly string[],
): Promise<Map<string, ExistingEventState>> {
  const byId = new Map<string, ExistingEventState>();
  for (const chunk of chunks(ids, EVENT_BATCH_QUERY_CHUNK)) {
    const placeholders = chunk.map(() => "?").join(",");
    const { results } = await db
      .prepare(
        `SELECT id, family_id, updated_at, created_by, created_at
           FROM events WHERE id IN (${placeholders})`,
      )
      .bind(...chunk)
      .all<ExistingEventState>();
    for (const row of results ?? []) byId.set(String(row.id), row);
  }
  return byId;
}

async function validateActiveChildren(
  db: D1Database,
  familyId: string,
  childIds: readonly string[],
): Promise<void> {
  const valid = new Set<string>();
  for (const chunk of chunks(childIds, EVENT_BATCH_QUERY_CHUNK)) {
    const placeholders = chunk.map(() => "?").join(",");
    const { results } = await db
      .prepare(
        `SELECT id FROM family_members
          WHERE family_id = ? AND role = 'child' AND is_active = 1
            AND id IN (${placeholders})`,
      )
      .bind(familyId, ...chunk)
      .all<{ id: string }>();
    for (const row of results ?? []) valid.add(String(row.id));
  }
  if (valid.size !== childIds.length) {
    throw new EventBatchError(400, "invalid_child_assignment", "현재 가족의 활성 아이만 일정에 배정할 수 있어요.");
  }
}

/**
 * 한 가족의 일정 묶음을 저장 전에 전부 검증한다. 이 함수가 반환되기 전에는 write를
 * 시작하지 않아 잘못된 자녀·타가족 id·플랜 초과 요청이 부분 저장되지 않는다.
 */
export async function validateEventBatch(
  db: D1Database,
  userId: string,
  rawInputs: unknown,
  dependencies: EventBatchValidationDependencies,
): Promise<ValidatedEventBatch> {
  const normalized = normalizeInputs(rawInputs);
  const familyIds = new Set(normalized.map((input) => input.familyId));
  if (familyIds.size !== 1) {
    badRequest("mixed_family_batch", "한 번의 요청에는 한 가족의 일정만 저장할 수 있어요.");
  }
  const familyId = normalized[0].familyId;
  if (!(await dependencies.assertPrimaryParent(db, userId, familyId))) {
    throw new EventBatchError(403, "forbidden", "일정을 저장할 권한이 없어요.");
  }

  const existingById = await loadExistingEvents(db, normalized.map((input) => input.id));
  const inputs: ValidatedEventWrite[] = normalized.map((input) => {
    const existing = existingById.get(input.id) ?? null;
    if (existing && String(existing.family_id) !== familyId) {
      throw new EventBatchError(409, "event_id_conflict", "다른 가족이 사용 중인 일정 id예요.");
    }
    if (
      input.expectedUpdatedAt &&
      (!existing || String(existing.updated_at ?? "") !== input.expectedUpdatedAt)
    ) {
      throw new EventBatchError(409, "concurrent_modification", "일정이 다른 곳에서 변경되었어요. 다시 불러와 주세요.");
    }
    return { ...input, existing };
  });

  const childIds = [...new Set(inputs.flatMap((input) => input.childIds))];
  if (childIds.length > 0) await validateActiveChildren(db, familyId, childIds);

  const current = await db
    .prepare("SELECT COUNT(*) AS n FROM events WHERE family_id = ?")
    .bind(familyId)
    .first<{ n: number }>();
  const currentCount = Number(current?.n ?? 0);
  const newCount = inputs.filter((input) => !input.existing).length;
  const limit = await dependencies.serviceLimitForFamily(db, familyId);
  const countAfterWrite = currentCount + newCount;
  if (limit != null && countAfterWrite > limit) {
    throw new EventBatchError(
      403,
      "schedule_limit_reached",
      `현재 플랜에서는 일정 ${limit}개까지 저장할 수 있어요.`,
      { limit, count: countAfterWrite },
    );
  }

  return { familyId, inputs, currentCount, newCount, limit };
}

function serializeJson(value: unknown): string | null {
  return value == null ? null : JSON.stringify(value);
}

function textOrEmpty(value: unknown): string {
  return value == null ? "" : String(value);
}

function textOrNull(value: unknown): string | null {
  return value == null ? null : String(value);
}

function timestampMs(value: string | null | undefined): number {
  if (!value) return Number.NaN;
  let normalized = value.replace(" ", "T");
  if (/[+-]\d{2}$/.test(normalized)) normalized += ":00";
  else if (!normalized.endsWith("Z") && !/[+-]\d{2}:\d{2}$/.test(normalized)) normalized += "Z";
  return Date.parse(normalized);
}

function monotonicUpdatedAt(previous: string | null, candidate: string): string {
  const previousMs = timestampMs(previous);
  const candidateMs = timestampMs(candidate);
  if (!Number.isFinite(previousMs) || !Number.isFinite(candidateMs) || candidateMs > previousMs) {
    return candidate;
  }
  return new Date(previousMs + 1).toISOString().replace("T", " ").replace("Z", "+00");
}

function atomicGuard(db: D1Database, conditionSql: string, bindings: unknown[]): D1PreparedStatement {
  // D1 batch는 한 statement라도 실패하면 전체를 rollback한다. json_extract의 invalid JSON
  // 오류를 조건 불일치 때만 평가해, 검증과 write 사이에 끼어든 편집·삭제도 부분 저장 없이 막는다.
  return db
    .prepare(
      `SELECT CASE WHEN (${conditionSql})
        THEN 1 ELSE json_extract('event_batch_conflict', '$') END AS ok`,
    )
    .bind(...bindings);
}

/** 검증 완료된 일정 묶음을 한 번의 D1Database.batch에 넣을 statement 배열로 만든다. */
export function buildEventBatchStatements(
  db: D1Database,
  userId: string,
  batch: ValidatedEventBatch,
  now: string,
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];

  // 검증과 write 사이에 주 보호자 권한이 바뀌어도 이전 권한으로 저장하지 않는다.
  statements.push(atomicGuard(
    db,
    "EXISTS(SELECT 1 FROM families WHERE id = ? AND parent_id = ?)",
    [batch.familyId, userId],
  ));

  const assignedChildIds = [...new Set(batch.inputs.flatMap((input) => input.childIds))];
  for (const group of chunks(assignedChildIds, EVENT_BATCH_QUERY_CHUNK - 2)) {
    const placeholders = group.map(() => "?").join(",");
    statements.push(atomicGuard(
      db,
      `(SELECT COUNT(DISTINCT id) FROM family_members
         WHERE family_id = ? AND role = 'child' AND is_active = 1
           AND id IN (${placeholders})) = ?`,
      [batch.familyId, ...group, group.length],
    ));
  }

  if (batch.limit != null) {
    statements.push(atomicGuard(
      db,
      `(SELECT COUNT(*) FROM events WHERE family_id = ?) + ? <= ?`,
      [batch.familyId, batch.newCount, batch.limit],
    ));
  }
  // D1 bind 변수(문장당 100개 미만)와 invocation query 상한을 함께 지키도록
  // guard·upsert·링크·알림 취소를 다중 행 SQL로 묶는다.
  for (const group of chunks(batch.inputs, 25)) {
    const conditions: string[] = [];
    const bindings: unknown[] = [];
    for (const input of group) {
      if (input.existing) {
        conditions.push(`EXISTS(
          SELECT 1 FROM events
           WHERE id = ? AND family_id = ? AND updated_at IS ?
        )`);
        bindings.push(input.id, input.familyId, input.existing.updated_at);
      } else {
        conditions.push("NOT EXISTS(SELECT 1 FROM events WHERE id = ?)");
        bindings.push(input.id);
      }
    }
    statements.push(atomicGuard(db, conditions.join(" AND "), bindings));
  }

  const sqlRows = batch.inputs.map((input) => {
    const event = input.event;
    return [
      input.id,
      input.familyId,
      textOrEmpty(event.date_key),
      textOrEmpty(event.title),
      textOrEmpty(event.time),
      textOrEmpty(event.category),
      textOrEmpty(event.emoji),
      textOrEmpty(event.color),
      textOrEmpty(event.bg),
      textOrEmpty(event.memo),
      serializeJson(event.location),
      serializeJson(event.notif_override),
      textOrNull(event.end_time),
      input.familyAll ? 1 : 0,
      textOrNull(event.series_id),
      userId,
      input.existing?.created_at ?? now,
      monotonicUpdatedAt(input.existing?.updated_at ?? null, now),
    ];
  });
  for (const group of chunks(sqlRows, 5)) {
    const valueSql = group.map(() => `(${Array.from({ length: 18 }, () => "?").join(",")})`).join(",");
    statements.push(db.prepare(
      `INSERT INTO events
        (id, family_id, date_key, title, time, category, emoji, color, bg, memo,
         location, notif_override, end_time, is_family_event, series_id,
         created_by, created_at, updated_at)
       VALUES ${valueSql}
       ON CONFLICT(id) DO UPDATE SET
         date_key=excluded.date_key, title=excluded.title, time=excluded.time,
         category=excluded.category, emoji=excluded.emoji, color=excluded.color,
         bg=excluded.bg, memo=excluded.memo, location=excluded.location,
         notif_override=excluded.notif_override, end_time=excluded.end_time,
         is_family_event=excluded.is_family_event, series_id=excluded.series_id,
         updated_at=excluded.updated_at`,
    ).bind(...group.flat()));
  }

  const eventIds = batch.inputs.map((input) => input.id);
  for (const group of chunks(eventIds, EVENT_BATCH_QUERY_CHUNK)) {
    const placeholders = group.map(() => "?").join(",");
    statements.push(
      db.prepare(`DELETE FROM events_children WHERE event_id IN (${placeholders})`).bind(...group),
    );
  }

  const links = batch.inputs.flatMap((input) => input.familyAll
    ? []
    : input.childIds.map((childId) => [input.id, childId]));
  for (const group of chunks(links, 45)) {
    const valueSql = group.map(() => "(?,?)").join(",");
    statements.push(
      db.prepare(`INSERT INTO events_children (event_id, child_id) VALUES ${valueSql}`)
        .bind(...group.flat()),
    );
  }

  for (const group of chunks(eventIds, Math.floor((EVENT_BATCH_QUERY_CHUNK - 1) / 2))) {
    const placeholders = group.map(() => "?").join(",");
    statements.push(db.prepare(
      `DELETE FROM pending_notifications
        WHERE family_id = ?
          AND (
            CASE WHEN json_valid(data) THEN json_extract(data, '$.eventId') ELSE NULL END
              IN (${placeholders})
            OR CASE WHEN json_valid(data) THEN json_extract(data, '$.event_id') ELSE NULL END
              IN (${placeholders})
          )`,
    ).bind(batch.familyId, ...group, ...group));
  }
  for (const group of chunks(eventIds, EVENT_BATCH_QUERY_CHUNK)) {
    const placeholders = group.map(() => "?").join(",");
    statements.push(db.prepare(`DELETE FROM push_sent WHERE event_id IN (${placeholders})`).bind(...group));
  }

  return statements;
}

export interface EventDeleteTarget {
  id: string;
  familyId: string;
  expectedUpdatedAt: string | null;
}

/** 일정과 종속 자녀 링크·예약 알림·발송 claim을 같은 D1 batch에서 삭제한다. */
export function buildEventDeleteStatements(
  db: D1Database,
  target: EventDeleteTarget,
): D1PreparedStatement[] {
  const guardSql = target.expectedUpdatedAt == null
    ? "EXISTS(SELECT 1 FROM events WHERE id = ? AND family_id = ?)"
    : "EXISTS(SELECT 1 FROM events WHERE id = ? AND family_id = ? AND updated_at IS ?)";
  const guardBindings = target.expectedUpdatedAt == null
    ? [target.id, target.familyId]
    : [target.id, target.familyId, target.expectedUpdatedAt];

  return [
    atomicGuard(db, guardSql, guardBindings),
    db.prepare(
      `DELETE FROM pending_notifications
        WHERE family_id = ?
          AND (
            CASE WHEN json_valid(data) THEN json_extract(data, '$.eventId') ELSE NULL END = ?
            OR CASE WHEN json_valid(data) THEN json_extract(data, '$.event_id') ELSE NULL END = ?
          )`,
    ).bind(target.familyId, target.id, target.id),
    db.prepare("DELETE FROM push_sent WHERE event_id = ?").bind(target.id),
    db.prepare("DELETE FROM events_children WHERE event_id = ?").bind(target.id),
    db.prepare("DELETE FROM events WHERE id = ? AND family_id = ?").bind(target.id, target.familyId),
  ];
}

export type EventBatchConflictKind =
  | "forbidden"
  | "invalid_child_assignment"
  | "schedule_limit"
  | "concurrent_modification"
  | null;

/** 조건부 batch guard가 실패했을 때 사용자에게 돌려줄 원인을 읽기 전용으로 판별한다. */
export async function detectEventBatchConflict(
  db: D1Database,
  userId: string,
  batch: ValidatedEventBatch,
): Promise<EventBatchConflictKind> {
  const owner = await db
    .prepare("SELECT 1 AS ok FROM families WHERE id = ? AND parent_id = ? LIMIT 1")
    .bind(batch.familyId, userId)
    .first<{ ok: number }>();
  if (!owner) return "forbidden";

  const assignedChildIds = [...new Set(batch.inputs.flatMap((input) => input.childIds))];
  try {
    if (assignedChildIds.length > 0) await validateActiveChildren(db, batch.familyId, assignedChildIds);
  } catch (error) {
    if (error instanceof EventBatchError && error.code === "invalid_child_assignment") {
      return "invalid_child_assignment";
    }
    throw error;
  }

  if (batch.limit != null) {
    const row = await db
      .prepare("SELECT COUNT(*) AS n FROM events WHERE family_id = ?")
      .bind(batch.familyId)
      .first<{ n: number }>();
    if (Number(row?.n ?? 0) + batch.newCount > batch.limit) return "schedule_limit";
  }

  const currentById = await loadExistingEvents(db, batch.inputs.map((input) => input.id));
  for (const input of batch.inputs) {
    const current = currentById.get(input.id) ?? null;
    if (!input.existing) {
      if (current) return "concurrent_modification";
      continue;
    }
    if (
      !current ||
      current.family_id !== input.familyId ||
      current.updated_at !== input.existing.updated_at
    ) {
      return "concurrent_modification";
    }
  }
  return null;
}

export function isAtomicEventBatchGuardError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("malformed JSON") || message.includes("event_batch_conflict");
}

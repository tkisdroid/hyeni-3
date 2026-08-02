type PgEvent = "INSERT" | "UPDATE" | "DELETE";

type Row = Record<string, unknown>;

interface ActiveRealtimeUser {
  user_id: string;
  role: "parent" | "child";
}

export interface BuildRealtimePgEnvelopeInput {
  familyId: string;
  table: string;
  eventType: PgEvent;
  newRow: unknown;
  oldRow: unknown;
  targetUserIds?: readonly string[];
}

export interface RealtimePgEnvelope {
  kind: "pg";
  table: string;
  eventType: PgEvent;
  new: Row | null;
  old: Row | null;
  targetUserIds: string[];
}

function asRow(value: unknown): Row | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Row
    : null;
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function rowString(newRow: Row | null, oldRow: Row | null, key: string): string | null {
  return nonEmptyString(newRow?.[key]) ?? nonEmptyString(oldRow?.[key]);
}

function pick(row: Row | null, keys: readonly string[]): Row | null {
  if (!row) return null;
  const out: Row = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key)) out[key] = row[key];
  }
  return out;
}

function realtimeRow(table: string, row: Row | null): Row | null {
  switch (table) {
    case "parent_alerts":
      return pick(row, ["id", "family_id", "alert_type", "child_user_id"]);
    case "child_locations":
      return pick(row, ["family_id", "user_id", "updated_at"]);
    case "memo_replies":
      return pick(row, ["id", "family_id", "date_key", "child_id", "user_id"]);
    case "notification_settings":
      return pick(row, ["family_id", "user_id"]);
    case "stickers":
      return pick(row, ["id", "family_id", "user_id", "sticker_type", "emoji", "title"]);
    case "family_members":
      return pick(row, ["id", "family_id", "user_id", "role", "is_active"]);
    default:
      // 현재 클라이언트는 대부분 table 이름으로 query cache만 무효화한다. 원문 행을
      // 가족 전체 소켓에 복제하지 않고 식별자만 보내도 정본 GET 흐름은 유지된다.
      return pick(row, ["id", "family_id"]);
  }
}

export async function listActiveRealtimeUsers(
  db: D1Database,
  familyId: string,
): Promise<ActiveRealtimeUser[]> {
  const { results } = await db
    .prepare(
      `SELECT user_id, role
         FROM family_members
        WHERE family_id = ?1
          AND user_id IS NOT NULL
          AND is_active = 1
          AND role IN ('parent', 'child')
       UNION
       SELECT parent_id AS user_id, 'parent' AS role
         FROM families
        WHERE id = ?1 AND parent_id IS NOT NULL`,
    )
    .bind(familyId)
    .all<ActiveRealtimeUser>();
  const users = new Map<string, ActiveRealtimeUser>();
  for (const row of results ?? []) {
    const userId = nonEmptyString(row.user_id);
    if (!userId || (row.role !== "parent" && row.role !== "child")) continue;
    const previous = users.get(userId);
    // families.parent_id 정본은 membership role보다 우선한다.
    if (!previous || row.role === "parent") users.set(userId, { user_id: userId, role: row.role });
  }
  return [...users.values()];
}

async function activeChildUserForMember(
  db: D1Database,
  familyId: string,
  childMemberId: string | null,
): Promise<string | null> {
  if (!childMemberId) return null;
  const child = await db
    .prepare(
      `SELECT user_id FROM family_members
        WHERE family_id = ? AND id = ? AND role = 'child' AND is_active = 1
          AND user_id IS NOT NULL
        LIMIT 1`,
    )
    .bind(familyId, childMemberId)
    .first<{ user_id: string }>();
  return nonEmptyString(child?.user_id);
}

function uniqueUserIds(ids: Iterable<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of ids) {
    const userId = nonEmptyString(value);
    if (!userId || seen.has(userId)) continue;
    seen.add(userId);
    out.push(userId);
  }
  return out;
}

export async function buildRealtimePgEnvelope(
  db: D1Database,
  input: BuildRealtimePgEnvelopeInput,
): Promise<RealtimePgEnvelope> {
  const newRow = asRow(input.newRow);
  const oldRow = asRow(input.oldRow);
  const activeUsers = await listActiveRealtimeUsers(db, input.familyId);
  const activeIds = new Set(activeUsers.map((row) => row.user_id));
  const parents = activeUsers.filter((row) => row.role === "parent").map((row) => row.user_id);
  const activeChildIds = new Set(
    activeUsers.filter((row) => row.role === "child").map((row) => row.user_id),
  );

  let targetUserIds: string[];
  if (input.targetUserIds) {
    targetUserIds = uniqueUserIds(input.targetUserIds).filter((userId) => activeIds.has(userId));
  } else {
    switch (input.table) {
      case "parent_alerts":
      case "ai_credit_balances":
        targetUserIds = parents;
        break;
      case "child_locations": {
        const childUserId = rowString(newRow, oldRow, "user_id");
        targetUserIds = uniqueUserIds([
          ...parents,
          childUserId && activeChildIds.has(childUserId) ? childUserId : null,
        ]);
        break;
      }
      case "memo_replies":
      case "daily_supplies": {
        const childMemberId = rowString(newRow, oldRow, "child_id")
          ?? rowString(newRow, oldRow, "child_user_id");
        const childUserId = await activeChildUserForMember(db, input.familyId, childMemberId);
        targetUserIds = uniqueUserIds([...parents, childUserId]);
        break;
      }
      case "stickers":
      case "notification_settings": {
        const targetUserId = rowString(newRow, oldRow, "user_id");
        targetUserIds = uniqueUserIds([
          ...parents,
          targetUserId && activeIds.has(targetUserId) ? targetUserId : null,
        ]);
        break;
      }
      case "force_ring_events": {
        const targetUserId = rowString(newRow, oldRow, "target_user_id");
        targetUserIds = uniqueUserIds([
          ...parents,
          targetUserId && activeChildIds.has(targetUserId) ? targetUserId : null,
        ]);
        break;
      }
      default:
        targetUserIds = activeUsers.map((row) => row.user_id);
        break;
    }
  }

  return {
    kind: "pg",
    table: input.table,
    eventType: input.eventType,
    new: realtimeRow(input.table, newRow),
    old: realtimeRow(input.table, oldRow),
    targetUserIds,
  };
}

export async function resolveRealtimeBroadcastAudience(
  db: D1Database,
  familyId: string,
  options: { childUserId?: string | null; targetUserIds?: readonly string[] } = {},
): Promise<string[]> {
  const activeUsers = await listActiveRealtimeUsers(db, familyId);
  const activeIds = new Set(activeUsers.map((row) => row.user_id));
  if (options.targetUserIds) {
    return uniqueUserIds(options.targetUserIds).filter((userId) => activeIds.has(userId));
  }
  const childUserId = nonEmptyString(options.childUserId);
  return uniqueUserIds([
    ...activeUsers.filter((row) => row.role === "parent").map((row) => row.user_id),
    childUserId && activeUsers.some((row) => row.user_id === childUserId && row.role === "child")
      ? childUserId
      : null,
  ]);
}

/** 아이 AI 친구가 만든 일정의 D1 저장과 실시간 발행을 한 경계에서 보장한다. */
export type AiChildScheduleEventRow = {
  id: string;
  family_id: string;
  date_key: string;
  title: string;
  time: string;
  category: string;
  emoji: string;
  color: string;
  bg: string;
  memo?: string | null;
  location?: unknown;
  notif_override?: unknown;
  end_time?: string | null;
  is_family_event?: boolean;
  created_by: string;
};

export type StoredAiChildScheduleRow = AiChildScheduleEventRow & {
  memo: string;
  location: unknown | null;
  notif_override: unknown | null;
  end_time: string | null;
  is_family_event: boolean;
  created_at: string;
  updated_at: string;
  events_children: Array<{ child_id: string }>;
};

type PersistAiChildScheduleInput = {
  eventRow: AiChildScheduleEventRow;
  childMemberId: string;
  timestamp: string;
};

type NotifyCreated = (row: StoredAiChildScheduleRow) => Promise<void>;

export class AiChildSchedulePersistenceError extends Error {
  readonly code = "schedule_create_failed";

  constructor(cause?: unknown) {
    super("schedule_create_failed", { cause });
    this.name = "AiChildSchedulePersistenceError";
  }
}

function jsonColumn(value: unknown): string | null {
  return value == null ? null : JSON.stringify(value);
}

/**
 * event와 events_children을 한 D1 batch로 확정한다. 실시간 발행은 저장 뒤 best-effort로
 * 실행해, 일시적인 WebSocket 장애가 이미 저장된 일정을 실패로 보이게 만들지 않는다.
 */
export async function persistAiChildSchedule(
  db: D1Database,
  input: PersistAiChildScheduleInput,
  notifyCreated: NotifyCreated,
): Promise<StoredAiChildScheduleRow> {
  const { eventRow, childMemberId, timestamp } = input;
  if (!eventRow?.id || !eventRow.family_id || !childMemberId || !timestamp) {
    throw new AiChildSchedulePersistenceError();
  }

  const eventInsert = db
    .prepare(
      "INSERT INTO events (id, family_id, date_key, title, time, category, emoji, color, bg, memo, location, notif_override, end_time, is_family_event, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .bind(
      eventRow.id,
      eventRow.family_id,
      eventRow.date_key,
      eventRow.title,
      eventRow.time,
      eventRow.category,
      eventRow.emoji,
      eventRow.color,
      eventRow.bg,
      eventRow.memo ?? "",
      jsonColumn(eventRow.location),
      jsonColumn(eventRow.notif_override),
      eventRow.end_time || null,
      eventRow.is_family_event ? 1 : 0,
      eventRow.created_by,
      timestamp,
      timestamp,
    );
  const childLinkInsert = db
    .prepare("INSERT INTO events_children (event_id, child_id) VALUES (?, ?)")
    .bind(eventRow.id, childMemberId);

  try {
    await db.batch([eventInsert, childLinkInsert]);
  } catch (error) {
    throw new AiChildSchedulePersistenceError(error);
  }

  const savedRow: StoredAiChildScheduleRow = {
    ...eventRow,
    memo: eventRow.memo ?? "",
    location: eventRow.location ?? null,
    notif_override: eventRow.notif_override ?? null,
    end_time: eventRow.end_time || null,
    is_family_event: eventRow.is_family_event === true,
    created_at: timestamp,
    updated_at: timestamp,
    events_children: [{ child_id: childMemberId }],
  };

  try {
    await notifyCreated(savedRow);
  } catch {
    console.error("[ai-child-chat] schedule realtime notify failed");
  }
  return savedRow;
}

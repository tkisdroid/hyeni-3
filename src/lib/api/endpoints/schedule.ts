/**
 * 일정 도메인 엔드포인트(events / academies / daily-supplies).
 * date_key 는 0-indexed 월 규칙(transform/dateKey) — 직접 조립 금지.
 *
 * 서버 계약(hyeni-1 worker/routes):
 * - events: 다자녀 배정은 events_children(child_id = family_members.id, member id) M:N.
 *   반복(recurrence)은 서버 컬럼이 없다 → 클라에서 발생일마다 별도 행으로 확장(hyeni-1 App.jsx 동일).
 *   사전알림(reminder)은 notif_override jsonb(`{ minutesBefore: number[] }`)로 저장.
 * - daily-supplies: (family, child, date) 당 1행 + supplies/homework/note TEXT(GET/PUT 만, 항목행/DELETE 없음).
 *   체크리스트(항목별 done)는 supplies/homework TEXT 에 compact JSON 으로 인코딩해 왕복한다.
 */
import { apiGet, apiPost, apiPatch, apiDelete, apiPut } from "../client";

export interface EventLocation {
  lat?: number;
  lng?: number;
  address?: string;
  kakao_place_id?: string | null;
}

/** 사전알림 override — 서버 notif_override jsonb. minutesBefore = 이벤트 시작 N분 전 알림 목록. */
export interface EventNotifOverride {
  minutesBefore?: number[];
}

export interface CalendarEvent {
  id: string;
  family_id: string;
  date_key: string; // "YYYY-monthIndex0-D"
  title: string;
  time: string | null; // "HH:MM"
  end_time: string | null;
  category: string; // school/sports/hobby/family/friend/other
  emoji: string | null;
  color?: string;
  bg?: string;
  memo?: string;
  location?: EventLocation | null;
  notif_override?: EventNotifOverride | null;
  is_family_event?: boolean;
  created_by?: string;
  updated_at?: string; // 낙관적 잠금(edit 시 expectedUpdatedAt 로 전달)
  /** M:N 배정 자녀. child_id = family_members.id (member id, user_id 아님). */
  events_children?: Array<{ child_id?: string }>;
}

/** 가족 일정 목록. */
export function fetchEvents(familyId: string, limit = 300): Promise<CalendarEvent[]> {
  return apiGet<CalendarEvent[]>(
    `/api/events?family_id=${encodeURIComponent(familyId)}&limit=${limit}`,
  );
}

export type NewEventRow = {
  id?: string;
  family_id: string;
  date_key: string;
  title: string;
  time?: string | null;
  end_time?: string | null;
  category: string;
  emoji?: string | null;
  color?: string | null;
  bg?: string | null;
  memo?: string;
  location?: EventLocation | null;
  notif_override?: EventNotifOverride | null;
  is_family_event?: boolean;
};

/** 단일 일정 생성(자녀 귀속 없음, 레거시 /simple 경로). id 필수(서버 400 방지). */
export function createEventSimple(row: NewEventRow): Promise<unknown> {
  return apiPost("/api/events/simple", row);
}

/** 일정 수정(부분 갱신, PATCH). fields 는 snake_case. */
export function updateEvent(eventId: string, fields: Partial<NewEventRow>): Promise<unknown> {
  return apiPatch(`/api/events/${encodeURIComponent(eventId)}`, fields);
}

/** 일정 삭제. */
export function deleteEvent(eventId: string): Promise<unknown> {
  return apiDelete(`/api/events/${encodeURIComponent(eventId)}`);
}

// ── 다자녀 배정 저장(events + events_children 단일 트랜잭션) ──
export interface EventRow {
  id: string;
  family_id: string;
  date_key: string;
  title: string;
  time?: string | null;
  end_time?: string | null;
  category: string;
  emoji?: string | null;
  color?: string | null;
  bg?: string | null;
  memo?: string;
  location?: EventLocation | null;
  notif_override?: EventNotifOverride | null;
  is_family_event?: boolean;
}

export interface SaveEventInput {
  event: EventRow;
  /** family_members.id 배열(member id). familyAll 이면 서버가 무시. */
  childIds: string[];
  familyAll: boolean;
  /** 편집 시 낙관적 잠금(기존 updated_at). 생성 시 null. */
  expectedUpdatedAt?: string | null;
}

/**
 * 일정 upsert + 자녀 재배정(save_event_with_children 직역).
 * 생성/수정 공용 — event.id 존재 여부로 서버가 판단, events_children 는 delete-then-insert.
 */
export function saveEventWithChildren(input: SaveEventInput): Promise<CalendarEvent> {
  return apiPost<CalendarEvent>("/api/events", input);
}

/** 사전알림(분) → notif_override. null 이면 알림 없음(override 미설정). */
export function reminderMinutesToNotifOverride(minutes: number | null): EventNotifOverride | null {
  if (minutes == null) return null;
  return { minutesBefore: [minutes] };
}

/** notif_override → 사전알림(분). 없으면 null. */
export function notifOverrideToReminderMinutes(
  override: EventNotifOverride | null | undefined,
): number | null {
  const arr = override?.minutesBefore;
  if (Array.isArray(arr) && arr.length > 0 && Number.isFinite(arr[0])) return Number(arr[0]);
  return null;
}

// ── 준비물(daily-supplies) ──
// 화면(ParentHome/Supplies/ChildHome)이 쓰는 항목 단위 뷰. child_user_id 필드에는
// 실제로 family_members.id(member id)가 담긴다(서버 daily_supplies.child_id 와 동일).
export interface DailySupply {
  id?: string; // 합성 id: `${child_id}|${kind}|${itemId}` (parseSupplyRowId 로 해석)
  family_id: string;
  date_key: string;
  child_user_id?: string | null; // = member id
  label: string;
  done: boolean;
  kind?: "prep" | "hw" | string;
}

/** 서버 daily_supplies 행(원본). supplies/homework 는 항목 체크리스트를 담은 TEXT. */
export interface DailySupplyServerRow {
  id: string;
  family_id: string;
  child_id: string;
  date_key: string;
  supplies?: string;
  homework?: string;
  note?: string;
}

/** 체크리스트 단일 항목. */
export interface SupplyItem {
  id: string;
  label: string;
  done: boolean;
}

// 서버 cleanText 가 각 컬럼을 500자로 자른다. 잘림→JSON 깨짐을 막으려 항목 수/라벨을
// 보수적으로 제한하고, 인코딩 결과가 SAFE_LEN 을 넘으면 뒤 항목부터 버린다.
const MAX_ITEMS_PER_KIND = 8;
const MAX_LABEL_LEN = 20;
const SAFE_LEN = 460;

/** 짧은 항목 id(6자 base36). */
export function newSupplyItemId(): string {
  return Math.random().toString(36).slice(2, 6) + Math.random().toString(36).slice(2, 4);
}

/** 항목 배열 → 서버 TEXT(compact JSON). 500자 잘림을 막도록 항목/라벨 제한 + 길이 가드. */
export function encodeSupplyItems(items: SupplyItem[]): string {
  let bounded = items.slice(0, MAX_ITEMS_PER_KIND).map((it) => ({
    i: it.id,
    t: String(it.label ?? "").slice(0, MAX_LABEL_LEN),
    d: it.done ? 1 : 0,
  }));
  if (bounded.length === 0) return "";
  let out = JSON.stringify(bounded);
  while (out.length > SAFE_LEN && bounded.length > 1) {
    bounded = bounded.slice(0, bounded.length - 1);
    out = JSON.stringify(bounded);
  }
  return out;
}

/** 서버 TEXT → 항목 배열. JSON 실패 시 레거시 평문("a, b, c")으로 관대하게 해석. */
export function decodeSupplyItems(text: string | null | undefined): SupplyItem[] {
  const raw = String(text ?? "").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
        .map((r) => ({
          id: typeof r.i === "string" && r.i ? r.i : newSupplyItemId(),
          label: String(r.t ?? "").slice(0, MAX_LABEL_LEN),
          done: r.d === 1 || r.d === true,
        }))
        .filter((it) => it.label.length > 0);
    }
  } catch {
    /* 레거시 평문 폴백 */
  }
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((label) => ({ id: newSupplyItemId(), label: label.slice(0, MAX_LABEL_LEN), done: false }));
}

/** 합성 항목 id 조립: childId|kind|itemId (childId=uuid 라 '|' 충돌 없음). */
export function makeSupplyRowId(childId: string, kind: "prep" | "hw", itemId: string): string {
  return `${childId}|${kind}|${itemId}`;
}

/** 합성 항목 id 해석. 형식 불일치면 null. */
export function parseSupplyRowId(
  id: string | undefined | null,
): { childId: string; kind: "prep" | "hw"; itemId: string } | null {
  if (!id) return null;
  const parts = id.split("|");
  if (parts.length !== 3 || !parts[0] || !parts[2]) return null;
  return { childId: parts[0], kind: parts[1] === "hw" ? "hw" : "prep", itemId: parts[2] };
}

/** 서버 원본 행 조회(child_id 지정 시 그 아이만). */
export function fetchDailySupplyRowsRaw(
  familyId: string,
  dateKey?: string,
  childId?: string,
): Promise<DailySupplyServerRow[]> {
  const params = new URLSearchParams({ family_id: familyId });
  if (dateKey) params.set("date_key", dateKey);
  if (childId) params.set("child_id", childId);
  return apiGet<DailySupplyServerRow[]>(`/api/daily-supplies?${params.toString()}`);
}

/** 준비물 조회 → 항목 단위 DailySupply[] 로 디코드(child·kind 별로 펼침). */
export async function fetchDailySupplies(familyId: string, dateKey?: string): Promise<DailySupply[]> {
  const rows = await fetchDailySupplyRowsRaw(familyId, dateKey);
  const out: DailySupply[] = [];
  for (const row of rows ?? []) {
    const emit = (kind: "prep" | "hw", items: SupplyItem[]) => {
      for (const it of items) {
        out.push({
          id: makeSupplyRowId(row.child_id, kind, it.id),
          family_id: row.family_id,
          date_key: row.date_key,
          child_user_id: row.child_id, // = member id
          label: it.label,
          done: it.done,
          kind,
        });
      }
    };
    emit("prep", decodeSupplyItems(row.supplies));
    emit("hw", decodeSupplyItems(row.homework));
  }
  return out;
}

/** 준비물 행 전체 저장(supplies/homework 인코딩된 TEXT). 서버 PUT upsert. */
export function putDailySupplyRow(row: {
  family_id: string;
  child_id: string;
  date_key: string;
  supplies: string;
  homework: string;
  note?: string;
}): Promise<DailySupplyServerRow> {
  return apiPut<DailySupplyServerRow>("/api/daily-supplies", {
    family_id: row.family_id,
    child_id: row.child_id,
    date_key: row.date_key,
    supplies: row.supplies,
    homework: row.homework,
    note: row.note ?? "",
  });
}

// ── 학원(academies) ──
export interface Academy {
  id: string;
  family_id: string;
  name: string;
  category?: string;
  [key: string]: unknown;
}

export function fetchAcademies(familyId: string): Promise<Academy[]> {
  return apiGet<Academy[]>(`/api/academies?family_id=${encodeURIComponent(familyId)}`);
}

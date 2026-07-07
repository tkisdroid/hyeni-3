/**
 * 일정 도메인 TanStack Query 훅.
 *
 * 준비물(daily-supplies): 서버는 (family, child, date) 당 1행 + supplies/homework TEXT 만 있고
 * 항목행/DELETE 가 없다. 그래서 체크리스트는 endpoints/schedule 의 encode/decode 로 TEXT 에
 * compact JSON 인코딩해 왕복한다. 항목 토글/추가/이름변경/삭제는 모두 "그 아이의 그 날 행을
 * 읽고(GET) → 항목 수정 → 다시 씀(PUT)"의 read-modify-write 로 실제 서버에 반영된다.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { qk } from "./keys";
import { useAuth } from "@/auth/AuthContext";
import { useMyFamily } from "./useFamily";
import { resolveDailySupplyChildMemberId } from "@/transform/dailySupplyScope";
import {
  fetchEvents,
  fetchDailySupplies,
  fetchDailySupplyRowsRaw,
  putDailySupplyRow,
  createEventSimple,
  updateEvent,
  deleteEvent,
  saveEventWithChildren,
  decodeSupplyItems,
  encodeSupplyItems,
  parseSupplyRowId,
  newSupplyItemId,
  type CalendarEvent,
  type NewEventRow,
  type SaveEventInput,
  type DailySupply,
  type SupplyItem,
} from "@/lib/api/endpoints/schedule";

function upsertCachedEvents(qc: QueryClient, familyId: string | null | undefined, saved: CalendarEvent[]) {
  const valid = saved.filter((event) => event?.id);
  if (valid.length === 0) return;
  qc.setQueryData<CalendarEvent[]>(qk.events(familyId ?? ""), (prev) => {
    if (!prev) return valid;
    const byId = new Map(prev.map((event) => [event.id, event]));
    for (const event of valid) byId.set(event.id, event);
    return [...byId.values()];
  });
}

function removeCachedEvent(qc: QueryClient, familyId: string | null | undefined, eventId: string) {
  qc.setQueryData<CalendarEvent[]>(qk.events(familyId ?? ""), (prev) =>
    prev ? prev.filter((event) => event.id !== eventId) : prev,
  );
}

async function saveEventsWithChildren(inputs: SaveEventInput[]): Promise<CalendarEvent[]> {
  if (inputs.length === 0) return [];
  const results = await Promise.allSettled(inputs.map((input) => saveEventWithChildren(input)));
  const saved: CalendarEvent[] = [];
  for (const result of results) {
    if (result.status === "rejected") {
      throw result.reason instanceof Error ? result.reason : new Error("일정 저장에 실패했어요");
    }
    saved.push(result.value);
  }
  return saved;
}

/** 가족 일정 목록. */
export function useEvents() {
  const { familyId, status } = useAuth();
  return useQuery({
    queryKey: qk.events(familyId ?? ""),
    queryFn: () => fetchEvents(familyId as string),
    enabled: status === "authenticated" && !!familyId,
  });
}

/** 준비물(선택 date_key). 항목 단위로 디코드된 DailySupply[] 반환. */
export function useDailySupplies(dateKey?: string) {
  const { familyId, status } = useAuth();
  return useQuery({
    queryKey: qk.dailySupplies(familyId ?? "", dateKey),
    queryFn: () => fetchDailySupplies(familyId as string, dateKey),
    enabled: status === "authenticated" && !!familyId,
  });
}

/** 단일 일정 생성(자녀 배정 없음, 레거시). id 를 생성해 서버 400 을 방지. */
export function useCreateEvent() {
  const qc = useQueryClient();
  const { familyId } = useAuth();
  return useMutation({
    mutationFn: (row: Omit<NewEventRow, "family_id">) =>
      createEventSimple({ ...row, id: row.id ?? crypto.randomUUID(), family_id: familyId as string }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.events(familyId ?? "") }),
  });
}

/** 일정 부분 수정(PATCH). */
export function useUpdateEvent() {
  const qc = useQueryClient();
  const { familyId } = useAuth();
  return useMutation({
    mutationFn: (input: { id: string; fields: Partial<NewEventRow> }) =>
      updateEvent(input.id, input.fields),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.events(familyId ?? "") }),
  });
}

/** 일정 삭제. */
export function useDeleteEvent() {
  const qc = useQueryClient();
  const { familyId } = useAuth();
  return useMutation({
    mutationFn: (id: string) => deleteEvent(id),
    onSuccess: (_res, id) => {
      removeCachedEvent(qc, familyId, id);
      void qc.invalidateQueries({ queryKey: qk.events(familyId ?? "") });
    },
  });
}

/** 일정 저장 + 자녀 다중 배정(생성/수정 공용). EventForm 이 사용. */
export function useSaveEventWithChildren() {
  const qc = useQueryClient();
  const { familyId } = useAuth();
  return useMutation({
    mutationFn: (input: SaveEventInput) => saveEventWithChildren(input),
    onSuccess: (saved) => {
      upsertCachedEvents(qc, familyId, [saved]);
      void qc.invalidateQueries({ queryKey: qk.events(familyId ?? "") });
    },
  });
}

/** 반복/AI 일정처럼 여러 행을 저장할 때: 요청은 병렬, 캐시 갱신·재조회는 1회만. */
export function useSaveEventsWithChildrenBatch() {
  const qc = useQueryClient();
  const { familyId } = useAuth();
  return useMutation({
    mutationFn: (inputs: SaveEventInput[]) => saveEventsWithChildren(inputs),
    onSuccess: (saved) => {
      upsertCachedEvents(qc, familyId, saved);
      void qc.invalidateQueries({ queryKey: qk.events(familyId ?? "") });
    },
  });
}

// ── 준비물 read-modify-write 공용 ──

/** 그 아이의 그 날 행을 읽어 항목 리스트를 변형한 뒤 다시 저장(RMW). */
async function rebuildChildDay(
  familyId: string,
  childId: string,
  dateKey: string,
  mutate: (lists: { prep: SupplyItem[]; hw: SupplyItem[] }) => { prep: SupplyItem[]; hw: SupplyItem[] },
) {
  const rows = await fetchDailySupplyRowsRaw(familyId, dateKey, childId);
  const row = (rows ?? [])[0];
  const current = {
    prep: decodeSupplyItems(row?.supplies),
    hw: decodeSupplyItems(row?.homework),
  };
  const next = mutate(current);
  return putDailySupplyRow({
    family_id: familyId,
    child_id: childId,
    date_key: dateKey,
    supplies: encodeSupplyItems(next.prep),
    homework: encodeSupplyItems(next.hw),
    note: "",
  });
}

/**
 * 준비물 항목 업서트(토글/추가/이름변경). 기존 항목이면 id 로 갱신, 없으면 추가.
 * 실제 서버 daily_supplies 행에 반영된다.
 */
export function useUpsertDailySupply() {
  const qc = useQueryClient();
  const { familyId, userId, role } = useAuth();
  const { data: family } = useMyFamily();
  return useMutation({
    mutationFn: async (row: Omit<DailySupply, "family_id">) => {
      const members = family?.members ?? [];
      const parsed = parseSupplyRowId(row.id);
      const kind: "prep" | "hw" = parsed?.kind ?? (row.kind === "hw" ? "hw" : "prep");
      const childId =
        parsed?.childId ?? resolveDailySupplyChildMemberId(members, role, userId, row.child_user_id ?? null);
      if (!familyId || !childId) throw new Error("아이 정보를 찾을 수 없어요");
      return rebuildChildDay(familyId, childId, row.date_key, (lists) => {
        const list = kind === "hw" ? lists.hw : lists.prep;
        let nextList: SupplyItem[];
        if (parsed && list.some((it) => it.id === parsed.itemId)) {
          nextList = list.map((it) =>
            it.id === parsed.itemId ? { ...it, label: row.label ?? it.label, done: !!row.done } : it,
          );
        } else {
          nextList = [
            ...list,
            { id: parsed?.itemId ?? newSupplyItemId(), label: row.label ?? "", done: !!row.done },
          ];
        }
        return kind === "hw" ? { prep: lists.prep, hw: nextList } : { prep: nextList, hw: lists.hw };
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dailySupplies", familyId ?? ""] }),
  });
}

/**
 * 준비물 항목 삭제. 서버에 per-item DELETE 는 없으므로 "그 아이 그 날 행에서 항목을 빼고
 * 다시 PUT" 으로 실제 삭제한다. item.id(합성 id)에서 child·kind·itemId 를 해석.
 */
export function useDeleteDailySupply() {
  const qc = useQueryClient();
  const { familyId } = useAuth();
  return useMutation({
    mutationFn: async (item: DailySupply) => {
      const parsed = parseSupplyRowId(item.id);
      if (!familyId || !parsed) throw new Error("삭제할 항목을 찾지 못했어요");
      return rebuildChildDay(familyId, parsed.childId, item.date_key, (lists) => {
        if (parsed.kind === "hw") {
          return { prep: lists.prep, hw: lists.hw.filter((it) => it.id !== parsed.itemId) };
        }
        return { prep: lists.prep.filter((it) => it.id !== parsed.itemId), hw: lists.hw };
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dailySupplies", familyId ?? ""] }),
  });
}

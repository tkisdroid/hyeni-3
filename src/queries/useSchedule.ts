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
import { announceFallbackToast } from "@/lib/globalToast";
import { useAuth } from "@/auth/AuthContext";
import { useMyFamily } from "./useFamily";
import { resolveDailySupplyChildMemberId } from "@/transform/dailySupplyScope";
import { mergeSupplyLabels } from "@/transform/eventSupplies";
import {
  fetchEvents,
  fetchDailySupplies,
  fetchDailySupplyRowsRaw,
  putDailySupplyRow,
  createEventSimple,
  updateEvent,
  deleteEvent,
  saveEventWithChildren,
  saveEventsWithChildrenBatch,
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

/** 반복/AI 일정처럼 여러 행을 저장할 때 서버 원자 배치로 저장하고 캐시를 한 번 갱신한다. */
export function useSaveEventsWithChildrenBatch() {
  const qc = useQueryClient();
  const { familyId } = useAuth();
  return useMutation({
    mutationFn: (inputs: SaveEventInput[]) => saveEventsWithChildrenBatch(inputs),
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
    // 낙관적 토글 — rebuildChildDay 가 GET→PUT→GET(2~3홉)이라 서버 상태에만 바인딩하면
    // 느린 회선에서 체크가 1~3초 얼어 죽은 체크박스처럼 보인다(중복 탭 유발).
    // 캐시에 이미 있는 항목(id 일치)만 즉시 반전하고, 실패하면 스냅샷으로 원복한다.
    onMutate: async (row) => {
      if (!familyId || !row.id) return { snapshots: [] as SupplySnapshots };
      await qc.cancelQueries({ queryKey: ["dailySupplies", familyId] });
      const snapshots: SupplySnapshots = qc.getQueriesData<DailySupply[]>({
        queryKey: ["dailySupplies", familyId],
      });
      qc.setQueriesData<DailySupply[]>({ queryKey: ["dailySupplies", familyId] }, (prev) =>
        prev?.map((it) =>
          it.id === row.id ? { ...it, done: !!row.done, label: row.label ?? it.label } : it,
        ),
      );
      return { snapshots };
    },
    onError: (_err, _row, ctx) => {
      for (const [key, data] of ctx?.snapshots ?? []) qc.setQueryData(key, data);
      // 메시지는 콜사이트 토스트가 담당 — 콜사이트가 안 달았을 때만 이 폴백이 뜬다(450ms 양보).
      announceFallbackToast("준비물을 저장하지 못했어요. 다시 시도해 주세요", "⚠️");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["dailySupplies", familyId ?? ""] }),
  });
}

/**
 * 일정 등록/수정 시 입력한 준비물을 배정된 아이들의 해당 날짜 '가방 챙기기'(prep)에
 * 추가한다. 부모 홈 준비물·아이 홈 가방 챙기기는 dailySupplies 쿼리+WS 브릿지로
 * 실시간 반영된다. (아이,날짜) 쌍은 서로 다른 서버 행이라 병렬이 안전하고,
 * 같은 행 병렬 재작성(덮어쓰기 사고)은 쌍이 겹치지 않으므로 발생하지 않는다.
 */
export interface AddEventSuppliesInput {
  /** 대상 아이 member id 목록 — 폴백 금지, 콜사이트(EventForm 배정)가 명시한다. */
  childIds: string[];
  /** 일정 occurrence 날짜들(반복이면 회차마다 그 날 준비물이 필요하다). */
  dateKeys: string[];
  labels: string[];
}

export interface AddEventSuppliesResult {
  added: number;
  /** 하루 8개 상한에 걸려 담지 못한 라벨 수(조용한 유실 금지 — 화면이 안내). */
  dropped: number;
  /** 저장에 실패한 (아이,날짜) 행 수 — 0이 아니면 화면이 정직하게 안내한다. */
  failedRows: number;
}

export function useAddEventSupplies() {
  const qc = useQueryClient();
  const { familyId } = useAuth();
  return useMutation({
    mutationFn: async (input: AddEventSuppliesInput): Promise<AddEventSuppliesResult> => {
      if (!familyId) throw new Error("가족 정보가 없어요");
      const labels = input.labels.map((s) => s.trim()).filter(Boolean);
      const childIds = [...new Set(input.childIds.filter(Boolean))];
      const dateKeys = [...new Set(input.dateKeys.filter(Boolean))];
      if (!labels.length || !childIds.length || !dateKeys.length) {
        return { added: 0, dropped: 0, failedRows: 0 };
      }
      let added = 0;
      let dropped = 0;
      const pairs = childIds.flatMap((childId) => dateKeys.map((dateKey) => ({ childId, dateKey })));
      const results = await Promise.allSettled(
        pairs.map((pair) =>
          rebuildChildDay(familyId, pair.childId, pair.dateKey, (lists) => {
            const merged = mergeSupplyLabels(lists.prep, labels, newSupplyItemId);
            added += merged.added;
            dropped += merged.dropped;
            return { prep: merged.items, hw: lists.hw };
          }),
        ),
      );
      const failedRows = results.filter((r) => r.status === "rejected").length;
      return { added, dropped, failedRows };
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["dailySupplies", familyId ?? ""] }),
  });
}

type SupplySnapshots = Array<readonly [readonly unknown[], DailySupply[] | undefined]>;

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

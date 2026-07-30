import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Check, ChevronLeft, Home, Map as MapIcon, MapPin } from "lucide-react";
import { asset } from "@/lib/assets";
import { childAvatarPath } from "@/lib/avatar";
import { useDialogFocusLifecycle } from "@/components/useDialogFocusLifecycle";
import { useToast } from "@/app/toast";
import { useActiveChild } from "@/app/activeChild";
import { MapPickerSheet } from "@/components/MapPickerSheet";
import { ScreenQueryState } from "@/components/ui/ScreenQueryState";
import { useAuth } from "@/auth/AuthContext";
import { useMyFamily } from "@/queries/useFamily";
import { useSavedPlaces } from "@/queries/useLocation";
import { useAddEventSupplies, useEvents, useSaveEventsWithChildrenBatch } from "@/queries/useSchedule";
import { parseSupplyLabelInput } from "@/transform/eventSupplies";
import { useEntitlement } from "@/queries/useEntitlement";
import {
  notifOverrideToReminderSelection,
  reminderSelectionToNotifOverride,
  type CalendarEvent,
  type EventReminderSelection,
} from "@/lib/api/endpoints/schedule";
import { ApiError } from "@/lib/api/errors";
import {
  dateInputValueToDateKey,
  dateKeyToDateInputValue,
  parseAppDateKey,
  todayDateKey,
} from "@/transform/dateKey";
import {
  buildEventLocation,
  buildOccurrenceDateKeys,
  WEEKDAY_OPTIONS,
  type RepeatMode,
  type WeekdayIndex,
} from "@/transform/eventRecurrence";
import { searchSavedPlacesForSchedule } from "@/transform/eventPlaceSearch";
import { EVENT_CATEGORY_ASSETS } from "@/transform/placeVisual";
import { resolveInitialAssignedChildIds } from "@/transform/eventAssignment";
import {
  findFutureSeriesEvents,
  resolveSeriesEditTargets,
  type SeriesEditScope,
} from "@/transform/eventSeries";
import { scheduleLimitFor, TIERS } from "@/transform/tierPolicy";
import { resolveQueryTruthState } from "@/transform/queryTruthState";
import "./EventForm.css";

type Mode = "create" | "edit";

interface FormNavState {
  mode?: Mode;
  event?: CalendarEvent;
  dateKey?: string;
  childId?: string;
  childUserId?: string;
  suggestion?: Record<string, unknown> | null;
}

/** 카테고리(색/이모지는 transform/scheduleView 의 CATEGORY_STYLE 과 동일 규칙). */
const CATEGORIES = [
  { id: "school", label: "학교", emoji: "📚", color: "var(--cat-school-text)", soft: "var(--cat-school-soft)" },
  { id: "sports", label: "운동", emoji: "⚽", color: "var(--cat-sports-text)", soft: "var(--cat-sports-soft)" },
  { id: "hobby", label: "취미", emoji: "🎨", color: "var(--cat-hobby-text)", soft: "var(--cat-hobby-soft)" },
  { id: "family", label: "가족", emoji: "👨‍👩‍👧", color: "var(--hy-accent-text)", soft: "var(--hy-accent-soft)" },
  { id: "friend", label: "친구", emoji: "👫", color: "var(--cat-friend-text)", soft: "var(--cat-friend-soft)" },
  { id: "other", label: "기타", emoji: "🌟", color: "var(--cat-other-text)", soft: "var(--cat-other-soft)" },
] as const;

// 카테고리 칩 3D 아이콘 — 장소관리·일정 카드와 같은 단일 출처(placeVisual)를 쓴다.
// emoji 필드는 이벤트 데이터 계약(저장·레거시 표시)이라 유지.
const CATEGORY_ICONS = EVENT_CATEGORY_ASSETS;

const REPEATS: RepeatMode[] = ["없음", "매일", "매주", "매월", "요일"];

const PREALARMS: Array<{ label: string; minutes: EventReminderSelection }> = [
  { label: "기본 설정", minutes: "default" },
  { label: "알림 없음", minutes: "none" },
  { label: "10분 전", minutes: 10 },
  { label: "30분 전", minutes: 30 },
  { label: "1시간 전", minutes: 60 },
];

const DURATION_OPTIONS: Array<{ label: string; minutes: number }> = [
  { label: "30분", minutes: 30 },
  { label: "1시간", minutes: 60 },
  { label: "1시간 30분", minutes: 90 },
  { label: "2시간", minutes: 120 },
  { label: "3시간", minutes: 180 },
];

// 미선택 칩 — 토큰 정본을 쓴다. 하드코딩 #8B7E84/#F3EEF1 은 3.38:1 이라
// 고를 수 있는 칩이 비활성처럼 보였다(--fg-tertiary 조합은 4.98:1).
const IDLE_BG = "var(--bg-chip-idle)";
const IDLE_COLOR = "var(--fg-tertiary)";

function initialChildIdList(event?: CalendarEvent): string[] {
  const ids = (event?.events_children ?? [])
    .map((c) => c.child_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  return ids;
}

function uniqueEventsById(events: CalendarEvent[]): CalendarEvent[] {
  const map = new Map<string, CalendarEvent>();
  for (const event of events) map.set(event.id, event);
  return [...map.values()];
}

function weekdayFromDateInput(value: string): WeekdayIndex | null {
  const dateKey = dateInputValueToDateKey(value);
  const date = dateKey ? parseAppDateKey(dateKey) : null;
  if (!date) return null;
  return date.getDay() as WeekdayIndex;
}

function timeToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const min = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(min) || hour < 0 || hour > 23 || min < 0 || min > 59) {
    return null;
  }
  return hour * 60 + min;
}

function minutesToTimeValue(totalMin: number): string {
  const dayMin = ((Math.round(totalMin) % (24 * 60)) + 24 * 60) % (24 * 60);
  const hour = Math.floor(dayMin / 60);
  const min = dayMin % 60;
  return `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function durationFromEvent(start: string | null | undefined, end: string | null | undefined): number {
  const startMin = timeToMinutes(start);
  const endMinRaw = timeToMinutes(end);
  if (startMin == null || endMinRaw == null) return 60;
  const endMin = endMinRaw <= startMin ? endMinRaw + 24 * 60 : endMinRaw;
  const duration = endMin - startMin;
  return duration > 0 ? duration : 60;
}

function stringFrom(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function finiteNumberFrom(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** 새 일정 시작 시간 기본값 — 지금 이후 가장 가까운 30분 경계("HH:MM"). 빈 시간 입력을 없앤다. */
function nextHalfHourTime(now: Date = new Date()): string {
  const stepped = new Date(now.getTime());
  stepped.setSeconds(0, 0);
  const minutes = stepped.getMinutes();
  stepped.setMinutes(minutes <= 30 ? 30 : 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(stepped.getHours())}:${pad(stepped.getMinutes())}`;
}

function avatarSrc(path: string): string {
  return path.startsWith("http") ? path : asset(path);
}

export function EventForm() {
  const navigate = useNavigate();
  const { show } = useToast();
  const { familyId } = useAuth();
  const nav = (useLocation().state ?? null) as FormNavState | null;

  const mode: Mode = nav?.mode === "edit" ? "edit" : "create";
  const editing = mode === "edit" ? nav?.event ?? null : null;
  const suggestion = mode === "create" ? nav?.suggestion ?? null : null;

  const familyQuery = useMyFamily();
  const children = useMemo(
    () => (familyQuery.data?.members ?? []).filter((m) => m.role === "child"),
    [familyQuery.data],
  );
  // 저장된 장소(장소관리) — 장소 필드 빠른 선택 칩.
  const savedPlacesQuery = useSavedPlaces();
  const savedPlaces = savedPlacesQuery.data ?? [];

  const eventsQuery = useEvents();
  const entitlementQuery = useEntitlement();
  const { tier } = entitlementQuery;
  const eventFormQueryState = resolveQueryTruthState([
    { isLoading: familyQuery.isLoading, isError: familyQuery.isError },
    { isLoading: savedPlacesQuery.isLoading, isError: savedPlacesQuery.isError },
    { isLoading: eventsQuery.isLoading, isError: eventsQuery.isError },
    { isLoading: entitlementQuery.isLoading, isError: entitlementQuery.isError },
  ]);
  const eventFormDataMissing = eventFormQueryState === "ready" && (
    !familyQuery.data
    || savedPlacesQuery.data === undefined
    || eventsQuery.data === undefined
    || tier === TIERS.UNKNOWN
  );
  const eventFormDataReady = eventFormQueryState === "ready" && !eventFormDataMissing;
  const eventFormRefetching =
    familyQuery.isFetching
    || savedPlacesQuery.isFetching
    || eventsQuery.isFetching
    || entitlementQuery.isFetching;
  const retryEventForm = async (): Promise<void> => {
    await Promise.all([
      familyQuery.refetch(),
      savedPlacesQuery.refetch(),
      eventsQuery.refetch(),
      entitlementQuery.refetch(),
    ]);
  };
  const saveEvents = useSaveEventsWithChildrenBatch();
  const [busy, setBusy] = useState(false);
  const [seriesScopePrompt, setSeriesScopePrompt] = useState<{ futureCount: number } | null>(null);
  const seriesScopeTitleId = useId();
  const seriesScopeDescriptionId = useId();
  const seriesScopeCancelRef = useRef<HTMLButtonElement>(null);
  const seriesScopeDialogVisible = seriesScopePrompt !== null && eventFormDataReady && children.length > 0;
  const seriesScopeDialogRef = useDialogFocusLifecycle<HTMLElement>({
    open: seriesScopeDialogVisible,
    onClose: () => setSeriesScopePrompt(null),
    initialFocusRef: seriesScopeCancelRef,
    canClose: () => !busy,
  });
  const { activeChild } = useActiveChild();
  const editingNeedsAssignment =
    mode === "edit" && !!editing && editing.is_family_event !== true && initialChildIdList(editing).length === 0;
  const suggestedChildId = useMemo(() => {
    const explicit = stringFrom(suggestion?.childMemberId) ?? stringFrom(nav?.childId);
    if (explicit) return explicit;
    const childUserId = stringFrom(suggestion?.childUserId) ?? stringFrom(nav?.childUserId);
    if (!childUserId) return null;
    return children.find((m) => m.user_id === childUserId)?.id ?? null;
  }, [children, nav?.childId, nav?.childUserId, suggestion]);
  const initialAssignedChildIds = useMemo(
    () =>
      resolveInitialAssignedChildIds({
        existingChildIds: suggestedChildId ? [suggestedChildId] : initialChildIdList(editing ?? undefined),
        needsAssignment: editingNeedsAssignment,
        activeChildId: activeChild?.id ?? null,
        members: children,
      }),
    [activeChild?.id, children, editing, editingNeedsAssignment, suggestedChildId],
  );

  // ── 폼 상태(초기값은 edit 이면 기존 일정, create 면 전달된 dateKey/오늘) ──
  const [title, setTitle] = useState(() => editing?.title ?? stringFrom(suggestion?.title) ?? "");
  const [selectedChildIds, setSelectedChildIds] = useState<Set<string>>(() =>
    new Set(initialAssignedChildIds),
  );
  // 새 일정 기본 배정 = 전역 활성 아이(가족 로드 후 1회만; 사용자가 건드리면 존중).
  // 빈 선택은 "가족 공유(모든 아이 표시)"로 저장되므로 기본값을 활성 아이로 둔다.
  const childDefaultDone = useRef(false);
  const editDefaultDone = useRef(false);
  const suggestionDefaultDone = useRef(false);
  useEffect(() => {
    if (suggestionDefaultDone.current || mode !== "create" || !suggestedChildId) return;
    suggestionDefaultDone.current = true;
    setSelectedChildIds(new Set([suggestedChildId]));
  }, [mode, suggestedChildId]);
  useEffect(() => {
    if (childDefaultDone.current || mode !== "create" || !activeChild) return;
    childDefaultDone.current = true;
    setSelectedChildIds((prev) => (prev.size > 0 ? prev : new Set([activeChild.id])));
  }, [mode, activeChild]);
  useEffect(() => {
    if (editDefaultDone.current || mode !== "edit" || !editingNeedsAssignment) return;
    if (initialAssignedChildIds.length === 0) return;
    editDefaultDone.current = true;
    setSelectedChildIds((prev) => (prev.size > 0 ? prev : new Set(initialAssignedChildIds)));
  }, [editingNeedsAssignment, initialAssignedChildIds, mode]);
  const [dateValue, setDateValue] = useState(() => {
    if (editing) return dateKeyToDateInputValue(editing.date_key);
    const key = nav?.dateKey ?? todayDateKey();
    return dateKeyToDateInputValue(key);
  });
  const [timeValue, setTimeValue] = useState(
    () => editing?.time ?? stringFrom(suggestion?.time) ?? nextHalfHourTime(),
  );
  const [allDay, setAllDay] = useState(() => (editing ? editing.time == null : false));
  const [durationMin, setDurationMin] = useState(
    () => finiteNumberFrom(suggestion?.durationMinutes) ?? durationFromEvent(editing?.time, editing?.end_time),
  );
  const [category, setCategory] = useState<string>(() => editing?.category ?? stringFrom(suggestion?.category) ?? "school");
  const [place, setPlace] = useState(() => editing?.location?.address ?? stringFrom(suggestion?.address) ?? "");
  // 지도/저장장소로 지정한 좌표(있으면 event.location 에 lat/lng 로 함께 저장).
  const [placeCoord, setPlaceCoord] = useState<{ lat: number; lng: number } | null>(() => {
    if (typeof editing?.location?.lat === "number" && typeof editing?.location?.lng === "number") {
      return { lat: editing.location.lat, lng: editing.location.lng };
    }
    const lat = finiteNumberFrom(suggestion?.lat);
    const lng = finiteNumberFrom(suggestion?.lng);
    return lat != null && lng != null ? { lat, lng } : null;
  });
  const [placeSuggestionsOpen, setPlaceSuggestionsOpen] = useState(false);
  const [showMapPicker, setShowMapPicker] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>("없음");
  const [repeatWeekdays, setRepeatWeekdays] = useState<Set<WeekdayIndex>>(() => new Set());
  const [prealarm, setPrealarm] = useState<EventReminderSelection>(() =>
    notifOverrideToReminderSelection(editing?.notif_override),
  );
  const [memo, setMemo] = useState(() => editing?.memo ?? "");
  // ── 준비물(가방 챙기기 연동, 2026-07-16) ──
  // 저장 시 배정된 아이들의 그 날짜 daily_supplies(prep)에 추가돼 부모 홈 준비물과
  // 아이 홈 '가방 챙기기'에 실시간 반영된다. 수정 모드는 "추가"만 한다(기존 준비물과
  // 이 일정의 연결 정보가 서버에 없어 삭제/이동은 준비물 화면에서 한다).
  const addEventSupplies = useAddEventSupplies();
  const [supplyInput, setSupplyInput] = useState("");
  const [supplyLabels, setSupplyLabels] = useState<string[]>([]);

  const addSupplyChips = () => {
    const parsed = parseSupplyLabelInput(supplyInput);
    if (parsed.length === 0) return;
    setSupplyLabels((prev) => {
      const seen = new Set(prev.map((l) => l.replace(/\s+/g, "").toLowerCase()));
      return [...prev, ...parsed.filter((l) => !seen.has(l.replace(/\s+/g, "").toLowerCase()))];
    });
    setSupplyInput("");
  };

  const removeSupplyChip = (label: string) =>
    setSupplyLabels((prev) => prev.filter((l) => l !== label));

  /** 칩 + 아직 '추가'를 안 누른 입력창 잔여 텍스트까지 합친 최종 준비물 라벨. */
  const pendingSupplyLabels = () => {
    const seen = new Set(supplyLabels.map((l) => l.replace(/\s+/g, "").toLowerCase()));
    return [
      ...supplyLabels,
      ...parseSupplyLabelInput(supplyInput).filter((l) => !seen.has(l.replace(/\s+/g, "").toLowerCase())),
    ];
  };

  const createBatchIdentityRef = useRef<{
    occurrenceKey: string;
    seriesId: string | null;
    idsByDateKey: Map<string, string>;
  } | null>(null);

  const placeSuggestions = useMemo(
    () => searchSavedPlacesForSchedule(savedPlaces, place),
    [savedPlaces, place],
  );
  const showPlaceSuggestions = placeSuggestionsOpen && placeSuggestions.length > 0;

  const selectSavedPlace = (p: (typeof savedPlaces)[number]) => {
    const coord =
      Number.isFinite(p.location?.lat) && Number.isFinite(p.location?.lng)
        ? { lat: p.location.lat, lng: p.location.lng }
        : null;
    setPlace(p.name);
    setPlaceCoord(coord);
    setPlaceSuggestionsOpen(false);
  };

  const handlePlaceChange = (nextPlace: string) => {
    setPlace(nextPlace);
    setPlaceSuggestionsOpen(true);
    setPlaceCoord(null);
  };

  const toggleChild = (id: string) =>
    setSelectedChildIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleRepeatSelect = (nextRepeat: RepeatMode) => {
    setRepeat(nextRepeat);
    if (nextRepeat !== "요일") return;
    setRepeatWeekdays((prev) => {
      if (prev.size > 0) return prev;
      const weekday = weekdayFromDateInput(dateValue);
      return weekday === null ? prev : new Set([weekday]);
    });
  };

  const toggleRepeatWeekday = (weekday: WeekdayIndex) =>
    setRepeatWeekdays((prev) => {
      const next = new Set(prev);
      if (next.has(weekday)) next.delete(weekday);
      else next.add(weekday);
      return next;
    });

  const handleSave = async (scope?: SeriesEditScope) => {
    if (busy) return;
    if (!eventFormDataReady) {
      show("일정 저장에 필요한 정보를 다시 확인해 주세요", "⚠️");
      return;
    }
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      show("일정 제목을 입력해 주세요", "✏️");
      return;
    }
    if (!allDay && !timeValue) {
      show("시간을 선택해 주세요", "🕒");
      return;
    }
    const dateKey = dateInputValueToDateKey(dateValue);
    if (!dateKey) {
      show("날짜를 확인해 주세요", "📅");
      return;
    }
    if (!familyId) {
      show("가족 정보를 불러오지 못했어요", "⚠️");
      return;
    }
    const repeatWeekdayList = Array.from(repeatWeekdays);
    if (mode === "create" && repeat === "요일" && repeatWeekdayList.length === 0) {
      show("반복할 요일을 선택해 주세요", "📅");
      return;
    }

    const catStyle = CATEGORIES.find((c) => c.id === category);
    const childIds = Array.from(selectedChildIds);
    const unknownChildId = childIds.find((id) => !children.some((child) => child.id === id));
    if (unknownChildId) {
      show("선택한 아이 정보를 확인하지 못했어요. 다시 선택해 주세요", "🧒");
      return;
    }
    const startMin = allDay ? null : timeToMinutes(timeValue);
    if ((!allDay && startMin == null) || durationMin <= 0) {
      show("시간을 확인해 주세요", "🕒");
      return;
    }
    const endTimeValue = startMin == null ? "" : minutesToTimeValue(startMin + durationMin);
    if (editingNeedsAssignment && childIds.length === 0) {
      show("배정할 아이를 선택해 주세요", "🧒");
      return;
    }
    const familyAll = !editingNeedsAssignment && childIds.length === 0;
    const baseFields = {
      title: trimmedTitle,
      time: allDay ? null : timeValue,
      end_time: allDay ? null : endTimeValue,
      category,
      emoji: catStyle?.emoji ?? "🌟",
      memo: memo.trim(),
      location: buildEventLocation(place, placeCoord),
      notif_override: reminderSelectionToNotifOverride(prealarm),
      is_family_event: familyAll,
    };

    const keys = mode === "create" ? buildOccurrenceDateKeys(dateKey, repeat, repeatWeekdayList) : [];
    if (mode === "create") {
      const limit = scheduleLimitFor(tier);
      const currentCount = eventsQuery.data?.length ?? 0;
      if (currentCount + keys.length > limit) {
        show(`현재 플랜에서는 일정 ${limit}개까지 저장할 수 있어요`, "👑");
        return;
      }
    }

    if (mode === "edit" && editing && !scope) {
      const sourceEvents = uniqueEventsById([...(eventsQuery.data ?? []), editing]);
      const futureTargets = findFutureSeriesEvents(sourceEvents, editing);
      if (futureTargets.length > 1) {
        setSeriesScopePrompt({ futureCount: futureTargets.length - 1 });
        return;
      }
    }

    setSeriesScopePrompt(null);
    setBusy(true);
    // 준비물 대상: 배정 아이(가족 공유면 모든 아이 — 일정이 모든 아이에게 표시되는 것과
    // 같은 의미). 폴백 아님: familyAll 은 사용자가 배정을 비워 명시적으로 고른 상태다.
    const labelsToAdd = pendingSupplyLabels();
    const supplyChildIds = familyAll ? children.map((c) => c.id) : childIds;
    const applyEventSupplies = async (supplyDateKeys: string[]) => {
      if (labelsToAdd.length === 0 || supplyChildIds.length === 0) return null;
      try {
        return await addEventSupplies.mutateAsync({
          childIds: supplyChildIds,
          dateKeys: supplyDateKeys,
          labels: labelsToAdd,
        });
      } catch {
        return { added: 0, dropped: 0, failedRows: supplyChildIds.length * supplyDateKeys.length };
      }
    };
    // 일정 저장은 성공했고 준비물만 문제면, 저장을 되돌리지 않고 정직하게 안내한다.
    const composeSaveToast = (base: string, res: { added: number; dropped: number; failedRows: number } | null) => {
      if (!res) return base;
      if (res.failedRows > 0) return `${base} · 준비물 일부는 저장하지 못했어요`;
      if (res.dropped > 0) return `${base} · 준비물은 하루 8개까지만 담았어요`;
      if (res.added > 0) return `${base} · 준비물도 가방에 담았어요`;
      return base;
    };
    try {
      if (mode === "edit" && editing) {
        const sourceEvents = uniqueEventsById([...(eventsQuery.data ?? []), editing]);
        const targets = resolveSeriesEditTargets(sourceEvents, editing, scope ?? "single");
        await saveEvents.mutateAsync(
          targets.map((target) => ({
            event: {
              id: target.id,
              family_id: familyId,
              date_key: target.id === editing.id ? dateKey : target.date_key,
              series_id: target.series_id ?? null,
              ...baseFields,
            },
            childIds,
            familyAll,
            expectedUpdatedAt: target.updated_at ?? null,
          })),
        );
        const supplyRes = await applyEventSupplies(
          targets.map((target) => (target.id === editing.id ? dateKey : target.date_key)),
        );
        show(
          composeSaveToast(
            targets.length > 1
              ? `이 일정과 이후 반복 일정 ${targets.length - 1}개를 수정했어요`
              : "일정을 수정했어요",
            supplyRes,
          ),
          "🗓️",
        );
      } else {
        const occurrenceKey = keys.join("\u001f");
        if (createBatchIdentityRef.current?.occurrenceKey !== occurrenceKey) {
          createBatchIdentityRef.current = {
            occurrenceKey,
            seriesId: keys.length > 1 ? crypto.randomUUID() : null,
            idsByDateKey: new Map(keys.map((key) => [key, crypto.randomUUID()])),
          };
        }
        const createIdentity = createBatchIdentityRef.current;
        await saveEvents.mutateAsync(
          keys.map((dk) => ({
            event: {
              id: createIdentity.idsByDateKey.get(dk) ?? crypto.randomUUID(),
              series_id: createIdentity.seriesId,
              family_id: familyId,
              date_key: dk,
              ...baseFields,
            },
            childIds,
            familyAll,
            expectedUpdatedAt: null,
          })),
        );
        // 반복 일정이면 회차 날짜마다 그 날 준비물이 필요하므로 occurrence 전체에 담는다.
        const supplyRes = await applyEventSupplies(keys);
        show(
          composeSaveToast(keys.length > 1 ? `${keys.length}개 일정을 저장했어요` : "일정을 저장했어요", supplyRes),
          "🗓️",
        );
      }
      navigate(-1);
    } catch (e) {
      show(e instanceof ApiError ? e.message : "일정 저장에 실패했어요. 다시 시도해 주세요", "⚠️");
    } finally {
      setBusy(false);
    }
  };

  if (eventFormQueryState === "loading") {
    return (
      <ScreenQueryState
        screenTitle={mode === "edit" ? "일정 수정" : "새 일정"}
        state="loading"
        heading="일정 정보를 불러오고 있어요"
        description="가족, 장소, 기존 일정과 이용 한도를 확인하는 중이에요."
        onBack={() => navigate(-1)}
      />
    );
  }

  if (eventFormQueryState === "error" || eventFormDataMissing) {
    return (
      <ScreenQueryState
        screenTitle={mode === "edit" ? "일정 수정" : "새 일정"}
        state="error"
        heading="일정 정보를 모두 확인하지 못했어요"
        description="일부 데이터가 빠진 상태로 저장하지 않도록 폼을 잠시 닫았어요."
        onBack={() => navigate(-1)}
        onRetry={() => void retryEventForm()}
        retrying={eventFormRefetching}
      />
    );
  }

  if (children.length === 0) {
    return (
      <ScreenQueryState
        screenTitle={mode === "edit" ? "일정 수정" : "새 일정"}
        state="empty"
        heading="일정을 배정할 아이가 없어요"
        description="아이를 연결한 뒤 가족 일정을 등록할 수 있어요."
        onBack={() => navigate(-1)}
        onRetry={() => void retryEventForm()}
        retrying={eventFormRefetching}
        retryLabel="가족 정보 다시 확인"
      />
    );
  }

  return (
    <div className="ef-screen">
      <header className="ef-header">
        <button
          type="button"
          className="ef-back hy-press"
          aria-label="뒤로"
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} strokeWidth={2.2} color="#4A4145" />
        </button>
        <span className="ef-title">{mode === "edit" ? "일정 수정" : "새 일정"}</span>
      </header>

      <div className="ef-body">
        {/* 제목 */}
        <div>
          <div className="ef-label">제목</div>
          <input
            className="ef-input"
            aria-label="일정 제목"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="예) 피아노 학원"
          />
        </div>

        {/* 아이(다중 배정) — 서버 events_children 에 실제 저장 */}
        <div>
          <div className="ef-label">아이</div>
          {familyQuery.isLoading ? (
            <div className="ef-empty-note">가족 정보를 불러오고 있어요</div>
          ) : familyQuery.isError ? (
            <div className="ef-empty-note">가족 정보를 불러오지 못했어요. 뒤로 갔다 다시 열어 주세요</div>
          ) : children.length === 0 ? (
            <div className="ef-empty-note">가족에 등록된 아이가 없어요</div>
          ) : (
            <div className="ef-chips">
              {children.map((m) => {
                const active = selectedChildIds.has(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    className="ef-chip hy-press"
                    style={
                      active
                        ? {
                            background: "var(--hy-accent-soft)",
                            color: "var(--hy-accent-text)",
                            border: "1.5px solid var(--hy-accent)",
                          }
                        : { background: IDLE_BG, color: IDLE_COLOR, border: "1.5px solid transparent" }
                    }
                    onClick={() => toggleChild(m.id)}
                  >
                    <span className="ef-chip__avatar">
                      <img
                        className="hy-network-avatar"
                        src={avatarSrc(childAvatarPath(m.photo_url))}
                        alt=""
                        loading="lazy"
                        decoding="async"
                      />
                    </span>
                    {m.name || "아이"}
                    {active && <Check size={16} strokeWidth={2.4} aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          )}
          <div className="ef-note hy-explain">
            {editingNeedsAssignment
              ? "이 일정은 배정이 빠져 있어요. 아이를 선택해야 저장돼요"
              : selectedChildIds.size === 0
              ? "아무도 선택하지 않으면 가족 공유 일정으로 모든 아이에게 보여요"
              : "여러 아이를 함께 배정할 수 있어요"}
          </div>
        </div>

        {/* 날짜 · 시간 */}
        <div>
          <div className="ef-label">날짜 · 시간</div>
          <div className="ef-chips">
            <button
              type="button"
              className="ef-chip hy-press"
              aria-pressed={allDay}
              onClick={() => setAllDay((value) => !value)}
              style={
                allDay
                  ? {
                      background: "var(--hy-accent-soft)",
                      color: "var(--hy-accent-text)",
                      border: "1.5px solid var(--hy-accent)",
                    }
                  : { background: IDLE_BG, color: IDLE_COLOR, border: "1.5px solid transparent" }
              }
            >
              하루 종일
            </button>
          </div>
          <div className="ef-row">
            <input
              type="date"
              className="ef-input ef-input--date"
              aria-label="일정 날짜"
              value={dateValue}
              onChange={(e) => setDateValue(e.target.value)}
            />
            <input
              type="time"
              className="ef-input ef-input--time"
              aria-label="일정 시작 시간"
              value={timeValue}
              onChange={(e) => setTimeValue(e.target.value)}
              disabled={allDay}
            />
          </div>
        </div>

        {!allDay && <div>
          <div className="ef-label">지속시간</div>
          <div className="ef-chips">
            {DURATION_OPTIONS.map((d) => {
              const active = durationMin === d.minutes;
              return (
                <button
                  key={d.minutes}
                  type="button"
                  className="ef-chip hy-press"
                  style={
                    active
                      ? {
                          background: "var(--hy-accent-soft)",
                          color: "var(--hy-accent-text)",
                          border: "1.5px solid var(--hy-accent)",
                        }
                      : { background: IDLE_BG, color: IDLE_COLOR, border: "1.5px solid transparent" }
                  }
                  onClick={() => setDurationMin(d.minutes)}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
          {timeValue && (
            <div className="ef-note hy-explain">
              종료 {minutesToTimeValue((timeToMinutes(timeValue) ?? 0) + durationMin)}
            </div>
          )}
        </div>}

        {/* 카테고리 */}
        <div>
          <div className="ef-label">카테고리</div>
          <div className="ef-chips">
            {CATEGORIES.map((c) => {
              const active = category === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  className="ef-chip hy-press"
                  style={
                    active
                      ? { background: c.soft, color: c.color, border: `1.5px solid ${c.color}` }
                      : { background: IDLE_BG, color: IDLE_COLOR, border: "1.5px solid transparent" }
                  }
                  onClick={() => setCategory(c.id)}
                >
                  <img
                    src={asset(CATEGORY_ICONS[c.id] ?? "cat/other.webp")}
                    alt=""
                    style={{ width: 20, height: 20, objectFit: "contain", verticalAlign: -4, marginRight: 4 }}
                  />
                  {c.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* 장소 — 저장장소 빠른 선택(좌표 포함) + 지도에서 지정 + 직접 입력.
            저장은 event.location = { address, lat?, lng? }. */}
        <div>
          <div className="ef-label">장소</div>
          {savedPlaces.length > 0 && (
            <div className="ef-chips" style={{ marginBottom: 8 }}>
              {savedPlaces.map((p) => {
                const PlaceIcon = p.is_home ? Home : MapPin;
                const active = place.trim() === p.name;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className="ef-chip hy-press"
                    style={
                      active
                        ? {
                            background: "var(--hy-accent-soft)",
                            color: "var(--hy-accent-text)",
                            border: "1.5px solid var(--hy-accent)",
                          }
                        : { background: IDLE_BG, color: IDLE_COLOR, border: "1.5px solid transparent" }
                    }
                    onClick={() => {
                      if (active) {
                        setPlace("");
                        setPlaceCoord(null);
                        setPlaceSuggestionsOpen(false);
                        return;
                      }
                      selectSavedPlace(p);
                    }}
                  >
                    <PlaceIcon size={13} strokeWidth={2.4} style={{ verticalAlign: -2, marginRight: 4 }} />
                    {p.name}
                  </button>
                );
              })}
            </div>
          )}
          <div className="ef-row ef-place-row">
            <div className="ef-place-field">
              <input
                className="ef-input"
                aria-label="일정 장소"
                value={place}
                onFocus={() => setPlaceSuggestionsOpen(true)}
                onBlur={() => window.setTimeout(() => setPlaceSuggestionsOpen(false), 120)}
                onChange={(e) => handlePlaceChange(e.target.value)}
                placeholder="예) 피아노 학원"
                aria-autocomplete="list"
                aria-expanded={showPlaceSuggestions}
              />
              {showPlaceSuggestions && (
                <div
                  className="ef-place-suggestions"
                  role="listbox"
                  aria-label="저장된 장소 검색 결과"
                >
                  {placeSuggestions.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="ef-place-option hy-press"
                      role="option"
                      aria-selected={place.trim() === p.name}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => selectSavedPlace(p)}
                    >
                      <span className="ef-place-option-name">
                        {p.is_home
                          ? <Home size={13} strokeWidth={2.4} style={{ verticalAlign: -2, marginRight: 4 }} />
                          : <MapPin size={13} strokeWidth={2.4} style={{ verticalAlign: -2, marginRight: 4 }} />}
                        {p.name}
                      </span>
                      {p.location.address && (
                        <span className="ef-place-option-address">{p.location.address}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              className="ef-mapbtn hy-press"
              aria-label="지도에서 장소 지정"
              onClick={() => setShowMapPicker(true)}
            >
              <MapIcon size={17} strokeWidth={2.2} />
              지도
            </button>
          </div>
          {placeCoord ? (
            <div className="ef-note hy-explain">📍 지도 위치가 함께 저장돼요</div>
          ) : place.trim() ? (
            <div className="ef-note hy-explain">
              좌표가 없어 도착·미도착 알림은 동작하지 않아요. 저장된 장소나 지도에서 선택해 주세요
            </div>
          ) : null}
        </div>

        {/* 반복 — 생성 시에만(서버는 반복 컬럼이 없어 발생일마다 별도 일정으로 저장) */}
        {mode === "create" ? (
          <div>
            <div className="ef-label">반복</div>
            <div className="ef-chips">
              {REPEATS.map((r) => {
                const active = repeat === r;
                return (
                  <button
                    key={r}
                    type="button"
                    className="ef-chip hy-press"
                    style={
                      active
                        ? {
                            background: "var(--hy-accent-soft)",
                            color: "var(--hy-accent-text)",
                            border: "1.5px solid var(--hy-accent)",
                          }
                        : { background: IDLE_BG, color: IDLE_COLOR, border: "1.5px solid transparent" }
                    }
                    onClick={() => handleRepeatSelect(r)}
                  >
                    {r === "요일" ? "요일 선택" : r}
                  </button>
                );
              })}
            </div>
            {repeat === "요일" && (
              <div className="ef-weekdays" role="group" aria-label="반복 요일">
                {WEEKDAY_OPTIONS.map((day) => {
                  const active = repeatWeekdays.has(day.value);
                  return (
                    <button
                      key={day.value}
                      type="button"
                      className={`ef-weekday hy-press${active ? " is-active" : ""}`}
                      aria-pressed={active}
                      onClick={() => toggleRepeatWeekday(day.value)}
                    >
                      {day.label}
                    </button>
                  );
                })}
              </div>
            )}
            {repeat !== "없음" && (
              <div className="ef-note hy-explain">
                {repeat === "매일"
                  ? "오늘부터 14일간"
                  : repeat === "매주"
                    ? "이 요일로 8주간"
                    : repeat === "요일"
                      ? "선택한 요일로 8주간"
                      : "이 날짜로 6개월간"}{" "}
                일정이 만들어져요
              </div>
            )}
          </div>
        ) : (
          <div>
            <div className="ef-label">반복</div>
            <div className="ef-note hy-explain">반복은 새 일정에서만 설정할 수 있어요</div>
          </div>
        )}

        {/* 사전 알림 — notif_override 로 실제 저장 */}
        <div>
          <div className="ef-label">사전 알림</div>
          <div className="ef-chips">
            {PREALARMS.map((p) => {
              const active = prealarm === p.minutes;
              return (
                <button
                  key={p.label}
                  type="button"
                  className="ef-chip hy-press"
                  style={
                    active
                      ? {
                          background: "var(--hy-accent-soft)",
                          color: "var(--hy-accent-text)",
                          border: "1.5px solid var(--hy-accent)",
                        }
                      : { background: IDLE_BG, color: IDLE_COLOR, border: "1.5px solid transparent" }
                  }
                  onClick={() => setPrealarm(p.minutes)}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          {prealarm === "default" && (
            <div className="ef-note hy-explain">알림 설정에서 고른 시간을 사용해요</div>
          )}
          {prealarm === "none" && <div className="ef-note hy-explain">이 일정의 사전 알림을 보내지 않아요</div>}
        </div>

        {/* 준비물 — 저장하면 배정 아이의 '가방 챙기기'(daily_supplies)에 함께 담긴다 */}
        <div>
          <div className="ef-label">준비물</div>
          <div className="ef-supply-row">
            <input
              className="ef-input"
              value={supplyInput}
              onChange={(e) => setSupplyInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addSupplyChips();
                }
              }}
              placeholder="예) 실내화, 물통 (쉼표로 여러 개)"
              aria-label="준비물 입력"
            />
            <button
              type="button"
              className="ef-supply-add hy-press"
              onClick={addSupplyChips}
              disabled={supplyInput.trim().length === 0}
            >
              추가
            </button>
          </div>
          {supplyLabels.length > 0 && (
            <div className="ef-supply-chips">
              {supplyLabels.map((label) => (
                <button
                  key={label}
                  type="button"
                  className="ef-supply-chip hy-press"
                  aria-label={`준비물 ${label} 빼기`}
                  onClick={() => removeSupplyChip(label)}
                >
                  {label}
                  <span aria-hidden="true">×</span>
                </button>
              ))}
            </div>
          )}
          <div className="ef-note hy-explain">저장하면 아이 홈 ‘가방 챙기기’와 부모 홈 준비물에 실시간으로 담겨요</div>
        </div>

        {/* 메모 */}
        <div>
          <div className="ef-label">메모</div>
          <textarea
            className="ef-textarea"
            aria-label="일정 메모"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="예) 선생님께 전달할 내용"
            rows={3}
          />
        </div>

        {/* 저장 */}
        <button
          type="button"
          className="ef-save hy-press"
          onClick={() => void handleSave()}
          disabled={busy || !eventFormDataReady}
          aria-busy={busy}
        >
          {busy
            ? "저장 중…"
            : editingNeedsAssignment
              ? "배정 저장"
              : mode === "edit"
                ? "수정 저장"
                : "일정 저장"}
        </button>
      </div>

      {/* 지도 장소 피커 — 현재 위치 기준, 지도 탭/저장장소 선택으로 좌표+주소 지정 */}
      {showMapPicker && (
        <MapPickerSheet
          savedPlaces={savedPlaces}
          initial={placeCoord}
          onClose={() => setShowMapPicker(false)}
          onConfirm={(sel) => {
            setPlaceCoord({ lat: sel.lat, lng: sel.lng });
            setPlace(sel.name ?? (sel.address || place.trim() || "지도에서 선택한 위치"));
            setShowMapPicker(false);
          }}
        />
      )}

      {seriesScopeDialogVisible && (
        <div className="ef-scope-backdrop" role="presentation">
          <section
            ref={seriesScopeDialogRef}
            className="ef-scope-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby={seriesScopeTitleId}
            aria-describedby={seriesScopeDescriptionId}
          >
            <div id={seriesScopeTitleId} className="ef-scope-title">
              반복 일정 수정
            </div>
            <p id={seriesScopeDescriptionId} className="ef-scope-desc">
              같은 반복으로 이어지는 이후 일정 {seriesScopePrompt.futureCount}개가 있어요. 수정 범위를
              선택해 주세요.
            </p>
            <div className="ef-scope-actions">
              <button
                type="button"
                className="ef-scope-primary hy-press"
                onClick={() => void handleSave("single")}
                disabled={busy} aria-busy={busy}
              >
                이 일정만 수정
              </button>
              <button
                type="button"
                className="ef-scope-secondary hy-press"
                onClick={() => void handleSave("future")}
                disabled={busy} aria-busy={busy}
              >
                이후 반복 일정도 수정
              </button>
              <button
                ref={seriesScopeCancelRef}
                type="button"
                className="ef-scope-cancel hy-press"
                onClick={() => setSeriesScopePrompt(null)}
                disabled={busy} aria-busy={busy}
              >
                취소
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

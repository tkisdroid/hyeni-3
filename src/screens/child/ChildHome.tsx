import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Backpack, Check, MapPin, MessageCircle, Navigation, Palette, Settings2, X } from "lucide-react";
import { useIntl } from "react-intl";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { useAccent } from "@/app/accent";
import { useRecentDateKeys } from "@/app/useRecentDateKeys";
import { useAuth } from "@/auth/AuthContext";
import { useMyFamily } from "@/queries/useFamily";
import { useEvents, useDailySupplies, useUpsertDailySupply, useDeleteDailySupply } from "@/queries/useSchedule";
import { useSavedPlaces, useChildLocations } from "@/queries/useLocation";
import { useStickerSummary, useReceivedStickers } from "@/queries/useStickers";
import { useMemoThread, useSendMemo } from "@/queries/useMemo";
import { useAiCreditPublicStatus, useAiFriendPublicSettings } from "@/queries/useAi";
import { placePhoneCall } from "@/lib/native/phone";
import type { DailySupply, CalendarEvent } from "@/lib/api/endpoints/schedule";
import type { RoutePoint } from "@/lib/api/endpoints/route";
import { groupEventsByDateKey, PAST_TAGS } from "@/transform/scheduleView";
import { useLocale } from "@/i18n/useLocale";
import { formatCalendarDay, formatRelativeMinutes, LEGACY_FAMILY_TIME_ZONE } from "@/i18n/format";
import { dateTimeScopeInTimeZone, latestDateKeyOrNull } from "@/transform/dateKey";
import { filterEventsForChild } from "@/transform/eventScope";
import { QUICK_STATUS_ACTIONS, buildQuickStatusMemo, type QuickStatusActionId } from "@/transform/quickStatusShare";
import { buildAdventureMap, timeLabelToMinutes, type AdventureEventInput } from "@/transform/adventureMap";
import { buildStickerBook, readSeenStickers } from "@/transform/stickerBook";
import { resolveEventVisualAsset } from "@/transform/placeVisual";
import { CHILD_ACCENTS } from "@/transform/childAccent";
import { resolveAiFriendDisplayName } from "@/transform/aiFriendName";
import {
  MAX_SUPPLY_ITEMS_PER_KIND,
  dailySupplyLimitMessage,
  isDailySupplyLimitError,
} from "@/transform/eventSupplies";
import { Loading } from "@/components/ui/Loading";
import {
  latestParentMemoText,
  resolveChildDestination,
  unreadParentMemoCount,
} from "@/transform/childHomeData";
import { ChildTimetableList, type ChildTimetableRow } from "./ChildTimetable";
import { DaySheet } from "./overlays/DaySheet";
import { RouteSheet } from "./overlays/RouteSheet";
import { PlaydateSheet } from "./overlays/PlaydateSheet";
import { CallSheet, type CallTarget } from "./overlays/CallSheet";
import { Celebrate } from "./overlays/Celebrate";
import "@/styles/jua.css";
import "./ChildHome.css";

/** 원탭 상태 버튼의 3D 아이콘 — status/*.webp 는 흰 배경 불투명이라 쓰지 않는다. */
const QUICK_STATUS_ICONS: Record<QuickStatusActionId, string> = {
  arrived: "ui/place-home.webp",
  departed: "mascot/wave.webp",
  late: "ui/warning.webp",
  pickup: "ui/pin-heart.webp",
  call: "ui/phone-lavender.webp",
  battery: "ui/battery.webp",
};

/** 완료 축하에 띄울 스티커 — 준비물/숙제에 따라 다르게. */
const CELEBRATE_ICON: Record<string, string> = {
  prep: "sticker/ready.webp",
  hw: "sticker/study.webp",
};

/** 지도 곡선(시안 좌표계 390×470). viewBox 로 화면 폭에 맞춰 늘어난다. */
const MAP_PATH = "M 292 78 C 250 128 152 112 126 172 C 100 236 224 244 252 306 C 278 364 168 372 128 428";

export function ChildHome() {
  const intl = useIntl();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const { show } = useToast();
  const { accent, setAccent } = useAccent();
  const { userId } = useAuth();

  const memoDateKeys = useRecentDateKeys(7, LEGACY_FAMILY_TIME_ZONE);
  const memoDateKey = latestDateKeyOrNull(memoDateKeys);
  const now = useMemo(() => new Date(), [memoDateKey]);
  const dateTimeScope = useMemo(
    () => dateTimeScopeInTimeZone(now, LEGACY_FAMILY_TIME_ZONE),
    [now],
  );
  const todayKey = memoDateKey ?? dateTimeScope.dateKey;
  const nowMinutes = dateTimeScope.minutesSinceMidnight;

  const familyQuery = useMyFamily();
  const eventsQuery = useEvents();
  const placesQuery = useSavedPlaces();
  const locationsQuery = useChildLocations();
  const family = familyQuery.data;
  const events = eventsQuery.data;
  const places = placesQuery.data;
  const locations = locationsQuery.data;
  const { data: stickerSummary } = useStickerSummary();
  const receivedStickers = useReceivedStickers(userId);
  const aiFriend = useAiFriendPublicSettings(userId);
  const aiCreditStatus = useAiCreditPublicStatus(userId);
  const homeLoading = familyQuery.isLoading || eventsQuery.isLoading || placesQuery.isLoading;
  const homeError = familyQuery.isError || eventsQuery.isError || placesQuery.isError;
  const retryHomeData = async () => {
    await Promise.all([
      familyQuery.refetch(),
      eventsQuery.refetch(),
      placesQuery.refetch(),
      locationsQuery.refetch(),
    ]);
  };

  const myMember = family?.members.find((m) => m.role === "child" && m.user_id === userId) ?? null;
  const childName = myMember?.name || intl.formatMessage({ id: "child.fallback.friend" });

  // ── 오늘 일정 ────────────────────────────────────────────────────────
  const myEvents = useMemo(() => filterEventsForChild(events ?? [], myMember?.id), [events, myMember?.id]);
  const todayViews = useMemo(
    () => groupEventsByDateKey(
      myEvents,
      now,
      locale,
      LEGACY_FAMILY_TIME_ZONE,
      undefined,
      places,
    )[todayKey] ?? [],
    [locale, myEvents, now, todayKey, places],
  );
  const rawById = useMemo(() => {
    const map = new Map<string, CalendarEvent>();
    for (const e of myEvents) map.set(e.id, e);
    return map;
  }, [myEvents]);

  const adventureInput = useMemo<AdventureEventInput[]>(
    () =>
      todayViews.map((v) => ({
        id: v.id,
        title: v.title,
        icon: v.icon,
        startMinutes: timeLabelToMinutes(rawById.get(v.id)?.time ?? null),
        isPast: PAST_TAGS.has(v.tag),
      })),
    [todayViews, rawById],
  );
  const adventure = useMemo(
    () => buildAdventureMap(adventureInput, nowMinutes, locale),
    [adventureInput, locale, nowMinutes],
  );

  const nextView = todayViews.find((v) => v.id === adventure.next?.id) ?? null;
  const nextRaw = adventure.next ? (rawById.get(adventure.next.id) ?? null) : null;
  const minutesToNext =
    adventure.next?.startMinutes != null ? adventure.next.startMinutes - nowMinutes : null;

  const timetable = useMemo<ChildTimetableRow[]>(
    () =>
      todayViews.map((v) => ({
        id: v.id,
        time: v.time,
        icon: v.icon,
        soft: v.soft,
        title: v.title,
        place: v.place,
        done: PAST_TAGS.has(v.tag),
        next: v.id === adventure.next?.id,
      })),
    [todayViews, adventure.next?.id],
  );

  // ── 가방 챙기기(준비물·숙제) ───────────────────────────────────────────
  const suppliesQuery = useDailySupplies(todayKey);
  const supplies = useMemo(() => {
    const all = suppliesQuery.data ?? [];
    return myMember ? all.filter((s) => s.child_user_id === myMember.id) : [];
  }, [suppliesQuery.data, myMember]);
  const upsert = useUpsertDailySupply();
  const remove = useDeleteDailySupply();
  const prepDone = supplies.filter((s) => s.done).length;
  const prepItemCount = supplies.filter((s) => s.kind !== "hw").length;
  const homeworkItemCount = supplies.filter((s) => s.kind === "hw").length;
  const prepPct = supplies.length ? Math.round((prepDone / supplies.length) * 100) : 0;

  const [editMode, setEditMode] = useState(false);
  // 이름 입력은 비제어(defaultValue) — 타이핑마다 리렌더하지 않도록 ref 에 모아 두고 커밋 시점에만 저장한다.
  const draftsRef = useRef<Record<string, string>>({});
  const [celebrate, setCelebrate] = useState<{ icon: string; sub: string } | null>(null);
  const [pendingSupplyAdd, setPendingSupplyAdd] = useState<"prep" | "hw" | null>(null);
  const [pendingSupplyDeleteId, setPendingSupplyDeleteId] = useState<string | null>(null);

  const toggleSupply = (item: DailySupply) => {
    const nowDone = !item.done;
    upsert.mutate(
      {
        id: item.id,
        date_key: todayKey,
        label: item.label,
        done: nowDone,
        kind: item.kind ?? "prep",
        child_user_id: item.child_user_id ?? null,
      },
      {
        onSuccess: () => {
          if (nowDone && !editMode) {
            setCelebrate({
              icon: CELEBRATE_ICON[item.kind ?? "prep"] ?? "sticker/ready.webp",
              sub: intl.formatMessage({ id: "child.home.supply.completed" }, { label: item.label }),
            });
          }
        },
        onError: () => show(intl.formatMessage({ id: "child.home.supply.toggleFailed" }), "⚠️"),
      },
    );
  };

  /**
   * 바뀐 이름을 서버에 저장한다.
   * 서버에는 항목 단위 API 가 없어 "그 날 행 전체를 다시 쓰는" 방식이라, 여러 항목을 동시에 저장하면
   * 나중 요청이 앞 요청을 덮어쓴다 → 반드시 하나씩 await 한다.
   */
  const commitDraft = async (item: DailySupply) => {
    const key = item.id ?? "";
    const draft = draftsRef.current[key];
    if (draft == null) return;
    delete draftsRef.current[key];
    const label = draft.trim();
    if (!label || label === item.label) return;
    try {
      await upsert.mutateAsync({
        id: item.id,
        date_key: todayKey,
        label,
        done: item.done,
        kind: item.kind ?? "prep",
        child_user_id: item.child_user_id ?? null,
      });
    } catch {
      show(intl.formatMessage({ id: "child.home.supply.renameFailed" }), "⚠️");
    }
  };

  /** 편집을 끝낼 때 아직 저장 안 된 이름을 전부 저장한다(입력창이 사라지며 blur 가 안 오는 경우 대비). */
  const finishEdit = async () => {
    for (const item of supplies) await commitDraft(item);
    setEditMode(false);
  };

  const addSupply = (kind: "prep" | "hw") => {
    if (!myMember) {
      show(intl.formatMessage({ id: "child.home.infoMissing" }), "⚠️");
      return;
    }
    if (upsert.isPending) return;
    const itemCount = kind === "hw" ? homeworkItemCount : prepItemCount;
    if (itemCount >= MAX_SUPPLY_ITEMS_PER_KIND) {
      show(dailySupplyLimitMessage(kind, true), "🎒");
      return;
    }
    setPendingSupplyAdd(kind);
    upsert.mutate(
      {
        date_key: todayKey,
        label: intl.formatMessage({ id: kind === "hw" ? "child.home.supply.newHomework" : "child.home.supply.newPrep" }),
        done: false,
        kind,
        child_user_id: myMember.id,
      },
      {
        onError: (error) => show(
          isDailySupplyLimitError(error)
            ? dailySupplyLimitMessage(kind, true)
            : intl.formatMessage({ id: "child.home.supply.addFailed" }),
          isDailySupplyLimitError(error) ? "🎒" : "⚠️",
        ),
        onSettled: () => setPendingSupplyAdd((current) => (current === kind ? null : current)),
      },
    );
  };

  const deleteSupply = (item: DailySupply) => {
    if (remove.isPending) return;
    const itemId = item.id ?? null;
    setPendingSupplyDeleteId(itemId);
    remove.mutate(item, {
      onError: () => show(intl.formatMessage({ id: "child.home.supply.deleteFailed" }), "⚠️"),
      onSettled: () => setPendingSupplyDeleteId((current) => (current === itemId ? null : current)),
    });
  };

  // ── 스티커 ───────────────────────────────────────────────────────────
  const seenStickers = useMemo(
    () => (typeof window === "undefined" ? new Set<string>() : readSeenStickers(window.localStorage, userId)),
    [userId],
  );
  const book = useMemo(
    () => buildStickerBook(receivedStickers.data ?? [], now.getTime(), seenStickers),
    [receivedStickers.data, now, seenStickers],
  );
  const totalStickers = useMemo(
    () => (stickerSummary ?? []).find((r) => r.user_id === userId)?.total_count ?? 0,
    [stickerSummary, userId],
  );
  const newestSlot = useMemo(() => {
    const got = book.slots.filter((s) => s.got && s.latestAt != null);
    if (got.length === 0) return null;
    return got.reduce((a, b) => ((b.latestAt ?? 0) > (a.latestAt ?? 0) ? b : a));
  }, [book.slots]);

  // ── 부모님 대화 ──────────────────────────────────────────────────────
  const memoThread = useMemoThread(memoDateKeys, myMember?.id ?? null);
  const sendMemo = useSendMemo();
  const [pendingQuickStatus, setPendingQuickStatus] = useState<QuickStatusActionId | null>(null);
  const parentNote = latestParentMemoText(memoThread.data);
  const unreadCount = unreadParentMemoCount(memoThread.data, userId);

  const sendQuickStatus = (actionId: QuickStatusActionId, source: "quick-grid" | "route" = "quick-grid") => {
    if (!myMember?.id || !memoDateKey || sendMemo.isPending) return;
    setPendingQuickStatus(source === "quick-grid" ? actionId : null);
    sendMemo.mutate(buildQuickStatusMemo(actionId, myMember.id, memoDateKey), {
      onSuccess: () => show(intl.formatMessage({ id: "child.home.quickStatus.sent" }), "💬"),
      onError: () => show(intl.formatMessage({ id: "child.home.quickStatus.failed" }), "⚠️"),
      onSettled: () => setPendingQuickStatus((current) => (current === actionId ? null : current)),
    });
  };

  // ── AI 친구 ──────────────────────────────────────────────────────────
  const aiEnabled = aiFriend.data?.ai_enabled !== false;
  // 포함분·구매분·부모 상한을 모두 반영한 Worker 정본만 숫자로 보여 준다.
  const aiRemaining = aiCreditStatus.data?.availableRemaining ?? null;
  const aiFriendSavedName = aiFriend.data?.ai_friend_name?.trim() ?? "";
  const aiFriendDisplayName = aiFriendSavedName
    ? resolveAiFriendDisplayName({ savedName: aiFriendSavedName, childName })
    : null;
  const openAiFriend = () => {
    if (!aiEnabled) {
      // i18n 이후에도 이 분기는 반드시 부모 설정 요청을 안내한다: 부모님이 켜 줘야 해.
      show(intl.formatMessage({ id: "child.home.aiDisabled" }), "🤖");
      return;
    }
    if (!aiFriendSavedName) {
      navigate("/child/ai-friend-setup");
      return;
    }
    navigate("/child/ai-friend");
  };

  // ── 오버레이 ─────────────────────────────────────────────────────────
  const [dayOpen, setDayOpen] = useState(false);
  const [routeOpen, setRouteOpen] = useState(false);
  const [playdateOpen, setPlaydateOpen] = useState(false);
  const [callOpen, setCallOpen] = useState(false);

  // 길찾기 출발점: 이 기기가 곧 아이의 위치다. 서버 위치(무료 가족은 빈 배열)보다 GPS 를 먼저 쓴다.
  const serverOrigin = useMemo<RoutePoint | null>(() => {
    const row = (locations ?? []).find((l) => l.user_id === userId);
    return row ? { lat: row.lat, lng: row.lng } : null;
  }, [locations, userId]);
  const [gpsOrigin, setGpsOrigin] = useState<RoutePoint | null>(null);
  useEffect(() => {
    if (!routeOpen || gpsOrigin || typeof navigator === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setGpsOrigin({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {
        /* 권한 거부/실패 → 서버 위치로 폴백. 가짜 좌표는 만들지 않는다. */
      },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 60_000 },
    );
  }, [routeOpen, gpsOrigin]);
  const origin = gpsOrigin ?? serverOrigin;
  const destination = useMemo(() => resolveChildDestination(nextRaw, places), [nextRaw, places]);

  const openRoute = () => {
    if (!adventure.next) {
      show(intl.formatMessage({ id: "child.home.routeDone" }), "🗺️");
      return;
    }
    setRouteOpen(true);
  };

  const departNow = () => {
    setRouteOpen(false);
    if (myMember?.id) sendQuickStatus("departed", "route");
    show(intl.formatMessage({ id: "child.home.departed" }), "🏃");
  };
  const arriveNow = () => {
    setRouteOpen(false);
    sendQuickStatus("arrived", "route");
  };

  const callTargets = useMemo<CallTarget[]>(() => {
    const parents = (family?.members ?? []).filter((m) => m.role === "parent");
    const pick = (gender: "mom" | "dad") => parents.find((m) => m.gender === gender);
    const out: CallTarget[] = [];
    const mom = pick("mom");
    const dad = pick("dad");
    if (mom) out.push({ gender: "mom", label: intl.formatMessage({ id: "child.family.mom" }), phone: mom.phone ?? null });
    if (dad) out.push({ gender: "dad", label: intl.formatMessage({ id: "child.family.dad" }), phone: dad.phone ?? null });
    // 성별이 없는 보호자만 있는 가족: 첫 보호자를 엄마 슬롯으로 보여준다(번호가 있어야 표시).
    if (out.length === 0 && parents[0]?.phone) {
      out.push({ gender: "mom", label: parents[0].name || intl.formatMessage({ id: "child.family.guardian" }), phone: parents[0].phone });
    }
    return out;
  }, [family?.members, intl]);

  const callParent = useCallback(
    (target: CallTarget) => {
      if (!target.phone) return;
      setCallOpen(false);
      show(intl.formatMessage({ id: "child.home.calling" }, { name: target.label }), "📞");
      void placePhoneCall(target.phone).then((r) => {
        if (!r.ok) show(intl.formatMessage({ id: "child.home.callFailed" }), "⚠️");
      });
    },
    [intl, show],
  );

  const dateLabel = formatCalendarDay(now, {
    locale,
    timeZone: LEGACY_FAMILY_TIME_ZONE,
    weekday: "long",
  });

  return (
    <div className="kd-root">
      {/* ── 오늘 모험 지도 ─────────────────────────────────────────── */}
      <div className={`kd-map${adventure.nodes.length === 0 ? " kd-map--empty" : ""}`}>
        <div className="kd-map__stage">
        <span className="kd-map__sun" />
        <span className="kd-map__cloud kd-map__cloud--a" />
        <span className="kd-map__cloud kd-map__cloud--b" />

        <svg className="kd-map__path" viewBox="0 0 390 470" aria-hidden="true" preserveAspectRatio="none">
          <path d={MAP_PATH} fill="none" stroke="rgba(255,255,255,.65)" strokeWidth="14" strokeLinecap="round" />
          <path
            className="kd-map__path-dash"
            d={MAP_PATH}
            fill="none"
            stroke="var(--hy-accent)"
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray="1 18"
          />
        </svg>

        <img className="kd-map__deco kd-map__deco--crosswalk" src={asset("bg/crosswalk.webp")} alt="" />
        <img className="kd-map__deco kd-map__deco--busstop" src={asset("bg/busstop.webp")} alt="" />
        <img className="kd-map__deco kd-map__deco--playground" src={asset("bg/playground.webp")} alt="" />
        <img className="kd-map__deco kd-map__deco--park" src={asset("bg/park.webp")} alt="" />
        </div>

        <div className="kd-map__top">
          <span className="kd-map__date">
            {dateLabel}
          </span>
          <button
            /* i18n 회귀 불변식: aria-label="내 스티커북" → navigate("/child/sticker") */
            type="button"
            className="kd-map__chip kd-map__chip--first hy-press"
            aria-label={intl.formatMessage({ id: "child.stickerBook.title" })}
            onClick={() => navigate("/child/sticker")}
          >
            <img src={asset("ui/crown.webp")} alt="" />
            <span className="kd-map__chip-count">{totalStickers}</span>
          </button>
          <button
            /* i18n 회귀 불변식: aria-label="오늘 시간표" → setDayOpen(true) */
            type="button"
            className="kd-map__chip hy-press"
            aria-label={intl.formatMessage({ id: "child.home.todayTimetable" })}
            onClick={() => setDayOpen(true)}
          >
            <img src={asset("ui/calendar-heart.webp")} alt="" />
            <span className="kd-map__chip-label">
              {intl.formatMessage({ id: "child.home.timetableCount" }, { count: todayViews.length })}
            </span>
          </button>
        </div>

        <div className="kd-map__headline kd-title">
          {intl.formatMessage({ id: "child.home.todayFor" }, { name: childName })}
        </div>

        {homeLoading ? (
          <div className="kd-map__query-state"><Loading label={intl.formatMessage({ id: "child.home.loading" })} size={6} /></div>
        ) : homeError ? (
          <div className="kd-map__query-state" role="alert">
            <span>{intl.formatMessage({ id: "child.home.loadError" })}</span>
            <button type="button" className="hy-press" onClick={() => void retryHomeData()}>
              {intl.formatMessage({ id: "child.action.reload" })}
            </button>
          </div>
        ) : adventure.nodes.length === 0 ? (
          <div className="kd-map__query-state" role="status">{intl.formatMessage({ id: "child.home.noEvents" })}</div>
        ) : (
          adventure.nodes.map((node) => (
            <button
              key={node.id}
              type="button"
              className={`kd-node kd-node--${node.state} hy-press`}
              style={{ left: `${node.leftPct}%`, top: node.top }}
              aria-label={intl.formatMessage(
                { id: node.state === "next" ? "child.home.nodeRouteAria" : "child.home.nodeTimetableAria" },
                { title: node.title },
              )}
              onClick={() => (node.state === "next" ? openRoute() : setDayOpen(true))}
            >
              <span className="kd-node__disc">
                {node.state === "next" && <span className="kd-node__ring" />}
                <img src={asset(node.icon)} alt="" />
                {node.state === "done" && (
                  <img
                    className="kd-node__star"
                    src={asset("ui/star-medal.webp")}
                    alt=""
                    aria-hidden="true"
                  />
                )}
              </span>
              <span className="kd-node__pill">{node.pill}</span>
            </button>
          ))
        )}

        <button
          type="button"
          className="kd-hyeni hy-press"
          onClick={() => (adventure.next ? openRoute() : setDayOpen(true))}
          aria-label={intl.formatMessage({
            id: adventure.next ? "child.home.nextRouteAria" : "child.home.todayTimetableAria",
          })}
        >
          <span className="kd-hyeni__bubble">{adventure.bubble}</span>
          <img className="kd-hyeni__mascot" src={asset("mascot/wave.webp")} alt={intl.formatMessage({ id: "child.home.hyeniAlt" })} />
        </button>
      </div>

      <div className="kd-body">
        {/* ── 안 읽은 부모님 메시지 ─────────────────────────────────── */}
        {/* 혜니가 알림을 잘 확인하지 않는다는 제보(2026-07-16) — 독 배지·타일 배지는
            눈에 잘 안 띄어서, 안 읽은 메시지가 있으면 본문 맨 위에 크게 세운다. */}
        {unreadCount > 0 && (
          <button
            /* i18n 회귀 불변식: className="kd-memo-banner hy-press" → navigate("/child/memo") */
            type="button"
            className="kd-memo-banner hy-press"
            aria-label={intl.formatMessage({ id: "child.home.parentMessagesAria" }, { count: unreadCount })}
            onClick={() => navigate("/child/memo")}
          >
            <img src={asset("ui/chat-heart.webp")} alt="" />
            <span className="kd-memo-banner__main">
              <span className="kd-memo-banner__title">
                {/* i18n 회귀 불변식: 부모님 메시지 {unreadCount}개가 기다리고 있어! */}
                {intl.formatMessage({ id: "child.home.parentMessagesWaiting" }, { count: unreadCount })}
              </span>
              <span className="kd-memo-banner__sub">
                {/* i18n 회귀 불변식: {parentNote ?? "지금 열어봐 💌"} */}
                {parentNote ?? intl.formatMessage({ id: "child.home.openNow" })}
              </span>
            </span>
            <span className="kd-memo-banner__badge">{unreadCount}</span>
          </button>
        )}

        {/* ── 다음 일정 ─────────────────────────────────────────────── */}
        <div className="kd-card kd-next">
          <div className="kd-next__row">
            <span className="kd-next__icon">
              <img src={asset(nextView ? nextView.icon : "mascot/cheer.webp")} alt="" />
            </span>
            <span className="kd-next__main">
              <span className="kd-next__badge">
                {nextView
                  ? minutesToNext != null && minutesToNext > 0 && minutesToNext <= 120
                    ? intl.formatMessage(
                        { id: "child.home.nextEventWithTime" },
                        { relative: formatRelativeMinutes(minutesToNext, "future", locale) },
                      )
                    : intl.formatMessage({ id: "child.home.nextEvent" })
                  : todayViews.length === 0
                    ? intl.formatMessage({ id: "child.home.restDay" })
                    : intl.formatMessage({ id: "child.home.allDone" })}
              </span>
              <span className="kd-next__title kd-title">
                {nextView
                  ? nextView.title
                  : intl.formatMessage({ id: todayViews.length === 0 ? "child.home.noSchedule" : "child.home.restWell" })}
              </span>
              <span className="kd-next__sub">
                {nextView
                  ? intl.formatMessage(
                      { id: nextView.place ? "child.home.eventPlaceTime" : "child.home.eventTime" },
                      { place: nextView.place, time: nextView.time },
                    )
                  : todayViews.length === 0
                    ? intl.formatMessage({ id: "child.home.futureEventsHere" })
                    : intl.formatMessage({ id: "child.home.finishedToday" })}
              </span>
            </span>
          </div>
          {nextView && (
            <button type="button" className="kd-next__cta kd-title hy-press" onClick={openRoute}>
              <Navigation size={20} strokeWidth={2.2} aria-hidden="true" />
              {intl.formatMessage({ id: "child.home.startRoute" })}
            </button>
          )}
        </div>

        {/* ── 가방 챙기기 ───────────────────────────────────────────── */}
        <div className="kd-card">
          <div className="kd-prep__head">
            <span className="kd-title kd-title--icon" style={{ fontSize: "var(--type-title-lg)" }}>
              <Backpack size={20} strokeWidth={2.2} aria-hidden="true" />
              {intl.formatMessage({ id: "child.home.packBag" })}
            </span>
            <span className="kd-prep__count">
              {prepDone}/{supplies.length}
            </span>
            {/* 항목이 0개일 때도 눌러야 첫 준비물을 추가할 수 있다(비활성화하면 영영 못 넣는다). */}
            <button
              type="button"
              className="kd-prep__edit hy-press"
              onClick={() => (editMode ? void finishEdit() : setEditMode(true))}
            >
              {/* i18n 회귀 불변식: supplies.length === 0 ? "추가" : "편집" */}
              {intl.formatMessage({
                id: editMode ? "child.state.done" : supplies.length === 0 ? "child.action.add" : "child.action.edit",
              })}
            </button>
          </div>

          <div className="kd-prep__bar">
            <div className="kd-prep__fill" style={{ width: `${prepPct}%` }} />
          </div>

          <div className="kd-prep__list">
            {suppliesQuery.isLoading ? (
              <div className="kd-prep__empty">{intl.formatMessage({ id: "child.home.supply.loading" })}</div>
            ) : supplies.length === 0 && !editMode ? (
              <div className="kd-prep__empty">{intl.formatMessage({ id: "child.home.supply.empty" })}</div>
            ) : (
              supplies.map((s) => (
                <div key={s.id} className="kd-prep__row">
                  <button
                    type="button"
                    className="kd-prep__check hy-press"
                    aria-label={intl.formatMessage({ id: "child.home.supply.checkAria" }, { label: s.label })}
                    aria-pressed={s.done}
                    data-done={s.done}
                    onClick={() => toggleSupply(s)}
                  >
                    <Check size={19} strokeWidth={3.4} color="var(--bg-card)" style={{ opacity: s.done ? 1 : 0 }} />
                  </button>
                  {/* 아이콘 출처는 장소관리·일정등록과 같다("태권도복" → 도복 캐릭터). 못 찾으면 종류별 기본. */}
                  <img
                    className="kd-prep__icon"
                    src={asset(resolveEventVisualAsset(s.label, s.kind === "hw" ? "school" : "other"))}
                    alt=""
                  />
                  {editMode ? (
                    <>
                      <input
                        className="kd-prep__input"
                        defaultValue={s.label}
                        aria-label={intl.formatMessage({ id: "child.home.supply.nameAria" })}
                        onChange={(e) => {
                          draftsRef.current[s.id ?? ""] = e.target.value;
                        }}
                        onBlur={() => void commitDraft(s)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                        }}
                      />
                      <button
                        type="button"
                        className="kd-prep__del hy-press"
                        aria-label={intl.formatMessage({ id: "child.home.supply.deleteAria" }, { label: s.label })}
                        onClick={() => deleteSupply(s)}
                        disabled={remove.isPending}
                        aria-busy={remove.isPending && pendingSupplyDeleteId === s.id}
                      >
                        <X size={16} strokeWidth={2.4} color="var(--danger-500)" />
                      </button>
                    </>
                  ) : (
                    <button type="button" className="kd-prep__label" onClick={() => toggleSupply(s)}>
                      <span className="kd-prep__text" data-done={s.done}>
                        {s.label}
                      </span>
                      {s.kind === "hw" && <span className="kd-prep__kind">{intl.formatMessage({ id: "child.home.homework" })}</span>}
                    </button>
                  )}
                </div>
              ))
            )}

            {editMode && (
              <div className="kd-prep__addrow">
                <button
                  type="button"
                  className="kd-prep__add kd-prep__add--prep hy-press"
                  onClick={() => addSupply("prep")}
                  disabled={upsert.isPending || prepItemCount >= MAX_SUPPLY_ITEMS_PER_KIND}
                  aria-label={prepItemCount >= MAX_SUPPLY_ITEMS_PER_KIND
                    ? intl.formatMessage({ id: "child.home.supply.prepLimitAria" }, { count: MAX_SUPPLY_ITEMS_PER_KIND })
                    : intl.formatMessage({ id: "child.home.supply.addPrepAria" })}
                  aria-busy={upsert.isPending && pendingSupplyAdd === "prep"}
                >
                  {prepItemCount >= MAX_SUPPLY_ITEMS_PER_KIND
                    ? intl.formatMessage(
                        { id: "child.home.supply.prepCount" },
                        { count: prepItemCount, limit: MAX_SUPPLY_ITEMS_PER_KIND },
                      )
                    : intl.formatMessage({ id: "child.home.supply.addPrep" })}
                </button>
                <button
                  type="button"
                  className="kd-prep__add kd-prep__add--hw hy-press"
                  onClick={() => addSupply("hw")}
                  disabled={upsert.isPending || homeworkItemCount >= MAX_SUPPLY_ITEMS_PER_KIND}
                  aria-label={homeworkItemCount >= MAX_SUPPLY_ITEMS_PER_KIND
                    ? intl.formatMessage({ id: "child.home.supply.homeworkLimitAria" }, { count: MAX_SUPPLY_ITEMS_PER_KIND })
                    : intl.formatMessage({ id: "child.home.supply.addHomeworkAria" })}
                  aria-busy={upsert.isPending && pendingSupplyAdd === "hw"}
                >
                  {homeworkItemCount >= MAX_SUPPLY_ITEMS_PER_KIND
                    ? intl.formatMessage(
                        { id: "child.home.supply.homeworkCount" },
                        { count: homeworkItemCount, limit: MAX_SUPPLY_ITEMS_PER_KIND },
                      )
                    : intl.formatMessage({ id: "child.home.supply.addHomework" })}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── 최신 스티커 알림 ──────────────────────────────────────── */}
        {newestSlot && (
          <button type="button" className="kd-sticker-banner hy-press" onClick={() => navigate("/child/sticker")}>
            <img src={asset(newestSlot.img)} alt="" />
            <span className="kd-sticker-banner__main">
              <span className="kd-sticker-banner__title">
                {book.newCount > 0
                  ? intl.formatMessage({ id: "child.home.sticker.new" }, { label: newestSlot.label })
                  : intl.formatMessage({ id: "child.home.sticker.received" }, { label: newestSlot.label })}
              </span>
              <span className="kd-sticker-banner__sub">{intl.formatMessage({ id: "child.home.sticker.openBook" })}</span>
            </span>
          </button>
        )}

        {/* ── 바로 할 수 있어 ───────────────────────────────────────── */}
        <section>
          <div className="kd-sec-title kd-title">{intl.formatMessage({ id: "child.home.quickActions" })}</div>
          <div className="kd-tiles">
            <button type="button" className="kd-tile hy-press" onClick={() => navigate("/child/memo")}>
              {unreadCount > 0 && <span className="kd-tile__badge">{unreadCount}</span>}
              <img src={asset("ui/chat-heart.webp")} alt="" />
              <span>
                <span className="kd-tile__title">{intl.formatMessage({ id: "child.home.talkToParents" })}</span>
                <span className="kd-tile__sub">
                  {parentNote ?? intl.formatMessage({ id: "child.home.tellToday" })}
                </span>
              </span>
            </button>

            <button type="button" className="kd-tile kd-tile--bob hy-press" onClick={openAiFriend}>
              <img src={asset("ui/ai-robot.webp")} alt="" />
              <span>
                <span className="kd-tile__title">
                  {aiFriendDisplayName
                    ? intl.formatMessage({ id: "child.home.meetAiNamed" }, { name: aiFriendDisplayName })
                    : intl.formatMessage({ id: "child.home.meetAi" })}
                </span>
                <span className="kd-tile__sub">
                  {!aiEnabled
                    ? intl.formatMessage({ id: "child.home.aiNeedsParent" })
                    : aiRemaining != null
                      ? intl.formatMessage({ id: "child.home.aiRemaining" }, { count: aiRemaining })
                      : intl.formatMessage({ id: "child.home.talkToday" })}
                </span>
              </span>
            </button>

            <button type="button" className="kd-tile hy-press" onClick={() => setPlaydateOpen(true)}>
              <img src={asset("ui/menu-friend-playdate.webp")} alt="" />
              <span>
                <span className="kd-tile__title">{intl.formatMessage({ id: "child.home.playWithFriend" })}</span>
                <span className="kd-tile__sub">{intl.formatMessage({ id: "child.home.findFriend" })}</span>
              </span>
            </button>

            <button type="button" className="kd-tile hy-press" onClick={() => setCallOpen(true)}>
              <img src={asset("ui/phone-lavender.webp")} alt="" />
              <span>
                <span className="kd-tile__title">{intl.formatMessage({ id: "child.call.title" })}</span>
                <span className="kd-tile__sub">
                  {intl.formatMessage({
                    id: callTargets.length > 0 ? "child.home.callFamily" : "child.home.askRegisterPhone",
                  })}
                </span>
              </span>
            </button>
          </div>
        </section>

        {/* ── 지금 상태 보내기 ──────────────────────────────────────── */}
        <div className="kd-card">
          <div className="kd-status__head">
            <span className="kd-title kd-title--icon" style={{ fontSize: "var(--type-title-lg)" }}>
              <MessageCircle size={20} strokeWidth={2.2} aria-hidden="true" />
              {intl.formatMessage({ id: "child.home.sendStatus" })}
            </span>
            <span className="kd-status__sub">{intl.formatMessage({ id: "child.home.sendStatusHint" })}</span>
          </div>
          <div className="kd-status__grid">
            {QUICK_STATUS_ACTIONS.map((action) => (
              <button
                key={action.id}
                type="button"
                className="kd-status__btn hy-press"
                onClick={() => sendQuickStatus(action.id)}
                disabled={sendMemo.isPending || !myMember}
                aria-busy={sendMemo.isPending && pendingQuickStatus === action.id}
              >
                <img src={asset(QUICK_STATUS_ICONS[action.id])} alt="" />
                <span>{intl.formatMessage({ id: `child.home.quickStatus.${action.id}` })}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── 오늘 시간표 ───────────────────────────────────────────── */}
        <div className="kd-card">
          <div className="kd-tt__head">
            <img src={asset("ui/calendar-heart.webp")} alt="" />
            <span className="kd-title" style={{ fontSize: "var(--type-title-lg)" }}>
              {intl.formatMessage({ id: "child.home.todayTimetable" })}
            </span>
            <span className="kd-tt__date">{dateLabel}</span>
          </div>
          <ChildTimetableList rows={timetable} />
        </div>

        {/* ── 내 색깔 고르기 ────────────────────────────────────────── */}
        <div className="kd-card">
          <div className="kd-color__head">
            <span className="kd-title kd-title--icon" style={{ fontSize: "var(--type-title-lg)" }}>
              <Palette size={20} strokeWidth={2.2} aria-hidden="true" />
              {intl.formatMessage({ id: "child.home.chooseColor" })}
            </span>
            <span className="kd-color__hint">{intl.formatMessage({ id: "child.home.colorHint" })}</span>
          </div>
          <div className="kd-color__row">
            {CHILD_ACCENTS.map((c) => {
              const accentLabel = intl.formatMessage({ id: `child.home.accent.${c.key}` });
              return (
              <button
                key={c.key}
                type="button"
                className="kd-color__btn hy-press"
                aria-label={accentLabel}
                aria-pressed={accent === c.key}
                style={{ color: c.color }}
                onClick={() => {
                  setAccent(c.key);
                  show(intl.formatMessage({ id: "child.home.colorChanged" }, { color: accentLabel }), "🎨");
                }}
              >
                <span className="kd-color__dot" />
                <span className="kd-color__label">{accentLabel}</span>
              </button>
              );
            })}
          </div>
        </div>

        {/* ── 내 위치 · 내 설정(시안엔 없지만 아이가 닿아야 하는 화면) ── */}
        <div className="kd-more">
          <button type="button" className="kd-more__btn hy-press" onClick={() => navigate("/child/location-status")}>
            <MapPin size={22} strokeWidth={2.4} color="var(--hy-accent-deep)" />
            {intl.formatMessage({ id: "child.location.title" })}
          </button>
          <button type="button" className="kd-more__btn hy-press" onClick={() => navigate("/child/settings")}>
            <Settings2 size={22} strokeWidth={2.4} color="var(--fg-muted)" />
            {intl.formatMessage({ id: "child.settings.title" })}
          </button>
        </div>
      </div>

      {/* ── 오버레이 ─────────────────────────────────────────────────── */}
      <DaySheet
        open={dayOpen}
        onClose={() => setDayOpen(false)}
        dateLabel={dateLabel}
        rows={timetable}
        parentNote={parentNote}
        onOpenMemo={() => {
          setDayOpen(false);
          navigate("/child/memo");
        }}
      />

      <RouteSheet
        open={routeOpen}
        onClose={() => setRouteOpen(false)}
        destinationName={destination?.name ?? nextView?.title ?? intl.formatMessage({ id: "child.home.nextEvent" })}
        icon={nextView?.icon ?? "ui/pin-heart.webp"}
        origin={origin}
        destination={destination?.point ?? null}
        onDepart={departNow}
        onArrive={arriveNow}
        onOpenMap={() => {
          setRouteOpen(false);
          navigate("/route");
        }}
        sending={sendMemo.isPending}
      />

      <PlaydateSheet open={playdateOpen} onClose={() => setPlaydateOpen(false)} onError={(m) => show(m, "⚠️")} />

      <CallSheet open={callOpen} onClose={() => setCallOpen(false)} targets={callTargets} onCall={callParent} />

      <Celebrate icon={celebrate?.icon ?? null} sub={celebrate?.sub ?? ""} onClose={() => setCelebrate(null)} />
    </div>
  );
}

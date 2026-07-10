import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, MapPin, Settings2, X } from "lucide-react";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { useAccent } from "@/app/accent";
import { useAuth } from "@/auth/AuthContext";
import { useMyFamily } from "@/queries/useFamily";
import { useEvents, useDailySupplies, useUpsertDailySupply, useDeleteDailySupply } from "@/queries/useSchedule";
import { useSavedPlaces, useChildLocations } from "@/queries/useLocation";
import { useStickerSummary, useReceivedStickers } from "@/queries/useStickers";
import { useMemoThread, useSendMemo } from "@/queries/useMemo";
import { useAiFriendPublicSettings, useAiUsageToday } from "@/queries/useAi";
import { placePhoneCall } from "@/lib/native/phone";
import type { DailySupply, CalendarEvent } from "@/lib/api/endpoints/schedule";
import type { RoutePoint } from "@/lib/api/endpoints/route";
import { groupEventsByDateKey, PAST_TAGS } from "@/transform/scheduleView";
import { todayDateKey } from "@/transform/dateKey";
import { filterEventsForChild } from "@/transform/eventScope";
import { QUICK_STATUS_ACTIONS, buildQuickStatusMemo, type QuickStatusActionId } from "@/transform/quickStatusShare";
import { buildAdventureMap, timeLabelToMinutes, type AdventureEventInput } from "@/transform/adventureMap";
import { buildStickerBook, readSeenStickers } from "@/transform/stickerBook";
import { resolveEventVisualAsset } from "@/transform/placeVisual";
import { CHILD_ACCENTS } from "@/transform/childAccent";
import {
  latestParentMemoText,
  remainingAiChats,
  resolveChildDestination,
  unreadParentMemoCount,
} from "@/transform/childHomeData";
import { ChildTimetableList, type ChildTimetableRow } from "./ChildTimetable";
import { DaySheet } from "./overlays/DaySheet";
import { RouteSheet } from "./overlays/RouteSheet";
import { PlaydateSheet } from "./overlays/PlaydateSheet";
import { CallSheet, type CallTarget } from "./overlays/CallSheet";
import { Celebrate } from "./overlays/Celebrate";
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
  const navigate = useNavigate();
  const { show } = useToast();
  const { accent, setAccent } = useAccent();
  const { userId } = useAuth();

  const now = useMemo(() => new Date(), []);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const todayKey = useMemo(() => todayDateKey(now), [now]);

  const { data: family } = useMyFamily();
  const { data: events } = useEvents();
  const { data: places } = useSavedPlaces();
  const { data: locations } = useChildLocations();
  const { data: stickerSummary } = useStickerSummary();
  const receivedStickers = useReceivedStickers(userId);
  const aiFriend = useAiFriendPublicSettings(userId);
  const aiUsage = useAiUsageToday(userId);

  const myMember = family?.members.find((m) => m.role === "child" && m.user_id === userId) ?? null;
  const childName = myMember?.name || "친구";

  // ── 오늘 일정 ────────────────────────────────────────────────────────
  const myEvents = useMemo(() => filterEventsForChild(events ?? [], myMember?.id), [events, myMember?.id]);
  const todayViews = useMemo(
    () => groupEventsByDateKey(myEvents, now, undefined, places)[todayKey] ?? [],
    [myEvents, now, todayKey, places],
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
  const adventure = useMemo(() => buildAdventureMap(adventureInput, nowMinutes), [adventureInput, nowMinutes]);

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
  const prepPct = supplies.length ? Math.round((prepDone / supplies.length) * 100) : 0;

  const [editMode, setEditMode] = useState(false);
  // 이름 입력은 비제어(defaultValue) — 타이핑마다 리렌더하지 않도록 ref 에 모아 두고 커밋 시점에만 저장한다.
  const draftsRef = useRef<Record<string, string>>({});
  const [celebrate, setCelebrate] = useState<{ icon: string; sub: string } | null>(null);

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
              sub: `'${item.label}' 챙기기 완료!`,
            });
          }
        },
        onError: () => show("안 됐어. 다시 눌러볼래?", "⚠️"),
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
      show("못 바꿨어. 다시 해볼래?", "⚠️");
    }
  };

  /** 편집을 끝낼 때 아직 저장 안 된 이름을 전부 저장한다(입력창이 사라지며 blur 가 안 오는 경우 대비). */
  const finishEdit = async () => {
    for (const item of supplies) await commitDraft(item);
    setEditMode(false);
  };

  const addSupply = (kind: "prep" | "hw") => {
    if (!myMember) {
      show("내 정보를 아직 못 찾았어. 잠시 후 다시 해볼래?", "⚠️");
      return;
    }
    if (upsert.isPending) return;
    upsert.mutate(
      {
        date_key: todayKey,
        label: kind === "hw" ? "새 숙제" : "새 준비물",
        done: false,
        kind,
        child_user_id: myMember.id,
      },
      { onError: () => show("추가하지 못했어. 다시 해볼래?", "⚠️") },
    );
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
  const memoThread = useMemoThread(useMemo(() => [todayKey], [todayKey]), myMember?.id ?? null);
  const sendMemo = useSendMemo();
  const parentNote = latestParentMemoText(memoThread.data);
  const unreadCount = unreadParentMemoCount(memoThread.data, userId);

  const sendQuickStatus = (actionId: QuickStatusActionId) => {
    if (!myMember?.id || sendMemo.isPending) return;
    sendMemo.mutate(buildQuickStatusMemo(actionId, myMember.id, todayKey), {
      onSuccess: () => show("부모님께 보냈어", "💬"),
      onError: () => show("보내지 못했어. 잠시 후 다시 해줘", "⚠️"),
    });
  };

  // ── AI 친구 ──────────────────────────────────────────────────────────
  const aiEnabled = aiFriend.data?.ai_enabled !== false;
  const aiRemaining = remainingAiChats(aiFriend.data?.daily_limit, aiUsage.data?.count ?? 0);
  const openAiFriend = () => {
    if (!aiEnabled) {
      show("AI 친구는 부모님이 켜줘야 해. 부탁해봐! 🙏", "🤖");
      return;
    }
    if (!aiFriend.data?.ai_friend_name?.trim()) {
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
      show("오늘 갈 곳은 다 다녀왔어 🎉", "🗺️");
      return;
    }
    setRouteOpen(true);
  };

  const departNow = () => {
    setRouteOpen(false);
    if (myMember?.id) sendQuickStatus("departed");
    show("좋아! 도착하면 알려줘 🧡", "🏃");
  };
  const arriveNow = () => {
    setRouteOpen(false);
    sendQuickStatus("arrived");
  };

  const callTargets = useMemo<CallTarget[]>(() => {
    const parents = (family?.members ?? []).filter((m) => m.role === "parent");
    const pick = (gender: "mom" | "dad") => parents.find((m) => m.gender === gender);
    const out: CallTarget[] = [];
    const mom = pick("mom");
    const dad = pick("dad");
    if (mom) out.push({ gender: "mom", label: "엄마", phone: mom.phone ?? null });
    if (dad) out.push({ gender: "dad", label: "아빠", phone: dad.phone ?? null });
    // 성별이 없는 보호자만 있는 가족: 첫 보호자를 엄마 슬롯으로 보여준다(번호가 있어야 표시).
    if (out.length === 0 && parents[0]?.phone) {
      out.push({ gender: "mom", label: parents[0].name || "보호자", phone: parents[0].phone });
    }
    return out;
  }, [family?.members]);

  const callParent = useCallback(
    (target: CallTarget) => {
      if (!target.phone) return;
      setCallOpen(false);
      show(`${target.label}한테 전화 거는 중...`, "📞");
      void placePhoneCall(target.phone);
    },
    [show],
  );

  const dateLabel = `${now.getMonth() + 1}월 ${now.getDate()}일`;
  const weekday = ["일", "월", "화", "수", "목", "금", "토"][now.getDay()];

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
            {dateLabel} {weekday}요일
          </span>
          <button
            type="button"
            className="kd-map__chip kd-map__chip--first hy-press"
            aria-label="내 스티커북"
            onClick={() => navigate("/child/sticker")}
          >
            <img src={asset("ui/crown.webp")} alt="" />
            <span className="kd-map__chip-count">{totalStickers}</span>
          </button>
          <button
            type="button"
            className="kd-map__chip hy-press"
            aria-label="오늘 시간표"
            onClick={() => setDayOpen(true)}
          >
            <img src={asset("ui/calendar-heart.webp")} alt="" />
            <span className="kd-map__chip-label">시간표{todayViews.length > 0 ? ` ${todayViews.length}` : ""}</span>
          </button>
        </div>

        <div className="kd-map__headline kd-title">{childName}의 오늘 모험!</div>

        {adventure.nodes.map((node) => (
          <button
            key={node.id}
            type="button"
            className={`kd-node kd-node--${node.state} hy-press`}
            style={{ left: `${node.leftPct}%`, top: node.top }}
            aria-label={`${node.title} ${node.state === "next" ? "· 길찾기" : "· 시간표 보기"}`}
            onClick={() => (node.state === "next" ? openRoute() : setDayOpen(true))}
          >
            <span className="kd-node__disc">
              {node.state === "next" && <span className="kd-node__ring" />}
              <img src={asset(node.icon)} alt="" />
              {node.state === "done" && (
                <span className="kd-node__star" aria-hidden="true">
                  ⭐
                </span>
              )}
            </span>
            <span className="kd-node__pill">{node.pill}</span>
          </button>
        ))}

        <button
          type="button"
          className="kd-hyeni hy-press"
          onClick={() => (adventure.next ? openRoute() : setDayOpen(true))}
          aria-label={adventure.next ? "다음 일정 길찾기" : "오늘 시간표 보기"}
        >
          <span className="kd-hyeni__bubble">{adventure.bubble}</span>
          <img className="kd-hyeni__mascot" src={asset("mascot/wave.webp")} alt="혜니" />
        </button>
      </div>

      <div className="kd-body">
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
                    ? `다음 일정 · ${minutesToNext}분 뒤`
                    : "다음 일정"
                  : "오늘 다 끝났어"}
              </span>
              <span className="kd-next__title kd-title">{nextView ? nextView.title : "푹 쉬어도 돼"}</span>
              <span className="kd-next__sub">
                {nextView
                  ? `${nextView.place ? `${nextView.place} · ` : ""}${nextView.time}`
                  : "오늘 일정을 다 마쳤어 🎉"}
              </span>
            </span>
          </div>
          {nextView && (
            <button type="button" className="kd-next__cta kd-title hy-press" onClick={openRoute}>
              길찾기 출발! 🚀
            </button>
          )}
        </div>

        {/* ── 가방 챙기기 ───────────────────────────────────────────── */}
        <div className="kd-card">
          <div className="kd-prep__head">
            <span className="kd-title" style={{ fontSize: 20 }}>
              🎒 가방 챙기기
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
              {editMode ? "완료" : supplies.length === 0 ? "추가" : "편집"}
            </button>
          </div>

          <div className="kd-prep__bar">
            <div className="kd-prep__fill" style={{ width: `${prepPct}%` }} />
          </div>

          <div className="kd-prep__list">
            {suppliesQuery.isLoading ? (
              <div className="kd-prep__empty">챙길 걸 불러오는 중…</div>
            ) : supplies.length === 0 && !editMode ? (
              <div className="kd-prep__empty">아직 챙길 게 없어 🎒</div>
            ) : (
              supplies.map((s) => (
                <div key={s.id} className="kd-prep__row">
                  <button
                    type="button"
                    className="kd-prep__check hy-press"
                    aria-label={`${s.label} 완료 체크`}
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
                        aria-label="항목 이름"
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
                        aria-label={`${s.label} 지우기`}
                        onClick={() => remove.mutate(s, { onError: () => show("못 지웠어. 다시 해볼래?", "⚠️") })}
                        disabled={remove.isPending}
                      >
                        <X size={16} strokeWidth={2.6} color="var(--danger-500)" />
                      </button>
                    </>
                  ) : (
                    <button type="button" className="kd-prep__label" onClick={() => toggleSupply(s)}>
                      <span className="kd-prep__text" data-done={s.done}>
                        {s.label}
                      </span>
                      {s.kind === "hw" && <span className="kd-prep__kind">숙제</span>}
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
                  disabled={upsert.isPending}
                >
                  + 준비물
                </button>
                <button
                  type="button"
                  className="kd-prep__add kd-prep__add--hw hy-press"
                  onClick={() => addSupply("hw")}
                  disabled={upsert.isPending}
                >
                  + 숙제
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
                  ? `"${newestSlot.label}" 스티커가 새로 왔어!`
                  : `"${newestSlot.label}" 스티커를 받았어`}
              </span>
              <span className="kd-sticker-banner__sub">스티커북에서 열어봐 💝</span>
            </span>
          </button>
        )}

        {/* ── 바로 할 수 있어 ───────────────────────────────────────── */}
        <section>
          <div className="kd-sec-title kd-title">바로 할 수 있어</div>
          <div className="kd-tiles">
            <button type="button" className="kd-tile hy-press" onClick={() => navigate("/child/memo")}>
              {unreadCount > 0 && <span className="kd-tile__badge">{unreadCount}</span>}
              <img src={asset("ui/chat-heart.webp")} alt="" />
              <span>
                <span className="kd-tile__title">부모님과 이야기</span>
                <span className="kd-tile__sub">{parentNote ?? "오늘 있었던 일을 들려줘"}</span>
              </span>
            </button>

            <button type="button" className="kd-tile kd-tile--bob hy-press" onClick={openAiFriend}>
              <img src={asset("mascot/wave.webp")} alt="" />
              <span>
                <span className="kd-tile__title">혜니랑 말하기</span>
                <span className="kd-tile__sub">
                  {!aiEnabled
                    ? "부모님이 켜주면 놀 수 있어"
                    : aiRemaining != null
                      ? `💬 ${aiRemaining}번 남았어`
                      : "오늘 얘기해볼까?"}
                </span>
              </span>
            </button>

            <button type="button" className="kd-tile hy-press" onClick={() => setPlaydateOpen(true)}>
              <img src={asset("ui/menu-friend-playdate.webp")} alt="" />
              <span>
                <span className="kd-tile__title">친구랑 놀기</span>
                <span className="kd-tile__sub">같이 놀 친구 찾기</span>
              </span>
            </button>

            <button type="button" className="kd-tile hy-press" onClick={() => setCallOpen(true)}>
              <img src={asset("ui/phone-lavender.webp")} alt="" />
              <span>
                <span className="kd-tile__title">부모님 전화</span>
                <span className="kd-tile__sub">
                  {callTargets.length > 0 ? callTargets.map((t) => t.label).join(" · ") : "번호를 등록해 달라고 하자"}
                </span>
              </span>
            </button>
          </div>
        </section>

        {/* ── 지금 상태 보내기 ──────────────────────────────────────── */}
        <div className="kd-card">
          <div className="kd-status__head">
            <span className="kd-title" style={{ fontSize: 20 }}>
              💬 지금 상태 보내기
            </span>
            <span className="kd-status__sub">누르면 바로 알려줄게</span>
          </div>
          <div className="kd-status__grid">
            {QUICK_STATUS_ACTIONS.map((action) => (
              <button
                key={action.id}
                type="button"
                className="kd-status__btn hy-press"
                onClick={() => sendQuickStatus(action.id)}
                disabled={sendMemo.isPending || !myMember}
              >
                <img src={asset(QUICK_STATUS_ICONS[action.id])} alt="" />
                <span>{action.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── 오늘 시간표 ───────────────────────────────────────────── */}
        <div className="kd-card">
          <div className="kd-tt__head">
            <img src={asset("ui/calendar-heart.webp")} alt="" />
            <span className="kd-title" style={{ fontSize: 20 }}>
              오늘 시간표
            </span>
            <span className="kd-tt__date">{dateLabel}</span>
          </div>
          <ChildTimetableList rows={timetable} />
        </div>

        {/* ── 내 색깔 고르기 ────────────────────────────────────────── */}
        <div className="kd-card">
          <div className="kd-color__head">
            <span className="kd-title" style={{ fontSize: 20 }}>
              🎨 내 색깔 고르기
            </span>
            <span className="kd-color__hint">앱 색이 바뀌어</span>
          </div>
          <div className="kd-color__row">
            {CHILD_ACCENTS.map((c) => (
              <button
                key={c.key}
                type="button"
                className="kd-color__btn hy-press"
                aria-label={c.label}
                aria-pressed={accent === c.key}
                style={{ color: c.color }}
                onClick={() => {
                  setAccent(c.key);
                  show(`${c.label} 색으로 바꿨어!`, "🎨");
                }}
              >
                <span className="kd-color__dot" />
                <span className="kd-color__label">{c.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── 내 위치 · 내 설정(시안엔 없지만 아이가 닿아야 하는 화면) ── */}
        <div className="kd-more">
          <button type="button" className="kd-more__btn hy-press" onClick={() => navigate("/child/location-status")}>
            <MapPin size={19} strokeWidth={2.4} color="var(--hy-accent-deep)" />내 위치
          </button>
          <button type="button" className="kd-more__btn hy-press" onClick={() => navigate("/child/settings")}>
            <Settings2 size={19} strokeWidth={2.4} color="var(--fg-muted)" />내 설정
          </button>
        </div>
      </div>

      {/* ── 오버레이 ─────────────────────────────────────────────────── */}
      <DaySheet
        open={dayOpen}
        onClose={() => setDayOpen(false)}
        dateLabel={`${dateLabel} ${weekday}요일`}
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
        destinationName={destination?.name ?? nextView?.title ?? "다음 일정"}
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

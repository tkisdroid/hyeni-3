import { useIntl, type IntlShape } from "react-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import { useNavigate } from "react-router";
import { AlertTriangle, Check, RefreshCw } from "lucide-react";
import settings3dIcon from "../../../assets/01-runtime-3d/ui/settings.webp";
import { asset } from "@/lib/assets";
import { childAvatarPath } from "@/lib/avatar";
import { useToast } from "@/app/toast";
import { Loading } from "@/components/ui/Loading";
import { TopBar } from "@/components/ui/TopBar";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { shortcuts } from "@/data/mock";
import { useEvents, useDailySupplies, useUpsertDailySupply } from "@/queries/useSchedule";
import type { CalendarEvent, DailySupply } from "@/lib/api/endpoints/schedule";
import { useChildNotifSettingsStatus, useParentAlerts } from "@/queries/useNotifications";
import { countUnread } from "@/transform/notificationsView";
import { useMyFamily } from "@/queries/useFamily";
import { ReferralRewardPanel } from "@/components/ReferralRewardPanel";
import { REFERRAL_REWARD_CREDITS_DISPLAY } from "@/transform/referralReward";
import { useActiveChild } from "@/app/activeChild";
import { useAuth } from "@/auth/AuthContext";
import { requestDeviceStatus } from "@/lib/api/endpoints/remote";
import { loadKakaoMaps } from "@/lib/kakaoMap";
import { useChildLocations, useSavedPlaces } from "@/queries/useLocation";
import { useLocationLabels } from "@/queries/useLocationLabels";
import type { ChildLocation } from "@/lib/api/endpoints/location";
import { groupEventsByDateKey, PAST_TAGS, type CalEventView } from "@/transform/scheduleView";
import { useVisitVerify } from "@/queries/useVisitVerify";
import { dateToDateKeyInTimeZone } from "@/transform/dateKey";
import { filterEventsForChild } from "@/transform/eventScope";
import { deviceStatusView } from "@/transform/familyView";
import { resolveDeviceLabel } from "@/transform/deviceLabel";
import { nearestPlace, EXACT_SAVED_PLACE_LABEL_RADIUS_M } from "@/transform/locationView";
import { useEntitlement } from "@/queries/useEntitlement";
import { TIERS, locationModeFor } from "@/transform/tierPolicy";
import { resolveLocationTrustCopy } from "@/transform/locationTrustCopy";
import { PremiumUpsell } from "@/components/PremiumUpsell";
import {
  browserPremiumValueMomentStorage,
  findNewSuccessfulArrival,
  markPremiumValueMomentOffered,
  wasPremiumValueMomentOffered,
  type PremiumValueMomentSource,
} from "@/transform/premiumValueMoment";
import {
  browserPremiumReturnIntentStorage,
  savePremiumReturnIntent,
} from "@/transform/premiumReturnIntent";
import { resolveParentHomeSubscriptionCard } from "@/transform/parentHomeSubscriptionCard";
import { resolveParentHomeDeviceFinder } from "@/transform/parentHomeShortcut";
import { useLocale } from "@/i18n/useLocale";
import { formatCalendarDay, LEGACY_FAMILY_TIME_ZONE } from "@/i18n/format";
import {
  PARENT_HOME_SECTION_IDS,
  moveParentHomeSection,
  normalizeParentHomeSectionOrder,
  parentHomeReorderHintStorageKey,
  parentHomeSectionOrderStorageKey,
  type ParentHomeSectionId,
} from "@/transform/parentHomeSectionOrder";
import { openExternal } from "@/lib/native/browser";
import { ParentHomeHeroCarousel } from "@/components/ParentHomeHeroCarousel";
import { useParentHomeHeroCarousel } from "@/queries/useParentHomeHero";
import { resolveParentHomeHeroSlides } from "@/transform/parentHomeHeroCarousel";
import "./ParentHome.css";
import "./ParentHome.redesign.css";

function avatarSrc(path: string): string {
  return path.startsWith("http") || path.startsWith("blob:") ? path : asset(path);
}

const SCHEDULE_PLACE_RADIUS_M = 150;

type ChildScheduleEvent = {
  raw: CalendarEvent;
  view: CalEventView;
};

type ReorderableHomeSectionProps = {
  id: ParentHomeSectionId;
  order: number;
  dragging: boolean;
  children: ReactNode;
  setElement: (id: ParentHomeSectionId, element: HTMLDivElement | null) => void;
  onPointerDown: (id: ParentHomeSectionId, event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (id: ParentHomeSectionId, event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerEnd: (id: ParentHomeSectionId, event: ReactPointerEvent<HTMLDivElement>) => void;
  onKeyDown: (id: ParentHomeSectionId, event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onClickCapture: (id: ParentHomeSectionId, event: ReactMouseEvent<HTMLDivElement>) => void;
  onContextMenu: (id: ParentHomeSectionId, event: ReactMouseEvent<HTMLDivElement>) => void;
  handleLabel: string;
};

function ReorderableHomeSection({
  id,
  order,
  dragging,
  children,
  setElement,
  onPointerDown,
  onPointerMove,
  onPointerEnd,
  onKeyDown,
  onClickCapture,
  onContextMenu,
  handleLabel,
}: ReorderableHomeSectionProps) {
  return (
    <div
      ref={(element) => setElement(id, element)}
      className={`ph-home-section${dragging ? " ph-home-section--dragging" : ""}`}
      data-section-id={id}
      style={{ order }}
      tabIndex={0}
      aria-label={handleLabel}
      aria-grabbed={dragging}
      onPointerDown={(event) => onPointerDown(id, event)}
      onPointerMove={(event) => onPointerMove(id, event)}
      onPointerUp={(event) => onPointerEnd(id, event)}
      onPointerCancel={(event) => onPointerEnd(id, event)}
      onKeyDown={(event) => onKeyDown(id, event)}
      onClickCapture={(event) => onClickCapture(id, event)}
      onContextMenu={(event) => onContextMenu(id, event)}
    >
      <div className="ph-home-section__content" inert={dragging ? true : undefined}>
        {children}
      </div>
    </div>
  );
}

const SECTION_LONG_PRESS_MS = 380;
const SECTION_LONG_PRESS_MOVE_TOLERANCE_PX = 10;
const SECTION_DRAG_PREVIEW_MAX_HEIGHT_PX = 280;
const SECTION_REORDER_HINT_DELAY_MS = 700;
const reorderHintShownThisRun = new Set<string>();

type SectionDragSession = {
  id: ParentHomeSectionId;
  pointerId: number;
  startX: number;
  startY: number;
  source: HTMLDivElement;
  timerId: number;
  active: boolean;
  preview: HTMLDivElement | null;
  previewTop: number;
  previewHeight: number;
};

function removeDuplicateIds(root: HTMLElement): void {
  root.removeAttribute("id");
  root.querySelectorAll<HTMLElement>("[id]").forEach((element) => element.removeAttribute("id"));
}

/** 길게 누른 섹션을 실제 카드와 같은 '떠 있는 이미지'로 복제해 손가락을 따라가게 한다. */
function createSectionDragPreview(source: HTMLDivElement): {
  preview: HTMLDivElement;
  top: number;
  height: number;
} {
  const rect = source.getBoundingClientRect();
  const preview = source.cloneNode(true) as HTMLDivElement;
  const availableHeight = Math.max(160, window.innerHeight - 96);
  const height = Math.min(rect.height, SECTION_DRAG_PREVIEW_MAX_HEIGHT_PX, availableHeight);
  const top = Math.min(
    Math.max(12, rect.top),
    Math.max(12, window.innerHeight - height - 12),
  );

  removeDuplicateIds(preview);
  preview.classList.remove("ph-home-section--dragging");
  preview.classList.add("ph-section-drag-preview");
  preview.setAttribute("aria-hidden", "true");
  preview.setAttribute("inert", "");
  preview.removeAttribute("tabindex");
  preview.removeAttribute("aria-label");
  preview.removeAttribute("aria-grabbed");
  preview.querySelectorAll<HTMLImageElement>("img").forEach((image) => {
    image.draggable = false;
  });
  preview.style.left = `${rect.left}px`;
  preview.style.top = `${top}px`;
  preview.style.width = `${rect.width}px`;
  preview.style.height = `${height}px`;
  preview.style.removeProperty("order");
  document.body.append(preview);
  return { preview, top, height };
}

function preventSectionDragTouchScroll(event: TouchEvent): void {
  event.preventDefault();
}

function clearSectionDragVisual(session: SectionDragSession): void {
  window.clearTimeout(session.timerId);
  session.preview?.remove();
  document.removeEventListener("touchmove", preventSectionDragTouchScroll, true);
  document.documentElement.classList.remove("ph-reorder-active");
}

function eventLocationPoint(event: CalendarEvent): { lat: number; lng: number } | null {
  const lat = event.location?.lat;
  const lng = event.location?.lng;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function eventTitleForPlace(event: CalendarEvent, view: CalEventView, intl: IntlShape): string {
  const title = (event.title || view.title || "").trim();
  if (title) return title;
  return (event.location?.address || intl.formatMessage({ id: "parent.home.schedulePlace" })).trim();
}

function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

function schedulePlaceHit(
  loc: ChildLocation,
  events: ChildScheduleEvent[],
  intl: IntlShape,
): { label: string; distanceM: number } | null {
  const hits = events
    .map(({ raw, view }) => {
      const point = eventLocationPoint(raw);
      if (!point) return null;
      return {
        raw,
        view,
        distance: distanceM(loc.lat, loc.lng, point.lat, point.lng),
      };
    })
    .filter((hit): hit is { raw: CalendarEvent; view: CalEventView; distance: number } =>
      hit !== null && hit.distance <= SCHEDULE_PLACE_RADIUS_M,
    )
    .sort((a, b) => {
      const priority = (tag: CalEventView["tag"]) => {
        if (tag === "진행 중") return 0;
        if (tag === "예정") return 1;
        return 2;
      };
      const pa = priority(a.view.tag);
      const pb = priority(b.view.tag);
      return pa - pb || a.distance - b.distance;
    });
  const hit = hits[0];
  if (!hit) return null;
  return {
    label: intl.formatMessage(
      { id: "parent.home.nearPlace" },
      { place: eventTitleForPlace(hit.raw, hit.view, intl) },
    ),
    distanceM: hit.distance,
  };
}

const shortcutRoutes: Record<string, string> = {
  sc1: "/ai-schedule?tab=text",
  sc2: "/parent/location?view=history",
  sc3: "/friend-play",
  sc4: "/place-manager",
  sc5: "/remote-audio",
  sc6: "/daily-report",
  sc7: "/remote-ring",
  sc8: "/notifications",
};

const shortcutLabelIds: Readonly<Record<string, string>> = {
  sc1: "parent.home.shortcut.aiSchedule",
  sc2: "parent.home.shortcut.location",
  sc3: "parent.home.shortcut.playdate",
  sc4: "parent.home.shortcut.places",
  sc5: "parent.home.shortcut.remoteAudio",
  sc6: "parent.home.shortcut.safetyReport",
  // sc7 은 "아이 기기 찾기"(/remote-ring)다 — 예전 라벨 id 는 "구독"이라 눌러야 하는 곳과 이름이 달랐다.
  sc7: "parent.home.shortcut.deviceFinder",
  sc8: "parent.home.shortcut.notifications",
};

const shortcutIconPaths: Readonly<Record<string, string>> = {
  sc1: "ui/clay/ai-credit.webp",
  sc2: "ui/clay/location.webp",
  sc3: "ui/clay/playdate.webp",
  sc4: "ui/clay/places.webp",
  sc5: "ui/clay/remote-audio.webp",
  sc6: "ui/clay/background-location.webp",
  sc7: "ui/clay/pin.webp",
  sc8: "ui/clay/notification.webp",
};

export function ParentHome() {
  const intl = useIntl();
  const navigate = useNavigate();
  const { show } = useToast();
  const { locale } = useLocale();

  // ── 실 데이터: 오늘 일정 + 아이 현황(가족·위치) ──
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const todayKey = useMemo(
    () => dateToDateKeyInTimeZone(now, LEGACY_FAMILY_TIME_ZONE),
    [now],
  );

  const [referralOpen, setReferralOpen] = useState(false);
  const eventsQuery = useEvents();
  const familyQuery = useMyFamily();
  const locationsQuery = useChildLocations();
  const entitlement = useEntitlement();
  const locationMode = locationModeFor(entitlement.tier);
  const locationScopeError = entitlement.isError;
  const locationScopeLoading = !entitlement.isError && entitlement.tier === TIERS.UNKNOWN;
  const locationScopeUnavailable = locationScopeError || locationScopeLoading;
  const placesQuery = useSavedPlaces();
  const events = eventsQuery.data;
  const family = familyQuery.data;
  const locations = locationsQuery.data;
  const locationsForDisplay = !locationScopeUnavailable && locationMode !== "locked"
    ? locations
    : undefined;
  const referralEligibleChildren = useMemo(() => (
    (family?.members ?? []).flatMap((member) => (
      member.role === "child" && member.user_id
        ? [{ userId: member.user_id, name: member.name?.trim() || intl.formatMessage({ id: "parent.parentHome.copy004" }) }]
        : []
    ))
  ), [family?.members, intl]);

  // 아이 기기 상태 새로고침 요청 — 네이티브 device_health 리포트는 on-demand 라
  // 홈 진입 시 1회 요청해야 안전지표가 채워진다(도착하면 WS 브릿지가 자동 반영).
  const { familyId } = useAuth();
  const [sectionOrder, setSectionOrder] = useState<ParentHomeSectionId[]>(() => [...PARENT_HOME_SECTION_IDS]);
  const sectionOrderRef = useRef<ParentHomeSectionId[]>(sectionOrder);
  const sectionElementsRef = useRef(new Map<ParentHomeSectionId, HTMLDivElement>());
  const sectionDragSessionRef = useRef<SectionDragSession | null>(null);
  const suppressedSectionClickRef = useRef<{ id: ParentHomeSectionId; expiresAt: number } | null>(null);
  const [draggingSectionId, setDraggingSectionId] = useState<ParentHomeSectionId | null>(null);

  useEffect(() => {
    if (!familyId || !familyQuery.isSuccess || reorderHintShownThisRun.has(familyId)) return;
    const storageKey = parentHomeReorderHintStorageKey(familyId);
    try {
      if (window.localStorage.getItem(storageKey) === "shown") {
        reorderHintShownThisRun.add(familyId);
        return;
      }
    } catch {
      // 저장소가 막혀도 현재 실행 중에는 안내를 한 번만 보여준다.
    }

    const timerId = window.setTimeout(() => {
      if (reorderHintShownThisRun.has(familyId)) return;
      reorderHintShownThisRun.add(familyId);
      try {
        window.localStorage.setItem(storageKey, "shown");
      } catch {
        // 저장 실패는 홈 사용을 막지 않는다.
      }
      show(intl.formatMessage({ id: "parent.home.reorder.hint" }));
    }, SECTION_REORDER_HINT_DELAY_MS);
    return () => window.clearTimeout(timerId);
  }, [familyId, familyQuery.isSuccess, intl, show]);

  useEffect(() => () => {
    const session = sectionDragSessionRef.current;
    if (session) clearSectionDragVisual(session);
    sectionDragSessionRef.current = null;
  }, []);

  useEffect(() => {
    const session = sectionDragSessionRef.current;
    if (session) clearSectionDragVisual(session);
    sectionDragSessionRef.current = null;
    suppressedSectionClickRef.current = null;
    if (!familyId) {
      sectionOrderRef.current = [...PARENT_HOME_SECTION_IDS];
      setSectionOrder([...PARENT_HOME_SECTION_IDS]);
      setDraggingSectionId(null);
      return;
    }
    let next = [...PARENT_HOME_SECTION_IDS];
    try {
      const raw = window.localStorage.getItem(parentHomeSectionOrderStorageKey(familyId));
      next = normalizeParentHomeSectionOrder(raw ? JSON.parse(raw) : null);
    } catch {
      // 저장값이 손상돼도 기본 순서로 안전하게 복구한다.
    }
    sectionOrderRef.current = next;
    setSectionOrder(next);
    setDraggingSectionId(null);
  }, [familyId]);

  const persistSectionOrder = (next: readonly ParentHomeSectionId[]) => {
    const normalized = normalizeParentHomeSectionOrder(next);
    sectionOrderRef.current = normalized;
    setSectionOrder(normalized);
    if (!familyId) return;
    try {
      window.localStorage.setItem(
        parentHomeSectionOrderStorageKey(familyId),
        JSON.stringify(normalized),
      );
    } catch {
      // 저장소를 사용할 수 없어도 현재 화면의 재정렬은 유지한다.
    }
  };

  const setSectionElement = (id: ParentHomeSectionId, element: HTMLDivElement | null) => {
    if (element) sectionElementsRef.current.set(id, element);
    else sectionElementsRef.current.delete(id);
  };

  const startSectionDrag = (
    id: ParentHomeSectionId,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (!event.isPrimary || event.button !== 0) return;
    if (sectionDragSessionRef.current) return;
    suppressedSectionClickRef.current = null;

    const session: SectionDragSession = {
      id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      source: event.currentTarget,
      timerId: 0,
      active: false,
      preview: null,
      previewTop: 0,
      previewHeight: 0,
    };
    session.timerId = window.setTimeout(() => {
      if (sectionDragSessionRef.current !== session || session.active) return;
      const visual = createSectionDragPreview(session.source);
      session.active = true;
      session.preview = visual.preview;
      session.previewTop = visual.top;
      session.previewHeight = visual.height;
      document.documentElement.classList.add("ph-reorder-active");
      document.addEventListener("touchmove", preventSectionDragTouchScroll, { passive: false, capture: true });
      try {
        session.source.setPointerCapture(session.pointerId);
      } catch {
        // 포인터가 이미 취소된 극단적인 타이밍이면 종료 이벤트가 시각 복제를 정리한다.
      }
      try {
        navigator.vibrate?.(12);
      } catch {
        // 진동을 지원하지 않거나 OS가 차단해도 재정렬은 그대로 동작한다.
      }
      setDraggingSectionId(id);
    }, SECTION_LONG_PRESS_MS);
    sectionDragSessionRef.current = session;
  };

  const moveSectionDrag = (
    id: ParentHomeSectionId,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const session = sectionDragSessionRef.current;
    if (!session || session.id !== id || session.pointerId !== event.pointerId || !event.isPrimary) return;
    if (!session.active) {
      const moved = Math.hypot(event.clientX - session.startX, event.clientY - session.startY);
      if (moved > SECTION_LONG_PRESS_MOVE_TOLERANCE_PX) {
        clearSectionDragVisual(session);
        sectionDragSessionRef.current = null;
      }
      return;
    }
    event.preventDefault();
    if (session.preview) {
      const desiredTop = Math.min(
        Math.max(12, session.previewTop + event.clientY - session.startY),
        Math.max(12, window.innerHeight - session.previewHeight - 12),
      );
      session.preview.style.transform = `translate3d(0, ${desiredTop - session.previewTop}px, 0) scale(1.015)`;
    }
    let target: ParentHomeSectionId | null = null;
    let distance = Number.POSITIVE_INFINITY;
    for (const candidate of sectionOrderRef.current) {
      const element = sectionElementsRef.current.get(candidate);
      if (!element) continue;
      const rect = element.getBoundingClientRect();
      const candidateDistance = Math.abs(event.clientY - (rect.top + rect.bottom) / 2);
      if (candidateDistance < distance) {
        target = candidate;
        distance = candidateDistance;
      }
    }
    if (target && target !== id) {
      const next = moveParentHomeSection(sectionOrderRef.current, id, target);
      sectionOrderRef.current = next;
      setSectionOrder(next);
    }

    const scroller = event.currentTarget.closest<HTMLElement>(".hy-screen");
    if (!scroller) return;
    const scrollerRect = scroller.getBoundingClientRect();
    const edge = 88;
    if (event.clientY < scrollerRect.top + edge) scroller.scrollBy({ top: -18 });
    else if (event.clientY > scrollerRect.bottom - edge) scroller.scrollBy({ top: 18 });
  };

  const endSectionDrag = (
    id: ParentHomeSectionId,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const session = sectionDragSessionRef.current;
    if (!session || session.id !== id || session.pointerId !== event.pointerId) return;
    sectionDragSessionRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!session.active) {
      clearSectionDragVisual(session);
      return;
    }
    event.preventDefault();
    suppressedSectionClickRef.current = { id, expiresAt: Date.now() + 800 };
    clearSectionDragVisual(session);
    setDraggingSectionId(null);
    persistSectionOrder(sectionOrderRef.current);
  };

  const moveSectionWithKeyboard = (
    id: ParentHomeSectionId,
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const current = sectionOrderRef.current.indexOf(id);
    const targetIndex = event.key === "ArrowUp" ? current - 1 : current + 1;
    const target = sectionOrderRef.current[targetIndex];
    if (!target) return;
    persistSectionOrder(moveParentHomeSection(sectionOrderRef.current, id, target));
  };

  const suppressClickAfterSectionDrag = (
    id: ParentHomeSectionId,
    event: ReactMouseEvent<HTMLDivElement>,
  ) => {
    const suppressed = suppressedSectionClickRef.current;
    if (!suppressed) return;
    if (Date.now() > suppressed.expiresAt) {
      suppressedSectionClickRef.current = null;
      return;
    }
    if (suppressed.id !== id) return;
    event.preventDefault();
    event.stopPropagation();
    suppressedSectionClickRef.current = null;
  };

  const suppressContextMenuDuringSectionDrag = (
    id: ParentHomeSectionId,
    event: ReactMouseEvent<HTMLDivElement>,
  ) => {
    const session = sectionDragSessionRef.current;
    if (session?.id === id && session.active) event.preventDefault();
  };

  const places = placesQuery.data;
  const locationLabel = useLocationLabels(locationsForDisplay, places);

  // 홈 바로가기에서 위치추적을 누를 때 지도 SDK 다운로드 대기 시간을 줄인다.
  useEffect(() => {
    void loadKakaoMaps().catch(() => undefined);
  }, []);

  // 알림 벨 빨간 점 + 바로가기 배지 — 실제 미읽음 알림 개수 기반(하드코딩 항상-3 제거).
  const alertsQuery = useParentAlerts();
  const unreadCount = useMemo(
    () => countUnread(alertsQuery.data ?? []),
    [alertsQuery.data],
  );
  const hasUnreadAlerts = unreadCount > 0;

  // 활성 아이(전역 스위치) — 홈 카드 탭으로만 전환. 안전지표·오늘일정·준비물이 이 아이 기준.
  const { activeChild, setActiveChildId } = useActiveChild();
  const statusRequestedKeyRef = useRef("");
  useEffect(() => {
    const childUserId = activeChild?.user_id?.trim() ?? "";
    if (!familyId || !childUserId) return;
    const key = `${familyId}:${childUserId}`;
    if (statusRequestedKeyRef.current === key) return;
    statusRequestedKeyRef.current = key;
    let cancelled = false;
    const timers: number[] = [];
    void requestDeviceStatus(familyId, childUserId).then(() => {
      // WS가 지연·누락돼도 서버에 저장된 device_health를 세 차례 직접 재조회한다.
      for (const delay of [1200, 3500, 8000]) {
        timers.push(window.setTimeout(() => {
          if (!cancelled) void familyQuery.refetch();
        }, delay));
      }
    });
    return () => {
      cancelled = true;
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [activeChild?.user_id, familyId]);
  // 히어로 캐러셀: 표시 개수는 운영자 전역 설정, 광고 숨김은 구독 여부로 정한다.
  // ⚠️ entitlement.ready 가 false 면 무료 개수로 강등하지 않는다(R9) — resolve 함수가 오늘 한 장만 돌려준다.
  const { controls: heroControls } = useParentHomeHeroCarousel();
  const heroSlides = useMemo(() => resolveParentHomeHeroSlides({
    controls: heroControls,
    entitlementReady: entitlement.ready,
    isPremium: entitlement.isPremium,
  }), [heroControls, entitlement.ready, entitlement.isPremium]);
  const openHeroLink = useCallback((url: string) => {
    // 외부 링크는 앱 안에서 열지 않는다(네이티브는 기본 브라우저, 웹은 새 탭).
    void openExternal(url);
  }, []);

  const subscriptionCard = resolveParentHomeSubscriptionCard({
    ready: entitlement.ready,
    isError: entitlement.isError,
    isPremium: entitlement.isPremium,
    planLabelId: entitlement.view?.planLabelId ?? null,
    isTrial: entitlement.view?.isTrial ?? false,
    trialDaysLeft: entitlement.view?.trialDaysLeft ?? null,
    periodEnd: entitlement.view?.periodEnd ?? null,
  }, intl, locale);
  const openShortcut = (id: string) => {
    if (id === "sc7") {
      const destination = resolveParentHomeDeviceFinder(activeChild?.user_id);
      navigate(destination.to, { state: destination.state });
      return;
    }
    const destination = shortcutRoutes[id];
    if (destination) navigate(destination);
  };
  const childNotifSettingsQuery = useChildNotifSettingsStatus(activeChild?.user_id);
  const activeHeroLocation = activeChild?.user_id
    ? (locationsForDisplay ?? []).find((location) => location.user_id === activeChild.user_id) ?? null
    : null;
  const [valueUpsellSource, setValueUpsellSource] = useState<PremiumValueMomentSource | null>(null);
  const alertsBaselineRef = useRef<Set<string> | null>(null);
  const locationBaselineRef = useRef<boolean | null>(null);
  const valueMomentOfferedRef = useRef(false);

  useEffect(() => {
    alertsBaselineRef.current = null;
    locationBaselineRef.current = null;
    valueMomentOfferedRef.current = false;
    setValueUpsellSource(null);
  }, [familyId]);

  // 초기 조회에 이미 있던 과거 위치는 제안 사유로 쓰지 않는다. 현재 홈 세션에서
  // 실제 첫 위치가 0→1로 바뀐 Free 가족에게만 한 번 보여준다.
  useEffect(() => {
    if (!familyId || entitlement.tier === TIERS.UNKNOWN || !locationsQuery.isSuccess) return;
    const hasLocation = (locationsForDisplay ?? []).length > 0;
    if (locationBaselineRef.current === null) {
      locationBaselineRef.current = hasLocation;
      return;
    }
    const becameAvailable = !locationBaselineRef.current && hasLocation;
    locationBaselineRef.current = hasLocation;
    if (!becameAvailable || entitlement.tier === TIERS.PREMIUM || valueMomentOfferedRef.current) return;
    const storage = browserPremiumValueMomentStorage();
    if (wasPremiumValueMomentOffered(storage, familyId)) {
      valueMomentOfferedRef.current = true;
      return;
    }
    valueMomentOfferedRef.current = true;
    markPremiumValueMomentOffered(storage, familyId);
    setValueUpsellSource("first_location");
  }, [entitlement.tier, familyId, locationsForDisplay, locationsQuery.isSuccess]);

  // 알림 첫 로드는 baseline으로만 기억한다. 이후 realtime refetch로 들어온 신규 실측
  // 도착(arrived/place_arrived)만 가치 순간으로 인정해 과거 알림 기반 재노출을 막는다.
  useEffect(() => {
    if (!familyId || entitlement.tier === TIERS.UNKNOWN || !alertsQuery.isSuccess) return;
    const currentAlerts = alertsQuery.data ?? [];
    if (alertsBaselineRef.current === null) {
      alertsBaselineRef.current = new Set(currentAlerts.map((alert) => alert.id));
      return;
    }
    const arrival = findNewSuccessfulArrival(currentAlerts, alertsBaselineRef.current);
    alertsBaselineRef.current = new Set(currentAlerts.map((alert) => alert.id));
    if (!arrival || entitlement.tier === TIERS.PREMIUM || valueMomentOfferedRef.current) return;
    const storage = browserPremiumValueMomentStorage();
    if (wasPremiumValueMomentOffered(storage, familyId)) {
      valueMomentOfferedRef.current = true;
      return;
    }
    valueMomentOfferedRef.current = true;
    markPremiumValueMomentOffered(storage, familyId);
    setValueUpsellSource("first_arrival");
  }, [alertsQuery.data, alertsQuery.isSuccess, entitlement.tier, familyId]);
  const heroLocationCopy = resolveLocationTrustCopy({
    mode: locationMode,
    modeKnown: !locationScopeUnavailable,
    updatedAt: activeHeroLocation?.updated_at,
    loadState: locationScopeError
      ? "error"
      : locationScopeLoading
        ? "loading"
      : locationsQuery.isLoading
      ? "loading"
      : locationsQuery.isError
        ? "error"
        : "ready",
    now,
    locale,
    intl,
  });
  const heroLocationIsCurrent = heroLocationCopy.badge === intl.formatMessage({ id: "parent.locationTrust.current" });
  const heroLocationPlace = useMemo(() => {
    if (!activeHeroLocation) return null;
    const label = locationLabel(activeHeroLocation).trim();
    const loadingLabel = intl.formatMessage({ id: "parent.location.addressLoading" });
    if (!label || label === loadingLabel || label === "주소 확인 중") return null;
    return intl.formatMessage({ id: "parent.home.nearPlace" }, { place: label });
  }, [activeHeroLocation, intl, locationLabel]);

  // 준비물·숙제: 오늘 date_key 의 daily-supplies 실데이터 + 체크 토글(서버 업서트).
  // 서버 응답은 모든 아이가 섞여 있으므로 활성 아이(activeChild.id = child_user_id)만 필터.
  const suppliesQuery = useDailySupplies(todayKey);
  const prep = useMemo(() => {
    const all = suppliesQuery.data ?? [];
    return activeChild ? all.filter((s) => s.child_user_id === activeChild.id) : all;
  }, [suppliesQuery.data, activeChild]);
  const upsert = useUpsertDailySupply();
  const prepDone = prep.filter((p) => p.done).length;
  const togglePrep = (item: DailySupply) =>
    upsert.mutate(
      {
        id: item.id,
        date_key: todayKey,
        label: item.label,
        done: !item.done,
        kind: item.kind ?? "prep",
        child_user_id: item.child_user_id ?? null,
      },
      { onError: () => show(intl.formatMessage({ id: "parent.parentHome.copy001" }), "⚠️") },
    );

  // '지금 갱신': 실제 쿼리 리페치 후 결과에 따라 정직하게 토스트(거짓 성공 금지).
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      // 아이 기기에 상태 리포트 재요청(안전지표 실갱신 — 응답은 WS 로 자동 반영).
      if (familyId) {
        await requestDeviceStatus(familyId, activeChild?.user_id ?? null);
        // 즉시 재조회만 하면 아이 응답 전에 끝나므로 짧은 확인 창을 둔다.
        await new Promise<void>((resolve) => window.setTimeout(resolve, 1200));
      }
      const results = await Promise.all([
        eventsQuery.refetch(),
        familyQuery.refetch(),
        locationsQuery.refetch(),
        placesQuery.refetch(),
        suppliesQuery.refetch(),
      ]);
      if (results.some((r) => r.isError)) {
        show(intl.formatMessage({ id: "parent.parentHome.copy002" }), "⚠️");
      } else {
        show(intl.formatMessage({ id: "parent.parentHome.copy003" }), "✅");
      }
    } catch (error) {
      console.error("아이 현황 갱신 실패:", error);
      show(intl.formatMessage({ id: "parent.parentHome.copy002" }), "⚠️");
    } finally {
      setRefreshing(false);
    }
  };

  // 지난 일정 "다녀옴" 위치 검증 — 활성 아이 이력으로 방문 확인(미확인=확인 필요).
  const canVerifyVisits = !locationScopeUnavailable && locationMode === "realtime";
  const visitMap = useVisitVerify(
    todayKey,
    LEGACY_FAMILY_TIME_ZONE,
    events,
    activeChild?.user_id ?? null,
    canVerifyVisits,
  );

  // 오늘 일정 — 활성 아이 배정(events_children.child_id) + 가족 공유(is_family_event)만.
  // 형제에게만 배정된 일정은 활성 아이 화면에서 제외(아이별 구분 — TK 결정).
  const todayEvents = useMemo(() => {
    const byKey = groupEventsByDateKey(
      events ?? [],
      now,
      locale,
      LEGACY_FAMILY_TIME_ZONE,
      visitMap,
      places,
      intl,
    );
    const all = byKey[todayKey] ?? [];
    if (!activeChild) return [];
    const allowedIds = new Set(
      filterEventsForChild(
        (events ?? []).filter((e) => e.date_key === todayKey),
        activeChild.id,
      ).map((e) => e.id),
    );
    return all.filter((v) => allowedIds.has(v.id));
  }, [events, locale, now, todayKey, activeChild, visitMap, places, intl]);

  const childName = activeChild?.name || intl.formatMessage({ id: "parent.parentHome.copy004" }); // 히어로·상단 스티커 대상 = 활성 아이

  // 아이별 현황 카드 — 등록된 모든 아이를 각각 위치·기기·다음 일정과 함께 표시(다자녀 = 둘 다).
  // 위치는 각 아이 user_id 로 매칭(폴백 없음 → 없으면 정직하게 "위치 정보 없음"). 다음 일정은
  // events_children(child_id=member.id) 배정 또는 가족 공유(is_family_event) 중 가장 이른 미완료 일정.
  const childCards = useMemo(() => {
    const kids = (family?.members ?? []).filter((m) => m.role === "child");
    const rawToday = (events ?? []).filter((e) => e.date_key === todayKey);
    // 카드별 다음 일정은 활성 아이 필터와 무관하게 "그 카드 아이" 기준으로 계산.
    const allViews = groupEventsByDateKey(
      events ?? [],
      now,
      locale,
      LEGACY_FAMILY_TIME_ZONE,
      undefined,
      places,
      intl,
    )[todayKey] ?? [];
    return kids.map((kid) => {
      const kidLoc = kid.user_id
        ? (locationsForDisplay ?? []).find((l) => l.user_id === kid.user_id) ?? null
        : null;
      const kidLocationCopy = resolveLocationTrustCopy({
        mode: locationMode,
        modeKnown: !locationScopeUnavailable,
        updatedAt: kidLoc?.updated_at,
        loadState: locationScopeError
          ? "error"
          : locationScopeLoading
            ? "loading"
          : locationsQuery.isLoading
          ? "loading"
          : locationsQuery.isError
            ? "error"
            : "ready",
        now,
        locale,
        intl,
      });
      const kidRaw = filterEventsForChild(rawToday, kid.id);
      const rawById = new Map(kidRaw.map((e) => [e.id, e]));
      const kidEvents = allViews
        .map((view) => {
          const raw = rawById.get(view.id);
          return raw ? { raw, view } : null;
        })
        .filter((row): row is ChildScheduleEvent => row !== null);
      const next = kidEvents.find(({ view }) => !PAST_TAGS.has(view.tag))?.view ?? null;
      // 일정 장소 라벨은 등록 장소보다 "더 가까울 때만" 이긴다(2026-07-14 TK 제보:
      // 학교가 더 가까운데 다음 일정인 피아노 학원 근처로 표시됨). 동률이면 등록 장소명.
      const eventHit = kidLoc ? schedulePlaceHit(kidLoc, kidEvents, intl) : null;
      const savedHit = kidLoc ? nearestPlace(kidLoc, places ?? []) : null;
      const savedNearby = savedHit && savedHit.distanceM <= EXACT_SAVED_PLACE_LABEL_RADIUS_M ? savedHit : null;
      const eventPlace = eventHit && (!savedNearby || eventHit.distanceM < savedNearby.distanceM)
        ? eventHit.label
        : null;
      return {
        id: kid.id,
        name: kid.name || intl.formatMessage({ id: "parent.parentHome.copy004" }),
        avatar: childAvatarPath(kid.photo_url),
        hasPhoto: Boolean(kid.photo_url?.trim().match(/^(https?:|blob:)/)),
        device: resolveDeviceLabel({
          deviceLabel: kid.device_label,
          manufacturer: kid.device_health?.manufacturer,
          model: kid.device_health?.model,
        }, intl),
        place: kidLoc ? eventPlace ?? locationLabel(kidLoc) : kidLocationCopy.badge,
        fresh: kidLocationCopy.detail,
        scheduleLabel: next?.tag === "진행 중" ? intl.formatMessage({ id: "parent.parentHome.copy005" }) : intl.formatMessage({ id: "parent.parentHome.copy006" }),
        next,
      };
    });
  }, [
    family,
    events,
    locale,
    todayKey,
    locationsForDisplay,
    places,
    now,
    locationMode,
    locationScopeError,
    locationScopeLoading,
    locationScopeUnavailable,
    locationsQuery.isLoading,
    locationsQuery.isError,
    locationLabel,
    intl,
  ]);

  // 안전 지표 = 활성 아이의 기기 리포트(스위치 전환 시 함께 전환).
  const safetyChildName = activeChild?.name || intl.formatMessage({ id: "parent.parentHome.copy004" });
  const deviceStatus = useMemo(
    () => deviceStatusView(
      activeChild?.device_health,
      now,
      locale,
      childNotifSettingsQuery.data?.userId === activeChild?.user_id
        ? childNotifSettingsQuery.data?.childEnabled ?? null
        : null,
      childNotifSettingsQuery.isError
        ? "error"
        : childNotifSettingsQuery.isSuccess
          ? "ready"
          : "loading",
      intl,
    ),
    [
      activeChild,
      childNotifSettingsQuery.data,
      childNotifSettingsQuery.isError,
      childNotifSettingsQuery.isSuccess,
      locale,
      now,
      intl,
    ],
  );

  const todayLabel = formatCalendarDay(now, {
    locale,
    timeZone: LEGACY_FAMILY_TIME_ZONE,
    weekday: "long",
  });

  const sectionTitle = (id: ParentHomeSectionId): string => {
    switch (id) {
      case "schedule": return intl.formatMessage({ id: "parent.parentHome.copy018" });
      case "ai_schedule": return intl.formatMessage({ id: "parent.parentHome.copy023" });
      case "children": return intl.formatMessage({ id: "parent.parentHome.copy029" });
      case "safety": return intl.formatMessage({ id: "parent.parentHome.copy035" });
      case "supplies": return intl.formatMessage({ id: "parent.parentHome.copy050" });
      case "memo": return intl.formatMessage({ id: "core.nav.chat" });
      case "shortcuts": return intl.formatMessage({ id: "parent.parentHome.copy060" });
      case "membership": return intl.formatMessage({ id: "parent.settings.subscription" });
    }
  };

  const renderHomeSection = (id: ParentHomeSectionId, children: ReactNode) => {
    const title = sectionTitle(id);
    return (
      <ReorderableHomeSection
        id={id}
        order={sectionOrder.indexOf(id) + 1}
        dragging={draggingSectionId === id}
        setElement={setSectionElement}
        onPointerDown={startSectionDrag}
        onPointerMove={moveSectionDrag}
        onPointerEnd={endSectionDrag}
        onKeyDown={moveSectionWithKeyboard}
        onClickCapture={suppressClickAfterSectionDrag}
        onContextMenu={suppressContextMenuDuringSectionDrag}
        handleLabel={intl.formatMessage({ id: "parent.home.reorder.handle" }, { section: title })}
      >
        {children}
      </ReorderableHomeSection>
    );
  };

  return (
    <div className="hy-rise-in ph-page">
      <TopBar
        actions={
          <>
            <button
              type="button"
              className="ph-stickerbtn ph-neu-control hy-press"
              aria-label={intl.formatMessage(
                { id: "parent.home.sendStickerTo" },
                { childName },
              )}
              onClick={() => navigate("/sticker-send")}
            >
              <img src={asset("ui/clay/sticker.webp")} alt="" />
              <span>{intl.formatMessage({ id: "parent.parentHome.copy007" })}</span>
            </button>
            <button
              type="button"
              className="hy-iconbtn ph-neu-control hy-press"
              aria-label={intl.formatMessage({ id: "parent.parentHome.copy008" })}
              onClick={() => navigate("/notifications")}
            >
              <img className="ph-top-action-icon" src={asset("ui/clay/notification.webp")} alt="" />
              {hasUnreadAlerts && <span className="hy-iconbtn__dot" />}
            </button>
            <button
              type="button"
              className="hy-iconbtn ph-neu-control hy-press"
              aria-label={intl.formatMessage({ id: "parent.parentHome.copy009" })}
              onClick={() => navigate("/parent/settings")}
            >
              <img className="ph-top-action-icon ph-top-action-icon--settings" src={settings3dIcon} alt="" />
            </button>
          </>
        }
      />

      <div className="hy-content">
        {/* 히어로: 오늘 + 소식 캐러셀. 첫 장은 항상 오늘이고 광고 성격 슬라이드는 구독 가족에게 감춘다. */}
        <ParentHomeHeroCarousel slides={heroSlides} controls={heroControls} onOpenExternal={openHeroLink}>
        <button type="button" className="ph-hero" onClick={() => navigate("/parent/calendar")}>
          <span className="ph-hero__sheen" />
          <span className="ph-hero__mascot">
            <img src={asset("mascot/phone.webp")} alt="" />
          </span>
          <span className="ph-hero__badge">{todayLabel}</span>
          <div className="ph-hero__title">
            {intl.formatMessage({ id: "parent.home.todayForChild" }, { childName })}
            <br />
            {eventsQuery.isLoading ? (
              <>
                {intl.formatMessage({ id: "parent.parentHome.copy011" })} <em>{intl.formatMessage({ id: "parent.parentHome.copy012" })}</em>
              </>
            ) : (
              <>
                {intl.formatMessage({ id: "parent.parentHome.copy011" })}{" "}
                <em>{intl.formatMessage({ id: "parent.home.todayEventCount" }, { count: todayEvents.length })}</em>
              </>
            )}
          </div>
          <div className="ph-hero__live" data-current={heroLocationIsCurrent}>
            {heroLocationIsCurrent ? (
              <span className="ph-live-dot">
                <span className="ring" />
                <span className="core" />
              </span>
            ) : (
              <img className="ph-hero__location-icon" src={asset("ui/clay/pin.webp")} alt="" />
            )}
            <span className="ph-hero__location-state">{heroLocationCopy.badge}</span>
            {heroLocationPlace && (
              <span className="ph-hero__location-place">{heroLocationPlace}</span>
            )}
          </div>
        </button>
        </ParentHomeHeroCarousel>

        {locationScopeError && (
          <div className="ph-location-error" role="alert" aria-live="assertive">
            <AlertTriangle size={20} strokeWidth={2.2} aria-hidden="true" />
            <span>
              <b>{intl.formatMessage({ id: "parent.parentHome.copy014" })}</b>
              <small>{intl.formatMessage({ id: "parent.parentHome.copy015" })}</small>
            </span>
            <button
              type="button"
              className="ph-location-error__retry ph-neu-control hy-press hy-busy-quiet"
              onClick={() => void entitlement.refetch()}
              disabled={entitlement.isFetching} aria-busy={entitlement.isFetching}
            >
              <RefreshCw
                size={15}
                strokeWidth={2.4}
                className={entitlement.isFetching ? "ph-location-error__spin" : undefined}
              />
              {entitlement.isFetching ? intl.formatMessage({ id: "parent.parentHome.copy016" }) : intl.formatMessage({ id: "parent.parentHome.copy017" })}
            </button>
          </div>
        )}

        {/* 오늘의 일정 */}
        {renderHomeSection("schedule", (
        <section className="ph-section-shell ph-glass">
          <SectionHeader
            title={intl.formatMessage({ id: "parent.parentHome.copy018" })}
            action={
              <button
                type="button"
                className="hy-section-action ph-neu-control hy-press"
                onClick={() => navigate("/parent/calendar")}
              >
                {intl.formatMessage({ id: "parent.parentHome.copy019" })}
              </button>
            }
          />
          <div className="ph-inner-surface ph-sched">
            {eventsQuery.isLoading ? (
              <div className="ph-sched-skel" role="status" aria-label={intl.formatMessage({ id: "parent.parentHome.copy020" })}>
                <span className="hy-skel hy-skel--avatar" aria-hidden="true" />
                <span className="hy-skel-lines" aria-hidden="true">
                  <span className="hy-skel hy-skel--line hy-skel--line-lg" />
                  <span className="hy-skel hy-skel--line" />
                </span>
              </div>
            ) : eventsQuery.isError ? (
              <div className="ph-sched-row" style={{ justifyContent: "center", gap: 8 }} role="alert">
                <span>{intl.formatMessage({ id: "parent.parentHome.copy021" })}</span>
                <button type="button" className="hy-section-action ph-neu-control hy-press" onClick={() => void handleRefresh()}>
                  {intl.formatMessage({ id: "parent.parentHome.copy017" })}
                </button>
              </div>
            ) : todayEvents.length === 0 ? (
              <div className="ph-sched-row" style={{ color: "var(--fg-muted)", fontSize: "var(--type-body-sm)", fontWeight: 600, justifyContent: "center" }}>
                {intl.formatMessage({ id: "parent.parentHome.copy022" })}
              </div>
            ) : (
              todayEvents.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  className="ph-sched-row ph-neu-control hy-press"
                  onClick={() => navigate("/parent/calendar")}
                >
                  <span className="ph-sched-icon" style={{ background: e.soft, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <img src={asset(e.icon)} alt="" style={{ width: 32, height: 32, objectFit: "contain" }} />
                  </span>
                  <span className="ph-sched-main">
                    <span className="ph-sched-title">{e.title}</span>
                    <span className="ph-sched-sub">{e.time}{e.place ? ` · ${e.place}` : ""}</span>
                  </span>
                  <span className="ph-sched-tag" data-tag={e.tag} style={{ color: e.tagText, background: e.tagBg }}>
                    {e.tagLabel}
                  </span>
                </button>
              ))
            )}
          </div>
        </section>
        ))}

        {/* AI로 일정 추가 — 서리 유리. 색은 페이지 배경(.ph-page). 라우트·2열은 유지. */}
        {renderHomeSection("ai_schedule", (
        <section className="ph-section-shell ph-ai ph-glass" aria-labelledby="ph-ai-title">
          <div className="ph-ai__head">
            <span className="ph-ai__copy">
              <span className="ph-ai__title" id="ph-ai-title">
                {intl.formatMessage({ id: "parent.parentHome.copy023" })}
              </span>
              <span className="ph-ai__sub">{intl.formatMessage({ id: "parent.parentHome.copy024" })}</span>
            </span>
          </div>
          <div className="ph-ai__grid">
            <button type="button" className="ph-ai__btn ph-neu-control hy-press" onClick={() => navigate("/ai-schedule?tab=voice")}>
              <span className="ph-ai__btn-icon">
                <img src={asset("ui/clay/remote-audio.webp")} alt="" />
              </span>
              {intl.formatMessage({ id: "parent.parentHome.copy025" })}
            </button>
            <button type="button" className="ph-ai__btn ph-neu-control hy-press" onClick={() => navigate("/ai-schedule?tab=text")}>
              <span className="ph-ai__btn-icon">
                <img src={asset("ui/clay/ai-credit.webp")} alt="" />
              </span>
              {intl.formatMessage({ id: "parent.parentHome.copy026" })}
            </button>
            <button type="button" className="ph-ai__btn ph-neu-control hy-press" onClick={() => navigate("/ai-schedule?tab=image")}>
              <span className="ph-ai__btn-icon">
                <img src={asset("ui/clay/calendar.webp")} alt="" />
              </span>
              {intl.formatMessage({ id: "parent.parentHome.copy027" })}
            </button>
            <button type="button" className="ph-ai__btn ph-neu-control hy-press" onClick={() => navigate("/ai-schedule?mode=academy&tab=image")}>
              <span className="ph-ai__btn-icon">
                <img src={asset("ui/clay/school.webp")} alt="" />
              </span>
              {intl.formatMessage({ id: "parent.parentHome.copy028" })}
            </button>
          </div>
        </section>
        ))}

        {/* 아이 현황 */}
        {renderHomeSection("children", (
        <section className="ph-section-shell ph-glass">
          <SectionHeader
            title={intl.formatMessage({ id: "parent.parentHome.copy029" })}
            action={
              <span
                className="hy-chip ph-small-control ph-location-chip"
                data-current={heroLocationIsCurrent}
                style={{ marginLeft: "auto" }}
              >
                {heroLocationIsCurrent && <span className="hy-chip__pulse" />}
                {heroLocationCopy.badge}
              </span>
            }
          />
          {familyQuery.isLoading ? (
            <div className="ph-inner-surface ph-child">
              <Loading label={intl.formatMessage({ id: "parent.familyConnection.loading" })} />
            </div>
          ) : familyQuery.isError ? (
            <div className="ph-inner-surface ph-child">
              <div className="ph-child__foot" role="alert">
                <span className="ph-child__next">
                  {intl.formatMessage({ id: "parent.familyConnection.loadError" })}
                </span>
                <button
                  type="button"
                  className="hy-section-action ph-neu-control hy-press"
                  onClick={() => void familyQuery.refetch()}
                >
                  {intl.formatMessage({ id: "parent.parentHome.copy017" })}
                </button>
              </div>
            </div>
          ) : childCards.length === 0 ? (
            <div className="ph-inner-surface ph-child">
              <div className="ph-child__foot">
                <span className="ph-child__next">{intl.formatMessage({ id: "parent.parentHome.copy030" })}</span>
                <button
                  type="button"
                  className="hy-section-action ph-neu-control hy-press"
                  onClick={() => navigate("/child-invite?role=child")}
                >
                  {intl.formatMessage({ id: "shared.stickerSend.connectChild" })}
                </button>
              </div>
            </div>
          ) : (
            <div className="ph-children">
              {childCards.map((c) => {
                const active = c.id === activeChild?.id;
                return (
                  <div key={c.id} className={`ph-inner-surface ph-child${active ? " ph-child--active" : ""}`}>
                    {/* 카드 전체를 누르면 활성 아이를 바꾸고 상세로 들어간다. 별도 배지·화살표는 두지 않는다. */}
                    <div className="ph-child__rowwrap">
                      <button
                        type="button"
                        className="ph-child__row ph-neu-control hy-press"
                        aria-pressed={active}
                        aria-label={intl.formatMessage(
                          { id: "parent.home.childDetailAria" },
                          { name: c.name },
                        )}
                        onClick={() => {
                          setActiveChildId(c.id);
                          navigate("/child-detail", { state: { childId: c.id } });
                        }}
                      >
                        <span
                          className="ph-child__avatar"
                          data-photo={c.hasPhoto ? "true" : "false"}
                          style={{ background: "var(--rose-soft)" }}
                        >
                          <img className="hy-network-avatar" src={avatarSrc(c.avatar)} alt="" loading="lazy" decoding="async" />
                          <span className="ph-child__online" />
                        </span>
                        <span className="ph-child__main">
                          <span className="ph-child__name-row">
                            <span className="ph-child__name">{c.name}</span>
                            <span className="ph-child__device">
                              <span className="ph-child__device-label">
                                {c.device ?? intl.formatMessage({ id: "parent.parentHome.copy032" })}
                              </span>
                            </span>
                          </span>
                          <span className="ph-child__loc">
                            <img className="ph-inline-3d-icon" src={asset("ui/clay/pin.webp")} alt="" />
                            <span>{c.place} · {c.fresh}</span>
                          </span>
                        </span>
                      </button>
                    </div>
                    <div className="ph-child__foot">
                      <span className="ph-child__next">
                        {c.scheduleLabel} ·{" "}
                        <b>
                          {eventsQuery.isLoading
                            ? intl.formatMessage({ id: "parent.parentHome.copy033" })
                            : c.next
                              ? `${c.next.title} ${c.next.time}`
                              : intl.formatMessage({ id: "parent.parentHome.copy034" })}
                        </b>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
        ))}

        {/* 안전 지표 */}
        {renderHomeSection("safety", (
        <section className="ph-section-shell ph-glass">
          <SectionHeader
            title={intl.formatMessage({ id: "parent.parentHome.copy035" })}
            action={
              <span
                className="hy-chip ph-small-control ph-safety__status"
                data-state={deviceStatus.safetyState}
                style={{ marginLeft: "auto" }}
              >
                {safetyChildName} · {deviceStatus.safetyLabel}
              </span>
            }
          />
          <div className="ph-inner-surface ph-safety">
            {!deviceStatus.hasData && (
              <div className="ph-safety__pending">
                {intl.formatMessage({ id: "parent.parentHome.copy036" })}
              </div>
            )}
            {/* 정상/확인 중은 컴팩트 칩 한 줄, 조치 필요(attention)만 상세 안내 박스 */}
            <div className="ph-safety__signals">
              <span
                className="ph-safety__signal"
                data-state={deviceStatus.notification.state}
              >
                <img className="ph-signal-3d-icon" src={asset("ui/clay/notification.webp")} alt="" />
                {deviceStatus.notification.shortLabel}
              </span>
              <span
                className="ph-safety__signal"
                data-state={deviceStatus.location.state}
              >
                <img className="ph-signal-3d-icon" src={asset("ui/clay/location.webp")} alt="" />
                {deviceStatus.location.shortLabel}
              </span>
            </div>
            {deviceStatus.notification.state === "attention" && (
              <div className="ph-safety__notification" data-state="attention">
                <img className="ph-notice-3d-icon" src={asset("ui/clay/notification.webp")} alt="" />
                <span>
                  <b>{deviceStatus.notification.label}</b>
                  <small>{deviceStatus.notification.detail}</small>
                </span>
              </div>
            )}
            {deviceStatus.location.state === "attention" && (
              <div className="ph-safety__notification" data-state="attention">
                <img className="ph-notice-3d-icon" src={asset("ui/clay/location.webp")} alt="" />
                <span>
                  <b>{deviceStatus.location.label}</b>
                  <small>{deviceStatus.location.detail}</small>
                </span>
              </div>
            )}
            <div className="ph-safety__grid">
              <div className="ph-metric">
                <span className="ph-metric__icon">
                  <img src={asset("ui/battery.webp")} alt="" />
                </span>
                <span style={{ minWidth: 0 }}>
                  <span className="ph-metric__k">{intl.formatMessage({ id: "parent.parentHome.copy037" })}</span>
                  <span className="ph-metric__v">{deviceStatus.batteryLabel}</span>
                </span>
              </div>
              <div className="ph-metric">
                <span className="ph-metric__icon">
                  <img src={asset("ui/clock-3d.webp")} alt="" />
                </span>
                <span style={{ minWidth: 0 }}>
                  <span className="ph-metric__k">{intl.formatMessage({ id: "parent.parentHome.copy038" })}</span>
                  <span className="ph-metric__v">{deviceStatus.screenTimeLabel}</span>
                </span>
              </div>
              <div className="ph-metric">
                <span className="ph-metric__icon">
                  <img src={asset("ui/lock-open-3d.webp")} alt="" />
                </span>
                <span style={{ minWidth: 0 }}>
                  <span className="ph-metric__k">{intl.formatMessage({ id: "parent.parentHome.copy039" })}</span>
                  <span className="ph-metric__v">{deviceStatus.unlockCountLabel}</span>
                </span>
              </div>
              <div className="ph-metric">
                <span className="ph-metric__icon">
                  <img src={asset("ui/wifi-3d.webp")} alt="" />
                </span>
                <span style={{ minWidth: 0 }}>
                  <span className="ph-metric__k">{intl.formatMessage({ id: "parent.parentHome.copy040" })}</span>
                  <span className="ph-metric__v">{deviceStatus.networkLabel}</span>
                </span>
              </div>
            </div>

            <div className="ph-safety__divider">
              <div className="ph-app-summary">
                <div className="ph-app-summary__item">
                  <span className="ph-app-summary__k">{intl.formatMessage({ id: "parent.parentHome.copy041" })}</span>
                  <span className="ph-app-summary__v">
                    {deviceStatus.recentAppLabel ?? "—"}
                  </span>
                </div>
                <div className="ph-app-summary__item">
                  <span className="ph-app-summary__k">{intl.formatMessage({ id: "parent.parentHome.copy042" })}</span>
                  {deviceStatus.mostUsedApp ? (
                    <span className="ph-app-summary__v">
                      {deviceStatus.mostUsedApp.name}
                      <span className="ph-app-summary__time">{deviceStatus.mostUsedApp.timeLabel}</span>
                    </span>
                  ) : (
                    <span className="ph-app-summary__v">—</span>
                  )}
                </div>
              </div>
              <div className="ph-recent-head">
                <b>{intl.formatMessage({ id: "parent.parentHome.copy043" })}</b>
                <span>{deviceStatus.topApps.length > 0 ? intl.formatMessage({ id: "parent.parentHome.copy044" }) : "—"}</span>
              </div>
              {deviceStatus.topApps.length > 0 ? (
                <div className="ph-recent-list">
                  {deviceStatus.topApps.map((app, index) => (
                    <div key={app.id} className="ph-recent-row">
                      <span className="ph-recent-row__icon" aria-hidden="true">
                        {index + 1}
                      </span>
                      <span className="ph-recent-row__main">
                        <span className="ph-recent-row__name">{app.name}</span>
                        {app.isLatest && (
                          <span className="ph-recent-row__badge">{intl.formatMessage({ id: "parent.parentHome.copy041" })}</span>
                        )}
                      </span>
                      <span className="ph-recent-row__time">{app.timeLabel}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="ph-recent-empty">
                  {!deviceStatus.hasData
                    ? intl.formatMessage({ id: "parent.parentHome.copy045" })
                    : deviceStatus.appUsagePermissionGranted
                      ? intl.formatMessage({ id: "parent.parentHome.copy046" })
                      : intl.formatMessage({ id: "parent.parentHome.copy047" })}
                </div>
              )}
            </div>

            <div className="ph-safety__refresh">
              <span>{deviceStatus.freshnessLabel}</span>
              <button
                type="button"
                className="ph-small-control ph-neu-control hy-press"
                onClick={handleRefresh}
                disabled={refreshing} aria-busy={refreshing}
              >
                {refreshing ? intl.formatMessage({ id: "parent.parentHome.copy048" }) : intl.formatMessage({ id: "parent.parentHome.copy049" })}
              </button>
            </div>
          </div>
        </section>
        ))}

        {/* 준비물 · 숙제 */}
        {renderHomeSection("supplies", (
        <section className="ph-section-shell ph-glass">
          <SectionHeader
            title={intl.formatMessage({ id: "parent.parentHome.copy050" })}
            action={
              <>
                <span className="ph-prep-count">
                  {prepDone}/{prep.length}
                </span>
                <button
                  type="button"
                  className="ph-small-control ph-prep-edit ph-neu-control hy-press"
                  onClick={() =>
                    navigate("/supplies", {
                      state: { dateKey: todayKey, childId: activeChild?.id },
                    })
                  }
                >
                  {intl.formatMessage({ id: "parent.parentHome.copy051" })}
                </button>
              </>
            }
          />
          <div className="ph-inner-surface ph-prep">
            {suppliesQuery.isLoading ? (
              <div
                className="ph-prep-row"
                style={{ justifyContent: "center" }}
              >
                <Loading label={intl.formatMessage({ id: "parent.parentHome.copy052" })} />
              </div>
            ) : suppliesQuery.isError ? (
              <div className="ph-prep-row" style={{ justifyContent: "center", gap: 8 }} role="alert">
                <span>{intl.formatMessage({ id: "parent.parentHome.copy053" })}</span>
                <button type="button" className="hy-section-action ph-neu-control hy-press" onClick={() => void handleRefresh()}>
                  {intl.formatMessage({ id: "parent.parentHome.copy017" })}
                </button>
              </div>
            ) : prep.length === 0 ? (
              <div
                className="ph-prep-row"
                style={{ color: "var(--fg-muted)", fontSize: "var(--type-body-sm)", fontWeight: 600, justifyContent: "center" }}
              >
                {intl.formatMessage({ id: "parent.parentHome.copy054" })}
              </div>
            ) : (
              prep.map((s) => (
                <div key={s.id} className="ph-prep-row">
                  <button
                    type="button"
                    className="ph-prep-check ph-neu-control hy-press"
                    data-done={s.done}
                    aria-label={intl.formatMessage({ id: "parent.parentHome.copy055" })}
                    onClick={() => togglePrep(s)}
                  >
                    <Check size={15} strokeWidth={3} color="var(--bg-card)" style={{ opacity: s.done ? 1 : 0 }} />
                  </button>
                  <button type="button" className="ph-prep-label" onClick={() => togglePrep(s)}>
                    {s.kind === "hw" && (
                      <span
                        className="ph-prep-kind"
                        style={{ color: "var(--lav-text)", background: "var(--lav-soft2)" }}
                      >
                        {intl.formatMessage({ id: "parent.parentHome.copy056" })}
                      </span>
                    )}
                    <span
                      className="ph-prep-text"
                      style={{
                        color: s.done ? "var(--fg-faint)" : "var(--fg-body)",
                        textDecoration: s.done ? "line-through" : "none",
                      }}
                    >
                      {s.label}
                    </span>
                  </button>
                </div>
              ))
            )}
          </div>
        </section>
        ))}

        {/* 대화 프리뷰 */}
        {renderHomeSection("memo", (
        <button type="button" className="ph-section-shell ph-glass ph-memo hy-press" onClick={() => navigate("/parent/memo")}>
          <span className="ph-memo__icon ph-neu-control">
            <img src={asset("ui/clay/notification.webp")} alt="" />
          </span>
          <span className="ph-memo__main">
            <span className="ph-memo__from">{intl.formatMessage({ id: "parent.parentHome.copy057" })}</span>
            <span className="ph-memo__text">
              {intl.formatMessage({ id: "parent.home.sendMessageTo" })}
            </span>
          </span>
        </button>
        ))}

        {/* 바로가기 */}
        {renderHomeSection("shortcuts", (
        <section className="ph-section-shell ph-glass">
          <SectionHeader
            title={intl.formatMessage({ id: "parent.parentHome.copy060" })}
          />
          <div className="ph-shortcuts">
            {shortcuts.map((s) => {
              // "알림" 바로가기 배지는 실제 미읽음 개수(99+ 상한). 그 외는 배지 없음.
              const badge = s.id === "sc8" ? unreadCount : 0;
              return (
                <button
                  key={s.id}
                  type="button"
                  className="ph-shortcut ph-neu-control hy-press"
                  onPointerDown={s.id === "sc2" ? () => void loadKakaoMaps().catch(() => undefined) : undefined}
                  onClick={() => openShortcut(s.id)}
                >
                  <span
                    className="ph-shortcut__icon"
                  >
                    <img src={asset(shortcutIconPaths[s.id] ?? s.icon)} alt="" />
                    {badge > 0 && (
                      <span className="ph-shortcut__badge">{badge > 99 ? "99+" : badge}</span>
                    )}
                  </span>
                  <span className="ph-shortcut__label">
                    {intl.formatMessage({ id: shortcutLabelIds[s.id] ?? "parent.home.shortcut.unknown" })}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
        ))}

        {renderHomeSection("membership", (
        <div className="ph-frost ph-frost--stack">
          <button
            type="button"
            className="hy-card ph-glass ph-subscription hy-press"
            data-tone={subscriptionCard.tone}
            aria-busy={!entitlement.ready && !entitlement.isError}
            onClick={() => navigate("/subscription")}
          >
            <span className="ph-subscription__icon">
              <img src={asset("ui/clay/subscription.webp")} alt="" />
            </span>
            <span className="ph-subscription__main">
              <span className="ph-subscription__title">{subscriptionCard.title}</span>
              <span className="ph-subscription__description">{subscriptionCard.description}</span>
              <span className="ph-subscription__meta">{subscriptionCard.meta}</span>
            </span>
            <span className="ph-subscription__action ph-neu-control" aria-hidden="true">
              {subscriptionCard.actionLabel}
            </span>
          </button>

          {/* 친구 초대 — 한 줄과 버튼만. 공동 보호자도 코드를 보고 공유한다(만들기는 주 보호자). */}
          {family?.myRole === "parent" && (
            <button
              type="button"
              className="hy-card ph-glass ph-referral hy-press"
              onClick={() => setReferralOpen(true)}
            >
              <span className="ph-referral__icon" aria-hidden="true">
                <img src={asset("ui/clay/referral.webp")} alt="" />
              </span>
              <span className="ph-referral__headline">
                {intl.formatMessage(
                  { id: "parent.referral.home.headline" },
                  { count: REFERRAL_REWARD_CREDITS_DISPLAY },
                )}
              </span>
              <span className="ph-referral__action ph-neu-control" aria-hidden="true">
                {intl.formatMessage({ id: "parent.referral.home.action" })}
              </span>
            </button>
          )}
        </div>
        ))}
      </div>
      <ReferralRewardPanel
        open={referralOpen && family?.myRole === "parent"}
        onClose={() => setReferralOpen(false)}
        eligibleChildren={referralEligibleChildren}
      />
      {valueUpsellSource && (
        <PremiumUpsell
          open
          source={valueUpsellSource}
          tier={entitlement.tier}
          returnTo="/parent/home"
          onClose={() => setValueUpsellSource(null)}
          onUpgrade={({ source, feature, returnTo }) => {
            const storage = browserPremiumReturnIntentStorage();
            const saved = storage && returnTo
              ? savePremiumReturnIntent(storage, { source, feature, returnTo })
              : false;
            if (!saved) throw new Error("결제 후 돌아올 화면을 안전하게 보관하지 못했어요. 잠시 후 다시 시도해 주세요.");
            setValueUpsellSource(null);
            navigate("/subscription");
          }}
        />
      )}
    </div>
  );
}

import { useId, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { ChevronLeft, ChevronRight, Pencil, Smartphone, Trash2, AlertTriangle } from "lucide-react";
import { asset } from "@/lib/assets";
import { childAvatarPath } from "@/lib/avatar";
import { useToast } from "@/app/toast";
import { useActiveChild } from "@/app/activeChild";
import { useDialogFocusLifecycle } from "@/components/useDialogFocusLifecycle";
import { useMyFamily, useUnpairChild } from "@/queries/useFamily";
import { useEvents } from "@/queries/useSchedule";
import { useChildLocations, useSavedPlaces } from "@/queries/useLocation";
import { useLocationLabels } from "@/queries/useLocationLabels";
import { mapFamilyToView } from "@/transform/familyView";
import { hasJongseong } from "@/transform/adventureMap";
import { dateToDateKeyInTimeZone, parseAppDateKey } from "@/transform/dateKey";
import { filterEventsForChild } from "@/transform/eventScope";
import { formatFreshness } from "@/transform/locationView";
import { useLocale } from "@/i18n/useLocale";
import { LEGACY_FAMILY_TIME_ZONE } from "@/i18n/format";
import { useRecentDateKeys } from "@/app/useRecentDateKeys";
import { Loading } from "@/components/ui/Loading";
import "./ChildDetail.css";
import { useIntl } from "react-intl";
import { localizeApiError } from "@/i18n/apiError";

// 자녀 사진은 인증 fetch로 만든 blob URL, 기본 아바타는 asset 경로.
function avatarSrc(path: string): string {
  return path.startsWith("http") || path.startsWith("blob:") ? path : asset(path);
}

const ORDINAL_IDS: Record<number, string> = {
  1: "parent.ordinal.first",
  2: "parent.ordinal.second",
  3: "parent.ordinal.third",
  4: "parent.ordinal.fourth",
};

// 바로가기 CTA 정의(라벨·3D 아이콘·경로). 첫 항목만 강조(민트).
// 유니코드 이모지 대신 3D 에셋 — 앱 공통 시각 언어(구독·홈과 동일).
const QUICK_ACTIONS: Array<{ icon: string; labelId: string; to: string; primary?: boolean }> = [
  { icon: "ui/pin-heart.webp", labelId: "parent.childDetail.liveLocation", to: "/parent/location", primary: true },
  { icon: "ui/calendar-heart.webp", labelId: "parent.childDetail.calendar", to: "/parent/calendar" },
  { icon: "ui/chat-heart.webp", labelId: "parent.childDetail.chat", to: "/parent/memo" },
  { icon: "ui/star-medal.webp", labelId: "parent.childDetail.sticker", to: "/sticker-send" },
];

type SafetyTone = "safe" | "warn" | "muted";

/**
 * 아이 상세 허브 (와이어프레임 P-03).
 * location.state.childId 로 대상 아이를 특정 → 프로필·오늘 요약·안전상태 표시 +
 * 위치/캘린더/채팅/스티커/주변소리 진입, 프로필 편집.
 * 데이터는 모두 실 훅(가족·일정·위치) 기반. 백엔드 부재 항목은 정직하게 처리.
 */
export function ChildDetail() {
  const intl = useIntl();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const routeLocation = useLocation();
  const { show } = useToast();
  const childId = (routeLocation.state as { childId?: string } | null)?.childId ?? null;

  const recentDateKeys = useRecentDateKeys(1, LEGACY_FAMILY_TIME_ZONE);
  const recentTodayKey = recentDateKeys[0];
  const now = useMemo(() => new Date(), [recentTodayKey]);
  const familyQuery = useMyFamily();
  const eventsQuery = useEvents();
  const locationsQuery = useChildLocations();
  const placesQuery = useSavedPlaces();
  const unpair = useUnpairChild();
  const { activeChild, setActiveChildId } = useActiveChild();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteTitleId = useId();
  const deleteDescriptionId = useId();
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const detailLoading = familyQuery.isLoading
    || eventsQuery.isLoading
    || locationsQuery.isLoading
    || placesQuery.isLoading;
  const detailError = familyQuery.isError
    || eventsQuery.isError
    || locationsQuery.isError
    || placesQuery.isError;
  const retryChildDetail = async () => {
    await Promise.all([
      familyQuery.refetch(),
      eventsQuery.refetch(),
      locationsQuery.refetch(),
      placesQuery.refetch(),
    ]);
  };

  const members = useMemo(() => familyQuery.data?.members ?? [], [familyQuery.data]);

  // 대상 아이: 명시 childId 우선, 없으면 전역 활성 아이. 잘못된 childId 를 첫째로 바꾸지 않는다.
  const rawChild = useMemo(() => {
    const children = members.filter((m) => m.role === "child");
    if (childId) return children.find((m) => m.id === childId) ?? null;
    return activeChild && children.some((m) => m.id === activeChild.id) ? activeChild : null;
  }, [members, childId, activeChild]);
  const deleteDialogVisible = confirmDelete && !detailError && !detailLoading && rawChild !== null;
  const deleteDialogRef = useDialogFocusLifecycle<HTMLDivElement>({
    open: deleteDialogVisible,
    onClose: () => setConfirmDelete(false),
    initialFocusRef: deleteCancelRef,
    canClose: () => !unpair.isPending,
  });

  const childView = useMemo(() => {
    const view = mapFamilyToView(members, null, intl);
    return view.children.find((c) => c.id === rawChild?.id) ?? null;
  }, [members, rawChild, intl]);

  // 오늘/다가오는 일정 — 이 아이 배정(events_children) + 가족 공유(is_family_event)만 집계.
  // (가족 전체를 세면 두 아이 상세가 항상 같은 수 — 아이별 구분 원칙 위반.)
  const events = eventsQuery.data;
  const childEvents = useMemo(() => {
    return filterEventsForChild(events ?? [], rawChild?.id);
  }, [events, rawChild?.id]);
  const todayCount = useMemo(() => {
    const key = recentTodayKey ?? dateToDateKeyInTimeZone(now, LEGACY_FAMILY_TIME_ZONE);
    return childEvents.filter((e) => e.date_key === key).length;
  }, [childEvents, now, recentTodayKey]);
  const upcomingCount = useMemo(() => {
    const todayMid = parseAppDateKey(
      recentTodayKey ?? dateToDateKeyInTimeZone(now, LEGACY_FAMILY_TIME_ZONE),
    )?.getTime();
    if (todayMid == null) return 0;
    return childEvents.filter((e) => {
      const d = parseAppDateKey(e.date_key);
      return d != null && d.getTime() > todayMid;
    }).length;
  }, [childEvents, now, recentTodayKey]);

  // 안전 상태 — 실 위치 신선도 + 저장장소 근접.
  const loc = useMemo(() => {
    const locs = locationsQuery.data ?? [];
    if (!rawChild?.user_id) return null;
    return locs.find((l) => l.user_id === rawChild.user_id) ?? null;
  }, [locationsQuery.data, rawChild]);
  const places = placesQuery.data;
  const fresh = loc ? formatFreshness(loc.updated_at, now, locale, intl) : null;
  const locationLabel = useLocationLabels(loc ? [loc] : [], places);
  const placeName = loc ? locationLabel(loc) : null;

  const safety = useMemo<{ label: string; tone: SafetyTone }>(() => {
    if (!rawChild?.user_id) return { label: intl.formatMessage({ id: "parent.childDetail.copy001" }), tone: "muted" };
    if (!fresh) return { label: intl.formatMessage({ id: "parent.parentLocation.copy008" }), tone: "muted" };
    if (fresh.status === "live") {
      return { label: placeName ? intl.formatMessage({ id: "parent.childDetail.safeAtPlace" }, { place: placeName }) : intl.formatMessage({ id: "parent.childDetail.copy002" }), tone: "safe" };
    }
    if (fresh.status === "recent") {
      return { label: placeName ? intl.formatMessage({ id: "parent.childDetail.placeFreshness" }, { place: placeName, freshness: fresh.label }) : fresh.label, tone: "safe" };
    }
    return { label: intl.formatMessage({ id: "parent.childDetail.locationFreshness" }, { freshness: fresh.label }), tone: "warn" };
  }, [rawChild, fresh, placeName, intl]);

  // ── 로딩/빈 상태 ──
  if (detailError) {
    return (
      <div className="cd-root">
        <Header title={intl.formatMessage({ id: "parent.childDetail.copy003" })} onBack={() => navigate(-1)} onEdit={null} />
        <div className="cd-state" role="alert">
          {intl.formatMessage({ id: "parent.childDetail.copy004" })}
          <button type="button" className="cd-state__btn hy-press" onClick={() => void retryChildDetail()}>
            {intl.formatMessage({ id: "parent.parentHome.copy017" })}
          </button>
        </div>
      </div>
    );
  }
  if (detailLoading) {
    return (
      <div className="cd-root">
        <Header title={intl.formatMessage({ id: "parent.childDetail.copy003" })} onBack={() => navigate(-1)} onEdit={null} />
        <div className="cd-state"><Loading label={intl.formatMessage({ id: "parent.childDetail.copy005" })} /></div>
      </div>
    );
  }
  if (!rawChild) {
    return (
      <div className="cd-root">
        <Header title={intl.formatMessage({ id: "parent.childDetail.copy003" })} onBack={() => navigate(-1)} onEdit={null} />
        <div className="cd-state">
          {intl.formatMessage({ id: "parent.childDetail.copy006" })}
          <button type="button" className="cd-state__btn hy-press" onClick={() => navigate(-1)}>
            {intl.formatMessage({ id: "parent.childDetail.copy007" })}
          </button>
        </div>
      </div>
    );
  }

  const name = childView?.name || rawChild.name || intl.formatMessage({ id: "parent.parentHome.copy004" });
  const avatar = childView?.avatar || childAvatarPath(rawChild.photo_url);
  const soft = childView?.soft || "var(--hy-accent-soft)";
  const ordinalId = rawChild.child_order ? ORDINAL_IDS[rawChild.child_order] ?? null : null;
  const deviceLabel = rawChild.device_label?.trim() || null;
  const isPrimary = familyQuery.data?.isPrimaryParent ?? false;
  const childUserId = rawChild.user_id || null;

  // 아이 삭제(연결 해제) — 주 보호자만. 서버가 대화·공유 사진·위치·오디오·토큰까지 정리한다.
  const onDelete = async () => {
    if (unpair.isPending) return;
    if (!isPrimary) {
      show(intl.formatMessage({ id: "parent.childDetail.copy008" }), "🔒");
      return;
    }
    if (!childUserId) {
      show(intl.formatMessage({ id: "parent.childDetail.copy009" }), "⚠️");
      return;
    }
    try {
      await unpair.mutateAsync(childUserId);
      show(intl.formatMessage(
        { id: "parent.childDetail.removedFromFamily" },
        { target: locale === "ko" ? `${name}${hasJongseong(name) ? "을" : "를"}` : name },
      ), "🗑️");
      navigate(-1);
    } catch (e) {
      show(localizeApiError(e, intl, "formal"), "⚠️");
    }
  };

  return (
    <div className="cd-root">
      <Header
        title={name}
        onBack={() => navigate(-1)}
        onEdit={() => navigate("/profile-edit", { state: { childId: rawChild.id } })}
      />

      <div className="cd-content">
        {/* 프로필 히어로 */}
        <div className="cd-hero">
          <span className="cd-hero__avatar" style={{ background: soft }}>
            <img className="hy-network-avatar" src={avatarSrc(avatar)} alt="" loading="eager" decoding="async" />
          </span>
          <div className="cd-hero__main">
            <div className="cd-hero__name">{name}</div>
            {ordinalId && <div className="cd-hero__sub">{intl.formatMessage({ id: "parent.childDetail.ordinalChild" }, { ordinal: intl.formatMessage({ id: ordinalId }) })}</div>}
            <div className="cd-hero__device">
              <Smartphone size={13} strokeWidth={2.2} />
              {deviceLabel ?? intl.formatMessage({ id: "parent.parentHome.copy032" })}
            </div>
            <span className={`cd-safety cd-safety--${safety.tone}`}>
              <span className="cd-safety__dot" />
              {safety.label}
            </span>
          </div>
        </div>

        {/* 오늘 요약 */}
        <div className="cd-stats">
          <div className="cd-stat">
            <span className="cd-stat__k">{intl.formatMessage({ id: "parent.childDetail.copy012" })}</span>
            <span className="cd-stat__v">
              {eventsQuery.isLoading ? "…" : intl.formatMessage({ id: "parent.childDetail.eventCount" }, { count: todayCount })}
            </span>
          </div>
          <div className="cd-stat">
            <span className="cd-stat__k">{intl.formatMessage({ id: "parent.childDetail.copy013" })}</span>
            <span className="cd-stat__v">
              {eventsQuery.isLoading ? "…" : intl.formatMessage({ id: "parent.childDetail.eventCount" }, { count: upcomingCount })}
            </span>
          </div>
        </div>

        {/* 바로가기 CTA — 이 아이를 전역 활성으로 지정 후 이동(위치·대화·스티커가 이 아이 기준). */}
        <div className="cd-actions">
          {QUICK_ACTIONS.map((a) => (
            <button
              key={a.labelId}
              type="button"
              className={a.primary ? "cd-action cd-action--primary hy-press" : "cd-action hy-press"}
              onClick={() => {
                setActiveChildId(rawChild.id);
                navigate(a.to);
              }}
            >
              <span className="cd-action__emoji">
                <img src={asset(a.icon)} alt="" style={{ width: 24, height: 24, objectFit: "contain" }} />
              </span>
              {intl.formatMessage({ id: a.labelId })}
            </button>
          ))}
        </div>

        {/* 주변소리 — 이 아이 기기를 대상으로 지정 */}
        <button
          type="button"
          className="cd-row hy-press"
          onClick={() => {
            setActiveChildId(rawChild.id);
            navigate("/remote-audio", { state: { childUserId: rawChild.user_id ?? undefined } });
          }}
        >
          <span className="cd-row__icon">
            <img src={asset("ui/menu-remote-audio.webp")} alt="" style={{ width: 24, height: 24, objectFit: "contain" }} />
          </span>
          <span className="cd-row__main">
            <span className="cd-row__title">{intl.formatMessage({ id: "parent.home.shortcut.remoteAudio" })}</span>
            <span className="cd-row__sub">{intl.formatMessage({ id: "parent.childDetail.copy014" })}</span>
          </span>
          <ChevronRight size={20} strokeWidth={2.4} color="var(--fg-disabled)" />
        </button>

        {/* 소리 울리기 — 이 아이 기기에서 최대 볼륨 알람(무음이어도 울림) */}
        <button
          type="button"
          className="cd-row hy-press"
          onClick={() => {
            setActiveChildId(rawChild.id);
            navigate("/remote-ring", { state: { childUserId: rawChild.user_id ?? undefined } });
          }}
        >
          <span className="cd-row__icon">
            <img src={asset("ui/bell.webp")} alt="" style={{ width: 24, height: 24, objectFit: "contain" }} />
          </span>
          <span className="cd-row__main">
            <span className="cd-row__title">{intl.formatMessage({ id: "parent.childDetail.copy015" })}</span>
            <span className="cd-row__sub">{intl.formatMessage({ id: "parent.childDetail.copy016" })}</span>
          </span>
          <ChevronRight size={20} strokeWidth={2.4} color="var(--fg-disabled)" />
        </button>

        {/* 프로필 편집 */}
        <button
          type="button"
          className="cd-row hy-press"
          onClick={() => navigate("/profile-edit", { state: { childId: rawChild.id } })}
        >
          <span className="cd-row__icon">
            <img src={asset("animal/bear.webp")} alt="" style={{ width: 24, height: 24, objectFit: "contain" }} />
          </span>
          <span className="cd-row__main">
            <span className="cd-row__title">{intl.formatMessage({ id: "parent.childDetail.copy017" })}</span>
            <span className="cd-row__sub">{intl.formatMessage({ id: "parent.childDetail.copy018" })}</span>
          </span>
          <ChevronRight size={20} strokeWidth={2.4} color="var(--fg-disabled)" />
        </button>

        {/* 아이 삭제(연결 해제) — 주 보호자만. 대화·공유 사진·위치·연결을 영구 삭제 */}
        {isPrimary && (
          <button
            type="button"
            className="cd-danger hy-press"
            onClick={() => setConfirmDelete(true)}
          >
            <span className="cd-danger__icon">
              <Trash2 size={20} strokeWidth={2.2} />
            </span>
            <span className="cd-danger__main">
              <span className="cd-danger__title">{intl.formatMessage({ id: "parent.childDetail.copy019" })}</span>
              <span className="cd-danger__sub">{intl.formatMessage({ id: "parent.childDetail.copy020" })}</span>
            </span>
          </button>
        )}
      </div>

      {/* 삭제 확인 시트(네이티브 confirm 미사용 — 인앱 오버레이) */}
      {deleteDialogVisible && (
        <div
          ref={deleteDialogRef}
          className="cd-confirm"
          role="dialog"
          aria-modal="true"
          aria-labelledby={deleteTitleId}
          aria-describedby={deleteDescriptionId}
        >
          <button
            type="button"
            className="cd-confirm__scrim"
            tabIndex={-1}
            aria-label={intl.formatMessage({ id: "parent.parentSettings.copy027" })}
            onClick={() => {
              if (!unpair.isPending) setConfirmDelete(false);
            }}
          />
          <div className="cd-confirm__sheet">
            <span className="cd-confirm__icon">
              <AlertTriangle size={26} strokeWidth={2.2} />
            </span>
            <div id={deleteTitleId} className="cd-confirm__title">{name} {intl.formatMessage({ id: "parent.childDetail.copy021" })}</div>
            <p id={deleteDescriptionId} className="cd-confirm__desc">
              {intl.formatMessage({ id: "parent.childDetail.copy022" })}
            </p>
            <div className="cd-confirm__btns">
              <button
                ref={deleteCancelRef}
                type="button"
                className="cd-confirm__cancel hy-press"
                onClick={() => setConfirmDelete(false)}
                disabled={unpair.isPending}
                data-progress-owner="confirm-action"
              >
                {intl.formatMessage({ id: "parent.parentSettings.copy031" })}
              </button>
              <button
                type="button"
                className="cd-confirm__delete hy-press"
                onClick={onDelete}
                disabled={unpair.isPending} aria-busy={unpair.isPending}
              >
                {unpair.isPending ? intl.formatMessage({ id: "parent.parentSettings.copy032" }) : intl.formatMessage({ id: "parent.childDetail.copy023" })}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 상단 sticky 헤더(뒤로가기 + 프로필 편집).
function Header({
  title,
  onBack,
  onEdit,
}: {
  title: string;
  onBack: () => void;
  onEdit: (() => void) | null;
}) {
  const intl = useIntl();
  return (
    <header className="cd-header">
      <button type="button" className="hy-iconbtn hy-press cd-back" aria-label={intl.formatMessage({ id: "parent.parentSettings.copy017" })} onClick={onBack}>
        <ChevronLeft size={22} strokeWidth={2.2} />
      </button>
      <span className="cd-htitle">{title}</span>
      {onEdit ? (
        <button
          type="button"
          className="hy-iconbtn hy-press cd-edit"
          aria-label={intl.formatMessage({ id: "parent.childDetail.copy017" })}
          onClick={onEdit}
        >
          <Pencil size={20} strokeWidth={2} />
        </button>
      ) : (
        <span className="cd-edit" />
      )}
    </header>
  );
}

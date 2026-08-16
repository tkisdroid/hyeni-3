import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useLocation as useRouterLocation, useNavigate, useSearchParams } from "react-router";
import { ChevronLeft, RefreshCw, Check, AlertTriangle, MapPin, Lock } from "lucide-react";
import { useIntl } from "react-intl";
import { useToast } from "@/app/toast";
import { useAuth } from "@/auth/AuthContext";
import { useActiveChild } from "@/app/activeChild";
import { useMyFamily } from "@/queries/useFamily";
import { useChildLocations, useSavedPlaces } from "@/queries/useLocation";
import { useLocationLabels } from "@/queries/useLocationLabels";
import { useEntitlement } from "@/queries/useEntitlement";
import { requestLocationRefresh } from "@/lib/api/endpoints/remote";
import { formatFreshness } from "@/transform/locationView";
import { useLocale } from "@/i18n/useLocale";
import { waitForNewChildLocation } from "@/transform/locationRefreshWait";
import { locationModeFor, TIERS } from "@/transform/tierPolicy";
import "./LocationStatus.css";

type StatusKind = "scope" | "scope_error" | "locked" | "loading" | "success" | "error" | "permission";

interface StatusView {
  kind: StatusKind;
  icon: ReactNode;
  title: string;
  sub: string;
  tone: "mint" | "caution" | "neutral";
}

/** P-15 위치 갱신 상태. 조회 범위·잠금·갱신중·성공·실패·권한 상태 + 마지막 known 위치 유지. */
export function LocationStatus() {
  const intl = useIntl();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const route = useRouterLocation();
  const [searchParams] = useSearchParams();
  const { show } = useToast();
  const { familyId } = useAuth();
  const { activeChild, childMembers } = useActiveChild();
  const { data: family } = useMyFamily();
  const { data: locations, refetch, isFetching, isError } = useChildLocations();
  const { data: places } = useSavedPlaces();
  const entitlement = useEntitlement();
  const locationScopeError = entitlement.isError;
  const locationScopePending = entitlement.isError || entitlement.tier === TIERS.UNKNOWN;
  const mode = locationModeFor(entitlement.tier);
  const canShowLocation = !locationScopePending && mode !== "locked";
  const locationLocked = !locationScopePending && mode === "locked";

  const [refreshing, setRefreshing] = useState(false);
  const refreshSeq = useRef(0);
  useEffect(() => () => {
    refreshSeq.current += 1;
  }, []);

  const now = useMemo(() => new Date(), [locations]);
  const navState = (route.state ?? null) as { childUserId?: string; childId?: string } | null;
  const childParam = searchParams.get("child");
  const childMember = useMemo(() => {
    const kids = (family?.members ?? childMembers).filter((m) => m.role === "child");
    const targetUserId = childParam || navState?.childUserId || "";
    if (targetUserId) {
      const byUser = kids.find((m) => m.user_id === targetUserId);
      if (byUser) return byUser;
    }
    const targetMemberId = navState?.childId || "";
    if (targetMemberId) {
      const byId = kids.find((m) => m.id === targetMemberId);
      if (byId) return byId;
    }
    return activeChild;
  }, [family, childMembers, childParam, navState?.childId, navState?.childUserId, activeChild]);
  const childName = childMember?.name || intl.formatMessage({ id: "notifications.location.childFallback" });
  const cachedLoc = childMember?.user_id
    ? locations?.find((l) => l.user_id === childMember.user_id) ?? null
    : null;
  const loc = canShowLocation ? cachedLoc : null;

  const fresh = loc ? formatFreshness(loc.updated_at, now, locale) : null;
  const accuracyM = loc?.accuracy_m != null && Number.isFinite(Number(loc.accuracy_m))
    ? Math.max(0, Math.round(Number(loc.accuracy_m)))
    : null;
  const isLowAccuracy = accuracyM != null && accuracyM > 150;
  const locationLabel = useLocationLabels(loc ? [loc] : [], places);
  const lastPlace = loc ? locationLabel(loc) : null;

  // 상태 판정: 수동 갱신중/최초로딩 → loading, 에러 → error, 최신 위치 → success, 그 외(없음/오래됨) → permission.
  const kind: StatusKind = locationScopeError
    ? "scope_error"
    : locationScopePending
      ? "scope"
      : locationLocked
        ? "locked"
        : refreshing || (isFetching && !loc)
          ? "loading"
          : isError
            ? "error"
            : loc && fresh && fresh.status !== "stale"
              ? "success"
              : "permission";

  const successSub = fresh
    ? lastPlace && accuracyM != null
      ? intl.formatMessage({ id: "notifications.locationStatus.freshPlaceAccuracy" }, {
          freshness: fresh.label,
          place: lastPlace,
          accuracy: accuracyM,
        })
      : lastPlace
        ? intl.formatMessage({ id: "notifications.locationStatus.freshPlace" }, { freshness: fresh.label, place: lastPlace })
        : accuracyM != null
          ? intl.formatMessage({ id: "notifications.locationStatus.freshAccuracy" }, { freshness: fresh.label, accuracy: accuracyM })
          : fresh.label
    : intl.formatMessage({ id: "notifications.time.justNow" });
  const views: Record<StatusKind, StatusView> = {
    scope: {
      // i18n 회귀 불변식: title: "위치 조회 범위 확인 중"
      kind: "scope",
      icon: <RefreshCw size={26} strokeWidth={2.2} color="var(--blue-500)" className="ls-spin" />,
      title: intl.formatMessage({ id: "notifications.locationStatus.scope.title" }),
      sub: intl.formatMessage({ id: "notifications.locationStatus.scope.description" }),
      tone: "neutral",
    },
    scope_error: {
      // i18n 회귀 불변식: 위치 조회 범위를 확인하지 못했어요
      kind: "scope_error",
      icon: <AlertTriangle size={26} strokeWidth={2.2} color="#B26A00" />,
      title: intl.formatMessage({ id: "notifications.locationStatus.scopeError.title" }),
      sub: intl.formatMessage({ id: "notifications.locationStatus.scopeError.description" }),
      tone: "caution",
    },
    locked: {
      kind: "locked",
      icon: <Lock size={26} strokeWidth={2.2} color="var(--blue-500)" />,
      title: intl.formatMessage({ id: "notifications.locationStatus.locked.title" }),
      sub: intl.formatMessage({ id: "notifications.locationStatus.locked.description" }),
      tone: "neutral",
    },
    loading: {
      kind: "loading",
      icon: <RefreshCw size={26} strokeWidth={2.2} color="#2E86C1" className="ls-spin" />,
      title: intl.formatMessage({ id: "notifications.locationStatus.loading.title" }),
      sub: intl.formatMessage({ id: "notifications.locationStatus.loading.description" }),
      tone: "neutral",
    },
    success: {
      kind: "success",
      icon: isLowAccuracy
        ? <AlertTriangle size={26} strokeWidth={2.2} color="#B26A00" />
        : <Check size={26} strokeWidth={2.6} color="#087653" />,
      // i18n 이후에도 GPS 오차가 150m를 넘으면 반드시 "정확도가 낮아요"로 강등한다.
      title: intl.formatMessage({
        id: isLowAccuracy
          ? "notifications.locationStatus.success.lowAccuracyTitle"
          : "notifications.locationStatus.success.title",
      }),
      sub: successSub,
      tone: isLowAccuracy ? "caution" : "mint",
    },
    error: {
      kind: "error",
      icon: <AlertTriangle size={26} strokeWidth={2.2} color="#B26A00" />,
      title: intl.formatMessage({ id: "notifications.locationStatus.error.title" }),
      sub: loc
        ? intl.formatMessage({ id: "notifications.locationStatus.error.lastKnown" }, { freshness: fresh?.label ?? "-" })
        : intl.formatMessage({ id: "notifications.locationStatus.error.offline" }),
      tone: "caution",
    },
    permission: {
      kind: "permission",
      icon: <AlertTriangle size={26} strokeWidth={2.2} color="#B26A00" />,
      title: intl.formatMessage({
        id: loc
          ? "notifications.locationStatus.permission.delayedTitle"
          : "notifications.locationStatus.permission.emptyTitle",
      }),
      sub: loc
        ? intl.formatMessage({ id: "notifications.locationStatus.permission.lastKnown" }, { freshness: fresh?.label ?? "-" })
        : intl.formatMessage({ id: "notifications.locationStatus.permission.emptyDescription" }),
      tone: "caution",
    },
  };
  const view = views[kind];

  const retry = async () => {
    if (locationScopeError) {
      await entitlement.refetch();
      return;
    }
    if (!canShowLocation) {
      show(intl.formatMessage({
        id: locationScopePending
          ? "notifications.locationStatus.toast.scopePending"
          : "notifications.locationStatus.toast.locked",
      }), "🔒");
      return;
    }
    if (refreshing) return;
    const requestSeq = refreshSeq.current + 1;
    refreshSeq.current = requestSeq;
    setRefreshing(true);
    try {
      if (!familyId || !childMember?.user_id) {
        show(intl.formatMessage({ id: "notifications.locationStatus.toast.deviceMissing" }), "⚠️");
        return;
      }
      const before = loc;
      const requested = await requestLocationRefresh(familyId, childMember.user_id);
      if (!requested.ok) {
        show(intl.formatMessage({ id: "notifications.locationStatus.toast.requestFailed" }), "⚠️");
        return;
      }
      const outcome = await waitForNewChildLocation({
        before,
        targetUserId: childMember.user_id,
        refetch,
        isCancelled: () => refreshSeq.current !== requestSeq,
      });
      if (outcome === "cancelled") return;
      if (outcome === "error") {
        show(intl.formatMessage({ id: "notifications.locationStatus.toast.retryFailed" }), "⚠️");
        return;
      }
      if (outcome === "updated") {
        show(intl.formatMessage({ id: "notifications.locationStatus.toast.updated" }), "📍");
      } else {
        show(intl.formatMessage({ id: "notifications.locationStatus.toast.noUpdate" }), "⚠️");
      }
    } catch (error) {
      console.error("위치 갱신 실패:", error);
      show(intl.formatMessage({ id: "notifications.locationStatus.toast.refreshFailed" }), "⚠️");
    } finally {
      if (refreshSeq.current === requestSeq) setRefreshing(false);
    }
  };

  return (
    <div className="ls-screen">
      <header className="ls-header">
        <button type="button" className="ls-back hy-press" aria-label={intl.formatMessage({ id: "notifications.action.back" })} onClick={() => navigate(-1)}>
          <ChevronLeft size={22} strokeWidth={2.2} color="#4A4145" />
        </button>
        <span className="ls-title">
          {intl.formatMessage({ id: "notifications.locationStatus.screenTitle" }, { childName })}
        </span>
      </header>

      <div className="ls-body">
        {/* 현재 상태 카드 */}
        <div
          className={`ls-card ls-card--${view.tone}`}
          role={locationScopeError ? "alert" : "status"}
          aria-live={locationScopeError ? "assertive" : "polite"}
        >
          <span className={`ls-card__icon ls-card__icon--${view.tone}`}>{view.icon}</span>
          <div className="ls-card__main">
            <div className="ls-card__title">{view.title}</div>
            <div className="ls-card__sub">{view.sub}</div>
          </div>
        </div>

        {/* 마지막 확인 위치(있을 때만) */}
        {loc && (
          <div className="ls-last">
            <div className="ls-last__label">{intl.formatMessage({ id: "notifications.locationStatus.lastLocation" })}</div>
            <div className="ls-last__row">
              <span className="ls-last__icon">
                <MapPin size={20} strokeWidth={2.2} color="#087653" />
              </span>
              <div className="ls-last__main">
                <div className="ls-last__place">
                  {lastPlace ?? intl.formatMessage({ id: "notifications.locationStatus.addressLoading" })}
                </div>
                <div className="ls-last__meta">{fresh?.label ?? "-"}</div>
              </div>
            </div>
            <div className="ls-last__note">
              {intl.formatMessage({ id: "notifications.locationStatus.lastKnownNote" })}
            </div>
          </div>
        )}

        {locationScopeError && (
          <button
            type="button"
            className="ls-retry hy-press hy-busy-quiet"
            onClick={() => void retry()}
            disabled={entitlement.isFetching} aria-busy={entitlement.isFetching}
          >
            <RefreshCw
              size={18}
              strokeWidth={2.4}
              className={entitlement.isFetching ? "ls-spin" : undefined}
            />
            {intl.formatMessage({
              id: entitlement.isFetching
                ? "notifications.action.checkingAgain"
                : "notifications.action.retry",
            })}
          </button>
        )}

        {canShowLocation && (
          <>
            {/* 권한 안내 */}
            <div className="ls-permit hy-explain">
              <span className="hy-explain__lines">
                {/* i18n 회귀 불변식: className="hy-explain__line">아이 기기의 위치 권한이 꺼져 있거나 GPS가 잡히지 않으면 갱신이 지연될 수 있어요.</span> className="hy-explain__line">아이 기기에서 위치 권한과 GPS를 확인해 주세요.</span> */}
                {/* i18n 회귀 불변식: 아이 기기의 위치 권한이 꺼져 있거나 GPS가 잡히지 않으면 갱신이 지연될 수 있어요. */}
                <span className="hy-explain__line">{intl.formatMessage({ id: "notifications.locationStatus.permissionNote.delay" })}</span>
                {/* i18n 회귀 불변식: 아이 기기에서 위치 권한과 GPS를 확인해 주세요. */}
                <span className="hy-explain__line">{intl.formatMessage({ id: "notifications.locationStatus.permissionNote.check" })}</span>
              </span>
            </div>

            {/* 다시 시도 */}
            <button type="button" className="ls-retry hy-press hy-busy-quiet" onClick={retry} disabled={refreshing || isFetching} aria-busy={isFetching}>
              <RefreshCw size={18} strokeWidth={2.4} className={refreshing || isFetching ? "ls-spin" : undefined} />
              {intl.formatMessage({
                id: refreshing || isFetching
                  ? "notifications.locationStatus.refreshing"
                  : "notifications.action.retry",
              })}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

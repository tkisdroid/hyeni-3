import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Check, ChevronLeft, RefreshCw, TriangleAlert } from "lucide-react";
import { useIntl } from "react-intl";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { useAuth } from "@/auth/AuthContext";
import { useChildLocations } from "@/queries/useLocation";
import { formatFreshness } from "@/transform/locationView";
import { resolveChildLocationStatusKind } from "@/transform/locationPermissionFlow";
import { useLocale } from "@/i18n/useLocale";
import { Loading } from "@/components/ui/Loading";
import { ChildLocationPermissionDialog } from "@/components/ChildLocationPermissionDialog";
import {
  isLocationTrackingSupported,
  requestImmediateLocation,
  startLocationTracking,
} from "@/lib/native/location";
import { readPermissionState } from "@/lib/native/permissions";
import "./ChildLocationStatus.css";

/**
 * K-03 위치 전송 상태(아이). 반말 톤.
 *
 * "내 위치가 지금 부모님께 보내지고 있는지"를 아이가 안심할 수 있게 보여준다.
 * - 전송중(안심) · 꺼짐(켜기 유도) · 권한필요(켜기 안내) 3상태.
 * - 실 신호: useChildLocations(본인 행) 신선도 + 브라우저 위치 권한 상태.
 * - 켜기: 네이티브(안드로이드)면 즉시 위치요청 + 백그라운드 서비스 시작, 웹이면 권한 프롬프트.
 */

type PermState = "granted" | "prompt" | "denied" | "unknown";
type Kind = "sending" | "off" | "permission";

interface View {
  kind: Kind;
  tone: "mint" | "caution";
  mascot: string;
  title: string;
  desc: string;
}

export function ChildLocationStatus() {
  const intl = useIntl();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const { show } = useToast();
  const { userId, familyId } = useAuth();
  const { data: locations, refetch, isFetching, isLoading, isError } = useChildLocations();

  const [perm, setPerm] = useState<PermState>("unknown");
  const [working, setWorking] = useState(false);
  const [permissionChecking, setPermissionChecking] = useState(false);
  const [permissionDialogOpen, setPermissionDialogOpen] = useState(false);

  const now = useMemo(() => new Date(), [locations]);
  const nativeSupported = isLocationTrackingSupported();

  // 내 위치 행(본인 user_id). 아이 세션에서도 가족 접근 권한으로 조회된다.
  const myLoc = useMemo(() => {
    if (!locations || !userId) return null;
    return locations.find((l) => l.user_id === userId) ?? null;
  }, [locations, userId]);
  const location = myLoc;
  const refetchLocation = async () => {
    await refetch();
  };

  const fresh = myLoc ? formatFreshness(myLoc.updated_at, now, locale) : null;
  const isFreshEnough = fresh != null && fresh.status !== "stale";

  const refreshPermission = useCallback(() => {
    if (nativeSupported) {
      readPermissionState("loc")
        .then((state) => setPerm(state.granted ? "granted" : "denied"))
        .catch(() => setPerm("unknown"));
      return;
    }
    if (!("permissions" in navigator) || !navigator.permissions?.query) {
      setPerm("unknown");
      return;
    }
    navigator.permissions
      .query({ name: "geolocation" as PermissionName })
      .then((statusResult) => {
        setPerm(statusResult.state as PermState);
        statusResult.onchange = () => setPerm(statusResult.state as PermState);
      })
      .catch(() => setPerm("unknown"));
  }, [nativeSupported]);

  useEffect(() => {
    refreshPermission();
  }, [refreshPermission]);

  // 상태 판정: 최신 위치 있으면 전송중, 아니면 권한 거부→권한필요 / 그 외→꺼짐.
  const kind: Kind = resolveChildLocationStatusKind({
    freshEnough: isFreshEnough,
    permission: perm === "prompt" ? "unknown" : perm,
  });

  const views: Record<Kind, View> = {
    sending: {
      kind: "sending",
      tone: "mint",
      mascot: asset("status/safe.webp"),
      title: intl.formatMessage({ id: "child.location.sending.title" }),
      desc: intl.formatMessage({ id: "child.location.sending.description" }),
    },
    off: {
      kind: "off",
      tone: "caution",
      mascot: asset("mascot/thinking.webp"),
      title: intl.formatMessage({ id: "child.location.off.title" }),
      desc: nativeSupported
        ? intl.formatMessage({ id: "child.location.off.nativeDescription" })
        : intl.formatMessage({ id: "child.location.off.webDescription" }),
    },
    permission: {
      kind: "permission",
      tone: "caution",
      mascot: asset("mascot/thinking.webp"),
      title: intl.formatMessage({ id: "child.location.permission.title" }),
      desc: intl.formatMessage({ id: "child.location.permission.description" }),
    },
  };
  const view = views[kind];

  // 위치 켜기 / 새로고침. 네이티브면 실제 전송·서비스 시작, 웹이면 권한 프롬프트.
  const turnOn = async () => {
    if (working) return;
    setWorking(true);
    try {
      const ctx = { familyId: familyId ?? "", userId: userId ?? "", role: "child" as const };
      if (nativeSupported) {
        await requestImmediateLocation(ctx);
        await startLocationTracking(ctx);
        refreshPermission();
        await refetch();
        show(intl.formatMessage({ id: "child.location.toast.sent" }), "📍");
      } else if ("geolocation" in navigator) {
        // 웹: OS 권한 프롬프트를 띄우고 상태를 갱신(백그라운드 전송은 앱에서 동작).
        await new Promise<void>((resolve) => {
          navigator.geolocation.getCurrentPosition(
            () => {
              show(intl.formatMessage({ id: "child.location.toast.checked" }), "📍");
              resolve();
            },
            () => {
              show(intl.formatMessage({ id: "child.location.toast.permissionNeeded" }), "⚠️");
              resolve();
            },
            { enableHighAccuracy: true, timeout: 8000 },
          );
        });
        refreshPermission();
        await refetch();
      } else {
        show(intl.formatMessage({ id: "child.location.toast.unsupported" }), "⚠️");
      }
    } catch (error) {
      console.error("위치 켜기 실패:", error);
      show(intl.formatMessage({ id: "child.location.toast.failed" }), "⚠️");
    } finally {
      setWorking(false);
    }
  };

  const busy = working || permissionChecking || isFetching;
  const handlePrimaryAction = async () => {
    if (working || permissionChecking) return;
    if (view.kind === "sending" || !nativeSupported) {
      await turnOn();
      return;
    }

    setPermissionChecking(true);
    try {
      const state = await readPermissionState("loc");
      setPerm(state.granted ? "granted" : "denied");
      if (state.granted) await turnOn();
      else setPermissionDialogOpen(true);
    } finally {
      setPermissionChecking(false);
    }
  };

  const finishPermissionSetup = async () => {
    setPermissionDialogOpen(false);
    setPerm("granted");
    await turnOn();
  };

  return (
    <div className={`cls-screen cls-screen--${view.tone}`}>
      <header className="cls-header">
        <button type="button" className="cls-back hy-press" aria-label={intl.formatMessage({ id: "child.action.back" })} onClick={() => navigate(-1)}>
          <ChevronLeft size={22} strokeWidth={2.2} color="#4A4145" />
        </button>
        <span className="cls-title">{intl.formatMessage({ id: "child.location.title" })}</span>
      </header>

      {isLoading ? (
        <div className="cls-body" role="status">
          <div className="cls-heading"><Loading label={intl.formatMessage({ id: "child.location.loading" })} /></div>
        </div>
      ) : isError ? (
        <div className="cls-body" role="alert">
          <div className="cls-heading">
            <div className="cls-heading__title">{intl.formatMessage({ id: "child.location.loadError.title" })}</div>
            <div className="cls-heading__desc">{intl.formatMessage({ id: "child.location.loadError.description" })}</div>
          </div>
          <button type="button" className="cls-cta hy-press" onClick={() => void refetchLocation()}>
            <RefreshCw size={18} strokeWidth={2.4} /> {intl.formatMessage({ id: "child.action.reload" })}
          </button>
        </div>
      ) : (
      <div className="cls-body">
        {!location && <div className="cls-heading__desc" role="status">{intl.formatMessage({ id: "child.location.empty" })}</div>}
        {location && <span className="sr-only">{intl.formatMessage({ id: "child.location.latestConfirmed" })}</span>}
        {/* 상태 마스코트 */}
        <div className={`cls-orb cls-orb--${view.tone}`}>
          {view.kind === "sending" && <span className="cls-live" aria-hidden="true" />}
          <img className="cls-orb__img" src={view.mascot} alt="" />
        </div>

        {/* 제목 · 설명 */}
        <div className="cls-heading">
          <div className={`cls-heading__title cls-heading__title--${view.tone}`}>{view.title}</div>
          <div className="cls-heading__desc">{view.desc}</div>
        </div>

        {/* 상태 상세 행 */}
        <div className={`cls-detail cls-detail--${view.tone}`}>
          <span className="cls-detail__icon" aria-hidden="true">
            {view.kind === "sending"
              ? <Check size={18} strokeWidth={2.4} />
              : <TriangleAlert size={18} strokeWidth={2.4} />}
          </span>
          <div className="cls-detail__main">
            <div className="cls-detail__title">
              {intl.formatMessage({ id: view.kind === "sending" ? "child.location.detail.on" : "child.location.detail.turnOn" })}
            </div>
            <div className="cls-detail__sub">
              {view.kind === "sending"
                ? intl.formatMessage(
                    { id: "child.location.detail.updated" },
                    { freshness: fresh?.label ?? intl.formatMessage({ id: "child.location.justNow" }) },
                  )
                : myLoc
                  ? intl.formatMessage(
                      { id: "child.location.detail.lastChecked" },
                      { freshness: fresh?.label ?? "-" },
                    )
                  : intl.formatMessage({ id: "child.location.detail.neverSent" })}
            </div>
          </div>
        </div>

        {/* 켜기 / 새로고침 */}
        <button type="button" className="cls-cta hy-press hy-busy-quiet" onClick={() => void handlePrimaryAction()} disabled={busy} aria-busy={busy}>
          <RefreshCw size={18} strokeWidth={2.4} className={busy ? "cls-spin" : undefined} />
          {intl.formatMessage({
            id: busy
              ? "child.location.checking"
              : view.kind === "sending"
                ? "child.location.refreshNow"
                : "child.location.turnOn",
          })}
        </button>
      </div>
      )}
      <ChildLocationPermissionDialog
        open={permissionDialogOpen}
        copyMode="child"
        onDismiss={() => setPermissionDialogOpen(false)}
        onPermissionGranted={finishPermissionSetup}
      />
    </div>
  );
}

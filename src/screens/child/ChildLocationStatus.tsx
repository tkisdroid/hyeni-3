import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Check, ChevronLeft, RefreshCw, Send, TriangleAlert } from "lucide-react";
import { useIntl } from "react-intl";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { useAuth } from "@/auth/AuthContext";
import { useChildLocations } from "@/queries/useLocation";
import { formatFreshness } from "@/transform/locationView";
import { resolveChildLocationStatusKind } from "@/transform/locationPermissionFlow";
import { waitForNewChildLocation } from "@/transform/locationRefreshWait";

/** 아이가 직접 누른 위치 보내기는 짧게 기다린다(측위 12초×2 + 업로드 여유). 그 뒤에도 배경 전송은 계속된다. */
const CHILD_LOCATION_CONFIRM_TIMEOUT_MS = 45_000;
import { useLocale } from "@/i18n/useLocale";
import { Loading } from "@/components/ui/Loading";
import { ChildLocationPermissionDialog } from "@/components/ChildLocationPermissionDialog";
import {
  isLocationTrackingSupported,
  requestImmediateLocation,
  startLocationTracking,
} from "@/lib/native/location";
import { readPermissionState, readSystemLocationEnabled, openSystemLocationSettings } from "@/lib/native/permissions";
import "./ChildLocationStatus.css";
import { upsertChildLocation } from "@/lib/api/endpoints/sos";

/**
 * K-03 위치 전송 상태(아이). 반말 톤.
 *
 * "내 위치가 지금 부모님께 보내지고 있는지"를 아이가 안심할 수 있게 보여준다.
 * - 전송중(안심) · 꺼짐(켜기 유도) · 권한필요(켜기 안내) 3상태.
 * - 실 신호: useChildLocations(본인 행) 신선도 + 브라우저 위치 권한 상태.
 * - 켜기: 네이티브(안드로이드)면 즉시 위치요청 + 백그라운드 서비스 시작, 웹이면 권한 프롬프트.
 */

type PermState = "granted" | "prompt" | "denied" | "unknown";
type Kind = "sending" | "off" | "permission" | "systemOff";

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
  // 권한과 별개인 OS 위치 스위치 — 꺼져 있으면 "권한"이 아니라 "폰 위치"를 켜 달라고 안내한다.
  const [systemLocationOff, setSystemLocationOff] = useState(false);
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

  const fresh = myLoc ? formatFreshness(myLoc.updated_at, now, locale, intl) : null;
  const isFreshEnough = fresh != null && fresh.status !== "stale";
  // 공용 "방금" 표시는 "방금 업데이트"라서 "{freshness} 업데이트" 문장에 넣으면 말이 겹친다.
  const freshnessPhrase = !fresh || fresh.status === "live"
    ? intl.formatMessage({ id: "child.location.justNow" })
    : fresh.label;

  const refreshPermission = useCallback(() => {
    if (nativeSupported) {
      readSystemLocationEnabled()
        .then((enabled) => setSystemLocationOff(enabled === false))
        .catch(() => setSystemLocationOff(false));
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

  // 설정 화면에서 위치를 켜고 돌아오면 바로 다시 판정한다.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshPermission();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refreshPermission]);

  // 상태 판정: 최신 위치 있으면 전송중, 아니면 권한 거부→권한필요 / 그 외→꺼짐.
  const kind: Kind = resolveChildLocationStatusKind({
    freshEnough: isFreshEnough,
    permission: perm === "prompt" ? "unknown" : perm,
    systemLocationOff,
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
    systemOff: {
      kind: "systemOff",
      tone: "caution",
      mascot: asset("mascot/thinking.webp"),
      title: intl.formatMessage({ id: "child.location.systemOff.title" }),
      desc: intl.formatMessage({ id: "child.location.systemOff.description" }),
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
        const before = myLoc;
        await requestImmediateLocation(ctx);
        await startLocationTracking(ctx);
        refreshPermission();
        // 요청만으로 "보냈어"라고 하지 않는다 — 실내에서는 측위가 실패할 수 있다(2026-09-26 실기기: GPS 12초×2
        // 실패인데 성공 토스트가 떴다). 서버에 새 위치가 도착한 것을 확인한 뒤에만 성공을 알린다.
        const outcome = userId
          ? await waitForNewChildLocation({
            before,
            targetUserId: userId,
            refetch: async () => {
              const result = await refetch();
              return { isError: result.isError, data: result.data };
            },
            timeoutMs: CHILD_LOCATION_CONFIRM_TIMEOUT_MS,
          })
          : "error";
        show(
          intl.formatMessage({ id: outcome === "updated" ? "child.location.toast.sent" : "child.location.toast.notFound" }),
          outcome === "updated" ? "📍" : "🧭",
        );
      } else if ("geolocation" in navigator) {
        // 웹: 권한을 받아 지금 위치를 한 번 서버에 저장한다(백그라운드 전송은 앱에서 동작).
        // 읽기만 하고 저장하지 않으면 "위치가 아직 안 보내지고 있어" 상태가 그대로 남았다.
        await new Promise<void>((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (position) => {
              void (async () => {
                const saved = familyId && userId
                  ? await upsertChildLocation(
                    userId,
                    familyId,
                    position.coords.latitude,
                    position.coords.longitude,
                    position.timestamp,
                  )
                  : false;
                show(
                  intl.formatMessage({ id: saved ? "child.location.toast.sent" : "child.location.toast.failed" }),
                  saved ? "📍" : "⚠️",
                );
                resolve();
              })();
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
    // 폰 위치 스위치가 꺼져 있으면 권한 안내 대신 OS 위치 설정을 바로 연다(돌아오면 다시 판정).
    if (view.kind === "systemOff") {
      await openSystemLocationSettings();
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
                    { freshness: freshnessPhrase },
                  )
                : myLoc
                  ? intl.formatMessage(
                      { id: "child.location.detail.lastChecked" },
                      { freshness: freshnessPhrase },
                    )
                  : intl.formatMessage({ id: "child.location.detail.neverSent" })}
            </div>
          </div>
        </div>

        {/* 켜기 / 새로고침 */}
        <button type="button" className="cls-cta hy-press hy-busy-quiet" onClick={() => void handlePrimaryAction()} disabled={busy} aria-busy={busy}>
          {/* 보내는 중이면 '지금 내 위치 보내기' — 새로고침 화살표 대신 보내기 아이콘(찾는 동안만 회전 표시). */}
          {!busy && view.kind === "sending"
            ? <Send size={18} strokeWidth={2.4} aria-hidden="true" />
            : <RefreshCw size={18} strokeWidth={2.4} className={busy ? "cls-spin" : undefined} aria-hidden="true" />}
          {intl.formatMessage({
            id: busy
              ? "child.location.checking"
              : view.kind === "sending"
                ? "child.location.refreshNow"
                : view.kind === "systemOff"
                  ? "child.location.systemOff.cta"
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

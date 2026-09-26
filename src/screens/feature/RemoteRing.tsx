import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useIntl, type IntlShape } from "react-intl";
import { AlertTriangle, BatteryWarning, Bell, Check, ChevronLeft, MapPin, PowerOff, RefreshCw, WifiOff } from "lucide-react";
import { asset } from "@/lib/assets";
import { childAvatarPath } from "@/lib/avatar";
import { useToast } from "@/app/toast";
import { useActiveChild } from "@/app/activeChild";
import { Loading } from "@/components/ui/Loading";
import { PremiumUpsell } from "@/components/PremiumUpsell";
import { useDialogFocusLifecycle } from "@/components/useDialogFocusLifecycle";
import { useMyFamily } from "@/queries/useFamily";
import { useChildLocations } from "@/queries/useLocation";
import { useFamilyTimeZone } from "@/region/FamilyTimeZone";
import { childDeviceSilence, childDeviceSilenceTimeLabel } from "@/transform/childDeviceSilence";
import {
  useForceRingActive,
  useForceRingHistory,
  useForceRingQuota,
  useTriggerForceRing,
  useStopForceRing,
} from "@/queries/useRemote";
import { resolveQueryTruthState } from "@/transform/queryTruthState";
import {
  browserPremiumReturnIntentStorage,
  loadPremiumReturnIntent,
  savePremiumReturnIntent,
} from "@/transform/premiumReturnIntent";
import { TIERS } from "@/transform/tierPolicy";
import { useLocale } from "@/i18n/useLocale";
import { formatPastTime } from "@/i18n/format";
import "@/components/ChildSwitcher.css";
import "./RemoteRing.css";

/** 선택 가능한 벨소리 지속(초). 아이 기기 알람을 이 시간 뒤 자동 정지한다. */
const DURATIONS = [15, 30, 60] as const;
type RingDuration = (typeof DURATIONS)[number];

interface RemoteRingDraft {
  childUserId: string;
  durationSec: RingDuration;
}

function parseRemoteRingDraft(value: unknown): RemoteRingDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const childUserId = typeof row.childUserId === "string" ? row.childUserId.trim() : "";
  const durationSec = Number(row.durationSec);
  if (!childUserId || childUserId.length > 200) return null;
  if (!DURATIONS.includes(durationSec as RingDuration)) return null;
  return { childUserId, durationSec: durationSec as RingDuration };
}

function restoredRemoteRingDraft(routeDraft: unknown): RemoteRingDraft | null {
  const fromRoute = parseRemoteRingDraft(routeDraft);
  if (fromRoute) return fromRoute;
  const storage = browserPremiumReturnIntentStorage();
  const intent = storage ? loadPremiumReturnIntent(storage) : null;
  if (!intent || intent.source !== "remote_ring" || intent.returnTo !== "/remote-ring") return null;
  return parseRemoteRingDraft(intent.draft);
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

function avatarSrc(path: string): string {
  return path.startsWith("http") || path.startsWith("blob:") ? path : asset(path);
}

/** 등록한 프로필 사진인지 — 프레임을 꽉 채워 표시하기 위한 판정. */
function isUploadedAvatar(src: string | null | undefined): boolean {
  const value = src?.trim() ?? "";
  return value.startsWith("http") || value.startsWith("blob:");
}

const durationLabel = (sec: number, intl: IntlShape): string => sec >= 60
  ? intl.formatMessage({ id: "notifications.remoteRing.durationMinutes" }, { count: sec / 60 })
  : intl.formatMessage({ id: "notifications.remoteRing.durationSeconds" }, { count: sec });

/**
 * 소리 울리기(P-19) — 부모가 아이 기기에서 최대 볼륨 알람을 울린다.
 * 지속시간 선택 → 확인 모달 → 발사(POST push-notify force_ring) → 상태 폴링(GET active)
 * → 선택 시간 경과 시 자동 정지 or 수동 중지(force_ring_stop). 남은 횟수(quota)·최근 이력 표시.
 */
export function RemoteRing() {
  const intl = useIntl();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const { show } = useToast();
  const familyQuery = useMyFamily();
  const activeQuery = useForceRingActive({ pollMs: 3000 });
  const historyQuery = useForceRingHistory(5);
  const quotaQuery = useForceRingQuota();
  const family = familyQuery.data;
  const active = activeQuery.data;
  const history = historyQuery.data;
  const quota = quotaQuery.data;
  const trigger = useTriggerForceRing();
  const stop = useStopForceRing();
  const ringQueryState = resolveQueryTruthState([
    { isLoading: familyQuery.isLoading, isError: familyQuery.isError },
    { isLoading: activeQuery.isLoading, isError: activeQuery.isError },
    { isLoading: historyQuery.isLoading, isError: historyQuery.isError },
    { isLoading: quotaQuery.isLoading, isError: quotaQuery.isError },
  ]);
  const ringDataMissing = ringQueryState === "ready" && (!family || !quota);
  const ringDataReady = ringQueryState === "ready" && !ringDataMissing;
  const ringRefetching =
    familyQuery.isFetching || activeQuery.isFetching || historyQuery.isFetching || quotaQuery.isFetching;
  const retryRemoteRing = async (): Promise<void> => {
    await Promise.all([
      familyQuery.refetch(),
      activeQuery.refetch(),
      historyQuery.refetch(),
      quotaQuery.refetch(),
    ]);
  };

  // 대상 아이 목록(연결된 자녀). child_order 순.
  const children = useMemo(
    () =>
      (family?.members ?? [])
        .filter(
          (m) => m.role === "child" && typeof m.user_id === "string" && m.user_id.trim().length > 0,
        )
        .sort((a, b) => (a.child_order ?? 99) - (b.child_order ?? 99)),
    [family],
  );

  // 초기 대상 = 진입 시 지정(state.childUserId) > 전역 활성 아이 > 첫 아이.
  // 명시 선택 칩은 발사 대상 지정이 본질이라 유지 — 기본값만 활성 아이로(형제 오발사 방지).
  const { activeChild } = useActiveChild();
  const routeState = (useLocation().state ?? null) as {
    childUserId?: string;
    premiumReturnDraft?: unknown;
  } | null;
  const [initialDraft] = useState(() => restoredRemoteRingDraft(routeState?.premiumReturnDraft));
  const routeChildUserId = routeState?.childUserId ?? initialDraft?.childUserId;
  const [targetId, setTargetId] = useState<string | null>(null);
  const targetChild = useMemo(
    () =>
      children.find((c) => c.user_id === targetId) ??
      (routeChildUserId
        ? children.find((c) => c.user_id === routeChildUserId)
        : undefined) ??
      children.find((c) => c.id === activeChild?.id) ??
      children[0] ??
      null,
    [children, targetId, routeChildUserId, activeChild],
  );

  const [durationSec, setDurationSec] = useState<number>(initialDraft?.durationSec ?? 30);
  const [showConfirm, setShowConfirm] = useState(false);
  const [upsellOpen, setUpsellOpen] = useState(false);
  const confirmTitleId = useId();
  const confirmDescriptionId = useId();
  const confirmCancelRef = useRef<HTMLButtonElement>(null);
  const confirmDialogRef = useDialogFocusLifecycle<HTMLDivElement>({
    open: showConfirm,
    onClose: () => setShowConfirm(false),
    initialFocusRef: confirmCancelRef,
    canClose: () => !trigger.isPending,
  });

  // 진행 중(정지 전) 여부 = 서버 active 행 존재 + stopped_at 없음 + 10분 이내(zombie 방어).
  // 서버도 zombie 를 거르지만, 캐시/구버전 응답이 남아도 12일치 "울린 시간"이 뜨지 않게 이중 방어.
  const ringing = (() => {
    if (!active || active.stopped_at) return false;
    const t = active.triggered_at ? Date.parse(active.triggered_at) : NaN;
    return Number.isFinite(t) && Date.now() - t < 10 * 60 * 1000;
  })();
  // 이번 화면에서 발사했을 때만 자동 정지 시각(epoch ms)을 건다. 외부 발사는 수동 중지만.
  const autoStopAtRef = useRef<number | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  // 울리는 동안 0.5초 틱(카운트다운/자동정지 판정용). 멈추면 자동정지 예약 해제.
  useEffect(() => {
    if (!ringing) {
      autoStopAtRef.current = null;
      return;
    }
    const id = window.setInterval(() => setNowMs(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [ringing]);

  // 선택 시간 경과 → 자동 정지(1회). 수동 중지와 동일 엔드포인트.
  useEffect(() => {
    if (!ringing || !active) return;
    const stopAt = autoStopAtRef.current;
    if (stopAt && nowMs >= stopAt) {
      autoStopAtRef.current = null;
      stop.mutate(active.id);
    }
  }, [ringing, active, nowMs, stop]);

  const quotaAllowed = quota?.allowed === true;
  // 횟수를 다 쓴 뒤에도 "지금 울리기"로 보이면 누르는 결과(프리미엄 안내·안내 토스트)와 라벨이 어긋난다.
  const ctaState: "ringing" | "upsell" | "exhausted" | "ready" = ringing || trigger.isPending
    ? "ringing"
    : ringDataReady && quota && !quotaAllowed
      ? (quota.tier === "premium" ? "exhausted" : "upsell")
      : "ready";
  const tierLabel = intl.formatMessage({ id: "notifications.remoteRing.tier" }, { tier: quota?.tier ?? "free" });
  const childName = targetChild?.name || intl.formatMessage({ id: "notifications.remoteRing.childFallback" });
  const childAvatar = avatarSrc(childAvatarPath(targetChild?.photo_url));

  // 아이 폰이 꺼졌거나(배터리 방전 포함) 연결이 끊긴 상태면 벨이 울리지 않는다 — 누르기 전에 알려 준다
  // (2026-09-26 TK 제보: 배터리가 닳아서 꺼진 경우 기기 찾기에서 알 수 없었다).
  const familyTimeZone = useFamilyTimeZone();
  const locationsQuery = useChildLocations();
  const targetLocation = targetChild?.user_id
    ? locationsQuery.data?.find((l) => l.user_id === targetChild.user_id) ?? null
    : null;
  const silenceNow = new Date();
  const silence = targetChild
    ? childDeviceSilence({ locationUpdatedAt: targetLocation?.updated_at ?? null, health: targetChild.device_health ?? null, now: silenceNow })
    : null;
  const SilenceIcon = silence?.cause === "batteryDead" || silence?.cause === "lowBattery"
    ? BatteryWarning
    : silence?.cause === "poweredOff" ? PowerOff : WifiOff;

  // 울리는 대상 이름(외부 발사 대비 active.target_user_id 우선).
  const activeTarget = active?.target_user_id ?? null;
  const ringingChild = activeTarget
    ? children.find((c) => c.user_id === activeTarget) ?? targetChild
    : targetChild;
  const ringingName = ringingChild?.name || intl.formatMessage({ id: "notifications.remoteRing.childFallback" });

  // 울리는 중 상태 라벨.
  const statusLabel = intl.formatMessage(
    { id: "notifications.remoteRing.deliveryStatus" },
    { state: active?.delivered_at ? "delivered" : "sending" },
  );

  // 타이머: 자동정지 예약 있으면 남은 시간, 없으면 경과 시간.
  const seconds = (() => {
    const stopAt = autoStopAtRef.current;
    if (stopAt) return Math.max(0, Math.ceil((stopAt - nowMs) / 1000));
    const t = active && active.triggered_at ? Date.parse(active.triggered_at) : NaN;
    return Number.isFinite(t) ? Math.floor((nowMs - t) / 1000) : 0;
  })();
  const timerText = `${pad2(Math.floor(seconds / 60))}:${pad2(seconds % 60)}`;
  const timerCaption = intl.formatMessage(
    { id: "notifications.remoteRing.timerCaption" },
    { state: autoStopAtRef.current ? "remaining" : "elapsed" },
  );

  const recent = history?.[0] ?? null;
  const recentOutcome = recent ? intl.formatMessage(
    { id: "notifications.remoteRing.recentOutcome" },
    { state: recent.acknowledged_at ? "acknowledged" : recent.stop_reason === "parent_stop" ? "parentStop" : recent.stop_reason === "delivery_failed" ? "failed" : recent.stopped_at ? "stopped" : "active" },
  ) : "";

  const onRingClick = () => {
    if (!ringDataReady) {
      show(intl.formatMessage({ id: "notifications.remoteRing.toast" }, { state: "reload" }), "⚠️");
      return;
    }
    if (!targetChild?.user_id) {
      show(intl.formatMessage({ id: "notifications.remoteRing.toast" }, { state: "checkChild" }), "🔔");
      return;
    }
    if (!quotaAllowed) {
      if (quota?.tier === "premium") {
        // 한국어 rolling quota 계약: 최근 24시간 소리 울리기 10회를 모두 사용했어요
        show(intl.formatMessage({ id: "notifications.remoteRing.toast" }, { state: "premiumQuota" }), "🔕");
      } else {
        setUpsellOpen(true);
      }
      return;
    }
    setShowConfirm(true);
  };

  const confirmRing = async () => {
    if (!ringDataReady || !quotaAllowed || !targetChild?.user_id) {
      setShowConfirm(false);
      return;
    }
    try {
      const res = await trigger.mutateAsync({ targetChildUserId: targetChild.user_id, message: "" });
      if (res.error) {
        if (res.error === "force_ring_quota_exceeded") show(intl.formatMessage({ id: "notifications.remoteRing.toast" }, { state: "quota" }), "🔕");
        else if (res.error === "force_ring_already_active") show(intl.formatMessage({ id: "notifications.remoteRing.toast" }, { state: "alreadyActive" }), "🔔");
        // 공동 보호자는 서버 정책상 원격 제어를 보낼 수 없다 — 일반 실패가 아니라 이유를 알려 준다.
        else if (res.error === "primary_parent_required") show(intl.formatMessage({ id: "core.error.api.primaryParentRequired.formal" }), "🔒");
        else show(intl.formatMessage({ id: "notifications.remoteRing.toast" }, { state: "startFailed" }), "⚠️");
        return;
      }
      // 발사는 됐으나 아이 기기에 닿지 못한 경우(오프라인/토큰없음) — 정직 안내.
      if (res.delivered === false) {
        show(intl.formatMessage({ id: "notifications.remoteRing.toast" }, { state: "notDelivered" }), "⚠️");
        return;
      }
      autoStopAtRef.current = Date.now() + durationSec * 1000;
      setNowMs(Date.now());
      show(intl.formatMessage({ id: "notifications.remoteRing.started" }, { child: childName }), "🔔");
    } finally {
      setShowConfirm(false);
    }
  };

  const onStop = () => {
    if (!active) return;
    autoStopAtRef.current = null;
    stop.mutate(active.id, {
      onSuccess: () => show(intl.formatMessage({ id: "notifications.remoteRing.toast" }, { state: "stopped" }), "🔕"),
      // 아이 기기 최대 볼륨 알람을 멈추는 액션 — 실패가 조용하면 벨이 계속 울린다.
      onError: () => show(intl.formatMessage({ id: "notifications.remoteRing.toast" }, { state: "stopFailed" }), "⚠️"),
    });
  };

  return (
    <div className="rr-root">
      <div className="rr-idle">
        <button
          type="button"
          className="rr-back hy-press"
          aria-label={intl.formatMessage({ id: "core.action.back" })}
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} strokeWidth={2.2} color="#4A4145" />
        </button>

        {ringQueryState === "loading" ? (
          <section className="rr-query-state" aria-busy="true">
            <Loading label={intl.formatMessage({ id: "notifications.remoteRing.loading" })} />
          </section>
        ) : ringQueryState === "error" || ringDataMissing ? (
          <section className="rr-query-state rr-query-state--error" role="alert" aria-live="assertive">
            <AlertTriangle size={24} strokeWidth={2.4} aria-hidden="true" />
            <b>{intl.formatMessage({ id: "notifications.remoteRing.loadFailed" })}</b>
            <p>{intl.formatMessage({ id: "notifications.remoteRing.loadFailedDetail" })}</p>
            <button
              type="button"
              className="rr-query-retry hy-press"
              onClick={() => void retryRemoteRing()}
              disabled={ringRefetching}
            >
              <RefreshCw
                size={18}
                strokeWidth={2.2}
                className={ringRefetching ? "rr-spin" : undefined}
                aria-hidden="true"
              />
              {ringRefetching ? intl.formatMessage({ id: "notifications.remoteRing.rechecking" }) : intl.formatMessage({ id: "core.action.reload" })}
            </button>
          </section>
        ) : children.length === 0 ? (
          <section className="rr-query-state rr-query-state--empty">
            <Bell size={24} strokeWidth={2.4} aria-hidden="true" />
            <b>{intl.formatMessage({ id: "notifications.remoteRing.emptyTitle" })}</b>
            <p>{intl.formatMessage({ id: "notifications.remoteRing.emptyDetail" })}</p>
            <button
              type="button"
              className="rr-query-retry hy-press"
              onClick={() => navigate("/child-invite?role=child")}
            >
              {intl.formatMessage({ id: "notifications.remoteRing.connectChild" })}
            </button>
          </section>
        ) : (
          <>
          <div className="rr-idle-center">
          <div className="rr-hero">
            <span className="rr-hero-ring1" />
            <span className="rr-hero-ring2" />
            <img
              className="rr-hero-img hy-network-avatar"
              data-photo={isUploadedAvatar(childAvatar) ? "true" : "false"}
              src={childAvatar}
              alt=""
              loading="eager"
              decoding="async"
              fetchPriority="high"
            />
          </div>

          <div className="rr-title">{intl.formatMessage({ id: "notifications.remoteRing.title" }, { child: childName })}</div>
          {silence && !ringing ? (
            <div className="rr-offline" role="status">
              <span className="rr-offline__icon" aria-hidden="true"><SilenceIcon size={20} strokeWidth={2.2} /></span>
              <span className="rr-offline__main">
                <b>
                  {intl.formatMessage(
                    { id: "parent.deviceSilence.status" },
                    {
                      cause: silence.cause,
                      time: childDeviceSilenceTimeLabel(silence.since, silenceNow, locale, familyTimeZone),
                      battery: silence.batteryLevel ?? 0,
                    },
                  )}
                </b>
                <small>{intl.formatMessage({ id: "parent.deviceSilence.ringNotice" })}</small>
              </span>
              <button
                type="button"
                className="rr-offline__cta hy-press"
                onClick={() => navigate(targetChild?.user_id ? `/parent/location?child=${encodeURIComponent(targetChild.user_id)}` : "/parent/location")}
              >
                <MapPin size={16} strokeWidth={2.4} aria-hidden="true" />
                {intl.formatMessage({ id: "parent.deviceSilence.lastLocation" })}
              </button>
            </div>
          ) : (
            <div className="rr-sub">
              {intl.formatMessage({ id: "notifications.remoteRing.maxVolume" })}
              <br />
              {intl.formatMessage({ id: "notifications.remoteRing.useToFind" })}
            </div>
          )}

          {/* 울릴 아이는 이 화면에서 명시적으로 고른다(형제 오발사 방지). 모양은 앱 공용 다자녀 전환 알약과 같다. */}
          {children.length > 1 && (
            <div className="hy-kidswitch rr-children" role="radiogroup" aria-label={intl.formatMessage({ id: "shared.childSwitcher.label" })}>
              {children.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  className="hy-kidswitch__item hy-press"
                  data-selected={targetChild?.id === c.id ? "true" : "false"}
                  aria-checked={targetChild?.id === c.id}
                  onClick={() => setTargetId(c.user_id ?? null)}
                >
                  <span className="hy-kidswitch__avatar" data-photo={childAvatarPath(c.photo_url) === "mascot/wave.webp" ? "false" : "true"}>
                    <img src={avatarSrc(childAvatarPath(c.photo_url))} alt="" loading="eager" decoding="async" />
                  </span>
                  <span className="hy-kidswitch__name">{c.name || intl.formatMessage({ id: "notifications.location.childFallback" })}</span>
                </button>
              ))}
            </div>
          )}

          <div className="rr-chips">
            {DURATIONS.map((sec) => (
              <button
                key={sec}
                type="button"
                className={`rr-chip hy-press${durationSec === sec ? " rr-chip--active" : ""}`}
                aria-pressed={durationSec === sec}
                onClick={() => setDurationSec(sec)}
              >
                {durationLabel(sec, intl)}
                {durationSec === sec && <Check size={16} strokeWidth={2.4} aria-hidden="true" />}
              </button>
            ))}
          </div>

          {quota && (
            <div className={`rr-quota${quotaAllowed ? "" : " rr-quota--empty"}`}>
              <span className="rr-quota-tier">{tierLabel}</span>
              {quotaAllowed
                ? intl.formatMessage({ id: "notifications.remoteRing.quotaUsed" }, { used: quota.used, quota: quota.quota })
                : intl.formatMessage({ id: "notifications.remoteRing.quotaEmpty" })}
              {/* 한국어 quota 계약: `최근 24시간 ${quota.used}/${quota.quota}회 사용` / "최근 24시간 사용 횟수를 다 썼어요" */}
            </div>
          )}
        </div>

        <button
          type="button"
          className={`rr-cta hy-press${ctaState === "upsell" ? " rr-cta--upsell" : ""}`}
          disabled={!ringDataReady || !targetChild?.user_id || ringing || trigger.isPending || ctaState === "exhausted"}
          aria-busy={ringing || trigger.isPending}
          onClick={onRingClick}
        >
          <Bell size={20} strokeWidth={2.2} color="#fff" />
          {intl.formatMessage({ id: "notifications.remoteRing.action" }, { state: ctaState })}
        </button>

        {recent && (
          <div className="rr-recent">
            {intl.formatMessage({ id: "notifications.remoteRing.recent" })} · {recent.triggered_at
              ? formatPastTime(recent.triggered_at, new Date(), locale)
              : "—"}
            {recentOutcome ? ` · ${recentOutcome}` : ""}
          </div>
        )}
          </>
        )}
      </div>

      {/* 확인 모달 */}
      {ringDataReady && showConfirm && (
        <div className="rr-modal-backdrop" onClick={() => !trigger.isPending && setShowConfirm(false)}>
          <div
            ref={confirmDialogRef}
            className="rr-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={confirmTitleId}
            aria-describedby={confirmDescriptionId}
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="rr-modal-emoji" aria-hidden="true">
              <Bell size={24} strokeWidth={2.4} />
            </div>
            <div id={confirmTitleId} className="rr-modal-title">{intl.formatMessage({ id: "notifications.remoteRing.confirmTitle" }, { child: childName })}</div>
            <div id={confirmDescriptionId} className="rr-modal-sub">
              {intl.formatMessage({ id: "notifications.remoteRing.confirmDetail" }, { duration: durationLabel(durationSec, intl) })}
              <br />
              {intl.formatMessage({ id: "notifications.remoteRing.confirmAlert" })}
            </div>
            <div className="rr-modal-actions">
              <button
                ref={confirmCancelRef}
                type="button"
                className="rr-modal-cancel hy-press"
                onClick={() => setShowConfirm(false)}
                disabled={trigger.isPending}
                data-progress-owner="confirm-action"
              >
                {intl.formatMessage({ id: "notifications.remoteRing.cancel" })}
              </button>
              <button
                type="button"
                className="rr-modal-confirm hy-press"
                onClick={() => void confirmRing()}
                disabled={trigger.isPending}
                aria-busy={trigger.isPending}
              >
                {intl.formatMessage({ id: "notifications.remoteRing.ringNow" })}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 울리는 중 오버레이 */}
      {ringDataReady && ringing && (
        <div className="rr-ring">
          <div className="rr-ring-head">
            <div className="rr-ring-eyebrow">{intl.formatMessage({ id: "notifications.remoteRing.ringing" })}</div>
            <div className="rr-ring-title">{intl.formatMessage({ id: "notifications.remoteRing.ringingDevice" }, { child: ringingName })}</div>
          </div>

          <div className="rr-pulse">
            <span className="rr-pulse-ring1" />
            <span className="rr-pulse-ring2" />
            <div className="rr-pulse-core">
              <Bell size={52} strokeWidth={1.9} color="#fff" />
            </div>
          </div>

          <div className="rr-ring-status">{statusLabel}</div>

          <div className="rr-timer">
            <span className="rr-timer-cap">{timerCaption}</span>
            <span className="rr-timer-val">{timerText}</span>
          </div>

          <button type="button" className="rr-stop hy-press" onClick={onStop} disabled={stop.isPending} aria-busy={stop.isPending}>
            <span className="rr-stop-square" />
            {intl.formatMessage({ id: "notifications.remoteRing.stop" })}
          </button>
        </div>
      )}
      <PremiumUpsell
        open={upsellOpen}
        source="remote_ring"
        tier={quota?.tier === "premium" ? TIERS.PREMIUM : quota ? TIERS.FREE : TIERS.UNKNOWN}
        returnTo="/remote-ring"
        onClose={() => setUpsellOpen(false)}
        onUpgrade={({ source, feature, returnTo }) => {
          const storage = browserPremiumReturnIntentStorage();
          const saved = storage && returnTo
            ? savePremiumReturnIntent(storage, {
                source,
                feature,
                returnTo,
                draft: { childUserId: targetChild?.user_id ?? null, durationSec },
              })
            : false;
          if (!saved) throw new Error(intl.formatMessage({ id: "notifications.remoteRing.toast" }, { state: "saveFailed" }));
          navigate("/subscription");
        }}
      />
    </div>
  );
}

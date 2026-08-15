import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { AlertTriangle, Bell, Check, ChevronLeft, RefreshCw } from "lucide-react";
import { asset } from "@/lib/assets";
import { childAvatarPath } from "@/lib/avatar";
import { useToast } from "@/app/toast";
import { useActiveChild } from "@/app/activeChild";
import { Loading } from "@/components/ui/Loading";
import { PremiumUpsell } from "@/components/PremiumUpsell";
import { useDialogFocusLifecycle } from "@/components/useDialogFocusLifecycle";
import { useMyFamily } from "@/queries/useFamily";
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

const durationLabel = (sec: number): string => (sec >= 60 ? `${sec / 60}분` : `${sec}초`);

/**
 * 소리 울리기(P-19) — 부모가 아이 기기에서 최대 볼륨 알람을 울린다.
 * 지속시간 선택 → 확인 모달 → 발사(POST push-notify force_ring) → 상태 폴링(GET active)
 * → 선택 시간 경과 시 자동 정지 or 수동 중지(force_ring_stop). 남은 횟수(quota)·최근 이력 표시.
 */
export function RemoteRing() {
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
  const tierLabel = quota?.tier === "premium" ? "프리미엄" : "무료";
  const childName = targetChild?.name || "우리 아이";
  const childAvatar = avatarSrc(childAvatarPath(targetChild?.photo_url));

  // 울리는 대상 이름(외부 발사 대비 active.target_user_id 우선).
  const activeTarget = active?.target_user_id ?? null;
  const ringingChild = activeTarget
    ? children.find((c) => c.user_id === activeTarget) ?? targetChild
    : targetChild;
  const ringingName = ringingChild?.name || "우리 아이";

  // 울리는 중 상태 라벨.
  const statusLabel = active?.delivered_at
    ? "전달됨 · 아이 응답을 기다리는 중"
    : "아이 기기로 전달 중…";

  // 타이머: 자동정지 예약 있으면 남은 시간, 없으면 경과 시간.
  const seconds = (() => {
    const stopAt = autoStopAtRef.current;
    if (stopAt) return Math.max(0, Math.ceil((stopAt - nowMs) / 1000));
    const t = active && active.triggered_at ? Date.parse(active.triggered_at) : NaN;
    return Number.isFinite(t) ? Math.floor((nowMs - t) / 1000) : 0;
  })();
  const timerText = `${pad2(Math.floor(seconds / 60))}:${pad2(seconds % 60)}`;
  const timerCaption = autoStopAtRef.current ? "자동 종료까지" : "울린 시간";

  const recent = history?.[0] ?? null;
  const recentOutcome = recent
    ? recent.acknowledged_at
      ? "아이 확인"
      : recent.stop_reason === "parent_stop"
        ? "직접 정지"
        : recent.stop_reason === "delivery_failed"
          ? "전달 실패"
          : recent.stopped_at
            ? "종료"
            : "진행 중"
    : "";

  const onRingClick = () => {
    if (!ringDataReady) {
      show("소리 울리기 정보를 다시 확인해 주세요", "⚠️");
      return;
    }
    if (!targetChild?.user_id) {
      show("아이 앱 연결을 확인해 주세요", "🔔");
      return;
    }
    if (!quotaAllowed) {
      if (quota?.tier === "premium") {
        show("최근 24시간 소리 울리기 10회를 모두 사용했어요", "🔕");
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
        if (res.error === "force_ring_quota_exceeded") show("최근 24시간 소리 울리기 횟수를 다 썼어요", "🔕");
        else if (res.error === "force_ring_already_active") show("이미 벨이 울리고 있어요", "🔔");
        else show("소리를 울리지 못했어요", "⚠️");
        return;
      }
      // 발사는 됐으나 아이 기기에 닿지 못한 경우(오프라인/토큰없음) — 정직 안내.
      if (res.delivered === false) {
        show("아이 기기에 닿지 않았어요. 잠시 후 다시 시도해 주세요", "⚠️");
        return;
      }
      autoStopAtRef.current = Date.now() + durationSec * 1000;
      setNowMs(Date.now());
      show(`${childName} 기기에서 벨이 울려요`, "🔔");
    } finally {
      setShowConfirm(false);
    }
  };

  const onStop = () => {
    if (!active) return;
    autoStopAtRef.current = null;
    stop.mutate(active.id, {
      onSuccess: () => show("소리 울리기를 멈췄어요", "🔕"),
      // 아이 기기 최대 볼륨 알람을 멈추는 액션 — 실패가 조용하면 벨이 계속 울린다.
      onError: () => show("멈추지 못했어요. 다시 눌러 주세요", "⚠️"),
    });
  };

  return (
    <div className="rr-root">
      <div className="rr-idle">
        <button
          type="button"
          className="rr-back hy-press"
          aria-label="뒤로"
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} strokeWidth={2.2} color="#4A4145" />
        </button>

        {ringQueryState === "loading" ? (
          <section className="rr-query-state" aria-busy="true">
            <Loading label="소리 울리기 정보를 불러오는 중" />
          </section>
        ) : ringQueryState === "error" || ringDataMissing ? (
          <section className="rr-query-state rr-query-state--error" role="alert" aria-live="assertive">
            <AlertTriangle size={24} strokeWidth={2.4} aria-hidden="true" />
            <b>소리 울리기 정보를 불러오지 못했어요</b>
            <p>연결된 아이와 최근 24시간 사용 횟수를 다시 확인해 주세요.</p>
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
              {ringRefetching ? "다시 확인하고 있어요…" : "다시 불러오기"}
            </button>
          </section>
        ) : children.length === 0 ? (
          <section className="rr-query-state rr-query-state--empty">
            <Bell size={24} strokeWidth={2.4} aria-hidden="true" />
            <b>연결된 아이가 없어요</b>
            <p>아이를 연결한 뒤 기기에서 소리를 울릴 수 있어요.</p>
            <button
              type="button"
              className="rr-query-retry hy-press"
              onClick={() => navigate("/child-invite")}
            >
              아이 연결하기
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
              src={childAvatar}
              alt=""
              loading="eager"
              decoding="async"
              fetchPriority="high"
            />
          </div>

          <div className="rr-title">{childName} 기기에서 벨을 울릴까요?</div>
          <div className="rr-sub">
            무음이어도 최대 볼륨으로 울려요.
            <br />
            아이를 찾을 때 사용하세요.
          </div>

          {children.length > 1 && (
            <div className="rr-children">
              {children.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`rr-childchip hy-press${targetChild?.id === c.id ? " rr-childchip--active" : ""}`}
                  aria-pressed={targetChild?.id === c.id}
                  onClick={() => setTargetId(c.user_id ?? null)}
                >
                  {c.name || "아이"}
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
                {durationLabel(sec)}
                {durationSec === sec && <Check size={16} strokeWidth={2.4} aria-hidden="true" />}
              </button>
            ))}
          </div>

          {quota && (
            <div className={`rr-quota${quotaAllowed ? "" : " rr-quota--empty"}`}>
              <span className="rr-quota-tier">{tierLabel}</span>
              {quotaAllowed
                ? `최근 24시간 ${quota.used}/${quota.quota}회 사용`
                : "최근 24시간 사용 횟수를 다 썼어요"}
            </div>
          )}
        </div>

        <button
          type="button"
          className="rr-cta hy-press"
          disabled={!ringDataReady || !targetChild?.user_id || ringing || trigger.isPending}
          aria-busy={ringing || trigger.isPending}
          onClick={onRingClick}
        >
          <Bell size={20} strokeWidth={2.2} color="#fff" />
          {ringing || trigger.isPending ? "울리는 중…" : "지금 울리기"}
        </button>

        {recent && (
          <div className="rr-recent">
            최근 사용 · {recent.triggered_at
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
            <div id={confirmTitleId} className="rr-modal-title">{childName} 기기에서 울릴까요?</div>
            <div id={confirmDescriptionId} className="rr-modal-sub">
              {durationLabel(durationSec)} 동안 최대 볼륨으로 울리고,
              <br />
              아이에게 알림이 가요.
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
                취소
              </button>
              <button
                type="button"
                className="rr-modal-confirm hy-press"
                onClick={() => void confirmRing()}
                disabled={trigger.isPending}
                aria-busy={trigger.isPending}
              >
                지금 울리기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 울리는 중 오버레이 */}
      {ringDataReady && ringing && (
        <div className="rr-ring">
          <div className="rr-ring-head">
            <div className="rr-ring-eyebrow">벨소리 울리는 중</div>
            <div className="rr-ring-title">{ringingName} 기기</div>
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
            멈추기
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
          if (!saved) throw new Error("선택한 아이와 벨 시간을 안전하게 보관하지 못했어요. 잠시 후 다시 시도해 주세요.");
          navigate("/subscription");
        }}
      />
    </div>
  );
}

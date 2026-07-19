import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BellOff,
  BellRing,
  CalendarDays,
  ChevronLeft,
  MapPin,
  School,
  ShieldCheck,
  ToyBrick,
  type LucideIcon,
} from "lucide-react";
import { useToast } from "@/app/toast";
import { useAuth } from "@/auth/AuthContext";
import { useNotifSettings, useSaveNotifSettings } from "@/queries/useNotifications";
import {
  DEFAULT_NOTIF_SETTINGS,
  NOTIF_MINUTE_OPTIONS,
  type NotifSettings,
} from "@/lib/api/endpoints/notifications";
import {
  openFullScreenIntentSettings,
  readNotificationDeliveryState,
  requestOrOpenPermission,
  type NotificationDeliveryState,
} from "@/lib/native/permissions";
import { isNativePlatform } from "@/lib/native/plugins";
import {
  ensureWebPushSubscription,
  getWebPushState,
  unsubscribeWebPush,
  type WebPushSessionContext,
  type WebPushState,
} from "@/lib/webPush";
import { webPushDeliveryView } from "@/transform/notificationDeliveryView";
import { ScreenQueryState } from "@/components/ui/ScreenQueryState";
import { resolveQueryTruthState } from "@/transform/queryTruthState";
import "./NotificationSettings.css";

/**
 * 알림 설정(P-24): 유형별 토글·사전 알림 시간은 notif-settings 로 실 저장(user_id PK).
 * 이 기기의 실제 OS/브라우저 알림 권한을 함께 확인한다.
 * 부모 존댓말. 토글은 사용자 액션 시 즉시 낙관 반영 후 서버 upsert.
 */

/** 서버 boolean 토글 필드 키(minutesBefore 제외). */
type ToggleKey = "parentEnabled" | "locationEnabled" | "registeredPlaceEnabled" | "playdateEnabled";

interface ToggleDef {
  key: ToggleKey;
  Icon: LucideIcon;
  tone: "rose" | "blue" | "mint" | "gold";
  label: string;
  sub: string;
}

const SCHEDULE_TOGGLE: ToggleDef = {
  key: "parentEnabled",
  Icon: CalendarDays,
  tone: "rose",
  label: "일정 알림",
  sub: "일정 시작 전 미리 알려드려요",
};

const SAFETY_TOGGLES: ToggleDef[] = [
  {
    key: "locationEnabled",
    Icon: MapPin,
    tone: "blue",
    label: "일반 위치 알림",
    sub: "도착·이탈 같은 일반 위치 소식을 알려드려요",
  },
  {
    key: "registeredPlaceEnabled",
    Icon: School,
    tone: "mint",
    label: "등록 장소 알림",
    sub: "저장한 장소에 출입할 때 알려드려요",
  },
  {
    key: "playdateEnabled",
    Icon: ToyBrick,
    tone: "gold",
    label: "친구·놀이 알림",
    sub: "놀이 약속 소식이 오면 알려드려요",
  },
];

/** 토글 행(아이콘 + 라벨 + iOS 스위치). */
function ToggleRow({
  def,
  on,
  onToggle,
}: {
  def: ToggleDef;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button type="button" className="nst-row hy-press" aria-pressed={on} onClick={onToggle}>
      <span className="nst-row__icon" data-tone={def.tone}>
        <def.Icon size={19} strokeWidth={2.2} />
      </span>
      <span className="nst-row__main">
        <span className="nst-row__label">{def.label}</span>
        <span className="nst-row__sub">{def.sub}</span>
      </span>
      <span className="nst-switch" data-on={on}>
        <span className="nst-switch__knob" />
      </span>
    </button>
  );
}

export function NotificationSettings() {
  const navigate = useNavigate();
  const { show } = useToast();
  const { userId, familyId, role } = useAuth();
  const settingsQuery = useNotifSettings();
  const { data } = settingsQuery;
  const notificationQueryState = resolveQueryTruthState([
    { isLoading: settingsQuery.isLoading, isError: settingsQuery.isError },
  ]);
  const notificationDataMissing = notificationQueryState === "ready" && data === undefined;
  const notificationDataEmpty = notificationQueryState === "ready" && data === null;
  const notificationDataReady = notificationQueryState === "ready" && !notificationDataMissing;
  const retryNotificationSettings = async (): Promise<void> => {
    await settingsQuery.refetch();
  };
  const save = useSaveNotifSettings();
  const nativePlatform = isNativePlatform();
  const [delivery, setDelivery] = useState<NotificationDeliveryState | null>(null);
  const [webPushState, setWebPushState] = useState<WebPushState | null>(null);
  const [webPushLoadError, setWebPushLoadError] = useState(false);
  const [deliveryBusy, setDeliveryBusy] = useState(false);
  const webDelivery = webPushDeliveryView(webPushState);
  const webPushContext = useMemo<WebPushSessionContext | null>(
    () => userId && familyId && (role === "parent" || role === "child")
      ? { userId, familyId, role }
      : null,
    [userId, familyId, role],
  );

  const refreshDelivery = useCallback(async () => {
    if (nativePlatform) {
      setDelivery(await readNotificationDeliveryState());
      return;
    }
    try {
      setWebPushState(await getWebPushState(webPushContext));
      setWebPushLoadError(false);
    } catch (error) {
      console.error("[notification-settings] 웹 푸시 상태 확인 실패:", error);
      setWebPushLoadError(true);
    }
  }, [nativePlatform, webPushContext]);

  useEffect(() => {
    let disposed = false;
    let appListener: { remove(): Promise<void> } | null = null;
    const refresh = async () => {
      if (nativePlatform) {
        const state = await readNotificationDeliveryState();
        if (!disposed) setDelivery(state);
        return;
      }
      try {
        const state = await getWebPushState(webPushContext);
        if (!disposed) {
          setWebPushState(state);
          setWebPushLoadError(false);
        }
      } catch (error) {
        console.error("[notification-settings] 웹 푸시 상태 확인 실패:", error);
        if (!disposed) setWebPushLoadError(true);
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    void refresh();
    document.addEventListener("visibilitychange", onVisibility);
    if (nativePlatform) {
      void import("@capacitor/app")
        .then(async ({ App }) => {
          const listener = await App.addListener("appStateChange", (state) => {
            if (state.isActive) void refresh();
          });
          if (disposed) await listener.remove();
          else appListener = listener;
        })
        .catch((error: unknown) => {
          console.error("[notification-settings] 앱 복귀 상태 확인 등록 실패:", error);
        });
    }
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void appListener?.remove();
    };
  }, [nativePlatform, webPushContext]);

  // 서버 값(없으면 기본값)으로 초안 초기화. 데이터 첫 도착 시 1회 동기화.
  const [draft, setDraft] = useState<NotifSettings>(DEFAULT_NOTIF_SETTINGS);
  const [hydratedUserId, setHydratedUserId] = useState<string | null>(null);
  useEffect(() => {
    // 같은 화면 인스턴스에서 로그아웃·다른 부모 로그인으로 userId가 바뀌면
    // 이전 계정 초안을 즉시 버린다. 새 query가 성공하기 전에는 저장 UI가 열리지 않는다.
    setDraft(DEFAULT_NOTIF_SETTINGS);
    setHydratedUserId(null);
  }, [userId]);
  useEffect(() => {
    if (!userId || hydratedUserId === userId) return;
    // 성공 data 가 실제 도착했을 때만 1회 seed. undefined(로딩·에러)면 seed 하지 않아
    // 재시도 성공 시 서버 실값으로 동기화된다(에러 상태의 DEFAULT 잠금 방지).
    if (data === undefined) return;
    setDraft(data ?? DEFAULT_NOTIF_SETTINGS);
    setHydratedUserId(userId);
  }, [data, hydratedUserId, userId]);

  // 초안 즉시 반영 + 서버 upsert. 실패 시 정직하게 안내(초안은 유지 → 재시도 가능).
  const persist = (next: NotifSettings) => {
    if (!notificationDataReady || !userId || hydratedUserId !== userId) {
      show("현재 계정의 설정을 불러온 뒤 다시 시도해 주세요");
      return;
    }
    setDraft(next);
    save.mutate(next, {
      onError: () => show("설정 저장에 실패했어요. 잠시 후 다시 시도해 주세요"),
    });
  };

  const toggle = (key: ToggleKey) => {
    const next: NotifSettings = { ...draft, [key]: !draft[key] };
    persist(next);
  };

  const toggleMinute = (m: number) => {
    const has = draft.minutesBefore.includes(m);
    const nextList = has
      ? draft.minutesBefore.filter((x) => x !== m)
      : [...draft.minutesBefore, m];
    nextList.sort((a, b) => b - a);
    persist({ ...draft, minutesBefore: nextList });
  };

  const openDeliverySettings = async () => {
    if (deliveryBusy) return;
    if (nativePlatform && delivery?.supported === true && delivery.granted !== true) {
      navigate("/perm-denied", { state: { kind: "noti" } });
      return;
    }
    setDeliveryBusy(true);
    const next = await requestOrOpenPermission("noti");
    await refreshDelivery();
    setDeliveryBusy(false);
    if (next.granted) show("이 기기에서 알림을 표시할 수 있어요");
  };

  const openFullScreenSettings = async () => {
    if (deliveryBusy) return;
    setDeliveryBusy(true);
    try {
      const opened = await openFullScreenIntentSettings();
      if (!opened) show("잠금화면 전체 표시 설정을 열지 못했어요. 휴대폰 앱 설정에서 확인해 주세요");
    } finally {
      setDeliveryBusy(false);
    }
  };

  const changeWebPushSubscription = async (action: "register" | "unsubscribe") => {
    if (deliveryBusy || nativePlatform) return;
    setDeliveryBusy(true);
    try {
      if (action === "unsubscribe") {
        const removed = await unsubscribeWebPush();
        show(removed ? "이 브라우저의 웹 알림을 껐어요" : "웹 알림 구독을 해제하지 못했어요");
      } else if (webDelivery.canRegisterAccount) {
        if (!userId || !familyId || (role !== "parent" && role !== "child")) {
          show("로그인과 가족 연결을 확인한 뒤 다시 시도해 주세요");
          return;
        }
        const result = await ensureWebPushSubscription({ userId, familyId, role });
        if (result.ok) {
          show("이 브라우저에서 웹 알림을 받을 수 있어요");
        } else if (result.reason === "not_configured") {
          show("웹 푸시 서버 설정이 아직 완료되지 않았어요");
        } else if (result.reason === "permission_denied") {
          show("브라우저 사이트 설정에서 알림을 허용해 주세요");
        } else if (result.reason === "registration_unavailable") {
          show("웹 알림 서비스를 준비하지 못했어요. 잠시 후 다시 시도해 주세요");
        } else if (result.reason === "context_sync_failed") {
          show("웹 알림 연결 정보를 저장하지 못했어요. 잠시 후 다시 시도해 주세요");
        } else if (result.reason === "status_unavailable") {
          show("현재 계정 알림 등록을 확인하지 못했어요. 다시 확인해 주세요");
        } else if (result.reason === "endpoint_conflict") {
          show("이 브라우저의 이전 알림 연결을 정리하지 못했어요. 잠시 후 다시 시도해 주세요");
        } else if (result.reason === "unsubscribe_failed") {
          show("브라우저 알림 연결 해제에 실패했어요. 브라우저를 다시 연 뒤 재시도해 주세요");
        } else {
          show("이 브라우저에서는 웹 푸시를 사용할 수 없어요");
        }
      }
      await refreshDelivery();
    } catch (error) {
      console.error("[notification-settings] 웹 푸시 구독 변경 실패:", error);
      show("웹 알림 설정을 바꾸지 못했어요. 잠시 후 다시 시도해 주세요");
    } finally {
      setDeliveryBusy(false);
    }
  };

  const deliveryReady = nativePlatform ? delivery?.granted === true : webDelivery.ready;
  const deliveryTitle = nativePlatform
    ? delivery === null
      ? "알림 상태 확인 중"
      : delivery.granted
        ? "기기 알림 표시 가능"
        : "알림 설정 확인 필요"
    : webPushLoadError
      ? "웹 알림 상태를 확인하지 못했어요"
      : webDelivery.title;
  const deliveryDetail = nativePlatform
    ? delivery === null
      ? "OS 알림 권한과 채널을 확인하고 있어요"
      : !delivery.supported
        ? "이 환경에서는 시스템 알림 상태를 확인할 수 없어요"
        : delivery.granted
          ? "OS 알림 권한과 필수 채널이 켜져 있어요"
          : "OS 알림 권한 또는 필수 채널이 꺼져 있어요"
    : webPushLoadError
      ? "서버 설정과 이 브라우저의 구독 상태를 다시 확인해 주세요."
      : webDelivery.detail;

  if (notificationQueryState === "loading") {
    return (
      <ScreenQueryState
        screenTitle="알림 설정"
        state="loading"
        heading="알림 설정을 불러오고 있어요"
        description="현재 계정에 저장된 일정과 위치 알림 설정을 확인하는 중이에요."
        onBack={() => navigate(-1)}
      />
    );
  }

  if (notificationQueryState === "error" || notificationDataMissing) {
    return (
      <ScreenQueryState
        screenTitle="알림 설정"
        state="error"
        heading="알림 설정을 불러오지 못했어요"
        description="확인되지 않은 기본값이 기존 설정을 덮어쓰지 않도록 저장 기능을 닫았어요."
        onBack={() => navigate(-1)}
        onRetry={() => void retryNotificationSettings()}
        retrying={settingsQuery.isFetching}
      />
    );
  }

  return (
    <div className="nst-screen">
      <header className="nst-header">
        <button
          type="button"
          className="nst-back hy-press"
          aria-label="뒤로"
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} strokeWidth={2.2} color="var(--fg-secondary)" />
        </button>
        <span className="nst-title">알림 설정</span>
      </header>

      <div className="nst-body">
        {notificationDataEmpty && (
          <div className="sqs-inline-empty">
            아직 저장한 알림 설정이 없어 안전한 기본값으로 보여드려요. 변경하면 현재 계정에 저장돼요.
          </div>
        )}
        <>
            {/* 일정 알림 + 사전 알림 시간 */}
            <div className="nst-group">
              <div className="nst-group__label">일정</div>
              <div className="nst-list">
                <ToggleRow
                  def={SCHEDULE_TOGGLE}
                  on={draft.parentEnabled}
                  onToggle={() => toggle("parentEnabled")}
                />
                {draft.parentEnabled && (
                  <div className="nst-minutes">
                    <div className="nst-minutes__label">사전 알림 시간</div>
                    <div className="nst-minutes__row">
                      {NOTIF_MINUTE_OPTIONS.map((m) => {
                        const on = draft.minutesBefore.includes(m);
                        return (
                          <button
                            key={m}
                            type="button"
                            className={`nst-minute hy-press${on ? " nst-minute--on" : ""}`}
                            aria-pressed={on}
                            onClick={() => toggleMinute(m)}
                          >
                            {m === 60 ? "1시간 전" : `${m}분 전`}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 위치·안전 */}
            <div className="nst-group">
              <div className="nst-group__label">위치 · 안전</div>
              <div className="nst-list">
                {SAFETY_TOGGLES.map((d) => (
                  <ToggleRow key={d.key} def={d} on={draft[d.key]} onToggle={() => toggle(d.key)} />
                ))}
              </div>
              <div className="nst-safety-note hy-explain">
                <ShieldCheck size={17} strokeWidth={2.2} aria-hidden="true" />
                <span className="hy-explain__lines">
                  <span className="hy-explain__line">위험·SOS·미도착 알림은 항상 전달 대상으로 처리돼요.</span>
                  <span className="hy-explain__line">위 토글은 일반 위치 소식에만 적용돼요.</span>
                </span>
              </div>
            </div>

            {/* 이 기기의 실제 OS/브라우저 알림 상태 */}
            <div className="nst-group">
              <div className="nst-group__label">이 기기의 알림 수신</div>
              <div className="nst-list">
                <div className="nst-row">
                  <span className="nst-row__icon" data-tone={deliveryReady ? "mint" : "gold"}>
                    {deliveryReady
                      ? <BellRing size={19} strokeWidth={2.2} />
                      : <BellOff size={19} strokeWidth={2.2} />}
                  </span>
                  <span className="nst-row__main">
                    <span className="nst-row__label">
                      {deliveryTitle}
                    </span>
                    <span className="nst-row__sub">
                      {deliveryDetail}
                    </span>
                  </span>
                </div>
                {!nativePlatform && !webPushLoadError && (
                  <div className="nst-web-facts" aria-label="웹 알림 전달 상태">
                    <span><b>서버 설정</b>{webDelivery.configuredLabel}</span>
                    <span><b>브라우저 권한</b>{webDelivery.permissionLabel}</span>
                    <span><b>이 기기 구독</b>{webDelivery.subscriptionLabel}</span>
                    <span><b>현재 계정 등록</b>{webDelivery.accountRegistrationLabel}</span>
                  </div>
                )}
                {nativePlatform ? (
                  <>
                    <button
                      type="button"
                      className="nst-system-btn hy-press"
                      onClick={openDeliverySettings}
                      disabled={deliveryBusy}
                    >
                      {deliveryBusy ? "확인 중…" : "휴대폰 알림 설정 확인"}
                    </button>
                    <div
                      className="nst-capability"
                      data-state={delivery?.fullScreenIntentAllowed === true ? "ready" : "attention"}
                    >
                      <span className="nst-capability__title">잠금화면 전체 표시</span>
                      <span className="nst-capability__detail">
                        {delivery === null
                          ? "전체 화면 긴급 알림 상태를 확인하고 있어요"
                          : delivery.fullScreenIntentAllowed === true
                            ? "긴급 상황에서 잠금화면 전체 화면으로 표시할 수 있어요"
                            : delivery.fullScreenIntentAllowed === false
                              ? "전체 화면이 꺼져 있어 긴급 알림은 heads-up 팝업으로만 표시돼요"
                              : "이 기기에서는 전체 화면 긴급 알림 상태를 확인하지 못했어요"}
                      </span>
                    </div>
                    {delivery?.fullScreenIntentAllowed !== true && (
                      <button
                        type="button"
                        className="nst-system-btn nst-system-btn--secondary hy-press"
                        onClick={openFullScreenSettings}
                        disabled={deliveryBusy}
                      >
                        잠금화면 전체 표시 설정
                      </button>
                    )}
                    {role === "child" && (
                      <div
                        className="nst-capability"
                        data-state={delivery?.remoteListenChannelEnabled === true ? "ready" : "attention"}
                      >
                        <span className="nst-capability__title">주변 소리 요청 알림</span>
                        <span className="nst-capability__detail">
                          {delivery?.remoteListenChannelEnabled === true
                            ? "부모님의 요청을 알림으로 확인할 수 있어"
                            : "요청 알림 채널이 꺼져 있으면 주변 소리 요청을 놓칠 수 있어"}
                        </span>
                      </div>
                    )}
                  </>
                ) : !webPushLoadError ? (
                  <>
                    {webDelivery.canRegisterAccount && (
                      <button
                        type="button"
                        className="nst-system-btn hy-press"
                        onClick={() => void changeWebPushSubscription("register")}
                        disabled={deliveryBusy}
                      >
                        {deliveryBusy
                          ? "처리 중…"
                          : webDelivery.ready
                            ? "현재 계정 알림 등록 확인"
                            : "이 기기에서 웹 알림 켜기"}
                      </button>
                    )}
                    {webDelivery.canUnsubscribe && (
                      <button
                        type="button"
                        className="nst-system-btn nst-system-btn--secondary hy-press"
                        onClick={() => void changeWebPushSubscription("unsubscribe")}
                        disabled={deliveryBusy}
                      >
                        이 기기의 웹 알림 끄기
                      </button>
                    )}
                  </>
                ) : null}
              </div>
              <div className="nst-note hy-explain">
                알림 소리·진동과 방해금지는 휴대폰 또는 브라우저의 알림 설정에서 관리해 주세요.
                <button type="button" className="nst-refresh" onClick={() => void refreshDelivery()}>
                  상태 다시 확인
                </button>
              </div>
            </div>
        </>
      </div>
    </div>
  );
}

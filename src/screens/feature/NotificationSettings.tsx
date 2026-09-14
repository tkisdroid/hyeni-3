import { TimeZoneSelect } from "@/region/TimeZoneSelect";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  ChevronLeft,
  ShieldCheck,
} from "lucide-react";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { useAuth } from "@/auth/AuthContext";
import { useMyFamily } from "@/queries/useFamily";
import {
  useFamilyNotificationQuietHours,
  useNotifSettings,
  useSaveNotificationQuietHours,
  useSaveNotifSettings,
} from "@/queries/useNotifications";
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
  isIosHomeScreenInstallRequired,
  unsubscribeWebPush,
  type WebPushSessionContext,
  type WebPushState,
} from "@/lib/webPush";
import { webPushDeliveryView } from "@/transform/notificationDeliveryView";
import {
  DEFAULT_NOTIFICATION_QUIET_HOURS,
  isSameNotificationQuietHoursTargetDraft,
  isValidNotificationQuietHours,
  minuteOfDayToTimeInput,
  resolveNotificationQuietHoursSourceUpdate,
  timeInputToMinuteOfDay,
  type NotificationQuietHoursTargetDraft,
} from "@/transform/notificationQuietHours";
import { ScreenQueryState } from "@/components/ui/ScreenQueryState";
import { resolveQueryTruthState } from "@/transform/queryTruthState";
import { usePwaUpdateCriticalSection } from "@/lib/usePwaUpdateCriticalSection";
import { useLocale } from "@/i18n/useLocale";
import { formatDurationUnitShort, formatRelativeMinutes } from "@/i18n/format";
import { useIntl } from "react-intl";
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
  icon: string;
  tone: "rose" | "blue" | "mint" | "gold";
  labelId: string;
  subId: string;
}

const SCHEDULE_TOGGLE: ToggleDef = {
  key: "parentEnabled",
  icon: "ui/clay/calendar.webp",
  tone: "rose",
  labelId: "notifications.settings.toggle.schedule.label",
  subId: "notifications.settings.toggle.schedule.description",
};

const SAFETY_TOGGLES: ToggleDef[] = [
  {
    key: "locationEnabled",
    icon: "ui/clay/location.webp",
    tone: "blue",
    labelId: "notifications.settings.toggle.location.label",
    subId: "notifications.settings.toggle.location.description",
  },
  {
    key: "registeredPlaceEnabled",
    icon: "ui/clay/school.webp",
    tone: "mint",
    labelId: "notifications.settings.toggle.registeredPlace.label",
    subId: "notifications.settings.toggle.registeredPlace.description",
  },
  {
    key: "playdateEnabled",
    icon: "ui/clay/playdate.webp",
    tone: "gold",
    labelId: "notifications.settings.toggle.playdate.label",
    subId: "notifications.settings.toggle.playdate.description",
  },
];

function createQuietHoursDraft(targetUserId: string): NotificationQuietHoursTargetDraft {
  return {
    targetUserId,
    enabled: DEFAULT_NOTIFICATION_QUIET_HOURS.enabled,
    startMinute: DEFAULT_NOTIFICATION_QUIET_HOURS.startMinute,
    endMinute: DEFAULT_NOTIFICATION_QUIET_HOURS.endMinute,
  };
}

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
  const intl = useIntl();
  return (
    <button type="button" className="nst-row hy-press" aria-pressed={on} onClick={onToggle}>
      <span className="nst-row__icon" data-tone={def.tone}>
        <img src={asset(def.icon)} alt="" />
      </span>
      <span className="nst-row__main">
        <span className="nst-row__label">{intl.formatMessage({ id: def.labelId })}</span>
        <span className="nst-row__sub">{intl.formatMessage({ id: def.subId })}</span>
      </span>
      <span className="nst-switch" data-on={on}>
        <span className="nst-switch__knob" />
      </span>
    </button>
  );
}

export function NotificationSettings() {
  const intl = useIntl();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const { show } = useToast();
  const { userId, familyId, role } = useAuth();
  const settingsQuery = useNotifSettings();
  const familyQuery = useMyFamily();
  const quietHoursQuery = useFamilyNotificationQuietHours();
  const saveQuietHours = useSaveNotificationQuietHours();
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
  const [deliveryAction, setDeliveryAction] = useState<
    "permission" | "full-screen" | "web-register" | "web-unsubscribe" | null
  >(null);
  const deliveryBusy = deliveryAction !== null;
  const [quietDraft, setQuietDraftState] = useState<NotificationQuietHoursTargetDraft>(
    () => createQuietHoursDraft(userId ?? ""),
  );
  const quietDraftRef = useRef(quietDraft);
  const quietServerSourceRef = useRef<NotificationQuietHoursTargetDraft | null>(null);
  const setQuietDraft = useCallback((
    next: NotificationQuietHoursTargetDraft
      | ((current: NotificationQuietHoursTargetDraft) => NotificationQuietHoursTargetDraft),
  ) => {
    const resolved = typeof next === "function" ? next(quietDraftRef.current) : next;
    quietDraftRef.current = resolved;
    setQuietDraftState(resolved);
  }, []);
  const [quietSaveMessage, setQuietSaveMessage] = useState("");
  const iosHomeScreenInstallRequired = !nativePlatform && isIosHomeScreenInstallRequired();
  const webDelivery = webPushDeliveryView(webPushState, { iosHomeScreenInstallRequired });
  const webDeliveryCopy = useMemo(() => {
    const reason = !webPushState
      ? "checking"
      : iosHomeScreenInstallRequired
        ? "iosInstall"
        : !webPushState.supported
          ? "unsupported"
          : webPushState.configCheckFailed
            ? "serverCheckFailed"
            : webDelivery.reason === "not_configured"
              ? "notConfigured"
              : webDelivery.reason === "permission_denied"
                ? "permissionDenied"
                : webDelivery.reason === "account_not_registered"
                  ? "accountNotRegistered"
                  : webDelivery.reason === "ready"
                    ? "ready"
                    : webDelivery.reason === "check_failed"
                      ? "connectionCheckFailed"
                      : webDelivery.reason === "not_subscribed" && webPushState.permission === "granted"
                        ? "notSubscribedGranted"
                        : webDelivery.reason === "not_subscribed"
                          ? "notSubscribed"
                          : "checking";
    const configured = !webPushState
      ? "checking"
      : iosHomeScreenInstallRequired
        ? "notChecked"
        : webPushState.configured
          ? "configured"
          : "configurationNeeded";
    const permission = !webPushState
      ? "checking"
      : iosHomeScreenInstallRequired
        ? "homeScreenRequired"
        : webPushState.permission === "granted"
          ? "allowed"
          : webPushState.permission === "denied"
            ? "blocked"
            : webPushState.permission === "default"
              ? "notAllowedYet"
              : "unavailable";
    const subscription = !webPushState
      ? "checking"
      : iosHomeScreenInstallRequired
        ? "notRegistered"
        : webPushState.subscribed
          ? "subscribed"
          : "notSubscribed";
    const account = !webPushState
      ? "checking"
      : iosHomeScreenInstallRequired
        ? "notRegistered"
        : webPushState.accountRegistered === true
          ? "registered"
          : webPushState.accountRegistered === false
            ? "notRegistered"
            : "checkFailed";
    return {
      title: intl.formatMessage({ id: "notifications.settings.webDelivery.title" }, { reason }),
      detail: intl.formatMessage({ id: "notifications.settings.webDelivery.detail" }, { reason }),
      configuredLabel: intl.formatMessage(
        { id: "notifications.settings.webDelivery.configuredLabel" },
        { configured },
      ),
      permissionLabel: intl.formatMessage(
        { id: "notifications.settings.webDelivery.permissionLabel" },
        { permission },
      ),
      subscriptionLabel: intl.formatMessage(
        { id: "notifications.settings.webDelivery.subscriptionLabel" },
        { subscription },
      ),
      accountRegistrationLabel: intl.formatMessage(
        { id: "notifications.settings.webDelivery.accountLabel" },
        { account },
      ),
    };
  }, [intl, iosHomeScreenInstallRequired, webDelivery.reason, webPushState]);
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

  const quietHoursData = role === "parent" ? quietHoursQuery.data : undefined;
  const familyData = role === "parent" ? familyQuery.data : undefined;
  const connectedChildMembers = useMemo(
    () => role === "parent"
      ? (familyData?.members ?? []).filter(
        (member) => member.role === "child" && member.user_id !== null,
      )
      : [],
    [familyData, role],
  );
  const unlinkedChildMembers = useMemo(
    () => role === "parent"
      ? (familyData?.members ?? []).filter(
        (member) => member.role === "child" && member.user_id === null,
      )
      : [],
    [familyData, role],
  );
  const parentQuietRecipient = useMemo(
    () => userId
      ? quietHoursData?.recipients.find(
        (recipient) => recipient.role === "parent" && recipient.targetUserId === userId,
      ) ?? null
      : null,
    [quietHoursData, userId],
  );
  const childQuietTargets = useMemo(
    () => connectedChildMembers.flatMap((member) => {
      if (!member.user_id) return [];
      const recipient = quietHoursData?.recipients.find(
        (candidate) => candidate.role === "child" && candidate.targetUserId === member.user_id,
      );
      if (!recipient) return [];
      return [{
        targetUserId: recipient.targetUserId,
        label: member.name?.trim() || intl.formatMessage({ id: "notifications.location.childFallback" }),
        recipient,
      }];
    }),
    [connectedChildMembers, intl, quietHoursData],
  );
  const quietTargets = useMemo(
    () => parentQuietRecipient
      ? [{
          targetUserId: parentQuietRecipient.targetUserId,
          label: intl.formatMessage({ id: "notifications.settings.quiet.myAlerts" }),
          recipient: parentQuietRecipient,
        }]
        .concat(childQuietTargets)
      : [],
    [childQuietTargets, intl, parentQuietRecipient],
  );
  const quietGroupLoading = role === "parent"
    && !quietHoursQuery.isError
    && !familyQuery.isError
    && (quietHoursQuery.isLoading || familyQuery.isLoading);
  const quietRecipientsComplete = connectedChildMembers.length === childQuietTargets.length;
  const quietDataReady = role === "parent"
    && !!userId
    && !!quietHoursData
    && !!familyData
    && !!parentQuietRecipient
    && quietRecipientsComplete
    && !quietHoursQuery.isError
    && !familyQuery.isError;
  const quietGroupError = role === "parent"
    && !quietGroupLoading
    && (
      quietHoursQuery.isError
      || familyQuery.isError
      || !quietDataReady
    );
  const selectedQuietRecipient = quietTargets.find(
    (target) => target.targetUserId === quietDraft.targetUserId,
  )?.recipient ?? null;

  useEffect(() => {
    quietServerSourceRef.current = null;
    setQuietDraft(createQuietHoursDraft(userId ?? ""));
    setQuietSaveMessage("");
  }, [userId]);

  useEffect(() => {
    if (!quietDataReady || !selectedQuietRecipient) return;
    const nextSource = {
      timeZone: selectedQuietRecipient.quietHours.timeZone ?? familyQuery.data?.timeZone ?? "Asia/Seoul",
      targetUserId: selectedQuietRecipient.targetUserId,
      enabled: selectedQuietRecipient.quietHours.enabled,
      startMinute: selectedQuietRecipient.quietHours.startMinute,
      endMinute: selectedQuietRecipient.quietHours.endMinute,
    };
    const resolution = resolveNotificationQuietHoursSourceUpdate(
      quietDraftRef.current,
      quietServerSourceRef.current,
      nextSource,
    );
    quietServerSourceRef.current = resolution.source;
    if (resolution.hydrated) {
      setQuietDraft(resolution.draft);
      setQuietSaveMessage("");
    }
  }, [
    quietDataReady,
    selectedQuietRecipient?.targetUserId,
    selectedQuietRecipient?.quietHours.enabled,
    selectedQuietRecipient?.quietHours.startMinute,
    selectedQuietRecipient?.quietHours.endMinute,
    selectedQuietRecipient?.quietHours.updatedAt,
    selectedQuietRecipient?.quietHours.timeZone,
    familyQuery.data?.timeZone,
  ]);

  const dirty = selectedQuietRecipient !== null && (
    quietDraft.timeZone !== (selectedQuietRecipient.quietHours.timeZone ?? familyQuery.data?.timeZone ?? "Asia/Seoul")
    || quietDraft.enabled !== selectedQuietRecipient.quietHours.enabled
    || quietDraft.startMinute !== selectedQuietRecipient.quietHours.startMinute
    || quietDraft.endMinute !== selectedQuietRecipient.quietHours.endMinute
  );
  const valid = isValidNotificationQuietHours(quietDraft);
  const sameTimeError = quietDraft.startMinute >= 0
    && quietDraft.startMinute === quietDraft.endMinute;
  usePwaUpdateCriticalSection(
    dirty || saveQuietHours.isPending || save.isPending || deliveryBusy,
  );

  const selectQuietTarget = (targetUserId: string) => {
    const target = quietTargets.find((candidate) => candidate.targetUserId === targetUserId);
    if (!target) return;
    const nextSource = {
      timeZone: target.recipient.quietHours.timeZone ?? familyQuery.data?.timeZone ?? "Asia/Seoul",
      targetUserId: target.recipient.targetUserId,
      enabled: target.recipient.quietHours.enabled,
      startMinute: target.recipient.quietHours.startMinute,
      endMinute: target.recipient.quietHours.endMinute,
    };
    quietServerSourceRef.current = nextSource;
    setQuietDraft(nextSource);
    setQuietSaveMessage("");
  };

  const updateQuietTime = (key: "startMinute" | "endMinute", value: string) => {
    const minute = timeInputToMinuteOfDay(value);
    setQuietDraft((current) => ({ ...current, [key]: minute ?? -1 }));
    setQuietSaveMessage("");
  };

  const applyQuietHours = () => {
    if (
      !quietDataReady
      || !selectedQuietRecipient
      || !dirty
      || !valid
      || saveQuietHours.isPending
    ) return;
    const submittedQuietDraft = { ...quietDraft };
    setQuietSaveMessage("");
    saveQuietHours.mutate(
      {
        targetUserId: submittedQuietDraft.targetUserId,
        quietHours: {
          timeZone: submittedQuietDraft.timeZone,
          enabled: submittedQuietDraft.enabled,
          startMinute: submittedQuietDraft.startMinute,
          endMinute: submittedQuietDraft.endMinute,
        },
      },
      {
        onSuccess: (result) => {
          if (!isSameNotificationQuietHoursTargetDraft(quietDraftRef.current, submittedQuietDraft)) {
            return;
          }
          if (result.targetUserId !== submittedQuietDraft.targetUserId) {
            setQuietSaveMessage(intl.formatMessage({ id: "notifications.settings.quiet.targetMismatch" }));
            return;
          }
          setQuietDraft({
            targetUserId: result.targetUserId,
            enabled: result.quietHours.enabled,
            startMinute: result.quietHours.startMinute,
            endMinute: result.quietHours.endMinute,
            timeZone: result.quietHours.timeZone ?? submittedQuietDraft.timeZone,
          });
          setQuietSaveMessage(intl.formatMessage({ id: "notifications.settings.quiet.saved" }));
        },
        onError: () => {
          if (!isSameNotificationQuietHoursTargetDraft(quietDraftRef.current, submittedQuietDraft)) {
            return;
          }
          setQuietSaveMessage(intl.formatMessage({ id: "notifications.settings.quiet.saveFailed" }));
        },
      },
    );
  };

  const retryQuietHours = async (): Promise<void> => {
    setQuietSaveMessage("");
    await Promise.all([quietHoursQuery.refetch(), familyQuery.refetch()]);
  };

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
      show(intl.formatMessage({ id: "notifications.settings.toast.loadAccountFirst" }));
      return;
    }
    setDraft(next);
    save.mutate(next, {
      onError: () => show(intl.formatMessage({ id: "notifications.settings.toast.saveFailed" })),
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
    setDeliveryAction("permission");
    try {
      const next = await requestOrOpenPermission("noti");
      await refreshDelivery();
      if (next.granted) {
        show(intl.formatMessage({ id: "notifications.settings.toast.deviceReady" }));
      }
    } catch (error) {
      console.error("[notification-settings] 알림 권한 설정 확인 실패:", error);
      show(intl.formatMessage({ id: "notifications.settings.toast.permissionCheckFailed" }));
    } finally {
      setDeliveryAction(null);
    }
  };

  const openFullScreenSettings = async () => {
    if (deliveryBusy) return;
    setDeliveryAction("full-screen");
    try {
      const opened = await openFullScreenIntentSettings();
      if (!opened) {
        show(intl.formatMessage({ id: "notifications.settings.toast.fullScreenSettingsFailed" }));
      }
    } finally {
      setDeliveryAction(null);
    }
  };

  const changeWebPushSubscription = async (action: "register" | "unsubscribe") => {
    if (deliveryBusy || nativePlatform) return;
    setDeliveryAction(action === "register" ? "web-register" : "web-unsubscribe");
    try {
      if (action === "unsubscribe") {
        const removed = await unsubscribeWebPush();
        show(intl.formatMessage(
          { id: "notifications.settings.toast.webResult" },
          { result: removed ? "unsubscribed" : "unsubscribeFailed" },
        ));
      } else if (webDelivery.canRegisterAccount) {
        if (!userId || !familyId || (role !== "parent" && role !== "child")) {
          show(intl.formatMessage({ id: "notifications.settings.toast.checkSession" }));
          return;
        }
        const result = await ensureWebPushSubscription({ userId, familyId, role });
        if (result.ok) {
          show(intl.formatMessage(
            { id: "notifications.settings.toast.webResult" },
            { result: "ready" },
          ));
        } else {
          const resultKey = result.reason === "not_configured"
            ? "notConfigured"
            : result.reason === "permission_denied"
              ? "permissionDenied"
              : result.reason === "registration_unavailable"
                ? "registrationUnavailable"
                : result.reason === "context_sync_failed"
                  ? "contextSyncFailed"
                  : result.reason === "status_unavailable"
                    ? "statusUnavailable"
                    : result.reason === "endpoint_conflict"
                      ? "endpointConflict"
                      : result.reason === "unsubscribe_failed"
                        ? "detachFailed"
                        : "unsupported";
          show(intl.formatMessage(
            { id: "notifications.settings.toast.webResult" },
            { result: resultKey },
          ));
        }
      }
      await refreshDelivery();
    } catch (error) {
      console.error("[notification-settings] 웹 푸시 구독 변경 실패:", error);
      show(intl.formatMessage({ id: "notifications.settings.toast.webChangeFailed" }));
    } finally {
      setDeliveryAction(null);
    }
  };

  const deliveryReady = nativePlatform ? delivery?.granted === true : webDelivery.ready;
  const deliveryTitle = nativePlatform
    ? intl.formatMessage(
        { id: "notifications.settings.delivery.nativeTitle" },
        { state: delivery === null ? "checking" : delivery.granted ? "ready" : "attention" },
      )
    : webPushLoadError
      ? intl.formatMessage({ id: "notifications.settings.delivery.webError.title" })
      : webDeliveryCopy.title;
  const deliveryDetail = nativePlatform
    ? intl.formatMessage(
        { id: "notifications.settings.delivery.nativeDetail" },
        {
          state: delivery === null
            ? "checking"
            : !delivery.supported
              ? "unsupported"
              : delivery.granted
                ? "ready"
                : "attention",
        },
      )
    : webPushLoadError
      ? intl.formatMessage({ id: "notifications.settings.delivery.webError.detail" })
      : webDeliveryCopy.detail;

  if (notificationQueryState === "loading") {
    return (
      <ScreenQueryState
        screenTitle={intl.formatMessage({ id: "notifications.settings.title" })}
        state="loading"
        heading={intl.formatMessage({ id: "notifications.settings.loading.title" })}
        description={intl.formatMessage({ id: "notifications.settings.loading.description" })}
        onBack={() => navigate(-1)}
      />
    );
  }

  if (notificationQueryState === "error" || notificationDataMissing) {
    return (
      <ScreenQueryState
        screenTitle={intl.formatMessage({ id: "notifications.settings.title" })}
        state="error"
        heading={intl.formatMessage({ id: "notifications.settings.error.title" })}
        description={intl.formatMessage({ id: "notifications.settings.error.description" })}
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
          aria-label={intl.formatMessage({ id: "notifications.action.back" })}
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} strokeWidth={2.2} color="var(--fg-secondary)" />
        </button>
        <span className="nst-title">{intl.formatMessage({ id: "notifications.settings.title" })}</span>
      </header>

      <div className="nst-body">
        {notificationDataEmpty && (
          <div className="sqs-inline-empty">
            {intl.formatMessage({ id: "notifications.settings.empty" })}
          </div>
        )}
        <>
            {/* 일정 알림 + 사전 알림 시간 */}
            <div className="nst-group">
              <div className="nst-group__label">
                {intl.formatMessage({ id: "notifications.settings.group.schedule" })}
              </div>
              <div className="nst-list">
                <ToggleRow
                  def={SCHEDULE_TOGGLE}
                  on={draft.parentEnabled}
                  onToggle={() => toggle("parentEnabled")}
                />
                {draft.parentEnabled && (
                  <div className="nst-minutes">
                    <div className="nst-minutes__label">
                      {intl.formatMessage({ id: "notifications.settings.advanceTime" })}
                    </div>
                    {/* 5칸을 한 줄에 고정한다 — 칩에는 짧은 기간만 쓰고("30분") 보조기술에는
                        "30분 전"을 그대로 읽어 준다. 라벨이 이미 '사전 알림 시간'이라 뜻이 흐려지지 않는다. */}
                    <div className="nst-minutes__row">
                      {NOTIF_MINUTE_OPTIONS.map((m) => {
                        const on = draft.minutesBefore.includes(m);
                        const duration = m % 60 === 0
                          ? formatDurationUnitShort(m / 60, "hour", locale)
                          : formatDurationUnitShort(m, "minute", locale);
                        return (
                          <button
                            key={m}
                            type="button"
                            className={`nst-minute hy-press${on ? " nst-minute--on" : ""}`}
                            aria-pressed={on}
                            aria-label={formatRelativeMinutes(m, "past", locale)}
                            onClick={() => toggleMinute(m)}
                          >
                            {duration}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 위치·안전 — 위치 소식 토글은 부모 알림에만 적용된다.
                아이에게는 도착·출발을 보내지 않으므로(2026-08-03) 토글을 숨기고 사실만 알린다. */}
            {/* i18n 안전 문구·문장별 조판 정본:
                className="hy-explain__lines"
                className="hy-explain__line">위험·SOS·미도착 알림은 항상 전달 대상으로 처리돼요.</span>
                className="hy-explain__line">위 토글은 부모가 받는 일반 위치 소식에만 적용돼요.</span> */}
            <div className="nst-group">
              <div className="nst-group__label">
                {intl.formatMessage({ id: "notifications.settings.group.locationSafety" })}
              </div>
              {role === "child" ? (
                <div className="nst-safety-note hy-explain">
                  <ShieldCheck size={17} strokeWidth={2.2} aria-hidden="true" />
                  <span className="hy-explain__lines">
                    <span className="hy-explain__line">
                      {intl.formatMessage({ id: "notifications.settings.childSafety.always" })}
                    </span>
                    <span className="hy-explain__line">
                      {intl.formatMessage({ id: "notifications.settings.childSafety.parentOnly" })}
                    </span>
                  </span>
                </div>
              ) : (
                <>
                  <div className="nst-list">
                    {SAFETY_TOGGLES.map((d) => (
                      <ToggleRow key={d.key} def={d} on={draft[d.key]} onToggle={() => toggle(d.key)} />
                    ))}
                  </div>
                  <div className="nst-safety-note hy-explain">
                    <ShieldCheck size={17} strokeWidth={2.2} aria-hidden="true" />
                    <span className="hy-explain__lines">
                      <span className="hy-explain__line">
                        {intl.formatMessage({ id: "notifications.settings.parentSafety.always" })}
                      </span>
                      <span className="hy-explain__line">
                        {intl.formatMessage({ id: "notifications.settings.parentSafety.toggleScope" })}
                      </span>
                    </span>
                  </div>
                </>
              )}
            </div>

            {role === "parent" && (
              /* i18n quiet-hours 계약 정본:
                 >내 알림< / 아이 기기 연결이 필요해요
                 시작 시간 / 끝 시간 / >적용< / 시작 시간과 끝 시간을 다르게 선택해 주세요
                 조용한 시간에는 일정·메시지·일반 도착·출발 알림을 보내지 않아요.
                 SOS·긴급·위험구역 알림은 이 시간에도 항상 전달돼요.
                 알림 소리와 진동은 휴대폰 또는 브라우저 설정에서 관리해 주세요.
                 조용한 시간 설정을 불러오지 못했어요 / 다시 확인 */
              <div className="nst-group nst-quiet">
                <div className="nst-group__label">
                  {intl.formatMessage({ id: "notifications.settings.quiet.title" })}
                </div>
                {quietGroupLoading ? (
                  <div className="nst-list nst-quiet__state" aria-busy="true">
                    <strong>{intl.formatMessage({ id: "notifications.settings.quiet.loading.title" })}</strong>
                    <span>{intl.formatMessage({ id: "notifications.settings.quiet.loading.description" })}</span>
                  </div>
                ) : quietGroupError ? (
                  <div className="nst-list nst-quiet__state" role="alert">
                    <strong>{intl.formatMessage({ id: "notifications.settings.quiet.error.title" })}</strong>
                    <span>{intl.formatMessage({ id: "notifications.settings.quiet.error.description" })}</span>
                    <button
                      type="button"
                      className="nst-retry nst-quiet__retry hy-press"
                      onClick={() => void retryQuietHours()}
                      disabled={quietHoursQuery.isFetching || familyQuery.isFetching} aria-busy={quietHoursQuery.isFetching || familyQuery.isFetching}
                    >
                      {intl.formatMessage({
                        id: quietHoursQuery.isFetching || familyQuery.isFetching
                          ? "notifications.action.checkingAgain"
                          : "notifications.settings.quiet.retry",
                      })}
                    </button>
                  </div>
                ) : quietDataReady ? (
                  <div className="nst-list nst-quiet__card">
                    <div className="nst-quiet__copy hy-explain">
                      <p>{intl.formatMessage({ id: "notifications.settings.quiet.suppressed" })}</p>
                      <p>{intl.formatMessage({ id: "notifications.settings.quiet.safetyExceptions" })}</p>
                      <p>{intl.formatMessage({ id: "notifications.settings.deviceSoundNote" })}</p>
                    </div>

                    <div
                      className="nst-quiet__targets"
                      role="group"
                      aria-label={intl.formatMessage({ id: "notifications.settings.quiet.targetGroupAria" })}
                    >
                      {quietTargets[0] && (
                        <button
                          type="button"
                          className="nst-minute nst-quiet__target hy-press"
                          data-selected={quietDraft.targetUserId === quietTargets[0].targetUserId}
                          aria-pressed={quietDraft.targetUserId === quietTargets[0].targetUserId}
                          onClick={() => selectQuietTarget(quietTargets[0].targetUserId)}
                        >
                          <span>{quietTargets[0].label}</span>
                        </button>
                      )}
                      {quietTargets.slice(1).map((target) => {
                        const selected = quietDraft.targetUserId === target.targetUserId;
                        return (
                          <button
                            key={target.targetUserId}
                            type="button"
                            className="nst-minute nst-quiet__target hy-press"
                            data-selected={selected}
                            aria-pressed={selected}
                            onClick={() => selectQuietTarget(target.targetUserId)}
                          >
                            {target.label}
                          </button>
                        );
                      })}
                      {unlinkedChildMembers.map((member) => (
                        <button
                          key={member.id}
                          type="button"
                          className="nst-minute nst-quiet__target nst-quiet__target--unlinked"
                          disabled
                        >
                          <span>
                            {member.name?.trim()
                              || intl.formatMessage({ id: "notifications.location.childFallback" })}
                          </span>
                          <small>
                            {intl.formatMessage({ id: "notifications.settings.quiet.childLinkRequired" })}
                          </small>
                        </button>
                      ))}
                    </div>

                    <div className="nst-quiet__editor">
                      <TimeZoneSelect recipient value={quietDraft.timeZone ?? familyQuery.data?.timeZone ?? "Asia/Seoul"} onChange={timeZone => setQuietDraft(current => ({ ...current, timeZone }))} disabled={saveQuietHours.isPending} />
                      <button
                        type="button"
                        className="nst-quiet__switch-row hy-press"
                        role="switch"
                        aria-checked={quietDraft.enabled}
                        onClick={() => {
                          setQuietDraft((current) => ({ ...current, enabled: !current.enabled }));
                          setQuietSaveMessage("");
                        }}
                      >
                        <span>
                          <b>{intl.formatMessage({ id: "notifications.settings.quiet.daily" })}</b>
                          <small>{intl.formatMessage({ id: "notifications.settings.quiet.halfOpenRange" })}</small>
                        </span>
                        <span className="nst-switch" data-on={quietDraft.enabled} aria-hidden="true">
                          <span className="nst-switch__knob" />
                        </span>
                      </button>

                      <div className="nst-quiet__time-grid">
                        <label className="nst-quiet__time-field">
                          <span>{intl.formatMessage({ id: "notifications.settings.quiet.startTime" })}</span>
                          <input
                            className="nst-minute nst-quiet__time"
                            type="time"
                            value={minuteOfDayToTimeInput(quietDraft.startMinute)}
                            onChange={(event) => updateQuietTime("startMinute", event.target.value)}
                            aria-invalid={sameTimeError || undefined}
                          />
                        </label>
                        <label className="nst-quiet__time-field">
                          <span>{intl.formatMessage({ id: "notifications.settings.quiet.endTime" })}</span>
                          <input
                            className="nst-minute nst-quiet__time"
                            type="time"
                            value={minuteOfDayToTimeInput(quietDraft.endMinute)}
                            onChange={(event) => updateQuietTime("endMinute", event.target.value)}
                            aria-invalid={sameTimeError || undefined}
                          />
                        </label>
                      </div>

                      {sameTimeError && (
                        <p className="nst-quiet__validation" role="alert">
                          {intl.formatMessage({ id: "notifications.settings.quiet.sameTimeError" })}
                        </p>
                      )}

                      <button
                        type="button"
                        className="nst-system-btn nst-quiet__apply hy-press"
                        onClick={applyQuietHours}
                        disabled={!dirty || !valid || saveQuietHours.isPending} aria-busy={saveQuietHours.isPending}
                      >
                        {intl.formatMessage({
                          id: saveQuietHours.isPending
                            ? "notifications.settings.quiet.applying"
                            : "notifications.settings.quiet.apply",
                        })}
                      </button>
                      <p className="nst-quiet__live" aria-live="polite">
                        {quietSaveMessage}
                      </p>
                    </div>
                  </div>
                ) : null}
              </div>
            )}

            {/* 이 기기의 실제 OS/브라우저 알림 상태 */}
            <div className="nst-group">
              <div className="nst-group__label">
                {intl.formatMessage({ id: "notifications.settings.deviceDelivery.title" })}
              </div>
              <div className="nst-list">
                <div className="nst-row">
                  <span className="nst-row__icon" data-tone={deliveryReady ? "mint" : "gold"}>
                    <img src={asset("ui/clay/notification.webp")} alt="" />
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
                  <div
                    className="nst-web-facts"
                    aria-label={intl.formatMessage({ id: "notifications.settings.webFacts.aria" })}
                  >
                    <span>
                      <b>{intl.formatMessage({ id: "notifications.settings.webFacts.server" })}</b>
                      {webDeliveryCopy.configuredLabel}
                    </span>
                    <span>
                      <b>{intl.formatMessage({ id: "notifications.settings.webFacts.permission" })}</b>
                      {webDeliveryCopy.permissionLabel}
                    </span>
                    <span>
                      <b>{intl.formatMessage({ id: "notifications.settings.webFacts.subscription" })}</b>
                      {webDeliveryCopy.subscriptionLabel}
                    </span>
                    <span>
                      <b>{intl.formatMessage({ id: "notifications.settings.webFacts.account" })}</b>
                      {webDeliveryCopy.accountRegistrationLabel}
                    </span>
                  </div>
                )}
                {nativePlatform ? (
                  <>
                    <button
                      type="button"
                      className="nst-system-btn hy-press"
                      onClick={openDeliverySettings}
                      disabled={deliveryBusy}
                      aria-busy={deliveryAction === "permission"}
                    >
                      {intl.formatMessage({
                        id: deliveryAction === "permission"
                          ? "notifications.settings.deviceDelivery.checking"
                          : "notifications.settings.deviceDelivery.checkPhoneSettings",
                      })}
                    </button>
                    <div
                      className="nst-capability"
                      data-state={delivery?.fullScreenIntentAllowed === true ? "ready" : "attention"}
                    >
                      {/* i18n Android 전체 표시 정본: 잠금 화면 전체로 표시해요 / 꺼져 있어 상단 팝업으로만 표시돼요 / 잠금 화면 전체 표시 설정 */}
                      <span className="nst-capability__title">
                        {intl.formatMessage({ id: "notifications.settings.fullScreen.title" })}
                      </span>
                      <span className="nst-capability__detail">
                        {delivery === null
                          ? intl.formatMessage(
                              { id: "notifications.settings.fullScreen.detail" },
                              { state: "checking" },
                            )
                          : delivery.fullScreenIntentAllowed === true
                            ? intl.formatMessage(
                                { id: "notifications.settings.fullScreen.detail" },
                                { state: "ready" },
                              )
                            : delivery.fullScreenIntentAllowed === false
                              ? intl.formatMessage(
                                  { id: "notifications.settings.fullScreen.detail" },
                                  { state: "disabled" },
                                )
                              : intl.formatMessage(
                                  { id: "notifications.settings.fullScreen.detail" },
                                  { state: "unavailable" },
                                )}
                      </span>
                    </div>
                    {delivery?.fullScreenIntentAllowed !== true && (
                      <button
                        type="button"
                        className="nst-system-btn nst-system-btn--secondary hy-press"
                        onClick={openFullScreenSettings}
                        disabled={deliveryBusy}
                        aria-busy={deliveryAction === "full-screen"}
                      >
                        {intl.formatMessage(
                          { id: "notifications.settings.fullScreen.settingsAction" },
                          { state: deliveryAction === "full-screen" ? "opening" : "ready" },
                        )}
                      </button>
                    )}
                    {role === "child" && (
                      <div
                        className="nst-capability"
                        data-state={delivery?.remoteListenChannelEnabled === true ? "ready" : "attention"}
                      >
                        <span className="nst-capability__title">
                          {intl.formatMessage({ id: "notifications.settings.remoteListen.title" })}
                        </span>
                        <span className="nst-capability__detail">
                          {delivery?.remoteListenChannelEnabled === true
                            ? intl.formatMessage(
                                { id: "notifications.settings.remoteListen.detail" },
                                { state: "ready" },
                              )
                            : intl.formatMessage(
                                { id: "notifications.settings.remoteListen.detail" },
                                { state: "disabled" },
                              )}
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
                        aria-busy={deliveryAction === "web-register"}
                      >
                        {intl.formatMessage(
                          { id: "notifications.settings.webAction.register" },
                          {
                            state: deliveryAction === "web-register"
                              ? "processing"
                              : webDelivery.ready
                                ? "checkAccount"
                                : "enable",
                          },
                        )}
                      </button>
                    )}
                    {webDelivery.canUnsubscribe && (
                      <button
                        type="button"
                        className="nst-system-btn nst-system-btn--secondary hy-press"
                        onClick={() => void changeWebPushSubscription("unsubscribe")}
                        disabled={deliveryBusy}
                        aria-busy={deliveryAction === "web-unsubscribe"}
                      >
                        {intl.formatMessage(
                          { id: "notifications.settings.webAction.unregister" },
                          { state: deliveryAction === "web-unsubscribe" ? "disabling" : "disable" },
                        )}
                      </button>
                    )}
                  </>
                ) : null}
              </div>
              <div className="nst-note hy-explain">
                {intl.formatMessage({ id: "notifications.settings.deviceSoundNote" })}
                <button type="button" className="nst-refresh" onClick={() => void refreshDelivery()}>
                  {intl.formatMessage({ id: "notifications.settings.deviceDelivery.refresh" })}
                </button>
              </div>
            </div>
        </>
      </div>
    </div>
  );
}

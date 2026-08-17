import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  Bell,
  Cat,
  ChevronLeft,
  Clock3,
  HelpCircle,
  Link2,
  Mail,
  MapPin,
  MessageCircleQuestion,
  UserRound,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { asset } from "@/lib/assets";
import { useDialogFocusLifecycle } from "@/components/useDialogFocusLifecycle";
import { childAvatarPath } from "@/lib/avatar";
import { useToast } from "@/app/toast";
import { useAuth } from "@/auth/AuthContext";
import { useMyFamily, useSendChildSettingRequest } from "@/queries/useFamily";
import { useNotifSettings, useSaveNotifSettings } from "@/queries/useNotifications";
import { checkRequestCooldown, type SettingRequestMenu } from "@/lib/api/endpoints/family";
import { DEFAULT_NOTIF_SETTINGS } from "@/lib/api/endpoints/notifications";
import {
  readLocationTrackingStatus,
  type LocationTrackingStatus,
} from "@/lib/native/location";
import { isNativePlatform } from "@/lib/native/plugins";
import { ScreenQueryState } from "@/components/ui/ScreenQueryState";
import { LanguageSelector } from "@/components/LanguageSelector";
import { useLocale } from "@/i18n/useLocale";
import { notificationQuietHoursRange } from "@/transform/notificationQuietHours";
import { useIntl, type IntlShape } from "react-intl";
import { localizeApiError } from "@/i18n/apiError";
import { resolveQueryTruthState } from "@/transform/queryTruthState";
import "./ChildSettings.css";

// 만 나이(런타임 계산).
function ageFrom(bd: string | null | undefined, now: Date): number | null {
  if (!bd) return null;
  const d = new Date(`${bd}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

// 부모 연결 문구(반말) — 성별 기반.
function connectionLabel(
  parents: { gender?: string | null }[],
  intl: IntlShape,
): { Icon: LucideIcon; text: string; tone: "connected" | "pending" } {
  const hasMom = parents.some((p) => p.gender === "mom");
  const hasDad = parents.some((p) => p.gender === "dad");
  if (hasMom && hasDad) return { Icon: Users, text: intl.formatMessage({ id: "child.settings.connected.parents" }), tone: "connected" };
  if (hasMom) return { Icon: UserRound, text: intl.formatMessage({ id: "child.settings.connected.mom" }), tone: "connected" };
  if (hasDad) return { Icon: UserRound, text: intl.formatMessage({ id: "child.settings.connected.dad" }), tone: "connected" };
  if (parents.length) return { Icon: Users, text: intl.formatMessage({ id: "child.settings.connected.family" }), tone: "connected" };
  return { Icon: Link2, text: intl.formatMessage({ id: "child.settings.connectionPending" }), tone: "pending" };
}

function avatarSrc(path: string): string {
  return path.startsWith("http") || path.startsWith("blob:") ? path : asset(path);
}

// 부모에게 부탁할 수 있는 잠금 메뉴(요청형).
const REQUEST_ITEMS: Array<{ menu: SettingRequestMenu; Icon: LucideIcon; titleId: string; subId: string }> = [
  { menu: "sound", Icon: Bell, titleId: "child.settings.request.sound", subId: "child.settings.request.parentManaged" },
  { menu: "character", Icon: Cat, titleId: "child.settings.request.character", subId: "child.settings.request.canAsk" },
];

/**
 * 아이 설정 · 연결 상태 (와이어프레임 K-10). 반말.
 * 내 정보/연결 상태·부모 잠금 항목 표시 + 잠금 해제 요청(sendChildSettingRequest).
 */
export function ChildSettings() {
  const intl = useIntl();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const { show } = useToast();
  const now = useMemo(() => new Date(), []);
  const { userId } = useAuth();
  const familyQuery = useMyFamily();
  const family = familyQuery.data;
  const request = useSendChildSettingRequest();
  const notifSettingsQuery = useNotifSettings();
  const saveNotifSettings = useSaveNotifSettings();
  const childSettingsQueryState = resolveQueryTruthState([
    { isLoading: familyQuery.isLoading, isError: familyQuery.isError },
    { isLoading: notifSettingsQuery.isLoading, isError: notifSettingsQuery.isError },
  ]);
  const childSettingsDataMissing = childSettingsQueryState === "ready" && (
    !family || notifSettingsQuery.data === undefined
  );
  const childSettingsDataReady = childSettingsQueryState === "ready" && !childSettingsDataMissing;
  const childSettingsDataEmpty = childSettingsDataReady && notifSettingsQuery.data === null;
  const childSettingsRefetching = familyQuery.isFetching || notifSettingsQuery.isFetching;
  const retryChildSettings = async (): Promise<void> => {
    await Promise.all([familyQuery.refetch(), notifSettingsQuery.refetch()]);
  };

  const [requested, setRequested] = useState<Record<string, boolean>>({});
  const [pendingRequestMenu, setPendingRequestMenu] = useState<SettingRequestMenu | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [locationStatus, setLocationStatus] = useState<LocationTrackingStatus | null>(null);
  const helpTitleId = useId();
  const helpDescriptionId = useId();
  const helpCloseRef = useRef<HTMLButtonElement>(null);
  const helpDialogRef = useDialogFocusLifecycle<HTMLDivElement>({
    open: helpOpen,
    onClose: () => setHelpOpen(false),
    initialFocusRef: helpCloseRef,
  });

  useEffect(() => {
    let disposed = false;
    let appListener: { remove(): Promise<void> } | null = null;
    const refresh = async () => {
      const next = await readLocationTrackingStatus();
      if (!disposed) setLocationStatus(next);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };

    void refresh();
    document.addEventListener("visibilitychange", onVisibility);
    if (isNativePlatform()) {
      void import("@capacitor/app")
        .then(async ({ App }) => {
          const listener = await App.addListener("appStateChange", (state) => {
            if (state.isActive) void refresh();
          });
          if (disposed) await listener.remove();
          else appListener = listener;
        })
        .catch((error: unknown) => {
          console.error("[child-settings] 앱 복귀 위치 상태 확인 등록 실패:", error);
        });
    }
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void appListener?.remove();
    };
  }, []);

  const me = useMemo(() => {
    const children = (family?.members ?? []).filter((m) => m.role === "child");
    return children.find((m) => m.user_id === userId) ?? null;
  }, [family, userId]);

  const parents = useMemo(() => (family?.members ?? []).filter((m) => m.role === "parent"), [family]);
  const conn = connectionLabel(parents, intl);
  const age = ageFrom(me?.birthdate, now);
  const myName = me?.name || intl.formatMessage({ id: "child.fallback.friend" });
  const notifSettings = notifSettingsQuery.data ?? DEFAULT_NOTIF_SETTINGS;
  const notifOn = notifSettings.childEnabled;
  const quietHoursRange = notificationQuietHoursRange(notifSettings.quietHours, locale);
  const quietHoursOn = notifSettings.quietHours.enabled && quietHoursRange.length > 0;
  // 네이티브 위치 상태 문구 불변식: 위치 보내기가 꺼져 있어 / 위치 상태를 확인하지 못했어 / 위치 상태를 확인하고 있어.
  const locationView = (() => {
    switch (locationStatus) {
      case "on":
        return { sub: intl.formatMessage({ id: "child.settings.location.on" }), chip: intl.formatMessage({ id: "child.state.on" }), tone: "positive" as const };
      case "off":
        return { sub: intl.formatMessage({ id: "child.settings.location.off" }), chip: intl.formatMessage({ id: "child.state.off" }), tone: "caution" as const };
      case "unsupported":
        return { sub: intl.formatMessage({ id: "child.settings.location.unsupported" }), chip: intl.formatMessage({ id: "child.state.unavailable" }), tone: "caution" as const };
      case "error":
        return { sub: intl.formatMessage({ id: "child.settings.location.error" }), chip: intl.formatMessage({ id: "child.state.error" }), tone: "danger" as const };
      default:
        return { sub: intl.formatMessage({ id: "child.settings.location.checking" }), chip: intl.formatMessage({ id: "child.state.checking" }), tone: "neutral" as const };
    }
  })();

  const toggleNotifications = () => {
    if (!childSettingsDataReady || saveNotifSettings.isPending) return;
    const nextEnabled = !notifOn;
    saveNotifSettings.mutate(
      { ...notifSettings, childEnabled: nextEnabled },
      {
        onSuccess: () => show(intl.formatMessage({ id: nextEnabled ? "child.settings.notificationsOn" : "child.settings.notificationsOff" }), "🔔"),
        onError: () => show(intl.formatMessage({ id: "child.settings.notificationsSaveFailed" }), "⚠️"),
      },
    );
  };

  const askParent = (menu: SettingRequestMenu) => {
    if (!childSettingsDataReady || !me || request.isPending) return;
    const cd = checkRequestCooldown(menu);
    if (!cd.allowed) {
      show(intl.formatMessage({ id: "child.settings.request.cooldown" }, { seconds: cd.remainingSec }), "⏳");
      return;
    }
    setPendingRequestMenu(menu);
    request.mutate(
      { menu, childName: myName },
      {
        onSuccess: () => {
          setRequested((prev) => ({ ...prev, [menu]: true }));
          show(intl.formatMessage({ id: menu === "sound" ? "child.settings.request.soundSent" : "child.settings.request.characterSent" }), "💌");
        },
        onError: (e) => show(localizeApiError(e, intl, "child"), "⚠️"),
        onSettled: () => setPendingRequestMenu((current) => (current === menu ? null : current)),
      },
    );
  };

  if (childSettingsQueryState === "loading") {
    return (
      <ScreenQueryState
        screenTitle={intl.formatMessage({ id: "child.settings.infoTitle" })}
        state="loading"
        heading={intl.formatMessage({ id: "child.settings.loading.title" })}
        description={intl.formatMessage({ id: "child.settings.loading.description" })}
        onBack={() => navigate(-1)}
      />
    );
  }

  if (childSettingsQueryState === "error" || childSettingsDataMissing) {
    return (
      <ScreenQueryState
        screenTitle={intl.formatMessage({ id: "child.settings.infoTitle" })}
        state="error"
        heading={intl.formatMessage({ id: "child.settings.loadError.title" })}
        description={intl.formatMessage({ id: "child.settings.loadError.description" })}
        onBack={() => navigate(-1)}
        onRetry={() => void retryChildSettings()}
        retrying={childSettingsRefetching}
        retryLabel={intl.formatMessage({ id: "child.action.checkAgain" })}
        retryingLabel={intl.formatMessage({ id: "child.action.checkingAgain" })}
      />
    );
  }

  if (!me) {
    return (
      <ScreenQueryState
        screenTitle={intl.formatMessage({ id: "child.settings.infoTitle" })}
        state="empty"
        heading={intl.formatMessage({ id: "child.familyConnection.missing" })}
        description={intl.formatMessage({ id: "child.settings.familyMissingDescription" })}
        onBack={() => navigate(-1)}
        onRetry={() => navigate("/onboarding")}
        retryLabel={intl.formatMessage({ id: "child.action.goToConnection" })}
      />
    );
  }

  return (
    <div className="ks-root">
      <header className="ks-header">
        <button type="button" className="hy-iconbtn hy-press ks-back" aria-label={intl.formatMessage({ id: "child.action.back" })} onClick={() => navigate(-1)}>
          <ChevronLeft size={22} strokeWidth={2.2} />
        </button>
        <span className="ks-title">{intl.formatMessage({ id: "child.settings.infoTitle" })}</span>
      </header>

      <div className="ks-content">
        {childSettingsDataEmpty && (
          <div className="sqs-inline-empty">
            {intl.formatMessage({ id: "child.settings.empty" })}
          </div>
        )}
        {/* 히어로 */}
        <div className="ks-hero">
          <span className="ks-hero__avatar">
            <img
              className="hy-network-avatar"
              src={avatarSrc(childAvatarPath(me?.photo_url))}
              alt=""
              loading="eager"
              decoding="async"
            />
          </span>
          <div className="ks-hero__main">
            <div className="ks-hero__name">
              {myName}
              {age != null && (
                <span className="ks-hero__age">
                  {intl.formatMessage({ id: "child.settings.age" }, { age })}
                </span>
              )}
            </div>
            <span className={`ks-hero__chip ks-hero__chip--${conn.tone}`}>
              <conn.Icon size={16} strokeWidth={2.2} aria-hidden="true" />
              {conn.text}
            </span>
          </div>
        </div>

        <section className="ks-sec">
          <div className="ks-label">{intl.formatMessage({ id: "child.settings.title" })}</div>
          <LanguageSelector tone="child" />
        </section>

        {/* 부모님이 정한 거(읽기 전용): 없으면 "알림 쉬는 시간이 설정되지 않았어", 있으면 해당 범위에 "알림을 쉬어"라고 안내한다. */}
        <section className="ks-sec">
          <div className="ks-label">{intl.formatMessage({ id: "child.settings.parentManaged" })}</div>
          <div className={`ks-row ks-row--locked ks-row--location-${locationView.tone}`}>
            <span className="ks-row__icon">
              <MapPin size={18} strokeWidth={2.2} />
            </span>
            <span className="ks-row__main">
              <span className="ks-row__title">{intl.formatMessage({ id: "child.settings.locationSharing" })}</span>
              <span className="ks-row__sub">{locationView.sub}</span>
            </span>
            <span className={`ks-onchip ks-onchip--${locationView.tone}`}>{locationView.chip}</span>
          </div>

          <div className="ks-row ks-row--locked ks-row--quiet">
            <span className="ks-row__icon">
              <Clock3 size={18} strokeWidth={2.2} />
            </span>
            <span className="ks-row__main">
              <span className="ks-row__title">{intl.formatMessage({ id: "child.settings.quietHours" })}</span>
              <span className="ks-row__sub">
                {quietHoursOn
                  ? intl.formatMessage({ id: "child.settings.quietHoursRange" }, { range: quietHoursRange })
                  : intl.formatMessage({ id: "child.settings.quietHoursNone" })}
              </span>
            </span>
            <span className="ks-onchip">
              {intl.formatMessage({ id: quietHoursOn ? "child.state.configured" : "child.state.none" })}
            </span>
          </div>

          <button
            type="button"
            className="ks-row hy-press"
            onClick={toggleNotifications}
            disabled={!childSettingsDataReady || saveNotifSettings.isPending} aria-busy={saveNotifSettings.isPending}
            aria-pressed={notifOn}
          >
            <span className="ks-row__icon">
              <Bell size={18} strokeWidth={2.2} />
            </span>
            <span className="ks-row__main">
              <span className="ks-row__title">{intl.formatMessage({ id: "child.settings.notifications" })}</span>
              <span className="ks-row__sub">
                {intl.formatMessage({ id: "child.settings.notificationsDescription" })}
              </span>
            </span>
            <span className={notifOn ? "ks-toggle on" : "ks-toggle"} aria-hidden="true">
              <span className="ks-toggle__knob" />
            </span>
          </button>
        </section>

        {/* 부모님한테 부탁하기(요청형) */}
        <section className="ks-sec">
          <div className="ks-label">{intl.formatMessage({ id: "child.settings.askParent" })}</div>
          {REQUEST_ITEMS.map((item) => (
            <button
              key={item.menu}
              type="button"
              className="ks-row hy-press"
              onClick={() => askParent(item.menu)}
              disabled={request.isPending}
              aria-busy={request.isPending && pendingRequestMenu === item.menu}
            >
              <span className="ks-row__icon">
                <item.Icon size={18} strokeWidth={2.2} />
              </span>
              <span className="ks-row__main">
                <span className="ks-row__title">{intl.formatMessage({ id: item.titleId })}</span>
                <span className="ks-row__sub">
                  {intl.formatMessage({ id: requested[item.menu] ? "child.settings.request.waiting" : item.subId })}
                </span>
              </span>
              <span className="ks-ask">
                {intl.formatMessage({ id: requested[item.menu] ? "child.state.done" : "child.settings.request.ask" })}
              </span>
            </button>
          ))}
        </section>

        {/* 도움말 */}
        <button type="button" className="ks-row hy-press" onClick={() => setHelpOpen(true)}>
          <span className="ks-row__icon">
            <HelpCircle size={18} strokeWidth={2.2} />
          </span>
          <span className="ks-row__main">
            <span className="ks-row__title">{intl.formatMessage({ id: "child.settings.help.title" })}</span>
            <span className="ks-row__sub">{intl.formatMessage({ id: "child.settings.help.description" })}</span>
          </span>
        </button>
        <button type="button" className="ks-row hy-press" onClick={() => navigate("/feedback")}>
          <span className="ks-row__icon">
            <MessageCircleQuestion size={18} strokeWidth={2.2} />
          </span>
          <span className="ks-row__main">
            <span className="ks-row__title">{intl.formatMessage({ id: "child.settings.feedback.title" })}</span>
            <span className="ks-row__sub">{intl.formatMessage({ id: "child.settings.feedback.description" })}</span>
          </span>
        </button>
      </div>

      {helpOpen && (
        <div
          ref={helpDialogRef}
          className="ks-help-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby={helpTitleId}
          aria-describedby={helpDescriptionId}
        >
          <button type="button" className="ks-help-modal__scrim" tabIndex={-1} aria-label={intl.formatMessage({ id: "child.action.close" })} onClick={() => setHelpOpen(false)} />
          <div className="ks-help-modal__card">
            <div className="ks-help-modal__head">
              <span id={helpTitleId} className="ks-help-modal__title">{intl.formatMessage({ id: "child.settings.help.title" })}</span>
              <button ref={helpCloseRef} type="button" className="ks-help-modal__x hy-press" aria-label={intl.formatMessage({ id: "child.action.close" })} onClick={() => setHelpOpen(false)}>
                <X size={20} strokeWidth={2.4} />
              </button>
            </div>
            <div id={helpDescriptionId} className="ks-help-list">
              <div className="ks-help-item hy-explain">
                <span className="ks-help-item__emoji"><MapPin size={18} strokeWidth={2.2} /></span>
                <span className="hy-explain__lines">
                  <b className="hy-explain__line">{intl.formatMessage({ id: "child.settings.locationSharing" })}</b>
                  <small className="hy-explain__line">{intl.formatMessage({ id: "child.settings.help.location" })}</small>
                </span>
              </div>
              <div className="ks-help-item hy-explain">
                <span className="ks-help-item__emoji"><Bell size={18} strokeWidth={2.2} /></span>
                <span className="hy-explain__lines">
                  <b className="hy-explain__line">{intl.formatMessage({ id: "child.settings.notifications" })}</b>
                  <small className="hy-explain__line">{intl.formatMessage({ id: "child.settings.help.notifications" })}</small>
                </span>
              </div>
              <div className="ks-help-item hy-explain">
                <span className="ks-help-item__emoji"><Mail size={18} strokeWidth={2.2} /></span>
                <span className="hy-explain__lines">
                  <b className="hy-explain__line">{intl.formatMessage({ id: "child.settings.askParent" })}</b>
                  <small className="hy-explain__line">{intl.formatMessage({ id: "child.settings.help.requests" })}</small>
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

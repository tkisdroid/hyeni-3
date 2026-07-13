import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, MapPin, Bell, HelpCircle, X, Cat, Mail, type LucideIcon } from "lucide-react";
import { asset } from "@/lib/assets";
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
function connectionLabel(parents: { gender?: string | null }[]): { emoji: string; text: string } {
  const hasMom = parents.some((p) => p.gender === "mom");
  const hasDad = parents.some((p) => p.gender === "dad");
  if (hasMom && hasDad) return { emoji: "👩👨", text: "엄마·아빠와 연결됐어" };
  if (hasMom) return { emoji: "👩", text: "엄마와 연결됐어" };
  if (hasDad) return { emoji: "👨", text: "아빠와 연결됐어" };
  if (parents.length) return { emoji: "👪", text: "가족과 연결됐어" };
  return { emoji: "🔗", text: "아직 연결 대기 중이야" };
}

function avatarSrc(path: string): string {
  return path.startsWith("http") ? path : asset(path);
}

// 부모에게 부탁할 수 있는 잠금 메뉴(요청형).
const REQUEST_ITEMS: Array<{ menu: SettingRequestMenu; Icon: LucideIcon; title: string; sub: string }> = [
  { menu: "sound", Icon: Bell, title: "소리·진동 바꾸기", sub: "부모님이 정하는 항목이야" },
  { menu: "character", Icon: Cat, title: "캐릭터 바꾸기", sub: "부모님한테 부탁해볼 수 있어" },
];

/**
 * 아이 설정 · 연결 상태 (와이어프레임 K-10). 반말.
 * 내 정보/연결 상태·부모 잠금 항목 표시 + 잠금 해제 요청(sendChildSettingRequest).
 */
export function ChildSettings() {
  const navigate = useNavigate();
  const { show } = useToast();
  const now = useMemo(() => new Date(), []);
  const { userId } = useAuth();
  const { data: family } = useMyFamily();
  const request = useSendChildSettingRequest();
  const notifSettingsQuery = useNotifSettings();
  const saveNotifSettings = useSaveNotifSettings();

  const [requested, setRequested] = useState<Record<string, boolean>>({});
  const [helpOpen, setHelpOpen] = useState(false);
  const [locationStatus, setLocationStatus] = useState<LocationTrackingStatus | null>(null);

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
  const conn = connectionLabel(parents);
  const age = ageFrom(me?.birthdate, now);
  const myName = me?.name || "친구";
  const notifSettings = notifSettingsQuery.data ?? DEFAULT_NOTIF_SETTINGS;
  const notifOn = notifSettings.childEnabled;
  const locationView = (() => {
    switch (locationStatus) {
      case "on":
        return { sub: "이 기기에서 위치를 보내고 있어", chip: "켜짐" };
      case "off":
        return { sub: "이 기기의 위치 보내기가 꺼져 있어", chip: "꺼짐" };
      case "unsupported":
        return { sub: "이 기기에서는 위치 상태를 확인할 수 없어", chip: "확인 불가" };
      case "error":
        return { sub: "위치 상태를 확인하지 못했어", chip: "오류" };
      default:
        return { sub: "이 기기의 위치 상태를 확인하고 있어", chip: "확인 중" };
    }
  })();

  const toggleNotifications = () => {
    if (notifSettingsQuery.isLoading || notifSettingsQuery.isError || saveNotifSettings.isPending) return;
    const nextEnabled = !notifOn;
    saveNotifSettings.mutate(
      { ...notifSettings, childEnabled: nextEnabled },
      {
        onSuccess: () => show(nextEnabled ? "일정 알림을 켰어" : "일정 알림을 껐어", "🔔"),
        onError: () => show("알림 설정을 저장하지 못했어. 다시 해줘", "⚠️"),
      },
    );
  };

  const askParent = (menu: SettingRequestMenu, title: string) => {
    if (request.isPending) return;
    const cd = checkRequestCooldown(menu);
    if (!cd.allowed) {
      show(`조금만 기다렸다 다시 해줘 (${cd.remainingSec}초)`, "⏳");
      return;
    }
    request.mutate(
      { menu, childName: myName },
      {
        onSuccess: () => {
          setRequested((prev) => ({ ...prev, [menu]: true }));
          show(`${title.replace(" 바꾸기", "")} 바꿔달라고 엄마 아빠한테 말했어!`, "💌");
        },
        onError: (e) => show(e instanceof Error ? e.message : "부탁을 못 보냈어. 잠시 뒤에 다시 해줘", "⚠️"),
      },
    );
  };

  return (
    <div className="ks-root">
      <header className="ks-header">
        <button type="button" className="hy-iconbtn hy-press ks-back" aria-label="뒤로" onClick={() => navigate(-1)}>
          <ChevronLeft size={22} strokeWidth={2.2} />
        </button>
        <span className="ks-title">내 정보</span>
      </header>

      <div className="ks-content">
        {/* 히어로 */}
        <div className="ks-hero">
          <span className="ks-hero__avatar">
            <img
              src={avatarSrc(childAvatarPath(me?.photo_url))}
              alt=""
            />
          </span>
          <div className="ks-hero__main">
            <div className="ks-hero__name">
              {myName}
              {age != null && <span className="ks-hero__age"> · {age}살</span>}
            </div>
            <span className="ks-hero__chip">
              <span aria-hidden="true">{conn.emoji}</span>
              {conn.text}
            </span>
          </div>
        </div>

        {/* 부모가 정한 항목(읽기 전용) */}
        <section className="ks-sec">
          <div className="ks-label">부모님이 정한 거</div>
          <div className="ks-row ks-row--locked">
            <span className="ks-row__icon">
              <MapPin size={18} strokeWidth={2.2} />
            </span>
            <span className="ks-row__main">
              <span className="ks-row__title">위치 알려주기</span>
              <span className="ks-row__sub">{locationView.sub}</span>
            </span>
            <span className="ks-onchip">{locationView.chip}</span>
          </div>

          <button
            type="button"
            className="ks-row hy-press"
            onClick={toggleNotifications}
            disabled={notifSettingsQuery.isLoading || notifSettingsQuery.isError || saveNotifSettings.isPending}
            aria-pressed={notifOn}
          >
            <span className="ks-row__icon">
              <Bell size={18} strokeWidth={2.2} />
            </span>
            <span className="ks-row__main">
              <span className="ks-row__title">알림</span>
              <span className="ks-row__sub">
                {notifSettingsQuery.isLoading
                  ? "알림 설정을 확인하고 있어"
                  : notifSettingsQuery.isError
                    ? "알림 설정을 불러오지 못했어"
                    : "내 일정 알림 설정으로 저장돼"}
              </span>
            </span>
            <span className={notifOn ? "ks-toggle on" : "ks-toggle"} aria-hidden="true">
              <span className="ks-toggle__knob" />
            </span>
          </button>
        </section>

        {/* 부모님한테 부탁하기(요청형) */}
        <section className="ks-sec">
          <div className="ks-label">부모님한테 부탁하기</div>
          {REQUEST_ITEMS.map((item) => (
            <button
              key={item.menu}
              type="button"
              className="ks-row hy-press"
              onClick={() => askParent(item.menu, item.title)}
              disabled={request.isPending}
            >
              <span className="ks-row__icon">
                <item.Icon size={18} strokeWidth={2.2} />
              </span>
              <span className="ks-row__main">
                <span className="ks-row__title">{item.title}</span>
                <span className="ks-row__sub">{requested[item.menu] ? "부탁했어! 답을 기다려보자" : item.sub}</span>
              </span>
              <span className="ks-ask">{requested[item.menu] ? "완료" : "부탁"}</span>
            </button>
          ))}
        </section>

        {/* 도움말 */}
        <button type="button" className="ks-row hy-press" onClick={() => setHelpOpen(true)}>
          <span className="ks-row__icon">
            <HelpCircle size={18} strokeWidth={2.2} />
          </span>
          <span className="ks-row__main">
            <span className="ks-row__title">도움말</span>
            <span className="ks-row__sub">위치·알림·부탁하기를 알려줄게</span>
          </span>
        </button>
      </div>

      {helpOpen && (
        <div className="ks-modal" role="dialog" aria-modal="true" aria-label="도움말">
          <button type="button" className="ks-modal__scrim" aria-label="닫기" onClick={() => setHelpOpen(false)} />
          <div className="ks-modal__card">
            <div className="ks-modal__head">
              <span className="ks-modal__title">도움말</span>
              <button type="button" className="ks-modal__x hy-press" aria-label="닫기" onClick={() => setHelpOpen(false)}>
                <X size={19} strokeWidth={2.4} />
              </button>
            </div>
            <div className="ks-help-list">
              <div className="ks-help-item">
                <span className="ks-help-item__emoji"><MapPin size={18} strokeWidth={2.2} /></span>
                <span>
                  <b>위치 알려주기</b>
                  <small>부모님이 네가 안전한지 확인하려고 켜 둔 거야.</small>
                </span>
              </div>
              <div className="ks-help-item">
                <span className="ks-help-item__emoji"><Bell size={18} strokeWidth={2.2} /></span>
                <span>
                  <b>알림</b>
                  <small>내 일정 알림을 켜고 끌 수 있어. 중요한 안전 알림은 부모님에게 계속 가.</small>
                </span>
              </div>
              <div className="ks-help-item">
                <span className="ks-help-item__emoji"><Mail size={18} strokeWidth={2.2} /></span>
                <span>
                  <b>부모님한테 부탁하기</b>
                  <small>캐릭터나 소리를 바꾸고 싶을 때 부모님에게 요청을 보낼 수 있어.</small>
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

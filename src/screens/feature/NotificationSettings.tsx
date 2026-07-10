import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { useToast } from "@/app/toast";
import { useNotifSettings, useSaveNotifSettings } from "@/queries/useNotifications";
import {
  DEFAULT_NOTIF_SETTINGS,
  NOTIF_MINUTE_OPTIONS,
  type NotifSettings,
} from "@/lib/api/endpoints/notifications";
import "./NotificationSettings.css";

/**
 * 알림 설정(P-24): 유형별 토글·사전 알림 시간은 notif-settings 로 실 저장(user_id PK).
 * 방해금지는 서버 스키마에 없어 이 기기 localStorage 로만 저장(정직 표기).
 * 부모 존댓말. 토글은 사용자 액션 시 즉시 낙관 반영 후 서버 upsert.
 */

/** 서버 boolean 토글 필드 키(minutesBefore 제외). */
type ToggleKey = "parentEnabled" | "locationEnabled" | "registeredPlaceEnabled" | "playdateEnabled";

interface ToggleDef {
  key: ToggleKey;
  emoji: string;
  soft: string;
  label: string;
  sub: string;
}

const SCHEDULE_TOGGLE: ToggleDef = {
  key: "parentEnabled",
  emoji: "📅",
  soft: "#FDE7F1",
  label: "일정 알림",
  sub: "일정 시작 전 미리 알려드려요",
};

const SAFETY_TOGGLES: ToggleDef[] = [
  { key: "locationEnabled", emoji: "📍", soft: "#E6F2FB", label: "위치 알림", sub: "아이가 도착·이탈하면 알려드려요" },
  { key: "registeredPlaceEnabled", emoji: "🏫", soft: "#E7F8F0", label: "등록 장소 알림", sub: "저장한 장소에 출입할 때" },
  { key: "playdateEnabled", emoji: "🧸", soft: "#FFF3D6", label: "친구·놀이 알림", sub: "놀이 약속 소식이 오면" },
];

const DND_STORAGE_KEY = "hyeni-dnd-v1";

function readDnd(): boolean {
  try {
    return localStorage.getItem(DND_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
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
  return (
    <button type="button" className="nst-row hy-press" aria-pressed={on} onClick={onToggle}>
      <span className="nst-row__icon" style={{ background: def.soft }}>
        {def.emoji}
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
  const { data, isLoading, isError, refetch } = useNotifSettings();
  const save = useSaveNotifSettings();

  // 서버 값(없으면 기본값)으로 초안 초기화. 데이터 첫 도착 시 1회 동기화.
  const [draft, setDraft] = useState<NotifSettings>(DEFAULT_NOTIF_SETTINGS);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (hydrated) return;
    // 성공 data 가 실제 도착했을 때만 1회 seed. undefined(로딩·에러)면 seed 하지 않아
    // 재시도 성공 시 서버 실값으로 동기화된다(에러 상태의 DEFAULT 잠금 방지).
    if (data === undefined) return;
    setDraft(data ?? DEFAULT_NOTIF_SETTINGS);
    setHydrated(true);
  }, [data, hydrated]);

  const [dnd, setDnd] = useState(readDnd);

  // 초안 즉시 반영 + 서버 upsert. 실패 시 정직하게 안내(초안은 유지 → 재시도 가능).
  const persist = (next: NotifSettings) => {
    setDraft(next);
    save.mutate(next, {
      onError: () => show("설정 저장에 실패했어요. 잠시 후 다시 시도해 주세요", "⚠️"),
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

  const toggleDnd = () => {
    const next = !dnd;
    setDnd(next);
    try {
      localStorage.setItem(DND_STORAGE_KEY, next ? "1" : "0");
    } catch {
      /* localStorage 접근 불가 시 무시 */
    }
    show(next ? "방해금지를 켰어요 · 이 기기에만 적용" : "방해금지를 껐어요", next ? "🌙" : "🔔");
  };

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
        {isLoading && <div className="nst-state">설정을 불러오는 중…</div>}

        {isError && !isLoading && (
          <div className="nst-state">
            <span>설정을 불러오지 못했어요</span>
            <button type="button" className="nst-retry hy-press" onClick={() => refetch()}>
              다시 시도
            </button>
          </div>
        )}

        {!isLoading && !isError && (
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
                            {m}분 전
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
            </div>

            {/* 방해금지(이 기기 전용) */}
            <div className="nst-group">
              <div className="nst-group__label">방해금지</div>
              <div className="nst-list">
                <button
                  type="button"
                  className="nst-row hy-press"
                  aria-pressed={dnd}
                  onClick={toggleDnd}
                >
                  <span className="nst-row__icon" style={{ background: "#EDE9FF" }}>
                    🌙
                  </span>
                  <span className="nst-row__main">
                    <span className="nst-row__label">방해금지 모드</span>
                    <span className="nst-row__sub">켜면 알림 소리·진동을 잠시 꺼요</span>
                  </span>
                  <span className="nst-switch" data-on={dnd}>
                    <span className="nst-switch__knob" />
                  </span>
                </button>
              </div>
              <div className="nst-note">방해금지는 이 기기에만 저장돼요.</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

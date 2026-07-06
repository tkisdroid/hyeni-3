import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ChevronLeft, Map } from "lucide-react";
import { useToast } from "@/app/toast";
import { useActiveChild } from "@/app/activeChild";
import { MapPickerSheet } from "@/components/MapPickerSheet";
import { useAuth } from "@/auth/AuthContext";
import { useMyFamily } from "@/queries/useFamily";
import { useSavedPlaces } from "@/queries/useLocation";
import { useSaveEventWithChildren } from "@/queries/useSchedule";
import {
  notifOverrideToReminderMinutes,
  reminderMinutesToNotifOverride,
  type CalendarEvent,
} from "@/lib/api/endpoints/schedule";
import {
  addDaysToDateKey,
  dateInputValueToDateKey,
  dateKeyToDateInputValue,
  dateToDateKey,
  parseAppDateKey,
  todayDateKey,
} from "@/transform/dateKey";
import "./EventForm.css";

type Mode = "create" | "edit";

interface FormNavState {
  mode?: Mode;
  event?: CalendarEvent;
  dateKey?: string;
}

/** 카테고리(색/이모지는 transform/scheduleView 의 CATEGORY_STYLE 과 동일 규칙). */
const CATEGORIES = [
  { id: "school", label: "학교", emoji: "📚", color: "#2E86C1", soft: "#E6F2FB" },
  { id: "sports", label: "운동", emoji: "⚽", color: "#F26B3F", soft: "#FFEEE3" },
  { id: "hobby", label: "취미", emoji: "🎨", color: "#E08A1E", soft: "#FFF3D6" },
  { id: "family", label: "가족", emoji: "👨‍👩‍👧", color: "var(--hy-accent)", soft: "var(--hy-accent-soft)" },
  { id: "friend", label: "친구", emoji: "👫", color: "#31C48D", soft: "#E7F8F0" },
  { id: "other", label: "기타", emoji: "🌟", color: "#7C5CE1", soft: "#F1ECFF" },
] as const;

type Repeat = "없음" | "매일" | "매주" | "매월";
const REPEATS: Repeat[] = ["없음", "매일", "매주", "매월"];

const PREALARMS: Array<{ label: string; minutes: number | null }> = [
  { label: "없음", minutes: null },
  { label: "10분 전", minutes: 10 },
  { label: "30분 전", minutes: 30 },
  { label: "1시간 전", minutes: 60 },
];

const IDLE_BG = "#F3EEF1";
const IDLE_COLOR = "#8B7E84";

/** 아이 member id 초기 선택 집합(edit 모드의 기존 events_children.child_id). */
function initialChildIds(event?: CalendarEvent): Set<string> {
  const ids = (event?.events_children ?? [])
    .map((c) => c.child_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  return new Set(ids);
}

/** 반복 설정 → 발생일 date_key 목록(생성 전용, 서버는 반복 컬럼이 없어 행 단위로 확장). */
function buildOccurrenceDateKeys(baseDateKey: string, repeat: Repeat): string[] {
  if (repeat === "매일") return Array.from({ length: 14 }, (_, i) => addDaysToDateKey(baseDateKey, i));
  if (repeat === "매주") return Array.from({ length: 8 }, (_, i) => addDaysToDateKey(baseDateKey, i * 7));
  if (repeat === "매월") {
    const base = parseAppDateKey(baseDateKey);
    if (!base) return [baseDateKey];
    return Array.from({ length: 6 }, (_, i) =>
      dateToDateKey(new Date(base.getFullYear(), base.getMonth() + i, base.getDate())),
    );
  }
  return [baseDateKey];
}

export function EventForm() {
  const navigate = useNavigate();
  const { show } = useToast();
  const { familyId } = useAuth();
  const nav = (useLocation().state ?? null) as FormNavState | null;

  const mode: Mode = nav?.mode === "edit" ? "edit" : "create";
  const editing = mode === "edit" ? nav?.event ?? null : null;

  const familyQuery = useMyFamily();
  const children = useMemo(
    () => (familyQuery.data?.members ?? []).filter((m) => m.role === "child"),
    [familyQuery.data],
  );
  // 저장된 장소(장소관리) — 장소 필드 빠른 선택 칩.
  const savedPlacesQuery = useSavedPlaces();
  const savedPlaces = savedPlacesQuery.data ?? [];

  const saveEvent = useSaveEventWithChildren();
  const [busy, setBusy] = useState(false);

  // ── 폼 상태(초기값은 edit 이면 기존 일정, create 면 전달된 dateKey/오늘) ──
  const [title, setTitle] = useState(() => editing?.title ?? "");
  const [selectedChildIds, setSelectedChildIds] = useState<Set<string>>(() =>
    initialChildIds(editing ?? undefined),
  );
  // 새 일정 기본 배정 = 전역 활성 아이(가족 로드 후 1회만; 사용자가 건드리면 존중).
  // 빈 선택은 "가족 공유(모든 아이 표시)"라 의도치 않은 전체 노출을 막는다.
  const { activeChild } = useActiveChild();
  const childDefaultDone = useRef(false);
  useEffect(() => {
    if (childDefaultDone.current || mode !== "create" || !activeChild) return;
    childDefaultDone.current = true;
    setSelectedChildIds((prev) => (prev.size > 0 ? prev : new Set([activeChild.id])));
  }, [mode, activeChild]);
  const [dateValue, setDateValue] = useState(() => {
    if (editing) return dateKeyToDateInputValue(editing.date_key);
    const key = nav?.dateKey ?? todayDateKey();
    return dateKeyToDateInputValue(key);
  });
  const [timeValue, setTimeValue] = useState(() => editing?.time ?? "");
  const [category, setCategory] = useState<string>(() => editing?.category ?? "school");
  const [place, setPlace] = useState(() => editing?.location?.address ?? "");
  // 지도/저장장소로 지정한 좌표(있으면 event.location 에 lat/lng 로 함께 저장).
  const [placeCoord, setPlaceCoord] = useState<{ lat: number; lng: number } | null>(() =>
    typeof editing?.location?.lat === "number" && typeof editing?.location?.lng === "number"
      ? { lat: editing.location.lat, lng: editing.location.lng }
      : null,
  );
  const [showMapPicker, setShowMapPicker] = useState(false);
  const [repeat, setRepeat] = useState<Repeat>("없음");
  const [prealarm, setPrealarm] = useState<number | null>(() =>
    notifOverrideToReminderMinutes(editing?.notif_override),
  );
  const [memo, setMemo] = useState(() => editing?.memo ?? "");

  const toggleChild = (id: string) =>
    setSelectedChildIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleSave = async () => {
    if (busy) return;
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      show("일정 제목을 입력해 주세요", "✏️");
      return;
    }
    if (!timeValue) {
      show("시간을 선택해 주세요", "🕒");
      return;
    }
    const dateKey = dateInputValueToDateKey(dateValue);
    if (!dateKey) {
      show("날짜를 확인해 주세요", "📅");
      return;
    }
    if (!familyId) {
      show("가족 정보를 불러오지 못했어요", "⚠️");
      return;
    }

    const catStyle = CATEGORIES.find((c) => c.id === category);
    const childIds = Array.from(selectedChildIds);
    const baseFields = {
      title: trimmedTitle,
      time: timeValue,
      category,
      emoji: catStyle?.emoji ?? "🌟",
      memo: memo.trim(),
      location: place.trim()
        ? { address: place.trim(), ...(placeCoord ? { lat: placeCoord.lat, lng: placeCoord.lng } : {}) }
        : null,
      notif_override: reminderMinutesToNotifOverride(prealarm),
      is_family_event: category === "family",
    };

    setBusy(true);
    try {
      if (mode === "edit" && editing) {
        await saveEvent.mutateAsync({
          event: { id: editing.id, family_id: familyId, date_key: dateKey, ...baseFields },
          childIds,
          familyAll: false,
          expectedUpdatedAt: editing.updated_at ?? null,
        });
        show("일정을 수정했어요", "🗓️");
      } else {
        const keys = buildOccurrenceDateKeys(dateKey, repeat);
        for (const dk of keys) {
          await saveEvent.mutateAsync({
            event: { id: crypto.randomUUID(), family_id: familyId, date_key: dk, ...baseFields },
            childIds,
            familyAll: false,
            expectedUpdatedAt: null,
          });
        }
        show(keys.length > 1 ? `${keys.length}개 일정을 저장했어요` : "일정을 저장했어요", "🗓️");
      }
      navigate(-1);
    } catch {
      show("일정 저장에 실패했어요. 다시 시도해 주세요", "⚠️");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ef-screen">
      <header className="ef-header">
        <button
          type="button"
          className="ef-back hy-press"
          aria-label="뒤로"
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} strokeWidth={2.2} color="#4A4145" />
        </button>
        <span className="ef-title">{mode === "edit" ? "일정 수정" : "새 일정"}</span>
      </header>

      <div className="ef-body">
        {/* 제목 */}
        <div>
          <div className="ef-label">제목</div>
          <input
            className="ef-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="예) 피아노 학원"
          />
        </div>

        {/* 아이(다중 배정) — 서버 events_children 에 실제 저장 */}
        <div>
          <div className="ef-label">아이</div>
          {children.length === 0 ? (
            <div className="ef-empty-note">가족에 등록된 아이가 없어요</div>
          ) : (
            <div className="ef-chips">
              {children.map((m) => {
                const active = selectedChildIds.has(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    className="ef-chip hy-press"
                    style={
                      active
                        ? {
                            background: "var(--hy-accent-soft)",
                            color: "var(--hy-accent-text)",
                            border: "1.5px solid var(--hy-accent)",
                          }
                        : { background: IDLE_BG, color: IDLE_COLOR, border: "1.5px solid transparent" }
                    }
                    onClick={() => toggleChild(m.id)}
                  >
                    {(m.emoji || "🧒") + " " + (m.name || "아이")}
                    {active ? " ✓" : ""}
                  </button>
                );
              })}
            </div>
          )}
          <div className="ef-note">
            {selectedChildIds.size === 0
              ? "아무도 선택하지 않으면 가족 공유 일정으로 모든 아이에게 보여요"
              : "여러 아이를 함께 배정할 수 있어요"}
          </div>
        </div>

        {/* 날짜 · 시간 */}
        <div>
          <div className="ef-label">날짜 · 시간</div>
          <div className="ef-row">
            <input
              type="date"
              className="ef-input ef-input--date"
              value={dateValue}
              onChange={(e) => setDateValue(e.target.value)}
            />
            <input
              type="time"
              className="ef-input ef-input--time"
              value={timeValue}
              onChange={(e) => setTimeValue(e.target.value)}
            />
          </div>
        </div>

        {/* 카테고리 */}
        <div>
          <div className="ef-label">카테고리</div>
          <div className="ef-chips">
            {CATEGORIES.map((c) => {
              const active = category === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  className="ef-chip hy-press"
                  style={
                    active
                      ? { background: c.soft, color: c.color, border: `1.5px solid ${c.color}` }
                      : { background: IDLE_BG, color: IDLE_COLOR, border: "1.5px solid transparent" }
                  }
                  onClick={() => setCategory(c.id)}
                >
                  {c.emoji + " " + c.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* 장소 — 저장장소 빠른 선택(좌표 포함) + 지도에서 지정 + 직접 입력.
            저장은 event.location = { address, lat?, lng? }. */}
        <div>
          <div className="ef-label">장소</div>
          {savedPlaces.length > 0 && (
            <div className="ef-chips" style={{ marginBottom: 8 }}>
              {savedPlaces.map((p) => {
                const label = p.is_home ? `🏠 ${p.name}` : `📍 ${p.name}`;
                const active = place.trim() === p.name;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className="ef-chip hy-press"
                    style={
                      active
                        ? {
                            background: "var(--hy-accent-soft)",
                            color: "var(--hy-accent-text)",
                            border: "1.5px solid var(--hy-accent)",
                          }
                        : { background: IDLE_BG, color: IDLE_COLOR, border: "1.5px solid transparent" }
                    }
                    onClick={() => {
                      if (active) {
                        setPlace("");
                        setPlaceCoord(null);
                        return;
                      }
                      setPlace(p.name);
                      setPlaceCoord(
                        typeof p.location?.lat === "number" && typeof p.location?.lng === "number"
                          ? { lat: p.location.lat, lng: p.location.lng }
                          : null,
                      );
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}
          <div className="ef-row">
            <input
              className="ef-input"
              value={place}
              onChange={(e) => {
                setPlace(e.target.value);
                if (!e.target.value.trim()) setPlaceCoord(null); // 비우면 좌표도 해제
              }}
              placeholder="예) 선부동 뮤직스쿨"
            />
            <button
              type="button"
              className="ef-mapbtn hy-press"
              aria-label="지도에서 장소 지정"
              onClick={() => setShowMapPicker(true)}
            >
              <Map size={17} strokeWidth={2.2} />
              지도
            </button>
          </div>
          {placeCoord && (
            <div className="ef-note">📍 지도 위치가 함께 저장돼요</div>
          )}
        </div>

        {/* 반복 — 생성 시에만(서버는 반복 컬럼이 없어 발생일마다 별도 일정으로 저장) */}
        {mode === "create" ? (
          <div>
            <div className="ef-label">반복</div>
            <div className="ef-chips">
              {REPEATS.map((r) => {
                const active = repeat === r;
                return (
                  <button
                    key={r}
                    type="button"
                    className="ef-chip hy-press"
                    style={
                      active
                        ? {
                            background: "var(--hy-accent-soft)",
                            color: "var(--hy-accent-text)",
                            border: "1.5px solid var(--hy-accent)",
                          }
                        : { background: IDLE_BG, color: IDLE_COLOR, border: "1.5px solid transparent" }
                    }
                    onClick={() => setRepeat(r)}
                  >
                    {r}
                  </button>
                );
              })}
            </div>
            {repeat !== "없음" && (
              <div className="ef-note">
                {repeat === "매일"
                  ? "오늘부터 14일간"
                  : repeat === "매주"
                    ? "이 요일로 8주간"
                    : "이 날짜로 6개월간"}{" "}
                일정이 만들어져요
              </div>
            )}
          </div>
        ) : (
          <div>
            <div className="ef-label">반복</div>
            <div className="ef-note">반복은 새 일정에서만 설정할 수 있어요</div>
          </div>
        )}

        {/* 사전 알림 — notif_override 로 실제 저장 */}
        <div>
          <div className="ef-label">사전 알림</div>
          <div className="ef-chips">
            {PREALARMS.map((p) => {
              const active = prealarm === p.minutes;
              return (
                <button
                  key={p.label}
                  type="button"
                  className="ef-chip hy-press"
                  style={
                    active
                      ? {
                          background: "var(--hy-accent-soft)",
                          color: "var(--hy-accent-text)",
                          border: "1.5px solid var(--hy-accent)",
                        }
                      : { background: IDLE_BG, color: IDLE_COLOR, border: "1.5px solid transparent" }
                  }
                  onClick={() => setPrealarm(p.minutes)}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* 메모 */}
        <div>
          <div className="ef-label">메모 · 준비물</div>
          <textarea
            className="ef-textarea"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="예) 악보, 물통"
            rows={3}
          />
        </div>

        {/* 저장 */}
        <button type="button" className="ef-save hy-press" onClick={handleSave} disabled={busy}>
          {busy ? "저장 중…" : mode === "edit" ? "수정 저장" : "일정 저장"}
        </button>
      </div>

      {/* 지도 장소 피커 — 현재 위치 기준, 지도 탭/저장장소 선택으로 좌표+주소 지정 */}
      {showMapPicker && (
        <MapPickerSheet
          savedPlaces={savedPlaces}
          initial={placeCoord}
          onClose={() => setShowMapPicker(false)}
          onConfirm={(sel) => {
            setPlaceCoord({ lat: sel.lat, lng: sel.lng });
            setPlace(sel.name ?? (sel.address || place.trim() || "지도에서 선택한 위치"));
            setShowMapPicker(false);
          }}
        />
      )}
    </div>
  );
}

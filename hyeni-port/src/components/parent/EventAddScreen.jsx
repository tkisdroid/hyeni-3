import { useKidsSchedulerContext } from "../../contexts/KidsSchedulerContext.js";
import { HyeniMascot } from "../auth/HyeniMascot.jsx";
import { ThreeDIcon } from "../icons/ThreeDIcon.jsx";
import { ChildSelector } from "../multichild/EventModal/ChildSelector.jsx";
import { EventSheet } from "../multichild/EventModal/EventSheet.jsx";
import { CATEGORIES } from "../../lib/scheduleCategories.js";
import { SCHEDULE_PRESETS } from "../../lib/scheduleConstants.js";
import {
    SCHEDULE_TIME_SLOTS,
    normalizeScheduleTimeValue,
    formatScheduleTimeValue,
    formatKoreanScheduleTime,
    formatScheduleDuration,
} from "../../lib/scheduleTime.js";
import { getPlaceLocationKey } from "../../lib/placeFormat.js";
import { canAddSavedPlace } from "../../lib/freeTierGate.js";
import { FEATURES } from "../../lib/features.js";
import { FF } from "../../lib/styleHelpers.js";
import { dateInputValueToDateKey, dateKeyToDateInputValue } from "../../lib/scheduleDateRange.js";

// 부모/자녀 "새 일정 · 일정 수정" 시트 — App.jsx EventSheet 인라인 블록에서 추출
// (KidsSchedulerContext consumer). addEvent 등 Supabase 로직과 모든 상태/핸들러는
// App에 그대로 남기고 컨텍스트로 전달받음 — JSX/문구/스타일은 원본 그대로 보존.
export function EventAddScreen() {
    const {
        isParent,
        pairedChildren,
        usageTier,
        entitlement,
        savedPlaces,
        handleOpenPlaceManager,
        isEventAddView,
        goToTodayView,
        // 상태
        showAddModal,
        editingEventId,
        addEventDateKey,
        addEventEndDateKey,
        newTitle,
        newTime,
        newEndTime,
        timeSelectionTarget,
        newCategory,
        newMemo,
        newLocation,
        selectedPreset,
        weeklyRepeat,
        repeatWeeks,
        eventChildSelection,
        // 세터
        setShowAddModal,
        setEditingEventId,
        setAddEventDateKey,
        setAddEventEndDateKey,
        setNewTitle,
        setNewTime,
        setNewEndTime,
        setTimeSelectionTarget,
        setNewCategory,
        setNewMemo,
        setNewLocation,
        setSelectedPreset,
        setWeeklyRepeat,
        setRepeatWeeks,
        setEventChildSelection,
        setEditingLocForEvent,
        setShowMapPicker,
        // 핸들러
        addEvent,
        handleStartTimeInputChange,
        handleEndTimeInputChange,
        handleScheduleTimeSlotSelect,
        handleDurationPresetSelect,
        findLastEventByTitle,
        getEffectiveEventChildSelection,
        // 파생값
        selectedStartMinutes,
        selectedEndMinutes,
        hasSelectedEndTime,
        selectedTimeRangeLabel,
        selectedTimeDurationLabel,
        scheduleDraftDateKey,
        schedulePlaceOptions,
        // 스타일
        labelSt,
        inputSt,
        scheduleDateInputStyle,
    } = useKidsSchedulerContext();

    return (
        <EventSheet
            open={showAddModal || isEventAddView}
            title={editingEventId ? "일정 수정" : "새 일정"}
            saveLabel={editingEventId ? "수정" : "저장"}
            bottomNavigationVisible={false}
            onClose={() => {
                setShowAddModal(false);
                setEditingEventId(null);
                setAddEventDateKey(null);
                setAddEventEndDateKey(null);
                setNewTitle("");
                setNewEndTime("");
                setTimeSelectionTarget("start");
                setNewLocation(null);
                setSelectedPreset(null);
                setWeeklyRepeat(false);
                setRepeatWeeks(4);
                if (isEventAddView) goToTodayView();
            }}
            onSave={async () => {
                await addEvent();
                if (isEventAddView) goToTodayView();
            }}
        >
            {(showAddModal || isEventAddView) && (
                <>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px 14px", marginBottom: 4 }}>
                        <HyeniMascot variant={editingEventId ? "diary" : "phone"} size={56} aria-label="" />
                        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                            <strong style={{ fontSize: 15, fontWeight: 700, color: "var(--fg-primary)", letterSpacing: 0 }}>
                                {editingEventId ? "일정을 다듬어볼까요?" : "오늘 뭐 할까요?"}
                            </strong>
                            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--fg-secondary)" }}>
                                {editingEventId ? "변경할 부분만 수정해도 돼요 ✏️" : "빠른 선택 또는 직접 입력해보세요 ✨"}
                            </span>
                        </div>
                    </div>

                    {isParent && pairedChildren.length > 0 && (() => {
                        // ChildSelector stores family_members.id values in childIds (events_children FK target).
                        const displayedSelection = getEffectiveEventChildSelection(eventChildSelection);
                        const selectedNames = pairedChildren
                            .filter((c) => displayedSelection.childIds.includes(c.id))
                            .map((c) => c.name);
                        const allChildNames = pairedChildren.map((c) => c.name).join(", ");
                        let msg;
                        if (displayedSelection.familyAll) {
                            msg = `📡 저장 시 가족 전체 (${allChildNames})에게 전송`;
                        } else if (selectedNames.length > 0) {
                            msg = `📡 저장 시 ${selectedNames.join(", ")}에게만 전송`;
                        } else {
                            msg = "📌 아래에서 받을 아이를 선택해 주세요";
                        }
                        return <div style={{ fontSize: 12, fontWeight: 700, color: "var(--theme-accent-text)", background: "var(--bg-subtle)", borderRadius: 10, padding: "6px 12px", marginBottom: 14, display: "inline-block" }}>{msg}</div>;
                    })()}

                    <div style={{ marginBottom: 14 }}>
                        <label style={{ ...labelSt, display: "inline-flex", alignItems: "center", gap: 4 }}>
                            <ThreeDIcon name="calendar-heart" size={14} aria-label="" /> 시작 날짜
                        </label>
                        <input
                            type="date"
                            style={scheduleDateInputStyle}
                            value={dateKeyToDateInputValue(addEventDateKey || scheduleDraftDateKey)}
                            onChange={(e) => {
                                const nextDateKey = dateInputValueToDateKey(e.target.value);
                                if (!nextDateKey) return;
                                setAddEventDateKey(nextDateKey);
                                const currentEndInputValue = dateKeyToDateInputValue(addEventEndDateKey);
                                if (currentEndInputValue && currentEndInputValue < e.target.value) {
                                    setAddEventEndDateKey(null);
                                }
                            }}
                            aria-label="일정 시작 날짜"
                        />
                        {!editingEventId && !weeklyRepeat && (
                            <div style={{ marginTop: 10 }}>
                                <label style={{ ...labelSt, display: "inline-flex", alignItems: "center", gap: 4 }}>
                                    <ThreeDIcon name="calendar-check" size={14} aria-label="" /> 종료 날짜
                                </label>
                                <input
                                    type="date"
                                    style={scheduleDateInputStyle}
                                    value={dateKeyToDateInputValue(addEventEndDateKey)}
                                    min={dateKeyToDateInputValue(addEventDateKey || scheduleDraftDateKey)}
                                    onChange={(e) => setAddEventEndDateKey(dateInputValueToDateKey(e.target.value))}
                                    aria-label="일정 종료 날짜"
                                />
                            </div>
                        )}
                    </div>

                    <div style={{ marginBottom: 14 }}>
                        <label style={{ ...labelSt, display: "inline-flex", alignItems: "center", gap: 4 }}>
                            <ThreeDIcon name="lightning" size={14} aria-label="" /> 빠른 선택
                        </label>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                            {SCHEDULE_PRESETS.map(p => {
                                const active = selectedPreset?.label === p.label;
                                return (
                                    <button key={p.label} onClick={() => {
                                        setSelectedPreset(p);
                                        setNewCategory(p.category);
                                        const last = findLastEventByTitle(p.label);
                                        if (last) { setNewTime(normalizeScheduleTimeValue(last.time)); if (last.location) setNewLocation(last.location); }
                                    }}
                                        style={{ padding: "6px 12px", borderRadius: "var(--radius-md)", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: FF, border: active ? "2px solid var(--theme-accent)" : "2px solid var(--bg-muted)", background: active ? "var(--theme-accent-soft)" : "var(--bg-subtle)", color: active ? "var(--theme-accent-text)" : "var(--fg-secondary)", transition: "all 0.15s" }}>
                                        {p.emoji} {p.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                    <div style={{ marginBottom: 14 }}>
                        <label style={{ ...labelSt, display: "inline-flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                            <ThreeDIcon name="pin" size={14} aria-label="" /> 일정 이름
                            {selectedPreset && <span style={{ fontSize: 11, color: "var(--fg-tertiary)", fontWeight: 500 }}>(비워두면 "{selectedPreset.label}")</span>}
                        </label>
                        <input style={inputSt} placeholder={selectedPreset ? `${selectedPreset.emoji} ${selectedPreset.label}` : "예) 영어 학원, 태권도..."} value={newTitle} onChange={e => setNewTitle(e.target.value)} />
                    </div>
                    <div style={{ marginBottom: 14 }}>
                        <label style={{ ...labelSt, display: "inline-flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                            <ThreeDIcon name="clock" size={14} aria-label="" /> 시간
                            {selectedPreset && findLastEventByTitle(selectedPreset.label) && <span style={{ fontSize: 11, color: "var(--fg-tertiary)", fontWeight: 500 }}>(지난번 시간)</span>}
                        </label>
                        <div className="hyeni-schedule-time-card">
                            <div className="hyeni-schedule-time-head">
                                <div>
                                    <span className="hyeni-schedule-time-kicker">시간대 선택</span>
                                    <strong>{selectedTimeRangeLabel}</strong>
                                </div>
                                <div className="hyeni-time-target-toggle" role="group" aria-label="시간 선택 대상">
                                    <button
                                        type="button"
                                        className={timeSelectionTarget === "start" ? "is-active" : ""}
                                        onClick={() => setTimeSelectionTarget("start")}
                                    >
                                        시작
                                    </button>
                                    <button
                                        type="button"
                                        className={timeSelectionTarget === "end" ? "is-active" : ""}
                                        onClick={() => setTimeSelectionTarget("end")}
                                    >
                                        종료
                                    </button>
                                </div>
                            </div>
                            <div className="hyeni-time-direct-row" role="group" aria-label="시간 직접 입력">
                                <label className="hyeni-time-direct-field">
                                    <span>시작</span>
                                    <input
                                        type="time"
                                        className="hyeni-time-input hyeni-time-direct-input"
                                        value={newTime || ""}
                                        step={60}
                                        onChange={(e) => handleStartTimeInputChange(e.target.value)}
                                        aria-label="시작 시간 직접 입력"
                                    />
                                </label>
                                <span className="hyeni-time-direct-divider" aria-hidden="true">~</span>
                                <label className="hyeni-time-direct-field">
                                    <span>종료</span>
                                    <input
                                        type="time"
                                        className="hyeni-time-input hyeni-time-direct-input"
                                        value={newEndTime || ""}
                                        step={60}
                                        onChange={(e) => handleEndTimeInputChange(e.target.value)}
                                        aria-label="종료 시간 직접 입력"
                                        placeholder="--:--"
                                    />
                                </label>
                            </div>
                            <div className="hyeni-time-rail" role="group" aria-label="일정 시간대 선택">
                                <div className="hyeni-time-ruler" aria-hidden="true">
                                    {[7, 9, 11, 13, 15, 17, 19, 21].map(hour => (
                                        <span key={hour}>{hour < 12 ? `${hour}시` : `${hour - 12 || 12}시`}</span>
                                    ))}
                                </div>
                                <div className="hyeni-time-slot-row">
                                    {SCHEDULE_TIME_SLOTS.map(minutes => {
                                        const value = formatScheduleTimeValue(minutes);
                                        const isStart = minutes === selectedStartMinutes;
                                        const isEnd = hasSelectedEndTime && minutes === selectedEndMinutes;
                                        const isSelected = hasSelectedEndTime
                                            ? minutes >= selectedStartMinutes && minutes <= selectedEndMinutes
                                            : isStart;
                                        return (
                                            <button
                                                key={value}
                                                type="button"
                                                className={`hyeni-time-slot${isSelected ? " is-selected" : ""}${isStart ? " is-start" : ""}${isEnd ? " is-end" : ""}`}
                                                aria-label={`${formatKoreanScheduleTime(value)} ${timeSelectionTarget === "start" ? "시작" : "종료"} 시간 선택`}
                                                aria-pressed={isStart || isEnd}
                                                onClick={() => handleScheduleTimeSlotSelect(minutes)}
                                            >
                                                <span>{minutes % 60 === 0 ? `${Math.floor(minutes / 60) % 12 || 12}` : ""}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                            <div className="hyeni-time-duration-row" aria-label="종료 시간 빠른 선택">
                                {[30, 60, 90, 120].map(durationMinutes => (
                                    <button
                                        key={durationMinutes}
                                        type="button"
                                        onClick={() => handleDurationPresetSelect(durationMinutes)}
                                    >
                                        {formatScheduleDuration(durationMinutes)}
                                    </button>
                                ))}
                            </div>
                            <div className="hyeni-time-summary">
                                <div>
                                    <strong>{selectedTimeRangeLabel}</strong>
                                    <span>{selectedTimeDurationLabel}</span>
                                </div>
                                {newEndTime && (
                                    <button type="button" onClick={() => { setNewEndTime(""); setTimeSelectionTarget("end"); }}>
                                        종료 제거
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                    <div style={{ marginBottom: 14 }}>
                        <label style={labelSt}>🏷️ 종류 {selectedPreset && <span style={{ fontSize: 11, color: "var(--fg-tertiary)", fontWeight: 500 }}>(자동 매칭됨)</span>}</label>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                            {CATEGORIES.map(cat => {
                                const active = newCategory === cat.id;
                                return (
                                    <button key={cat.id} onClick={() => setNewCategory(cat.id)} style={{ padding: "8px 14px", borderRadius: "var(--radius-lg)", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: FF, background: active ? "var(--theme-accent-soft)" : "white", color: active ? "var(--theme-accent-text)" : "var(--fg-secondary)", border: active ? "2px solid var(--theme-accent)" : "2px solid var(--theme-accent-line)" }}>{cat.emoji} {cat.label}</button>
                                );
                            })}
                        </div>
                    </div>
                    {(isParent || schedulePlaceOptions.length > 0 || newLocation) && (
                        <div style={{ marginBottom: 14 }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
                                <label style={{ ...labelSt, marginBottom: 0, display: "inline-flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                                    <ThreeDIcon name="pin" size={14} aria-label="" /> 등록한 장소 {newLocation && <span style={{ fontSize: 11, color: "var(--theme-accent-text)", fontWeight: 500 }}>(일정 위치로 적용)</span>}
                                </label>
                                {isParent && (
                                    <button
                                        type="button"
                                        aria-label="📍 장소관리"
                                        onClick={handleOpenPlaceManager}
                                        style={{
                                            border: "none",
                                            borderRadius: "var(--radius-input)",
                                            padding: "7px 10px",
                                            background: "var(--hyeni-theme-gradient)",
                                            color: "white",
                                            fontSize: 11,
                                            fontWeight: 700,
                                            cursor: "pointer",
                                            fontFamily: FF,
                                            flexShrink: 0,
                                        }}
                                    >
                                        + 장소관리
                                    </button>
                                )}
                            </div>
                            {isParent && !canAddSavedPlace({ tier: usageTier, unlimited: entitlement.canUse(FEATURES.SAVED_PLACES), currentCount: savedPlaces.length }) && (
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10, fontFamily: FF }}>
                                    {["리뷰 3개", "프리미엄 무제한"].map((label) => (
                                        <span key={label} style={{ minHeight: 26, display: "inline-flex", alignItems: "center", padding: "5px 9px", borderRadius: 999, background: "var(--theme-accent-soft)", border: "1px solid var(--theme-accent-line)", color: "var(--theme-accent-text)", fontSize: 11, fontWeight: 700 }}>
                                            {label}
                                        </span>
                                    ))}
                                </div>
                            )}
                            {schedulePlaceOptions.length > 0 && (
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                                    {schedulePlaceOptions.map((place) => {
                                        const active = getPlaceLocationKey(newLocation) === getPlaceLocationKey(place.location);
                                        return (
                                            <button
                                                key={place.key}
                                                type="button"
                                                onClick={() => {
                                                    setNewLocation(place.location);
                                                    if (place.source === "academy") {
                                                        if (!newTitle.trim()) setNewTitle(place.name || "");
                                                        if (place.category) setNewCategory(place.category);
                                                        setSelectedPreset(null);
                                                    }
                                                }}
                                                style={{
                                                    padding: "8px 12px",
                                                    borderRadius: "var(--radius-md)",
                                                    border: active ? "2px solid var(--theme-accent)" : "1.5px solid var(--theme-accent-line)",
                                                    background: active ? "var(--theme-accent-soft)" : "var(--hyeni-surface-warm)",
                                                    color: "var(--theme-accent-text)",
                                                    fontSize: 12,
                                                    fontWeight: 700,
                                                    cursor: "pointer",
                                                    fontFamily: FF,
                                                }}
                                            >
                                                {place.emoji} {place.name}
                                                <span style={{ marginLeft: 5, fontSize: 10, fontWeight: 760, opacity: 0.72 }}>{place.badge}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                            {newLocation ? (
                                <div style={{ background: "var(--theme-accent-soft)", borderRadius: "var(--radius-input)", padding: "12px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                                    <div style={{ fontSize: 13, color: "var(--fg-primary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>📍 {newLocation.address}</div>
                                    {isParent ? (
                                        <button onClick={() => { setEditingLocForEvent(null); setShowMapPicker(true); }} style={{ fontSize: 12, padding: "4px 10px", borderRadius: 10, background: "white", border: "1.5px solid var(--theme-accent)", color: "var(--theme-accent-text)", cursor: "pointer", fontWeight: 700, fontFamily: FF, flexShrink: 0 }}>변경</button>
                                    ) : (
                                        <button onClick={() => setNewLocation(null)} style={{ fontSize: 12, padding: "4px 10px", borderRadius: 10, background: "white", border: "1.5px solid var(--line-default)", color: "var(--fg-secondary)", cursor: "pointer", fontWeight: 700, fontFamily: FF, flexShrink: 0 }}>지우기</button>
                                    )}
                                </div>
                            ) : isParent ? (
                                <button onClick={() => { setEditingLocForEvent(null); setShowMapPicker(true); }} style={{ width: "100%", padding: "12px 14px", border: "2px dashed var(--theme-accent-line)", borderRadius: "var(--radius-input)", background: "var(--theme-accent-soft)", color: "var(--theme-accent-text)", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: FF }}>🗺️ 지도에서 장소 선택</button>
                            ) : (
                                <div style={{ background: "var(--status-cautionary-subtle)", color: "var(--status-cautionary-strong)", borderRadius: "var(--radius-input)", padding: "10px 12px", fontSize: 12, fontWeight: 700, fontFamily: FF }}>
                                    부모님이 등록한 장소를 선택하면 일정에 바로 연결돼요
                                </div>
                            )}
                        </div>
                    )}
                    <div style={{ marginBottom: 14 }}><label style={labelSt}>📝 메모 (선택)</label><input style={inputSt} placeholder="준비물, 장소 등..." value={newMemo} onChange={e => setNewMemo(e.target.value)} /></div>
                    {!editingEventId && <div style={{ marginBottom: 14 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                            <label style={{ ...labelSt, marginBottom: 0, flex: 1, display: "inline-flex", alignItems: "center", gap: 4 }}>
                                <ThreeDIcon name="refresh" size={14} aria-label="" /> 매주 같은 날에 반복
                            </label>
                            <div onClick={() => setWeeklyRepeat(p => { const next = !p; if (next) setAddEventEndDateKey(null); return next; })} style={{ width: 52, height: 30, borderRadius: "var(--radius-pill)", background: weeklyRepeat ? "var(--theme-accent)" : "var(--bg-muted)", cursor: "pointer", position: "relative", transition: "background 0.2s" }}>
                                <div style={{ width: 24, height: 24, borderRadius: "var(--radius-pill)", background: "white", position: "absolute", top: 3, left: weeklyRepeat ? 25 : 3, transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.15)" }} />
                            </div>
                        </div>
                        {weeklyRepeat && (
                            <>
                                <div style={{ display: "flex", gap: 6, animation: "kkukFadeIn 0.2s ease", marginBottom: 8 }}>
                                    {[{ w: 4, label: "📅 1개월" }, { w: 8, label: "📅 2개월" }, { w: 12, label: "📅 3개월" }].map(({ w, label }) => (
                                        <button key={w} onClick={() => setRepeatWeeks(w)}
                                            style={{ flex: 1, padding: "8px 0", borderRadius: "var(--radius-input)", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: FF, border: repeatWeeks === w ? "2px solid var(--theme-accent)" : "2px solid var(--bg-muted)", background: repeatWeeks === w ? "var(--theme-accent-soft)" : "var(--bg-subtle)", color: repeatWeeks === w ? "var(--theme-accent-text)" : "var(--fg-secondary)", transition: "all 0.15s" }}>
                                            {label}
                                        </button>
                                    ))}
                                </div>
                                <div style={{ fontSize: 11, color: "var(--fg-tertiary)", fontWeight: 600, textAlign: "center" }}>
                                    {(() => { const [y, m, d] = scheduleDraftDateKey.split("-").map(Number); const end = new Date(y, m, d + (repeatWeeks - 1) * 7); return `${m + 1}/${d} ~ ${end.getMonth() + 1}/${end.getDate()} 매주 ${["일","월","화","수","목","금","토"][new Date(y, m, d).getDay()]}요일`; })()}
                                </div>
                            </>
                        )}
                    </div>}
                    {isParent && pairedChildren.length >= 2 && (
                      <div style={{ marginBottom: 14 }}>
                        <ChildSelector
                          children={pairedChildren}
                          value={eventChildSelection}
                          onChange={setEventChildSelection}
                        />
                      </div>
                    )}
                    {weeklyRepeat && !editingEventId && (
                        <div style={{ fontSize: 12, color: "var(--fg-tertiary)", textAlign: "center", marginTop: "var(--space-2)", fontWeight: "var(--weight-medium)" }}>
                            저장하면 {repeatWeeks === 4 ? "1개월" : repeatWeeks === 8 ? "2개월" : "3개월"}간 매주 같은 요일에 반복돼요
                        </div>
                    )}
                </>
            )}
        </EventSheet>
    );
}

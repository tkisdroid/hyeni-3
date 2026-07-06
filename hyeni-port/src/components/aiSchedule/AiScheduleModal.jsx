// src/components/aiSchedule/AiScheduleModal.jsx
// 음성/이미지/텍스트 입력 → ai-voice-parse Edge Function → 일정 자동 등록.
// Extracted from App.jsx (Phase 5 #4 / B11).

import { useRef, useState } from "react";
import { generateUUID } from "../../lib/auth.js";
import { appToast } from "../../lib/appToast.js";
import { resizeImageFileSafe } from "../../lib/imageResize.js";
import { isApiEnabled, apiPost } from "../../lib/api/client.js";
import { insertEvent, saveEventWithChildren } from "../../lib/sync.js";
import { sendInstantPush } from "../../lib/instantPush.js";
import { getSpeechRecognitionPlugin } from "../../lib/nativePlugins.js";
import { FF, makeSheetStyle, modalBackdropStyle } from "../../lib/styleHelpers.js";
import { SheetGrabber } from "../common/SheetGrabber.jsx";
import { SheetTitleBar } from "../common/SheetTitleBar.jsx";
import { ThreeDIcon } from "../icons/ThreeDIcon.jsx";
import { HyeniMascot } from "../auth/HyeniMascot.jsx";

export function AiScheduleModal({ academies, currentDate, familyId, authUser, events, eventSelection, onSave, onClose, startVoiceFn, onNavigateDate, onCheckScheduleLimit }) {
    const [inputText, setInputText] = useState("");
    const [imageData, setImageData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [voiceListening, setVoiceListening] = useState(false);
    const [results, setResults] = useState(null);
    const [savedIds, setSavedIds] = useState(new Set());
    const photoInputRef = useRef(null);
    const imageInputRef = useRef(null);

    // 사진은 업로드 전에 캔버스로 축소·압축한다(긴 변 1280px / JPEG 0.8). 폰 카메라
    // 원본을 base64 로 그대로 ai-voice-parse 에 보내던 것을 ~90% 줄여 모바일 데이터를
    // 아낀다. 일정·알림장 글자 인식엔 충분하며, 디코드 실패(HEIC 등)면 원본으로 폴백해
    // 등록이 끊기지 않는다.
    const loadAndAnalyzeImage = async (file) => {
        const data = await resizeImageFileSafe(file, { maxEdge: 1280, quality: 0.8 });
        if (!data) return;
        setImageData(data);
        analyze(inputText.trim() || "이미지에서 일정을 추출해주세요", data, { mode: "paste", autoSave: true });
    };

    const handlePaste = (e) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        for (const item of items) {
            if (item.type.startsWith("image/")) {
                e.preventDefault();
                const file = item.getAsFile();
                if (file) void loadAndAnalyzeImage(file);
                return;
            }
        }
    };

    const handleImageSelect = (e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;
        void loadAndAnalyzeImage(file);
    };

    const extractTranscript = (result) => {
        if (!result) return "";
        if (typeof result.transcript === "string") return result.transcript.trim();
        if (Array.isArray(result.matches) && result.matches[0]) return String(result.matches[0]).trim();
        if (Array.isArray(result.value) && result.value[0]) return String(result.value[0]).trim();
        return "";
    };

    const startWebSpeechInput = () => new Promise((resolve) => {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) {
            resolve("");
            return;
        }
        const recognition = new SR();
        recognition.lang = "ko-KR";
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;
        recognition.onresult = (e) => resolve(e.results[0]?.[0]?.transcript || "");
        recognition.onerror = () => resolve("");
        recognition.onend = () => setVoiceListening(false);
        recognition.start();
    });

    const normalizeAiEvents = (data) => {
        if (data?.action === "add_events" && Array.isArray(data.events) && data.events.length > 0) return data.events;
        if (data?.action === "add_event") return [data];
        return [];
    };

    const analyze = async (text, image, options = {}) => {
        const t = text || inputText.trim();
        const img = image || imageData;
        if (!t && !img) return;
        const autoSave = options.autoSave !== false;
        const requestMode = options.mode || "paste";
        setLoading(true);
        setResults(null);
        try {
            const todayEvs = (events || []).map(e => ({ id: e.id, title: e.title, time: e.time, memo: e.memo || "" }));
            const aiReqBody = {
                text: t || "이미지에서 일정을 추출해주세요",
                image: img || undefined,
                mode: requestMode,
                academies: academies.map(a => ({ name: a.name, category: a.category })),
                todayEvents: todayEvs,
                currentDate,
            };
            // Worker(/api/ai/voice-parse) 호출. 실패는 supabase-js FunctionsHttpError 와
            // 동일한 error.context.status 형태로 감싸 아래 401 분기를 그대로 보존한다.
            let data, error;
            if (isApiEnabled()) {
                try { data = await apiPost("/api/ai/voice-parse", aiReqBody); error = null; }
                catch (e) { data = null; error = { context: { status: e?.status ?? 0 } }; }
            }
            if (error) {
                // supabase-js FunctionsHttpError 의 context 는 Response 객체 그 자체다.
                // (error.context.status / error.context.json()) — .response 가 아니다.
                const status = error?.context?.status ?? 0;
                if (status === 401) {
                    setResults({ action: "unknown", message: "로그인이 필요해요. 로그인(또는 다시 로그인) 후 시도해 주세요." });
                } else {
                    console.error("[AiSchedule]", status, error);
                    setResults({ action: "unknown", message: "일정 정리에 실패했어요. 잠시 후 다시 시도해 주세요." });
                }
                return;
            }
            const parsedEvents = normalizeAiEvents(data);
            if (parsedEvents.length > 0) {
                const nextResults = { action: "add_events", events: parsedEvents };
                setResults(nextResults);
                if (autoSave) await saveEventsAndClose(parsedEvents);
            } else {
                setResults({ action: "unknown", message: data?.message || "일정을 찾지 못했어요" });
            }
        } catch (err) {
            console.error("[AiSchedule]", err);
            setResults({ action: "unknown", message: "일정 정리에 실패했어요. 잠시 후 다시 시도해 주세요." });
        } finally { setLoading(false); }
    };

    const startVoiceInput = async () => {
        if (voiceListening || loading) return;
        setVoiceListening(true);
        setResults(null);
        let transcript = "";

        try {
            const SpeechRecognition = await getSpeechRecognitionPlugin();
            if (SpeechRecognition?.start) {
                transcript = extractTranscript(await SpeechRecognition.start({ language: "ko-KR" }));
            }
        } catch (err) {
            console.warn("[AiSchedule] native speech failed:", err?.message || err);
        }

        if (!transcript) {
            transcript = String(await startWebSpeechInput() || "").trim();
        }

        setVoiceListening(false);

        if (!transcript) {
            if (startVoiceFn) {
                onClose();
                startVoiceFn();
                return;
            }
            setResults({ action: "unknown", message: "음성을 인식하지 못했어요" });
            return;
        }

        setInputText(prev => prev ? `${prev}\n${transcript}` : transcript);
        await analyze(transcript, null, { mode: "voice", autoSave: true });
    };

    const CATS = { school: { emoji: "📚", color: "#A78BFA", bg: "#EDE9FE" }, sports: { emoji: "⚽", color: "#34D399", bg: "var(--status-positive-subtle)" }, hobby: { emoji: "🎨", color: "var(--status-cautionary)", bg: "var(--status-cautionary-subtle)" }, family: { emoji: "👨‍👩‍👧", color: "#F87171", bg: "var(--status-negative-subtle)" }, friend: { emoji: "👫", color: "#60A5FA", bg: "var(--bg-subtle)" }, other: { emoji: "📌", color: "#EC4899", bg: "#FCE7F3" } };

    const saveOne = async (ev, idx, options = {}) => {
        if (!options.ignoreSaved && savedIds.has(idx)) return null;
        const cat = CATS[ev.category] || CATS.other;
        const matchedAcademy = ev.academyName ? academies.find(a => a.name === ev.academyName) : null;
        const safeTime = (ev.time && ev.time !== "null") ? ev.time : "09:00";
        const safeMemo = (ev.memo && ev.memo !== "null") ? ev.memo : "";
        const normalizedSelection = {
            familyAll: !!eventSelection?.familyAll,
            childIds: Array.isArray(eventSelection?.childIds) ? eventSelection.childIds.filter(Boolean) : [],
        };
        const scopedEventFields = {
            is_family_event: !!normalizedSelection.familyAll,
            child_ids: normalizedSelection.familyAll ? [] : [...normalizedSelection.childIds],
        };
        const newEv = {
            id: generateUUID(), title: ev.title, time: safeTime,
            category: ev.category || "other", emoji: matchedAcademy?.emoji || cat.emoji,
            color: cat.color, bg: cat.bg, memo: safeMemo,
            location: matchedAcademy?.location || null, notifOverride: null,
            ...scopedEventFields,
        };
        const dk = `${ev.year ?? currentDate.year}-${ev.month ?? currentDate.month}-${ev.day ?? currentDate.day}`;
        onSave(newEv, dk);
        if (familyId && authUser) {
            try {
                if (normalizedSelection.familyAll || normalizedSelection.childIds.length > 0) {
                    await saveEventWithChildren({ ...newEv, dateKey: dk, familyId, userId: authUser.id }, normalizedSelection);
                } else {
                    await insertEvent(newEv, familyId, dk, authUser.id);
                }
                const m = (ev.month ?? currentDate.month) + 1;
                const d = ev.day ?? currentDate.day;
                sendInstantPush({
                    action: "new_event", familyId, senderUserId: authUser.id,
                    title: `새 일정: ${newEv.emoji} ${ev.title}`,
                    message: `${m}월 ${d}일 ${newEv.time}에 "${ev.title}" 일정이 추가됐어요`,
                });
            } catch (err) {
                // 저장(persist)이 실패하면 ✓ 표시(savedIds)를 하지 않고, 사용자에게 명확히 알린다.
                // (이전엔 console.error 만 하고 ✓ 를 찍어 "등록된 것처럼 보이지만 실제로는 저장 실패"하는 silent-failure 였음)
                console.error("[AiSchedule] save error:", err);
                appToast("일정 저장이 잠시 멈췄어요. 다시 시도해 주세요.", "error");
                throw err;
            }
        }
        setSavedIds(prev => new Set([...prev, idx]));
        return { event: newEv, dateKey: dk, source: ev };
    };

    const saveEventsAndClose = async (eventsToSave) => {
        if (!Array.isArray(eventsToSave) || eventsToSave.length === 0) return;
        // 무료 개수 한도 게이트 — 일반 일정 등록(App.jsx addEvent)과 동일 정책. AI 경로로
        // 무료 한도를 우회해 무제한 등록되던 문제를 막는다. 초과 시 페이월 표시 후 저장 중단.
        if (onCheckScheduleLimit && !onCheckScheduleLimit(eventsToSave.length)) return;
        let firstSaved = null;
        try {
            for (let i = 0; i < eventsToSave.length; i++) {
                const saved = await saveOne(eventsToSave[i], i, { ignoreSaved: true });
                if (!firstSaved && saved) firstSaved = saved;
            }
        } catch {
            // saveOne 이 persist 실패 시 throw + appToast 안내. 닫지 않고 결과 화면에 머물러 재시도 가능하게 둔다.
            return;
        }
        if (firstSaved && onNavigateDate) {
            const first = firstSaved.source;
            onNavigateDate(first.year ?? currentDate.year, first.month ?? currentDate.month, first.day ?? currentDate.day);
        }
        onClose();
    };

    const saveAll = async () => {
        if (!results?.events || saving) return;
        setSaving(true);
        try {
            await saveEventsAndClose(results.events);
        } finally {
            setSaving(false);
        }
    };

    const btnSt = { width: 92, height: 100, borderRadius: 22, border: "1px solid var(--line-soft, #F1ECEE)", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, fontFamily: FF, fontWeight: 700, fontSize: 12, background: "var(--bg-card, #FFFFFF)", color: "var(--fg-primary, #202024)", boxShadow: "var(--shadow-soft, 0 6px 16px rgba(31,24,28,0.06))" };

    return (
        <div style={{ position: "fixed", inset: 0, ...modalBackdropStyle, display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 900, fontFamily: FF }}
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div data-sheet-drag-root="true" style={makeSheetStyle({ padding: "0 20px calc(env(safe-area-inset-bottom, 0px) + 44px)", width: "100%", maxWidth: 460, maxHeight: "calc(100dvh - 72px)", overflowY: "auto" })}>
                <SheetGrabber onClose={onClose} label="AI 일정등록 시트 아래로 접기" />
                <SheetTitleBar
                    title="AI 일정등록"
                    subtitle="사진, 말, 텍스트로 일정 만들기"
                    iconName="menu-ai-schedule"
                    rightAction={(
                        <button
                            type="button"
                            aria-label="닫기"
                            onClick={onClose}
                            style={{
                                minWidth: 44,
                                minHeight: 44,
                                padding: "0 12px",
                                borderRadius: 14,
                                border: "1px solid var(--line-soft)",
                                background: "var(--bg-card)",
                                color: "var(--fg-secondary)",
                                fontFamily: FF,
                                fontSize: 13,
                                fontWeight: 760,
                                cursor: "pointer",
                                boxShadow: "var(--shadow-xs)",
                            }}
                        >
                            닫기
                        </button>
                    )}
                />

                {/* 3가지 입력 방식 버튼 */}
                {!results && !loading && (
                    <div style={{ display: "flex", justifyContent: "center", gap: 14, marginTop: 2, marginBottom: 18 }}>
                        <button onClick={startVoiceInput}
                            style={{
                                ...btnSt,
                                borderColor: voiceListening ? "var(--brand-lavender, #A78BFA)" : "var(--line-soft, #F1ECEE)",
                                background: voiceListening ? "var(--brand-lavender-soft, #EFE8FF)" : "var(--bg-card, #FFFFFF)",
                                animation: voiceListening ? "pulse 1s infinite" : "none",
                            }}>
                            <ThreeDIcon name="mic-lavender" size={44} aria-label="" />
                            <span>{voiceListening ? "듣는 중..." : "말하기"}</span>
                        </button>
                        <button onClick={() => photoInputRef.current?.click()} style={btnSt}>
                            <ThreeDIcon name="camera-rose" size={44} aria-label="" />
                            <span>사진</span>
                        </button>
                        <input ref={photoInputRef} type="file" accept="image/*" capture="environment" onChange={handleImageSelect} style={{ display: "none" }} />
                        <button onClick={() => imageInputRef.current?.click()} style={btnSt}>
                            <ThreeDIcon name="note" size={44} aria-label="" />
                            <span>이미지</span>
                        </button>
                        <input ref={imageInputRef} type="file" accept="image/*" onChange={handleImageSelect} style={{ display: "none" }} />
                    </div>
                )}

                {/* 텍스트 입력 */}
                <textarea id="ai-text-input"
                    aria-label="AI 일정 텍스트 입력"
                    value={inputText} onChange={e => setInputText(e.target.value)}
                    onPaste={handlePaste}
                    placeholder="카톡 공지, 알림장 등을 붙여넣거나 직접 입력하세요..."
                    style={{ width: "100%", minHeight: 80, padding: 12, borderRadius: 14, border: "2px solid var(--line-soft)", fontSize: 16, fontFamily: FF, resize: "none", boxSizing: "border-box", outline: "none" }}
                />

                {/* 이미지 미리보기 */}
                {imageData && (
                    <div style={{ marginTop: 8, position: "relative", display: "inline-block" }}>
                        <img src={imageData} alt="첨부 이미지" style={{ maxWidth: "100%", maxHeight: 160, borderRadius: 12, border: "2px solid var(--line-soft)" }} />
                        {/* 첨부 취소는 위험 동작이 아님 — 빨강 대신 중립 (spec §5.3) */}
                        <button onClick={() => setImageData(null)} aria-label="이미지 제거" style={{ position: "absolute", top: -16, right: -16, width: 44, height: 44, minHeight: 44, padding: 0, borderRadius: "50%", background: "transparent", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><span aria-hidden="true" style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--bg-muted)", color: "var(--fg-secondary)", border: "1px solid var(--line-soft)", fontSize: 14, fontWeight: 700, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</span></button>
                    </div>
                )}

                {/* 분석 버튼 */}
                <button onClick={() => analyze()} disabled={loading || (!inputText.trim() && !imageData)}
                    style={{ width: "100%", marginTop: 10, padding: "14px 16px", borderRadius: 16, border: "none", fontSize: 15, fontWeight: 760, cursor: "pointer", fontFamily: FF, color: "white", background: loading ? "var(--fg-tertiary)" : "var(--hyeni-theme-gradient)", boxShadow: loading ? "none" : "var(--hyeni-theme-shadow-soft)" }}>
                    {loading ? "🔍 일정을 정리하고 있어요..." : "✅ 다 입력했어요^^"}
                </button>

                {/* 분석 진행 중 — 결과 영역에 진행 비주얼 노출 (async-7) */}
                {loading && (
                    <div className="hyeni-thinking-card" style={{ marginTop: 16, textAlign: "center", padding: 20, background: "var(--theme-accent-soft)", borderRadius: 16 }}>
                        <div style={{ marginBottom: 8, display: "flex", justifyContent: "center" }}>
                            <HyeniMascot variant="thinking" size={72} aria-label="" />
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--fg-primary)", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                            <span>잠깐만요, 일정을 정리하고 있어요</span>
                            <span className="hyeni-thinking-dots" aria-hidden="true"><span /><span /><span /></span>
                        </div>
                        <div style={{ fontSize: 12, color: "var(--fg-secondary)", marginTop: 4 }}>금방 정리해서 보여드릴게요</div>
                    </div>
                )}

                {/* Results */}
                {!loading && results && results.action === "add_events" && results.events?.length > 0 && (
                    <div style={{ marginTop: 20 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--fg-primary)" }}>📋 정리된 일정 ({results.events.length}건)</div>
                            <button onClick={saveAll} disabled={saving} style={{ minHeight: 44, padding: "8px 16px", borderRadius: 12, background: saving ? "var(--bg-muted)" : "var(--brand-mint-deep)", color: saving ? "var(--fg-secondary)" : "white", border: "none", fontSize: 12, fontWeight: 700, cursor: saving ? "default" : "pointer", fontFamily: FF }}>{saving ? "등록 중…" : "모두 등록"}</button>
                        </div>
                        {results.events.map((ev, i) => {
                            const cat = CATS[ev.category] || CATS.other;
                            const saved = savedIds.has(i);
                            const m = ev.month != null ? ev.month + 1 : (currentDate.month + 1);
                            const d = ev.day ?? currentDate.day;
                            return (
                                <div key={i} style={{ background: saved ? "var(--status-positive-subtle)" : "var(--theme-accent-soft)", borderRadius: 16, padding: "12px 14px", marginBottom: 8, border: saved ? "2px solid var(--status-positive)" : "1.5px solid var(--theme-accent-line)", opacity: saved ? 0.7 : 1 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                        <div style={{ fontSize: 24 }}>{cat.emoji}</div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontWeight: 700, fontSize: 14, color: "var(--fg-primary)" }}>{ev.title}</div>
                                            <div style={{ fontSize: 12, color: "var(--fg-secondary)", marginTop: 2 }}>
                                                {m}월 {d}일 {(ev.time && ev.time !== "null") ? ev.time : "시간 미정"}
                                                {ev.memo && ev.memo !== "null" && ` · ${ev.memo}`}
                                            </div>
                                        </div>
                                        <button onClick={async () => {
                                            if (onCheckScheduleLimit && !onCheckScheduleLimit(1)) return;
                                            try {
                                                await saveOne(ev, i);
                                            } catch {
                                                // persist 실패 시 saveOne 이 appToast 안내. 닫지 않고 머물러 재시도 가능.
                                                return;
                                            }
                                            if (onNavigateDate) onNavigateDate(ev.year ?? currentDate.year, ev.month ?? currentDate.month, ev.day ?? currentDate.day);
                                            onClose();
                                        }} disabled={saved || saving}
                                            style={{ minHeight: 44, minWidth: 52, padding: "8px 14px", borderRadius: 12, background: saved ? "var(--status-positive-subtle)" : "var(--hyeni-theme-gradient)", color: saved ? "var(--status-positive-strong)" : "white", border: "none", fontSize: 11, fontWeight: 700, cursor: saved ? "default" : "pointer", fontFamily: FF, flexShrink: 0 }}>
                                            {saved ? "✓" : "등록"}
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
                {!loading && results && results.action === "unknown" && (
                    <div style={{ marginTop: 16, textAlign: "center", padding: 20, background: "var(--status-cautionary-subtle)", borderRadius: 16 }}>
                        <div style={{ marginBottom: 8, display: "flex", justifyContent: "center" }}>
                            <HyeniMascot variant="thinking" size={72} aria-label="" />
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--status-cautionary-strong)" }}>{results.message}</div>
                    </div>
                )}
            </div>
        </div>
    );
}

// src/components/memo/MemoSection.jsx
// 인라인 메모 섹션 — 일정 timetable 안에서 부모/자녀가 짧은 메시지를 주고받는 chat bubble.
// Extracted from App.jsx (Phase 5 #4 / B8).

import { useEffect, useMemo, useRef, useState } from "react";
import { buildMessageItems, getMemoTime } from "../../lib/memoTime.js";
import { FF } from "../../lib/styleHelpers.js";
import { deferEffectStateUpdate } from "../../lib/deferEffectStateUpdate.js";
import { ThreeDIcon } from "../icons/ThreeDIcon.jsx";

export function MemoSection({ replies, onReplySubmit, readBy, myUserId, isParentMode, onReplyRef }) {
    /* UI-SPEC §5 — composer state */
    const [inputText, setInputText] = useState("");
    const [isFocused, setIsFocused] = useState(false);

    /* UI-SPEC §7 — send-failure toast state (Option A: onReplySubmit returns Promise) */
    const [showSendFailureToast, setShowSendFailureToast] = useState(false);
    const [lastFailedText, setLastFailedText] = useState(null);
    const sendFailureTimerRef = useRef(null);

    /* UI-SPEC §6 — one-time onboarding toast */
    const [showOnboardingToast, setShowOnboardingToast] = useState(false);
    const onboardingTimerRef = useRef(null);

    /* UI-SPEC §4f — known-IDs set to detect new bubbles for animation */
    const seenIdsRef = useRef(new Set());
    const [animatedReplyIds, setAnimatedReplyIds] = useState(() => new Set());

    /* UI-SPEC §Interaction — container ref for scroll-to-bottom */
    const containerRef = useRef(null);
    const prevRepliesLenRef = useRef(0);

    /* UI-SPEC §4f — prefers-reduced-motion */
    const prefersReducedMotion = useMemo(() =>
        typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    []);

    /* UI-SPEC §5 — mobile detection for Enter key handling */
    const isMobile = typeof navigator !== "undefined" &&
        (/Android|iPhone|iPad/i.test(navigator.userAgent) ||
         (typeof window !== "undefined" && window.Capacitor !== undefined));

    /* UI-SPEC §6 — onboarding toast: show once on first mount */
    useEffect(() => {
        const cancelToast = !localStorage.getItem("memoOnboardingV2Seen")
            ? deferEffectStateUpdate(() => {
                setShowOnboardingToast(true);
                localStorage.setItem("memoOnboardingV2Seen", "1");
                onboardingTimerRef.current = setTimeout(() => setShowOnboardingToast(false), 4000);
            })
            : null;
        return () => {
            cancelToast?.();
            if (onboardingTimerRef.current) clearTimeout(onboardingTimerRef.current);
        };
    }, []);

    useEffect(() => {
        const nextIds = (replies || [])
            .map((reply) => reply?.id)
            .filter(Boolean)
            .filter((id) => !seenIdsRef.current.has(id));
        if (nextIds.length === 0) return undefined;
        return deferEffectStateUpdate(() => {
            nextIds.forEach((id) => seenIdsRef.current.add(id));
            setAnimatedReplyIds(new Set(nextIds));
        });
    }, [replies]);

    /* UI-SPEC §Interaction §Scroll-to-Bottom — scroll on new message */
    useEffect(() => {
        const newLen = (replies || []).length;
        if (newLen > prevRepliesLenRef.current && containerRef.current) {
            containerRef.current.scrollIntoView({
                behavior: prefersReducedMotion ? "instant" : "smooth",
                block: "end"
            });
        }
        prevRepliesLenRef.current = newLen;
    }, [replies, prefersReducedMotion]);

    const othersRead = (readBy || []).filter(id => id !== myUserId).length > 0;
    const hasMessages = (replies && replies.length > 0);

    /* UI-SPEC §5 — handleSend with error catch for send-failure toast */
    const handleSend = (textOverride) => {
        const text = typeof textOverride === "string" ? textOverride : inputText.trim();
        if (!text) return;
        if (typeof textOverride !== "string") setInputText("");
        const result = onReplySubmit ? onReplySubmit(text) : null;
        if (result && typeof result.catch === "function") {
            result.catch(err => {
                console.error("[MemoSection] send failed", err);
                /* UI-SPEC §7 — show send-failure toast and keep text for retry */
                setLastFailedText(text);
                setShowSendFailureToast(true);
                if (sendFailureTimerRef.current) clearTimeout(sendFailureTimerRef.current);
                sendFailureTimerRef.current = setTimeout(() => setShowSendFailureToast(false), 5000);
            });
        }
    };

    /* UI-SPEC §7 — retry handler */
    const handleRetry = () => {
        setShowSendFailureToast(false);
        if (lastFailedText) handleSend(lastFailedText);
    };

    /* UI-SPEC §4b — build grouped message items */
    const messageItems = buildMessageItems(replies || []);

    return (
        <>
        {/* UI-SPEC §4f — keyframe animation style tag (idempotent) */}
        <style id="memo-bubble-anim">{`
            @keyframes bubbleIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
            @keyframes toastIn { from { opacity: 0; transform: translateX(-50%) translateY(8px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
            @media (prefers-reduced-motion: reduce) { .memo-bubble-animate { animation: none !important; } }
        `}</style>

        {/* UI-SPEC §1 — MemoSection container */}
        <div ref={containerRef} style={{ marginTop: 18, background: "white", borderRadius: 20, padding: 0, border: "1.5px solid var(--theme-accent-line)", overflow: "hidden", boxShadow: "var(--hyeni-theme-shadow-soft)" }}>

            {/* UI-SPEC §2 — Header bar */}
            <div style={{ padding: "14px 18px", background: "linear-gradient(135deg,var(--theme-accent-soft),var(--hyeni-surface-warm))", borderBottom: "1px solid var(--theme-accent-line)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                {/* UI-SPEC §2 — section title: fontSize 14, fontWeight 700 (corrected from 800) */}
                <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 17, fontWeight: 760, color: "var(--theme-accent-text)", letterSpacing: 0 }}><ThreeDIcon name="chat-heart" size={20} aria-label="" /> {isParentMode ? "아이와 대화하기" : "부모님에게 이야기하기"}</div>
                {/* UI-SPEC §2 — conditional ✓ 읽음 badge */}
                {hasMessages && othersRead && (
                    <div style={{ fontSize: 12, color: "var(--theme-accent-text)", fontWeight: 700, background: "var(--theme-accent-soft)", border: "1px solid var(--theme-accent-line)", borderRadius: 999, padding: "4px 10px" }}>✓ 읽음</div>
                )}
            </div>

            {/* UI-SPEC §4 — Chat bubble area */}
            <div
                role="log"
                aria-live="polite"
                aria-label={isParentMode ? "아이와 대화하기 대화" : "부모님에게 이야기하기 대화"}
                style={{ padding: "12px 16px", minHeight: 60 }}
            >
                {/* UI-SPEC §4g — empty state when no messages */}
                {!hasMessages ? (
                    <div style={{ textAlign: "center", padding: "28px 16px", color: "var(--fg-tertiary)" }}>
                        <div style={{ fontSize: 36, marginBottom: 10 }}>💗</div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: "var(--theme-accent-text)", marginBottom: 4 }}>아직 주고받은 메시지가 없어요</div>
                        <div style={{ fontSize: 14, color: "var(--fg-secondary)", fontWeight: 600 }}>
                            {isParentMode ? "아이에게 첫 메시지를 남겨보세요 💗" : "부모님께 오늘 하루를 전해봐~ 🐰"}
                        </div>
                    </div>
                ) : (
                    messageItems.map(item => {
                        if (item.type === "separator") {
                            /* UI-SPEC §4a — date separator pill */
                            return (
                                <div
                                    key={item.key}
                                    role="separator"
                                    aria-label={item.label}
                                    style={{ display: "flex", alignItems: "center", margin: "8px 0" }}
                                >
                                    <hr style={{ flex: 1, border: "none", borderTop: "1px solid var(--line-soft)", margin: 0 }} />
                                    <span style={{ padding: "3px 12px", borderRadius: 99, background: "var(--bg-muted)", fontSize: 10, color: "var(--fg-tertiary)", fontWeight: 700, margin: "0 8px", whiteSpace: "nowrap" }}>
                                        {item.label}
                                    </span>
                                    <hr style={{ flex: 1, border: "none", borderTop: "1px solid var(--line-soft)", margin: 0 }} />
                                </div>
                            );
                        }

                        /* UI-SPEC §4b — bubble item */
                        const { r, isFirstInGroup, isLastInGroup } = item;
                        const isLegacy = r.origin === "legacy_memo" || r.user_role === "legacy";
                        const isMe = !isLegacy && r.user_id === myUserId;

                        /* UI-SPEC §4c — avatar colors per role */
                        const avatarBg = isLegacy ? "var(--status-cautionary-subtle)" : (r.user_role === "parent" ? "var(--bg-subtle)" : "var(--theme-accent-soft)");
                        const avatarGlyph = isLegacy ? "👶" : (r.user_role === "parent" ? "👩" : "🐰");

                        /* UI-SPEC §4d — bubble colors and border-radius */
                        const bubbleBg = isLegacy ? "var(--status-cautionary-subtle)" : (isMe ? "var(--theme-accent)" : "var(--bg-muted)");
                        const bubbleColor = isLegacy ? "var(--status-cautionary-strong)" : (isMe ? "#FFFFFF" : "var(--fg-primary)");
                        const bubbleRadius = isLegacy ? "12px" : (isMe ? "16px 4px 16px 16px" : "4px 16px 16px 16px");

                        /* UI-SPEC §4f — animation for new bubbles */
                        const isNew = animatedReplyIds.has(r.id);
                        const animStyle = isNew && !prefersReducedMotion
                            ? { animation: "bubbleIn 150ms ease-out forwards" }
                            : {};

                        /* UI-SPEC §Accessibility — aria-label for bubble */
                        const senderLabel = isMe ? "나" : isLegacy ? "예전 메모" : (r.user_role === "parent" ? "부모님" : "아이");
                        const relTime = getMemoTime(r.created_at);
                        const bubbleAriaLabel = `${senderLabel} ${relTime}에 보낸 메시지: ${r.content}`;

                        return (
                            <div
                                key={r.id}
                                role="article"
                                aria-label={bubbleAriaLabel}
                                data-memo-reply-id={r.id}
                                ref={el => { if (el && !isLegacy && onReplyRef) onReplyRef(el, r.id); }}
                                className={isNew && !prefersReducedMotion ? "memo-bubble-animate" : ""}
                                style={{
                                    display: "flex",
                                    gap: 8,
                                    /* UI-SPEC §4b — marginBottom: 12px last of group, 4px middle */
                                    marginBottom: isLastInGroup ? 12 : 4,
                                    flexDirection: isMe ? "row-reverse" : "row",
                                    alignItems: "flex-start",
                                    ...animStyle
                                }}
                            >
                                {/* UI-SPEC §4c — avatar on first bubble, spacer on subsequent */}
                                {isFirstInGroup ? (
                                    <div style={{ width: 28, height: 28, borderRadius: 14, background: avatarBg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>
                                        {avatarGlyph}
                                    </div>
                                ) : (
                                    <div style={{ width: 28, flexShrink: 0 }} aria-hidden="true" />
                                )}

                                <div style={{ maxWidth: "75%" }}>
                                    {/* UI-SPEC §4d — legacy "예전 메모" label */}
                                    {isLegacy && (
                                        <div style={{ fontSize: 10, color: "var(--status-cautionary-strong)", marginBottom: 3, fontWeight: 700 }}>예전 메모</div>
                                    )}

                                    {/* UI-SPEC §4d — bubble body */}
                                    <div style={{
                                        background: bubbleBg,
                                        color: bubbleColor,
                                        borderRadius: bubbleRadius,
                                        padding: "11px 15px",
                                        fontSize: 15,
                                        lineHeight: 1.5,
                                        fontFamily: FF,
                                        whiteSpace: "pre-wrap",
                                        wordBreak: "keep-all",
                                        overflowWrap: "break-word",
                                        border: isLegacy ? "1px dashed var(--status-caution)" : "none"
                                    }}>
                                        {r.content}
                                    </div>

                                    {/* UI-SPEC §4e — timestamp on last bubble of group only */}
                                    {isLastInGroup && (
                                        <div style={{ fontSize: 11, color: "var(--fg-tertiary)", marginTop: 5, textAlign: isMe ? "right" : "left", fontWeight: 600 }}>
                                            {relTime}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* UI-SPEC §5 — Composer bar */}
            <div style={{
                padding: "10px 12px",
                paddingBottom: "max(10px, env(safe-area-inset-bottom))",
                borderTop: "1px solid var(--bg-muted)",
                display: "flex",
                gap: 8,
                alignItems: "center",
                background: "var(--bg-subtle)"
            }}>
                {/* UI-SPEC §5 — composer input: fontSize 16 prevents iOS auto-zoom */}
                <input
                    type="text"
                    aria-label={isParentMode ? "대화 입력" : "이야기 입력"}
                    aria-required="false"
                    autoComplete="off"
                    autoCorrect="on"
                    spellCheck="true"
                    placeholder={isParentMode ? "메시지를 입력하세요..." : "답글을 남겨봐~ 🐰"}
                    value={inputText}
                    onChange={e => setInputText(e.target.value)}
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setIsFocused(false)}
                    onKeyDown={e => {
                        /* UI-SPEC §5 — desktop Enter=send, mobile Enter=newline */
                        if (e.key === "Enter" && !isMobile) { e.preventDefault(); handleSend(); }
                    }}
                    style={{
                        flex: 1,
                        border: `1.5px solid ${isFocused ? "var(--theme-accent)" : "var(--line-soft)"}`,
                        borderRadius: 22,
                        padding: "11px 16px",
                        fontSize: 16,
                        fontFamily: FF,
                        fontWeight: 600,
                        outline: "none",
                        background: "white",
                        boxSizing: "border-box",
                        color: "var(--fg-primary)"
                    }}
                />
                {/* UI-SPEC §5 — send button: 44x44 touch target */}
                <button
                    type="button"
                    aria-label="메시지 보내기"
                    onClick={() => handleSend()}
                    style={{
                        width: 44,
                        height: 44,
                        borderRadius: 22,
                        /* UI-SPEC §5 — active gradient vs. inactive grey */
                        background: inputText.trim()
                            ? "var(--hyeni-theme-gradient)"
                            : "var(--bg-muted)",
                        color: "white",
                        border: "none",
                        cursor: inputText.trim() ? "pointer" : "default",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 18,
                        flexShrink: 0,
                        transition: "background 0.2s ease"
                    }}>
                    ↑
                </button>
            </div>
        </div>

        {/* UI-SPEC §6 — one-time onboarding toast */}
        {showOnboardingToast && (
            <div
                role="status"
                aria-live="polite"
                aria-label="대화 화면이 새로워졌어요"
                style={{
                    position: "fixed",
                    bottom: "max(80px, calc(80px + env(safe-area-inset-bottom)))",
                    left: "50%",
                    transform: "translateX(-50%)",
                    background: "var(--theme-accent)",
                    color: "#FFFFFF",
                    borderRadius: 24,
                    padding: "12px 20px",
                    fontSize: 14,
                    fontWeight: 700,
                    fontFamily: FF,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    boxShadow: "var(--hyeni-theme-shadow-soft)",
                    whiteSpace: "nowrap",
                    zIndex: 9999,
                    animation: prefersReducedMotion ? "none" : "toastIn 200ms ease-out forwards"
                }}
            >
                대화 화면이 새로워졌어요 ✨
                <button
                    type="button"
                    aria-label="대화 안내 숨김"
                    onClick={() => { setShowOnboardingToast(false); if (onboardingTimerRef.current) clearTimeout(onboardingTimerRef.current); }}
                    style={{ background: "transparent", border: "none", color: "white", fontSize: 16, cursor: "pointer", padding: "0 0 0 4px", lineHeight: 1, minWidth: 24, minHeight: 24 }}
                >
                    ×
                </button>
            </div>
        )}

        {/* UI-SPEC §7 — send-failure toast */}
        {showSendFailureToast && (
            <div
                role="alert"
                aria-live="assertive"
                aria-label="메시지 전송 실패"
                style={{
                    position: "fixed",
                    bottom: "max(80px, calc(80px + env(safe-area-inset-bottom)))",
                    left: "50%",
                    transform: "translateX(-50%)",
                    background: "var(--status-cautionary-subtle)",
                    color: "var(--status-cautionary-strong)",
                    borderRadius: 24,
                    padding: "12px 20px",
                    fontSize: 14,
                    fontWeight: 700,
                    fontFamily: FF,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    boxShadow: "0 4px 16px rgba(146,64,14,0.15)",
                    whiteSpace: "nowrap",
                    zIndex: 9999
                }}
            >
                메시지 전송에 실패했어요. 다시 시도해 주세요.
                <button
                    type="button"
                    aria-label="메시지 전송 다시 시도"
                    onClick={handleRetry}
                    className="btn btn-sm btn-secondary"
                    style={{ marginLeft: 8 }}
                >
                    다시 시도
                </button>
                <button
                    type="button"
                    aria-label="전송 실패 숨김"
                    onClick={() => { setShowSendFailureToast(false); if (sendFailureTimerRef.current) clearTimeout(sendFailureTimerRef.current); }}
                    style={{ background: "transparent", border: "none", color: "var(--status-cautionary-strong)", fontSize: 16, cursor: "pointer", padding: "0 0 0 4px", lineHeight: 1, minWidth: 24, minHeight: 24 }}
                >
                    ×
                </button>
            </div>
        )}
        </>
    );
}

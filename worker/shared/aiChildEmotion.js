const EMOTIONS = new Set([
    "idle",
    "listening",
    "thinking",
    "happy",
    "love",
    "celebrate",
    "sad",
    "worried",
    "pondering",
]);

export function inferChildAiEmotion({ userText = "", reply = "", intent = "", toolName = "" } = {}) {
    const blob = `${String(userText || "")} ${String(reply || "")}`;
    const name = String(toolName || "");
    const detected = String(intent || "");

    if (detected === "safety_risk") return "worried";
    if (detected === "emotional_support") {
        return /슬프|속상|외로|울었|화났|짜증/.test(blob) ? "sad" : "love";
    }
    if (
        name === "createSchedule"
        || name === "createDailyItem"
        || name === "setChildAccent"
        || detected === "schedule_create"
        || detected === "daily_item_create"
        || detected === "settings_accent"
    ) {
        return "celebrate";
    }
    if (detected === "schedule_delete_parent_only" || detected === "parent_locked_setting") return "pondering";
    if (/사랑|보고 싶|고마워|최고/.test(blob)) return "love";
    if (/슬프|속상|외로|울었/.test(blob)) return "sad";
    if (/신나|축하|해냈다|완료|추가했어/.test(blob)) return "celebrate";
    if (EMOTIONS.has(detected)) return detected;
    return "happy";
}

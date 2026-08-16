export function shouldBypassAiCreditLimit({ safety = null } = {}) {
    const riskLevel = String(safety?.riskLevel || "none");
    return riskLevel === "medium" || riskLevel === "high";
}

/** 아이가 자기 설정을 바꾸는 도구 — LLM 을 쓰지 않으므로 대화 횟수를 깎지 않는다. */
const FREE_CHILD_SETTINGS_TOOLS = new Set([
    "updateNotificationSettings",
    "updateAiFriendName",
    "changeAppTheme",
]);

export function shouldChargeForAiTurn({ detectedIntent = "", toolResult = null, safety = null } = {}) {
    if (
        detectedIntent === "parent_forbidden_topic"
        || detectedIntent === "parent_allowed_topic_restriction"
        || detectedIntent === "external_contact_rejected"
        || detectedIntent === "parent_tool_disabled"
        // 못 해 주겠다고 안내만 한 turn 은 아이의 대화 횟수를 쓰지 않는다.
        || detectedIntent === "schedule_delete_parent_only"
        || detectedIntent === "notification_settings_parent_only"
    ) return false;
    const riskLevel = String(safety?.riskLevel || "none");
    if (riskLevel === "medium" || riskLevel === "high") return false;
    if (toolResult && toolResult.ok === false) return false;
    if (toolResult && toolResult.ok === true && FREE_CHILD_SETTINGS_TOOLS.has(String(toolResult.toolName || ""))) {
        return false;
    }
    return true;
}

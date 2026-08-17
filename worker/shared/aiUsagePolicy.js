export function shouldBypassAiCreditLimit({ safety = null } = {}) {
    const riskLevel = String(safety?.riskLevel || "none");
    return riskLevel === "medium" || riskLevel === "high";
}

/**
 * LLM 을 거치지 않고 서버가 결정적으로 답하는 도구 — 대화 횟수를 깎지 않는다.
 *
 * 라우트의 `isChildSettingsToolResult`·`isScheduleLookupToolResult` 분기와 같은 목록이어야 한다.
 * 일정 조회는 원가가 0인데도 크레딧을 깎고 있었다(2026-08-17 실측: 응답은 서버 문구인데
 * `creditCharged:true`). "오늘 일정 뭐야?" 한 마디에 하루 5번뿐인 무료 대화를 쓰게 하지 않는다.
 */
const FREE_DETERMINISTIC_TOOLS = new Set([
    "updateNotificationSettings",
    "updateAiFriendName",
    "changeAppTheme",
    "getTodaySchedule",
    "getScheduleByDate",
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
    if (toolResult && toolResult.ok === true && FREE_DETERMINISTIC_TOOLS.has(String(toolResult.toolName || ""))) {
        return false;
    }
    return true;
}

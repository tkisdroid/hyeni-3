export function shouldBypassAiCreditLimit({ safety = null } = {}) {
    const riskLevel = String(safety?.riskLevel || "none");
    return riskLevel === "medium" || riskLevel === "high";
}

export function shouldChargeForAiTurn({ detectedIntent = "", toolResult = null, safety = null } = {}) {
    if (
        detectedIntent === "parent_forbidden_topic"
        || detectedIntent === "parent_allowed_topic_restriction"
        || detectedIntent === "external_contact_rejected"
        || detectedIntent === "parent_tool_disabled"
        || detectedIntent === "schedule_delete_parent_only"
        || detectedIntent === "parent_locked_setting"
    ) return false;
    const riskLevel = String(safety?.riskLevel || "none");
    if (riskLevel === "medium" || riskLevel === "high") return false;
    if (toolResult && toolResult.ok === false) return false;
    return true;
}

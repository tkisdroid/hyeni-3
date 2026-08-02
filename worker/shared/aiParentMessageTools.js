const VALID_PARENT_ROLES = new Set(["mom", "dad", "guardian"]);

function redactSensitivePersonalInfo(message) {
    return String(message || "")
        .replace(/01[016789][-\s]?\d{3,4}[-\s]?\d{4}/g, "[개인정보]")
        .replace(/((?:집\s*)?주소(?:는|가|를|:)?\s*)[가-힣A-Za-z0-9\s-]{2,40}/g, "$1[개인정보]")
        .replace(/(우리\s*집(?:은|는|이|가|:)?\s*)[가-힣A-Za-z0-9\s-]{2,40}/g, "$1[개인정보]")
        .replace(/(학교\s*이름(?:은|는|이|가|:)?\s*)[가-힣A-Za-z0-9\s-]{2,30}/g, "$1[개인정보]")
        .replace(/(우리\s*학교(?:은|는|이|가|:)?\s*)[가-힣A-Za-z0-9\s-]{2,40}/g, "$1[개인정보]")
        .replace(/[가-힣A-Za-z0-9]{2,30}(?:초등학교|중학교|고등학교|유치원)/g, "[개인정보]");
}

export function sanitizeChildParentMessage(value) {
    const message = redactSensitivePersonalInfo(value)
        .replace(/\s+/g, " ")
        .trim();
    if (!message || message.length > 200) return "";
    return message;
}

export function buildParentMessageAlert({
    familyId,
    childUserId,
    childName = "",
    parentRole = "guardian",
    message,
} = {}) {
    const safeMessage = sanitizeChildParentMessage(message);
    if (!familyId || !childUserId || !safeMessage) return null;
    const safeParentRole = VALID_PARENT_ROLES.has(parentRole) ? parentRole : "guardian";
    const displayName = String(childName || "").trim() || "아이";
    return {
        family_id: familyId,
        alert_type: "ai_child_message",
        title: "AI 친구 메시지",
        message: `${displayName}: ${safeMessage}`,
        severity: "info",
        metadata: {
            child_user_id: childUserId,
            parent_role: safeParentRole,
        },
    };
}

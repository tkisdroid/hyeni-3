const RISK_RANK = {
    none: 0,
    low: 1,
    medium: 2,
    high: 3,
};

const SENSITIVITY_THRESHOLD = {
    off: 4,
    low: 3,
    medium: 2,
    high: 1,
};

function normalizeRiskLevel(value) {
    return Object.prototype.hasOwnProperty.call(RISK_RANK, value) ? value : "none";
}

function normalizeSensitivity(value) {
    return Object.prototype.hasOwnProperty.call(SENSITIVITY_THRESHOLD, value) ? value : "medium";
}

function severityForAlert(riskLevel) {
    if (riskLevel === "high") return "urgent";
    if (riskLevel === "medium") return "warning";
    return "info";
}

function eventTypeForReason(reason) {
    const value = String(reason || "").trim();
    return value || "ai_safety_signal";
}

const REASON_LABELS = {
    self_harm_signal: "스스로를 힘들어하는 신호",
    possible_harm_signal: "다칠 수 있는 상황 신호",
    ai_safety_signal: "확인이 필요한 안전 신호",
};
function reasonLabel(reason) {
    const key = String(reason || "").trim();
    return REASON_LABELS[key] || "확인이 필요한 안전 신호";
}

function summaryForRisk({ childName, riskLevel, reason }) {
    const name = String(childName || "").trim() || "아이";
    if (riskLevel === "high") {
        return `${name}님의 AI 친구 대화에서 즉시 확인이 필요한 안전 신호가 감지됐어요. 이유: ${reasonLabel(reason)}`;
    }
    if (riskLevel === "medium") {
        return `${name}님의 AI 친구 대화에서 보호자 확인이 필요한 신호가 감지됐어요. 이유: ${reasonLabel(reason)}`;
    }
    return `${name}님의 AI 친구 대화에서 정서 신호가 감지됐어요. 이유: ${reasonLabel(reason)}`;
}

export function shouldNotifyForRisk(riskLevel, sensitivity = "medium") {
    const risk = normalizeRiskLevel(riskLevel);
    if (risk === "high") return true;
    const threshold = SENSITIVITY_THRESHOLD[normalizeSensitivity(sensitivity)];
    return RISK_RANK[risk] >= threshold;
}

export function buildSafetyEventAndAlert({
    familyId,
    childUserId,
    childName = "",
    riskLevel,
    reason,
    sensitivity = "medium",
} = {}) {
    const severity = normalizeRiskLevel(riskLevel);
    const eventType = eventTypeForReason(reason);
    const summary = summaryForRisk({ childName, riskLevel: severity, reason: eventType });
    const shouldNotifyParent = shouldNotifyForRisk(severity, sensitivity);
    const safetyEvent = {
        family_id: familyId,
        child_user_id: childUserId,
        severity,
        event_type: eventType,
        summary,
        parent_notified: false,
    };
    const parentAlert = shouldNotifyParent ? {
        family_id: familyId,
        alert_type: "ai_safety",
        title: "AI 친구 안전 알림",
        message: summary,
        severity: severityForAlert(severity),
        metadata: {
            child_user_id: childUserId,
            risk_level: severity,
            reason: eventType,
        },
    } : null;

    return {
        shouldNotifyParent,
        safetyEvent,
        parentAlert,
    };
}

export function ensureChildSafetyReply(reply, {
    riskLevel = "none",
    parentNotified = false,
} = {}) {
    const severity = normalizeRiskLevel(riskLevel);
    const text = String(reply || "").trim() || "네 마음이 많이 힘들었겠구나.";
    if (severity === "none" || severity === "low") return text;

    if (severity === "high") {
        if (hasRequiredChildSafetyReply(text, { riskLevel: severity, parentNotified })) return text;
        const notificationText = parentNotified ? " 부모님께도 알림을 남겼어." : "";
        return `${text} 지금 바로 가까운 어른에게 말하자. 혼자 있지 말고 부모님이나 선생님께 알려줘.${notificationText}`;
    }

    if (hasRequiredChildSafetyReply(text, { riskLevel: severity, parentNotified })) return text;
    return `${text} 이 이야기는 혼자만 들고 있지 말고, 믿을 수 있는 어른이나 부모님에게 같이 이야기해보자.`;
}

/**
 * 아이에게 실제 표시될 최종 답변이 위험도별 최소 안전 행동을 포함하는지 확인한다.
 * 생성 모델의 표현 차이를 허용하되, high 위험에서는 즉시 어른에게 알리기와 실제 알림 고지를
 * 모두 요구한다. 원문이나 식별자는 반환하지 않는다.
 */
export function hasRequiredChildSafetyReply(reply, {
    riskLevel = "none",
    parentNotified = false,
} = {}) {
    const severity = normalizeRiskLevel(riskLevel);
    const text = String(reply || "").trim();
    if (!text) return false;
    if (severity === "none" || severity === "low") return true;

    const hasTrustedAdultGuidance = /(가까운|믿을 수 있는).{0,12}어른|부모님|보호자|선생님/.test(text);
    if (severity === "medium") return hasTrustedAdultGuidance;

    const hasImmediateAdultGuidance = /지금\s*바로/.test(text) && hasTrustedAdultGuidance;
    const hasParentNotification = /부모님께도\s*알림|알림을\s*남겼/.test(text);
    return hasImmediateAdultGuidance && (!parentNotified || hasParentNotification);
}

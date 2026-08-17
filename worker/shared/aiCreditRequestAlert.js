// 아이가 AI 대화 횟수를 다 썼을 때 부모에게 보내는 요청 알림의 문구를 만든다.
//
// 아이가 보낸 문자열을 그대로 부모 알림 제목·본문으로 쓰지 않는다(위조 방지).
// 서버가 소진 원인을 판정해 문구를 고르고, 아이 이름만 넣는다.
//
// 소진 원인별로 부모가 할 일이 다르다 — 정직하게 구분한다.
//  · parent_safety_limit : 부모가 정한 하루 상한이 먼저 걸렸다. 크레딧을 사도 안 풀린다.
//  · free_included_limit : 무료 포함량을 다 썼다. 프리미엄 또는 크레딧이 답이다.
//  · premium_allowance_limit : 프리미엄 포함량을 다 썼다. 크레딧 충전이 답이다.

/** 부모가 아이별로 정한 상한이 상업 포함량보다 낮으면 그 상한이 먼저 걸린 것이다. */
export function resolveAiCreditRequestReason({
    isPremium = false,
    dailyIncludedLimit = 0,
    parentDailyLimit = 0,
} = {}) {
    const included = Number(dailyIncludedLimit) || 0;
    const parentLimit = Number(parentDailyLimit) || 0;
    if (included > 0 && parentLimit > 0 && parentLimit < included) return "parent_safety_limit";
    return isPremium ? "premium_allowance_limit" : "free_included_limit";
}

const REASON_COPY = {
    parent_safety_limit: {
        title: "AI 친구 대화 횟수 요청",
        // 크레딧 구매를 권하지 않는다 — 이 경우엔 사도 안 늘어난다.
        message: (name) => `${name}님이 오늘 정해진 AI 친구 대화 횟수를 다 썼어요. 하루 횟수를 늘려 줄까요?`,
    },
    free_included_limit: {
        title: "AI 친구 대화 횟수 요청",
        message: (name) => `${name}님이 오늘 무료 AI 친구 대화를 다 썼어요. 대화 충전이나 프리미엄으로 더 이야기할 수 있어요.`,
    },
    premium_allowance_limit: {
        title: "AI 친구 대화 횟수 요청",
        message: (name) => `${name}님이 오늘 AI 친구 대화 횟수를 다 썼어요. 대화를 충전하면 오늘 더 이야기할 수 있어요.`,
    },
};

/**
 * parent_alerts insert 용 행. 아이 입력을 담지 않고 서버 판정 결과만 담는다.
 * childUserId 는 컬럼과 metadata 양쪽에 넣어 부모 화면이 대상 아이를 특정할 수 있게 한다.
 */
export function buildAiCreditRequestAlert({
    familyId,
    childUserId,
    childName = "",
    reason = "free_included_limit",
} = {}) {
    if (!familyId || !childUserId) return null;
    const copy = REASON_COPY[reason] ?? REASON_COPY.free_included_limit;
    const displayName = String(childName || "").trim() || "아이";
    return {
        family_id: familyId,
        alert_type: "ai_credit_request",
        title: copy.title,
        message: copy.message(displayName),
        severity: "info",
        child_user_id: childUserId,
        metadata: {
            child_user_id: childUserId,
            reason,
        },
    };
}

/**
 * 같은 아이의 최근 요청과 겹치는지 판정한다(부모 알림 도배 방지).
 * 조회 실패는 호출부에서 fail-open 으로 다루고, 여기서는 순수 계산만 한다.
 */
export const AI_CREDIT_REQUEST_COOLDOWN_MS = 3 * 60 * 60 * 1000;

export function isAiCreditRequestWithinCooldown(lastCreatedAtMs, nowMs, cooldownMs = AI_CREDIT_REQUEST_COOLDOWN_MS) {
    if (typeof lastCreatedAtMs !== "number" || !Number.isFinite(lastCreatedAtMs)) return false;
    if (typeof nowMs !== "number" || !Number.isFinite(nowMs)) return false;
    const elapsed = nowMs - lastCreatedAtMs;
    return elapsed >= 0 && elapsed < cooldownMs;
}

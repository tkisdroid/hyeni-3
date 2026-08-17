export function shouldBypassAiCreditLimit({ safety = null } = {}) {
    const riskLevel = String(safety?.riskLevel || "none");
    return riskLevel === "medium" || riskLevel === "high";
}

/**
 * 크레딧 차감 기준(2026-08-17 TK 결정): **아이가 보낸 말 1회 = 1크레딧**.
 *
 * 이전에는 "LLM 을 실제로 호출했는가"로 갈랐다. 그러면 같은 한 마디인데 어떤 날은 깎이고
 * 어떤 날은 안 깎여 아이도 부모도 남은 횟수를 예측할 수 없었고, 서버 내부 구현(결정적 응답
 * 분기)이 바뀔 때마다 과금이 조용히 따라 움직였다. 이제 내부 LLM 사용 여부와 무관하게
 * 한 번 말을 걸면 한 번 깎는다 — 화면의 "오늘 N번 더"가 곧 실제로 말 걸 수 있는 횟수다.
 *
 * 예외는 두 가지뿐이고, 둘 다 과금 취향이 아니라 원칙이다.
 *  ① 안전 위험(medium/high) — 힘든 아이가 도움을 청한 turn 에 횟수를 물리지 않는다.
 *     `shouldBypassAiCreditLimit` 과 짝이며, 한도가 0이어도 대화가 열린다.
 *  ② 아무것도 해 주지 못하고 거절만 한 turn — 부모 전용/금지 주제/도구 비활성.
 *     해 준 것이 없는데 횟수를 가져가면 아이가 "말 걸면 손해"라고 배운다.
 *
 * 실패한 도구(ok === false)도 ②와 같은 이유로 깎지 않는다.
 */
const REFUSAL_ONLY_INTENTS = new Set([
    "parent_forbidden_topic",
    "parent_allowed_topic_restriction",
    "external_contact_rejected",
    "parent_tool_disabled",
    "schedule_delete_parent_only",
    "notification_settings_parent_only",
]);

export function shouldChargeForAiTurn({ detectedIntent = "", toolResult = null, safety = null } = {}) {
    // ② 거절만 한 turn
    if (REFUSAL_ONLY_INTENTS.has(String(detectedIntent || ""))) return false;
    // ① 안전 위험 turn
    const riskLevel = String(safety?.riskLevel || "none");
    if (riskLevel === "medium" || riskLevel === "high") return false;
    // 도구가 실패해 아이가 얻은 게 없는 turn
    if (toolResult && toolResult.ok === false) return false;
    // 그 외는 LLM 호출 여부와 무관하게 1회 차감한다.
    return true;
}

const EMOTION_KEYWORDS = [
    "친구",
    "속상",
    "슬퍼",
    "화",
    "걱정",
    "불안",
    "무서",
    "괴롭",
];

const SENSITIVE_CHILD_PERSONAL_INFO_PATTERNS = [
    /01[016789][-\s]?\d{3,4}[-\s]?\d{4}/,
    /전화번호|연락처|핸드폰\s*번호|휴대폰\s*번호/,
    /집\s*주소|우리\s*집|사는\s*곳|주소는|아파트|빌라|동\s*\d+\s*호|로\s*\d+|길\s*\d+/,
    /학교\s*(이름|는|야|다녀)|초등학교|중학교|고등학교|유치원/,
    /우울증|불안장애|공황|자해|자살|상담|치료|진단|병원|의사|약\s*(?:먹|복용)/,
    /종교|교회|성당|절|정치|대통령|선거/,
    /이혼|가정폭력|학대|입양|파양/,
    /비밀|아무(?:에게|한테)도\s*말하지|(?:엄마|아빠|부모님|보호자|선생님)(?:에게|한테|께)?\s*말하지\s*마/,
];

function normalizeMessages(messages) {
    return (Array.isArray(messages) ? messages : [])
        .map((message) => ({
            role: message?.role === "assistant" ? "assistant" : "user",
            content: String(message?.content || "").replace(/\s+/g, " ").trim(),
        }))
        .filter((message) => message.content.length > 0);
}

function containsSensitiveChildPersonalInfo(messages) {
    const text = normalizeMessages(messages).map((message) => message.content).join(" ");
    return SENSITIVE_CHILD_PERSONAL_INFO_PATTERNS.some((pattern) => pattern.test(text));
}

export function shouldStoreConversationSummary(messages, threshold = 8) {
    const cleanMessages = normalizeMessages(messages);
    return cleanMessages.length >= threshold && !containsSensitiveChildPersonalInfo(cleanMessages);
}

export function buildConversationSummaryRow({ familyId, childUserId, conversationId = null, messages } = {}) {
    const cleanMessages = normalizeMessages(messages);
    if (!familyId || !childUserId || cleanMessages.length === 0) return null;
    if (containsSensitiveChildPersonalInfo(cleanMessages)) return null;

    const summary = cleanMessages
        .slice(-8)
        .map((message) => `${message.role === "assistant" ? "AI" : "아이"}: ${message.content.slice(0, 160)}`)
        .join("\n")
        .slice(0, 1000);
    const allText = cleanMessages.map((message) => message.content).join(" ");
    const emotionalSignals = EMOTION_KEYWORDS
        .filter((keyword) => allText.includes(keyword))
        .map((keyword) => keyword.replace("싸웠", "싸움").replace("괴롭", "괴롭힘"));

    return {
        family_id: familyId,
        child_user_id: childUserId,
        conversation_id: conversationId,
        summary,
        important_facts: [],
        emotional_signals: Array.from(new Set(emotionalSignals)),
        interests: [],
        unresolved_issues: emotionalSignals.length > 0
            ? ["최근 대화에서 확인이 필요한 감정/관계 주제가 있었음"]
            : [],
        updated_at: new Date().toISOString(),
    };
}

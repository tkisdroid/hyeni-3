// Conservative long-term memory policy for child AI conversations.

const SENSITIVE_PATTERNS = [
    /주소|사는\s*곳|집\s*어디|학교\s*이름|우리\s*학교(?:는|은|이야|입니다)?|[가-힣A-Za-z0-9]{2,30}(?:초등학교|중학교|고등학교|유치원)|전화번호|010[-\s]?\d{3,4}[-\s]?\d{4}/,
    /주민번호|비밀번호|계좌|카드번호/,
    /우울증|불안장애|공황|자해|자살|상담|치료|진단|병원|의사|약\s*(?:먹|복용)/,
    /종교|교회|성당|절|정치|대통령|선거/,
    /이혼|가정폭력|학대|입양|파양/,
    /비밀|아무(?:에게|한테)도\s*말하지|(?:엄마|아빠|부모님|보호자|선생님)(?:에게|한테|께)?\s*말하지\s*마/,
];

const TEMPORARY_NEGATIVE_PATTERNS = [
    /오늘은.*싫|지금은.*싫|이번엔.*싫|잠깐.*싫/,
];

const INTERESTS = [
    "축구",
    "태권도",
    "피아노",
    "수영",
    "그림",
    "독서",
    "게임",
    "동물",
    "공룡",
    "우주",
];

const CHALLENGE_SUBJECTS = [
    "수학",
    "영어",
    "국어",
    "과학",
    "사회",
    "숙제",
    "받아쓰기",
    "읽기",
    "쓰기",
    "한글",
];

function listItems(value) {
    if (Array.isArray(value)) {
        return value
            .map((item) => (item == null ? "" : String(item).trim()))
            .filter(Boolean);
    }
    if (value == null) return [];
    return String(value)
        .split(/[,\n]/)
        .map((item) => item.trim())
        .filter(Boolean);
}

function compactText(value) {
    return String(value || "").toLowerCase().replace(/\s+/g, "");
}

function includesParentForbiddenTopic(text, parentSettings = {}) {
    const topics = listItems(parentSettings.forbiddenTopics || parentSettings.forbidden_topics);
    const normalizedText = compactText(text);
    return topics.some((topic) => {
        const normalizedTopic = compactText(topic);
        return normalizedTopic && normalizedText.includes(normalizedTopic);
    });
}

function objectParticle(word) {
    const last = String(word || "").charCodeAt(String(word || "").length - 1);
    if (last < 0xac00 || last > 0xd7a3) return "을";
    return (last - 0xac00) % 28 === 0 ? "를" : "을";
}

function isGenericFriendLabel(value) {
    return [
        "친구",
        "애들",
        "아이",
        "사람",
        "어른",
        "선생",
        "선생님",
        "엄마",
        "아빠",
        "부모",
        "부모님",
        "보호자",
    ].includes(String(value || ""));
}

function extractRepeatedFriendName(text) {
    if (!/(자주|매일|항상|맨날).{0,12}(놀|만나|같이|함께)|(?:놀|만나|같이|함께).{0,12}(자주|매일|항상|맨날)/.test(text)) {
        return null;
    }
    const match = /([가-힣]{2,5})(?:이랑|랑|하고|와|과)\s*(?:자주|매일|항상|맨날)?\s*(?:놀|만나|같이|함께)/.exec(text)
        || /(?:친구\s*)?([가-힣]{2,5})(?:이|가)?\s*(?:내\s*)?(?:친구|단짝)/.exec(text);
    if (!match?.[1]) return null;
    const friendName = match[1].replace(/이$/, "");
    if (isGenericFriendLabel(friendName)) return null;
    return friendName;
}

export function createLongTermMemoryPatch(message, { parentSettings = {} } = {}) {
    const text = String(message || "").trim();
    if (!text) return { shouldStore: false, reason: "empty" };

    if (includesParentForbiddenTopic(text, parentSettings)) {
        return { shouldStore: false, reason: "parent_forbidden_topic" };
    }

    if (SENSITIVE_PATTERNS.some((pattern) => pattern.test(text))) {
        return { shouldStore: false, reason: "sensitive_personal_information" };
    }

    if (TEMPORARY_NEGATIVE_PATTERNS.some((pattern) => pattern.test(text))) {
        return { shouldStore: false, reason: "temporary_or_negative_preference" };
    }

    const hasSubjectChallenge = /어려워|힘들어|헷갈려|잘\s*못|못하겠|막혀/.test(text);
    if (hasSubjectChallenge) {
        const hit = CHALLENGE_SUBJECTS.find((subject) => text.includes(subject));
        if (hit) {
            return {
                shouldStore: true,
                memory: {
                    type: "challenge",
                    key: hit,
                    value: `${hit}${objectParticle(hit)} 어려워함`,
                    confidence: /매일|자주|항상/.test(text) ? 0.8 : 0.7,
                    parent_visible: true,
                },
            };
        }
    }

    const friendName = extractRepeatedFriendName(text);
    if (friendName) {
        return {
            shouldStore: true,
            memory: {
                type: "friend",
                key: friendName,
                value: `${friendName}과 자주 놂`,
                confidence: /매일|자주|항상|맨날/.test(text) ? 0.8 : 0.7,
                parent_visible: true,
            },
        };
    }

    const hasPositivePreference = /좋아|좋아해|재밌|매일|자주|최고/.test(text);
    if (hasPositivePreference) {
        const hit = INTERESTS.find((interest) => text.includes(interest));
        if (hit) {
            return {
                shouldStore: true,
                memory: {
                    type: "interest",
                    key: hit,
                    value: `${hit}를 좋아함`,
                    confidence: /매일|자주/.test(text) ? 0.8 : 0.7,
                    parent_visible: true,
                },
            };
        }
    }

    return { shouldStore: false, reason: "not_actionable_long_term_memory" };
}

// Conservative long-term memory policy for child AI conversations.
import { extractChildHabitMemory } from "./aiChildHabits.js";

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

// ── 열린 어휘 기억 ────────────────────────────────────────────────────────
// 고정 목록(INTERESTS 10개)만 기억하면 아이가 무슨 말을 해도 "새로 알게 된 것"이 거의 없다.
// 그래서 문장 구조에서 대상 낱말을 직접 뽑아 둔다. 대신 아무 낱말이나 저장하지 않도록
// ①민감 패턴 ②대명사·요청어 stopword ③길이·형태 검사를 모두 통과한 것만 남긴다.

/** 이름 자리에 오면 안 되는 낱말(대명사·기능어·호칭). */
const OBJECT_STOP_WORDS = new Set([
    "그거", "저거", "이거", "그것", "저것", "이것", "여기", "거기", "저기",
    "뭐", "무엇", "누구", "우리", "너", "네가", "내가", "나는", "너는",
    "오늘", "내일", "어제", "지금", "아까", "이따", "매일", "자주", "항상", "그냥",
    "엄마", "아빠", "부모", "부모님", "보호자", "선생", "선생님", "친구", "사람", "어른",
    "진짜", "정말", "너무", "조금", "많이", "제일", "가장", "완전",
]);

function isStorableObject(word) {
    const value = String(word || "").trim();
    if (value.length < 2 || value.length > 12) return false;
    if (OBJECT_STOP_WORDS.has(value)) return false;
    if (/^\d+$/.test(value)) return false;
    if (SENSITIVE_PATTERNS.some((pattern) => pattern.test(value))) return false;
    return true;
}

/** 대상과 서술어 사이에 흔히 끼는 부사 — "레고 진짜 좋아해"를 놓치지 않기 위해. */
const FILLER_ADVERBS = "진짜|정말|너무|완전|엄청|되게|참|아주|매일|자주|항상|맨날|제일|가장|좀|더|훨씬|많이|조금|늘";

/**
 * 서술어에 붙는 조사만 떼어낸다.
 * "고양이 좋아해"의 `이`는 낱말의 일부지만 "발표가 무서워"의 `가`는 조사다.
 * 목적어를 받는 서술어(좋아해·싫어해·잘해)는 을/를, 주어를 받는 서술어(무서워·어려워)는 이/가를 뗀다.
 */
function stripTrailingParticle(word, particles) {
    for (const particle of particles) {
        if (word.length > particle.length + 1 && word.endsWith(particle)) {
            return word.slice(0, -particle.length);
        }
    }
    return word;
}

/** "○○ (진짜) 좋아해" 처럼 서술어 앞의 대상 낱말을 뽑는다. 후보를 순서대로 검사한다. */
function extractObjectBefore(text, predicateSource, particles) {
    const re = new RegExp(
        `([가-힣A-Za-z0-9]{2,12})\\s*(?:${FILLER_ADVERBS})?\\s*(?:${predicateSource})`,
        "g",
    );
    for (const match of text.matchAll(re)) {
        const raw = match[1].trim();
        // 조사를 뗀 형태를 먼저 본다("발표가" → "발표").
        for (const candidate of [stripTrailingParticle(raw, particles), raw]) {
            if (isStorableObject(candidate)) return candidate;
        }
    }
    return null;
}

/** 서술어별로 떼어낼 조사. 잘못 떼면 "고양이"가 "고양"이 된다. */
const OBJECT_PARTICLES = ["이랑", "랑", "하고", "을", "를", "은", "는", "도"];
// "이"는 떼지 않는다 — 고양이·떡볶이·어린이처럼 낱말의 일부인 경우가 훨씬 많다.
const SUBJECT_PARTICLES = ["가", "은", "는", "도"];

/**
 * 문장 구조 → 장기 기억 후보.
 * 위에서부터 먼저 맞는 것을 쓴다(구체적인 신호가 앞).
 */
const OPEN_MEMORY_RULES = [
    { type: "fear", predicate: "무서워|무섭|겁나", particles: SUBJECT_PARTICLES, value: (w) => `${w}${objectParticle(w)} 무서워함` },
    { type: "strength", predicate: "잘해|잘한다|자신\\s*있어", particles: OBJECT_PARTICLES, value: (w) => `${w}${objectParticle(w)} 잘함` },
    { type: "dream", predicate: "되고\\s*싶어|될\\s*거야|되는\\s*게\\s*꿈", particles: OBJECT_PARTICLES, value: (w) => `커서 ${w} 되고 싶어함` },
    { type: "favorite_food", predicate: "맛있어|맛있|먹고\\s*싶어", particles: SUBJECT_PARTICLES, value: (w) => `${w}${objectParticle(w)} 좋아함(먹는 것)` },
    { type: "challenge", predicate: "어려워|힘들어|헷갈려|잘\\s*못|못하겠", particles: SUBJECT_PARTICLES, value: (w) => `${w}${objectParticle(w)} 어려워함` },
    { type: "dislike", predicate: "싫어해|싫어|별로야", particles: OBJECT_PARTICLES, value: (w) => `${w}${objectParticle(w)} 싫어함` },
    { type: "interest", predicate: "좋아해|좋아|재밌어|재미있어|최고야", particles: OBJECT_PARTICLES, value: (w) => `${w}${objectParticle(w)} 좋아함` },
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

    // 생활 습관("집에 오면 일정 정리해", "나 물건 자주 두고 와")이 먼저다.
    // 관심·싫음보다 구체적인 신호이고, 이걸 알아야 다음에 먼저 물어볼 수 있다(관계 형성).
    const habit = extractChildHabitMemory(text);
    if (habit) {
        return { shouldStore: true, memory: habit };
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

    // 고정 목록에 없는 말도 문장 구조로 알아듣는다("나 레고 좋아해", "발표가 무서워").
    // 여기까지 왔다는 건 민감·일시적 표현 필터를 이미 통과했다는 뜻이다.
    for (const rule of OPEN_MEMORY_RULES) {
        const word = extractObjectBefore(text, rule.predicate, rule.particles);
        if (!word) continue;
        return {
            shouldStore: true,
            memory: {
                type: rule.type,
                key: word,
                value: rule.value(word),
                confidence: /매일|자주|항상|맨날|제일|가장/.test(text) ? 0.75 : 0.65,
                parent_visible: true,
            },
        };
    }

    return { shouldStore: false, reason: "not_actionable_long_term_memory" };
}

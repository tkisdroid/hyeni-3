// Deterministic child-agent intent planner.
// The LLM can still answer naturally, but safety and app actions start from this policy layer.

const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDateKey(value) {
    const match = typeof value === "string" ? DATE_KEY_RE.exec(value.trim()) : null;
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);
    if (
        date.getFullYear() !== year
        || date.getMonth() !== month - 1
        || date.getDate() !== day
    ) {
        return null;
    }
    return date;
}

function dateKeyFromDate(date) {
    const year = String(date.getFullYear()).padStart(4, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function addDays(dateKey, days) {
    const date = parseDateKey(dateKey) || new Date();
    date.setDate(date.getDate() + days);
    return dateKeyFromDate(date);
}

function todayKey(referenceDate) {
    if (typeof referenceDate === "string" && parseDateKey(referenceDate)) return referenceDate;
    return dateKeyFromDate(new Date());
}

function normalizeText(message) {
    return String(message || "").trim().replace(/\s+/g, " ");
}

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

function findParentForbiddenTopic(text, parentSettings = {}) {
    const topics = listItems(parentSettings.forbiddenTopics || parentSettings.forbidden_topics);
    const normalizedText = compactText(text);
    return topics.find((topic) => {
        const normalizedTopic = compactText(topic);
        return normalizedTopic && normalizedText.includes(normalizedTopic);
    }) || null;
}

function parentAllowedTopics(parentSettings = {}) {
    return listItems(parentSettings.allowedTopics || parentSettings.allowed_topics);
}

function isAllowedParentTopic(text, parentSettings = {}, aliases = []) {
    const topics = parentAllowedTopics(parentSettings);
    if (topics.length === 0) return true;

    const normalizedText = compactText(text);
    return topics.some((topic) => {
        const normalizedTopic = compactText(topic);
        if (!normalizedTopic) return false;
        if (normalizedText.includes(normalizedTopic)) return true;
        return aliases.some((alias) => {
            const normalizedAlias = compactText(alias);
            return normalizedAlias
                && (normalizedTopic.includes(normalizedAlias) || normalizedAlias.includes(normalizedTopic));
        });
    });
}

function parentAllowedTopicRestriction(parentSettings = {}, safety = { riskLevel: "none", reason: "", shouldNotifyParent: false }) {
    return basePlan({
        detectedIntent: "parent_allowed_topic_restriction",
        shouldUseTool: false,
        toolName: null,
        toolArgs: {
            allowedTopics: parentAllowedTopics(parentSettings),
        },
        blockedByParentSettings: true,
        safety,
    });
}

function readParentToolSetting(parentSettings = {}, camelKey, snakeKey, fallback = true) {
    if (Object.prototype.hasOwnProperty.call(parentSettings, camelKey)) {
        return parentSettings[camelKey] !== false;
    }
    if (Object.prototype.hasOwnProperty.call(parentSettings, snakeKey)) {
        return parentSettings[snakeKey] !== false;
    }
    return fallback;
}

function parentToolDisabled(toolFamily, safety = { riskLevel: "none", reason: "", shouldNotifyParent: false }) {
    return basePlan({
        detectedIntent: "parent_tool_disabled",
        shouldUseTool: false,
        toolName: null,
        toolArgs: { toolFamily },
        blockedByParentSettings: true,
        safety,
    });
}

const EMOTIONAL_SUPPORT_TOPIC_ALIASES = [
    "감정",
    "기분",
    "마음",
    "고민",
    "친구",
    "관계",
    "학교생활",
    "속상",
    "걱정",
    "불안",
];

const GENERAL_CHAT_TOPIC_ALIASES = [
    "일상",
    "대화",
    "잡담",
    "놀이",
    "취미",
    "관심사",
];

function isCorrectnessWording(text) {
    return /(답|정답|문제|계산|풀이|시간|일정|말|표현|문장|선택지|이거|이게|그거|그게).{0,12}맞(아|았|는지|나요|습니까|을까|나\??)/i.test(text);
}

function detectSafety(text) {
    if (
        /죽고\s*싶|죽어\s*버리고\s*싶|죽을\s*(래|거야|것\s*같|까)|자살|자해|목숨|사라지고\s*싶|없어지고\s*싶/i.test(text)
        || /(나|내\s*몸|스스로|스스로를|나를|나한테).{0,12}(해치고\s*싶|해칠\s*거야|다치게\s*하고\s*싶)/i.test(text)
    ) {
        return {
            riskLevel: "high",
            reason: "self_harm_signal",
            shouldNotifyParent: true,
        };
    }
    if (
        /01[016789][-\s]?\d{3,4}[-\s]?\d{4}|전화번호|연락처|휴대폰\s*번호|핸드폰\s*번호/i.test(text)
        || /집\s*주소|주소는|사는\s*곳|우리\s*집\s*(주소|은|은요|이야|입니다)?|아파트\s*\d+|동\s*\d+\s*호/i.test(text)
        || /학교\s*이름|우리\s*학교(?:는|은|이야|입니다)?|[가-힣A-Za-z0-9]{2,30}(?:초등학교|중학교|고등학교|유치원)/i.test(text)
    ) {
        return {
            riskLevel: "medium",
            reason: "personal_info_signal",
            shouldNotifyParent: true,
        };
    }
    if (
        (!isCorrectnessWording(text) && /맞았|맞고\s*있|맞는\s*중|때렸|괴롭힘|괴롭혀|괴롭히|따돌림|따돌려|따돌리|발로\s*차|무서워|학대|성적/i.test(text))
        || /(친구|애들|엄마|아빠|형|누나|오빠|언니|선생님|사람|어른)(이|가|한테|에게)?\s*(계속|자꾸|또)?\s*(맞아|때려)/i.test(text)
        || /(낯선|모르는).{0,8}(사람|어른|아저씨|아줌마|형|누나|오빠|언니)/i.test(text)
        || /(낯선|모르는).{0,12}(같이\s*가자|따라오|만나자)/i.test(text)
        || /야한\s*(사진|영상)|벗은\s*사진|몸\s*사진|만졌어|만져/i.test(text)
        || /약을?\s*(한꺼번에|많이|여러\s*개)|수면제|마약|(^|[^가-힣])술\s*(마셔|마시|먹어)|담배|전자담배/i.test(text)
    ) {
        return {
            riskLevel: "medium",
            reason: "possible_harm_signal",
            shouldNotifyParent: true,
        };
    }
    if (
        /싸웠|속상|슬퍼|외로|불안|걱정/i.test(text)
        || /(친구|선생님|엄마|아빠|형|누나|오빠|언니).{0,16}(사과(?:하|를|하고|한다고|할|해|했|하면)|화해(?:하|를|하고|할|해|했|하면)|어떻게\s*말|말해도\s*될까)/i.test(text)
    ) {
        return {
            riskLevel: "low",
            reason: "emotional_signal",
            shouldNotifyParent: false,
        };
    }
    return { riskLevel: "none", reason: "", shouldNotifyParent: false };
}

function extractDate(text, referenceDate) {
    const base = todayKey(referenceDate);
    if (/내일/.test(text)) return addDays(base, 1);
    if (/모레/.test(text)) return addDays(base, 2);
    if (/오늘/.test(text)) return base;
    return null;
}

function isNaturalScheduleQuery(text) {
    if (!/오늘|내일|모레/.test(text)) return false;
    return /뭐\s*있|뭐가\s*있|해야\s*할\s*(거|것|일)|할\s*(거|것|일)\s*있|챙길\s*(거|것)\s*있|준비할\s*(거|것)\s*있|준비물\s*(뭐|알려|있)/.test(text);
}

function isMemorySaveRequest(text) {
    return /(저장|기억)/.test(text)
        && /(좋아|싫어|어려워|어렵|잘해|못해|관심사|취향|기억)/.test(text)
        && !/(일정|스케줄|약속|숙제|학원|수업|운동|병원)/.test(text);
}

function extractTime(text) {
    const match = /(오전|오후)?\s*(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분?)?/.exec(text);
    if (!match) return null;

    return normalizeKoreanTimeMatch(match);
}

function normalizeKoreanTimeMatch(match) {
    const meridiem = match?.[1] || "";
    let hour = Number(match?.[2]);
    const minute = Number(match?.[3] || 0);
    if (!Number.isFinite(hour) || hour < 0 || hour > 24 || minute < 0 || minute > 59) return null;

    if (meridiem === "오후" && hour < 12) hour += 12;
    if (!meridiem && hour >= 1 && hour <= 7) hour += 12;
    if (hour === 24) hour = 0;

    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function extractEndTime(text) {
    if (!/(부터|까지|~|-)/.test(text)) return null;
    const matches = Array.from(text.matchAll(/(오전|오후)?\s*(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분?)?/g));
    if (matches.length < 2) return null;
    return normalizeKoreanTimeMatch(matches[1]);
}

function isTimeOnlyFollowup(text) {
    if (!extractTime(text)) return false;
    const rest = String(text || "")
        .replace(/(오전|오후)?\s*\d{1,2}\s*시(?:\s*\d{1,2}\s*분?)?/g, " ")
        .replace(/부터|까지|쯤|에|으로|로|~|-/g, " ")
        .replace(/[.!?。]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    return rest.length === 0;
}

function removeStandaloneParticles(text) {
    return String(text || "").replace(/(^|\s)(에|을|를|이|가|은|는|으로|로)(?=\s|$)/g, " ");
}

function extractScheduleTitle(text) {
    const normalized = text
        .replace(/오늘|내일|모레/g, " ")
        .replace(/(오전|오후)?\s*\d{1,2}\s*시(?:\s*\d{1,2}\s*분?)?/g, " ")
        .replace(/부터|까지|~|-/g, " ")
        .replace(/일정|스케줄|추가|등록|저장|해줘|해\s*줘|해|좀/gi, " ");
    const title = removeStandaloneParticles(normalized)
        .replace(/\s+/g, " ")
        .trim();
    return title || null;
}

function extractScheduleDeleteTitle(text) {
    const title = text
        .replace(/오늘|내일|모레/g, " ")
        .replace(/(오전|오후)?\s*\d{1,2}\s*시(?:\s*\d{1,2}\s*분?)?/g, " ")
        .replace(/일정|스케줄|삭제|지워|취소|없애|해줘|해\s*줘|해|좀|에|을|를|이|가|은|는/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
    return title || null;
}

function extractScheduleUpdateTitle(text) {
    const title = text
        .replace(/오늘|내일|모레/g, " ")
        .replace(/(오전|오후)?\s*\d{1,2}\s*시(?:\s*\d{1,2}\s*분?)?/g, " ")
        .replace(/부터|까지|~|-/g, " ")
        .replace(/일정|스케줄|수정|변경|바꿔|바꾸|옮겨|미뤄|당겨|해줘|해\s*줘|줘|해|좀|에|으로|로|을|를|이|가|은|는/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
    return title || null;
}

function parentRoleFromText(text) {
    if (/엄마|어머니|mom/i.test(text)) return "mom";
    if (/아빠|아버지|dad/i.test(text)) return "dad";
    if (/보호자|부모님|부모/i.test(text)) return "guardian";
    return null;
}

function extractParentMessage(text) {
    const quoted = /["'“”‘’](.+?)["'“”‘’]/.exec(text);
    if (quoted?.[1]?.trim()) return quoted[1].trim();

    const parentPrefix = /^(엄마|어머니|mom|아빠|아버지|dad|보호자|부모님|부모)(에게|한테|께)?\s*/i;
    let content = text.replace(parentPrefix, " ").trim();
    content = content
        .replace(/^(문자|메시지|카톡)(으로|로)?\s*/i, "")
        .replace(/(?:라고|이라고)?\s*(?:문자|메시지|카톡)?\s*(?:보내|전해|말해).*/i, "")
        .replace(/\s+/g, " ")
        .trim();
    return content || null;
}

function isExternalContactRequest(text) {
    if (!/(에게|한테|께)/.test(text)) return false;
    return /(전화|통화|콜)(?:\s*좀)?\s*(해|걸어|연결해)\s*(줘|줄래|주라)/.test(text)
        || /(문자|메시지|카톡).{0,40}?(보내|전해|말해)\s*(줘|줄래|주라)/.test(text)
        || /(전해|말해)\s*(줘|줄래|주라)/.test(text)
        || /(에게|한테|께).{1,40}?보내\s*(줘|줄래|주라)/.test(text);
}

function isGenericParentMessageRequest(text) {
    if (/(에게|한테|께)/.test(text)) return false;
    return /(문자|메시지|카톡).{0,30}(보내|전해|말해)\s*(줘|줄래|주라)?/.test(text)
        || /^(문자|메시지|카톡)\s*(보내|전해|말해)?\s*(줘|줄래|주라)?$/.test(text);
}

function basePlan(overrides = {}) {
    return {
        detectedIntent: "general_chat",
        shouldUseTool: false,
        toolName: null,
        toolArgs: {},
        missingArgs: [],
        confirmationRequired: false,
        safety: { riskLevel: "none", reason: "", shouldNotifyParent: false },
        ...overrides,
    };
}

function normalizeRecentMessages(recentMessages) {
    if (!Array.isArray(recentMessages)) return [];
    return recentMessages
        .map((message) => ({
            role: message?.role === "assistant" ? "assistant" : "user",
            content: normalizeText(message?.content),
        }))
        .filter((message) => message.content);
}

function findPendingScheduleCreate(recentMessages, { referenceDate, parentSettings }) {
    const messages = normalizeRecentMessages(recentMessages);
    for (let index = messages.length - 1; index >= 1; index -= 1) {
        const assistant = messages[index];
        if (assistant.role !== "assistant" || !/몇\s*시/.test(assistant.content)) continue;

        for (let previousIndex = index - 1; previousIndex >= 0; previousIndex -= 1) {
            const previous = messages[previousIndex];
            if (previous.role !== "user") continue;
            const previousPlan = planChildAgentAction(previous.content, {
                referenceDate,
                parentSettings,
                recentMessages: [],
            });
            const missingArgs = Array.isArray(previousPlan.missingArgs) ? previousPlan.missingArgs : [];
            if (
                previousPlan.detectedIntent === "schedule_create"
                && previousPlan.toolName === "createSchedule"
                && missingArgs.length > 0
            ) {
                return previousPlan;
            }
            break;
        }
    }
    return null;
}

function findRecentScheduleCreateTime(recentMessages) {
    const messages = normalizeRecentMessages(recentMessages);
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message.role !== "user") continue;
        const startTime = extractTime(message.content);
        if (!startTime) continue;
        return {
            startTime,
            endTime: extractEndTime(message.content),
        };
    }
    return { startTime: null, endTime: null };
}

function findRecentScheduleUpdateChanges(recentMessages) {
    const messages = normalizeRecentMessages(recentMessages);
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message.role !== "user") continue;
        const startTime = extractTime(message.content);
        const endTime = extractEndTime(message.content);
        if (!startTime && !endTime) continue;
        const changes = {};
        if (startTime) changes.startTime = startTime;
        if (endTime) changes.endTime = endTime;
        return changes;
    }
    return {};
}

function findRecentScheduleDeleteTitle(recentMessages) {
    const messages = normalizeRecentMessages(recentMessages);
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message.role !== "user") continue;
        const title = extractScheduleDeleteTitle(message.content);
        if (!title) continue;
        return title;
    }
    return null;
}

function findPendingScheduleDelete(recentMessages, { referenceDate, parentSettings }) {
    const messages = normalizeRecentMessages(recentMessages);
    for (let index = messages.length - 1; index >= 1; index -= 1) {
        const assistant = messages[index];
        if (
            assistant.role !== "assistant"
            || !/(언제\s*어떤\s*일정|어떤\s*일정을?\s*(?:지울|삭제|취소|없앨)|일정을?\s*(?:지울|삭제|취소|없앨).*까)/.test(assistant.content)
        ) continue;

        for (let previousIndex = index - 1; previousIndex >= 0; previousIndex -= 1) {
            const previous = messages[previousIndex];
            if (previous.role !== "user") continue;
            const previousPlan = planChildAgentAction(previous.content, {
                referenceDate,
                parentSettings,
                recentMessages: [],
            });
            const missingArgs = Array.isArray(previousPlan.missingArgs) ? previousPlan.missingArgs : [];
            if (
                previousPlan.detectedIntent === "schedule_delete"
                && previousPlan.toolName === "deleteSchedule"
                && missingArgs.some((arg) => arg === "date" || arg === "title")
            ) {
                return previousPlan;
            }
            break;
        }
    }
    return null;
}

function findPendingScheduleUpdate(recentMessages, { referenceDate, parentSettings }) {
    const messages = normalizeRecentMessages(recentMessages);
    for (let index = messages.length - 1; index >= 1; index -= 1) {
        const assistant = messages[index];
        if (
            assistant.role !== "assistant"
            || !/(언제\s*어떤\s*일정을?\s*어떻게|어떤\s*일정을?\s*(?:수정|변경|바꿀|옮길)|일정을?\s*(?:수정|변경|바꿀|옮길).*까)/.test(assistant.content)
        ) continue;

        for (let previousIndex = index - 1; previousIndex >= 0; previousIndex -= 1) {
            const previous = messages[previousIndex];
            if (previous.role !== "user") continue;
            const previousPlan = planChildAgentAction(previous.content, {
                referenceDate,
                parentSettings,
                recentMessages: [],
            });
            const missingArgs = Array.isArray(previousPlan.missingArgs) ? previousPlan.missingArgs : [];
            if (
                previousPlan.detectedIntent === "schedule_update"
                && previousPlan.toolName === "updateSchedule"
                && missingArgs.some((arg) => arg === "date" || arg === "title" || arg === "changes")
            ) {
                return previousPlan;
            }
            break;
        }
    }
    return null;
}

function mergeParentMessageReply(toolArgs = {}, replyText) {
    const currentParentRole = parentRoleFromText(replyText);
    const currentMessage = currentParentRole ? extractParentMessage(replyText) : extractParentMessage(replyText) || replyText;
    return {
        parentRole: toolArgs.parentRole || currentParentRole || null,
        message: toolArgs.message || currentMessage || null,
    };
}

function missingParentMessageArgs(toolArgs = {}) {
    const missingArgs = [];
    if (!toolArgs.parentRole) missingArgs.push("parentRole");
    if (!toolArgs.message) missingArgs.push("message");
    return missingArgs;
}

function findPendingParentMessage(recentMessages, { referenceDate, parentSettings }) {
    const messages = normalizeRecentMessages(recentMessages);
    for (let index = messages.length - 1; index >= 1; index -= 1) {
        const assistant = messages[index];
        if (assistant.role !== "assistant" || !/누구에게|어떤\s*말|뭐라고/.test(assistant.content)) continue;

        for (let previousIndex = index - 1; previousIndex >= 0; previousIndex -= 1) {
            const previous = messages[previousIndex];
            if (previous.role !== "user") continue;
            const previousPlan = planChildAgentAction(previous.content, {
                referenceDate,
                parentSettings,
                recentMessages: [],
            });
            const missingArgs = Array.isArray(previousPlan.missingArgs) ? previousPlan.missingArgs : [];
            if (
                previousPlan.detectedIntent === "message_parent"
                && previousPlan.toolName === "createMessageToParent"
                && missingArgs.some((arg) => arg === "parentRole" || arg === "message")
            ) {
                let toolArgs = { ...(previousPlan.toolArgs || {}) };
                for (let replayIndex = previousIndex + 1; replayIndex < index; replayIndex += 1) {
                    const replayMessage = messages[replayIndex];
                    if (replayMessage.role !== "user") continue;
                    toolArgs = mergeParentMessageReply(toolArgs, replayMessage.content);
                }
                const mergedMissingArgs = missingParentMessageArgs(toolArgs);
                return {
                    ...previousPlan,
                    toolArgs,
                    missingArgs: mergedMissingArgs,
                    shouldUseTool: mergedMissingArgs.length === 0,
                };
            }
        }
    }
    return null;
}

export function planChildAgentAction(message, { referenceDate = new Date(), parentSettings = {}, recentMessages = [] } = {}) {
    const text = normalizeText(message);
    const safety = detectSafety(text);

    if (safety.riskLevel === "high") {
        return basePlan({
            detectedIntent: "safety_risk",
            shouldUseTool: true,
            toolName: "notifyParent",
            toolArgs: {
                severity: "high",
                reason: safety.reason,
            },
            safety,
        });
    }

    if (safety.riskLevel === "medium") {
        return basePlan({
            detectedIntent: "safety_risk",
            shouldUseTool: true,
            toolName: "notifyParent",
            toolArgs: {
                severity: "medium",
                reason: safety.reason,
            },
            safety,
        });
    }

    const forbiddenTopic = findParentForbiddenTopic(text, parentSettings);
    if (forbiddenTopic) {
        return basePlan({
            detectedIntent: "parent_forbidden_topic",
            shouldUseTool: false,
            toolName: null,
            toolArgs: {
                topic: forbiddenTopic,
            },
            blockedByParentSettings: true,
            safety,
        });
    }

    const requestedParentRole = parentRoleFromText(text);
    const allowScheduleActions = readParentToolSetting(parentSettings, "allowScheduleActions", "allow_schedule_actions", true);
    const allowContactActions = readParentToolSetting(parentSettings, "allowContactActions", "allow_contact_actions", true);

    const pendingScheduleCreate = findPendingScheduleCreate(recentMessages, { referenceDate, parentSettings });
    if (pendingScheduleCreate && text) {
        if (!allowScheduleActions) return parentToolDisabled("schedule", safety);
        if (!isAllowedParentTopic(text, parentSettings, ["일정", "스케줄", "루틴", "준비물", "숙제", "학교생활", "학원", "운동"])) {
            return parentAllowedTopicRestriction(parentSettings, safety);
        }
        const recentScheduleTime = findRecentScheduleCreateTime(recentMessages);
        const date = extractDate(text, referenceDate) || pendingScheduleCreate.toolArgs?.date || null;
        const startTime = extractTime(text) || pendingScheduleCreate.toolArgs?.startTime || recentScheduleTime.startTime || null;
        const endTime = extractEndTime(text) || pendingScheduleCreate.toolArgs?.endTime || recentScheduleTime.endTime || null;
        const title = extractScheduleTitle(text) || pendingScheduleCreate.toolArgs?.title || null;
        const missingArgs = [];
        if (!date) missingArgs.push("date");
        if (!startTime) missingArgs.push("startTime");
        if (!title) missingArgs.push("title");

        return basePlan({
            detectedIntent: "schedule_create",
            shouldUseTool: missingArgs.length === 0,
            toolName: "createSchedule",
            toolArgs: {
                title,
                date,
                startTime,
                endTime,
            },
            missingArgs,
            safety,
        });
    }

    const pendingScheduleDelete = findPendingScheduleDelete(recentMessages, { referenceDate, parentSettings });
    if (pendingScheduleDelete && text) {
        if (!allowScheduleActions) return parentToolDisabled("schedule", safety);
        if (!isAllowedParentTopic(text, parentSettings, ["일정", "스케줄", "루틴", "준비물", "숙제", "학교생활", "학원", "운동"])) {
            return parentAllowedTopicRestriction(parentSettings, safety);
        }
        const date = extractDate(text, referenceDate) || pendingScheduleDelete.toolArgs?.date || null;
        const title = extractScheduleDeleteTitle(text)
            || pendingScheduleDelete.toolArgs?.title
            || findRecentScheduleDeleteTitle(recentMessages)
            || null;
        const missingArgs = [];
        if (!date) missingArgs.push("date");
        if (!title) missingArgs.push("title");
        return basePlan({
            detectedIntent: "schedule_delete",
            shouldUseTool: missingArgs.length === 0,
            toolName: "deleteSchedule",
            toolArgs: {
                date,
                title,
            },
            missingArgs,
            confirmationRequired: true,
            safety,
        });
    }

    const pendingScheduleUpdate = findPendingScheduleUpdate(recentMessages, { referenceDate, parentSettings });
    if (pendingScheduleUpdate && text) {
        if (!allowScheduleActions) return parentToolDisabled("schedule", safety);
        if (!isAllowedParentTopic(text, parentSettings, ["일정", "스케줄", "루틴", "준비물", "숙제", "학교생활", "학원", "운동"])) {
            return parentAllowedTopicRestriction(parentSettings, safety);
        }
        const date = extractDate(text, referenceDate) || pendingScheduleUpdate.toolArgs?.date || null;
        const title = extractScheduleUpdateTitle(text) || pendingScheduleUpdate.toolArgs?.title || null;
        const startTime = extractTime(text);
        const endTime = extractEndTime(text);
        const changes = {
            ...findRecentScheduleUpdateChanges(recentMessages),
            ...(pendingScheduleUpdate.toolArgs?.changes || {}),
        };
        if (startTime) changes.startTime = startTime;
        if (endTime) changes.endTime = endTime;

        const missingArgs = [];
        if (!date) missingArgs.push("date");
        if (!title) missingArgs.push("title");
        if (Object.keys(changes).length === 0) missingArgs.push("changes");

        return basePlan({
            detectedIntent: "schedule_update",
            shouldUseTool: missingArgs.length === 0,
            toolName: "updateSchedule",
            toolArgs: {
                date,
                title,
                changes,
            },
            missingArgs,
            confirmationRequired: true,
            safety,
        });
    }

    const pendingParentMessage = findPendingParentMessage(recentMessages, { referenceDate, parentSettings });
    if (pendingParentMessage && text) {
        if (!allowContactActions) return parentToolDisabled("contact", safety);
        if (!isAllowedParentTopic(text, parentSettings, ["가족", "연락", "부모", "엄마", "아빠", "보호자", "도움"])) {
            return parentAllowedTopicRestriction(parentSettings, safety);
        }
        const previousArgs = pendingParentMessage.toolArgs || {};
        const currentParentRole = parentRoleFromText(text);
        const parentRole = currentParentRole || previousArgs.parentRole || null;
        const currentMessage = currentParentRole ? extractParentMessage(text) : extractParentMessage(text) || text;
        const message = previousArgs.message || currentMessage || null;
        const missingArgs = missingParentMessageArgs({ parentRole, message });

        return basePlan({
            detectedIntent: "message_parent",
            shouldUseTool: missingArgs.length === 0,
            toolName: "createMessageToParent",
            toolArgs: {
                parentRole,
                message,
            },
            missingArgs,
            confirmationRequired: true,
            safety,
        });
    }

    if (requestedParentRole && /전화|통화|콜/.test(text)) {
        if (!allowContactActions) return parentToolDisabled("contact", safety);
        if (!isAllowedParentTopic(text, parentSettings, ["가족", "연락", "부모", "엄마", "아빠", "보호자", "도움"])) {
            return parentAllowedTopicRestriction(parentSettings, safety);
        }
        return basePlan({
            detectedIntent: "call_parent",
            shouldUseTool: true,
            toolName: "callParent",
            toolArgs: { parentRole: requestedParentRole },
            confirmationRequired: true,
            safety,
        });
    }

    if (requestedParentRole && /(문자|메시지|카톡|전해|말해|보내)/.test(text)) {
        if (!allowContactActions) return parentToolDisabled("contact", safety);
        if (!isAllowedParentTopic(text, parentSettings, ["가족", "연락", "부모", "엄마", "아빠", "보호자", "도움"])) {
            return parentAllowedTopicRestriction(parentSettings, safety);
        }
        const parentMessage = extractParentMessage(text);
        const missingArgs = [];
        if (!parentMessage) missingArgs.push("message");
        return basePlan({
            detectedIntent: "message_parent",
            shouldUseTool: missingArgs.length === 0,
            toolName: "createMessageToParent",
            toolArgs: {
                parentRole: requestedParentRole,
                message: parentMessage,
            },
            missingArgs,
            confirmationRequired: true,
            safety,
        });
    }

    if (!requestedParentRole && isGenericParentMessageRequest(text)) {
        if (!allowContactActions) return parentToolDisabled("contact", safety);
        if (!isAllowedParentTopic(text, parentSettings, ["가족", "연락", "부모", "엄마", "아빠", "보호자", "도움"])) {
            return parentAllowedTopicRestriction(parentSettings, safety);
        }
        const parentMessage = extractParentMessage(text);
        const missingArgs = ["parentRole"];
        if (!parentMessage) missingArgs.push("message");
        return basePlan({
            detectedIntent: "message_parent",
            shouldUseTool: false,
            toolName: "createMessageToParent",
            toolArgs: {
                parentRole: null,
                message: parentMessage,
            },
            missingArgs,
            confirmationRequired: true,
            safety,
        });
    }

    if (!requestedParentRole && isExternalContactRequest(text)) {
        return basePlan({
            detectedIntent: "external_contact_rejected",
            shouldUseTool: false,
            toolName: null,
            blockedByContactPolicy: true,
            safety,
        });
    }

    if (/(삭제|지워|취소|없애)/.test(text) && /일정|스케줄/.test(text)) {
        if (!allowScheduleActions) return parentToolDisabled("schedule", safety);
        if (!isAllowedParentTopic(text, parentSettings, ["일정", "스케줄", "루틴", "준비물", "숙제", "학교생활", "학원", "운동"])) {
            return parentAllowedTopicRestriction(parentSettings, safety);
        }
        const date = extractDate(text, referenceDate);
        const title = extractScheduleDeleteTitle(text);
        const missingArgs = [];
        if (!date) missingArgs.push("date");
        if (!title) missingArgs.push("title");
        return basePlan({
            detectedIntent: "schedule_delete",
            shouldUseTool: missingArgs.length === 0,
            toolName: "deleteSchedule",
            toolArgs: {
                date,
                title,
            },
            missingArgs,
            confirmationRequired: true,
            safety,
        });
    }

    if (/(수정|변경|바꿔|바꾸|옮겨|미뤄|당겨)/.test(text) && /일정|스케줄/.test(text)) {
        if (!allowScheduleActions) return parentToolDisabled("schedule", safety);
        if (!isAllowedParentTopic(text, parentSettings, ["일정", "스케줄", "루틴", "준비물", "숙제", "학교생활", "학원", "운동"])) {
            return parentAllowedTopicRestriction(parentSettings, safety);
        }
        const date = extractDate(text, referenceDate);
        const title = extractScheduleUpdateTitle(text);
        const startTime = extractTime(text);
        const endTime = extractEndTime(text);
        const changes = {};
        if (startTime) changes.startTime = startTime;
        if (endTime) changes.endTime = endTime;

        const missingArgs = [];
        if (!date) missingArgs.push("date");
        if (!title) missingArgs.push("title");
        if (Object.keys(changes).length === 0) missingArgs.push("changes");

        return basePlan({
            detectedIntent: "schedule_update",
            shouldUseTool: missingArgs.length === 0,
            toolName: "updateSchedule",
            toolArgs: {
                date,
                title,
                changes,
            },
            missingArgs,
            confirmationRequired: true,
            safety,
        });
    }

    if (/일정|스케줄/.test(text) && /(뭐|알려|보여|있어|확인)/.test(text)) {
        if (!allowScheduleActions) return parentToolDisabled("schedule", safety);
        if (!isAllowedParentTopic(text, parentSettings, ["일정", "스케줄", "루틴", "준비물", "숙제", "학교생활", "학원", "운동"])) {
            return parentAllowedTopicRestriction(parentSettings, safety);
        }
        const date = extractDate(text, referenceDate) || todayKey(referenceDate);
        return basePlan({
            detectedIntent: "schedule_query",
            shouldUseTool: true,
            toolName: date === todayKey(referenceDate) ? "getTodaySchedule" : "getScheduleByDate",
            toolArgs: { date },
            safety,
        });
    }

    if (isNaturalScheduleQuery(text)) {
        if (!allowScheduleActions) return parentToolDisabled("schedule", safety);
        if (!isAllowedParentTopic(text, parentSettings, ["일정", "스케줄", "루틴", "준비물", "숙제", "학교생활", "학원", "운동"])) {
            return parentAllowedTopicRestriction(parentSettings, safety);
        }
        const date = extractDate(text, referenceDate) || todayKey(referenceDate);
        return basePlan({
            detectedIntent: "schedule_query",
            shouldUseTool: true,
            toolName: date === todayKey(referenceDate) ? "getTodaySchedule" : "getScheduleByDate",
            toolArgs: { date },
            safety,
        });
    }

    if (/(추가|등록|저장)/.test(text) && !isMemorySaveRequest(text)) {
        if (!allowScheduleActions) return parentToolDisabled("schedule", safety);
        if (!isAllowedParentTopic(text, parentSettings, ["일정", "스케줄", "루틴", "준비물", "숙제", "학교생활", "학원", "운동"])) {
            return parentAllowedTopicRestriction(parentSettings, safety);
        }
        const date = extractDate(text, referenceDate);
        const startTime = extractTime(text);
        const endTime = extractEndTime(text);
        const title = extractScheduleTitle(text);
        const missingArgs = [];
        if (!date) missingArgs.push("date");
        if (!startTime) missingArgs.push("startTime");
        if (!title) missingArgs.push("title");

        return basePlan({
            detectedIntent: "schedule_create",
            shouldUseTool: missingArgs.length === 0,
            toolName: "createSchedule",
            toolArgs: {
                title,
                date,
                startTime,
                endTime,
            },
            missingArgs,
            safety,
        });
    }

    if (safety.riskLevel === "low") {
        if (!isAllowedParentTopic(text, parentSettings, EMOTIONAL_SUPPORT_TOPIC_ALIASES)) {
            return parentAllowedTopicRestriction(parentSettings, safety);
        }
        return basePlan({
            detectedIntent: "emotional_support",
            safety,
        });
    }

    if (!isAllowedParentTopic(text, parentSettings, GENERAL_CHAT_TOPIC_ALIASES)) {
        return parentAllowedTopicRestriction(parentSettings, safety);
    }

    return basePlan({ safety });
}

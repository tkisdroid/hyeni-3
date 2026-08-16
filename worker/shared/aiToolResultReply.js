function text(value, fallback = "") {
    const normalized = String(value || "").trim();
    return normalized || fallback;
}

function parentRoleLabel(parentRole) {
    if (parentRole === "mom") return "엄마";
    if (parentRole === "dad") return "아빠";
    return "보호자";
}

function missingArgs(plan = {}) {
    return Array.isArray(plan.missingArgs)
        ? plan.missingArgs.map((arg) => String(arg || "").trim()).filter(Boolean)
        : [];
}

function hasMissing(plan, arg) {
    return missingArgs(plan).includes(arg);
}

function timeRange(event = {}) {
    const start = text(event.time);
    const end = text(event.endTime);
    if (start && end) return `${start}-${end}`;
    return start || end;
}

function scheduleList(events = []) {
    return events
        .map((event) => {
            const title = text(event?.title, "일정");
            const time = timeRange(event);
            const detail = text(event?.supplies) || text(event?.memo);
            const label = time ? `${time} ${title}` : title;
            return detail ? `${label} (메모: ${detail})` : label;
        })
        .filter(Boolean)
        .slice(0, 5)
        .join(", ");
}

function disabledReply(error) {
    if (error === "schedule_actions_disabled") {
        return "지금은 일정 기능이 꺼져 있어. 부모님 설정이 필요해.";
    }
    if (error === "contact_actions_disabled") {
        return "지금은 연락 기능이 꺼져 있어. 부모님 설정이 필요해.";
    }
    return "";
}

function failureReply(result = {}) {
    const disabled = disabledReply(result.error);
    if (disabled) return disabled;

    if (result.error === "parent_contact_not_found") {
        return `${parentRoleLabel(result.parentRole)} 연락처가 아직 없어서 바로 전화할 수 없어. 부모님 설정이 필요해.`;
    }
    if (result.error === "schedule_not_found") {
        const title = text(result.title, "그");
        const date = text(result.date);
        const prefix = date ? `${date}에 ` : "";
        return `${prefix}${title} 일정을 찾지 못했어. 날짜나 이름을 다시 알려줘.`;
    }
    if (result.error === "invalid_schedule_time_range") {
        return "끝나는 시간은 시작 시간보다 늦어야 해. 시간을 다시 알려줘.";
    }
    if (result.error === "daily_supply_limit_exceeded") {
        return "오늘은 8개까지만 담을 수 있어. 하나만 빼면 더 넣을 수 있어.";
    }
    if (result.error === "schedule_delete_parent_only") {
        return "일정 지우는 건 부모님만 할 수 있어. 엄마나 아빠에게 말해 줄까?";
    }
    if (String(result.error || "").startsWith("schedule_")) {
        return "일정을 처리하지 못했어. 잠시 후 다시 해보자.";
    }
    if (String(result.error || "").startsWith("parent_message_") || result.error === "invalid_parent_message") {
        return "부모님께 보낼 메시지를 준비하지 못했어. 조금 짧게 다시 말해줘.";
    }
    return "";
}

export function buildAgentPlanChildReply(plan = {}) {
    const intent = String(plan.detectedIntent || "");

    if (intent === "parent_tool_disabled") {
        const toolFamily = String(plan.toolArgs?.toolFamily || "");
        if (toolFamily === "contact") return "지금은 연락 기능이 꺼져 있어. 부모님 설정이 필요해.";
        if (toolFamily === "schedule") return "지금은 일정 기능이 꺼져 있어. 부모님 설정이 필요해.";
        return "지금은 이 기능이 꺼져 있어. 부모님 설정이 필요해.";
    }

    if (intent === "external_contact_rejected") {
        return "부모님이나 보호자에게만 연락을 도와줄 수 있어.";
    }

    if (intent === "schedule_delete_parent_only") {
        return "일정 지우는 건 부모님만 할 수 있어. 엄마나 아빠에게 말해 줄까?";
    }

    if (intent === "parent_locked_setting") {
        return "그 설정은 부모님이 정하는 거야. 바꾸고 싶으면 엄마나 아빠에게 말해 줄까?";
    }

    if (intent === "settings_accent" && hasMissing(plan, "accent")) {
        return "무슨 색으로 바꿀까? 핑크, 살구, 보라, 민트, 하늘, 레몬 중에 골라줘.";
    }

    if (intent === "daily_item_create" && hasMissing(plan, "label")) {
        return plan.toolArgs?.kind === "hw" ? "어떤 숙제를 넣을까?" : "어떤 준비물을 넣을까?";
    }

    if (missingArgs(plan).length === 0) return "";

    if (intent === "message_parent" && hasMissing(plan, "parentRole")) {
        if (hasMissing(plan, "message")) return "누구에게 어떤 말을 보낼까?";
        return "누구에게 보낼까?";
    }

    if (intent === "message_parent" && hasMissing(plan, "message")) {
        return `${parentRoleLabel(plan.toolArgs?.parentRole)}에게 어떤 말을 보낼까?`;
    }

    if (intent === "schedule_create") {
        if (hasMissing(plan, "startTime")) return "몇 시에 추가할까?";
        if (hasMissing(plan, "date")) return "언제 일정인지 알려줘.";
        if (hasMissing(plan, "title")) return "어떤 일정인지 알려줘.";
    }

    if (intent === "schedule_delete" || intent === "schedule_delete_parent_only") {
        return "일정 지우는 건 부모님만 할 수 있어. 엄마나 아빠에게 말해 줄까?";
    }

    if (intent === "schedule_update") {
        if (hasMissing(plan, "changes")) return "무엇을 어떻게 바꿀까?";
        if (hasMissing(plan, "date") || hasMissing(plan, "title")) return "언제 어떤 일정을 바꿀까?";
    }

    return "";
}

export function buildToolResultChildReply(result) {
    if (!result || typeof result !== "object") return "";
    if (result.ok === false) return failureReply(result);

    const toolName = String(result.toolName || "");
    if (toolName === "createSchedule") {
        const title = text(result.event?.title, "일정");
        const time = timeRange(result.event);
        return time ? `${title} 일정을 ${time}에 추가했어.` : `${title} 일정을 추가했어.`;
    }
    if (toolName === "createDailyItem") {
        const kindLabel = result.kind === "hw" ? "숙제" : "준비물";
        if (result.duplicate) return `「${text(result.label, kindLabel)}」는 이미 들어 있어.`;
        return `「${text(result.label, kindLabel)}」 ${kindLabel}에 넣었어.`;
    }
    if (toolName === "setChildAccent") {
        return `${text(result.label, "그")} 색으로 바꿔 줄게.`;
    }
    if (toolName === "deleteSchedule") {
        return "일정 지우는 건 부모님만 할 수 있어. 엄마나 아빠에게 말해 줄까?";
    }
    if (toolName === "updateSchedule") {
        const title = text(result.event?.title, "일정");
        const currentTime = timeRange(result.event);
        const nextTime = timeRange({
            time: result.changes?.startTime || result.event?.time,
            endTime: result.changes?.endTime || result.event?.endTime,
        });
        if (currentTime && nextTime && currentTime !== nextTime) {
            return `${title} 일정을 ${currentTime}에서 ${nextTime}로 바꿀지 확인해줘.`;
        }
        return `${title} 일정을 바꿀지 확인해줘.`;
    }
    if (toolName === "getTodaySchedule" || toolName === "getScheduleByDate") {
        const events = Array.isArray(result.events) ? result.events : [];
        const label = toolName === "getTodaySchedule" ? "오늘" : text(result.date, "그날");
        if (events.length === 0) return `${label} 일정은 아직 없어.`;
        return `${label} 일정은 ${scheduleList(events)}야.`;
    }
    if (toolName === "callParent") {
        return `${text(result.displayName, parentRoleLabel(result.parentRole))}에게 전화할 준비가 됐어. 아래 전화 버튼을 눌러줘.`;
    }
    if (toolName === "createMessageToParent") {
        return `${text(result.displayName, parentRoleLabel(result.parentRole))}에게 보낼 말을 준비했어. 보내기 전에 한 번 확인해줘.`;
    }
    if (toolName === "notifyParent") {
        return result.parentNotified
            ? "걱정되는 일이 있어서 보호자에게 알림을 남겼어. 가까운 어른에게도 바로 말해줘."
            : "걱정되는 일이 있어. 지금 가까운 어른에게 바로 말해줘.";
    }
    return "";
}

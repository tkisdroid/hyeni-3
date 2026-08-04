export interface AiFriendControlForm {
  forbiddenTopicsText: string;
  proactiveEnabled: boolean;
  proactiveStartTime: string;
  proactiveEndTime: string;
  quietHoursStart: string;
  quietHoursEnd: string;
  allowScheduleActions: boolean;
  allowContactActions: boolean;
}

export interface AiFriendControlPatch {
  forbidden_topics: string[];
  proactive_enabled: boolean;
  proactive_start_time: string;
  proactive_end_time: string;
  quiet_hours_start: string;
  quiet_hours_end: string;
  allow_schedule_actions: boolean;
  allow_contact_actions: boolean;
}

export interface AiFriendControlSource {
  forbidden_topics?: string[] | null;
  proactive_enabled?: boolean | null;
  proactive_start_time?: string | null;
  proactive_end_time?: string | null;
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
  allow_schedule_actions?: boolean | null;
  allow_contact_actions?: boolean | null;
}

export function parseAiTopicText(value: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  String(value || "")
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => {
      if (seen.has(item)) return;
      seen.add(item);
      out.push(item);
    });

  return out.slice(0, 20);
}

export function aiTopicsToText(value: string[] | null | undefined): string {
  return Array.isArray(value) ? value.filter(Boolean).join("\n") : "";
}

export function normalizeAiControlTime(value: string | null | undefined, fallback: string): string {
  const raw = String(value || "").trim();
  if (/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(raw)) return raw;
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(fallback) ? fallback : "08:00";
}

export function buildAiFriendControlPatch(form: AiFriendControlForm): AiFriendControlPatch {
  return {
    forbidden_topics: parseAiTopicText(form.forbiddenTopicsText),
    proactive_enabled: form.proactiveEnabled,
    proactive_start_time: normalizeAiControlTime(form.proactiveStartTime, "08:00"),
    proactive_end_time: normalizeAiControlTime(form.proactiveEndTime, "20:00"),
    quiet_hours_start: normalizeAiControlTime(form.quietHoursStart, "21:00"),
    quiet_hours_end: normalizeAiControlTime(form.quietHoursEnd, "07:00"),
    allow_schedule_actions: form.allowScheduleActions,
    allow_contact_actions: form.allowContactActions,
  };
}

/** 화면 초깃값과 같은 의미의 정규화된 입력은 미저장 변경으로 취급하지 않는다. */
export function isAiFriendControlFormDirty(
  form: AiFriendControlForm,
  source: AiFriendControlSource | null | undefined,
): boolean {
  const draft = buildAiFriendControlPatch(form);
  const saved = buildAiFriendControlPatch({
    forbiddenTopicsText: aiTopicsToText(source?.forbidden_topics),
    proactiveEnabled: source?.proactive_enabled ?? false,
    proactiveStartTime: source?.proactive_start_time ?? "08:00",
    proactiveEndTime: source?.proactive_end_time ?? "20:00",
    quietHoursStart: source?.quiet_hours_start ?? "21:00",
    quietHoursEnd: source?.quiet_hours_end ?? "07:00",
    allowScheduleActions: source?.allow_schedule_actions ?? true,
    allowContactActions: source?.allow_contact_actions ?? true,
  });
  return draft.proactive_enabled !== saved.proactive_enabled
    || draft.proactive_start_time !== saved.proactive_start_time
    || draft.proactive_end_time !== saved.proactive_end_time
    || draft.quiet_hours_start !== saved.quiet_hours_start
    || draft.quiet_hours_end !== saved.quiet_hours_end
    || draft.allow_schedule_actions !== saved.allow_schedule_actions
    || draft.allow_contact_actions !== saved.allow_contact_actions
    || draft.forbidden_topics.length !== saved.forbidden_topics.length
    || draft.forbidden_topics.some((topic, index) => topic !== saved.forbidden_topics[index]);
}

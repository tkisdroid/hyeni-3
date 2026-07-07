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

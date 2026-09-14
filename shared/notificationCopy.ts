import { notificationCatalog } from "./generated/notificationCatalog.ts";
import { normalizeTimeZone } from "./timeZone.ts";

import { definitions } from "./notificationDefinitions.ts";
export type NotificationCopyId = keyof typeof definitions;
export interface NotificationCopy {
  v: 1;
  id: NotificationCopyId;
  args: Record<string, string | number>;
  occurredAt?: string;
  timeZone?: string;
  delayed?: boolean;
}

/** 알림 표시 전용 계약. 권한·수신자·긴급도·TTL·라우트는 이 객체로 바꾸지 않는다. */
export function normalizeNotificationCopy(value: unknown): NotificationCopy | null {
  if (typeof value === "string") {
    if (value.length > 2200) return null;
    try { value = JSON.parse(value); } catch { return null; }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.v !== 1 || typeof row.id !== "string" || !Object.hasOwn(definitions, row.id)) return null;
  const id = row.id as NotificationCopyId;
  const source = row.args && typeof row.args === "object" && !Array.isArray(row.args) ? row.args as Record<string, unknown> : {};
  const args: NotificationCopy["args"] = {};
  for (const key of definitions[id].slice(1)) {
    const raw = source[key];
    if (key === "minutes" || key === "hours") {
      if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > 525600) return null;
      args[key] = Math.round(raw);
    } else {
      args[key] = typeof raw === "string" ? raw.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "").trim().slice(0, 200) : "";
    }
  }
  const result: NotificationCopy = { v: 1, id, args };
  if (typeof row.occurredAt === "string" && Number.isFinite(Date.parse(row.occurredAt))) {
    const zone = normalizeTimeZone(row.timeZone);
    if (zone) { result.occurredAt = new Date(row.occurredAt).toISOString(); result.timeZone = zone; }
  }
  if (row.delayed === true) result.delayed = true;
  return result;
}

export function makeNotificationCopy(id: NotificationCopyId, args: Record<string, unknown> = {}): NotificationCopy {
  const copy = normalizeNotificationCopy({ v: 1, id, args });
  if (!copy) throw Error("invalid_notification_copy");
  return copy;
}

export function formatNotificationCopy(value: unknown, language: string): { title: string; body: string } | null {
  const copy = normalizeNotificationCopy(value);
  if (!copy || language === "ko") return null; // 기존 한국어 문구와 구버전 payload는 그대로 보존한다.
  const locale = Object.hasOwn(notificationCatalog, language) ? language as keyof typeof notificationCatalog : "en";
  const catalog: Record<string, string> = notificationCatalog[locale];
  const body = catalog[copy.id].replace(/\{([a-zA-Z]+)\}/g, (_, key: string) => {
    const raw = copy.args[key];
    if (typeof raw === "number") return new Intl.NumberFormat(locale).format(raw);
    return raw || catalog[`default.${key === "from" ? "place" : key}`] || "";
  });
  let detail = body;
  if (copy.occurredAt && copy.timeZone) {
    detail += "\n" + new Intl.DateTimeFormat(locale, { timeZone: copy.timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(copy.occurredAt));
  }
  if (copy.delayed) detail += "\n" + catalog.delayed;
  return { title: catalog[`title.${definitions[copy.id][0]}`], body: detail };
}

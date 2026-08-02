export interface EventOccurrenceIdentity {
  eventId: string;
  dateKey: string;
  updatedAt: string;
}

export function eventRevisionKey(updatedAt: string): string {
  return String(updatedAt || "").replace(/[^0-9A-Za-z]/g, "").slice(0, 32) || "legacy";
}

export function eventOccurrenceAlertId(event: EventOccurrenceIdentity): string {
  return `${event.eventId}:${event.dateKey}:${eventRevisionKey(event.updatedAt)}`;
}

export function eventReminderPushId(event: EventOccurrenceIdentity, windowKey: string): string {
  return `${event.eventId}-${windowKey}-${event.dateKey}-${eventRevisionKey(event.updatedAt)}`;
}

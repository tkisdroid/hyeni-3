import type { CalendarEvent } from "@/lib/api/endpoints/schedule";

/**
 * 일정 소유권 규칙.
 * - 가족 공유 일정: is_family_event=true
 * - 아이 일정: events_children.child_id 에 해당 아이 member id 가 명시됨
 * - 둘 다 아니면 배정 누락 데이터로 보고 아이별 화면에는 노출하지 않음
 */
export function eventChildMemberIds(event: CalendarEvent): string[] {
  const out = new Set<string>();
  for (const link of event.events_children ?? []) {
    const id = typeof link.child_id === "string" ? link.child_id.trim() : "";
    if (id) out.add(id);
  }
  return [...out];
}

export function eventIsFamilyShared(event: CalendarEvent): boolean {
  return event.is_family_event === true;
}

export function eventAppliesToChild(
  event: CalendarEvent,
  childMemberId: string | null | undefined,
): boolean {
  if (eventIsFamilyShared(event)) return true;
  if (!childMemberId) return false;
  return eventChildMemberIds(event).includes(childMemberId);
}

export function filterEventsForChild<T extends CalendarEvent>(
  events: readonly T[],
  childMemberId: string | null | undefined,
): T[] {
  if (!childMemberId) return [];
  return events.filter((event) => eventAppliesToChild(event, childMemberId));
}

export function eventScopeLabel(event: CalendarEvent): "가족 일정" | "배정 필요" | "" {
  if (eventIsFamilyShared(event)) return "가족 일정";
  return eventChildMemberIds(event).length === 0 ? "배정 필요" : "";
}

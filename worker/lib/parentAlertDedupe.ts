/** 부모 알림 멱등 범위는 가족 안으로 한정한다. */
export function canonicalParentAlertType(alertType: string): string {
  const normalized = String(alertType || "").trim();
  if (normalized === "arrived" || normalized === "late_arrived" || normalized === "place_arrived") {
    return "arrived";
  }
  return normalized;
}

export function parentAlertDedupeKey(
  familyId: string,
  alertType: string,
  eventId: string,
): string {
  return JSON.stringify([familyId, canonicalParentAlertType(alertType), eventId]);
}

export function parentAlertDeliveryKey(alertType: string, eventId: string): string {
  return `parent-alert:${canonicalParentAlertType(alertType)}:${eventId}`;
}

export function parentAlertPendingId(
  pushId: string,
  parentUserId: string,
): string {
  return `parent-alert-${pushId}-${parentUserId}`;
}

export function parentAlertRecipientClaimKey(pushId: string, parentUserId: string): string {
  return `${pushId}:${parentUserId}`;
}

export function shouldRetryParentRecipientDelivery(input: {
  hasNativeChannel: boolean;
  hasWebChannel: boolean;
  delivered: boolean;
}): boolean {
  return (input.hasNativeChannel || input.hasWebChannel) && !input.delivered;
}

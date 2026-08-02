export function parentAlertTargetRoute(
  baseRoute: "/sos-receive" | "/notifications",
  alertId: string,
  childUserId: string | null,
): string {
  const alertPart = `alert=${encodeURIComponent(alertId)}`;
  if (baseRoute !== "/sos-receive" || !childUserId) {
    return `${baseRoute}?${alertPart}`;
  }
  return `${baseRoute}?${alertPart}&child=${encodeURIComponent(childUserId)}`;
}

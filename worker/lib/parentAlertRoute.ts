export function parentAlertTargetRoute(
  baseRoute: "/sos-receive" | "/notifications" | "/ai-credit",
  alertId: string,
  childUserId: string | null,
): string {
  const alertPart = `alert=${encodeURIComponent(alertId)}`;
  // 대상 아이가 분명해야 하는 화면만 child 를 함께 싣는다. 다자녀 가족에서 부모가
  // 보고 있던 아이가 요청한 아이와 다를 수 있어, 활성 아이 폴백에 맡기지 않는다.
  const needsChild = baseRoute === "/sos-receive" || baseRoute === "/ai-credit";
  if (!needsChild || !childUserId) {
    return `${baseRoute}?${alertPart}`;
  }
  return `${baseRoute}?${alertPart}&child=${encodeURIComponent(childUserId)}`;
}

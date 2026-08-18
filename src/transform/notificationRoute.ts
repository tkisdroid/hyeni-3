export type NotificationRouteRole = "parent" | "child";

const ROUTES: Record<NotificationRouteRole, ReadonlySet<string>> = {
  parent: new Set([
    "/parent/home",
    "/parent/calendar",
    "/parent/location",
    "/parent/memo",
    "/notifications",
    "/arrival-alerts",
    "/danger-alert",
    "/sos-receive",
  ]),
  child: new Set([
    "/child/home",
    "/child/memo",
    "/child/sos",
    "/child/sticker",
    "/child/ai-friend",
  ]),
};

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

function fallback(role: NotificationRouteRole): string {
  return role === "parent" ? "/parent/home" : "/child/home";
}

function hasOneSafeValue(params: URLSearchParams, key: string): boolean {
  const values = params.getAll(key);
  return values.length === 1 && SAFE_ID.test(values[0] ?? "");
}

/** 역할별 허용 경로와 필요한 식별자 query만 보존한다. */
export function sanitizeNotificationRoute(
  rawRoute: unknown,
  role: NotificationRouteRole,
): string {
  if (typeof rawRoute !== "string") return fallback(role);
  const route = rawRoute.trim().replace(/^#/, "");
  if (!route.startsWith("/") || route.includes("..") || route.includes(":")) return fallback(role);

  const queryIndex = route.indexOf("?");
  const path = queryIndex >= 0 ? route.slice(0, queryIndex) : route;
  if (!ROUTES[role].has(path)) return fallback(role);
  if (queryIndex < 0) return path;
  if (role !== "parent") return fallback(role);

  const params = new URLSearchParams(route.slice(queryIndex + 1));
  const keys = [...params.keys()];
  if (path === "/parent/memo") {
    return keys.length === 1 && keys[0] === "child" && hasOneSafeValue(params, "child")
      ? `${path}?${params.toString()}`
      : fallback(role);
  }
  if (path === "/notifications") {
    return keys.length === 1 && keys[0] === "alert" && hasOneSafeValue(params, "alert")
      ? `${path}?${params.toString()}`
      : fallback(role);
  }
  // 하루 대시보드는 알림이 지정한 아이를 그대로 연다(활성 아이 폴백 금지).
  if (path === "/child-digest") {
    const allowedKeys = keys.every((key) => key === "alert" || key === "child");
    const uniqueKeys = new Set(keys).size === keys.length;
    const childValid = !params.has("child") || hasOneSafeValue(params, "child");
    return allowedKeys && uniqueKeys && hasOneSafeValue(params, "alert") && childValid
      ? `${path}?${params.toString()}`
      : fallback(role);
  }
  if (path === "/sos-receive") {
    const allowedKeys = keys.every((key) => key === "alert" || key === "child");
    const uniqueKeys = new Set(keys).size === keys.length;
    const childValid = !params.has("child") || hasOneSafeValue(params, "child");
    return allowedKeys && uniqueKeys && hasOneSafeValue(params, "alert") && childValid
      ? `${path}?${params.toString()}`
      : fallback(role);
  }
  return fallback(role);
}

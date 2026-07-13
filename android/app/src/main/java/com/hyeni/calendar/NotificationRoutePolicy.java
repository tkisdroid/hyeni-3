package com.hyeni.calendar;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/** 알림 탭으로 열 수 있는 HashRouter 경로를 현재 역할 기준으로 제한한다. */
public final class NotificationRoutePolicy {

    private static final Set<String> PARENT_ROUTES = new HashSet<>(Arrays.asList(
        "/parent/home",
        "/parent/calendar",
        "/parent/location",
        "/parent/memo",
        "/notifications",
        "/arrival-alerts",
        "/danger-alert",
        "/sos-receive"
    ));

    private static final Set<String> CHILD_ROUTES = new HashSet<>(Arrays.asList(
        "/child/home",
        "/child/memo",
        "/child/sos",
        "/child/sticker",
        "/child/ai-friend"
    ));

    private static final String SAFE_IDENTIFIER = "[A-Za-z0-9_-]{1,128}";
    private static final Pattern PARENT_MEMO_QUERY = Pattern.compile(
        "^/parent/memo\\?child=" + SAFE_IDENTIFIER + "$"
    );
    private static final Pattern SOS_RECEIVE_QUERY = Pattern.compile(
        "^/sos-receive\\?alert=" + SAFE_IDENTIFIER + "&child=" + SAFE_IDENTIFIER + "$"
    );
    private static final Pattern NOTIFICATIONS_QUERY = Pattern.compile(
        "^/notifications\\?alert=" + SAFE_IDENTIFIER + "$"
    );

    private NotificationRoutePolicy() {}

    public static String resolveHashRoute(String rawRoute, String rawRole) {
        String role = clean(rawRole).toLowerCase(Locale.ROOT);
        String route = clean(rawRoute);
        if (route.startsWith("#")) route = route.substring(1);
        if ("child-memo".equals(route)) route = "/child/memo";
        if ("child-sticker".equals(route)) route = "/child/sticker";
        if ("ai-chat".equals(route)) route = "/child/ai-friend";
        if (!route.startsWith("/") || route.contains("..") || route.contains(":")) return null;
        if ("parent".equals(role) && isAllowedParentRoute(route)) return "#" + route;
        if ("child".equals(role) && CHILD_ROUTES.contains(route)) return "#" + route;
        return null;
    }

    private static boolean isAllowedParentRoute(String route) {
        return PARENT_ROUTES.contains(route)
            || PARENT_MEMO_QUERY.matcher(route).matches()
            || SOS_RECEIVE_QUERY.matcher(route).matches()
            || NOTIFICATIONS_QUERY.matcher(route).matches();
    }

    private static String clean(String value) {
        return value == null ? "" : value.trim();
    }
}

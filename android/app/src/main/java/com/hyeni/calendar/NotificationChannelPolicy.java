package com.hyeni.calendar;

import java.util.Locale;

/** FCM·WebView pending·네이티브 폴링이 공유하는 논리 알림 채널 정책. */
final class NotificationChannelPolicy {
    private NotificationChannelPolicy() {}

    static String channelFor(String type, String alertType, boolean urgent) {
        String normalizedType = normalize(type);
        String normalizedAlertType = normalize(alertType);

        if (urgent) return "emergency";
        if ("kkuk".equals(normalizedType)) return "kkuk";
        if (isChildMessage(normalizedType)) return "child_message";
        if (isSafety(normalizedType, normalizedAlertType)) return "safety";
        return "schedule";
    }

    private static boolean isChildMessage(String type) {
        return "new_memo".equals(type)
            || "memo".equals(type)
            || "ai_proactive".equals(type)
            || "sticker".equals(type);
    }

    private static boolean isSafety(String type, String alertType) {
        if ("parent_alert".equals(type)
            || "child_safety".equals(type)
            || "location_alert".equals(type)
            || "arrival".equals(type)
            || "departure".equals(type)) {
            return true;
        }
        return "arrived".equals(alertType)
            || "departed".equals(alertType)
            || "place_arrived".equals(alertType)
            || "place_left".equals(alertType)
            || "danger_enter".equals(alertType)
            || "danger_exit".equals(alertType)
            || "danger_zone".equals(alertType)
            || "danger_zone_entry".equals(alertType)
            || "danger_zone_exit".equals(alertType)
            || "not_arrived".equals(alertType)
            || "missed_arrival".equals(alertType);
    }

    private static String normalize(String value) {
        return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
    }
}

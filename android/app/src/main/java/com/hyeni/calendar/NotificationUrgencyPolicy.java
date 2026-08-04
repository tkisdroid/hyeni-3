package com.hyeni.calendar;

final class NotificationUrgencyPolicy {
    private NotificationUrgencyPolicy() {}

    static boolean isEmergency(String type, String urgent, String severity, String alertType) {
        String normalizedType = normalized(type);
        String normalizedAlertType = normalized(alertType);
        if ("sos".equals(normalizedType)) return true;
        if (neverUsesFullScreen(normalizedType) || neverUsesFullScreen(normalizedAlertType)) return false;
        if ("emergency".equals(normalizedType)) return true;

        String explicitUrgent = normalized(urgent);
        if ("true".equals(explicitUrgent)) return true;
        if ("false".equals(explicitUrgent)) return false;
        if (!"parent_alert".equals(normalizedType)) return false;

        String normalizedSeverity = normalized(severity);
        if ("emergency".equals(normalizedSeverity)
                || "critical".equals(normalizedSeverity)
                || "urgent".equals(normalizedSeverity)) {
            return true;
        }

        return "danger_zone".equals(normalizedAlertType)
                || "danger_enter".equals(normalizedAlertType)
                || "danger_entry".equals(normalizedAlertType)
                || "sos".equals(normalizedAlertType)
                || "sos_followup".equals(normalizedAlertType);
    }

    private static boolean neverUsesFullScreen(String value) {
        return "schedule".equals(value)
                || "schedule_reminder".equals(value)
                || "event_reminder".equals(value)
                || "new_memo".equals(value)
                || "memo".equals(value)
                || "not_arrived".equals(value)
                || "missed_arrival".equals(value);
    }

    private static String normalized(String value) {
        return value == null ? "" : value.trim().toLowerCase(java.util.Locale.ROOT);
    }
}

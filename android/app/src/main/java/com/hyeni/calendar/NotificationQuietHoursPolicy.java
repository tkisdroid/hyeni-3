package com.hyeni.calendar;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/** 알림 표시 여부만 판단하며 Android 시스템 상태에는 접근하지 않는 순수 정책이다. */
final class NotificationQuietHoursPolicy {
    private static final int MINUTES_PER_DAY = 24 * 60;

    private static final Set<String> COMMAND_TYPES = new HashSet<>(Arrays.asList(
        "request_location",
        "request_device_status",
        "notification_quiet_hours_updated"
    ));

    private static final Set<String> BYPASS_TYPES = new HashSet<>(Arrays.asList(
        "sos",
        "emergency",
        "force_ring",
        "force_ring_stop",
        "force_ring_reminder",
        "remote_listen",
        "remote_listen_stop"
    ));

    private static final Set<String> BYPASS_ALERT_TYPES = new HashSet<>(Arrays.asList(
        "sos",
        "emergency",
        "sos_followup",
        "not_arrived",
        "missed_arrival",
        "danger_zone",
        "danger_enter",
        "danger_entry",
        "danger_exit"
    ));

    enum Decision {
        ALLOW,
        SUPPRESS,
        COMMAND
    }

    static final class NotificationIdentity {
        final String type;
        final String alertType;

        private NotificationIdentity(String type, String alertType) {
            this.type = type == null ? "" : type;
            this.alertType = alertType == null ? "" : alertType;
        }

        static NotificationIdentity of(String type, String alertType) {
            return new NotificationIdentity(type, alertType);
        }
    }

    private NotificationQuietHoursPolicy() {}

    static boolean isMinuteInsideWindow(
        boolean enabled,
        int startMinute,
        int endMinute,
        int nowMinute
    ) {
        if (!enabled
            || !isMinuteOfDay(startMinute)
            || !isMinuteOfDay(endMinute)
            || !isMinuteOfDay(nowMinute)
            || startMinute == endMinute) {
            return false;
        }
        return startMinute < endMinute
            ? startMinute <= nowMinute && nowMinute < endMinute
            : nowMinute >= startMinute || nowMinute < endMinute;
    }

    static Decision decide(
        NotificationQuietHoursStore.Snapshot snapshot,
        NotificationIdentity identity,
        long nowMs
    ) {
        NotificationIdentity resolvedIdentity = identity != null
            ? identity
            : NotificationIdentity.of("", "");
        if (COMMAND_TYPES.contains(resolvedIdentity.type)) {
            return Decision.COMMAND;
        }
        if (BYPASS_TYPES.contains(resolvedIdentity.type)
            || BYPASS_ALERT_TYPES.contains(resolvedIdentity.alertType)) {
            return Decision.ALLOW;
        }
        if (!isUsableSnapshot(snapshot)) {
            return Decision.ALLOW;
        }
        return isMinuteInsideWindow(
            snapshot.enabled,
            snapshot.startMinute,
            snapshot.endMinute,
            minuteOfDay(nowMs, snapshot.timeZoneId)
        ) ? Decision.SUPPRESS : Decision.ALLOW;
    }

    private static boolean isUsableSnapshot(NotificationQuietHoursStore.Snapshot snapshot) {
        return snapshot != null
            && !snapshot.userId.isEmpty()
            && snapshot.updatedAtMs >= 0L
            && NotificationQuietHoursStore.isValidTimeZone(snapshot.timeZoneId)
            && isMinuteOfDay(snapshot.startMinute)
            && isMinuteOfDay(snapshot.endMinute)
            && snapshot.startMinute != snapshot.endMinute;
    }

    private static int minuteOfDay(long nowMs, String timeZoneId) {
        java.util.Calendar calendar = java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone(timeZoneId));
        calendar.setTimeInMillis(nowMs);
        return calendar.get(java.util.Calendar.HOUR_OF_DAY) * 60 + calendar.get(java.util.Calendar.MINUTE);
    }

    private static boolean isMinuteOfDay(int value) {
        return value >= 0 && value < MINUTES_PER_DAY;
    }
}

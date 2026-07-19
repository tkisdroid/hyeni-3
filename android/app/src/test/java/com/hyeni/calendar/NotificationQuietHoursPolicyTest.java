package com.hyeni.calendar;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.TimeZone;

import org.junit.Test;

public class NotificationQuietHoursPolicyTest {
    private static final long KST_22_00 = 1_784_379_600_000L;

    @Test
    public void disabledWindowNeverSuppresses() {
        assertFalse(NotificationQuietHoursPolicy.isMinuteInsideWindow(false, 1320, 420, 1320));
        assertFalse(NotificationQuietHoursPolicy.isMinuteInsideWindow(false, 1320, 420, 0));
    }

    @Test
    public void sameDayWindowIncludesStartAndExcludesEnd() {
        assertTrue(NotificationQuietHoursPolicy.isMinuteInsideWindow(true, 780, 900, 780));
        assertTrue(NotificationQuietHoursPolicy.isMinuteInsideWindow(true, 780, 900, 899));
        assertFalse(NotificationQuietHoursPolicy.isMinuteInsideWindow(true, 780, 900, 900));
        assertFalse(NotificationQuietHoursPolicy.isMinuteInsideWindow(true, 780, 900, 600));
    }

    @Test
    public void overnightWindowIncludesStartAndExcludesEnd() {
        assertTrue(NotificationQuietHoursPolicy.isMinuteInsideWindow(true, 1320, 420, 1320));
        assertTrue(NotificationQuietHoursPolicy.isMinuteInsideWindow(true, 1320, 420, 0));
        assertFalse(NotificationQuietHoursPolicy.isMinuteInsideWindow(true, 1320, 420, 420));
        assertFalse(NotificationQuietHoursPolicy.isMinuteInsideWindow(true, 1320, 420, 900));
    }

    @Test
    public void invalidWindowFailsOpen() {
        assertFalse(NotificationQuietHoursPolicy.isMinuteInsideWindow(true, 600, 600, 600));
        assertFalse(NotificationQuietHoursPolicy.isMinuteInsideWindow(true, -1, 420, 0));
        assertFalse(NotificationQuietHoursPolicy.isMinuteInsideWindow(true, 1320, 1440, 0));
        assertFalse(NotificationQuietHoursPolicy.isMinuteInsideWindow(true, 1320, 420, -1));
        assertFalse(NotificationQuietHoursPolicy.isMinuteInsideWindow(true, 1320, 420, 1440));
    }

    @Test
    public void decisionUsesFixedSeoulTimeRegardlessOfJvmDefault() {
        TimeZone original = TimeZone.getDefault();
        try {
            TimeZone.setDefault(TimeZone.getTimeZone("America/Los_Angeles"));
            assertEquals(
                NotificationQuietHoursPolicy.Decision.SUPPRESS,
                NotificationQuietHoursPolicy.decide(
                    activeSnapshot(),
                    NotificationQuietHoursPolicy.NotificationIdentity.of("schedule_reminder", ""),
                    KST_22_00
                )
            );
        } finally {
            TimeZone.setDefault(original);
        }
    }

    @Test
    public void normalNotificationsIncludingKkukAreSuppressedInsideWindow() {
        String[] quietTypes = {
            "parent_alert", "schedule_reminder", "new_memo", "sticker", "kkuk",
            "playdate_started", "ai_proactive", "teacher_notice"
        };
        for (String type : quietTypes) {
            assertEquals(
                type,
                NotificationQuietHoursPolicy.Decision.SUPPRESS,
                NotificationQuietHoursPolicy.decide(
                    activeSnapshot(),
                    NotificationQuietHoursPolicy.NotificationIdentity.of(type, "arrived"),
                    KST_22_00
                )
            );
        }
    }

    @Test
    public void explicitSafetyAndDirectFlowTypesAlwaysAllow() {
        String[] bypassTypes = {
            "sos", "emergency", "force_ring", "force_ring_stop", "force_ring_reminder",
            "remote_listen", "remote_listen_stop"
        };
        for (String type : bypassTypes) {
            assertEquals(
                type,
                NotificationQuietHoursPolicy.Decision.ALLOW,
                NotificationQuietHoursPolicy.decide(
                    activeSnapshot(),
                    NotificationQuietHoursPolicy.NotificationIdentity.of(type, ""),
                    KST_22_00
                )
            );
        }

        String[] bypassAlertTypes = {
            "sos", "emergency", "sos_followup", "not_arrived", "missed_arrival",
            "danger_zone", "danger_enter", "danger_entry", "danger_exit"
        };
        for (String alertType : bypassAlertTypes) {
            assertEquals(
                alertType,
                NotificationQuietHoursPolicy.Decision.ALLOW,
                NotificationQuietHoursPolicy.decide(
                    activeSnapshot(),
                    NotificationQuietHoursPolicy.NotificationIdentity.of("parent_alert", alertType),
                    KST_22_00
                )
            );
        }
    }

    @Test
    public void nativeCommandsAreNotDisplayNotifications() {
        String[] commandTypes = {
            "request_location", "request_device_status", "notification_quiet_hours_updated"
        };
        for (String type : commandTypes) {
            assertEquals(
                type,
                NotificationQuietHoursPolicy.Decision.COMMAND,
                NotificationQuietHoursPolicy.decide(
                    activeSnapshot(),
                    NotificationQuietHoursPolicy.NotificationIdentity.of(type, ""),
                    KST_22_00
                )
            );
        }
    }

    @Test
    public void malformedSnapshotFailsOpenForOrdinaryNotification() {
        NotificationQuietHoursStore.Snapshot malformed = new NotificationQuietHoursStore.Snapshot(
            "parent-1", true, 600, 600, "Asia/Seoul", 100L
        );
        NotificationQuietHoursStore.Snapshot wrongZone = new NotificationQuietHoursStore.Snapshot(
            "parent-1", true, 1320, 420, "UTC", 100L
        );
        NotificationQuietHoursPolicy.NotificationIdentity identity =
            NotificationQuietHoursPolicy.NotificationIdentity.of("schedule_reminder", "");

        assertEquals(
            NotificationQuietHoursPolicy.Decision.ALLOW,
            NotificationQuietHoursPolicy.decide(malformed, identity, KST_22_00)
        );
        assertEquals(
            NotificationQuietHoursPolicy.Decision.ALLOW,
            NotificationQuietHoursPolicy.decide(wrongZone, identity, KST_22_00)
        );
    }

    private static NotificationQuietHoursStore.Snapshot activeSnapshot() {
        return new NotificationQuietHoursStore.Snapshot(
            "parent-1", true, 1320, 420, "Asia/Seoul", 100L
        );
    }
}

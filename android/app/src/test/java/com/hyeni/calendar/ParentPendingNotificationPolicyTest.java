package com.hyeni.calendar;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class ParentPendingNotificationPolicyTest {

    @Test
    public void warningWithoutUrgentNeverUsesFullScreen() {
        assertFalse(NotificationPlugin.shouldPendingUseFullScreen(false));
        assertEquals("schedule", NotificationPlugin.pendingNotificationChannel(false));
    }

    @Test
    public void urgentPendingUsesEmergencyFullScreen() {
        assertTrue(NotificationPlugin.shouldPendingUseFullScreen(true));
        assertEquals("emergency", NotificationPlugin.pendingNotificationChannel(true));
    }
}

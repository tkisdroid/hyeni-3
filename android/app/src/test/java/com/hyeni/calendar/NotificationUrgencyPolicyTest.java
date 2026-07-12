package com.hyeni.calendar;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class NotificationUrgencyPolicyTest {
    @Test
    public void explicitFalsePreventsWarningNotArrivedFromBecomingFullScreen() {
        assertFalse(NotificationUrgencyPolicy.isEmergency(
            "parent_alert", "false", "warning", "not_arrived"
        ));
    }

    @Test
    public void emergencyNotArrivedAndSosStayUrgent() {
        assertTrue(NotificationUrgencyPolicy.isEmergency(
            "parent_alert", "true", "emergency", "not_arrived"
        ));
        assertTrue(NotificationUrgencyPolicy.isEmergency("sos", "false", "info", ""));
    }
}

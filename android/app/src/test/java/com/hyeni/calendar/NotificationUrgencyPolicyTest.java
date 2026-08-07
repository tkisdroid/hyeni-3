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
    public void notArrivedNeverUsesFullScreenButSosStaysUrgent() {
        assertFalse(NotificationUrgencyPolicy.isEmergency(
            "parent_alert", "true", "emergency", "not_arrived"
        ));
        assertFalse(NotificationUrgencyPolicy.isEmergency(
            "parent_alert", "true", "emergency", "missed_arrival"
        ));
        assertTrue(NotificationUrgencyPolicy.isEmergency("sos", "false", "info", ""));
    }

    @Test
    public void scheduleAndMemoNeverUseFullScreenEvenWithUrgentPayload() {
        assertFalse(NotificationUrgencyPolicy.isEmergency(
            "schedule", "true", "emergency", ""
        ));
        assertFalse(NotificationUrgencyPolicy.isEmergency(
            "schedule_reminder", "true", "emergency", ""
        ));
        assertFalse(NotificationUrgencyPolicy.isEmergency(
            "event_reminder", "true", "emergency", ""
        ));
        assertFalse(NotificationUrgencyPolicy.isEmergency(
            "new_memo", "true", "emergency", ""
        ));
        assertFalse(NotificationUrgencyPolicy.isEmergency(
            "memo", "true", "emergency", ""
        ));
    }

    @Test
    public void dangerExitIsNormalButDangerEnterStaysUrgent() {
        assertFalse(NotificationUrgencyPolicy.isEmergency(
            "parent_alert", "", "info", "danger_exit"
        ));
        assertTrue(NotificationUrgencyPolicy.isEmergency(
            "parent_alert", "", "info", "danger_enter"
        ));
    }
}

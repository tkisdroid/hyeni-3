package com.hyeni.calendar;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class PendingNotificationTypePolicyTest {
    @Test
    public void nativeCommandsAreNeverPresentedOrAcknowledgedByDisplayRecovery() {
        assertFalse(PendingNotificationTypePolicy.isDisplayNotification("request_location"));
        assertFalse(PendingNotificationTypePolicy.isDisplayNotification("request_device_status"));
        assertFalse(PendingNotificationTypePolicy.isDisplayNotification("remote_listen"));
        assertFalse(PendingNotificationTypePolicy.isDisplayNotification("remote_listen_stop"));
    }

    @Test
    public void userVisibleNotificationsRemainRecoverable() {
        assertTrue(PendingNotificationTypePolicy.isDisplayNotification("new_memo"));
        assertTrue(PendingNotificationTypePolicy.isDisplayNotification("15min"));
        assertTrue(PendingNotificationTypePolicy.isDisplayNotification("child_safety"));
    }
}

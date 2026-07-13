package com.hyeni.calendar;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class NotificationDeliveryReceiptTest {

    @Test
    public void postedAndPreviouslyPostedReceiptsCanBeAcknowledged() {
        assertTrue(NotificationHelper.DeliveryReceipt.forStatus(
            NotificationHelper.DeliveryStatus.POSTED
        ).shouldAcknowledge());
        assertTrue(NotificationHelper.DeliveryReceipt.forStatus(
            NotificationHelper.DeliveryStatus.ALREADY_POSTED
        ).shouldAcknowledge());
    }

    @Test
    public void blockedOrFailedReceiptsNeverAcknowledge() {
        NotificationHelper.DeliveryStatus[] failures = {
            NotificationHelper.DeliveryStatus.APP_NOTIFICATIONS_DISABLED,
            NotificationHelper.DeliveryStatus.POST_NOTIFICATIONS_PERMISSION_DENIED,
            NotificationHelper.DeliveryStatus.CHANNEL_DISABLED,
            NotificationHelper.DeliveryStatus.CHANNEL_UNAVAILABLE,
            NotificationHelper.DeliveryStatus.MANAGER_UNAVAILABLE,
            NotificationHelper.DeliveryStatus.NOTIFY_FAILED
        };

        for (NotificationHelper.DeliveryStatus status : failures) {
            assertFalse(NotificationHelper.DeliveryReceipt.forStatus(status).shouldAcknowledge());
        }
    }

    @Test
    public void onlyFreshPostReportsDisplayedNow() {
        assertTrue(NotificationHelper.DeliveryReceipt.forStatus(
            NotificationHelper.DeliveryStatus.POSTED
        ).wasPostedNow());
        assertFalse(NotificationHelper.DeliveryReceipt.forStatus(
            NotificationHelper.DeliveryStatus.ALREADY_POSTED
        ).wasPostedNow());
    }
}

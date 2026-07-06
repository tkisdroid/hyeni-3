package com.hyeni.calendar;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationManager;
import android.content.Context;
import android.os.Build;
import android.service.notification.StatusBarNotification;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class NotificationHelperDeviceTest {

    @Test
    public void postsGeneralAndEmergencyNotificationsWithHyeniIcon() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        NotificationManager notificationManager =
                (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        assertTrue(notificationManager != null);

        grantPostNotificationsIfNeeded(context);
        NotificationHelper.createChannels(context);

        int generalId = NotificationHelper.stableRequestCode("device-test-general-" + System.nanoTime());
        int emergencyId = NotificationHelper.stableRequestCode("device-test-emergency-" + System.nanoTime());

        NotificationHelper.showNotification(
                context,
                "혜니 테스트 일반 알림",
                "연결된 기기에서 일반 알림을 확인합니다.",
                "schedule",
                false,
                false,
                generalId
        );
        NotificationHelper.showNotification(
                context,
                "혜니 테스트 긴급 알림",
                "연결된 기기에서 긴급 알림을 확인합니다.",
                "emergency",
                true,
                true,
                emergencyId
        );

        StatusBarNotification general = waitForNotification(notificationManager, generalId);
        StatusBarNotification emergency = waitForNotification(notificationManager, emergencyId);

        assertEquals(NotificationHelper.CHANNEL_SCHEDULE, general.getNotification().getChannelId());
        assertEquals(NotificationHelper.CHANNEL_EMERGENCY, emergency.getNotification().getChannelId());
        assertEquals(R.drawable.ic_hyeni_notification, general.getNotification().getSmallIcon().getResId());
        assertEquals(R.drawable.ic_hyeni_notification, emergency.getNotification().getSmallIcon().getResId());
        assertEquals(Notification.CATEGORY_REMINDER, general.getNotification().category);
        assertEquals(Notification.CATEGORY_ALARM, emergency.getNotification().category);

        notificationManager.cancel(generalId);
        notificationManager.cancel(emergencyId);
    }

    private static void grantPostNotificationsIfNeeded(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return;
        try {
            InstrumentationRegistry.getInstrumentation()
                    .getUiAutomation()
                    .grantRuntimePermission(context.getPackageName(), Manifest.permission.POST_NOTIFICATIONS);
        } catch (SecurityException ignored) {
            // The device may already have the permission or deny shell-grant in some profiles.
        }
    }

    private static StatusBarNotification waitForNotification(
            NotificationManager notificationManager,
            int id
    ) throws InterruptedException {
        long deadline = System.currentTimeMillis() + 5_000L;
        while (System.currentTimeMillis() < deadline) {
            for (StatusBarNotification notification : notificationManager.getActiveNotifications()) {
                if (notification.getId() == id) {
                    return notification;
                }
            }
            Thread.sleep(100L);
        }
        throw new AssertionError("Notification id " + id + " was not posted");
    }
}

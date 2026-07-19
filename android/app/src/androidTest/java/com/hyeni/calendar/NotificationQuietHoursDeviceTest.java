package com.hyeni.calendar;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.Manifest;
import android.app.NotificationManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.service.notification.StatusBarNotification;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;
import org.junit.runner.RunWith;

import java.util.Calendar;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;

@RunWith(AndroidJUnit4.class)
public class NotificationQuietHoursDeviceTest {

    private static final String LOCATION_PREFS_NAME = "hyeni_location_prefs";
    private static final String DEDUPE_PREFS_NAME = "hyeni_notification_dedupe";
    private static final String TEST_USER_ID = "quiet-device-test-user";

    @Test
    public void suppressesGeneralNotificationButPostsSafetyBypass() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        NotificationManager notificationManager =
                (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        assertTrue(notificationManager != null);

        SharedPreferences locationPrefs = context.getSharedPreferences(
                LOCATION_PREFS_NAME,
                Context.MODE_PRIVATE
        );
        Map<String, Object> originalLocationPrefs = snapshotPreferences(locationPrefs);

        int generalId = NotificationHelper.stableRequestCode(
                "quiet-device-test-general-" + System.nanoTime()
        );
        int bypassId = NotificationHelper.stableRequestCode(
                "quiet-device-test-bypass-" + System.nanoTime()
        );

        try {
            notificationManager.cancel(generalId);
            notificationManager.cancel(bypassId);
            grantPostNotificationsIfNeeded(context);
            NotificationHelper.createChannels(context);

            String userId = ensureSessionUser(locationPrefs);
            int startMinute = currentMinuteInSeoul();
            int endMinute = Math.floorMod(startMinute + (24 * 60) - 1, 24 * 60);
            long updatedAtMs = Math.max(
                    System.currentTimeMillis(),
                    NotificationQuietHoursStore.read(locationPrefs).updatedAtMs
            );

            assertEquals(
                    NotificationQuietHoursStore.SaveResult.SAVED,
                    NotificationQuietHoursStore.saveIfCurrentSession(
                            locationPrefs,
                            userId,
                            true,
                            startMinute,
                            endMinute,
                            NotificationQuietHoursStore.SEOUL_TIME_ZONE_ID,
                            updatedAtMs
                    )
            );

            NotificationHelper.DeliveryReceipt generalReceipt =
                    NotificationHelper.showNotification(
                            context,
                            "조용한 시간 일반 알림",
                            "조용한 시간에는 게시되지 않아야 합니다.",
                            "schedule",
                            false,
                            false,
                            generalId,
                            null,
                            NotificationQuietHoursPolicy.NotificationIdentity.of(
                                    "schedule_reminder",
                                    ""
                            )
                    );

            assertEquals(
                    NotificationHelper.DeliveryStatus.QUIET_HOURS_SUPPRESSED,
                    generalReceipt.getStatus()
            );
            assertTrue(generalReceipt.shouldAcknowledge());
            assertFalse(generalReceipt.wasPostedNow());
            assertNotificationRemainsAbsent(notificationManager, generalId);

            NotificationHelper.DeliveryReceipt bypassReceipt =
                    NotificationHelper.showNotification(
                            context,
                            "미도착 안전 알림",
                            "안전 알림은 조용한 시간에도 게시되어야 합니다.",
                            "safety",
                            false,
                            false,
                            bypassId,
                            null,
                            NotificationQuietHoursPolicy.NotificationIdentity.of(
                                    "parent_alert",
                                    "not_arrived"
                            )
                    );

            assertEquals(NotificationHelper.DeliveryStatus.POSTED, bypassReceipt.getStatus());
            assertTrue(bypassReceipt.shouldAcknowledge());
            assertTrue(bypassReceipt.wasPostedNow());
            assertEquals(bypassId, waitForNotification(notificationManager, bypassId).getId());
        } finally {
            try {
                notificationManager.cancel(generalId);
                notificationManager.cancel(bypassId);
                context.getSharedPreferences(DEDUPE_PREFS_NAME, Context.MODE_PRIVATE)
                        .edit()
                        .remove("n_" + generalId)
                        .remove("n_" + bypassId)
                        .commit();
            } finally {
                restorePreferences(locationPrefs, originalLocationPrefs);
            }
        }
    }

    private static String ensureSessionUser(SharedPreferences prefs) {
        String currentUserId = SessionTokenStore.readContext(prefs).userId;
        if (!currentUserId.isEmpty()) return currentUserId;
        assertTrue(prefs.edit().putString("userId", TEST_USER_ID).commit());
        return TEST_USER_ID;
    }

    private static int currentMinuteInSeoul() {
        Calendar calendar = Calendar.getInstance(
                TimeZone.getTimeZone(NotificationQuietHoursStore.SEOUL_TIME_ZONE_ID)
        );
        return calendar.get(Calendar.HOUR_OF_DAY) * 60 + calendar.get(Calendar.MINUTE);
    }

    private static void grantPostNotificationsIfNeeded(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return;
        try {
            InstrumentationRegistry.getInstrumentation()
                    .getUiAutomation()
                    .grantRuntimePermission(context.getPackageName(), Manifest.permission.POST_NOTIFICATIONS);
        } catch (SecurityException ignored) {
            // 일부 프로필은 shell grant를 거부하거나 이미 권한이 부여되어 있을 수 있다.
        }
    }

    private static void assertNotificationRemainsAbsent(
            NotificationManager notificationManager,
            int id
    ) throws InterruptedException {
        long deadline = System.currentTimeMillis() + 500L;
        while (System.currentTimeMillis() < deadline) {
            assertFalse(isNotificationActive(notificationManager, id));
            Thread.sleep(50L);
        }
    }

    private static boolean isNotificationActive(NotificationManager notificationManager, int id) {
        for (StatusBarNotification notification : notificationManager.getActiveNotifications()) {
            if (notification.getId() == id) return true;
        }
        return false;
    }

    private static StatusBarNotification waitForNotification(
            NotificationManager notificationManager,
            int id
    ) throws InterruptedException {
        long deadline = System.currentTimeMillis() + 5_000L;
        while (System.currentTimeMillis() < deadline) {
            for (StatusBarNotification notification : notificationManager.getActiveNotifications()) {
                if (notification.getId() == id) return notification;
            }
            Thread.sleep(100L);
        }
        throw new AssertionError("Notification id " + id + " was not posted");
    }

    private static Map<String, Object> snapshotPreferences(SharedPreferences prefs) {
        Map<String, Object> snapshot = new HashMap<>();
        for (Map.Entry<String, ?> entry : prefs.getAll().entrySet()) {
            Object value = entry.getValue();
            if (value instanceof Set<?>) {
                value = new HashSet<>((Set<?>) value);
            }
            snapshot.put(entry.getKey(), value);
        }
        return snapshot;
    }

    private static void restorePreferences(
            SharedPreferences prefs,
            Map<String, Object> snapshot
    ) {
        SharedPreferences.Editor editor = prefs.edit().clear();
        for (Map.Entry<String, Object> entry : snapshot.entrySet()) {
            String key = entry.getKey();
            Object value = entry.getValue();
            if (value instanceof String) {
                editor.putString(key, (String) value);
            } else if (value instanceof Boolean) {
                editor.putBoolean(key, (Boolean) value);
            } else if (value instanceof Integer) {
                editor.putInt(key, (Integer) value);
            } else if (value instanceof Long) {
                editor.putLong(key, (Long) value);
            } else if (value instanceof Float) {
                editor.putFloat(key, (Float) value);
            } else if (value instanceof Set<?>) {
                Set<String> stringSet = new HashSet<>();
                for (Object item : (Set<?>) value) {
                    if (!(item instanceof String)) {
                        throw new AssertionError("Unsupported preference set value for " + key);
                    }
                    stringSet.add((String) item);
                }
                editor.putStringSet(key, stringSet);
            } else if (value != null) {
                throw new AssertionError("Unsupported preference value for " + key);
            }
        }
        assertTrue(editor.commit());
    }
}
